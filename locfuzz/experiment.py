"""LocFuzz 实验驱动：对种子 PoC 做 LLM 引导变异并在 JS 引擎上执行。

流程：
  对每个种子 PoC：
    1. 运行原始用例，采集基线执行特征（调用序列 + 覆盖集合）
    2. 由 LLM 生成 M 个变异用例（保留漏洞触发特征）
    3. 逐个执行，分类结果，计算与原始用例的 EditSim / Jaccard
  汇总输出 有效性 与 相似度，崩溃/超时用例单独列出。

用法：
  python -m locfuzz.experiment --per-seed 10
"""
import argparse
import json
import time
from pathlib import Path

from .features import edit_sim, jaccard
from .mutator import LLMMutator
from .runner import is_valid, run_case

BASE_DIR = Path(__file__).resolve().parent.parent  # code/（seeds/ 与 results/ 所在层）


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default=str(BASE_DIR / "seeds"))
    ap.add_argument("--per-seed", type=int, default=10)
    ap.add_argument("--timeout", type=int, default=5000)
    ap.add_argument("--out", default=str(BASE_DIR / "results"))
    args = ap.parse_args()

    out_dir = Path(args.out)
    case_dir = out_dir / "cases"
    case_dir.mkdir(parents=True, exist_ok=True)

    mutator = LLMMutator(mutation_count=2)

    seeds = sorted(Path(args.seeds).glob("*.js"))
    assert seeds, f"种子目录为空: {args.seeds}"

    all_records = []
    crashes = []
    t0 = time.time()
    for seed_path in seeds:
        seed_code = seed_path.read_text(encoding="utf-8")
        base = run_case(seed_path, args.timeout)
        print(f"[seed] {seed_path.name}: 基线 status={base['status']} "
              f"seq={len(base['call_sequence'])} funcs={len(base['covered_functions'])}")

        for i in range(args.per_seed):
            mutant_code = mutator.mutate(seed_code)

            case_path = case_dir / f"{seed_path.stem}_m{i}.js"
            case_path.write_text(mutant_code, encoding="utf-8")
            r = run_case(case_path, args.timeout)
            rec = {
                "seed": seed_path.name, "id": i,
                "status": r["status"],
                "valid": is_valid(r),
                "jaccard": round(jaccard(base["covered_functions"],
                                         r["covered_functions"]), 2),
                "edit_sim": round(edit_sim(base["call_sequence"],
                                           r["call_sequence"]), 2),
                "mutation_info": mutator.last_mutation_info,
            }
            all_records.append(rec)
            if r["status"] in ("crash", "timeout"):
                crashes.append({"case": str(case_path), "status": r["status"],
                                "error": r.get("error", "")})
            print(f"  [m{i:02d}] {rec['status']:13s} "
                  f"valid={rec['valid']} J={rec['jaccard']:.1f} E={rec['edit_sim']:.1f}")

    # —— 汇总 ——
    n = len(all_records)
    valid_rate = sum(r["valid"] for r in all_records) / n * 100
    mean_j = sum(r["jaccard"] for r in all_records) / n
    mean_e = sum(r["edit_sim"] for r in all_records) / n

    summary = {
        "config": vars(args),
        "elapsed_sec": round(time.time() - t0, 1),
        "total_cases": n,
        "validity_rate_pct": round(valid_rate, 2),
        "mean_jaccard_pct": round(mean_j, 2),
        "mean_edit_sim_pct": round(mean_e, 2),
        "crashes_and_timeouts": crashes,
        "status_breakdown": {s: sum(1 for r in all_records if r["status"] == s)
                             for s in sorted({r["status"] for r in all_records})},
        "records": all_records,
    }
    report = out_dir / "results.json"
    report.write_text(json.dumps(summary, indent=2, ensure_ascii=False),
                      encoding="utf-8")

    print("\n===== 汇总 =====")
    print(f"用例总数        : {n}")
    print(f"用例有效性    : {valid_rate:.2f}%  {summary['status_breakdown']}")
    print(f"Jaccard 相似度: {mean_j:.2f}%")
    print(f"EditSim 相似度: {mean_e:.2f}%")
    if crashes:
        print(f"崩溃/超时用例   : {len(crashes)} 个（详见 results.json）")
    print(f"结果已保存      : {report}")


if __name__ == "__main__":
    main()
