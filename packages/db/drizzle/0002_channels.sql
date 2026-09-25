CREATE TABLE `channels` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`config` text NOT NULL,
	`events` text NOT NULL,
	`lang` text DEFAULT 'en' NOT NULL,
	`digest_day` integer,
	`enabled` integer DEFAULT true NOT NULL,
	`state` text,
	`last_sent_at` text,
	`last_error` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')) NOT NULL
);
