CREATE TABLE `inbox_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text DEFAULT 'xiaohongshu' NOT NULL,
	`source_id` text NOT NULL,
	`source_url` text,
	`type` text DEFAULT 'normal' NOT NULL,
	`title` text,
	`desc` text,
	`author` text,
	`images` text,
	`video_url` text,
	`tags` text,
	`published_at` text,
	`raw` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inbox_items_source_id_unique` ON `inbox_items` (`source_id`);