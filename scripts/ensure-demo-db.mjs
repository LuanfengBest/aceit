/**
 * 演示站启动前确保有一份库。
 *
 * Railway 这类平台每次部署都是新容器。挂了持久盘的话库会留着，
 * 没挂盘就每次重建——两种都能跑，不用改配置。
 */
import { existsSync, mkdirSync, rmSync } from "node:fs";
import Database from "better-sqlite3";
import { spawnSync } from "node:child_process";
import path from "node:path";

const file = process.env.DB_FILE ?? "data/demo.db";
const abs = path.join(process.cwd(), file);

mkdirSync(path.dirname(abs), { recursive: true });

/**
 * 光看文件在不在不够：构建阶段 Next 加载路由模块时会打开数据库，
 * better-sqlite3 会顺手创建一个**空文件**。
 * 那时候表还没建，直接启动就是满屏 no such table。
 * 所以要看里面到底有没有表。
 */
function hasTables(p) {
  if (!existsSync(p)) return false;
  try {
    const db = new Database(p, { readonly: true });
    const row = db
      .prepare("select count(*) c from sqlite_master where type='table'")
      .get();
    db.close();
    return row.c > 3; // 少于几张表说明是空壳或只有元数据表
  } catch {
    return false;
  }
}

if (hasTables(abs)) {
  console.log(`[demo] 库已存在，直接启动：${file}`);
} else {
  console.log(`[demo] 库不存在或是空壳，重新生成：${file}`);
  rmSync(abs, { force: true });
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
