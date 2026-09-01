-- The single bootstrap user. Its id is fixed so that every environment uses
-- the same value in the X-User-Id header. Migrations are neither re-run nor
-- edited, so this row is permanent; add further users with a plain INSERT.
insert into "users" ("id", "email")
values ('00000000-0000-4000-8000-000000000001', 'owner@jobseeker.local')
on conflict ("email") do nothing;
