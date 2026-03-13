DROP INDEX IF EXISTS `sessions_chat_id_status_started_at_idx`;--> statement-breakpoint
CREATE INDEX `sessions_chat_id_started_at_idx` ON `therapy_sessions` (`chat_id`,`started_at`);--> statement-breakpoint
ALTER TABLE `therapy_sessions` DROP COLUMN `status`;