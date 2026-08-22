CREATE TABLE `role_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`company` text,
	`raw_jd` text NOT NULL,
	`responsibilities` text DEFAULT '[]' NOT NULL,
	`requirements` text DEFAULT '[]' NOT NULL,
	`nice_to_have` text DEFAULT '[]' NOT NULL,
	`keywords` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
