# Job ingestion: adapter, pipeline, and the scrape endpoints

Date: 2026-09-01
Status: approved design, not yet implemented
Follows: `docs/superpowers/specs/2026-09-01-job-sources-design.md`

## Problem

The `postings` table exists and nothing writes to it. `sources` rows describe
how to scrape a board — a listing URL plus CSS selectors — and no code reads
them. This slice closes both gaps: a generic HTML adapter, the pipeline that
drives it, two endpoints that trigger a run, and one endpoint that reads the
results back.

What is **not** here: the 30-minute schedule. It is decided (`@fastify/schedule`,
in-process, calling the same ingestion service) and deliberately deferred, so
scraping in this slice happens only when someone asks for it. `GET /postings` is
in scope precisely so that "someone asked for it" is verifiable through the API
instead of through `psql`.

Inherited from the previous spec and not re-litigated here: a source is a row,
not a code file; page one only, no pagination; plain HTTP with cheerio, no
headless browser; identity is the absolutized detail URL; blocked postings are
stored with `blocked_by` rather than dropped; blocklists are the source's two
lists unioned with the owner's two, matched case-insensitive and whole-word;
`X-User-Id` identifies the caller and must not survive into a deployment.

## Shape of the work

Both triggers call **one** ingestion service. The trigger is a thin entrypoint,
never a second copy of the logic — a rule that exists because the scheduler will
become a third caller and must not fork the pipeline.

```
POST /sources/:id/ingest ─┐
POST /ingest ─────────────┼─> ingestion.service ─> html-source.adapter ─> fetchText
                          │        │
   (later: scheduler) ────┘        └─> postings.repository, sources.repository
```

## Synchronous, on purpose

A run answers when it finishes. There is no run table, no `202`, no polling
endpoint, and no background queue.

The cost is stated plainly because it is not small: a source with the default
`max_items_per_run` of 100 and `detail_delay_ms` of 1000 takes roughly 100
seconds, and `POST /ingest` runs sources one at a time, so five such sources is
over eight minutes in one HTTP request. Callers need a long timeout. A proxy
with a default 60-second read timeout will cut the connection while the run
continues to completion server-side, and the caller will not see the summary.

This is accepted for now: with a single manual caller, the summary in the
response is worth more than the machinery required to make it asynchronous. When
the schedule arrives, the timeout stops mattering for the automatic path, since
nothing is waiting on it. If the manual path starts hurting, the fix is a runs
table and `202` — not a background job with no record of what happened.

## The two-phase adapter

The adapter knows HTML, selectors, and nothing else. It performs no SQL, reads
no blocklist, and makes no decision about whether a posting is worth fetching.

```ts
// src/adapters/html-source.adapter.ts
interface ListedItem { title: string; detailUrl: string }
interface ItemError { url: string; message: string }

listItems(source: SourceRow, fetchText: FetchText):
  Promise<{ items: ListedItem[]; errors: ItemError[] }>

fetchDetail(source: SourceRow, url: string, fetchText: FetchText):
  Promise<{ description: string; company: string | null; postedAtRaw: string | null }>
```

Two functions rather than one exist because of a constraint that only looks
minor: **the title blocklist must be applied before the detail page is
fetched** — that is the entire point of having a title blocklist — and **a
posting already stored must not have its detail page fetched again** — that is
the entire reason blocked postings are stored. Both decisions need the
blocklists and the database, neither of which the adapter may see.

Inverting control solves this without smuggling dependencies in: the service
calls `listItems`, decides item by item, and calls `fetchDetail` only for the
survivors. The alternative considered was a single `scrape()` taking
`shouldSkipTitle` and `isKnownUrl` callbacks; rejected because the callbacks are
the service's dependencies passed through a side door, and testing the adapter
would mean stubbing them anyway.

Consequence to remember: the per-item delay and the item cap are the
**service's** to enforce, not the adapter's. An adapter that fetched on its own
schedule would take that back.

### Fetching

`src/adapters/fetch-text.ts` wraps Node 22's global `fetch` with
`AbortSignal.timeout(source.request_timeout_ms)` and returns the body as text. A
non-2xx response throws with the status in the message. No HTTP client
dependency is added.

`fetchText` is injected into the ingestion service. The unit suite passes a fake
and never opens a socket, matching how the existing tests inject fake
repositories.

### Parsing rules

- `item_selector` yields the item elements. Zero items is not an error; it is a
  run with `fetched: 0`, which is also what a changed page layout looks like.
- A selector with a null `*_attr` takes the element's trimmed text; otherwise
  the named attribute.
- The detail URL is resolved with `new URL(href, source.listing_url)`. Query
  strings are kept.
- An item whose title is empty, whose detail URL is missing, or whose resolved
  URL is not `http`/`https` is dropped into `errors[]` and skipped. It is
  reported rather than ignored, because a selector that silently matches nothing
  useful is the most likely failure of this whole design.

