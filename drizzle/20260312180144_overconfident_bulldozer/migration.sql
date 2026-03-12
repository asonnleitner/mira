CREATE TABLE `check_in_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`interval_days` integer DEFAULT 3 NOT NULL,
	`last_check_in_at` integer,
	`unanswered_count` integer DEFAULT 0 NOT NULL,
	`last_modified_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `check_in_preferences_chat_id_idx` ON `check_in_preferences` (`chat_id`);