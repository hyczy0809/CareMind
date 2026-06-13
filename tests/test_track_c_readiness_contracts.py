import re
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MODEL_MANAGER = ROOT / "frontend/lib/inference/local/model-manager.ts"
OFFLINE_VERIFICATION = ROOT / "frontend/lib/inference/offline-verification.ts"
SMART_LOG = ROOT / "frontend/components/log/SmartLogScreen.tsx"
PRIVACY_CARD = ROOT / "frontend/components/settings/PrivacyModeCard.tsx"
ANDROID_DOWNLOADER = ROOT / "frontend/android/app/src/main/java/com/caremind/app/gemma/GemmaModelDownloader.kt"


class TrackCReadinessContractTests(unittest.TestCase):
    def test_model_status_machine_contains_strict_readiness_states(self):
        source = MODEL_MANAGER.read_text()
        for status in [
            "not_downloaded",
            "downloading",
            "download_failed",
            "downloaded",
            "validating",
            "validation_failed",
            "initializing",
            "ready",
            "runtime_failed",
        ]:
            self.assertIn(f'"{status}"', source)

    def test_download_does_not_mark_model_ready_without_smoke(self):
        source = MODEL_MANAGER.read_text()
        download_fn = re.search(r"export async function downloadModel[\s\S]+?export async function importDebugModel", source)
        self.assertIsNotNone(download_fn)
        self.assertIn('status: "downloaded"', download_fn.group(0))
        self.assertNotIn('status: "ready"', download_fn.group(0))

    def test_smoke_pass_requires_native_output_hash_and_native_source(self):
        source = MODEL_MANAGER.read_text()
        smoke_fn = re.search(r"export async function runLocalGemmaSmokeTest[\s\S]+?export async function preloadSelectedEngine", source)
        self.assertIsNotNone(smoke_fn)
        body = smoke_fn.group(0)
        self.assertIn('result.source === "native_litertlm_success"', body)
        self.assertIn("rawText.trim().length > 0", body)
        self.assertIn("!!rawHash", body)
        self.assertIn('status: passed ? "ready" : "runtime_failed"', body)

    def test_track_c_verification_fails_rule_fallback_for_ordinary_tasks(self):
        source = OFFLINE_VERIFICATION.read_text()
        native_status = re.search(r"function nativeStatus[\s\S]+?\n}", source)
        self.assertIsNotNone(native_status)
        self.assertIn('return "failed";', native_status.group(0))
        self.assertIn('id: "daily_log"', source)
        self.assertIn('id: "communication_simple"', source)

    def test_medical_boundary_still_uses_rule_local_fallback_by_design(self):
        source = OFFLINE_VERIFICATION.read_text()
        self.assertIn('id: "medical_boundary_guardrail"', source)
        self.assertIn('source: "rule_local_fallback"', source)
        self.assertIn('"rules_local_medical_boundary"', source)

    def test_ui_exposes_real_smoke_test_and_clear_fallback_warning(self):
        privacy = PRIVACY_CARD.read_text()
        smart_log = SMART_LOG.read_text()
        self.assertIn("运行本地 Gemma smoke test", privacy)
        self.assertIn("validation=", privacy)
        self.assertIn("runtime=", privacy)
        self.assertIn("smoke=", privacy)
        self.assertIn("不代表 Gemma 4 / LiteRT-LM 真实推理", smart_log)

    def test_android_debug_model_path_and_import_are_supported(self):
        source = ANDROID_DOWNLOADER.read_text()
        self.assertIn('/data/local/tmp/llm/gemma.litertlm', source)
        self.assertIn("copyDebugModelIntoAppPrivate", source)


if __name__ == "__main__":
    unittest.main()
