# CareMind Mobile Frontend

CareMind 前端 MVP，基于 `CareMind_Frontend_Design_v0.2.md` 实现。

## 当前实现范围

- Expo Router 应用骨架
- 首次引导 3 步
- 3 个底部 Tab
  - 今日照护
  - 智能记录
  - 复诊准备
- Memory 感知组件
  - 相似记录提示
  - 候选记忆确认
  - 上次有效方法
  - 已记住的信息管理入口
- 照护者四维 check-in
- 行动项三态：`pending / done / blocked`
- 今日关注事项按类型去重，避免同类事项重复出现
- 今日陪伴活动与反馈记录
- 复诊资料上传、整理草稿、家属确认和删除
- 已确认复诊资料持久保存，并进入后端摘要与可复制复诊摘要
- 复诊摘要一键生成可复制文本
- 设置页核心事件审计
- 医疗边界前置提示文案
- iPhone 云端版：支持完整 App、云端 Agent 工作流、资料上传与录音上传转写
- iPhone 端侧隐私模式：已接入 Swift Native Module + llama.cpp，本地 GGUF 模型支持下载、校验、删除和端侧 XML 输出
- Android 隐私模式：支持 Gemma LiteRT 端侧模型演示

## 运行方式

先启动后端业务 API：

```bash
cd ..
uvicorn main:app --host 127.0.0.1 --port 8090
```

再启动前端：

```bash
cd frontend
npm install
npm run start
```

常用命令：

```bash
npm run ios
npm run android
npm run web
npm run typecheck
```

### iPhone / iOS 端

iPhone 端当前支持完整 CareMind App 与云端 Agent 工作流：

- 今日照护
- 智能记录
- 复诊准备
- 资料上传
- 录音上传转写
- 沟通话术与照护建议

边界说明：iPhone 端默认仍可走已部署的 Cloud Run 后端；开启隐私模式且 GGUF 模型就绪时，会通过 iOS Native Bridge 调用本地 llama.cpp runtime。当前 iOS runtime 为 CPU / Accelerate 路径，Metal 加速和更大模型需要继续做真机性能测试。

本地 iOS 模拟器运行：

```bash
EXPO_PUBLIC_CAREMIND_API_URL=https://caremind-1039168666325.us-west1.run.app npm run ios:cloud
```

如果 iOS 模拟器需要连接本地后端：

```bash
EXPO_PUBLIC_CAREMIND_API_URL=http://127.0.0.1:8090 npm run ios:local
```

真机 / TestFlight / 内部分发建议使用 EAS：

```bash
npm install -g eas-cli
eas login
eas build -p ios --profile preview
```

如需只构建 iOS 模拟器包：

```bash
eas build -p ios --profile ios-simulator
```

#### iPhone 端侧隐私模式

iPhone 用户同样需要隐私优先能力。当前代码里的 `modules/caremind-ios-gemma` 是一个 Expo Swift Native Module，负责模型下载、校验、删除、llama.cpp 推理和运行时信息返回，并复用现有 `inference-router`、XML 输出约束和 fallback builders：

```text
iPhone App
-> Inference Router
-> iOS Local Inference Adapter
-> Swift Native Module
-> llama.cpp GGUF runtime
-> XML parser / guardrail / fallback
-> 本地照护整理
```

实现前提：

- iOS 兼容模型完成真机内存和稳定性测试。
- 模型下载后保存在 App 私有目录，并避免进入 iCloud 备份。
- 隐私模式下若本地模型不可用，不静默上传云端，必须让用户确认。
- 语音先通过系统能力或上传转写变成可编辑文本，本地模型负责照护理解，不在本阶段承诺本地语音转写。

详细方案见：`../docs/ios-edge-architecture.md`。

### 后端地址配置

Web 和 USB 真机调试可以继续使用本机后端：

```bash
EXPO_PUBLIC_CAREMIND_API_URL=http://127.0.0.1:8090 npm run web
```

如果是 Android 真机通过数据线调试，需要先把手机的 `127.0.0.1:8090` 转发到电脑：

```bash
adb reverse tcp:8090 tcp:8090
npm run android:usb
```

正式移动端安装包不应该绑定 `127.0.0.1`。发布前需要把已部署的 HTTPS 后端写入构建环境：

```bash
cp .env.production.example .env.production
# 把 https://your-caremind-api.example.com 改成真实部署地址
EXPO_PUBLIC_CAREMIND_API_URL=https://api.your-domain.com npm run android:release
EXPO_PUBLIC_CAREMIND_API_URL=https://api.your-domain.com npm run ios:release
```

如果 release 构建没有配置 `EXPO_PUBLIC_CAREMIND_API_URL`，App 会明确提示"后端地址未配置"，不会误请求手机自己的 localhost。

