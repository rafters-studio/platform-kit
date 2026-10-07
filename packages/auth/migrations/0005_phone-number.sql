-- The phone number recovery channel: a number, usable for recovery only once verified.
alter table "user" add column "phoneNumber" text;

alter table "user" add column "phoneNumberVerified" integer not null default 0;

create unique index "user_phoneNumber_uidx" on "user" ("phoneNumber");
