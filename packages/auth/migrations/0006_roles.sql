-- better-auth organization plugin, dynamic access control: roles are rows per organization.
create table "organizationRole" ("id" text not null primary key, "organizationId" text not null references "organization" ("id") on delete cascade, "role" text not null, "permission" text not null, "createdAt" date not null, "updatedAt" date);

create index "organizationRole_organizationId_idx" on "organizationRole" ("organizationId");

create index "organizationRole_role_idx" on "organizationRole" ("role");

-- Teams. The tables ship for every brand; only a brand with plugins.teams on gets the endpoints that use them.
create table "team" ("id" text not null primary key, "name" text not null, "memberCount" integer not null default 0, "organizationId" text not null references "organization" ("id") on delete cascade, "createdAt" date not null, "updatedAt" date);

create table "teamMember" ("id" text not null primary key, "teamId" text not null references "team" ("id") on delete cascade, "userId" text not null references "user" ("id") on delete cascade, "membershipKey" text unique, "createdAt" date);

create index "team_organizationId_idx" on "team" ("organizationId");

create index "teamMember_teamId_idx" on "teamMember" ("teamId");

create index "teamMember_userId_idx" on "teamMember" ("userId");

alter table "invitation" add column "teamId" text;

alter table "session" add column "activeTeamId" text;
