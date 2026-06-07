"""
OpenAI API 兼容层
将 ADK Agent 包装成符合 OpenAI API 规范的接口
"""
import time
import uuid
import logging
import sys
import os
from typing import AsyncGenerator, List, Optional

# 配置日志到文件和控制台
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('debug.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field
from google.genai import types


# =========================
# OpenAI API 数据模型
# =========================


class ChatMessage(BaseModel):
    """OpenAI ChatMessage 格式"""
    role: str = Field(..., description="消息角色: system, user, assistant, tool")
    content: str = Field(..., description="消息内容")
    tool_calls: Optional[List[dict]] = Field(None, description="工具调用列表")
    tool_call_id: Optional[str] = Field(None, description="工具调用ID")


class ChatCompletionRequest(BaseModel):
    """OpenAI ChatCompletion 请求格式"""
    model: str = Field(..., description="模型名称")
    messages: List[ChatMessage] = Field(..., description="对话消息列表")
    temperature: Optional[float] = Field(0.7, description="温度参数")
    max_tokens: Optional[int] = Field(None, description="最大token数")
    stream: Optional[bool] = Field(False, description="是否使用流式响应")
    top_p: Optional[float] = Field(1.0, description="top_p采样参数")
    frequency_penalty: Optional[float] = Field(0.0, description="频率惩罚")
    presence_penalty: Optional[float] = Field(0.0, description="存在惩罚")


class ChatCompletionToolCall(BaseModel):
    """工具调用对象"""
    id: str
    type: str = "function"
    function: dict


class ChatCompletionChoice(BaseModel):
    """ChatCompletion 选择项"""
    index: int
    message: dict
    finish_reason: str


class ChatCompletionUsage(BaseModel):
    """Token 使用统计"""
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    """OpenAI ChatCompletion 响应格式"""
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: List[ChatCompletionChoice]
    usage: Optional[ChatCompletionUsage] = None


class ChatCompletionStreamChunk(BaseModel):
    """流式响应数据块"""
    id: str
    object: str = "chat.completion.chunk"
    created: int
    model: str
    choices: List[dict]


# =========================
# OpenAI 兼容服务类
# =========================


class OpenAICompatService:
    """OpenAI 兼容服务 - 使用 ADK Runner"""

    def __init__(self, agent, session_service, app_name: str = "my_agent"):
        """
        初始化 OpenAI 兼容服务

        Args:
            agent: ADK Agent 实例
            session_service: ADK 会话服务（必须与 ADK 使用相同的实例）
            app_name: agent 名称（用于标识）
        """
        from google.adk.runners import Runner
        from google.adk.memory.in_memory_memory_service import InMemoryMemoryService
        from google.adk.artifacts.in_memory_artifact_service import InMemoryArtifactService

        # 创建 Runner 实例
        self.runner = Runner(
            app_name=app_name,
            agent=agent,
            session_service=session_service,
            artifact_service=InMemoryArtifactService(),
            memory_service=InMemoryMemoryService(),
        )
        self.session_service = session_service
        self.app_name = app_name

    def _get_user_message(self, messages: List[ChatMessage]) -> str:
        """
        从 OpenAI 格式的消息列表中提取最新的用户消息

        Args:
            messages: OpenAI 格式的消息列表

        Returns:
            str: 用户消息内容
        """
        if not messages:
            return ""

        # 获取最后一条用户消息
        for msg in reversed(messages):
            if msg.role == "user":
                return msg.content

        # 如果没有用户消息，返回最后一条消息
        return messages[-1].content if messages else ""

    async def chat_completion(
        self,
        request: ChatCompletionRequest,
        session_id: Optional[str] = None,
        user_id: str = "default"
    ) -> ChatCompletionResponse:
        """
        处理非流式 ChatCompletion 请求

        Args:
            request: OpenAI ChatCompletion 请求
            session_id: 会话ID（用于多轮对话）
            user_id: 用户ID

        Returns:
            ChatCompletionResponse: OpenAI 格式的响应
        """
        # 提取用户消息
        user_message = self._get_user_message(request.messages)

        # 生成唯一的 session_id
        actual_session_id = session_id or str(uuid.uuid4())

        # 创建 Content 对象
        new_message = types.Content(role="user", parts=[types.Part(text=user_message)])

        response_content = ""

        try:
            # 确保会话存在
            from google.adk.sessions import Session
            session = None
            try:
                # 尝试获取会话 - 使用关键字参数
                logger.info(f"[DEBUG] Getting session: {actual_session_id}")
                session = await self.session_service.get_session(
                    app_name=self.app_name,
                    user_id=user_id,
                    session_id=actual_session_id
                )
                logger.info(f"[DEBUG] Session found")
            except Exception as e:
                # 会话不存在，创建新会话
                logger.info(f"[DEBUG] Session not found: {e}")
                pass

            # 只有在会话不存在时才创建
            if session is None:
                logger.info(f"[DEBUG] Creating new session: {actual_session_id}")
                await self.session_service.create_session(
                    app_name=self.app_name,
                    user_id=user_id,
                    session_id=actual_session_id
                )
                logger.info(f"[DEBUG] Session created")

            logger.info(f"[DEBUG] Running agent...")

            # 使用 Runner 运行 agent
            async for event in self.runner.run_async(
                user_id=user_id,
                session_id=actual_session_id,
                new_message=new_message
            ):
                # 提取响应内容
                content = self._extract_content_from_event(event)
                if content:
                    response_content += content


        except Exception as e:
            # 如果出错，返回错误信息
            import traceback
            traceback.print_exc()
            raise HTTPException(
                status_code=500,
                detail=f"Agent 调用失败: {str(e)}"
            )

        # 构建 OpenAI 格式响应
        completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        created = int(time.time())

        return ChatCompletionResponse(
            id=completion_id,
            created=created,
            model=request.model,
            choices=[
                ChatCompletionChoice(
                    index=0,
                    message={
                        "role": "assistant",
                        "content": response_content
                    },
                    finish_reason="stop"
                )
            ],
            usage=ChatCompletionUsage(
                prompt_tokens=sum(len(m.content or "") for m in request.messages) // 4,
                completion_tokens=len(response_content) // 4,
                total_tokens=(sum(len(m.content or "") for m in request.messages) + len(response_content)) // 4
            )
        )

    async def chat_completion_stream(
        self,
        request: ChatCompletionRequest,
        session_id: Optional[str] = None,
        user_id: str = "default"
    ) -> AsyncGenerator[str, None]:
        """
        处理流式 ChatCompletion 请求

        Args:
            request: OpenAI ChatCompletion 请求
            session_id: 会话ID
            user_id: 用户ID

        Yields:
            str: SSE 格式的流式数据
        """
        import json

        # 提取用户消息
        user_message = self._get_user_message(request.messages)

        # 生成唯一的 session_id
        actual_session_id = session_id or str(uuid.uuid4())

        # 创建 Content 对象
        new_message = types.Content(role="user", parts=[types.Part(text=user_message)])

        completion_id = f"chatcmpl-{uuid.uuid4().hex[:24]}"
        created = int(time.time())

        try:
            # 确保会话存在
            from google.adk.sessions import Session
            session = None
            try:
                # 尝试获取会话 - 使用关键字参数
                logger.info(f"[DEBUG STREAM] Getting session: {actual_session_id}")
                session = await self.session_service.get_session(
                    app_name=self.app_name,
                    user_id=user_id,
                    session_id=actual_session_id
                )
                logger.info(f"[DEBUG STREAM] Session found")
            except Exception as e:
                # 会话不存在，创建新会话
                logger.info(f"[DEBUG STREAM] Session not found: {e}")
                pass

            # 只有在会话不存在时才创建
            if session is None:
                logger.info(f"[DEBUG STREAM] Creating new session: {actual_session_id}")
                await self.session_service.create_session(
                    app_name=self.app_name,
                    user_id=user_id,
                    session_id=actual_session_id
                )
                logger.info(f"[DEBUG STREAM] Session created")

            logger.info(f"[DEBUG STREAM] Running agent...")

            # 使用 Runner 运行 agent
            async for event in self.runner.run_async(
                user_id=user_id,
                session_id=actual_session_id,
                new_message=new_message
            ):
                # 提取内容
                content = self._extract_content_from_event(event)
                if content:
                    # 构建流式响应块
                    chunk_data = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": request.model,
                        "choices": [{
                            "index": 0,
                            "delta": {"content": content},
                            "finish_reason": None
                        }]
                    }

                    # 输出 SSE 格式
                    yield f"data: {json.dumps(chunk_data, ensure_ascii=False)}\n\n"

        except Exception as e:
            # 输出错误
            import traceback
            traceback.print_exc()
            chunk_data = {
                "id": completion_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": request.model,
                "choices": [{
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }]
            }
            yield f"data: {json.dumps(chunk_data, ensure_ascii=False)}\n\n"

        # 发送结束标记
        final_chunk = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": request.model,
            "choices": [{
                "index": 0,
                "delta": {},
                "finish_reason": "stop"
            }]
        }
        yield f"data: {json.dumps(final_chunk, ensure_ascii=False)}\n\n"
        yield f"data: [DONE]\n\n"

    def _extract_content_from_event(self, event) -> str:
        """
        从 ADK Event 中提取文本内容

        Args:
            event: ADK Event 对象

        Returns:
            str: 提取的文本内容
        """
        if event is None:
            return ""

        content_parts = []

        # 尝试获取内容
        if hasattr(event, 'content') and event.content:
            for part in event.content.parts:
                if hasattr(part, 'text') and part.text:
                    content_parts.append(str(part.text))

        # 尝试获取增量内容
        if hasattr(event, 'delta') and event.delta:
            for part in event.delta.parts:
                if hasattr(part, 'text') and part.text:
                    content_parts.append(str(part.text))

        return "".join(content_parts)

    def _is_final_event(self, event) -> bool:
        """
        检查事件是否为最终事件

        Args:
            event: ADK Event 对象

        Returns:
            bool: 是否为最终事件
        """
        if event is None:
            return False

        # ADK events always carry an actions object; use the ADK final-response
        # helper so tool-call/tool-response events are not treated as completion.
        if hasattr(event, 'is_final_response'):
            return event.is_final_response()

        # 检查是否有 turn_complete
        if hasattr(event, 'turn_complete'):
            return event.turn_complete

        return False


