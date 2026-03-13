CREATE TABLE `chat_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` integer NOT NULL,
	`patient_id` integer NOT NULL,
	`joined_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_chat_members_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`),
	CONSTRAINT `fk_chat_members_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)
);
--> statement-breakpoint
CREATE TABLE `chats` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`telegram_chat_id` integer NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `check_in_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`interval_days` integer DEFAULT 3 NOT NULL,
	`last_check_in_at` integer,
	`unanswered_count` integer DEFAULT 0 NOT NULL,
	`last_modified_by` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_check_in_preferences_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`)
);
--> statement-breakpoint
CREATE TABLE `clinical_artifacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` integer NOT NULL,
	`patient_id` integer,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`verbatim_quote` text,
	`clinical_relevance` integer DEFAULT 5,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_clinical_artifacts_session_id_therapy_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `therapy_sessions`(`id`),
	CONSTRAINT `fk_clinical_artifacts_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`),
	CONSTRAINT "clinical_relevance_range" CHECK(clinical_relevance >= 1 AND clinical_relevance <= 10)
);
--> statement-breakpoint
CREATE TABLE `grammy_sessions` (
	`key` text PRIMARY KEY,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `onboardings` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` integer,
	`patient_id` integer,
	`type` text NOT NULL,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`sdk_session_id` text(256),
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_onboardings_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`),
	CONSTRAINT `fk_onboardings_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)
);
--> statement-breakpoint
CREATE TABLE `patients` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`telegram_id` integer NOT NULL,
	`first_name` text(256),
	`username` text(256),
	`date_of_birth` text(10),
	`gender` text(64),
	`preferred_language` text(10),
	`onboardingComplete` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`session_id` integer NOT NULL,
	`patient_id` integer,
	`role` text(20) NOT NULL,
	`content` text NOT NULL,
	`sender_telegram_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	CONSTRAINT `fk_session_messages_session_id_therapy_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `therapy_sessions`(`id`),
	CONSTRAINT `fk_session_messages_patient_id_patients_id_fk` FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`)
);
--> statement-breakpoint
CREATE TABLE `therapy_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`chat_id` integer NOT NULL,
	`sdk_session_id` text(256),
	`type` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_message_at` integer DEFAULT (unixepoch()) NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`transcript_path` text(512) NOT NULL,
	`soap_note_path` text(512),
	CONSTRAINT `fk_therapy_sessions_chat_id_chats_id_fk` FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chat_members_chat_id_patient_id_idx` ON `chat_members` (`chat_id`,`patient_id`);--> statement-breakpoint
CREATE INDEX `chat_members_patient_id_idx` ON `chat_members` (`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chats_telegram_chat_id_idx` ON `chats` (`telegram_chat_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `check_in_preferences_chat_id_idx` ON `check_in_preferences` (`chat_id`);--> statement-breakpoint
CREATE INDEX `artifacts_session_id_created_at_idx` ON `clinical_artifacts` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `artifacts_patient_id_created_at_idx` ON `clinical_artifacts` (`patient_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `artifacts_type_idx` ON `clinical_artifacts` (`type`);--> statement-breakpoint
CREATE INDEX `onboardings_patient_id_status_idx` ON `onboardings` (`patient_id`,`status`);--> statement-breakpoint
CREATE INDEX `onboardings_chat_id_status_idx` ON `onboardings` (`chat_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `patients_telegram_id_idx` ON `patients` (`telegram_id`);--> statement-breakpoint
CREATE INDEX `messages_session_id_timestamp_idx` ON `session_messages` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_chat_id_started_at_idx` ON `therapy_sessions` (`chat_id`,`started_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_sdk_session_id_idx` ON `therapy_sessions` (`sdk_session_id`);