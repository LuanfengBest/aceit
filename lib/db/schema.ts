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

// ---- 模块 C：问答打磨 ----

/** 一道面试题。cluster_id 用于把措辞不同但本质相同的问题归到一起 */
export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roleId: integer("role_id").references(() => roleProfiles.id, {
    onDelete: "set null",
  }),
  text: text("text").notNull(),
  kind: text("kind", {
    enum: ["behavioral", "technical", "case", "resume", "other"],
  })
    .notNull()
    .default("other"),
  /** 这题为什么会被问：对应岗位的哪条要求 / 你简历里的哪个点 */
  rationale: text("rationale"),
  /** 相似问题归为同一簇，簇内共享打磨成果 */
  clusterId: text("cluster_id"),
  source: text("source", { enum: ["role", "material", "inbox", "manual"] })
    .notNull()
    .default("role"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/** 答案版本链：每次打磨插新行，parent_id 指向上一版，永不覆盖 */
export const answers = sqliteTable("answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  questionId: integer("question_id")
    .notNull()
    .references(() => questions.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  version: integer("version").notNull().default(1),
  parentId: integer("parent_id"),
  /** 这一版是怎么来的：initial / 打磨指令原文 */
  note: text("note"),
  /** 这版答案调用了哪几条经历，JSON 数组存 experiences.id */
  usedExperienceIds: text("used_experience_ids").notNull().default("[]"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ---- 模块 D：面试复盘 ----

/** 真实面试里被问到的一题。question_id 外键回问题库，这是数据闭环 */
export const interviewQas = sqliteTable("interview_qas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** 匹配到问题库里的哪一题；没匹配上就是 null（= 没准备过的题） */
  questionId: integer("question_id").references(() => questions.id, {
    onDelete: "set null",
  }),
  roleId: integer("role_id").references(() => roleProfiles.id, {
    onDelete: "set null",
  }),
  company: text("company"),
  round: text("round"),
  /** 面试官实际问法 */
  askedText: text("asked_text").notNull(),
  /** 我当时怎么答的 */
  myAnswer: text("my_answer"),
  /** 复盘：哪里没答好 */
  reflection: text("reflection"),
  interviewedAt: text("interviewed_at"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Question = typeof questions.$inferSelect;
export type NewQuestion = typeof questions.$inferInsert;
export type Answer = typeof answers.$inferSelect;
export type NewAnswer = typeof answers.$inferInsert;
export type InterviewQa = typeof interviewQas.$inferSelect;
export type NewInterviewQa = typeof interviewQas.$inferInsert;