# =========================
# FastAPI 路由助手函数
# =========================


def setup_openai_routes(app, agent, session_service, app_name: str = "my_agent"):
    """
    设置 OpenAI 兼容的路由

    Args:
        app: FastAPI 应用实例
        agent: ADK Agent 实例
        session_service: ADK 会话服务（必须与 ADK 使用相同的实例）
        app_name: agent 名称
    """
    service = OpenAICompatService(agent, session_service, app_name)

    @app.post("/v1/chat/completions")
    async def create_chat_completion(
        request: ChatCompletionRequest,
        http_request: Request
    ):
        """
        OpenAI ChatCompletions API 兼容端点

        支持:
        - 非流式响应 (stream=false)
        - 流式响应 (stream=true)
        - 多轮对话（通过 session_id）
        """
        # 从请求头获取 session_id 和 user_id
        session_id = http_request.headers.get("X-Session-ID")
        user_id = http_request.headers.get("X-User-ID", "default")

        # 添加日志 - 使用文件确保输出
        log_path = os.path.join(os.getenv("CAREMIND_RUNTIME_DIR", "/tmp/caremind"), "request_log.txt")
        os.makedirs(os.path.dirname(log_path), exist_ok=True)
        with open(log_path, 'a', encoding='utf-8') as f:
            f.write(f"[{time.time()}] Received: session={session_id}, user={user_id}, stream={request.stream}\n")

        logger.info(f"=== Received request: session_id={session_id}, user_id={user_id}, stream={request.stream} ===")

        # 检查是否为流式请求
        is_streaming = request.stream

        if is_streaming:
            # 流式响应
            from fastapi.responses import StreamingResponse

            async def generate():
                async for chunk in service.chat_completion_stream(
                    request, session_id, user_id
                ):
                    yield chunk

            return StreamingResponse(
                generate(),
                media_type="text/event-stream",
                headers={
                    "Cache-Control": "no-cache",
                    "Connection": "keep-alive",
                }
            )
        else:
            # 非流式响应
            return await service.chat_completion(request, session_id, user_id)

    @app.get("/v1/models")
    async def list_models():
        """
        列出可用模型（OpenAI API 兼容）
        """
        return {
            "object": "list",
            "data": [
                {
                    "id": app_name,
                    "object": "model",
                    "created": int(time.time()),
                    "owned_by": "adk-agent"
                },
                {
                    "id": os.getenv("MODEL_NAME", "google-ai-studio/gemma-4-31b-it"),
                    "object": "model",
                    "created": int(time.time()),
                    "owned_by": "google"
                }
            ]
        }

    @app.get("/health")
    async def health_check():
        """健康检查端点"""
        return {"status": "healthy", "service": "openai-compatible-api"}

    @app.get("/debug/session/{session_id}")
    async def debug_session(session_id: str):
        """调试端点：检查会话状态"""
        try:
            session = await service.session_service.get_session(session_id)
            return {
                "session_id": session_id,
                "found": True,
                "session": str(session)
            }
        except Exception as e:
            return {
                "session_id": session_id,
                "found": False,
                "error": str(e)
            }
