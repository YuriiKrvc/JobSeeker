# Job sources: schema and CRUD API

Date: 2026-09-01
Status: approved design, not yet implemented

## Problem

`api/` is a scaffold with no domain code. Adding a job board must not require
a deploy, so a source is a **database row** read by one generic adapter — not a
TypeScript file per board. This reverses the "adding a source means adding one
file" decision recorded in `api/CLAUDE.md`; that file is updated as part of this
work.

JobSeeker is also **multi-user**. Every user owns their own sources, their own
blocklists, and their own postings, and no data is shared between users. This
reverses "Single user, self-hosted" in the root `CLAUDE.md`, which is updated
too.

This slice delivers the three tables and the sources CRUD API. Nothing fetches
anything yet — the adapter and the ingestion pipeline are the next slice.

## Ownership and isolation

Isolation is total: there is no instance-wide data, and no endpoint returns a
row belonging to anyone but the caller.

- **`sources.user_id` is the only ownership record.** Postings carry no owner
  column — a posting belongs to whoever owns its source. One fact stored once
  cannot drift out of agreement with itself, which is the failure mode that
  turns into a data leak. The cost is a join on every posting read.
- **The repository exposes no unscoped query.** Every method takes `userId` as a
  required parameter, so there is no ownership filter that a later query can
  forget to apply. This is a structural guard, not a database-enforced one:
  Postgres RLS was considered and rejected for the setup and debugging cost.
  Passing a wrong `userId` is still a wrong `userId`.
- **A source belonging to another user returns 404,** identical to one that does
  not exist. A 403 would confirm the id is real. The cost is that a genuine bug
  and a permission problem look the same in the logs.

### Identifying the caller

There is **no authentication in this slice.** Requests carry an `X-User-Id`
header holding a user uuid.

- Header absent or not a uuid → **400**.
- Well-formed uuid naming no user → **404**.

The existence check is a lookup per request. It is worth it: without it a typo'd
id silently returns an empty list instead of failing, and reads would appear to
work against a user that isn't there.

This header is a stand-in and **must not survive into a deployment** — any
caller can claim to be any user. Replacing it with a session is the auth slice;
one `getCurrentUserId(request)` helper is the only place that changes.

## The source model

A source is a listing page whose HTML contains N vacancies. For each vacancy the
adapter reads a title and a link, follows the link, and reads a description plus
an optional company and posted date from the detail page.

- **Page one only.** No pagination. The 30-minute schedule is expected to catch
  new postings before they scroll off the first page.
- **Plain HTTP fetch, parsed with cheerio.** No headless browser, so
  JavaScript-rendered boards are out of scope. Adding them later means a new
  fetch strategy behind the same interface, not a schema change.
- **Selectors are CSS plus an optional attribute.** A null attribute means take
  the element's text; `href` on the detail link, `datetime` on a date element.
- **Identity is the detail URL,** resolved against the listing URL to absolutize
  relative hrefs and otherwise stored verbatim. Query strings are kept, because
  some boards carry the job id there. The cost is that a board appending a
  rotating tracking parameter will re-insert every job every run; if that
  happens, the fix is a per-source strip list, added then and not before.

Two users may add the same board independently. Those are two unrelated sources
producing two unrelated sets of postings, and the pipeline will fetch that board
once per user. That duplication is the accepted price of per-user ownership; it
is a pipeline concern for the next slice, not a schema one.

## Filtering

Two blocklists apply at two different pipeline stages:

1. **Title markers** match against the listing title, *before* the detail page
   is fetched. This is the cheap pre-filter — a title rejection saves an HTTP
   request.
2. **Description markers** match against the detail body, and therefore only
   after the fetch.

Matching is **case-insensitive, whole word**. `php` blocks "PHP Developer" and
not "phpMyAdmin". Entries are single tokens; phrase matching is not supported.

Each source carries its own two lists. Each **user** carries two more, applying
across all of their own sources, concatenated with the source's at filter time.
A source may add markers but can never remove one of its owner's. There is no
instance-wide list — one user's markers must never filter another's results.

