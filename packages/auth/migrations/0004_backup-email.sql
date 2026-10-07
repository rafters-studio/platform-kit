-- The backup email recovery channel: a second address, usable for recovery only once verified.
alter table "user" add column "backupEmail" text;

alter table "user" add column "backupEmailVerified" integer not null default 0;
