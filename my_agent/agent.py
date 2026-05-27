import os
from dotenv import load_dotenv
from google.adk.agents.llm_agent import Agent
from .cloudflare_openai_model import CloudflareOpenAIModel

# 加载 .env 文件
load_dotenv()

# Cloudflare AI Gateway / OpenAI-compatible endpoint.
CF_AIG_BASE_URL = os.getenv(
    "CF_AIG_BASE_URL",
    "https://gateway.ai.cloudflare.com/v1/bbd869342ef49cfea41170378427db5d/default/compat",
)
CF_AIG_TOKEN = os.getenv("CF_AIG_TOKEN")
MODEL_NAME = os.getenv("MODEL_NAME", "google-ai-studio/gemma-4-31b-it")

# Backward compatibility for the old relay env names.
MODEL_BASE_URL = (
    os.getenv("MODEL_BASE_URL") or os.getenv("RAGFLOW_BASE_URL") or CF_AIG_BASE_URL
)
EXPLICIT_MODEL_API_KEY = os.getenv("MODEL_API_KEY") or os.getenv("RAGFLOW_API_KEY")
MODEL_API_KEY = EXPLICIT_MODEL_API_KEY or CF_AIG_TOKEN
MODEL_CF_AIG_TOKEN = CF_AIG_TOKEN if EXPLICIT_MODEL_API_KEY else None
PROMPT_MODE = os.getenv("PROMPT_MODE", "WEAK")

# 定义本地工具
from .tools import ALL_TOOLS

SYSTEM_INSTRUCTION_WEAK = "你是一个有帮助的助手。请用中文简洁回答用户。必要时可以调用工具。"
SYSTEM_INSTRUCTION_STRONG = "你是一个有帮助的助手。请用中文回答用户，并在需要时调用工具来获取更准确的信息。"

def get_system_instruction() -> str:

    return SYSTEM_INSTRUCTION_WEAK if PROMPT_MODE == "WEAK" else SYSTEM_INSTRUCTION_STRONG

root_agent = Agent(
    model=CloudflareOpenAIModel(
        model=MODEL_NAME,
        api_base=MODEL_BASE_URL,
        api_key=MODEL_API_KEY,
        cf_aig_token=MODEL_CF_AIG_TOKEN,
    ),
    description="一个中文助手，可以查询北京时间、上证指数等信息。",
    name="SimpleAgent",
    instruction=get_system_instruction(),
    tools=ALL_TOOLS
)
