import unittest
from datetime import datetime, timezone

from fastapi import HTTPException

import main


class FakeBlob:
    size = 1234
    updated = datetime(2026, 6, 12, tzinfo=timezone.utc)

    def generate_signed_url(self, **_kwargs):
        return "https://storage.googleapis.com/caremind-test/models/gemma.bin?X-Goog-Signature=redacted"


class ModelDownloadDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.original_bucket = main.GEMMA_GCS_MODEL_BUCKET
        self.original_delivery = main.GEMMA_GCS_MODEL_DELIVERY
        self.original_allow_proxy = main.GEMMA_ALLOW_MODEL_PROXY
        self.original_remote_token = main.GEMMA_MODEL_REMOTE_TOKEN
        self.original_get_blob = main._get_gcs_blob_for_model

        main.GEMMA_GCS_MODEL_BUCKET = "caremind-test"
        main.GEMMA_GCS_MODEL_DELIVERY = "proxy"
        main.GEMMA_ALLOW_MODEL_PROXY = False
        main.GEMMA_MODEL_REMOTE_TOKEN = None
        main._get_gcs_blob_for_model = lambda _filename: FakeBlob()

    def tearDown(self):
        main.GEMMA_GCS_MODEL_BUCKET = self.original_bucket
        main.GEMMA_GCS_MODEL_DELIVERY = self.original_delivery
        main.GEMMA_ALLOW_MODEL_PROXY = self.original_allow_proxy
        main.GEMMA_MODEL_REMOTE_TOKEN = self.original_remote_token
        main._get_gcs_blob_for_model = self.original_get_blob

    def test_gcs_download_info_uses_signed_url_even_when_env_says_proxy(self):
        info = main._gcs_download_info("gemma-4-E2B-it.litertlm")

        self.assertEqual(info["source"], "gcs-signed-url")
        self.assertFalse(info["via_backend_proxy"])
        self.assertEqual(info["url_host"], "storage.googleapis.com")
        self.assertEqual(info["size_bytes"], 1234)

    def test_remote_direct_does_not_require_backend_proxy_when_public(self):
        info = main._remote_download_info("gemma-4-E2B-it.litertlm")

        self.assertEqual(info["source"], "remote-direct")
        self.assertFalse(info["via_backend_proxy"])
        self.assertEqual(info["url_host"], "huggingface.co")

    def test_remote_auth_source_is_rejected_without_leaking_token(self):
        main.GEMMA_MODEL_REMOTE_TOKEN = "secret-token-that-must-not-leak"

        with self.assertRaises(HTTPException) as ctx:
            main._remote_download_info("gemma-4-E2B-it.litertlm")

        self.assertEqual(ctx.exception.status_code, 401)
        self.assertNotIn("secret-token", str(ctx.exception.detail))
        self.assertIn("不能安全直连", str(ctx.exception.detail))


if __name__ == "__main__":
    unittest.main()