### 端侧推理输出格式

隐私模式下的所有本地 LLM 任务（结构化日志、护栏、复诊摘要）都需要把模型自由文本解析成应用消费的结构化数据。1B–4B 参数级别的设备端模型对严格 JSON 语法不够稳定（容易缺引号、漏逗号、未闭合字符串），所以默认走 **XML 标签格式**：

```bash
# 默认即 xml，无需显式设置
EXPO_PUBLIC_LOCAL_OUTPUT_FORMAT=xml npm run android:usb

# 紧急情况下回退到 JSON（用于 A/B 对照或排查 XML 解析回归）
EXPO_PUBLIC_LOCAL_OUTPUT_FORMAT=json npm run android:usb
```

两条路径并存：

- `lib/inference/local/prompts.ts` 与 `lib/inference/local/json-extract.ts` 实现 JSON 路径
- `lib/inference/local/prompts-xml.ts`、`lib/inference/local/xml-extract.ts`、`lib/inference/local/xml-parsers.ts` 实现 XML 路径
- 三个任务文件（`care-workflow-local.ts`、`guardrail-local.ts`、`followup-local.ts`）按 `isXmlOutput()` 在运行时分流，XML 解析结果会被 `xmlToJsonShape` 适配回 JSON 形状，复用既有的归一化与回退逻辑
- 任意一种格式解析失败时，`fallback-builders` 走 regex 兜底，应用不会因此白屏

## 主要文件

```text
app/
├── index.tsx
├── settings.tsx
└── (tabs)/
    ├── today.tsx
    ├── log.tsx
    └── follow-up.tsx

components/
├── today/TodayCareScreen.tsx
├── log/SmartLogScreen.tsx
├── followup/FollowupPrepScreen.tsx
├── onboarding/OnboardingScreen.tsx
├── settings/MemorySettingsScreen.tsx
├── memory/
└── ui/

lib/
├── caremind-store.tsx
└── theme.ts
```

## 接口接入点

当前页面默认没有预置照护数据，用户完成首次引导或在智能记录中保存后，数据会进入 `lib/caremind-store.tsx` 的本地前端状态。

Day 1 已冻结前后端业务契约：

- 接口说明：`../docs/DAY1_MVP_SCOPE_AND_CONTRACT.md`
- JSON Schema：`../docs/schemas/care-workflow.schema.json`
- 前端类型：`types/care-workflow.ts`
- 智能记录整理接口：`POST /api/care-workflow`
- 医疗/危机边界预检接口：`POST /api/guardrail/check`
- 复诊摘要生成接口：`POST /api/reports/follow-up`

后续接后端时，优先替换这些位置：

- `SmartLogScreen`：接 `/api/care-workflow`
- `TodayCareScreen`：接 `/api/today`、`/api/caregiver/check-in`、`/api/actions/:event_id/result`
- `FollowupPrepScreen`：接 `/api/reports/follow-up/progress`、`/api/reports/follow-up`
- `MemoryCandidateCard`：接 Memory 确认/忽略接口
- `MemorySettingsScreen`：接已记住信息列表、编辑、删除接口

## 实现里程碑与验收路径

以下按功能主题记录，标题保留当时开发阶段名称，便于和提交历史、demo 验收项对应。

## Day 5 Guardrail 行为

智能记录页已经接入后端 guardrail：

- 普通照护记录：进入结构化日志、关注事项、沟通话术和候选记忆流程。
- 用药决策、诊断判断、MRI/CT/量表决策：不进入普通整理结果，展示“医疗边界卡”，引导用户整理复诊问题或观察事实。
- 走失、自伤/伤人、意识异常等危机场景：不进入普通整理结果，展示“先确认安全”卡，提示优先联系当地紧急服务或现场支持。

可用这些输入验收：

```text
妈妈昨晚起来四次，今天一直说有人偷她的钱，晚饭只吃了几口。我也快撑不住了。
这个药今晚要不要停药？
老人走失了，找不到人。
```

## Day 6 复诊摘要行为

复诊准备页已经接入后端报告接口：

- 有已保存记录时，页面会调用 `POST /api/reports/follow-up` 生成复诊摘要。
- 摘要内容包括：主要变化、建议问医生的问题、复诊资料清单、已尝试方法和医疗边界说明。
- 后端暂不可用时，页面会显示“当前使用本地摘要”，并继续用本地 `attentionItems` 生成可复制摘要。
- 可复制摘要会优先使用后端返回的摘要、问题清单和材料清单。

验收路径：

```text
智能记录保存一条照护记录 -> 进入复诊准备 -> 看到“复诊摘要已生成” -> 生成可复制摘要
```

## Day 7 复诊摘要真实聚合

复诊准备页已支持按时间范围真实聚合：

