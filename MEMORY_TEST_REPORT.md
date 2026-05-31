# CareMind Memory 模块测试报告

**测试时间：** 2026-05-30  
**运行环境：** Python 3.11.9 / Windows 11  
**测试文件：** `test_memory.py`  
**测试结果：** 🟢 **43 / 43 全部通过，0 失败**

---

## 本次改造概述

基于 `CareMind_Memory.md` 设计方案，在现有 5-Agent 框架中插入了完整的 Memory 层。

### 新增文件（5 个）

| 文件 | 职责 | 对应设计章节 |
|------|------|-------------|
| `my_agent/memory_schema.py` | 定义所有 Memory 数据结构（Patient Profile / Medication / Behavior Baseline / Episodic / Caregiver State / Knowledge DB / Safety Memory） | §5 |
| `my_agent/memory_state.py` | JSON 文件读写、memory_store/ 目录管理、线程安全 | §15.1 |
| `my_agent/memory_tools.py` | retrieve_* / update_* 工具函数，供 Agent 调用 | §7 |
| `my_agent/memory_router.py` | 按事件类型路由 Memory 请求，避免冗余检索 | §9 |
| `my_agent/memory_policy.py` | 写入门控：自动写入 / 需用户确认 / 禁止写入 分类 | §10 |

### 修改文件（2 个）

| 文件 | 改动内容 |
|------|---------|
| `my_agent/cloud_tools.py` | `run_cloud_care_workflow` 扩展为 11 步 Memory 增强工作流 |
| `my_agent/cloud_agents.py` | 所有 Agent 挂载对应 Memory 工具，更新 instruction 说明 |

### memory_store/ 目录结构

```text
my_agent/memory_store/
├── patient_profile.json      ← 患者画像（作息、沟通偏好）
├── medication_memory.json    ← 用药信息 + 拒药事件流水
├── behavior_baseline.json    ← 行为基线（触发因素、有效话术）
├── episodic_events.json      ← 每日照护事件流水（自动写入）
└── caregiver_state.json      ← 照护者状态 + 历史快照
```

---

## Memory 增强工作流（11 步）

```text
note
  → Step 1.  事件抽取（extract_care_signals）
  → Step 2.  自动写入 Episodic Memory
  → Step 3.  Memory Router 路由（按事件类型决定检索哪些 Memory）
  → Step 4.  执行 Memory 检索（patient_profile / behavior_baseline / medication / recent_events）
  → Step 5.  患者风险评估（结果附带 memory_context_summary）
  → Step 6.  照护者压力评估
  → Step 7.  照护计划生成（注入行为基线有效话术 + 专业知识）
  → Step 8.  更新照护者状态 Memory
  → Step 9.  提出长期 Memory 候选 + 门控分类
  → Step 10. 生成用户确认提示语
  → Step 11. 复诊摘要生成
```

---

## 测试覆盖范围（7 个 Section，43 个用例）

### Section 1 — Memory Schema 数据结构（5 个）

| 用例 | 结果 |
|------|------|
| default_patient_profile 包含 basic_profile / daily_routine / communication_style | PASS |
| default_medication_memory 结构完整 | PASS |
| KNOWLEDGE_DB 含 5 条以上知识，每条有 topic + content | PASS |
| SAFETY_MEMORY 包含 medical_boundary / medication_boundary / emergency_rules | PASS |
| make_episodic_event 生成完整情节事件对象（含 event_id / frequency） | PASS |

### Section 2 — Memory State 读写持久化（4 个）

| 用例 | 结果 |
|------|------|
| 患者画像读写持久化（写入 age=78 后可重新读取） | PASS |
| Episodic Event 写入并可检索 | PASS |
| 行为基线 upsert 后可按类型检索 | PASS |
| 照护者状态更新生成历史快照 | PASS |

### Section 3 — Memory Tools 工具函数（8 个）

| 用例 | 结果 |
|------|------|
| retrieve_patient_profile 返回完整结构 | PASS |
| retrieve_professional_knowledge(night_wandering) 返回相关知识 | PASS |
| retrieve_safety_rules 返回安全规则 | PASS |
| update_event_memory 写入事件成功 | PASS |
| propose_memory_update 返回候选更新列表 | PASS |
| confirm_and_update_behavior_baseline 写入有效干预策略 | PASS |
| confirm 后 retrieve_behavior_baseline 能返回更新的基线 | PASS |
| retrieve_recent_events 按类型过滤返回正确 | PASS |

### Section 4 — Memory Router 路由逻辑（4 个）

