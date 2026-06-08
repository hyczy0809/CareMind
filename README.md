# CareMind

![MVP](https://img.shields.io/badge/status-MVP-238663)
![Frontend](https://img.shields.io/badge/frontend-Expo%20%2B%20React%20Native-2B241D)
![Backend](https://img.shields.io/badge/backend-FastAPI-245847)
![On Device](https://img.shields.io/badge/on--device-Gemma%203%201B-D98253)
![Track](https://img.shields.io/badge/track-C%20Edge%20AI-D98253)
![Safety](https://img.shields.io/badge/safety-non--diagnostic-476F92)
![License](https://img.shields.io/badge/license-MIT-blue)

正式项目名称：**CareMind 失智症家庭照护 Agent**

面向失智症家庭照护场景的 AI Care Agent。CareMind 以 Gemma-family 模型能力为核心，演示家庭照护记录结构化、今日风险关注、低冲突沟通话术、复诊摘要整理，以及 Android 端侧隐私模式。项目不诊断、不处方、不判断是否需要检查，也不替代医生或急救服务。

## 1. 项目名称

正式项目名称：**CareMind 失智症家庭照护 Agent**

参赛赛道：**赛道 C：Edge AI / Android 端侧 AI**

仓库名称：`CareMind`

项目仓库：<https://github.com/hyczy0809/CareMind>

## 2. 项目简介

失智症家庭照护中，大量关键变化发生在医院之外：夜间频繁起床、拒药、少食、怀疑东西被偷、反复要回家、照护者睡眠不足和情绪崩溃。家属往往只能靠记忆和零散聊天记录，在复诊时努力说清“最近到底发生了什么”。

CareMind 把这些混乱的日常记录整理成一个可追踪的照护闭环：

```text
一句话记录发生了什么
-> AI 整理成睡眠 / 饮食 / 用药 / 情绪行为 / 安全 / 照护者状态
-> 今日照护给出今晚最值得关注的小行动
-> 沟通话术帮助家属用更低冲突的方式回应
-> 复诊准备生成医生能快速理解的摘要
-> 隐私模式让敏感记录优先留在 Android 设备本地处理
```

项目包含三个核心页面：

- **今日照护**：展示今日最值得关注的事项、行动三态、陪伴活动和照护者支持。
- **智能记录**：输入或语音记录照护事件，生成结构化日志、风险信号和沟通话术。
- **复诊准备**：聚合近 7 天 / 30 天记录、病历/检查/用药资料，生成可复制复诊摘要。

项目提供两种运行形态：**云端 Agent 工作流** 与 **Android 端侧隐私模式**。默认演示数据均为脱敏数据，不包含真实患者、家庭或医疗资料。

## 3. 在线演示链接

当前公开演示后端：

<https://caremind-1039168666325.us-west1.run.app>

健康检查：

```bash
curl https://caremind-1039168666325.us-west1.run.app/health
```

模型目录接口：

```bash
curl https://caremind-1039168666325.us-west1.run.app/api/models
```

说明：CareMind 的主要演示形态是 Android 真机 App 与本地 Web 开发预览。公开地址目前提供后端 API、模型目录和 Agent 接口；完整前端可按第 5 节在本地启动，或通过 Android APK 连接该后端。

演示视频：

<https://www.bilibili.com/video/BV1hFEg6ZEVb>

<p align="center">
  <a href="https://www.bilibili.com/video/BV1hFEg6ZEVb">
    <img src="docs/demo-video/generated/caremind-demo-video-preview.png" alt="CareMind demo video preview" width="860" />
  </a>
</p>

视频相关文件：

- 视频封面：[docs/demo-video/generated/caremind-demo-video-preview.png](docs/demo-video/generated/caremind-demo-video-preview.png)
- 分镜脚本：[docs/demo-video/demo_storyboard.md](docs/demo-video/demo_storyboard.md)
- 录制指南：[docs/demo-video/recording_guide.md](docs/demo-video/recording_guide.md)

视频文件不提交到 Git 历史中，README 使用可点击封面图链接到公开视频。

## 4. 项目仓库链接

GitHub 仓库：

<https://github.com/hyczy0809/CareMind>

比赛提交 PR：

<https://github.com/gdgshanghai/Gemma4-Hackathon-ShangHai/pull/57>

## 5. 运行方式

### 方式一 · 本地 Web 前端预览

环境要求：Node.js 18+、npm。

```bash
git clone https://github.com/hyczy0809/CareMind.git
cd CareMind/frontend
npm install
EXPO_PUBLIC_CAREMIND_API_URL=https://caremind-1039168666325.us-west1.run.app npm run web -- --port 8082
```

浏览器访问：

```text
http://127.0.0.1:8082
```

该方式适合快速查看 UI、页面闭环和主要交互。完整 AI 工作流会调用已部署的 Cloud Run 后端。

### 方式二 · 本地后端 + 本地前端

环境要求：Python 3.10+、Node.js 18+。

启动后端：

```bash
git clone https://github.com/hyczy0809/CareMind.git
cd CareMind
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --host 127.0.0.1 --port 8090
```

另开终端启动前端：

```bash
cd CareMind/frontend
npm install
EXPO_PUBLIC_CAREMIND_API_URL=http://127.0.0.1:8090 npm run web -- --port 8082
```

跑通第一个照护工作流：

```bash
curl -X POST http://127.0.0.1:8090/api/care-workflow \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "local_patient",
    "caregiver_id": "local_caregiver",
    "note": "妈妈昨晚起来四次，今天一直说有人偷她的钱，晚饭只吃了几口。我也快撑不住了。",
    "source": "manual",
    "timezone": "Asia/Shanghai"
  }'
```

### 方式三 · Android 真机 / Edge AI 隐私模式

环境要求：Android 真机、JDK 17、Android SDK、Expo Android 工程依赖。

USB 调试时可通过 `adb reverse` 连接本地后端：

```bash
adb reverse tcp:8090 tcp:8090
cd frontend
npm run android:usb
```

构建连接 Cloud Run 后端的 release APK：

```bash
cd frontend/android
NODE_ENV=production \
EXPO_PUBLIC_CAREMIND_API_URL=https://caremind-1039168666325.us-west1.run.app \
./gradlew :app:assembleRelease
```

隐私模式演示步骤：

1. 在 Android 手机上安装 CareMind APK。
2. 打开 **Settings / Privacy Mode**。
3. 点击刷新，加载后端动态模型目录。
4. 下载 `Gemma 3 1B` LiteRT 模型。
5. 关闭 Wi-Fi 和移动网络。
6. 输入一条敏感照护记录。
7. 展示 CareMind 在本机返回非诊断性照护观察和低负担行动建议。

### 方式四 · Docker 启动后端

```bash
docker build -t caremind-backend .
docker run --rm -p 8080:8080 --env-file .env caremind-backend
curl http://127.0.0.1:8080/health
```

### 配置说明

从 [.env.example](.env.example) 创建 `.env`。

| 变量 | 是否必需 | 用途 |
|---|---:|---|
| `CF_AIG_TOKEN` | 是，除非使用其他 endpoint | Cloudflare AI Gateway credential |
| `CF_AIG_BASE_URL` | 是，除非使用 `MODEL_BASE_URL` | OpenAI-compatible gateway URL |
| `MODEL_NAME` | 是 | Provider model identifier |
| `MODEL_BASE_URL` | 可选 | Override model endpoint |
| `MODEL_API_KEY` | 可选 | Provider API key when not using `CF_AIG_TOKEN` |
| `TRANSCRIPTION_API_KEY` | 云端 STT 可选 | Speech transcription provider key |
| `CAREMIND_GCS_MODEL_BUCKET` | 可选 | Cloud Storage bucket used for dynamic on-device model catalog |
| `CAREMIND_GCS_MODEL_PREFIX` | 可选 | Object prefix for model files, default `models` |
| `CAREMIND_GCS_DYNAMIC_CATALOG` | 可选 | `1` by default; Cloud Run scans the GCS prefix |
| `CAREMIND_GCS_MODEL_DELIVERY` | 可选 | `redirect` avoids Cloud Run large-response limits |
| `PROMPT_MODE` | 可选 | `WEAK` or `STRONG` prompt mode |
| `PORT` | 可选 | Default backend port |

最小示例：

```env
CF_AIG_TOKEN=your-cloudflare-ai-gateway-token
CF_AIG_BASE_URL=https://gateway.ai.cloudflare.com/v1/<account>/<gateway>/compat
MODEL_NAME=google-ai-studio/gemini-2.5-flash
PROMPT_MODE=WEAK
PORT=8080
CAREMIND_GCS_MODEL_BUCKET=caremind-498713-models
CAREMIND_GCS_MODEL_PREFIX=models
CAREMIND_GCS_DYNAMIC_CATALOG=1
CAREMIND_GCS_MODEL_DELIVERY=redirect
```

真实 API Key 只应写入本地 `.env`，不要提交到公开仓库。

## 6. 技术栈

前端：

- Expo + React Native + Expo Router
- React Native Web 用于本地 Web 预览
- Android Kotlin native bridge：Gemma model lifecycle、system speech recognition
- 本地 / 云端 inference router：`frontend/lib/inference`

后端：

- FastAPI
- OpenAI-compatible `/v1/chat/completions` Agent route
- Typed `/api/*` business endpoints
- Cloudflare AI Gateway / OpenAI-compatible model adapter
- Google ADK cloud agents：照护工作流、Memory、风险、复诊摘要工具
- JSON-backed MVP memory store

端侧与模型：

- Gemma 3 1B `.litertlm` via Android native module
- 支持 `.litertlm` / `.task` 动态模型目录
- Google Cloud Storage 模型分发
- XML structured output contract + parser + deterministic fallback

部署：

- Google Cloud Run 后端
- Google Cloud Storage 模型文件
- Docker / local uvicorn
- Android release APK

## 7. 项目亮点

**Edge AI 是产品需求，不是装饰性技术点。**
失智症照护记录常常包含家庭冲突、患者状态、照护者崩溃时刻等敏感内容。CareMind 的隐私模式支持在 Android 真机加载 Gemma LiteRT 模型，让更敏感的照护记录优先留在本机处理。

**动态端侧模型目录，APK 不用反复重打包。**
App 调用 `GET /api/models` 获取可下载模型。Cloud Run 后端扫描 Google Cloud Storage 中的 `.litertlm` / `.task` 文件，新增模型后用户点击刷新即可看到。

**云端 Agent 路径包含真实 Tool Calling。**
`my_agent/cloud_agents.py` 注册照护、风险、Memory 和复诊摘要工具；`my_agent/cloudflare_openai_model.py` 把函数声明转成 OpenAI-compatible `tools` / `tool_choice: auto`，并把模型返回的 `tool_calls` 映射回 ADK function calls。

**照护工作流不是聊天回复，而是产品数据。**
CareMind 把模型输出转成 typed product data：结构化日志、今日关注、行动三态、沟通话术、复诊摘要和 Memory 候选。前端不是直接展示一段聊天文本。

**医疗边界内建到产品流程。**
系统不输出诊断、处方、用药调整或检查决策。病历、检查、用药资料进入复诊摘要前，需要家属确认。危机场景转向紧急支持或医生。

**演示数据脱敏，真实部署可控。**
默认使用脱敏演示数据；API Key 通过 `.env` 注入；大模型文件通过 GCS 或 Git LFS 管理，不进入普通 Git 历史。

## 8. 交付物说明

| 交付物 | 位置 / 链接 |
|---|---|
| 项目仓库 | <https://github.com/hyczy0809/CareMind> |
| 比赛提交 PR | <https://github.com/gdgshanghai/Gemma4-Hackathon-ShangHai/pull/57> |
| 公开视频 | <https://www.bilibili.com/video/BV1hFEg6ZEVb> |
| 演示后端 | <https://caremind-1039168666325.us-west1.run.app> |
| 产品 PRD | [docs/PRD.md](docs/PRD.md) |
| 前端说明 | [frontend/README.md](frontend/README.md) |
| Demo 分镜 | [docs/demo-video/demo_storyboard.md](docs/demo-video/demo_storyboard.md) |
| Demo 录制指南 | [docs/demo-video/recording_guide.md](docs/demo-video/recording_guide.md) |
| 后端入口 | [main.py](main.py) |
| OpenAI-compatible Agent route | [openai_compat.py](openai_compat.py) |
| Agent / Memory 工作流 | [my_agent](my_agent) |
| Android 端侧模型桥接 | [frontend/android/app/src/main/java/com/caremind/app/gemma](frontend/android/app/src/main/java/com/caremind/app/gemma) |
| 本地 / 云端推理路由 | [frontend/lib/inference](frontend/lib/inference) |

目录结构：

```text
CareMind/
├── frontend/                       # Expo / React Native 前端
│   ├── app/                        # Expo Router tabs
│   ├── components/                 # Today, Smart Log, Follow-up, settings UI
│   ├── lib/
│   │   ├── inference/              # Cloud / local inference router
│   │   └── speech/                 # Android system speech bridge
│   └── android/                    # Android native project and Gemma bridge
├── docs/
│   ├── PRD.md
│   └── demo-video/                 # Demo 分镜、封面、录制指南
├── my_agent/
│   ├── care_workflow_service.py
│   ├── memory_*.py
│   └── memory_store/
├── main.py                         # FastAPI app
├── openai_compat.py                # OpenAI-compatible Agent endpoint
├── requirements.txt
├── Dockerfile
└── README.md
```

脱敏与安全声明：

- 仓库只包含脱敏演示数据，不包含真实患者、家庭、医院、账号或生产系统数据。
- 真实 API Key 仅应存于本地 `.env`，仓库只提供 `.env.example`。
- 大模型文件应通过 Google Cloud Storage 或 Git LFS 管理，不应作为普通 Git blob 提交。
- CareMind 不是医疗器械，不提供诊断、处方、检查决策或急救替代服务。
- 涉及走失、自伤、伤人、急性意识改变、严重受伤等场景时，应联系当地紧急服务或医生。

## 许可证

本项目采用 [MIT License](LICENSE)。

## 致谢

CareMind 的安全边界参考了公开失智症照护指南和照护者支持资料，包括 NICE dementia recommendations、Mayo Clinic diagnosis education 和 Alzheimer's Association caregiver stress materials。这些资料用于帮助产品保持边界清晰，不意味着 CareMind 是医疗器械或临床决策系统。
