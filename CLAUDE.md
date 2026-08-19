# 项目：aceit — 面试打磨系统

## 这是什么
只给我一个人用的面试准备系统。四层数据打通：
个人素材 → 岗位画像 → 问答打磨 → 真实面试复盘。
外部信息（小红书等）作为素材源汇入。

## 核心原则
- 单用户。不做登录、不做多租户、不做权限。
- 不做 RAG。个人材料总量小，全量塞进 prompt 效果更好。
- 数据在本地。SQLite 文件，含面试录音。

## 技术栈（不要替换）
Next.js (App Router) + TypeScript
Tailwind + shadcn/ui
Drizzle ORM + SQLite (better-sqlite3)
Anthropic API + Vercel AI SDK
ffmpeg（音视频处理）

## 明确不要
Docker、Redis、向量数据库、状态管理库、单元测试、认证系统。
引入任何新依赖前先问我。

## 数据模型要点（不要简化掉）
- answers 表必须有 version + parent_id，形成版本链，不要覆盖更新
- questions 表要有 cluster_id，用于相似问题归类
- interview_qas 必须能外键关联回 questions，这是数据闭环的关键
- inbox_items 要有 raw 字段存完整原始 JSON 备份

## 工作方式
- 一次只做一个功能，做完停下来让我验证
- 改动超过 3 个文件前，先说明计划
- 不要自作主张重构我已经验证过的代码