## The run

Per source, in order:

1. `sources.last_run_at = now()`.
2. `listItems`. If the listing fetch or parse throws, write
   `last_error = message`, leave `last_success_at` alone, and return a summary
   with `fetched: 0` and the failure in `errors[]`. **Still 200.**
3. Truncate the item list to `max_items_per_run`. If anything was cut, the
   summary carries `truncated: true`. A silent cap would read as "everything was
   covered" when it was not.
4. One query for the set of URLs already stored for this source.
5. For each item, in listing order:
   - **already stored** → advance `last_seen_at`. No detail fetch, no blocklist
     re-check. `updated++`
   - **title matches a blocklist word** → insert with `blocked_by = <word>` and
     an empty description. No detail fetch. `blocked++`
   - **otherwise** → wait `detail_delay_ms` (skipped before the first fetch),
     `fetchDetail`, then check the description blocklist and insert with
     `blocked_by` set or null. `created++` or `blocked++`. A detail fetch that
     throws goes to `errors[]` and stores nothing, so the next run retries it.
6. On a listing fetch that succeeded: `last_success_at = now()`,
   `last_error = null`. Individual item failures do **not** mark the run failed;
   a board where one posting 503s is a working source.

### What the counters mean

- **`fetched`** — items the adapter parsed out of the listing page, after
  truncation. Not "HTTP requests made" and not "postings stored".
- **`created`** — postings inserted with `blocked_by` null.
- **`updated`** — postings already stored whose `last_seen_at` was advanced.
- **`blocked`** — postings inserted with `blocked_by` set, whether the title or
  the description matched. A re-seen blocked posting counts as `updated`, not
  `blocked`, because that is what happened to it this run.
- **`errors`** — one entry per item that could not be processed: unusable
  listing markup, or a detail fetch that threw. On a listing-level failure it
  holds one entry naming `listing_url`.

So `created + updated + blocked + errors.length === fetched` on a run that
reached the listing page, and `fetched === 0` with one error entry on a run that
did not.

### Writes

Inserts use `on conflict (source_id, url) do update set last_seen_at = now()`,
so two overlapping runs cannot raise a unique violation. Counters come from the
known-URL set read in step 4, not from what the insert returns.

### Three consequences on the record

- **A blocked posting is never re-examined.** Removing a blocklist word does not
  un-block rows already stored — they were stored precisely so their detail page
  would never be fetched again, and step 5 skips known URLs before it looks at
  any blocklist. There is no un-block path in this slice. The workaround is
  deleting the rows.
- **`posted_at` parsing stays dumb.** `posted_at_raw` holds the scraped string
  verbatim; `posted_at` is set only when `new Date(raw)` is valid. "3 days ago"
  stores the raw string and leaves `posted_at` null. Relative-date parsing is
  out of scope, and the raw column exists so the misfire stays visible.
- **Concurrent runs of one source over-report `created`.** Both read the same
  empty known-URL set, so both count an insert as new. The stored rows are
  correct; only the counter lies. Impossible with a single manual caller, and
  worth knowing before the scheduler lands.

## Endpoints

### `POST /sources/:id/ingest`

| Status | When |
|---|---|
| 400 | `X-User-Id` absent or not a uuid |
| 404 | no such user; or source unknown, soft-deleted, or owned by another user |
| 409 | source exists and is live, but `enabled` is false — `"source is disabled"` |
| 200 | the run summary, including when the listing fetch failed |

```json
{
  "sourceId": "…",
  "fetched": 40,
  "created": 5,
  "updated": 33,
  "blocked": 2,
  "truncated": false,
  "errors": [{ "url": "…", "message": "HTTP 503" }]
}
```

The 409 is deliberate and is the one place the two triggers disagree: an
explicit single-source trigger refuses a disabled source rather than quietly
overriding the switch. The cost is that trying out a source you have left
switched off is a three-call sequence — enable, ingest, disable.

### `POST /ingest`

Runs the caller's live, `enabled` sources **one at a time, in `name` order**.
Disabled sources are skipped silently here; that is what `enabled` is for, and
raising the single-source 409 for them would make the bulk route unusable.

400 and 404 as above for the header. Otherwise 200:

```json
{ "runs": [{ "sourceId": "…", "fetched": 40, "…": "…" }] }
```

A source that fails contributes its summary with the error and the next source
still runs. A caller with no enabled sources gets `{ "runs": [] }`, not a 404.

### `GET /postings`

```
?sourceId=<uuid>        optional filter
&includeBlocked=false   default
&limit=50               default 50; above 200 clamps to 200
&offset=0               default 0
```

`limit` above the maximum is **clamped, not rejected** — a caller asking for
1000 gets 200 rows and no error. `limit` below 1 and a negative `offset` are
rejected with 400, since those are mistakes rather than ambition.

