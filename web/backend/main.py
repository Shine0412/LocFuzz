"""LocFuzz Web 后端：FastAPI + 后台线程 fuzz 任务。

启动（在 code/ 目录下）：
  uvicorn web.backend.main:app --host 0.0.0.0 --port 6024

环境变量：
  BACKEND_PORT        监听端口，默认 6024
  CORS_ORIGINS        允许跨域来源，逗号分隔，默认 *（开发期）
  LOC_FUZZ_DATA_DIR   任务数据落盘目录，默认 web/backend/data（容器内 /data）
  LOC_FUZZ_BASE_URL / LOC_FUZZ_MODEL / LOC_FUZZ_API_KEY  可选覆盖（见 locfuzz.mutator）
"""
import os
import re
import subprocess
import sys
import time
from pathlib import Path

# 让 web.backend 能 import locfuzz 包（code/ 加入 sys.path）
_CODE_ROOT = Path(__file__).resolve().parents[2]
if str(_CODE_ROOT) not in sys.path:
    sys.path.insert(0, str(_CODE_ROOT))

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

from locfuzz.mutator import LLMMutator
from .store import Store

DATA_DIR = Path(os.environ.get("LOC_FUZZ_DATA_DIR",
                               Path(__file__).resolve().parent / "data"))
store = Store(DATA_DIR)

# 种子库：内置（seeds/）与用户上传（seeds_user/）分离
SEED_DIR_BUILTIN = _CODE_ROOT / "seeds"
SEED_DIR_USER = _CODE_ROOT / "seeds_user"
SEED_DIR_USER.mkdir(exist_ok=True)
_MAX_SEED_SIZE = 64 * 1024  # 单种子 64 KB 上限

_NAME_RE = re.compile(r"^[\w\-. ]+\.js$")

# 内置种子的漏洞模式说明（展示在 Web 勾选界面）
_SEED_DESC = {
    "seed1_typeconf.js": "JIT 类型混淆（valueOf 副作用改变类型）",
    "seed2_oob.js": "数组长度边界（边界检查消除绕过）",
    "seed3_proto.js": "原型链 / 动态属性访问（Proxy 陷阱语义不一致）",
    "seed4_typer.js": "TurboFan typer 数值范围失配（Math 函数越界值）",
    "seed5_sort.js": "排序比较器副作用（sort 中收缩数组）",
    "seed6_regexp.js": "RegExp 状态边界（exec 热循环中 lastIndex 突变）",
    "seed7_redos.js": "正则灾难性回溯（ReDoS，预期超时，验证异常监控链路）",
    "seed8_oom.js": "堆内存耗尽（资源耗尽型 DoS，预期崩溃，验证崩溃捕获链路）",
}


def _list_seed_dir(d: Path, with_desc: bool = False):
    if not d.is_dir():
        return []
    out = []
    for p in sorted(d.glob("*.js")):
        item = {"name": p.name, "size": p.stat().st_size}
        if with_desc:
            item["desc"] = _SEED_DESC.get(p.name, "")
        out.append(item)
    return out

app = FastAPI(title="LocFuzz API", version="0.2.0")

_cors_origins = os.environ.get("CORS_ORIGINS", "*")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _cors_origins.split(",")],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
print(f"[backend] CORS origins: {_cors_origins} | data dir: {DATA_DIR}")

_BOOT_AT = time.time()
_NODE_VER = None


def _node_version() -> str:
    """探测 Node.js（V8）版本，失败则返回 unknown。"""
    global _NODE_VER
    if _NODE_VER is None:
        try:
            out = subprocess.run(["node", "--version"], capture_output=True,
                                 text=True, timeout=10)
            _NODE_VER = out.stdout.strip() or "unknown"
        except Exception:
            _NODE_VER = "unknown"
    return _NODE_VER


def _engine_info():
    m = LLMMutator()
    return {
        "model": m.model,
        "base_url": m.base_url,
        "has_key": bool(m.api_key),
        "engine": "V8",
        "node_version": _node_version(),
        "python_version": f"{sys.version_info.major}.{sys.version_info.minor}",
        "platform": sys.platform,
    }


# ---------- 基础 ----------

