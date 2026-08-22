CREATE TABLE `experiences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`doc_id` integer NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`doc_id`) REFERENCES `profile_docs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `profile_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text DEFAULT 'other' NOT NULL,
	`filename` text NOT NULL,
	`raw_text` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