**A blocked posting is stored,** with `blocked_by` holding the word that matched,
and filtered out of search by default. Storing it means the detail page is never
re-fetched on later runs, and it makes an over-eager marker visible instead of
silently swallowing results.

## Schema

Three tables. Drizzle definitions in `src/db/schema.ts`, migrations generated
into `drizzle/`.

### `users`

```
id                         uuid pk default gen_random_uuid()
email                      text not null unique
blocked_title_words        text[] not null default '{}'
blocked_description_words  text[] not null default '{}'
created_at                 timestamptz not null default now()
updated_at                 timestamptz not null default now()
```

The per-user blocklists live **on this row rather than in a `settings` table**.
There is no other user-level setting yet, so a separate table would be a join
earning nothing. If settings grow, splitting them out is a migration.

The migration inserts one user with a **fixed uuid**, so every environment has
the same id to put in `X-User-Id`. Migrations are neither re-run nor edited, so
this row is permanent; a second user for testing isolation by hand is an
`INSERT` you write yourself.

> **Open:** the seeded email is a placeholder — `owner@jobseeker.local`. Say if
> you want a real address baked in, since it cannot be changed by editing the
> migration afterwards.

No password column. Credentials arrive with the auth slice, as its own
migration.

### `sources`

```
id                         uuid pk default gen_random_uuid()
user_id                    uuid not null references users(id)
name                       text not null
listing_url                text not null
enabled                    boolean not null default true

-- listing page
item_selector              text not null          -- one match per vacancy
title_selector             text not null
title_attr                 text
detail_url_selector        text not null
detail_url_attr            text not null default 'href'

-- detail page
description_selector       text not null
description_attr           text
company_selector           text
company_attr               text
posted_at_selector         text
posted_at_attr             text

blocked_title_words        text[] not null default '{}'
blocked_description_words  text[] not null default '{}'

request_timeout_ms         integer not null default 10000
detail_delay_ms            integer not null default 1000
max_items_per_run          integer not null default 100

last_run_at                timestamptz
last_success_at            timestamptz
last_error                 text

deleted_at                 timestamptz
created_at                 timestamptz not null default now()
updated_at                 timestamptz not null default now()
```

Selectors are **flat columns, not a jsonb blob**, so the database itself
enforces which ones are required. A missing required selector is a constraint
error, not a null discovered mid-run.

Uniqueness: `create unique index sources_user_name_uniq on sources (user_id,
name) where deleted_at is null`. Scoped **per user** — two users may each have a
source called "LinkedIn", and a global constraint would leak the existence of
sources a user cannot see. It is **partial** because without the predicate a
soft-deleted source would hold its name hostage forever.

`listing_url` is deliberately not unique, at any scope: one user may point two
rows at the same board with different selectors or markers.

An index on `(user_id) where deleted_at is null` serves the list endpoint.

Politeness columns bound one board's run: `detail_delay_ms` between detail
fetches, `request_timeout_ms` per request, `max_items_per_run` as a hard cap so
a board with 400 listings cannot stall the whole 30-minute cycle.

Health columns are written by the pipeline, never by the API. A silently broken
selector is otherwise invisible — the source just stops yielding postings.

### `postings`

```
id             uuid pk default gen_random_uuid()
source_id      uuid not null references sources(id)
url            text not null           -- absolutized detail URL; the identity
title          text not null
company        text
description    text not null
posted_at_raw  text                    -- as scraped, e.g. "3 days ago"
posted_at      timestamptz             -- parsed; null when unparseable
blocked_by     text                    -- null = visible; else the matched word
first_seen_at  timestamptz not null default now()
last_seen_at   timestamptz not null default now()

unique (source_id, url)
```

No `user_id`: ownership is `source_id`'s to answer. Uniqueness on
`(source_id, url)` therefore also means two users tracking the same job on the
same board get one row each, which is correct — they are separate sources.

`posted_at_raw` is kept alongside the parsed timestamp so a parsing misfire
stays diagnosable rather than vanishing into a null.

The foreign key has **no cascade**, because sources are soft-deleted and never
actually removed. Postings therefore always resolve to a live row.

