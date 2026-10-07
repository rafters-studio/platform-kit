-- Vouching recovery: a request started on the user's own device, and the members' approvals of it.
-- The device's secret is stored only as a hash; the request code alone grants nothing.
create table "vouchRequest" ("id" text not null primary key, "userId" text not null references "user" ("id") on delete cascade, "code" text not null unique, "secretHash" text not null, "createdAt" date not null, "readyAt" date not null, "expiresAt" date not null);

create table "vouchApproval" ("id" text not null primary key, "requestId" text not null references "vouchRequest" ("id") on delete cascade, "memberUserId" text not null references "user" ("id") on delete cascade, "createdAt" date not null);

create unique index "vouchApproval_request_member_idx" on "vouchApproval" ("requestId", "memberUserId");

create index "vouchRequest_userId_idx" on "vouchRequest" ("userId");