| 用例 | 结果 |
|------|------|
| medication_refusal 事件路由到 medication_memory=True | PASS |
| night_wandering 事件路由到 behavior_baseline + professional_knowledge | PASS |
| 所有路由结果都包含 safety_boundary + emergency_rules | PASS |
| execute_memory_retrieval 返回包含 patient_profile + professional_knowledge | PASS |

### Section 5 — Memory Policy 写入门控（5 个）

| 用例 | 结果 |
|------|------|
| 高风险事件类型（night_wandering / medication_refusal / home_seeking）标记为自动写入 | PASS |
| forbidden content 检测准确（"药物导致"→True，"今晚注意门锁"→False） | PASS |
| sanitize_for_memory 将越界内容改写为观察线索 | PASS |
| classify_memory_candidates 正确分类三类候选（auto / needs_confirm / blocked） | PASS |
| build_confirmation_prompt 生成包含建议内容的提示语 | PASS |

### Section 6 — Memory 增强工作流 3 天连续 Demo（13 个）

#### Day 1 — 原始问答示例

输入：「妈妈今天下午一直说要回老家，晚上不肯吃药，半夜起来三次，还想开门出去。我昨天几乎没睡，整个人很烦躁。」

| 用例 | 结果 |
|------|------|
| 工作流返回完整 10 段结果（extracted / memory_context / professional_knowledge / patient_risk / caregiver_support / care_plan / event_memory_write / caregiver_memory_update / memory_update_candidates / doctor_summary） | PASS |
| memory_context 包含 patient_profile 和 route_plan | PASS |
| 检索到专业照护知识（night_wandering / medication / safety） | PASS |
| 事件已写入 Episodic Memory（status=ok, written>0） | PASS |
| 生成了 Memory 更新候选项（含待确认项） | PASS |
| 待确认候选生成了用户提示语 | PASS |

#### Day 2 — 连续追踪（Memory 感知历史）

输入：「她今天又说要回家了，我按照昨天说的陪她看照片，好像好了点。今晚只起来一次，没有开门。」

| 用例 | 结果 |
|------|------|
| 工作流执行成功 | PASS |
| **memory_context 已包含 Day1 确认的行为基线**（home_seeking 基线跨 session 持久化） | PASS |
| care_plan 含 memory_enriched_hints（历史有效话术注入） | PASS |
| recent_events 显示累计事件数 > 0（两天积累） | PASS |

#### Day 7 — 复诊摘要（长期 Memory 聚合）

输入：「帮我总结一下这周情况，明天要去复诊。」

| 用例 | 结果 |
|------|------|
| generate_doctor_summary 生成结构完整的复诊摘要 | PASS |
| 复诊摘要事件统计非空（含多天积累数据） | PASS |
| 复诊摘要包含照护者状态摘要 | PASS |

### Section 7 — Memory 持久化验证（4 个）

| 用例 | 结果 |
|------|------|
| episodic_events.json 文件存在且含有效事件数据 | PASS |
| behavior_baseline.json 文件存在且含 home_seeking 基线 | PASS |
| caregiver_state.json 文件存在且含照护者状态 | PASS |
| medication_memory.json 含拒药事件记录 | PASS |

---

## Memory 接入前后对比

| 维度 | 接入前 | 接入后 |
|------|--------|--------|
| 历史感知 | 无，每次独立处理 | 检索近 7 天事件趋势，识别重复模式 |
| 个性化 | 通用照护建议 | 基于行为基线的有效/无效话术 |
| 照护计划 | 固定优先事项 | memory_enriched_hints 注入历史有效策略 |
| 药物跟踪 | 无 | 累计拒药次数（7d），自动写入 medication_memory |
| 照护者状态 | 单次评估 | 历史快照 + 持续跟踪 sleep_deprivation/distress |
| 安全保障 | 静态边界 | 每次路由自动附加 safety_boundary + emergency_rules |
| 长期 Memory | 无 | 提出候选 → 门控分类 → 用户确认 → 持久化 |
| 复诊摘要 | 只看最近一次输入 | 聚合多天事件 + 用药记录 + 照护者状态 |

---

## 总结

Memory 层已完整接入现有 CareMind Agent 框架，实现了方案第 17 节推荐实现路径中的**前五步**（JSON 本地 Memory + memory_tools + 工作流扩展 + Memory Router + Memory Gate）。系统现在能够：

1. **持续记录**每日照护事件、拒药事件、照护者状态；
2. **跨 session 追踪**行为基线和有效干预方式；
3. **个性化输出**：在照护计划中融合历史有效话术；
4. **安全写入**：越界医疗结论被拦截并改写为观察线索；
5. **长期摘要**：复诊摘要聚合多天积累数据。

下一步可按方案建议推进 SQLite 持久化或向量检索增强版本。
