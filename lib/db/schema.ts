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
  /**
   * 视频笔记在采集当下抽好的帧（本地文件路径 JSON 数组）。
   * 小红书视频直链带签名会过期，事后再去拉是 403，只能采集时就抓。
   */
  frames: text("frames").notNull().default("[]"),
  /** 采集当下存下来的视频文件路径 */
  mediaPath: text("media_path"),
  /** 视频转出来的文字 */
  transcript: text("transcript"),
  /**
   * 抽完之后的核对结果，JSON 数组：漏抽的和多抽的。
   * 空数组 = 这一轮没查出问题；null = 还没核过。
   * 页面上会把有问题的素材标出来——不标的话，
   * 使用者没法知道自己看到的是不是完整的
   */
  audit: text("audit"),
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
  /**
   * generalist：偏通用的 AI 产品经理，多家 JD 共性很强，该合成一个画像。
   * domain：绑定某个业务域（搜索、导购、内容生成），要求不一样，单独成画像。
   * 分开是因为出题时的侧重完全不同——通用画像考通用能力，
   * 领域画像还要考这个域的专门知识。
   */
  kind: text("kind", { enum: ["generalist", "domain"] }).notNull().default("generalist"),
  /** domain 画像绑的业务域，如「搜索推荐」「AI导购」。generalist 为空 */
  domain: text("domain"),
  /**
   * 各家 JD 的差异点，JSON 数组。
   * 聚合成一个画像会抹掉细节，但「米哈游特别看重游戏化场景」这种
   * 是面试时真会被问到的，得留住
   */
  variance: text("variance").notNull().default("[]"),
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
  /** 判定为重复时指向保留的那条。标记而不删除，判错了还能捞回来 */
  mergedInto: integer("merged_into"),
  /** 追问挂在主问题下。null 表示这本身就是主问题 */
  parentId: integer("parent_id"),
  /** 从哪条 inbox 素材消化出来的，用于回溯来源和统计 */
  inboxItemId: integer("inbox_item_id").references(() => inboxItems.id, {
    onDelete: "set null",
  }),
  /**
   * 二级分类。一级见 topic_l1。
   * 之前只有这一层，结果「意图识别」和「AI产品与应用实践」并排成了同级，
   * 但前者其实是后者的子集——分不出层次，扫读时就没有秩序。
   */
  topic: text("topic"),
  /** 一级分类。固定集合优先，模型可新建，见 lib/taxonomy.ts */
  topicL1: text("topic_l1"),
  /**
   * universal：换个岗位也会问（为什么想做 AI PM、讲一个你做过的项目、经历深挖）。
   * domain：某个领域特有（AI 搜索的评测怎么设计）。
   * 分开是因为两者的复用方式不一样——universal 的定稿答案跨岗位直接拿来用，
   * domain 的得重新想怎么从已有经历迁移过去。
   */
  scope: text("scope", { enum: ["universal", "domain"] }),
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
  /**
   * keeper = 定稿，这道题就按这版讲。一道题同时只有一版是 keeper。
   * 版本链全留着，只是标出哪一版是要用的那版
   */
  status: text("status", { enum: ["draft", "keeper"] }).notNull().default("draft"),
  /** 语音陪练时说出来的原话（转写）。定稿往往是打磨过的书面版，口语版另存 */
  spokenTranscript: text("spoken_transcript"),
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

// ---- 模块 E：外部情报消化 ----

/**
 * 从 inbox 素材里嚼出来的可用知识。
 * 面试题不进这里——那些直接进 questions 表（source='inbox'），
 * 这里放的是"怎么答"和"这家公司什么情况"这类参考。
 */
export const insights = sqliteTable("insights", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  inboxItemId: integer("inbox_item_id")
    .notNull()
    .references(() => inboxItems.id, { onDelete: "cascade" }),
  kind: text("kind", {
    enum: ["approach", "company", "term", "pitfall"],
  })
    .notNull()
    .default("approach"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  /** 关联的公司名，没有就 null */
  company: text("company"),
  /** 二级分类。挂在题上的跟随题走，没挂题的进 playbook 按 kind 分组 */
  topic: text("topic"),
  /** 一级分类，见 lib/taxonomy.ts */
  topicL1: text("topic_l1"),
  /**
   * 这条答法回答的是哪道题。
   * approach 类必须尽量挂上，否则用户看到一条悬空的答法，
   * 不知道什么场景下该想到它。pitfall/company/term 这类通用的可以为空。
   */
  questionId: integer("question_id").references(() => questions.id, {
    onDelete: "set null",
  }),
  /** 被归并掉的指向留存的那条；非 null 表示这条是重复项，不展示 */
  mergedInto: integer("merged_into"),
  /** 能力标签，和 experiences.tags 对齐，JSON 数组 */
  tags: text("tags").notNull().default("[]"),
  /**
   * 出处原文。digest 只做提取整合、不做补充，所以每条都得指得出来源：
   * text 类存程序按行号截出来的原文，image 类存"图 N"。
   * 之前没有这个字段，模型在一条只有题目没有答案的清单上
   * 自己写出了 24 条"别人的答法"，看起来像情报其实是通用知识。
   */
  evidence: text("evidence"),
  /** 出处类型：text（正文/转写）或 image（图片/视频帧） */
  evidenceKind: text("evidence_kind", { enum: ["text", "image"] }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type Insight = typeof insights.$inferSelect;
export type NewInsight = typeof insights.$inferInsert;

/**
 * 一个岗位画像底下挂的原始 JD。
 *
 * 之前一份 JD 一个画像，贴了四份 AI 产品经理的 JD 就出来四个同名 tab，
 * 又重复又没提炼出共性。改成多份 JD 聚合成一个画像，原文都留着——
 * 聚合是有损的，回头要核对某家具体怎么写的还得看原文。
 */
export const roleJds = sqliteTable("role_jds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roleId: integer("role_id")
    .notNull()
    .references(() => roleProfiles.id, { onDelete: "cascade" }),
  company: text("company"),
  title: text("title"),
  rawJd: text("raw_jd").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

export type RoleJd = typeof roleJds.$inferSelect;
export type NewRoleJd = typeof roleJds.$inferInsert;
