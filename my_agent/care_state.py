import json
import os
import threading
from datetime import datetime
from typing import Any


class CareStateManager:
    """Small JSON-backed cloud-side care memory for the ADK demo."""

    def __init__(self):
        self.base_dir = os.getenv("CARE_STATE_DIR", "/tmp/caremind")
        self.file_path = os.path.join(self.base_dir, "care_state.json")
        self.lock = threading.Lock()
        os.makedirs(self.base_dir, exist_ok=True)
        if not os.path.exists(self.file_path):
            self._save(self._initial_state())

    def _initial_state(self) -> dict[str, Any]:
        return {
            "patients": {
                "demo_patient": {
                    "profile": {
                        "name": "演示患者",
                        "diagnosis": "失智症/阿尔兹海默病家庭照护场景",
                        "baseline": {
                            "sleep": "夜间偶有起床",
                            "behavior": "黄昏时更容易反复表达想回家",
                            "communication": "共情、转移注意力比直接纠正更有效",
                        },
                    },
                    "events": [],
                    "risk_cards": [],
                    "care_plans": [],
                    "reminders": [],
                }
            },
            "caregivers": {
                "demo_caregiver": {
                    "profile": {"role": "家庭主要照护者"},
                    "support_cards": [],
                }
            },
            "last_update_time": "",
        }

    def _read(self) -> dict[str, Any]:
        with self.lock:
            with open(self.file_path, "r", encoding="utf-8") as f:
                return json.load(f)

    def _save(self, data: dict[str, Any]) -> None:
        data["last_update_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with self.lock:
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)

    def get_state(self) -> dict[str, Any]:
        return self._read()

    def ensure_patient(self, patient_id: str) -> None:
        data = self._read()
        if patient_id not in data["patients"]:
            data["patients"][patient_id] = {
                "profile": {"name": patient_id, "baseline": {}},
                "events": [],
                "risk_cards": [],
                "care_plans": [],
                "reminders": [],
            }
            self._save(data)

    def add_event(self, patient_id: str, event: dict[str, Any]) -> dict[str, Any]:
        data = self._read()
        if patient_id not in data["patients"]:
            data["patients"][patient_id] = {
                "profile": {"name": patient_id, "baseline": {}},
                "events": [],
                "risk_cards": [],
                "care_plans": [],
                "reminders": [],
            }
        event = dict(event)
        event.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        data["patients"][patient_id]["events"].append(event)
        self._save(data)
        return event

    def add_patient_risk(self, patient_id: str, card: dict[str, Any]) -> dict[str, Any]:
        data = self._read()
        data["patients"].setdefault(patient_id, {
            "profile": {"name": patient_id, "baseline": {}},
            "events": [],
            "risk_cards": [],
            "care_plans": [],
            "reminders": [],
        })
        card.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        data["patients"][patient_id]["risk_cards"].append(card)
        self._save(data)
        return card

    def add_caregiver_card(
        self, caregiver_id: str, card: dict[str, Any]
    ) -> dict[str, Any]:
        data = self._read()
        data["caregivers"].setdefault(
            caregiver_id, {"profile": {"role": "照护者"}, "support_cards": []}
        )
        card.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        data["caregivers"][caregiver_id]["support_cards"].append(card)
        self._save(data)
        return card

    def add_care_plan(self, patient_id: str, plan: dict[str, Any]) -> dict[str, Any]:
        data = self._read()
        plan.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        data["patients"][patient_id]["care_plans"].append(plan)
        self._save(data)
        return plan

    def add_reminder(self, patient_id: str, reminder: dict[str, Any]) -> dict[str, Any]:
        data = self._read()
        reminder.setdefault("created_at", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
        data["patients"][patient_id]["reminders"].append(reminder)
        self._save(data)
        return reminder


care_state = CareStateManager()