@app.get("/api/health")
def health():
    return {"status": "ok", "uptime_sec": round(time.time() - _BOOT_AT, 1)}


@app.get("/api/config")
def config():
    """返回当前 LLM/引擎配置（不回传密钥）。"""
    return _engine_info()


@app.get("/api/stats")
def stats():
    """全局统计：所有任务汇总（喂前端仪表盘）。"""
    jobs = store.list()
    finished = [j for j in jobs if j.result]
    cases = sum(j.result["total_cases"] for j in finished)
    status_dist = {}
    for j in finished:
        for s, n in j.result["status_breakdown"].items():
            status_dist[s] = status_dist.get(s, 0) + n

    def avg(key):
        vals = [j.result[key] for j in finished if j.result["total_cases"]]
        return round(sum(vals) / len(vals), 2) if vals else 0.0

    return {
        **_engine_info(),
        "total_jobs": len(jobs),
        "running_jobs": sum(1 for j in jobs if j.status == "running"),
        "finished_jobs": len(finished),
        "total_cases": cases,
        "avg_validity_pct": avg("validity_rate_pct"),
        "avg_jaccard_pct": avg("mean_jaccard_pct"),
        "avg_edit_sim_pct": avg("mean_edit_sim_pct"),
        "total_crashes": sum(len(j.result["crashes_and_timeouts"]) for j in finished),
        "status_dist": status_dist,
        "uptime_sec": round(time.time() - _BOOT_AT, 1),
    }


# ---------- 种子库 ----------


@app.get("/api/seeds")
def list_seeds():
    """内置种子 + 用户上传种子（分开列出）。"""
    return {"builtin": _list_seed_dir(SEED_DIR_BUILTIN, with_desc=True),
            "user": _list_seed_dir(SEED_DIR_USER)}


@app.post("/api/seeds")
async def upload_seed(file: UploadFile = File(...)):
    """上传自定义种子，保存至 seeds_user/（与内置种子隔离）。"""
    name = Path(file.filename or "").name
    if not _NAME_RE.match(name):
        raise HTTPException(400, "文件名仅允许中英文/数字/下划线/连字符/点，且以 .js 结尾")
    data = await file.read()
    if not data.strip():
        raise HTTPException(400, "种子文件为空")
    if len(data) > _MAX_SEED_SIZE:
        raise HTTPException(400, "种子文件超过 64 KB 上限")
    path = SEED_DIR_USER / name
    if path.exists():
        raise HTTPException(409, f"同名种子已存在：{name}")
    path.write_bytes(data)
    return {"saved": name, "dir": "user"}


@app.delete("/api/seeds/{name}")
def delete_seed(name: str):
    """仅允许删除用户上传的种子。"""
    if not _NAME_RE.match(name):
        raise HTTPException(400, "非法文件名")
    path = SEED_DIR_USER / name
    if not path.is_file():
        raise HTTPException(404, "种子不存在或无权删除（内置种子不可删除）")
    path.unlink()
    return {"deleted": name}


# ---------- 任务 ----------

@app.post("/api/jobs")
async def create_job(
    seeds: list[UploadFile] = File(default=[]),
    selected: str = Form(""),
    per_seed: int = Form(10),
    timeout: int = Form(5000),
):
    if not 1 <= per_seed <= 200:
        raise HTTPException(400, "per_seed 需在 1~200 之间")
    if not 1000 <= timeout <= 60000:
        raise HTTPException(400, "timeout 需在 1000~60000 毫秒之间")

    items, seen = [], set()

    def add_item(name: str, code: str):
        if name in seen:
            return
        seen.add(name)
        items.append({"name": name, "code": code})

    # 1) 勾选种子：用户目录优先于内置目录解析
    for raw in selected.split(","):
        name = Path(raw.strip()).name
        if not name:
            continue
        if not _NAME_RE.match(name):
            raise HTTPException(400, f"非法种子名: {raw}")
        for d in (SEED_DIR_USER, SEED_DIR_BUILTIN):
            p = d / name
            if p.is_file():
                add_item(name, p.read_text(encoding="utf-8", errors="replace"))
                break
        else:
            raise HTTPException(404, f"种子不存在: {name}")

    # 2) 随任务直接上传的种子（保留原能力；重名自动加前缀）
    for f in seeds or []:
        if not f.filename or not f.filename.endswith(".js"):
            raise HTTPException(400, f"仅接受 .js 种子文件: {f.filename}")
        code = (await f.read()).decode("utf-8", errors="replace")
        if not code.strip():
            raise HTTPException(400, f"种子文件为空: {f.filename}")
        name = Path(f.filename).name
        if name in seen:
            name = f"up_{name}"
        add_item(name, code)

    if not items:
        raise HTTPException(400, "未选择任何种子")
    if len(items) > 50:
        raise HTTPException(400, "单次最多 50 个种子")

    try:
        job = store.create(items, per_seed, timeout)
    except RuntimeError as e:
        raise HTTPException(429, str(e))
    return {"job_id": job.job_id, "status": job.status}


