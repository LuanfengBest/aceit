CREATE TABLE `insights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`inbox_item_id` integer NOT NULL,
	`kind` text DEFAULT 'approach' NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`company` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`inbox_item_id`) REFERENCES `inbox_items`(`id`) ON UPDATE no action ON DELETE cascade
);