Re-seeing a posting from the same source is a no-op beyond advancing
`last_seen_at`: postings are assumed immutable once fetched.

**Deferred:** no cross-source fingerprint column. One row per source; the same
job on three of a user's boards is three rows and three results. Grouping, if it
is ever wanted, is a migration plus a backfill.

## API

Base path `/sources`. Layering per `api/CLAUDE.md`: routes parse and validate,
call one service, map to a status; the service holds the logic; the repository
owns every query.

```
GET    /sources        list — the caller's, excluding soft-deleted, including disabled
GET    /sources/:id    one; 404 if absent, soft-deleted, or another user's
POST   /sources        create, owned by the caller; 201
PATCH  /sources/:id    partial update; 404 as above
DELETE /sources/:id    sets deleted_at; 204; 404 as above
```

The owner is never in the body or the path — it comes from `X-User-Id` and
nowhere else, so a caller cannot create a source owned by someone else.

Disabled sources are returned by the list so the UI can re-enable them.
Soft-deleted ones never are.

There is **no PUT.** Editing is a partial `PATCH` — a source has roughly twenty
fields, and requiring all of them to change one selector is a bad contract.
`enabled` is an ordinary field in that body, so no separate toggle route.

### Wire format

**camelCase on the wire, snake_case in the database.** `listingUrl`,
`itemSelector`, `blockedTitleWords`. Drizzle already maps column names to
property names, so this costs nothing but does mean a column and its JSON field
have different names — translate when reading SQL by hand.

The response shape omits `userId` entirely: every source a caller can see is
already theirs, so returning it says nothing. It also omits nothing else — the
health columns and timestamps are all included, since diagnosing a broken
selector is the main reason to read a source back.

### Schemas

Three Zod schemas in `src/routes/sources.schema.ts`:

- `SourceCreateSchema` — required: `name`, `listingUrl`, `itemSelector`,
  `titleSelector`, `detailUrlSelector`, `descriptionSelector`. Optional with
  defaults: `detailUrlAttr` (`'href'`), `enabled` (true), both word arrays
  (`[]`), all three politeness fields. `userId` is **not** a member.
- `SourceUpdateSchema` — `SourceCreateSchema.partial()`, rejecting an empty
  body.
- `SourceSchema` — the response shape, reused by every route that returns one.

Validation rules: `listingUrl` must parse as an `http:`/`https:` URL; `name`
and required selectors are rejected outright if whitespace-only (checked with
a regex requiring at least one non-whitespace character, not trimmed); word-array
entries are trimmed and lowercased on the way in, since matching is
case-insensitive, and a blank entry is dropped rather than rejected;
`requestTimeoutMs` 1000–60000, `detailDelayMs` 0–10000, `maxItemsPerRun` 1–500.

**Omitted is not null.** In a PATCH body, an absent key leaves the column alone;
an explicit `null` clears a nullable selector. Required fields reject null.
Zod distinguishes these with `.optional()` versus `.nullable()`, and the
repository builds its update set from the keys actually present.

A unique violation (`23505`) on `sources_user_name_uniq` maps to **409** with
"You already have a source with that name" — phrased so it cannot be read as a
statement about anyone else's data. Per the errors policy in `api/CLAUDE.md`
this is handled inline in the route — no `setErrorHandler`, no domain error
classes.

## OpenAPI

`@fastify/swagger` is already wired in `src/openapi.ts` and serves swagger-ui at
`/docs`. `registerDocs(app)` runs before route registration because swagger
collects routes through an `onRoute` hook. The sources routes follow the pattern
`health.ts` establishes: Zod is the source of truth, `jsonSchema()` converts it
to draft-7, and the result goes in the route's `schema` option.

Three changes to `openapi.ts` itself:

1. `info.description` loses "Single user, self-hosted" — it is now neither.
2. A security scheme is added: `apiKey`, `in: header`, `name: X-User-Id`,
   applied to the sources routes. swagger-ui then shows an Authorize box you
   fill once, rather than a header field to retype on every request, and it is
   the right shape for a real scheme to replace later.
