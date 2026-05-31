"""
CareMind Memory Policy
Memory 写入门控策略：区分自动写入、建议确认写入和禁止写入内容。
对应 CareMind_Memory.md 第 10 节设计。
"""
from typing import Any

# ─────────────────────────────────────────────
# 10.1 自动写入事件类型（Episodic Memory）
# ─────────────────────────────────────────────

AUTO_WRITE_EVENT_TYPES = {
    "night_wandering",
    "medication_refusal",
    "home_seeking",
    "caregiver_distress",
    "sleep_disruption",
    "agitation",
    "suspicion",
}

# ─────────────────────────────────────────────
# 10.3 禁止写入的医疗结论关键词
# ─────────────────────────────────────────────

_FORBIDDEN_CONTENT_KEYWORDS = [
    "药物导致",
    "病情加重",
    "抑郁症",
    "确诊",
    "处方",
    "诊断为",
    "需要手术",
    "疾病进展",
]


def should_auto_write(event: dict[str, Any]) -> bool:
    """判断该事件是否可以自动写入 Episodic Memory（无需用户确认）"""
    return event.get("event_type") in AUTO_WRITE_EVENT_TYPES


def contains_forbidden_content(text: str) -> bool:
    """检查文本是否含有不可写入 Memory 的医疗结论性内容"""
    for kw in _FORBIDDEN_CONTENT_KEYWORDS:
        if kw in text:
            return True
    return False


def sanitize_for_memory(content: str) -> str:
    """
    将可能含有越界医疗结论的内容改写为观察性表述。
    简单规则版本：在内容末尾附加观察声明。
    """
    if contains_forbidden_content(content):
        return f"[观察线索，非医疗结论] {content}。建议持续记录并在复诊时与医生讨论。"
    return content


def classify_memory_candidates(
    candidates: list[dict[str, Any]],
) -> dict[str, list[dict[str, Any]]]:
    """
    将候选 Memory 更新分类为：
    - auto_write: 可自动写入
    - needs_confirmation: 需要用户确认
    - blocked: 禁止写入（含医疗结论）
    """
    auto_write = []
    needs_confirmation = []
    blocked = []

    for item in candidates:
        content = item.get("content", "")
        if contains_forbidden_content(content):
            blocked.append(item)
        elif item.get("auto_confirm", False):
            auto_write.append(item)
        else:
            needs_confirmation.append(item)

    return {
        "auto_write": auto_write,
        "needs_confirmation": needs_confirmation,
        "blocked": blocked,
    }


def build_confirmation_prompt(candidates: list[dict[str, Any]]) -> str:
    """
    为需要用户确认的候选 Memory 生成提示语。
    """
    if not candidates:
        return ""
    lines = ["\n[CareMind Memory 建议]"]
    for i, item in enumerate(candidates, 1):
        suggestion = item.get("suggestion") or f"是否将以下内容记录为长期记忆：{item.get('content', '')}"
        lines.append(f"{i}. {suggestion}")
    lines.append("（如需记录，请告知 CareMind 确认。）")
    return "\n".join(lines)
