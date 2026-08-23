import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// 演示站用另一份库（不含任何真实内容），本地跑还是 aceit.db。
// 走环境变量而不是判断 DEMO_MODE，是为了本地也能临时切过去验证
const DB_FILE = process.env.DB_FILE ?? "data/aceit.db";

type DB = ReturnType<typeof drizzle<typeof schema>>;
let cached: DB | null = null;

function connect(): DB {
  if (cached) return cached;

  const file = path.join(process.cwd(), DB_FILE);
  // data/ 在 .gitignore 里，而 git 不追踪空目录——容器里 COPY 完
  // 根本没有这个目录，直接开库会是 "directory does not exist"
  mkdirSync(path.dirname(file), { recursive: true });

  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  // SQLite 默认不校验外键，每个连接都得单独打开；
  // 不开的话 experiences.doc_id 的 cascade 删除不会触发，会留下孤儿行
  sqlite.pragma("foreign_keys = ON");

  cached = drizzle(sqlite, { schema });
  return cached;
}

/**
 * 第一次真的查询时才连库。
 *
 * 之前是在模块顶层就 new Database()。构建时 Next 要「收集页面数据」，
 * 会把每个路由模块都加载一遍——每加载一次就开一次库，而那时候
 * 库还没建好。表现是第一次构建失败、第二次成功，比稳定失败更难查。
 *
 * 延迟之后，构建阶段只是加载代码，不碰文件系统。
 */
export const db: DB = new Proxy({} as DB, {
  get(_t, prop, receiver) {
    return Reflect.get(connect() as object, prop, receiver);
  },
});
