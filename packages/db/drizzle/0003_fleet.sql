CREATE TABLE `access_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`username` text NOT NULL,
	`secret` text,
	`private_key` text,
	`public_key` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_profiles_name_unique` ON `access_profiles` (`name`);--> statement-breakpoint
CREATE TABLE `host_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_id` integer NOT NULL,
	`at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`kind` text NOT NULL,
	`product_id` text,
	`from_version` text,
	`to_version` text,
	`poll_state` text,
	`message` text,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `host_events_host` ON `host_events` (`host_id`,`at`);--> statement-breakpoint
CREATE TABLE `hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`board_id` integer NOT NULL,
	`name` text NOT NULL,
	`address` text NOT NULL,
	`port` integer,
	`kind` text NOT NULL,
	`access_profile_id` integer,
	`poll_state` text DEFAULT 'pending' NOT NULL,
	`poll_since` text,
	`last_attempt_at` text,
	`last_success_at` text,
	`poll_error_code` text,
	`poll_error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL,
	FOREIGN KEY (`board_id`) REFERENCES `boards`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`access_profile_id`) REFERENCES `access_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_name_unique` ON `hosts` (`name`);--> statement-breakpoint
CREATE INDEX `hosts_board` ON `hosts` (`board_id`);--> statement-breakpoint
ALTER TABLE `instances` ADD `host_id` integer REFERENCES hosts(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `instances` ADD `read_raw` text;--> statement-breakpoint
CREATE INDEX `instances_host` ON `instances` (`host_id`);