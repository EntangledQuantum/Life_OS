CREATE TABLE `achievements` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`emoji` text DEFAULT '🏆' NOT NULL,
	`xp_bonus` integer DEFAULT 0 NOT NULL,
	`unlocked_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `achievements_key_unique` ON `achievements` (`key`);--> statement-breakpoint
CREATE TABLE `active_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`activity` text NOT NULL,
	`started_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token` text NOT NULL,
	`username` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_sessions_token_unique` ON `auth_sessions` (`token`);--> statement-breakpoint
CREATE TABLE `daily_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`total_xp_earned` integer DEFAULT 0 NOT NULL,
	`habits_completed_count` integer DEFAULT 0 NOT NULL,
	`study_minutes` integer DEFAULT 0 NOT NULL,
	`sleep_score` real,
	`consistency_pct` real DEFAULT 0 NOT NULL,
	`improvement_pulse` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `daily_snapshots_date_unique` ON `daily_snapshots` (`date`);--> statement-breakpoint
CREATE TABLE `gamification_config` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`config_json` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `goal_habit_links` (
	`id` text PRIMARY KEY NOT NULL,
	`goal_id` text NOT NULL,
	`habit_id` text NOT NULL,
	FOREIGN KEY (`goal_id`) REFERENCES `goals`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `goals` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'active' NOT NULL,
	`target_date` text,
	`why_it_matters` text,
	`progress_pct` real DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `habit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`habit_id` text NOT NULL,
	`completed_at` text NOT NULL,
	`note` text,
	`source` text DEFAULT 'user' NOT NULL,
	`xp_awarded` integer DEFAULT 0 NOT NULL,
	`undone_at` text,
	FOREIGN KEY (`habit_id`) REFERENCES `habits`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `habits` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`emoji` text DEFAULT '✨' NOT NULL,
	`category` text DEFAULT 'Custom' NOT NULL,
	`frequency_rule` text DEFAULT 'daily' NOT NULL,
	`preferred_time_window` text,
	`anchor` text,
	`linked_goal_id` text,
	`is_tiny` integer DEFAULT true NOT NULL,
	`base_xp` integer DEFAULT 15 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`notes` text,
	`theme_color` text DEFAULT '#5B8CFF' NOT NULL,
	`theme_graphic` text DEFAULT 'ring' NOT NULL,
	`icon_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE TABLE `light_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`prompt` text NOT NULL,
	`for_date` text NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `quests` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`target_count` integer DEFAULT 1 NOT NULL,
	`progress_count` integer DEFAULT 0 NOT NULL,
	`xp_bonus` integer DEFAULT 50 NOT NULL,
	`for_date` text,
	`completed_at` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule_blocks` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`category` text NOT NULL,
	`label` text NOT NULL,
	`planned_start` text,
	`planned_end` text,
	`actual_start` text,
	`actual_end` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`gamification_enabled` integer DEFAULT true NOT NULL,
	`streaks_enabled` integer DEFAULT true NOT NULL,
	`points_enabled` integer DEFAULT true NOT NULL,
	`achievements_enabled` integer DEFAULT true NOT NULL,
	`quests_enabled` integer DEFAULT true NOT NULL,
	`celebration_intensity` text DEFAULT 'full' NOT NULL,
	`accent_theme` text DEFAULT 'nebula' NOT NULL,
	`reduced_motion` integer DEFAULT false NOT NULL,
	`planned_wake` text DEFAULT '11:00' NOT NULL,
	`planned_sleep_start` text DEFAULT '02:00' NOT NULL,
	`planned_sleep_end` text DEFAULT '03:00' NOT NULL,
	`quiet_hours_start` text DEFAULT '03:30' NOT NULL,
	`quiet_hours_end` text DEFAULT '10:30' NOT NULL,
	`storage_mode` text DEFAULT 'local' NOT NULL,
	`supabase_url` text,
	`supabase_key` text,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sleep_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`planned_wake` text,
	`planned_sleep_start` text,
	`actual_wake` text,
	`actual_sleep` text,
	`sleep_quality` integer,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `special_event_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`ref_id` text,
	`summary` text NOT NULL,
	`created_at` text NOT NULL,
	`reviewed_at` text
);
--> statement-breakpoint
CREATE TABLE `study_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`linked_book_slug` text,
	`linked_concept_slug` text,
	`duration_minutes` integer,
	`pages` integer,
	`quality_flag` text DEFAULT 'normal' NOT NULL,
	`note` text,
	`generated_summary` text,
	`source` text DEFAULT 'user' NOT NULL,
	`xp_awarded` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_progress` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`total_xp` integer DEFAULT 0 NOT NULL,
	`current_level` integer DEFAULT 1 NOT NULL,
	`last_improvement_pulse` text DEFAULT 'Stable' NOT NULL,
	`updated_at` text NOT NULL
);