@app.get("/api/jobs")
def list_jobs():
    return [j.summary() for j in store.list()]


def _get_job(job_id: str):
    job = store.get(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    return job


@app.get("/api/jobs/{job_id}")
def job_detail(job_id: str):
    return _get_job(job_id).summary()


@app.post("/api/jobs/{job_id}/stop")
def stop_job(job_id: str):
    job = _get_job(job_id)
    if job.status == "running":
        job.stop()
        job.log("warn", "收到停止指令")
    return {"job_id": job_id, "status": job.status}


@app.post("/api/jobs/{job_id}/rerun")
def rerun_job(job_id: str):
    """以相同配置重新发起任务。"""
    try:
        job = store.rerun(job_id)
    except KeyError:
        raise HTTPException(404, "任务不存在")
    except RuntimeError as e:
        raise HTTPException(429, str(e))
    return {"job_id": job.job_id, "status": job.status}


@app.delete("/api/jobs/{job_id}")
def delete_job(job_id: str):
    try:
        store.delete(job_id)
    except KeyError:
        raise HTTPException(404, "任务不存在")
    except RuntimeError as e:
        raise HTTPException(409, str(e))
    return {"deleted": job_id}


@app.get("/api/jobs/{job_id}/events")
def job_events(job_id: str):
    """任务实时事件流（前端控制台轮询）。"""
    job = _get_job(job_id)
    return {"events": job.events, "status": job.status}


@app.get("/api/jobs/{job_id}/result")
def job_result(job_id: str):
    job = _get_job(job_id)
    if job.status == "error":
        raise HTTPException(500, f"任务失败: {job.error}")
    if job.result is None:
        raise HTTPException(409, "任务尚未完成")
    return job.result


@app.get("/api/jobs/{job_id}/export")
def export_result(job_id: str):
    """下载汇总 JSON。"""
    job = _get_job(job_id)
    path = job.job_dir / "results.json"
    if not path.is_file():
        raise HTTPException(409, "任务尚未完成")
    return FileResponse(path, media_type="application/json",
                        filename=f"locfuzz_{job_id}_results.json")


@app.get("/api/jobs/{job_id}/cases")
def list_cases(job_id: str):
    job = _get_job(job_id)
    case_dir = job.job_dir / "cases"
    cases = sorted(p.name for p in case_dir.glob("*.js")) if case_dir.is_dir() else []
    return {"cases": cases}


@app.get("/api/jobs/{job_id}/cases/{name}")
def download_case(job_id: str, name: str):
    job = _get_job(job_id)
    if not _NAME_RE.match(name):
        raise HTTPException(400, "非法文件名")
    path = job.job_dir / "cases" / name
    if not path.is_file():
        raise HTTPException(404, "用例不存在")
    return FileResponse(path, media_type="text/javascript", filename=name)


@app.get("/api/jobs/{job_id}/seeds/{name}", response_class=PlainTextResponse)
def view_seed(job_id: str, name: str):
    job = _get_job(job_id)
    if not _NAME_RE.match(name):
        raise HTTPException(400, "非法文件名")
    path = job.job_dir / "seeds" / name
    if not path.is_file():
        raise HTTPException(404, "种子不存在")
    return path.read_text(encoding="utf-8")
