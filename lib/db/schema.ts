import { sql } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const inboxItems = sqliteTable("inbox_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull().default("xiaohongshu"),
  sourceId: text("source_id").notNull().unique(),
  sourceUrl: text("source_url"),
  type: text("type", { enum: ["normal", "video"] })
    .notNull()
    .default("normal"),
  title: text("title"),
  desc: text("desc"),
  author: text("author"),
  images: text("images"),
  videoUrl: text("video_url"),
  tags: text("tags"),
  publishedAt: text("published_at"),
  raw: text("raw").notNull(),
  status: text("status", { enum: ["pending", "processed", "failed"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type InboxItem = typeof inboxItems.$inferSelect;
export type NewInboxItem = typeof inboxItems.$inferInsert;

// ---- 模块 A：个人素材层 ----

/** 上传的原始文档，raw_text 存全文，永远不删原文 */
export const profileDocs = sqliteTable("profile_docs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type", { enum: ["resume", "experience", "other"] })
    .notNull()
    .default("other"),
  filename: text("filename").notNull(),
  rawText: text("raw_text").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** 从文档里拆出来的独立经历片段。拆得越碎越好，后面按问题类型精准取用 */
export const experiences = sqliteTable("experiences", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  docId: integer("doc_id")
    .notNull()
    .references(() => profileDocs.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  detail: text("detail").notNull(),
  /** JSON 数组字符串，如 ["项目管理","数据分析"] */
  tags: text("tags").notNull().default("[]"),
  /** 这条经历被哪几份文档提到过（文件名 JSON 数组）。同一件事写在简历和经历文档里，合并成一条 */
  sources: text("sources").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type ProfileDoc = typeof profileDocs.$inferSelect;
export type NewProfileDoc = typeof profileDocs.$inferInsert;
export type Experience = typeof experiences.$inferSelect;
export type NewExperience = typeof experiences.$inferInsert;

// ---- 模块 B：岗位画像 ----

/** 一个目标岗位。raw_jd 存 JD 原文，其余是模型抽出来的结构 */
export const roleProfiles = sqliteTable("role_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  company: text("company"),
  rawJd: text("raw_jd").notNull(),
  /** 核心职责，JSON 字符串数组 */
  responsibilities: text("responsibilities").notNull().default("[]"),
  /** 硬性要求，JSON 字符串数组 */
  requirements: text("requirements").notNull().default("[]"),
  /** 加分项，JSON 字符串数组 */
  niceToHave: text("nice_to_have").notNull().default("[]"),
  /** 能力关键词，JSON 字符串数组。用来和 experiences.tags 对齐 */
  keywords: text("keywords").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoleProfile = typeof roleProfiles.$inferSelect;
export type NewRoleProfile = typeof roleProfiles.$inferInsert;
