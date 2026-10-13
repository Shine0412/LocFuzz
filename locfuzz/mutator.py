"""LLM 变异器：调用 OpenAI 兼容 API 执行定向变异（LocFuzz 核心模块）。

默认使用 DeepSeek API。API 密钥直接读取 code/.secret/DeepSeek_key.txt
（部署时不注入环境变量），也可用环境变量覆盖：
  LOC_FUZZ_API_KEY    API 密钥，缺省时回退读取
                      code/.secret/DeepSeek_key.txt
  LOC_FUZZ_BASE_URL   兼容端点，默认 https://api.deepseek.com/v1
  LOC_FUZZ_MODEL      模型名，默认 deepseek-chat
"""
import json
import os
import re
import time
from pathlib import Path

import requests

from .prompts import build_messages

CODE_BLOCK_RE = re.compile(r"```(?:javascript|js)?\s*\n(.*?)```", re.S)
# LLM 自述变异位置选择的 MUTATION_INFO 行（宽松匹配到行尾）
INFO_LINE_RE = re.compile(r"^MUTATION_INFO:\s*(.+?)\s*$", re.M)

# —— DeepSeek 默认配置——
DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
DEFAULT_MODEL = "deepseek-chat"


def _load_api_key() -> str:
    key = os.environ.get("LOC_FUZZ_API_KEY", "")
    if key:
        return key
    # 密钥文件位于 code/.secret/（locfuzz/ 的上一级）
    key_file = (Path(__file__).resolve().parent.parent / ".secret"
                / "DeepSeek_key.txt")
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    return ""


class LLMMutator:
    def __init__(self, mutation_count: int = 2, retries: int = 3):
        self.mutation_count = mutation_count
        self.retries = retries
        self.api_key = _load_api_key()
        self.base_url = os.environ.get("LOC_FUZZ_BASE_URL",
                                       DEFAULT_BASE_URL).rstrip("/")
        self.model = os.environ.get("LOC_FUZZ_MODEL", DEFAULT_MODEL)
        # 最近一次成功变异时 LLM 自述的变异位置/策略（MUTATION_INFO 行）
        self.last_mutation_info = None
        # 最近一次成功变异的 LLM 调用耗时（毫秒）
        self.last_latency_ms = None

    def mutate(self, seed_code: str) -> str:
        """调用 LLM 生成变异用例；全部重试失败则抛异常。"""
        if not self.api_key:
            raise RuntimeError(
                "未找到 API 密钥：请确认 code/.secret/DeepSeek_key.txt 存在，"
                "或设置 LOC_FUZZ_API_KEY 环境变量")
        messages = build_messages(seed_code, self.mutation_count)
        last_err = None
        for attempt in range(self.retries):
            try:
                t0 = time.time()
                resp = requests.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={"model": self.model, "messages": messages,
                          "temperature": 0.8},
                    timeout=120,
                )
                resp.raise_for_status()
                latency_ms = round((time.time() - t0) * 1000)
                content = resp.json()["choices"][0]["message"]["content"]
                code = self._extract_code(content)
                if code and code.strip() and code != seed_code:
                    # 解析 LLM 对"变异位置选择"的自述（可选，缺失不阻塞）
                    self.last_mutation_info = self._extract_info(content)
                    if self.last_mutation_info is None:
                        self.last_mutation_info = {}
                    self.last_mutation_info["latency_ms"] = latency_ms
                    self.last_latency_ms = latency_ms
                    return code
                last_err = "LLM 返回内容无法解析为变异代码"
            except Exception as e:  # 网络/解析错误一律重试
                print(f"[mutator] LLM 调用失败，重试：{e}")
                last_err = e
            # 指数退避，避免对端点形成冲击
            if attempt < self.retries - 1:
                time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"LLM 变异失败（已重试 {self.retries} 次）: {last_err}")

    @staticmethod
    def _extract_code(content: str) -> str | None:
        m = CODE_BLOCK_RE.search(content)
        return m.group(1) if m else None

    @staticmethod
    def _extract_info(content: str):
        """解析 MUTATION_INFO 行；优先 JSON，失败则保留原文。"""
        m = INFO_LINE_RE.search(content)
        if not m:
            return None
        raw = m.group(1).strip()
        try:
            info = json.loads(raw)
            return info if isinstance(info, dict) else {"note": raw}
        except ValueError:
            return {"note": raw}
