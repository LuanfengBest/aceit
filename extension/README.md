# aceit 小红书采集扩展

## 安装
1. Chrome 打开 `chrome://extensions`，右上角开「开发者模式」
2. 点「加载已解压的扩展程序」，选这个 `extension/` 目录
3. 改代码后回到该页面点扩展卡片上的刷新按钮，再刷新小红书页面

## 用法
1. 本地起 aceit：`npm run dev`（需要 http://localhost:3000 在跑）
2. 打开一篇小红书笔记详情页，按 `Cmd+Shift+S`
3. 右上角出现绿色「已保存 / 已更新」即成功；红色是失败原因

## 结构
- `content.js` — 隔离世界：注入桥接脚本、收数据、POST `/api/inbox`、弹提示
- `injected.js` — 主世界：读 `window.__INITIAL_STATE__.note.noteDetailMap`，postMessage 回传
- 同一 `noteId` 重复采集会走 API 的 upsert，更新原记录而不是新增
