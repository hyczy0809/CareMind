"""
CareMind Memory State
管理所有 Memory JSON 文件的读写，对应 CareMind_Memory.md 第 15.1 节（本地 JSON 版本）。

memory_store/ 目录结构：
  patient_profile.json      — 患者画像
  medication_memory.json    — 用药记录
  behavior_baseline.json    — 行为基线
  episodic_events.json      — 情节事件流水
  caregiver_state.json      — 照护者状态
"""
import json
import os
import threading
from datetime import datetime, timedelta
from typing import Any

from .memory_schema import (
    default_behavior_baseline,
    default_caregiver_state,
    default_medication_memory,
    default_patient_profile,
)

_STORE_DIR = os.getenv("CAREMIND_MEMORY_DIR", "/tmp/caremind/memory_store")
_lock = threading.Lock()


# ─────────────────────────────────────────────
# 内部 I/O 工具
# ─────────────────────────────────────────────

def _ensure_store() -> None:
    os.makedirs(_STORE_DIR, exist_ok=True)


def _path(filename: str) -> str:
    _ensure_store()
    return os.path.join(_STORE_DIR, filename)


def _read_json(filename: str, default: Any) -> Any:
    p = _path(filename)
    if not os.path.exists(p):
        return default
    with _lock:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)


def _write_json(filename: str, data: Any) -> None:
    with _lock:
        with open(_path(filename), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)


# ─────────────────────────────────────────────
# Patient Profile Memory
# ─────────────────────────────────────────────

def read_patient_profile(patient_id: str) -> dict[str, Any]:
    db = _read_json("patient_profile.json", {})
    if patient_id not in db:
        db[patient_id] = default_patient_profile(patient_id)
        _write_json("patient_profile.json", db)
    return db[patient_id]


def write_patient_profile(patient_id: str, profile: dict[str, Any]) -> dict[str, Any]:
    db = _read_json("patient_profile.json", {})
    profile["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db[patient_id] = profile
    _write_json("patient_profile.json", db)
    return profile


def update_patient_profile_fields(
    patient_id: str, updates: dict[str, Any]
) -> dict[str, Any]:
    """深度合并更新患者画像字段（不覆盖整个文档）"""
    profile = read_patient_profile(patient_id)
    _deep_merge(profile, updates)
    return write_patient_profile(patient_id, profile)


# ─────────────────────────────────────────────
# Medication Memory
# ─────────────────────────────────────────────

def read_medication_memory(patient_id: str) -> dict[str, Any]:
    db = _read_json("medication_memory.json", {})
    if patient_id not in db:
        db[patient_id] = default_medication_memory(patient_id)
        _write_json("medication_memory.json", db)
    return db[patient_id]


def append_medication_event(patient_id: str, event: dict[str, Any]) -> dict[str, Any]:
    db = _read_json("medication_memory.json", {})
    if patient_id not in db:
        db[patient_id] = default_medication_memory(patient_id)
    event.setdefault("time", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    db[patient_id]["medication_events"].append(event)
    db[patient_id]["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _write_json("medication_memory.json", db)
    return event


# ─────────────────────────────────────────────
# Behavior Baseline Memory
# ─────────────────────────────────────────────

def read_behavior_baseline(patient_id: str) -> dict[str, Any]:
    db = _read_json("behavior_baseline.json", {})
    if patient_id not in db:
        db[patient_id] = default_behavior_baseline(patient_id)
        _write_json("behavior_baseline.json", db)
    return db[patient_id]


def get_behavior_entries(
    patient_id: str, event_types: list[str]
) -> dict[str, Any]:
    """按事件类型过滤行为基线条目"""
    baseline = read_behavior_baseline(patient_id)
    matched = {
        entry["behavior_type"]: entry
        for entry in baseline.get("behavior_baselines", [])
        if entry["behavior_type"] in event_types
    }
    return matched


def upsert_behavior_entry(patient_id: str, entry: dict[str, Any]) -> dict[str, Any]:
    """插入或更新某个行为类型的基线条目"""
    db = _read_json("behavior_baseline.json", {})
    if patient_id not in db:
        db[patient_id] = default_behavior_baseline(patient_id)
    baselines = db[patient_id]["behavior_baselines"]
    for i, b in enumerate(baselines):
        if b["behavior_type"] == entry["behavior_type"]:
            baselines[i] = entry
            db[patient_id]["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            _write_json("behavior_baseline.json", db)
            return entry
    baselines.append(entry)
    db[patient_id]["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _write_json("behavior_baseline.json", db)
    return entry


# ─────────────────────────────────────────────
# Episodic Event Memory
# ─────────────────────────────────────────────

def append_episodic_events(
    patient_id: str, events: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """将一批照护事件写入情节记忆流水"""
    db = _read_json("episodic_events.json", {})
    if patient_id not in db:
        db[patient_id] = []
    for ev in events:
        ev.setdefault("timestamp", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        db[patient_id].append(ev)
    _write_json("episodic_events.json", db)
    return events


def get_recent_episodic_events(
    patient_id: str,
    days: int = 7,
    event_types: list[str] | None = None,
) -> list[dict[str, Any]]:
    """读取最近 N 天的情节事件；可按事件类型过滤"""
    db = _read_json("episodic_events.json", {})
    all_events = db.get(patient_id, [])
    cutoff = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d %H:%M:%S")
    recent = [e for e in all_events if e.get("timestamp", "") >= cutoff]
    if event_types:
        recent = [e for e in recent if e.get("event_type") in event_types]
    return recent


def get_similar_events(
    patient_id: str,
    current_event_types: list[str],
    top_k: int = 3,
) -> list[dict[str, Any]]:
    """检索过去相似类型的事件（简单按类型匹配，返回最近 top_k 条）"""
    db = _read_json("episodic_events.json", {})
    all_events = db.get(patient_id, [])
    matched = [e for e in all_events if e.get("event_type") in current_event_types]
    return matched[-top_k:]


# ─────────────────────────────────────────────
# Caregiver State Memory
# ─────────────────────────────────────────────

def read_caregiver_state(caregiver_id: str) -> dict[str, Any]:
    db = _read_json("caregiver_state.json", {})
    if caregiver_id not in db:
        db[caregiver_id] = default_caregiver_state(caregiver_id)
        _write_json("caregiver_state.json", db)
    return db[caregiver_id]


def write_caregiver_state(
    caregiver_id: str, state_update: dict[str, Any]
) -> dict[str, Any]:
    db = _read_json("caregiver_state.json", {})
    if caregiver_id not in db:
        db[caregiver_id] = default_caregiver_state(caregiver_id)
    current = db[caregiver_id]
    # 保存历史快照
    snapshot = dict(current.get("recent_state", {}))
    snapshot["snapshot_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    current.setdefault("history", []).append(snapshot)
    # 更新当前状态
    _deep_merge(current["recent_state"], state_update)
    current["recent_state"]["last_updated"] = datetime.now().strftime("%Y-%m-%d")
    current["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    db[caregiver_id] = current
    _write_json("caregiver_state.json", db)
    return current


# ─────────────────────────────────────────────
# 工具函数
# ─────────────────────────────────────────────

def _deep_merge(base: dict, updates: dict) -> None:
    """递归合并 updates 到 base（原地修改 base）"""
    for k, v in updates.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_merge(base[k], v)
        elif isinstance(v, list) and isinstance(base.get(k), list):
            # 列表追加而非覆盖
            base[k].extend(v)
        else:
            base[k] = v
