"""后台 fuzz 任务：把 locfuzz 流水线封装为线程 Job，支持进度上报、
事件流与停止。

每个 Job 独占一个目录（data_dir/jobs/<job_id>/）：
  seeds/       上传的种子
  cases/       生成的变异用例
  results.json 完成后的汇总
事件流（events）通过 GET /api/jobs/{id}/events 轮询读取。
"""
import json
import threading
import time
from pathlib import Path

from locfuzz.features import edit_sim, jaccard
from locfuzz.mutator import LLMMutator
from locfuzz.runner import is_valid, run_case

_EVENT_MAX = 500  # 单任务事件上限，防内存膨胀


class FuzzJob(threading.Thread):
    def __init__(self, job_id: str, seeds: list, per_seed: int,
                 timeout_ms: int, job_dir: Path):
        """seeds: [{"name": str, "code": str}, ...]"""
        super().__init__(daemon=True)
        self.job_id = job_id
        self.seeds = seeds
        self.per_seed = per_seed
        self.timeout_ms = timeout_ms
        self.job_dir = Path(job_dir)

        total = len(seeds) * per_seed
        self.status = "running"          # running / done / stopped / error
        self.error = ""
        self.progress = {"done": 0, "total": total, "current": "启动中"}
        self.result = None
        self.events = []
        self._stop_flag = threading.Event()
        self.created_at = time.strftime("%Y-%m-%d %H:%M:%S")
        self.started_at = time.time()

    # —— 事件流 ——
    def log(self, kind: str, msg: str):
        if len(self.events) < _EVENT_MAX:
            self.events.append({
                "time": time.strftime("%H:%M:%S"),
                "kind": kind,          # info / llm / exec / warn / error / done
                "msg": msg,
            })

    # —— 控制 ——
    def stop(self):
        self._stop_flag.set()

    @property
    def stopped(self):
        return self._stop_flag.is_set()

    # —— 主循环 ——
    def run(self):
        try:
            self.log("info", f"任务创建：{len(self.seeds)} 个种子 × "
                             f"{self.per_seed} 变异，超时 {self.timeout_ms} ms")
            self._run_pipeline()
            self.status = "stopped" if self.stopped else "done"
            if self.stopped:
                self.log("warn", "任务被手动停止")
            else:
                self.log("done", "任务完成，汇总已写入 results.json")
        except Exception as e:  # 密钥缺失、目录错误等致命问题
            self.status = "error"
            self.error = str(e)[:500]
            self.log("error", f"任务失败：{self.error}")
        finally:
            self.progress["current"] = ""

    def _run_pipeline(self):
        seeds_dir = self.job_dir / "seeds"
        case_dir = self.job_dir / "cases"
        seeds_dir.mkdir(parents=True, exist_ok=True)
        case_dir.mkdir(parents=True, exist_ok=True)

        mutator = LLMMutator(mutation_count=2)
        self.log("info", f"LLM 就绪：{mutator.model} @ {mutator.base_url}")

        all_records, crashes = [], []
        t0 = time.time()
        for seed in self.seeds:
            if self.stopped:
                break
            seed_path = seeds_dir / seed["name"]
            seed_path.write_text(seed["code"], encoding="utf-8")

            self.progress["current"] = f"基线 {seed['name']}"
            self.log("info", f"采集基线执行特征：{seed['name']}")
            base = run_case(seed_path, self.timeout_ms)
            self.log("info",
                     f"基线完成：status={base['status']} "
                     f"调用序列 {len(base['call_sequence'])} 帧 / "
                     f"覆盖 {len(base['covered_functions'])} 函数")
            if base["status"] in ("crash", "timeout"):
                crashes.append({"case": seed["name"], "status": base["status"],
                                "error": "基线用例异常（未变异的原始样本即触发）"})
                self.log("error", f"⚠ 基线异常：{seed['name']} → {base['status']}")

            for i in range(self.per_seed):
                if self.stopped:
                    break
                self.progress["current"] = f"{seed['name']} 变异 {i + 1}/{self.per_seed}"
                self.log("llm", f"[{seed['name']} #{i}] 请求 LLM 选择变异位置…")
                r, info = None, {}
                for attempt in (1, 2):
                    try:
                        mutant_code = mutator.mutate(seed["code"])
                    except Exception as e:
                        all_records.append({"seed": seed["name"], "id": i,
                                            "status": "llm_error", "valid": False,
                                            "jaccard": 0.0, "edit_sim": 0.0,
                                            "error": str(e)[:300]})
                        self.log("error", f"[{seed['name']} #{i}] LLM 变异失败：{str(e)[:200]}")
                        self._tick()
                        break
                    info = mutator.last_mutation_info or {}
                    loc = info.get("locations", "—")
                    lat = info.get("latency_ms", "?")
                    self.log("llm", f"[{seed['name']} #{i}] LLM 选定位置：{loc}"
                                    f"（{lat} ms）")
                    case_path = case_dir / f"{Path(seed['name']).stem}_m{i}.js"
                    case_path.write_text(mutant_code, encoding="utf-8")
                    r = run_case(case_path, self.timeout_ms)
                    if r["status"] != "syntax_error":
                        break
                    self.log("warn", f"[{seed['name']} #{i}] 变异体语法非法，"
                                     f"请求 LLM 重试（第 {attempt + 1} 次）")
                if r is None:        # LLM 调用失败，记录已写入
                    continue
                if r["status"] == "syntax_error":  # 重试后仍非法，记为无效
                    self.log("warn", f"[{seed['name']} #{i}] 重试后仍语法非法，记为无效")
                rec = {
                    "seed": seed["name"], "id": i, "status": r["status"],
                    "valid": is_valid(r),
                    "jaccard": round(jaccard(base["covered_functions"],
                                             r["covered_functions"]), 2),
                    "edit_sim": round(edit_sim(base["call_sequence"],
                                               r["call_sequence"]), 2),
                    "latency_ms": mutator.last_latency_ms,
                    # LLM 自述的变异位置/策略（核心机制留痕）
                    "mutation_info": mutator.last_mutation_info,
                }
                if r.get("error"):
                    rec["error"] = r["error"][:300]
                all_records.append(rec)
                kind = "exec" if r["status"] == "ok" else "warn"
                self.log(kind, f"[{seed['name']} #{i}] 执行 → {r['status']} "
                               f"J={rec['jaccard']} E={rec['edit_sim']}")
                if r["status"] in ("crash", "timeout"):
                    crashes.append({"case": case_path.name, "status": r["status"],
                                    "error": r.get("error", "")})
                    self.log("error", f"[{seed['name']} #{i}] 可疑！"
                                      f"{r['status']}，已列入崩溃/超时表")
                self._tick()

        # —— 汇总 ——
        n = len(all_records)
        valid_n = sum(1 for r in all_records if r["valid"])
        self.result = {
            "job_id": self.job_id,
            "created_at": self.created_at,
            "elapsed_sec": round(time.time() - t0, 1),
            "total_cases": n,
            "validity_rate_pct": round(valid_n / n * 100, 2) if n else 0.0,
            "mean_jaccard_pct": round(sum(r["jaccard"] for r in all_records) / n, 2) if n else 0.0,
            "mean_edit_sim_pct": round(sum(r["edit_sim"] for r in all_records) / n, 2) if n else 0.0,
            "crashes_and_timeouts": crashes,
            "status_breakdown": {s: sum(1 for r in all_records if r["status"] == s)
                                 for s in sorted({r["status"] for r in all_records})},
            "records": all_records,
        }
        (self.job_dir / "results.json").write_text(
            json.dumps(self.result, indent=2, ensure_ascii=False),
            encoding="utf-8")

    def _tick(self):
        self.progress["done"] += 1

    # —— 对外视图 ——
    def summary(self):
        return {
            "job_id": self.job_id,
            "created_at": self.created_at,
            "status": self.status,
            "error": self.error,
            "seeds": [s["name"] for s in self.seeds],
            "per_seed": self.per_seed,
            "timeout": self.timeout_ms,
            "progress": self.progress,
            "elapsed_sec": round(time.time() - self.started_at, 1),
        }