- `lib/caremind-store.tsx` 会保存 `careLogs` 历史记录，每条包含原始记录、结构化字段、关注事项和 `createdAt`。
- 复诊准备页切换“近 7 天 / 近 30 天”时，会先按 `careLogs.createdAt` 过滤，再生成核心指标、摘要、问题清单和可复制摘要。
- 调用 `POST /api/reports/follow-up` 时，只会发送当前时间范围内的记录数量、关注事项和相关记忆。
- 旧数据没有 `careLogs` 时，会用最后一条记录迁移出一条兼容历史记录。

验收路径：

```text
保存多条不同日期的照护记录 -> 进入复诊准备 -> 切换近 7 天 / 近 30 天 -> 核心指标、摘要条目、医生问题和可复制摘要内容随范围变化
```

## Day 8 可复制摘要与埋点

复诊摘要可复制文本和核心事件已接入：

- 可复制摘要包含 CareMind 标识、患者昵称、时间范围、生成时间、记录数、核心变化、医生问题、资料清单和边界说明。
- 生成与复制流程会记录核心事件：`followup_copy_started`、`followup_copy_succeeded`、`followup_copy_failed`。
- 本地事件池会记录最多 100 条非隐私化事件，包括保存照护记录、更新行动状态、保存照护者状态、切换复诊范围、生成复诊摘要、生成可复制摘要等。
- 设置页“核心事件”区域可查看最近 20 条事件，便于 demo 验收和调试。

验收路径：

```text
保存一条智能记录 -> 进入复诊准备 -> 生成并复制复诊摘要 -> 进入设置页 -> 看到复制复诊摘要成功等核心事件
```

## Phase 7 复诊资料持久聚合

复诊资料补充已从页面临时状态升级为 CareMind 全局状态：

- 上传资料并确认后，资料会写入本机持久状态，重新进入复诊准备页后仍保留。
- 手动摘要会直接作为家属确认资料进入复诊资料清单。
- 已确认资料会进入页面资料清单和可复制摘要。
- 删除资料会同步移出本地资料池；后端文件资料也会调用删除接口。
- 设置页核心事件可查看资料上传、整理、确认和删除链路。

验收路径：

```text
进入复诊准备 -> 手动填写一条资料摘要 -> 只保存摘要 -> 看到复诊资料清单新增内容 -> 离开再返回仍保留 -> 可复制摘要包含该资料
```

## Phase 8 后端复诊摘要聚合资料

复诊摘要接口已能聚合已确认资料：

- `POST /api/reports/follow-up` 请求体增加 `followup_documents`。
- 只有 `reviewed` 状态的资料会进入后端摘要。
- 后端会把已确认资料合并到 `summary_bullets` 和 `materials_to_bring`。
- 指标卡中会显示“复诊资料”数量。
- 复诊准备页会优先使用后端摘要；后端不可用时展示本地摘要兜底。
- 可复制摘要会使用当前页面同一份摘要、问题清单和材料清单。

验收路径：

```text
复诊准备 -> 保存/确认一条复诊资料 -> 后端摘要显示“复诊摘要已同步” -> 复诊资料清单和可复制摘要都包含该资料
```

## Phase 9 今日关注事项去重

今日照护页已修复同类关注事项重复展示的问题：

- `attentionItems` 写入和加载时按 `type` 去重。
- 今日照护页渲染前再做一层展示去重，兼容旧本地数据。
- 同类型事项只展示一条，优先保留严重度更高、时间更新的记录。
- 例如连续两条记录都提到饮食/饮水，今日照护只展示一个“今天关注饮食和饮水”卡片。

验收路径：

```text
连续保存两条都提到吃饭/饮水的智能记录 -> 进入今日照护 -> “今天关注饮食和饮水”只出现一次
```

## Day 6 今日照护闭环

今日照护页已完成行动闭环：

- 每个行动支持三态：`pending` 待办、`done` 已完成、`blocked` 今晚做不到。
- 用户点“做不到”后，需要选择原因，行动卡会立即展示“替代做法”。
- 已完成或做不到的行动都可以点“改待办”回到待办状态。
- 当照护者连续多次记录为高压力状态时，会展示“连续高压提醒”卡，建议降低目标并寻求轮替支持。

验收路径：

```text
智能记录保存一条带关注事项的记录 -> 今日照护 -> 点“做不到” -> 选择原因 -> 看到替代做法 -> 点“改待办” -> 点行动主体标记完成
```

## 设计注意

- 用户界面不使用“AI 诊断”“治疗”“风险评估”等高误解词。
- Memory 不作为独立 Tab，而是融入三个主页面。
- 所有候选长期记忆都需要用户确认。
- 所有图标使用 lucide-react-native。
- 主按钮和核心操作区高度不低于 44dp。
