# Job sources: schema and CRUD API

Date: 2026-09-01
Status: approved design, not yet implemented

## Problem

`api/` is a scaffold with no domain code. Adding a job board must not require
a deploy, so a source is a **database row** read by one generic adapter — not a
TypeScript file per board. This reverses the "adding a source means adding one
file" decision recorded in `api/CLAUDE.md`; that file is updated as part of this
work.

This slice delivers the three tables and the sources CRUD API. Nothing fetches
anything yet — the adapter and the ingestion pipeline are the next slice.

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

## Filtering

Two blocklists apply at two different pipeline stages:

1. **Title markers** match against the listing title, *before* the detail page
   is fetched. This is the cheap pre-filter — a title rejection saves an HTTP
   request.
2. **Description markers** match against the detail body, and therefore only
   after the fetch.

Matching is **case-insensitive, whole word**. `php` blocks "PHP Developer" and
not "phpMyAdmin". Entries are single tokens; phrase matching is not supported.

Each source carries its own two lists. A single `settings` row carries two
global lists, concatenated with the source's at filter time. A source may add
markers but can never remove a global one.

**A blocked posting is stored,** with `blocked_by` holding the word that matched,
and filtered out of search by default. Storing it means the detail page is never
re-fetched on later runs, and it makes an over-eager marker visible instead of
silently swallowing results.

## Schema

Three tables. Drizzle definitions in `src/db/schema.ts`, migrations generated
into `drizzle/`.

### `sources`

```
id                         uuid pk default gen_random_uuid()
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

Uniqueness: `create unique index sources_name_uniq on sources (name) where
deleted_at is null`. It is **partial** — without the predicate a soft-deleted
source would hold its name hostage forever. `listing_url` is deliberately *not*
unique: two rows may point at the same board with different selectors or
different markers.

Politeness columns bound one board's run: `detail_delay_ms` between detail
fetches, `request_timeout_ms` per request, `max_items_per_run` as a hard cap so
a board with 400 listings cannot stall the whole 30-minute cycle.

Health columns are written by the pipeline, never by the API. A silently broken
selector is otherwise invisible — the source just stops yielding postings.

### `settings`

```
id                         integer pk default 1 check (id = 1)
blocked_title_words        text[] not null default '{}'
blocked_description_words  text[] not null default '{}'
updated_at                 timestamptz not null default now()
```

The check constraint enforces a single row. Seeded empty by the migration.

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

`posted_at_raw` is kept alongside the parsed timestamp so a parsing misfire
stays diagnosable rather than vanishing into a null.

The foreign key has **no cascade**, because sources are soft-deleted and never
actually removed. Postings therefore always resolve to a live row.

Re-seeing a posting from the same source is a no-op beyond advancing
`last_seen_at`: postings are assumed immutable once fetched.

**Deferred:** no cross-source fingerprint column. One row per source; the same
job on three boards is three rows and three results. Grouping, if it is ever
wanted, is a migration plus a backfill.

## API

Base path `/sources`. Layering per `api/CLAUDE.md`: routes parse and validate,
call one service, map to a status; the service holds the logic; the repository
owns every query.

```
GET    /sources        list — excludes soft-deleted, includes disabled
GET    /sources/:id    one; 404 if absent or soft-deleted
POST   /sources        create; 201
PATCH  /sources/:id    partial update; 404 if absent
DELETE /sources/:id    sets deleted_at; 204
```

Disabled sources are returned by the list so the UI can re-enable them.
Soft-deleted ones never are.

There is **no PUT.** Editing is a partial `PATCH` — a source has roughly twenty
fields, and requiring all of them to change one selector is a bad contract.
`enabled` is an ordinary field in that body, so no separate toggle route.

Two Zod schemas in `src/routes/sources.schema.ts`:

- `SourceCreateSchema` — required: `name`, `listing_url`, `item_selector`,
  `title_selector`, `detail_url_selector`, `description_selector`. Optional with
  defaults: `detail_url_attr` (`'href'`), `enabled` (true), both word arrays
  (`[]`), all three politeness fields.
- `SourceUpdateSchema` — `SourceCreateSchema.partial()`, rejecting an empty
  body.

Validation rules: `listing_url` must parse as an `http:`/`https:` URL; required
selectors are non-empty after trim; word-array entries are non-empty after trim
and lowercased on the way in, since matching is case-insensitive;
`request_timeout_ms` 1000–60000, `detail_delay_ms` 0–10000,
`max_items_per_run` 1–500.

**Omitted is not null.** In a PATCH body, an absent key leaves the column alone;
an explicit `null` clears a nullable selector. Required fields reject null.
Zod distinguishes these with `.optional()` versus `.nullable()`, and the
repository builds its update set from the keys actually present.

A unique violation (`23505`) on `sources_name_uniq` maps to **409** with
"Another source already uses that name". Per the errors policy in
`api/CLAUDE.md` this is handled inline in the route — no `setErrorHandler`, no
domain error classes.

## Files

```
src/db/schema.ts                 three tables (currently empty)
drizzle/0000_*.sql               generated migration
src/routes/sources.ts            HTTP
src/routes/sources.schema.ts     Zod
src/services/sources.service.ts  logic
src/repositories/sources.repository.ts
test/sources.test.ts
```

`app.ts` registers the routes. `api/CLAUDE.md` is updated: the code-adapter
decision is reversed, and the two open decisions are marked settled — cross-
source grouping deferred, one row per source confirmed.

## Testing

Service tests against a fake repository cover the defaults, the partial-update
merge (omitted versus explicit null), and word-list normalization. Route tests
drive `app.inject()` and cover status codes, validation rejections, the 409 on a
duplicate name, and that list excludes soft-deleted rows while including
disabled ones. Both run without a database, per the existing `npm test`
contract.

Repository behavior that only Postgres can prove — the partial unique index
permitting name reuse after a soft delete — needs a live database and is out of
scope for the unit suite. It is called out here so it is not mistaken for
covered.

## Out of scope

The generic adapter, the fetch/parse/filter pipeline, the `POST` ingestion
trigger, the `@fastify/schedule` wiring, the `/postings` read API, a settings
CRUD route, a selector dry-run endpoint, and the frontend. The `postings` and
`settings` tables are created now but written by nothing in this slice.
