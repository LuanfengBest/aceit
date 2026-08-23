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

## 部署步骤（Railway）

仓库里已经放好 `railway.json` 和 `nixpacks.toml`，构建和启动命令
不用自己填。

1. railway.app 用 GitHub 登录，New Project → Deploy from GitHub repo，
   选这个仓库
2. Variables 里加上面那几个环境变量（`ANTHROPIC_API_KEY` 是你自己的）
3. Settings → Networking → Generate Domain，拿到公网链接
4. 等构建完成，打开链接

**第一次启动会自己造演示库**（`scripts/ensure-demo-db.mjs`），
不用手动跑 seed。

要让访客的数据在重新部署后还留着，再加一块 Volume 挂到 `/app/data`；
不加也能跑，只是每次部署库会重建成初始状态——对演示站来说这反而省事。

## 花多少钱

两笔分开看：

- **主机**：Railway 每月送 5 美元额度。一个 Next 进程 + 一个 SQLite 文件很轻，
  大概率在免费额度内
- **模型**：访客每点一次「出题」都在花你的 Anthropic 余额。
  全站每天 800 点、全用 Haiku 的话，**每天上限大约几毛到一块钱**，
  而且要真有人跑满才到得了

嫌贵就把 `DEMO_GLOBAL_DAILY_CALLS` 调小。或者干脆不设
`ANTHROPIC_API_KEY`——那样浏览和查看全都正常，只是点「出题」会报错。

## 演示库会被访客改脏

访客出的题、练的答案都会写进 demo.db。这是有意的——
让人能真的用。攒乱了就重跑一次 seed 覆盖掉。

要定期自动重置，加一个每天跑一次的定时任务执行 seed 即可。
