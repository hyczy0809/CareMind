import os

from dotenv import load_dotenv

from .cloudflare_openai_model import CloudflareOpenAIModel

load_dotenv()

CF_AIG_BASE_URL = os.getenv(
    "CF_AIG_BASE_URL",
    "https://gateway.ai.cloudflare.com/v1/bbd869342ef49cfea41170378427db5d/default/compat",
)
CF_AIG_TOKEN = os.getenv("CF_AIG_TOKEN")
MODEL_NAME = os.getenv("MODEL_NAME", "google-ai-studio/gemini-2.5-flash")

MODEL_BASE_URL = (
    os.getenv("MODEL_BASE_URL") or os.getenv("RAGFLOW_BASE_URL") or CF_AIG_BASE_URL
)
EXPLICIT_MODEL_API_KEY = os.getenv("MODEL_API_KEY") or os.getenv("RAGFLOW_API_KEY")
MODEL_API_KEY = EXPLICIT_MODEL_API_KEY or CF_AIG_TOKEN
MODEL_CF_AIG_TOKEN = CF_AIG_TOKEN if EXPLICIT_MODEL_API_KEY else None


def build_model() -> CloudflareOpenAIModel:
    return CloudflareOpenAIModel(
        model=MODEL_NAME,
        api_base=MODEL_BASE_URL,
        api_key=MODEL_API_KEY,
        cf_aig_token=MODEL_CF_AIG_TOKEN,
    )
