"""行为相似度度量：
  - EditSim: 函数调用序列的编辑距离相似度（difflib 比值 × 100）
  - Jaccard: 函数覆盖集合的交并比 × 100
"""
import difflib


def edit_sim(seq_a: list[str], seq_b: list[str]) -> float:
    """调用序列编辑距离相似度（0~100）。空序列对定义为 0。"""
    if not seq_a and not seq_b:
        return 100.0
    if not seq_a or not seq_b:
        return 0.0
    return difflib.SequenceMatcher(None, seq_a, seq_b).ratio() * 100


def jaccard(set_a: list[str], set_b: list[str]) -> float:
    """函数覆盖集合的 Jaccard 相似度（0~100）。"""
    a, b = set(set_a), set(set_b)
    if not a and not b:
        return 100.0
    union = a | b
    if not union:
        return 0.0
    return len(a & b) / len(union) * 100
