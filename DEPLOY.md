# 部署演示站

演示站跑的是**同一套代码**，只是换了数据库、开了限额、关掉了依赖本地二进制的功能。

## 为什么不是 Vercel

三个东西需要真实文件系统：

- `better-sqlite3` 是本地文件数据库
- `ffmpeg` / `whisper-cli` 是本地二进制
- 录音存 `data/recordings/`

serverless 没有持久磁盘，所以要一台**有磁盘的 Node 主机**：
Railway、Render、Fly.io 都行。

## 环境变量

```
DEMO_MODE=1
DB_FILE=data/demo.db
ANTHROPIC_API_KEY=...
DEMO_DAILY_CALLS=40          # 每个访客每天的额度
DEMO_GLOBAL_DAILY_CALLS=800  # 全站每天的总上限
```

`DEMO_MODE=1` 会打开 `middleware.ts` 里的闸门：

- 按路径记额度。不是每次调用都一样贵——消化一条面经算 10 点，
  答一道题算 2 点，模拟面试一轮算 1 点
- `/api/recordings/*` 和 `/api/live/transcribe` 直接返回
  「这部分需要本地的 whisper」，而不是让人点了之后干等超时
- 响应头带 `x-demo-remaining`，前端可以显示还剩多少

不设 `DEMO_MODE` 就是完整的本地版，闸门整个不生效。

## 演示数据

```bash
npx tsx scripts/seed-demo.ts data/demo.db
```

生成一份**完全虚构**的库：一个做客服 Agent 和推荐链路的候选人，
覆盖五层的每一层。跑之前确认 `data/aceit.db`（真实数据）
**没有**被打包进部署产物——`.gitignore` 里已经排除了 `data/`，
demo.db 要单独在构建时生成或手动上传。

## 部署步骤（以 Railway 为例）

1. 连仓库，Build 命令 `npm run build`，Start 命令 `npm start`
2. 加一块持久磁盘，挂到 `/app/data`
3. 设上面那几个环境变量
4. 首次部署后在容器里跑一次 seed：
   `npx tsx scripts/seed-demo.ts data/demo.db`

## 演示库会被访客改脏

访客出的题、练的答案都会写进 demo.db。这是有意的——
让人能真的用。攒乱了就重跑一次 seed 覆盖掉。

要定期自动重置，加一个每天跑一次的定时任务执行 seed 即可。
