import unittest

from main import build_document_parse_result
from my_agent.care_workflow_schema import (
    AttentionItemV2,
    FollowupDocumentItemV2,
    FollowupSummaryRequest,
)
from my_agent.care_workflow_service import build_structured_log, generate_followup_summary


class Gemma4Phase3StructuredLogContractTests(unittest.TestCase):
    def test_structured_log_includes_confidence_and_diagnostic_risk_contract(self):
        log = build_structured_log(
            "妈妈昨晚半夜起床三次，我担心是不是病情恶化。",
            [],
            "2026-06-12T00:00:00+08:00",
        )

        self.assertTrue(log.field_confidence)
        self.assertIn("sleep", log.field_confidence)
        self.assertIn("behavior", log.low_confidence_fields)
        self.assertTrue(log.diagnostic_risk)
        self.assertTrue(any("医疗判断边界" in note for note in log.notes_for_caregiver))


class Gemma4Phase4FollowupSummaryContractTests(unittest.TestCase):
    def test_followup_summary_uses_full_window_and_marks_unreadable_documents(self):
        request = FollowupSummaryRequest(
            patient_id="patient_1",
            caregiver_id="caregiver_1",
            date_range="30d",
            record_count=12,
            attention_items=[
                AttentionItemV2(
                    id="att_1",
                    type="night_safety",
                    severity="high",
                    title="今晚留意夜间起床安全",
                    evidence="家属记录昨晚起床三次。",
                    doctor_feedback_hint="复诊时说明频率和场景。",
                    actions=[],
                )
            ],
            memory_items=[],
            followup_documents=[
                FollowupDocumentItemV2(
                    id="doc_1",
                    type="imaging_report",
                    status="reviewed",
                    title="模糊 CT 截图",
                    summary="截图模糊，无法确认原文。",
                    confirmed_items=["无法可靠读取该资料，请复诊时交给医生判断。"],
                    parse_quality="unreadable",
                    doctor_review_needed=True,
                    medical_term_candidates=["CT"],
                    safety_flags=["unreadable_document", "doctor_review_needed"],
                )
            ],
            caregiver_daily_metrics_trend={"sleep_hours": "low"},
            include_english_key_phrases=True,
        )

        response = generate_followup_summary(request)

        self.assertEqual(response.source_window_days, 30)
        self.assertEqual(response.model_profile, "cloud_31b_long_context")
        self.assertIn("模糊 CT 截图", response.unreadable_documents)
        self.assertIn("unreadable_document", response.safety_flags)
        self.assertIn("家属记录", response.summary_zh or "")
        self.assertNotIn("诊断", response.summary_zh or "")
        self.assertGreaterEqual(len(response.summary_zh or ""), 600)
        self.assertLessEqual(len(response.summary_zh or ""), 800)
        self.assertTrue(response.english_key_phrases)
        self.assertEqual(response.input_bundle_overview["source_window_days"], 30)

    def test_local_first_followup_summary_marks_cloud_consent_and_raw_text_restrictions(self):
        request = FollowupSummaryRequest(
            patient_id="patient_1",
            caregiver_id="caregiver_1",
            date_range="7d",
            record_count=4,
            attention_items=[],
            memory_items=[],
            followup_documents=[],
            cloud_summary_allowed=False,
            raw_text_upload_allowed=False,
        )

        response = generate_followup_summary(request)

        self.assertEqual(response.model_profile, "deterministic_fallback")
        self.assertIn("cloud_consent_required", response.safety_flags)
        self.assertIn("raw_text_restricted", response.safety_flags)
        self.assertFalse(response.input_bundle_overview["raw_text_upload_allowed"])


class Gemma4Phase5DocumentParsingContractTests(unittest.TestCase):
    def test_blurry_document_parse_requires_doctor_review_and_manual_fallback(self):
        parse_result = build_document_parse_result(
            {
                "document_id": "doc_blurry",
                "patient_id": "patient_1",
                "document_type": "imaging_report",
                "filename": "blurred_ct_report.png",
                "mime_type": "image/png",
                "file_size": 2048,
                "summary": "截图模糊看不清，报告提到 MRI 和 MMSE。",
            }
        )

        self.assertEqual(parse_result["parse_quality"], "unreadable")
        self.assertTrue(parse_result["doctor_review_needed"])
        self.assertFalse(parse_result["multimodal_attempted"])
        self.assertEqual(parse_result["model_profile"], "deterministic_fallback")
        self.assertIn("unreadable_document", parse_result["safety_flags"])
        self.assertTrue(parse_result["medical_term_candidates"])
        self.assertTrue(parse_result["requires_family_confirmation"])
        self.assertTrue(any("无法可靠读取" in item for item in parse_result["followup_summary_items"]))


if __name__ == "__main__":
    unittest.main()
