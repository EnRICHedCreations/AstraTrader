CREATE TABLE `locks` (
	`id` text PRIMARY KEY NOT NULL,
	`until` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`at` integer NOT NULL,
	`body` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `records_kind_at` ON `records` (`kind`,`at`);--> statement-breakpoint
CREATE TABLE `state` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL
);
