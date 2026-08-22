import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

const sqlite = new Database(path.join(process.cwd(), "data", "aceit.db"));
sqlite.pragma("journal_mode = WAL");
// SQLite 默认不校验外键，每个连接都得单独打开；
// 不开的话 experiences.doc_id 的 cascade 删除不会触发，会留下孤儿行
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