3. A shared `ErrorSchema` is exported, matching Fastify's default error body —
   `{ statusCode: number, error: string, message: string }` — so each route
   declares failures without restating the shape.

Every route declares its success status **and** each error status it can
produce: 400 for a malformed body or header, 404 for an unknown or unowned id,
409 for a duplicate name. DELETE's success status is 204, declared as
`{ description: 'Deleted' }` with no other keys — checked directly against
Fastify 5, declaring a schema for 204 does not make it serialize a body;
Fastify skips payload serialization for that status regardless of what the
schema says.

### Validation: Ajv documents, Zod validates

Request bodies declare `body: jsonSchema(SourceCreateSchema)`, and the handler
*also* runs `SourceCreateSchema.parse()`. This is deliberate but not free, and
the reasons cut both ways:

- `z.toJSONSchema` cannot express the refinements and transforms this API needs
  — the `http:`/`https:` protocol check, trimming, lowercasing word lists. A
  body that satisfies the published JSON Schema can still be rejected by Zod.
  The published schema is therefore a *description*, deliberately looser than
  the real rule, and the strict rules are documented in each field's
  `description` so the gap is visible to a reader.
- Two validators means **two error shapes** for one status code. Ajv rejections
  come back in Fastify's default form; a Zod rejection would not. Since 400 is
  now a documented shape, the handler catches `ZodError` and returns that same
  `{ statusCode, error, message }` body, with the message built from the issue
  list. Without this the document would be lying about half its 400s.

Declaring a response schema also makes fast-json-stringify **strip undeclared
properties**. That is relied on here rather than merely tolerated: it is the
reason a `userId` can never leak into a payload by accident, whatever the
repository happens to return.

## Files

```
src/db/schema.ts                 three tables (currently empty)
drizzle/0000_*.sql               generated migration + the seeded user insert
src/openapi.ts                   + security scheme, + ErrorSchema, description fix
src/routes/sources.ts            HTTP
src/routes/sources.schema.ts     Zod: create, update, response
src/auth/current-user.ts         X-User-Id parsing; the one seam auth replaces
src/services/sources.service.ts  logic
src/repositories/sources.repository.ts
src/repositories/users.repository.ts
test/sources.test.ts
test/current-user.test.ts
```

`app.ts` registers the routes after `registerDocs`. Two doc updates ship with
the code: root `CLAUDE.md` loses "Single user, self-hosted", and `api/CLAUDE.md`
has the code-adapter decision reversed, its two open decisions marked settled —
cross-source grouping deferred, one row per source confirmed — and gains a note
on the Ajv-documents/Zod-validates split, which is the kind of thing a later
reader will otherwise assume is a mistake.

## Testing

Service tests against a fake repository cover the defaults, the partial-update
merge (omitted versus explicit null), word-list normalization, and — the ones
that matter most — that a read, update, or delete aimed at another user's source
id comes back as not-found, and that a created source is owned by the header's
user regardless of what the body contains.

Route tests drive `app.inject()` and cover status codes, validation rejections,
the 409 on a duplicate name within one user, the 400 and 404 paths for
`X-User-Id`, and that list excludes soft-deleted rows while including disabled
ones.

Two OpenAPI-specific tests, extending the ones the swagger commit already added
to `test/app.test.ts`: that `app.swagger()` produces a document containing every
sources path with its security requirement, and that a Zod-rejected body returns
the *same* 400 body shape as an Ajv-rejected one — the assertion that keeps the
two-validator split honest.

All of it runs without a database, per the existing `npm test` contract.

Two behaviors only Postgres can prove are **not covered** by the unit suite:
that the partial unique index permits name reuse after a soft delete, and that
it permits the same name across two users. They need a live database and are out
of scope here — stated so they are not mistaken for tested.

## Out of scope

Authentication and the `X-User-Id` replacement, user creation and deletion
endpoints, the generic adapter, the fetch/parse/filter pipeline, the `POST`
ingestion trigger, the `@fastify/schedule` wiring, the `/postings` read API, a
route for editing the per-user blocklists, a selector dry-run endpoint, and the
frontend. The `postings` table is created now but written by nothing in this
slice.