Sorted `first_seen_at desc`. Scoped to the caller by joining `sources`, so
another user's `sourceId` returns an empty page rather than a 404 — it is a
filter, not a lookup, and a 404 there would confirm the id exists.

```json
{
  "items": [{
    "id": "…", "sourceId": "…", "url": "…", "title": "…",
    "company": null, "description": "…",
    "postedAtRaw": null, "postedAt": null, "blockedBy": null,
    "firstSeenAt": "…", "lastSeenAt": "…"
  }],
  "total": 137
}
```

`total` is the count matching the filters, ignoring `limit`/`offset`, so a UI
can page. No text search: `?q=` was considered and deferred until the frontend
asks for it, since nothing consumes this endpoint yet.

## Layering and files

`routes → services → repositories` holds. The adapter is a fourth kind of thing
— an outbound driver — and the service is the only layer that touches it.

```
src/adapters/fetch-text.ts             global fetch + AbortSignal.timeout
src/adapters/html-source.adapter.ts    cheerio; listItems / fetchDetail
src/repositories/postings.repository.ts
src/services/ingestion.service.ts      the run; owns delay, cap, blocklists, counters
src/routes/ingest.ts                   POST /sources/:id/ingest, POST /ingest
src/routes/ingest.schema.ts            Zod: summary, bulk response
src/routes/postings.ts                 GET /postings
src/routes/postings.schema.ts          Zod: query, item, list response
src/app.ts                             modify — wire deps, register both route files
```

One new runtime dependency: **cheerio**.

`PostingsRepository` follows the existing rule — every method takes `userId`
first, and no method omits it, so there is no unscoped query to forget to scope.
Postings carry no owner column, so each method joins `sources`:

```ts
findExistingUrls(userId, sourceId): Promise<Set<string>>
touchLastSeen(userId, sourceId, urls: string[]): Promise<void>
upsert(userId, posting: PostingInsert): Promise<void>
search(userId, filters): Promise<{ items: PostingRow[]; total: number }>
```

`sources.repository.ts` gains `recordRunStart(userId, id)` and
`recordRunResult(userId, id, { lastError })`. These are the only writers of
`last_run_at`, `last_success_at` and `last_error` — the CRUD routes must never
set them.

Route files repeat the conventions `sources.ts` established: the two-validator
split (Ajv from the published JSON Schema, then Zod for what JSON Schema cannot
express), the local `fail()` helper reproducing Fastify's default
`{ statusCode, error, message }` body since there is no `setErrorHandler`, and
`USER_ID_SECURITY` on every path so `/docs` stays honest.

## Testing

Everything runs without a database, per the existing `npm test` contract.

`test/html-source.adapter.test.ts` — canned HTML strings: a normal listing;
`title_attr` and `detail_url_attr` variants; relative and absolute hrefs; an
item with an empty title; a non-http href; an empty listing; a detail page whose
optional company and date selectors match nothing.

`test/ingestion.service.test.ts` — the bulk of the suite, against a fake
`fetchText` and fake repositories:

- a title-blocked item never reaches `fetchDetail` — asserted on the fetch spy,
  not merely on the stored row, because the saved request is the feature
- the owner's blocklist unions with the source's, and a source cannot remove one
  of its owner's words
- a known URL advances `last_seen_at` and triggers no fetch
- `max_items_per_run` truncates and sets `truncated: true`
- `detail_delay_ms` elapses between detail fetches and not before the first
  (fake timers)
- a throwing detail fetch stores nothing, lands in `errors[]`, and the run
  continues
- a throwing listing fetch writes `last_error`, leaves `last_success_at`
  untouched, and returns `fetched: 0`
- `posted_at` set for a parseable date, null for `"3 days ago"`, with
  `posted_at_raw` populated in both cases

`test/ingest.routes.test.ts` — the full status table above, plus that a `userId`
supplied in the body is ignored, and that `POST /ingest` keeps going after one
source fails.

`test/postings.routes.test.ts` — `includeBlocked` defaults to excluding blocked
rows, `limit` above 200 is capped rather than rejected, another user's
`sourceId` returns an empty page, `total` ignores `limit`.

`test/app.test.ts` — both new route files appear in `app.swagger()` with their
security requirement.

**Not covered, stated so it is not mistaken for tested.** Two behaviors only a
live Postgres can prove: that `on conflict (source_id, url)` actually advances
`last_seen_at` instead of inserting a second row, and that the ownership join in
`search` filters another user's postings out. Both need an integration suite,
which this slice does not add.

## Out of scope

The 30-minute `@fastify/schedule` wiring; a runs table and any asynchronous
trigger; pagination beyond page one of a listing; JavaScript-rendered boards; a
headless browser; text search on `/postings`; an un-block path or any way to
re-examine a stored blocked posting; relative-date parsing; deleting postings; a
selector dry-run endpoint; per-source URL parameter strip lists; collapsing the
same job across sources; authentication and the `X-User-Id` replacement; the
frontend.
