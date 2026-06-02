"""
CareMind MCP Knowledge Client
==============================
可插拔的外部 MCP 医疗知识源集成层。

核心设计原则：
1. 抽象 MCP 知识源接口，支持热插拔
2. 每个源独立配置 API key / endpoint
3. 本地缓存 + TTL，减少外部调用
4. 结果统一为 KnowledgeMemory Schema，向下兼容现有检索
5. 失败静默降级，不阻断主流程

已适配源：
- DrugBank MCP (https://mcp.drugbank.com/mcp)
  * drug_search      — 按名称/成分搜索药物
  * drug_interactions — 查询药物相互作用
  * drug_details     — 获取药物详情（适应症、副作用、注意事项）

Usage:
    from .mcp_knowledge_client import MCPKnowledgeHub

    hub = MCPKnowledgeHub.from_env()
    result = await hub.query("drugbank", "drug_search", {"query": "donepezil"})
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from dataclasses import dataclass, field
from typing import Any, ClassVar

import httpx


# ═══════════════════════════════════════════════════════════════
# Data Models
# ═══════════════════════════════════════════════════════════════

@dataclass
class ExternalKnowledgeResult:
    """统一外部知识返回格式，兼容 KnowledgeMemory schema 的 content 字段"""

    knowledge_id: str
    topic: str
    source: str              # 如 "drugbank_mcp"
    source_url: str          # MCP endpoint
    content: str             # 人类可读摘要
    raw_data: dict[str, Any] = field(default_factory=dict)  # 原始结构化数据
    applicable_when: list[str] = field(default_factory=list)
    safety_boundary: list[str] = field(default_factory=list)
    fetched_at: str = ""
    confidence: str = "medium"  # high / medium / low（取决于源权威性）


@dataclass
class MCPSourceConfig:
    """单个 MCP 知识源的配置"""

    source_id: str                    # 如 "drugbank"
    source_name: str                  # 如 "DrugBank"
    endpoint: str                     # 如 "https://mcp.drugbank.com/mcp"
    api_key_env: str                  # 环境变量名，如 "DRUGBANK_API_KEY"
    enabled_topics: list[str] = field(default_factory=list)  # 启用的话题域
    timeout: float = 15.0
    max_retries: int = 2
    cache_ttl_seconds: int = 3600     # 缓存 1 小时


# ═══════════════════════════════════════════════════════════════
# MCP Source Registry（可扩展）
# ═══════════════════════════════════════════════════════════════

# 在此注册所有 MCP 知识源
MCP_SOURCE_REGISTRY: dict[str, MCPSourceConfig] = {
    "drugbank": MCPSourceConfig(
        source_id="drugbank",
        source_name="DrugBank",
        endpoint="https://mcp.drugbank.com/mcp",
        api_key_env="DRUGBANK_API_KEY",
        enabled_topics=[
            "medication",                    # 药品信息
            "medication_refusal",            # 拒药场景 → 药品详情
            "drug_interactions",             # 药物相互作用
            "adverse_effects",               # 不良反应
            "dosage",                        # 剂量参考
            "polypharmacy",                  # 多重用药（老年常见）
        ],
        cache_ttl_seconds=3600,
    ),
    # 预留未来更多源：
    # "pubchem": MCPSourceConfig(...)
    # "openfda": MCPSourceConfig(...)
}


# ═══════════════════════════════════════════════════════════════
# MCP Knowledge Hub（核心调度器）
# ═══════════════════════════════════════════════════════════════

class MCPKnowledgeHub:
    """
    多源 MCP 知识调度中心。

    职责：
    - 管理多个 MCP 知识源的配置与生命周期
    - 根据话题路由查询到正确的源
    - 本地缓存 + TTL
    - 静默降级（单源失败不影响其他源）
    """

    def __init__(self, sources: dict[str, MCPSourceConfig] | None = None):
        self._sources = sources or {}
        self._cache: dict[str, tuple[float, list[ExternalKnowledgeResult]]] = {}

    # ── 工厂方法 ────────────────────────────────────────

    @classmethod
    def from_env(cls) -> "MCPKnowledgeHub":
        """从环境变量加载所有已配置的 MCP 源"""
        hub = cls()
        for source_id, config in MCP_SOURCE_REGISTRY.items():
            api_key = os.getenv(config.api_key_env)
            if api_key:
                hub.register_source(config)
            else:
                # 未配置 API key 的源跳过，不报错
                pass
        return hub

    def register_source(self, config: MCPSourceConfig) -> None:
        self._sources[config.source_id] = config

    def get_source(self, source_id: str) -> MCPSourceConfig | None:
        return self._sources.get(source_id)

    def list_available_sources(self) -> list[str]:
        return list(self._sources.keys())

    # ── 缓存 ─────────────────────────────────────────────

    def _cache_key(self, source_id: str, action: str, params_json: str) -> str:
        raw = f"{source_id}:{action}:{params_json}"
        return hashlib.sha256(raw.encode()).hexdigest()[:16]

    def _cache_get(self, key: str) -> list[ExternalKnowledgeResult] | None:
        entry = self._cache.get(key)
        if entry is None:
            return None
        cached_at, results = entry
        source_id = results[0].source if results else ""
        config = self._sources.get(source_id)
        ttl = config.cache_ttl_seconds if config else 3600
        if time.time() - cached_at < ttl:
            return results
        del self._cache[key]
        return None

    def _cache_set(self, key: str, results: list[ExternalKnowledgeResult]) -> None:
        self._cache[key] = (time.time(), results)

    # ── 核心查询接口 ────────────────────────────────────

    async def query(
        self,
        source_id: str,
        action: str,
        params: dict[str, Any],
        *,
        force_refresh: bool = False,
    ) -> list[ExternalKnowledgeResult]:
        """
        查询指定 MCP 知识源。

        Args:
            source_id: 源标识（如 "drugbank"）
            action:   操作名（如 "drug_search", "drug_interactions"）
            params:   查询参数
            force_refresh: 是否跳过缓存
        """
        config = self._sources.get(source_id)
        if config is None:
            return []

        params_json = json.dumps(params, sort_keys=True, ensure_ascii=False)
        cache_key = self._cache_key(source_id, action, params_json)

        if not force_refresh:
            cached = self._cache_get(cache_key)
            if cached is not None:
                return cached

        api_key = os.getenv(config.api_key_env, "")
        if not api_key:
            return []

        results = await self._call_mcp_endpoint(config, action, params, api_key)
        self._cache_set(cache_key, results)
        return results

    async def _call_mcp_endpoint(
        self,
        config: MCPSourceConfig,
        action: str,
        params: dict[str, Any],
        api_key: str,
    ) -> list[ExternalKnowledgeResult]:
        """
        通用 MCP JSON-RPC 调用。

        MCP 协议通常使用 JSON-RPC over HTTP POST：
        {
          "jsonrpc": "2.0",
          "method": "tools/call",
          "params": { "name": "<action>", "arguments": {...} },
          "id": 1
        }
        """
        payload = {
            "jsonrpc": "2.0",
            "method": "tools/call",
            "params": {
                "name": action,
                "arguments": params,
            },
            "id": 1,
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        }

        for attempt in range(config.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=config.timeout) as client:
                    resp = await client.post(
                        config.endpoint,
                        json=payload,
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        return self._parse_mcp_response(
                            source_id=config.source_id,
                            source_name=config.source_name,
                            source_url=config.endpoint,
                            action=action,
                            raw=data,
                        )
                    elif resp.status_code in (401, 403):
                        # 鉴权失败，不重试
                        return []
                    elif resp.status_code >= 500:
                        if attempt < config.max_retries:
                            time.sleep(1 * (attempt + 1))
                            continue
                        return []
                    else:
                        if attempt < config.max_retries:
                            time.sleep(0.5 * (attempt + 1))
                            continue
                        return []
            except (httpx.TimeoutException, httpx.ConnectError, OSError) as e:
                if attempt < config.max_retries:
                    time.sleep(1 * (attempt + 1))
                    continue
                return []

        return []

    def _parse_mcp_response(
        self,
        source_id: str,
        source_name: str,
        source_url: str,
        action: str,
        raw: dict[str, Any],
    ) -> list[ExternalKnowledgeResult]:
        """
        解析 MCP JSON-RPC 响应为标准 ExternalKnowledgeResult 列表。

        MCP 响应格式（JSON-RPC）：
        {
          "jsonrpc": "2.0",
          "result": {
            "content": [
              {
                "type": "text",
                "text": "..."        ← 结构化文本（可能是 JSON 字符串）
              }
            ]
          },
          "id": 1
        }
        """
        results: list[ExternalKnowledgeResult] = []

        # 提取 result.content
        result_block = raw.get("result", {})
        content_items = result_block.get("content", [])

        for item in content_items:
            if isinstance(item, dict) and item.get("type") == "text":
                text = item.get("text", "")
                # 尝试将 text 解析为 JSON
                parsed = self._try_parse_json(text)
                if parsed:
                    # 如果 text 本身是 JSON 对象，直接使用
                    results.append(self._build_result(
                        source_id, source_name, source_url, action, parsed
                    ))
                else:
                    # 否则作为纯文本知识
                    results.append(self._build_result(
                        source_id, source_name, source_url, action,
                        {"raw_text": text}
                    ))

        return results

    def _try_parse_json(self, text: str) -> dict[str, Any] | None:
        """尝试将文本解析为 JSON，失败返回 None"""
        import re
        # 尝试直接解析
        try:
            return json.loads(text)
        except (json.JSONDecodeError, TypeError):
            pass
        # 尝试提取文本中的 JSON 块
        match = re.search(r'\{.*\}', text, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except (json.JSONDecodeError, TypeError):
                pass
        return None

    def _build_result(
        self,
        source_id: str,
        source_name: str,
        source_url: str,
        action: str,
        parsed: dict[str, Any],
    ) -> ExternalKnowledgeResult:
        """从解析后的 MCP 数据构建统一 ExternalKnowledgeResult"""
        knowledge_id = f"{source_id}_{action}_{parsed.get('drugbank_id', parsed.get('id', ''))}"

        # 构造人类可读 content
        content_parts = []
        if "name" in parsed:
            content_parts.append(f"药品名称：{parsed['name']}")
        if "indication" in parsed:
            content_parts.append(f"适应症：{parsed['indication']}")
        if "description" in parsed:
            content_parts.append(f"描述：{parsed['description']}")
        if "mechanism_of_action" in parsed:
            content_parts.append(f"作用机制：{parsed['mechanism_of_action']}")
        if "toxicity" in parsed:
            content_parts.append(f"毒性/注意事项：{parsed['toxicity']}")
        if "interactions" in parsed:
            interactions = parsed["interactions"]
            if isinstance(interactions, list):
                content_parts.append(f"药物相互作用：{'; '.join(str(i) for i in interactions[:5])}")
        if "side_effects" in parsed or "adverse_effects" in parsed:
            se = parsed.get("side_effects") or parsed.get("adverse_effects", "")
            content_parts.append(f"副作用：{se}")
        if "raw_text" in parsed:
            content_parts.append(parsed["raw_text"][:500])

        content = "\n".join(content_parts) if content_parts else json.dumps(parsed, ensure_ascii=False)

        # 推断适用场景
        applicable_when = [action]
        if "indication" in str(parsed).lower() or "alzheimer" in str(parsed).lower():
            applicable_when.append("medication_refusal")
            applicable_when.append("polypharmacy")

        # 安全边界
        safety_boundary = [
            "本信息来源于外部知识库，仅供参考。不替代医生用药建议。",
            "不自行调整药物剂量或停用药物。",
            "如出现不良反应，应立即联系医生或药师。",
        ]

        return ExternalKnowledgeResult(
            knowledge_id=knowledge_id,
            topic=action,
            source=f"{source_name} MCP",
            source_url=source_url,
            content=content,
            raw_data=parsed,
            applicable_when=applicable_when,
            safety_boundary=safety_boundary,
            fetched_at=time.strftime("%Y-%m-%d %H:%M:%S"),
            confidence="high",  # DrugBank 为权威药学数据库
        )

    # ── 便捷方法 ────────────────────────────────────────

    async def query_drug_info(
        self,
        drug_name: str,
        *,
        force_refresh: bool = False,
    ) -> list[ExternalKnowledgeResult]:
        """查询单个药物的详细信息"""
        return await self.query(
            "drugbank",
            "drug_search",
            {"query": drug_name},
            force_refresh=force_refresh,
        )

    async def check_drug_interactions(
        self,
        drug_names: list[str],
        *,
        force_refresh: bool = False,
    ) -> list[ExternalKnowledgeResult]:
        """查询多个药物之间的相互作用"""
        return await self.query(
            "drugbank",
            "drug_interactions",
            {"drugs": drug_names},
            force_refresh=force_refresh,
        )

    async def query_by_topic(
        self,
        topic: str,
        keywords: list[str] | None = None,
    ) -> list[ExternalKnowledgeResult]:
        """
        根据照护话题查询相关知识。
        当前 DrugBank MCP 覆盖的话题见 MCP_SOURCE_REGISTRY["drugbank"].enabled_topics。
        """
        keywords = keywords or [topic]
        all_results: list[ExternalKnowledgeResult] = []

        for source_id, config in self._sources.items():
            if topic in config.enabled_topics:
                for kw in keywords[:3]:  # 最多搜 3 个关键词
                    results = await self.query(source_id, "drug_search", {"query": kw})
                    all_results.extend(results)

        return all_results


# ═══════════════════════════════════════════════════════════════
# 模块级单例（懒初始化）
# ═══════════════════════════════════════════════════════════════

_hub: MCPKnowledgeHub | None = None


def get_mcp_hub() -> MCPKnowledgeHub:
    """获取 MCPKnowledgeHub 单例"""
    global _hub
    if _hub is None:
        _hub = MCPKnowledgeHub.from_env()
    return _hub


def reload_mcp_hub() -> MCPKnowledgeHub:
    """重新加载（环境变量变化后）"""
    global _hub
    _hub = MCPKnowledgeHub.from_env()
    return _hub
