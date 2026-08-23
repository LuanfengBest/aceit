ALTER TABLE `answers` ADD `status` text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE `answers` ADD `spoken_transcript` text;--> statement-breakpoint
ALTER TABLE `questions` ADD `scope` text;