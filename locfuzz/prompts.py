"""提示词加载与占位符填充。

直接使用项目自带的两个提示词文件（位于 locfuzz/assets/）：
  - promote_system.txt : system prompt，含 f-string 占位符 {mutation_count}
  - promote_user.txt   : user prompt，含占位符 {seed_code}
"""
from pathlib import Path

_ASSETS = Path(__file__).resolve().parent / "assets"
SYSTEM_TEMPLATE = (_ASSETS / "promote_system.txt").read_text(encoding="utf-8")
USER_TEMPLATE = (_ASSETS / "promote_user.txt").read_text(encoding="utf-8")


_USER_SUFFIX = (
    "\n\n另外（重要）：在返回变异代码的代码块之前，请先用一行 JSON 说明你的"
    "变异位置选择，格式如下：\n"
    'MUTATION_INFO: {"locations": "<你选择的变异位置，如函数名/语句位置>", '
    '"strategy": "<执行的变异策略，如边界值/类型混淆/插入/删除/替换>", '
    '"pattern": "<你识别出的历史漏洞模式，如JIT类型混淆/边界检查绕过>"}\n'
    "代码块内仍只包含变异后的完整代码，不要在代码块后附加解释。"
)


def build_messages(seed_code: str, mutation_count: int = 2):
    """填充占位符，返回 OpenAI chat 格式的 messages 列表。"""
    system = SYSTEM_TEMPLATE.format(mutation_count=mutation_count)
    user = USER_TEMPLATE.format(seed_code=seed_code) + _USER_SUFFIX
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]
