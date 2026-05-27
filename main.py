import os

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

# =========================
# 创建共享的 Session Service
# =========================
from google.adk.sessions import InMemorySessionService

# 创建一个共享的 session service 实例
shared_session_service = InMemorySessionService()

# =========================
# 创建 FastAPI 应用
# =========================
app = FastAPI(title="ADK Agent with OpenAI Compatible API")

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# 导入并设置 Agent
# =========================
from my_agent.agent import root_agent

# =========================
# 设置 OpenAI 兼容路由（使用共享的 session_service）
# =========================
from openai_compat import setup_openai_routes

setup_openai_routes(
    app=app,
    agent=root_agent,
    session_service=shared_session_service,
    app_name="my_agent"
)

# =========================
# 添加根路径说明
# =========================
@app.get("/")
async def root():
    """根路径，返回 API 说明"""
    return {
        "message": "ADK Agent with OpenAI Compatible API",
        "endpoints": {
            "openai_api": "/v1/chat/completions",
            "models": "/v1/models",
            "health": "/health"
        },
        "openai_compat": {
            "endpoint": "POST /v1/chat/completions",
            "headers": {
                "Content-Type": "application/json",
                "X-Session-ID": "optional session ID for multi-turn conversations",
                "X-User-ID": "optional user ID (default: 'default')"
            },
            "example": {
                "model": "my_agent",
                "messages": [
                    {"role": "user", "content": "你好，今天天气怎么样？"}
                ],
                "stream": False
            }
        }
    }


if __name__ == "__main__":
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.environ.get("PORT", 8080)),
        reload=False
    )
