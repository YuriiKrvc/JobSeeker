# Frontend postings page: a feed you triage

Date: 2026-09-02
Status: implemented

## Problem

`/postings` is a nine-line placeholder that unconditionally renders
`<Empty description="No postings loaded yet" />`. It has never asked whether a
posting exists.

`GET /postings` has been live for a while, behind Postgres, newest first, scoped
to the caller's own sources. Nothing consumes it but `curl` and the Vitest
suite — so the postings the ingestion pipeline collects are, from the UI's point
of view, invisible. This slice makes the screen real.

The framing that decides every question below: **this is a feed you triage, not
a corpus you search.** You come here to scan what was scraped recently and open
the interesting ones in new tabs. That is why there is no search box, no sort
control, and no date filter in this design — see "What is deliberately absent".

## What the API actually offers

Read from `api/src/routes/postings.ts`, `api/src/routes/postings.schema.ts` and
`api/src/repositories/postings.repository.ts`; restated here so this document
stands alone, and **not** imported — the API is the whole contract, per both
`CLAUDE.md` files.

`GET /postings` takes four query parameters and nothing else:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `sourceId` | uuid, optional | — | A filter, not a lookup: another user's id matches nothing rather than 404ing |
| `includeBlocked` | boolean | `false` | Include postings a blocklist word matched |
| `limit` | int ≥ 1 | `50` | Above `MAX_LIMIT` (200) it is clamped, not rejected |
| `offset` | int ≥ 0 | `0` | |

It answers `{ items, total }`, where `total` counts everything matching the
filters **ignoring limit and offset**. A posting on the wire:

```
id, sourceId, url, title, company, description,
postedAtRaw, postedAt, blockedBy, firstSeenAt, lastSeenAt
```

Five facts about this contract shape the UI, and four of them are not obvious
from the parameter list:

- **The order is `first_seen_at DESC, id DESC`** — when *we* first scraped it,
  not when it was posted. "Newest first" means newest to us. The `id` tiebreak
  exists because every posting from one run shares a `first_seen_at`, and
  without it paging could show or skip a row.
- **`postedAt` is nullable and `postedAtRaw` is what was scraped** (e.g.
  `"3 days ago"`), kept so a parse misfire stays visible rather than silently
  becoming null.
- **`description` is already in the list response.** Reading one costs no
  second request. It is documented as empty for a title-blocked posting, which
  was never fetched.
- **Postings from a soft-deleted source are excluded.** `search()` joins
  `sources` with `deleted_at is null`, exactly as `GET /sources` does. So every
  `sourceId` in a response is guaranteed to appear in the live sources list —
  the id→name map this page builds is complete by construction, not by luck.
- **`blockedBy` is null for everything this page will ever show**, because the
  page never sends `includeBlocked`.

Errors arrive in the usual envelope and reach the page as `ApiError` from
`src/services/client.ts`. Nothing here needs a new error path.

## Architecture

Three files. No API change, no routing change — `/postings` is already in
`main.tsx`.

```
src/services/postings.ts               new   wire shape + listPostings()
src/pages/PostingsPage.tsx             rewritten from the placeholder
src/components/PostingDescriptionModal.tsx   new   one posting's description
```

State lives **in the page**, mirroring `SourcesPage.tsx`: the same `load()`
callback shape, the same request-id guard, the same `Alert` + Retry error
treatment. A `usePostingsFeed` hook was considered and rejected — it introduces
a `src/hooks/` convention for a single consumer, and the strongest argument for
it (unit-testing the accumulation rule) does not cash out while the frontend has
no test runner. If this page later grows sorting or free-text search, extracting
the hook is the natural next move and stays cheap then.

### `src/services/postings.ts`

A sibling to `sources.ts`, following its rules: hand-transcribed wire shapes
with a header comment naming `api/src/routes/postings.schema.ts` as the thing
that changes when the API does, ISO timestamps left as strings, no import from
`api/`.

```ts
export interface Posting {
  id: string
  sourceId: string
  url: string           // absolutized detail URL; the identity of a posting
  title: string
  company: string | null
  description: string   // empty for a title-blocked posting, never fetched
  postedAtRaw: string | null
  postedAt: string | null
  blockedBy: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export interface PostingsQuery {
  sourceId?: string
  limit?: number
  offset?: number
}

export function listPostings(
  query: PostingsQuery = {},
): Promise<{ items: Posting[]; total: number }>
```

`listPostings` builds a `URLSearchParams` and appends **only defined keys** — an
absent `sourceId` must not become the literal string `"undefined"`, which the
API rejects as a malformed uuid with a 400.

Two deliberate omissions, stated so a later reader does not "fix" them:

- **`includeBlocked` is not in `PostingsQuery`.** The page never sends it, so
  the API's `false` default applies. `Posting.blockedBy` is still transcribed —
  it is in the response shape, and dropping a field from the wire type would be
  a lie about the contract — it simply never renders.
- **`PAGE_SIZE = 50` lives in the page, not here.** The service is a thin
  transcription of the endpoint; paging policy is a UI decision.

