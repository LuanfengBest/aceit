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

## 视觉规范

### 基调
暖调编辑感。参考 Giga / Perplexity PC / Trajectory 的气质，但落到高密度工作界面。
不做满幅摄影、不做玻璃模糊、不做巨大字号。

### 两类页面
- 工作台页（问题库 / 答案打磨 / inbox / 实时提词）：密度优先，安静，快速扫读
- 时刻页（首页进度 / 复盘报告 / 练习完成）：留白，暖色，动效，情绪奖励

### 色板
--bg:          #FBFAF7   暖米白，页面底色（不要纯白）
--surface:     #FFFFFF   卡片
--surface-2:   #F4F2ED   次级区块、hover
--border:      #E7E3DA   描边（低对比，不要灰蓝）
--text:        #1C1B18   正文（不要纯黑）
--text-muted:  #6B6862   次要信息
--ink:         #1E2A44   深靛蓝，用于时刻页反色区块和实时提词浮层
--accent:      #C4643C   陶土橘，唯一强调色，只用于主操作和关键状态
--accent-soft: #F2E4DC   强调色的浅底

### 字体
- 标题/展示：Instrument Serif（Google Fonts）。仅用于页面主标题、时刻页大字
- 正文/界面：Inter。数字启用 tabular-nums
- 字号：正文 14px / 次要 13px / 区块标题 16px / 页面标题 28px serif / 时刻页大字 40px serif
- 行高：正文 1.6，标题 1.2

### 密度与间距
- 列表行高 44px，卡片内边距 20px
- 工作台页最大宽度 1200px；时刻页最大宽度 720px 居中
- 间距用 4 的倍数

### 圆角与描边
- 卡片 8px，输入框和按钮 6px，标签 pill 全圆
- 描边一律 1px --border，不要投影堆叠

### 动效
180ms ease-out。只在状态变化和时刻页出现。工作台不要装饰性动画。

### 明确禁止
渐变背景、多层阴影、emoji 当图标、纯黑纯白、冷灰色系、
shadcn 默认蓝、任何在工作台页面上的玻璃模糊
