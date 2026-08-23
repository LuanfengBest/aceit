/**
 * 演示站启动前确保有一份库。
 *
 * Railway 这类平台每次部署都是新容器。挂了持久盘的话库会留着，
 * 没挂盘就每次重建——两种都能跑，不用改配置。
 */
import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const file = process.env.DB_FILE ?? "data/demo.db";
const abs = path.join(process.cwd(), file);

mkdirSync(path.dirname(abs), { recursive: true });

if (existsSync(abs)) {
  console.log(`[demo] 库已存在，直接启动：${file}`);
} else {
  console.log(`[demo] 没有库，先生成一份：${file}`);
  // 用本地 node_modules 里的 tsx，不走 npx——
  // 容器里没有 npx 缓存，现下载会失败
  const bin = path.join(process.cwd(), "node_modules", ".bin", "tsx");
  const r = spawnSync(bin, ["scripts/seed-demo.ts", file], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    console.error("[demo] 生成失败，服务仍会启动，但页面会是空的");
  }
}