### `src/pages/PostingsPage.tsx`

Layout, top to bottom: `Typography.Title`, a `Flex` toolbar holding the source
`Select`, the `Table`, then a centered "Load more" `Button`.

| Column | Renders |
|---|---|
| Title | `Typography.Link href={url} target="_blank" rel="noreferrer"`, `ellipsis: true` |
| Company | text, `—` when null |
| Source | name from the id→name map, `—` until the map lands |
| Posted | `new Date(postedAt).toLocaleDateString()`, `—` when null |
| *(actions)* | `Button type="link"` labelled "Description", opens the modal |

`postedAtRaw` is transcribed but never rendered: the Posted column is an
absolute date, and an unparseable date reads the same as a missing one. That is
an accepted trade — the raw string stays available in the type for whoever wants
a tooltip later.

`Table` gets `pagination={false}` and `rowKey="id"`; paging is the Load more
button, not a pager.

**Two fetches, independent.** `listSources()` runs once on mount and serves both
the `Select` options and the id→name map. The table does not wait on it: a
posting row is useful before its source name resolves, so the Source cell shows
a dash until the map arrives rather than blocking the page on the slower of two
requests. While it is in flight the `Select` carries `loading`.

**The `Select`** has `allowClear` and the placeholder "All sources". Clearing
sets `sourceId` to `undefined`, which drops the parameter entirely.

**Changing the filter resets the feed.** This is the one rule whose omission
breaks the page: `offset` returns to 0 *and* the accumulated items are
discarded, because appending across a filter change leaves a mixed list.
`load()` therefore takes `(offset, { append })` and appends only when explicitly
told to; the filter effect calls it with `append: false`.

**Appending dedupes by `id`.** Ingestion inserts at the top of
`first_seen_at DESC` — on demand today, and on a 30-minute schedule once that
lands — so rows shift down between one request and the next. Offset paging
over a moving list will re-serve rows already on screen; without the dedupe,
an ingestion run makes duplicate rows appear mid-list.

**Load more is rendered only when `items.length < total`.** Because `total`
ignores limit and offset, this is exact — there is no button that turns out to
load nothing.

### `src/components/PostingDescriptionModal.tsx`

A `Modal` with `footer={null}`, titled with the posting's own title so the
reader knows which job they are looking at, holding the `description` string
already present on the row. No fetch.

The description is scraped text from a third-party page. It is rendered **as
text** in a container with `white-space: pre-wrap`, never through
`dangerouslySetInnerHTML`. The reason is not stylistic: injecting it as markup
would let any job board run script in this app.

An empty description shows an `Empty` placeholder rather than a blank box.
Blocked postings never reach this page, but "the API can return `description`
empty" is part of the contract and the component honours it.

The page holds one `Posting | null` — "the posting being shown" — so that
open-ness and content cannot disagree.

## States

Following `SourcesPage`'s conventions:

- **First load:** the `Table`'s `loading` prop. The toolbar stays mounted so the
  filter does not jump in and out.
- **Error:** `Alert type="error"` above the table with the `ApiError` message and
  a Retry button; Retry calls `load(0, { append: false })`.
- **Empty:** the Table's `Empty` — "No postings yet" with no filter, "No postings
  from this source" when one is selected. The distinction matters: with a filter
  on, an undifferentiated empty table reads as "ingestion is broken".
- **A failed Load more must not wipe what is already on screen.** It sets the
  error alert, leaves `items` untouched, and returns the button to idle so it can
  be retried.
- **A failed `listSources()` does not fail the page.** The feed is still
  readable, so the failure is reported where it has consequences: the `Select`
  drops its `loading` state and shows no options, and the Source column keeps
  its dashes. The error `Alert` is reserved for the postings request, which is
  the one whose failure leaves nothing on screen.

## What is deliberately absent

Not forgotten — decided against, for this slice:

- **Free-text search, sorting, date filters.** All three would require new
  `GET /postings` parameters. The page is for triage, and the API stays untouched
  by this slice.
- **A "show blocked" toggle.** The API supports it (`includeBlocked`); the UI
  does not expose it. Adding it later is a checkbox plus one field in
  `PostingsQuery` — the wire type already carries `blockedBy`.
- **A refresh button.** Reloading the page re-fetches.
- **Anything from the project-level exclusions** — relevance scoring, CV
  matching, application tracking, alerts. `CLAUDE.md` excludes these on purpose.

## Verification

`npm run typecheck`, `npm run lint`, and `npx @ant-design/cli lint ./src`
(required by `frontend/CLAUDE.md` after touching antd code), plus running the app
against a database with ingested postings and exercising: the source filter and
clearing it, Load more across two pages, the description modal on a posting with
and without a description, and the error path with the API stopped.

There is **no frontend test runner**, and this slice does not add one — per
`frontend/CLAUDE.md`, the frontend adds one when it has logic worth testing. The
two candidates here (append-dedupe and the filter reset) are the reason that
sentence will eventually stop being true, but a test runner is its own decision,
not a rider on this page.
