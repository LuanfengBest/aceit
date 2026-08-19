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
