CREATE TABLE `role_jds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_id` integer NOT NULL,
	`company` text,
	`title` text,
	`raw_jd` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `role_profiles` ADD `kind` text DEFAULT 'generalist' NOT NULL;--> statement-breakpoint
ALTER TABLE `role_profiles` ADD `domain` text;--> statement-breakpoint
ALTER TABLE `role_profiles` ADD `variance` text DEFAULT '[]' NOT NULL;