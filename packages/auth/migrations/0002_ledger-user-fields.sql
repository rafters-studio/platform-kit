-- requires: ledger
-- The user fields ledger's soft delete writes.
alter table "user" add column "deletedAt" date;

alter table "user" add column "deletedBy" text;
