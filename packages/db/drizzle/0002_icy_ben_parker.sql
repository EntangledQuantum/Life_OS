ALTER TABLE `settings` ADD `notification_sound` text DEFAULT 'chime' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `do_not_disturb` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `quiet_hours_silent` integer DEFAULT true NOT NULL;