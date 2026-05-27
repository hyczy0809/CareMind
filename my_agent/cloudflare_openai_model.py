import json
from typing import Any, AsyncGenerator, Optional

import httpx
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.genai import types


class CloudflareOpenAIModel(BaseLlm):
    """ADK model adapter for Cloudflare AI Gateway OpenAI-compatible chat."""

    api_base: str
    api_key: Optional[str] = None
    cf_aig_token: Optional[str] = None
    timeout: float = 120.0

    @classmethod
    def supported_models(cls) -> list[str]:
        return [r".*"]

    async def generate_content_async(
        self, llm_request: LlmRequest, stream: bool = False
    ) -> AsyncGenerator[LlmResponse, None]:
        headers = {
            "Content-Type": "application/json",
        }
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.cf_aig_token:
            headers["cf-aig-authorization"] = f"Bearer {self.cf_aig_token}"

        payload = {
            "model": self.model,
            "messages": self._to_openai_messages(llm_request),
        }

        tools = self._to_openai_tools(llm_request)
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        generation_config = llm_request.config
        temperature = getattr(generation_config, "temperature", None)
        top_p = getattr(generation_config, "top_p", None)
        max_output_tokens = getattr(generation_config, "max_output_tokens", None)
        if temperature is not None:
            payload["temperature"] = temperature
        if top_p is not None:
            payload["top_p"] = top_p
        if max_output_tokens is not None:
            payload["max_tokens"] = max_output_tokens

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.api_base.rstrip('/')}/chat/completions",
                headers=headers,
                json=payload,
            )
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as exc:
                raise httpx.HTTPStatusError(
                    f"{exc}. Response body: {response.text}",
                    request=exc.request,
                    response=exc.response,
                ) from exc
            data = response.json()

        message = data["choices"][0]["message"]
        parts = self._message_to_parts(message)

        yield LlmResponse(
            content=types.Content(role="model", parts=parts),
            partial=False if stream else None,
            turn_complete=True if stream else None,
        )

    def _to_openai_messages(self, llm_request: LlmRequest) -> list[dict[str, Any]]:
        messages = []
        system_instruction = self._system_instruction_to_text(
            llm_request.config.system_instruction
        )
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})

        for content in llm_request.contents:
            converted = self._content_to_openai_messages(content)
            messages.extend(converted)

        if not messages or messages[-1]["role"] not in {"user", "tool"}:
            messages.append(
                {
                    "role": "user",
                    "content": "Continue processing previous requests as instructed.",
                }
            )

        return messages

    def _content_to_openai_messages(
        self, content: types.Content
    ) -> list[dict[str, Any]]:
        role = "assistant" if content.role == "model" else content.role
        text_parts = []
        tool_calls = []
        tool_messages = []

        for part in content.parts or []:
            if part.text:
                text_parts.append(part.text)
            elif part.function_call:
                function_call = part.function_call
                tool_calls.append(
                    {
                        "id": function_call.id or function_call.name,
                        "type": "function",
                        "function": {
                            "name": function_call.name,
                            "arguments": json.dumps(
                                function_call.args or {}, ensure_ascii=False
                            ),
                        },
                    }
                )
            elif part.function_response:
                function_response = part.function_response
                tool_messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": function_response.id
                        or function_response.name,
                        "content": json.dumps(
                            function_response.response or {}, ensure_ascii=False
                        ),
                    }
                )

        messages = []
        if text_parts or tool_calls:
            message = {
                "role": role,
                "content": "\n".join(text_parts) if text_parts else None,
            }
            if tool_calls:
                message["tool_calls"] = tool_calls
            messages.append(message)

        messages.extend(tool_messages)
        return messages

    def _to_openai_tools(self, llm_request: LlmRequest) -> list[dict[str, Any]]:
        tools = []
        for tool in llm_request.config.tools or []:
            for declaration in tool.function_declarations or []:
                tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": declaration.name,
                            "description": declaration.description or "",
                            "parameters": self._schema_to_dict(
                                declaration.parameters
                            )
                            or {"type": "object", "properties": {}},
                        },
                    }
                )
        return tools

    def _message_to_parts(self, message: dict[str, Any]) -> list[types.Part]:
        parts = []
        content = message.get("content")
        if content:
            parts.append(types.Part(text=content))

        for tool_call in message.get("tool_calls") or []:
            function = tool_call.get("function") or {}
            raw_args = function.get("arguments") or "{}"
            try:
                args = json.loads(raw_args)
            except json.JSONDecodeError:
                args = {"_raw_arguments": raw_args}
            parts.append(
                types.Part(
                    function_call=types.FunctionCall(
                        id=tool_call.get("id"),
                        name=function.get("name"),
                        args=args,
                    )
                )
            )

        return parts or [types.Part(text="")]

    def _system_instruction_to_text(self, instruction: Any) -> str:
        if not instruction:
            return ""
        if isinstance(instruction, str):
            return instruction
        if isinstance(instruction, types.Content):
            return "\n".join(part.text for part in instruction.parts or [] if part.text)
        return str(instruction)

    def _schema_to_dict(self, schema: Any) -> Optional[dict[str, Any]]:
        if schema is None:
            return None
        if isinstance(schema, dict):
            return schema
        if hasattr(schema, "model_dump"):
            return schema.model_dump(
                mode="json", by_alias=True, exclude_none=True
            )
        return None
