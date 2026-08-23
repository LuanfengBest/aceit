CREATE TABLE `recordings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_id` integer,
	`company` text,
	`round` text,
	`media_path` text NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	`transcript` text,
	`status` text DEFAULT 'recorded' NOT NULL,
	`error` text,
	`interviewed_at` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `role_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
