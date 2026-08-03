CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'task' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`link` text,
	`for_date` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`xp_on_complete` integer DEFAULT 0 NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `agent_properties` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`kind` text DEFAULT 'counter' NOT NULL,
	`value` real,
	`text_value` text,
	`unit` text,
	`description` text,
	`created_by` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_properties_key_unique` ON `agent_properties` (`key`);--> statement-breakpoint
CREATE TABLE `dashboard_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`slot` integer NOT NULL,
	`kind` text DEFAULT 'task' NOT NULL,
	`purpose` text,
	`activity_tag` text,
	`show_at` text,
	`remind_at` text,
	`event_at` text,
	`duration_minutes` integer,
	`repeat_rule` text DEFAULT 'none' NOT NULL,
	`repeat_index` integer DEFAULT 0 NOT NULL,
	`repeat_offsets_json` text,
	`sound` integer DEFAULT true NOT NULL,
	`flash` integer DEFAULT true NOT NULL,
	`notified_at` text,
	`linked_block_id` text,
	`title` text NOT NULL,
	`subtitle` text,
	`body` text,
	`emoji` text DEFAULT '📌',
	`theme_color` text DEFAULT '#5B8CFF',
	`image_url` text,
	`image_data` text,
	`svg` text,
	`status` text DEFAULT 'active' NOT NULL,
	`progress` integer DEFAULT 0,
	`cta_label` text,
	`cta_link` text,
	`meta_json` text,
	`xp_on_complete` integer DEFAULT 0 NOT NULL,
	`webhook_on_complete` integer DEFAULT true NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `active_sessions` ADD `block_id` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `owner_kind` text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `condition_json` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `auto_check` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `condition_met_at` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `celebration_seen_at` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `condition_detail_json` text;--> statement-breakpoint
ALTER TABLE `goals` ADD `emoji` text DEFAULT '🎯' NOT NULL;--> statement-breakpoint
ALTER TABLE `goals` ADD `theme_color` text DEFAULT '#A78BFA' NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `extra_xp` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `habits` ADD `xp_weight` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `light_reviews` ADD `link` text;--> statement-breakpoint
ALTER TABLE `schedule_blocks` ADD `status` text DEFAULT 'planned' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_blocks` ADD `source` text DEFAULT 'agent' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_blocks` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `schedule_blocks` ADD `completed_at` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `day_reset_time` text DEFAULT '04:00' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `agent_webhook_url` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `agent_webhook_secret` text;--> statement-breakpoint
ALTER TABLE `settings` ADD `backups_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `backup_interval_hours` integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `backup_keep` integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `last_backup_at` text;