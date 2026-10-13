"""执行 harness：调 coverage_agent.js 运行测试用例并解析结果。

设计决策：
- 引擎用 Node.js（即 V8），无需自行编译 d8/js shell；
- "函数地址序列"以 函数名@文件:行号 近似（同一 Node 二进制内稳定）；
- 崩溃 = 进程被杀/退出且未产出结果文件。
"""
import json
import subprocess
import sys
from pathlib import Path

AGENT = Path(__file__).resolve().parent / "assets" / "coverage_agent.js"


def run_case(js_path: str, timeout_ms: int = 5000) -> dict:
    """执行单个 .js 文件，返回 {status, error, call_sequence, covered_functions}。

    status ∈ ok / syntax_error / runtime_error / timeout / crash
    """
    js_path = str(Path(js_path).resolve())
    out_path = js_path + ".feat.json"
    Path(out_path).unlink(missing_ok=True)

    cmd = ["node", str(AGENT), js_path, out_path, str(timeout_ms)]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True,
                              timeout=timeout_ms / 1000 + 10)
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "error": "agent killed", "call_sequence": [],
                "covered_functions": []}

    if not Path(out_path).exists():
        # 进程级崩溃（段错误/OOM）或 agent 自身异常
        return {"status": "crash", "error": proc.stderr[-300:],
                "call_sequence": [], "covered_functions": []}

    with open(out_path, encoding="utf-8") as f:
        result = json.load(f)
    # 特征文件是执行 agent 与 runner 之间的临时通信介质，读完即删，
    # 避免服务器长期运行时 cases/ 与 seeds/ 下堆积 .feat.json
    Path(out_path).unlink(missing_ok=True)
    return result


def is_valid(result: dict) -> bool:
    """有效性口径：解析成功（非语法错误）且未超时/崩溃即视为有效输入。"""
    return result["status"] in ("ok", "runtime_error")
