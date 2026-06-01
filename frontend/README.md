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
- 复诊摘要 PDF 导出
- 医疗边界前置提示文案

## 运行方式

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

当前页面默认没有预置照护数据，用户完成首次引导或在智能记录中保存后，数据会进入 `lib/caremind-store.tsx` 的本地前端状态。后续接后端时，优先替换这些位置：

- `SmartLogScreen`：接 `/api/logs/parse` 和 `/api/logs`
- `TodayCareScreen`：接 `/api/today`、`/api/caregiver/check-in`、`/api/actions/:event_id/result`
- `FollowupPrepScreen`：接 `/api/reports/follow-up/progress`、`/api/reports/follow-up`
- `MemoryCandidateCard`：接 Memory 确认/忽略接口
- `MemorySettingsScreen`：接已记住信息列表、编辑、删除接口

## 设计注意

- 用户界面不使用“AI 诊断”“治疗”“风险评估”等高误解词。
- Memory 不作为独立 Tab，而是融入三个主页面。
- 所有候选长期记忆都需要用户确认。
- 所有图标使用 lucide-react-native。
- 主按钮和核心操作区高度不低于 44dp。
