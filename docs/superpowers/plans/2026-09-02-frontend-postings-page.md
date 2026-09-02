# Frontend Postings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/postings` from a placeholder into a feed you triage — a dense table of scraped postings with an external-link title, a source filter, load-more paging, and the scraped description in a modal.

**Architecture:** One new `services/postings.ts` restates the `GET /postings` wire shape and exposes `listPostings(query)`. `PostingsPage` holds all state itself, mirroring `SourcesPage`: a `load(offset, { append })` callback with a request-id guard, a one-shot `listSources()` call serving both the filter dropdown and an id→name map, and accumulated items deduped by `id` on append. One `PostingDescriptionModal` renders one posting's description as text.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Ant Design 6.6.2 (`@ant-design/icons` 6), react-router 8. No new dependencies. No API change.

**Spec:** `docs/superpowers/specs/2026-09-02-frontend-postings-page-design.md`

## Global Constraints

- **No imports from `api/`.** Not a type, not a constant, not a schema. The frontend declares the wire shape itself. (`CLAUDE.md`, both files.)
- **There is no test runner in `frontend/`,** and this plan does not add one. Every task's verification is `npm run typecheck`, `npm run lint`, `npx @ant-design/cli lint ./src`, plus the explicit manual steps in that task. **A task is not done until the manual steps have actually been run and produced the stated output.** Do not report a task complete on the strength of the code looking right.
- **antd 6 + `@ant-design/icons` 6.** Never guess an antd API from memory — run `npx @ant-design/cli info <Component> --format json` before using an unfamiliar prop, and `npx @ant-design/cli lint ./src` after every change.
- **antd 6 `Alert` takes `title` and `description`, not `message`.** `SourcesPage.tsx` already uses the current form; copy it.
- **Use `destroyOnHidden`, not `destroyOnClose`,** on `Modal`. Both exist in 6.6.2; `destroyOnHidden` (since 5.25.0) is the current one and the linter flags the other.
- **`react-router`, not `react-router-dom`.** The latter is not installed. This plan touches no routing anyway — `/postings` is already in `main.tsx`.
- **Every API call needs `X-User-Id`.** `services/client.ts` adds it from `VITE_USER_ID`; copy `.env.example` to `.env.local` if you have not. The seeded bootstrap user is `00000000-0000-4000-8000-000000000001` (`api/drizzle/0001_seed_owner.sql`).
- **`GET /postings` query parameters, copied verbatim from `api/src/routes/postings.schema.ts`:** `sourceId` (uuid, optional), `includeBlocked` (boolean, default `false`), `limit` (int ≥ 1, default 50, clamped at `MAX_LIMIT` = 200), `offset` (int ≥ 0, default 0). There are no others — no search, no sort, no date range.
- **The response is `{ items, total }`**, and `total` counts everything matching the filters **ignoring limit and offset**.
- **Never render a posting's `description` as HTML.** It is scraped from a third-party page. `dangerouslySetInnerHTML` on it would let any job board run script in this app.
- **`PAGE_SIZE = 50`** lives in `PostingsPage.tsx`, not in the service.

---

## Running environment

Every task's manual verification needs all three of these up. Start them once, in three terminals, and leave them running:

```bash
# 1. Postgres (standalone binary — this machine has no `docker compose` plugin)
cd /Users/ykravchenko/www/JobSeeker && docker-compose up -d postgres

# 2. API on :3000
cd /Users/ykravchenko/www/JobSeeker/api && npm install && npm run db:migrate && npm run dev

# 3. Frontend on :5173
cd /Users/ykravchenko/www/JobSeeker/frontend && npm install && npm run dev
```

### Seed data

The page is unreadable without postings, and running a real scrape is slow and
depends on a live job board. Seed deterministic rows with SQL instead. This
creates three sources and 120 postings — enough to exercise load-more twice,
the source filter, both empty states, a null company, a null `posted_at`, and
an empty description.

Save as `/tmp/seed-postings.sql`:

```sql
-- Three sources owned by the seeded bootstrap user.
insert into sources
  (id, user_id, name, listing_url, item_selector, title_selector,
   detail_url_selector, description_selector)
values
  ('11111111-1111-4111-8111-111111111111',
   '00000000-0000-4000-8000-000000000001',
   'Seed Board A', 'https://example.com/a', '.job', '.title', 'a', '.body'),
  ('22222222-2222-4222-8222-222222222222',
   '00000000-0000-4000-8000-000000000001',
   'Seed Board B', 'https://example.com/b', '.job', '.title', 'a', '.body'),
  -- Board C stays empty on purpose: it is the only way to see the filtered
  -- empty state, which reads differently from the unfiltered one.
  ('33333333-3333-4333-8333-333333333333',
   '00000000-0000-4000-8000-000000000001',
   'Seed Board C', 'https://example.com/c', '.job', '.title', 'a', '.body')
on conflict (id) do nothing;

-- 120 postings: 80 on board A, 40 on board B. `first_seen_at` descends with n
-- so the newest row is n = 1 and the feed order is predictable.
insert into postings
  (source_id, url, title, company, description,
   posted_at_raw, posted_at, blocked_by, first_seen_at, last_seen_at)
select
  case when n <= 80
    then '11111111-1111-4111-8111-111111111111'::uuid
    else '22222222-2222-4222-8222-222222222222'::uuid end,
  'https://example.com/job/' || n,
  'Seed Posting ' || n,
  -- Every 10th posting has no company, to exercise the em-dash fallback.
  case when n % 10 = 0 then null else 'Seed Company ' || n end,
  -- Posting 3 has an empty description, to exercise the modal's Empty state.
  case when n = 3 then '' else 'Line one of posting ' || n ||
    E'.\n\nLine two, after a blank line, to prove pre-wrap is doing something.'
  end,
  case when n % 7 = 0 then 'some time ago' else n || ' days ago' end,
  -- Every 7th posting has an unparseable date, so posted_at is null.
  case when n % 7 = 0 then null else now() - (n || ' days')::interval end,
  null,
  now() - (n || ' minutes')::interval,
  now()
from generate_series(1, 120) as n
on conflict (source_id, url) do nothing;
```

Apply it, and confirm the count:

```bash
docker-compose exec -T postgres psql -U jobseeker -d jobseeker < /tmp/seed-postings.sql
docker-compose exec -T postgres psql -U jobseeker -d jobseeker \
  -c 'select count(*) from postings'
```

Expected: `120` (or more, if you already had real postings — the assertions
below that name exact counts assume a database whose only postings are these).

Sanity check the endpoint before starting Task 1:

```bash
curl -s -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' \
  'http://localhost:3000/postings?limit=2' | head -c 400
```

Expected: JSON with an `items` array of 2 and `"total":120`.

### Teardown

After Task 5, remove the seed data so it does not masquerade as real postings:

```bash
docker-compose exec -T postgres psql -U jobseeker -d jobseeker -c "
  delete from postings where url like 'https://example.com/job/%';
  delete from sources where name in ('Seed Board A', 'Seed Board B', 'Seed Board C');"
```

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/src/services/postings.ts` | `Posting`, `PostingsQuery`, `PostingsResult`, and `listPostings()`. New. |
| `frontend/src/pages/PostingsPage.tsx` | The table, the source filter, load-more paging, and all load/error/empty state. Replaces the placeholder. |
| `frontend/src/components/PostingDescriptionModal.tsx` | One posting's description, rendered as text. New. |
| `frontend/CLAUDE.md` | Status and Layout notes. Modified in Task 5. |
| `CLAUDE.md` (root) | Status section. Modified in Task 5. |

---

## Task 1: The service layer and a read-only postings table

Deliverable: `/postings` lists the first 50 real postings from the API, with a
loading state, a typed error state with retry, and an empty state. No filter, no
paging, no modal yet.

**Files:**
- Create: `frontend/src/services/postings.ts`
- Modify: `frontend/src/pages/PostingsPage.tsx` (replaces all 11 lines)

**Interfaces:**
- Consumes: `request<T>(path, init?)` and `ApiError` from `frontend/src/services/client.ts`.
- Produces: `Posting` (11 fields, below), `PostingsQuery`, `PostingsResult`, and `listPostings(query?: PostingsQuery): Promise<PostingsResult>`. Tasks 2–4 all import from this module.

- [ ] **Step 1: Create `frontend/src/services/postings.ts`**

```ts
import { request } from './client'

/**
 * The frontend's own restatement of the wire shape, transcribed from
 * api/src/routes/postings.schema.ts. Deliberately not imported from `api/`:
 * the REST API is the whole contract between the two projects. When the API
 * changes, this is the file that changes with it.
 *
 * Timestamps are ISO-8601 strings, not Dates — JSON has no date type, and the
 * one place a date is rendered parses it at the call site.
 */
export interface Posting {
  id: string
  sourceId: string
  /** Absolutized detail URL. The identity of a posting. */
  url: string
  title: string
  company: string | null
  /** Empty for a title-blocked posting, which was never fetched. */
  description: string
  /** As scraped, e.g. "3 days ago" — kept so a parse misfire stays visible. */
  postedAtRaw: string | null
  /** Null when postedAtRaw was not a parseable date. */
  postedAt: string | null
  /** Null means visible; otherwise the blocklist word that matched. */
  blockedBy: string | null
  firstSeenAt: string
  lastSeenAt: string
}

/**
 * `includeBlocked` is deliberately absent: the postings page never asks for
 * blocked postings, so the API's own `false` default applies. `blockedBy` is
 * still on `Posting` above — it is in the response shape, and omitting a field
 * from the wire type would be a lie about the contract — it simply never
 * renders. Adding a "show blocked" toggle later means adding one field here.
 *
 * `limit` and `offset` have API-side defaults (50 and 0); this type leaves both
 * optional so a caller can omit them, and the page passes them explicitly.
 */
export interface PostingsQuery {
  sourceId?: string
  limit?: number
  offset?: number
}

export interface PostingsResult {
  items: Posting[]
  /** Matching the filters, ignoring limit and offset. */
  total: number
}

/**
 * Newest first — ordered by when *we* first saw a posting, not when it was
 * posted (`first_seen_at DESC, id DESC` in the API's repository).
 *
 * Only defined keys are appended. An absent `sourceId` must not become the
 * literal string "undefined", which the API rejects as a malformed uuid with
 * a 400.
 */
export function listPostings(
  query: PostingsQuery = {},
): Promise<PostingsResult> {
  const params = new URLSearchParams()
  if (query.sourceId !== undefined) params.set('sourceId', query.sourceId)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const search = params.toString()
  return request<PostingsResult>(`/postings${search ? `?${search}` : ''}`)
}
```

- [ ] **Step 2: Replace `frontend/src/pages/PostingsPage.tsx` entirely**

The `load` callback below is deliberately self-contained — it resets its own
`loading` and `error` — so it is safe to call from the mount effect and from
Retry without either call site remembering to reset first. Task 3 rewrites it
to take an offset; do not anticipate that here.

```tsx
import { Alert, Button, Empty, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { Posting } from '../services/postings'
import { listPostings } from '../services/postings'

/** How many postings one request asks for. The API's own default is the same. */
const PAGE_SIZE = 50

/**
 * `postedAt` is null whenever the scraped date did not parse. The raw string
 * (`postedAtRaw`) is not shown: the column is an absolute date by design, and
 * an unparseable date reads the same as a missing one. The raw value stays on
 * the type for whoever wants a tooltip later.
 */
const formatPostedAt = (postedAt: string | null) =>
  postedAt ? new Date(postedAt).toLocaleDateString() : '—'

const columns: TableProps<Posting>['columns'] = [
  {
    title: 'Title',
    dataIndex: 'title',
    key: 'title',
    ellipsis: true,
    // The title is the way out of this page: the real listing, in a new tab.
    // `rel="noreferrer"` because these URLs are third-party.
    render: (title: string, posting) => (
      <Typography.Link href={posting.url} target="_blank" rel="noreferrer">
        {title}
      </Typography.Link>
    ),
  },
  {
    title: 'Company',
    dataIndex: 'company',
    key: 'company',
    width: 200,
    ellipsis: true,
    render: (company: string | null) => company ?? '—',
  },
  {
    title: 'Posted',
    dataIndex: 'postedAt',
    key: 'postedAt',
    width: 130,
    render: formatPostedAt,
  },
]

const PostingsPage = () => {
  const [postings, setPostings] = useState<Posting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Retry can be pressed while a load is already in flight, so two GETs can be
  // outstanding at once and can resolve in either order. `requestId` tags each
  // call so only the most recently *started* one may apply its result.
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await listPostings({ limit: PAGE_SIZE, offset: 0 })
      if (id === requestIdRef.current) setPostings(data.items)
    } catch (caught) {
      // An ApiError carries the API's own message; anything else is a network
      // or programming fault and its message is the best we have.
      if (id === requestIdRef.current) {
        setError(
          caught instanceof Error ? caught.message : 'Could not load postings',
        )
      }
    } finally {
      if (id === requestIdRef.current) setLoading(false)
    }
  }, [])

  // `load` resets loading/error before awaiting. On mount both are already at
  // those values, so React bails out of the re-render and nothing cascades —
  // which is the harm `set-state-in-effect` exists to prevent. The rule flags
  // any effect calling a function that mentions setState anywhere, so it
  // cannot see that. Disabled here rather than restructured: ESLint 9 reports
  // unused disable directives, so this line disappears on its own if the rule
  // ever learns to tell the difference.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  return (
    <>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        Postings
      </Typography.Title>
      {error ? (
        <Alert
          type="error"
          showIcon
          title="Could not load postings"
          description={error}
          action={
            <Button size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : (
        <Table<Posting>
          rowKey="id"
          columns={columns}
          dataSource={postings}
          loading={loading}
          pagination={false}
          locale={{ emptyText: <Empty description="No postings yet" /> }}
        />
      )}
    </>
  )
}

export default PostingsPage
```

- [ ] **Step 3: Typecheck, lint, and antd-lint**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0 with no errors.

- [ ] **Step 4: Verify real rows render**

Open http://localhost:5173/postings.

Expected, all of it:
- 50 rows, no pager beneath them.
- The first row is `Seed Posting 1` (`first_seen_at` descends with `n`).
- Titles are links. Clicking one opens `https://example.com/job/1` in a **new
  tab** — the postings page stays where it was.
- Row 10 (`Seed Posting 10`) shows `—` in Company.
- Row 7 (`Seed Posting 7`) shows `—` in Posted; row 1 shows a real date.

- [ ] **Step 5: Verify the empty state**

```bash
# Point the app at a user with no sources, and so no postings.
docker-compose exec -T postgres psql -U jobseeker -d jobseeker -c "
  insert into users (id, email)
  values ('00000000-0000-4000-8000-0000000000ff', 'empty@jobseeker.local')
  on conflict (id) do nothing"
```

Temporarily set `VITE_USER_ID=00000000-0000-4000-8000-0000000000ff` in
`frontend/.env.local`. Vite reloads env on restart, so restart `npm run dev`.

Expected: the table shows "No postings yet", not a spinner and not an error.

Restore `VITE_USER_ID=00000000-0000-4000-8000-000000000001` and restart again.

- [ ] **Step 6: Verify the error state**

Stop the API (Ctrl-C in its terminal) and reload http://localhost:5173/postings.

Expected: the red `Alert` titled "Could not load postings", with a Retry button
and a message describing the failure — **not** a raw `SyntaxError` about an
unexpected token, which is what an unhandled HTML error body looks like.

Restart the API, press Retry.

Expected: the alert disappears and the 50 rows appear.

- [ ] **Step 7: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/src/services/postings.ts frontend/src/pages/PostingsPage.tsx
git commit -m "feat(frontend): list postings from the API"
```

---

## Task 2: Source filter and Source column

Deliverable: a "All sources" dropdown above the table filters the feed to one
source, and a Source column shows the source's name. Clearing the filter
restores the full feed.

**Files:**
- Modify: `frontend/src/pages/PostingsPage.tsx`

**Interfaces:**
- Consumes: `listPostings`, `Posting`, `PostingsQuery` from `services/postings` (Task 1); `listSources` and `Source` from `frontend/src/services/sources.ts` (already exists — `listSources(): Promise<Source[]>`, and `Source.id` / `Source.name` are the only fields used).
- Produces: `buildColumns(sourceNames: Map<string, string>): TableProps<Posting>['columns']`, which Task 4 extends with a second parameter.

- [ ] **Step 1: Convert `columns` into a `buildColumns` factory**

Replace the module-level `const columns: TableProps<Posting>['columns'] = [...]`
from Task 1 with this. The Title, Company and Posted columns are unchanged; the
Source column is new and sits between Company and Posted.

```tsx
/**
 * `sourceNames` maps a source id to its name. It is complete by construction,
 * not by luck: `GET /postings` joins `sources` with `deleted_at is null`
 * exactly as `GET /sources` does, so a posting can only come from a source
 * that is in the list. The `?? '—'` covers one real gap — the sources request
 * is still in flight, or it failed — and a source deleted in another tab
 * between the two requests.
 */
const buildColumns = (
  sourceNames: Map<string, string>,
): TableProps<Posting>['columns'] => [
  {
    title: 'Title',
    dataIndex: 'title',
    key: 'title',
    ellipsis: true,
    render: (title: string, posting) => (
      <Typography.Link href={posting.url} target="_blank" rel="noreferrer">
        {title}
      </Typography.Link>
    ),
  },
  {
    title: 'Company',
    dataIndex: 'company',
    key: 'company',
    width: 200,
    ellipsis: true,
    render: (company: string | null) => company ?? '—',
  },
  {
    title: 'Source',
    dataIndex: 'sourceId',
    key: 'sourceId',
    width: 180,
    ellipsis: true,
    render: (sourceId: string) => sourceNames.get(sourceId) ?? '—',
  },
  {
    title: 'Posted',
    dataIndex: 'postedAt',
    key: 'postedAt',
    width: 130,
    render: formatPostedAt,
  },
]
```

- [ ] **Step 2: Add the sources fetch and the filter state**

Add these imports to the existing ones:

```tsx
import { Flex, Select } from 'antd'          // merge into the existing antd import
import { useMemo } from 'react'              // merge into the existing react import
import type { Source } from '../services/sources'
import { listSources } from '../services/sources'
```

Inside `PostingsPage`, add below the existing `error` state:

```tsx
  const [sourceId, setSourceId] = useState<string | undefined>(undefined)
  const [sources, setSources] = useState<Source[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
```

And below the mount effect, the sources fetch plus the derived map and options:

```tsx
  // One request serves both the filter's options and the Source column's
  // name lookup. It runs once: the sources list is not what this page is
  // about, and a stale name is a cosmetic problem where a stale feed is not.
  useEffect(() => {
    let cancelled = false
    const loadSources = async () => {
      try {
        const data = await listSources()
        if (!cancelled) setSources(data)
      } catch {
        // Swallowed on purpose. The feed is readable without source names, so
        // this failure gets no error Alert — that is reserved for the postings
        // request, whose failure leaves nothing on screen. The consequences
        // show where they matter: an empty dropdown and dashes in the Source
        // column.
        if (!cancelled) setSources([])
      } finally {
        if (!cancelled) setSourcesLoading(false)
      }
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSources()
    return () => {
      cancelled = true
    }
  }, [])

  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  )

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ label: source.name, value: source.id })),
    [sources],
  )

  const columns = useMemo(() => buildColumns(sourceNames), [sourceNames])
```

- [ ] **Step 3: Make `load` depend on `sourceId`**

Change the `load` callback's request line and dependency array. Nothing else in
`load` changes:

```tsx
  const load = useCallback(async () => {
    const id = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await listPostings({
        sourceId,
        limit: PAGE_SIZE,
        offset: 0,
      })
      if (id === requestIdRef.current) setPostings(data.items)
    } catch (caught) {
      if (id === requestIdRef.current) {
        setError(
          caught instanceof Error ? caught.message : 'Could not load postings',
        )
      }
    } finally {
      if (id === requestIdRef.current) setLoading(false)
    }
  }, [sourceId])
```

This is the whole filter-reset mechanism, and it is worth understanding rather
than copying: `load` closes over `sourceId`, so changing the filter produces a
new `load`, which re-runs the `useEffect` that depends on it, which fetches at
`offset: 0` and **replaces** `postings`. Task 3 adds appending, and the reason
this matters then is that appending across a filter change would leave a list
mixing two sources. Do not add a separate reset effect — there would then be
two mechanisms racing to do one job.

- [ ] **Step 4: Add the toolbar, and make the empty state name the filter**

Replace the bare `<Typography.Title>` from Task 1 with a `Flex` holding it and
the `Select`:

```tsx
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Postings
        </Typography.Title>
        <Select
          // Clearing gives `undefined`, which `listPostings` drops from the
          // query string entirely — not an empty `sourceId=`, which the API
          // would reject as a malformed uuid.
          allowClear
          loading={sourcesLoading}
          placeholder="All sources"
          options={sourceOptions}
          value={sourceId}
          onChange={setSourceId}
          style={{ width: 240 }}
        />
      </Flex>
```

Note the toolbar sits **outside** the `error ? ... : ...` branch, so the filter
stays on screen when the feed fails to load.

Then change the `Table`'s `locale` prop from Task 1's fixed string to one that
depends on the filter:

```tsx
          locale={{
            emptyText: (
              <Empty
                description={
                  // With a filter on, an undifferentiated "No postings yet"
                  // reads as "ingestion is broken". Naming the filter says
                  // which of the two it is.
                  sourceId
                    ? 'No postings from this source'
                    : 'No postings yet'
                }
              />
            ),
          }}
```

- [ ] **Step 5: Typecheck, lint, and antd-lint**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0.

- [ ] **Step 6: Verify the Source column and the filter**

Reload http://localhost:5173/postings.

Expected:
- A Source column showing `Seed Board A` on the first 50 rows.
- The dropdown reads "All sources" and offers exactly `Seed Board A`,
  `Seed Board B` and `Seed Board C`.

Select `Seed Board B`.

Expected: the table replaces its contents with `Seed Posting 81` at the top —
**not** 50 board-A rows with board-B rows appended. Every Source cell reads
`Seed Board B`.

Select `Seed Board C`, which has no postings.

Expected: the table shows **"No postings from this source"** — not "No postings
yet". The distinction is the whole point: with a filter on, the generic message
reads as "ingestion is broken".

Clear the filter with the × on the Select.

Expected: `Seed Posting 1` is back at the top.

- [ ] **Step 7: Verify the network request has no empty parameter**

With the browser devtools Network tab open, clear the filter and confirm the
request URL.

Expected: `/api/postings?limit=50&offset=0` — with **no** `sourceId` key at
all. A `sourceId=` or `sourceId=undefined` here is the bug this step exists to
catch, and it surfaces as a 400.

- [ ] **Step 8: Verify a failed sources fetch degrades quietly**

In `services/sources.ts`, temporarily break the path — change `'/sources'` in
`listSources` to `'/sources-nope'` — and reload the page.

Expected: the postings table still renders its 50 rows, the Source column shows
`—` in every cell, the dropdown is empty and not stuck in a loading spinner,
and **no error Alert appears**. Revert the path.

- [ ] **Step 9: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/src/pages/PostingsPage.tsx
git commit -m "feat(frontend): filter postings by source"
```

---

## Task 3: Load-more paging

Deliverable: a "Load more" button below the table appends the next 50 postings,
appears only while there are more to load, dedupes by `id`, and leaves the list
intact when a request fails.

**Files:**
- Modify: `frontend/src/pages/PostingsPage.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1 and 2.
- Produces: `load(offset: number, options?: { append?: boolean }): Promise<void>` — Task 4 does not call it, but Retry and the mount effect do.

- [ ] **Step 1: Add the paging state**

Inside `PostingsPage`, alongside the existing state:

```tsx
  const [total, setTotal] = useState(0)
  // How many rows the next request should skip. Advanced by the number of
  // items actually returned, not by PAGE_SIZE, so a short page cannot leave a
  // gap.
  const [offset, setOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
```

- [ ] **Step 2: Rewrite `load` to take an offset and an append flag**

This replaces the `load` from Task 2 in full.

```tsx
  const load = useCallback(
    async (nextOffset: number, { append = false }: { append?: boolean } = {}) => {
      const id = ++requestIdRef.current
      // A failed "Load more" must not blank the rows already on screen, so
      // appending drives its own button spinner and never touches `loading`.
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const data = await listPostings({
          sourceId,
          limit: PAGE_SIZE,
          offset: nextOffset,
        })
        if (id !== requestIdRef.current) return
        setTotal(data.total)
        setOffset(nextOffset + data.items.length)
        setPostings((current) => {
          if (!append) return data.items
          // Ingestion runs every 30 minutes and inserts at the top of
          // `first_seen_at DESC`, so rows shift down between one request and
          // the next and an offset window can re-serve rows already on
          // screen. Without this, a background run makes duplicate rows
          // appear mid-list. The converse — a shift large enough to skip a
          // row entirely — is not fixable with offset paging; it needs cursor
          // paging, and it is not worth an API change for a 30-minute
          // schedule.
          const seen = new Set(current.map((posting) => posting.id))
          return [
            ...current,
            ...data.items.filter((posting) => !seen.has(posting.id)),
          ]
        })
      } catch (caught) {
        if (id === requestIdRef.current) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load postings',
          )
        }
      } finally {
        if (id === requestIdRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [sourceId],
  )
```

- [ ] **Step 3: Update the two existing call sites**

The mount/filter effect:

```tsx
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(0)
  }, [load])
```

And Retry, inside the `Alert`'s `action`:

```tsx
            <Button size="small" onClick={() => void load(0)}>
              Retry
            </Button>
```

- [ ] **Step 4: Render the button**

Immediately after the `</Table>` closing tag, still inside the `else` branch of
the error ternary — wrap the `Table` and this button in a `<>...</>` fragment so
the ternary still has one expression per branch:

```tsx
          {postings.length < total ? (
            <Flex justify="center" style={{ marginTop: 16 }}>
              <Button loading={loadingMore} onClick={() => void load(offset, { append: true })}>
                Load more
              </Button>
            </Flex>
          ) : null}
```

`postings.length < total` is exact rather than a guess, because `total` counts
everything matching the filter and ignores limit and offset — so there is never
a button that turns out to load nothing.

- [ ] **Step 5: Typecheck, lint, and antd-lint**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0.

- [ ] **Step 6: Verify paging to the end**

Reload http://localhost:5173/postings with no filter.

Expected: 50 rows and a "Load more" button.

Press it once. Expected: 100 rows; the row after `Seed Posting 50` is
`Seed Posting 51`, with no repeat of 50; the button is still there.

Press it again. Expected: 120 rows, ending at `Seed Posting 120`, and the
**button is gone** — `120 < 120` is false.

- [ ] **Step 7: Verify load-more does not blank the table on failure**

Reload the page, press "Load more" once so you have 100 rows, then stop the API
and press "Load more" again.

Expected: the error Alert appears **and the 100 rows are still on screen** —
this is the whole point of `loadingMore` being separate from `loading`. The
button returns to its idle (non-spinning) state.

Restart the API and press "Load more" again. Expected: rows 101–120 append.

- [ ] **Step 8: Verify the filter resets accumulated rows**

Reload, press "Load more" twice to reach 120 rows, then select `Seed Board B`.

Expected: exactly 40 rows, all `Seed Board B`, starting at `Seed Posting 81`,
and **no** "Load more" button (`40 < 40` is false). If you see 120 rows or a
mix of both boards, the reset described in Task 2 Step 3 is broken.

- [ ] **Step 9: Verify the dedupe actually fires**

This is the one behaviour that a passing UI does not prove, so force it. With
50 rows on screen, insert a row that lands at the top of the order:

```bash
docker-compose exec -T postgres psql -U jobseeker -d jobseeker -c "
  insert into postings
    (source_id, url, title, company, description, first_seen_at, last_seen_at)
  values
    ('11111111-1111-4111-8111-111111111111',
     'https://example.com/job/jumper', 'Seed Posting JUMPER', 'Acme',
     'Inserted mid-session to shift the offset window.', now(), now())"
```

Now press "Load more" (do **not** reload first — the point is that page 1 was
fetched before the insert).

Expected: `Seed Posting 50` appears exactly once in the table. Everything
shifted down by one, so the `offset=50` window re-serves it; the dedupe is what
keeps it from appearing twice. Search the page with Cmd-F for
`Seed Posting 50` and confirm a single hit.

Clean up the jumper row:

```bash
docker-compose exec -T postgres psql -U jobseeker -d jobseeker -c "
  delete from postings where url = 'https://example.com/job/jumper'"
```

- [ ] **Step 10: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/src/pages/PostingsPage.tsx
git commit -m "feat(frontend): load more postings, deduped by id"
```

---

## Task 4: The description modal

Deliverable: a "Description" action on each row opens a modal showing that
posting's scraped description as text, with an Empty placeholder when there is
none.

**Files:**
- Create: `frontend/src/components/PostingDescriptionModal.tsx`
- Modify: `frontend/src/pages/PostingsPage.tsx`

**Interfaces:**
- Consumes: `Posting` from `services/postings` (Task 1); `buildColumns` from Task 2.
- Produces: a default-exported `PostingDescriptionModal` taking `{ posting: Posting; onClose: () => void }`. `buildColumns` grows a second parameter, `onShowDescription: (posting: Posting) => void`.

- [ ] **Step 1: Create `frontend/src/components/PostingDescriptionModal.tsx`**

```tsx
import { Empty, Modal, Typography } from 'antd'

import type { Posting } from '../services/postings'

export interface PostingDescriptionModalProps {
  /** The posting to show. The page renders this component only when it has one. */
  posting: Posting
  onClose: () => void
}

/**
 * One posting's description. No fetch: `GET /postings` already returns the full
 * description on every list row, so the row has everything.
 *
 * The description is scraped text from a third-party page, so it is rendered
 * **as text** with `white-space: pre-wrap` to keep its line breaks. It must
 * never go through `dangerouslySetInnerHTML` — the reason is not stylistic:
 * that would let any job board run script in this app.
 */
const PostingDescriptionModal = ({
  posting,
  onClose,
}: PostingDescriptionModalProps) => (
  <Modal
    open
    title={posting.title}
    footer={null}
    width={720}
    destroyOnHidden
    onCancel={onClose}
  >
    {posting.description.trim() === '' ? (
      // Blocked postings never reach this page, but "the API can return
      // `description` empty" is part of the contract, so this is honoured
      // rather than rendering a blank box.
      <Empty description="This posting has no description" />
    ) : (
      <Typography.Paragraph
        style={{
          whiteSpace: 'pre-wrap',
          marginBottom: 0,
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
      >
        {posting.description}
      </Typography.Paragraph>
    )}
  </Modal>
)

export default PostingDescriptionModal
```

- [ ] **Step 2: Add the action column**

In `PostingsPage.tsx`, give `buildColumns` a second parameter and append one
column after Posted. The four existing columns are unchanged.

```tsx
const buildColumns = (
  sourceNames: Map<string, string>,
  onShowDescription: (posting: Posting) => void,
): TableProps<Posting>['columns'] => [
  // ... Title, Company, Source, Posted unchanged ...
  {
    title: '',
    key: 'actions',
    width: 130,
    render: (_, posting) => (
      <Button type="link" onClick={() => onShowDescription(posting)}>
        Description
      </Button>
    ),
  },
]
```

- [ ] **Step 3: Hold the shown posting in the page**

Add the import:

```tsx
import PostingDescriptionModal from '../components/PostingDescriptionModal'
```

Add the state, alongside the others:

```tsx
  // One variable, not an `open` boolean beside a posting: openness and content
  // cannot then disagree.
  const [showing, setShowing] = useState<Posting | null>(null)
```

Update the memo to pass the setter:

```tsx
  const columns = useMemo(
    () => buildColumns(sourceNames, setShowing),
    [sourceNames],
  )
```

`setShowing` is a `useState` setter, so it is referentially stable and does not
belong in the dependency array; React's lint rule knows this and will not ask
for it.

And render the modal as the last child of the outer fragment, after the error
ternary:

```tsx
      {showing ? (
        <PostingDescriptionModal
          posting={showing}
          onClose={() => setShowing(null)}
        />
      ) : null}
```

Mounting on demand rather than passing `open={showing !== null}` is deliberate:
it means the modal never renders with a null posting, so its props need no
optional chaining. The trade-off is that closing skips antd's fade-out — the
modal disappears at once instead of animating. That is the better end of the
trade, because the alternative animates a modal whose content has already been
torn out from under it.

- [ ] **Step 4: Typecheck, lint, and antd-lint**

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0.

- [ ] **Step 5: Verify a description opens**

Reload http://localhost:5173/postings and press "Description" on the first row.

Expected: a modal titled `Seed Posting 1`, containing two paragraphs separated
by a visible blank line ("Line one of posting 1." / "Line two, after a blank
line, …"). The blank line is the proof that `pre-wrap` is in effect — if the
text collapses onto one line, the style did not apply.

Expected also: no OK/Cancel buttons in the footer. Close it with the × and with
Esc; both work.

- [ ] **Step 6: Verify the empty description**

Seed posting 3 has an empty description. Filter to `Seed Board A` if needed,
find `Seed Posting 3` in the first page, and press its "Description".

Expected: the modal opens titled `Seed Posting 3` and shows the "This posting
has no description" placeholder — not a blank white box.

- [ ] **Step 7: Verify the description is not treated as HTML**

This is the security-relevant one, so prove it rather than assume it.

```bash
docker-compose exec -T postgres psql -U jobseeker -d jobseeker -c "
  insert into postings
    (source_id, url, title, company, description, first_seen_at, last_seen_at)
  values
    ('11111111-1111-4111-8111-111111111111',
     'https://example.com/job/xss', 'Seed Posting XSS', 'Acme',
     '<img src=x onerror=\"document.title=\$\$pwned\$\$\">  and <b>bold</b>',
     now(), now())"
```

Reload the page — `Seed Posting XSS` is now the newest row — and open its
Description.

Expected: the modal shows the literal text `<img src=x onerror=...>` and
`<b>bold</b>` **as characters**, with no broken-image icon, nothing rendered
bold, and the browser tab title unchanged. If the tab title becomes "pwned",
the description is being injected as markup and the modal is wrong.

Clean up:

```bash
docker-compose exec -T postgres psql -U jobseeker -d jobseeker -c "
  delete from postings where url = 'https://example.com/job/xss'"
```

- [ ] **Step 8: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/src/components/PostingDescriptionModal.tsx \
        frontend/src/pages/PostingsPage.tsx
git commit -m "feat(frontend): show a posting's description in a modal"
```

---

## Task 5: Documentation

Deliverable: both `CLAUDE.md` files and the spec describe the postings page as
it now is, and the seed data is gone.

**Files:**
- Modify: `frontend/CLAUDE.md`
- Modify: `CLAUDE.md` (root)
- Modify: `docs/superpowers/specs/2026-09-02-frontend-postings-page-design.md`

- [ ] **Step 1: Update the Status section of `frontend/CLAUDE.md`**

Replace:

```markdown
`/sources` is a working screen: it lists, creates, edits, deletes and toggles
sources against the API. `/postings` is still a placeholder.
```

with:

```markdown
`/sources` is a working screen: it lists, creates, edits, deletes and toggles
sources against the API. `/postings` is a working screen too: a feed you triage
— dense table, source filter, load-more paging, and the scraped description in
a modal. See `docs/superpowers/specs/2026-09-02-frontend-postings-page-design.md`.
```

- [ ] **Step 2: Add the postings page's non-obvious rules to `frontend/CLAUDE.md`**

Append to the existing list of "Two things a future cleanup pass should not
'fix'" — and change that sentence's "Two things" to "Four things":

```markdown
- **`load()` in `PostingsPage.tsx` resets the feed whenever `sourceId`
  changes**, and it does so through its own `useCallback` dependency rather
  than a separate effect: `load` closes over `sourceId`, so a filter change
  produces a new `load`, re-runs the effect that depends on it, and refetches
  at `offset: 0`. Do not add a reset effect beside it — two mechanisms would
  race to do one job. Appending across a filter change is what this prevents,
  and it shows up as a list mixing two sources.
- **Appending in `PostingsPage.tsx` dedupes by `id`, on purpose.** Ingestion
  inserts at the top of `first_seen_at DESC`, so an offset window re-serves
  rows already on screen and duplicates appear mid-list without it. The
  converse — a shift large enough to skip a row — is not fixable with offset
  paging and is knowingly accepted.
- **A posting's `description` is never rendered as HTML.** It is scraped from a
  third-party page; `dangerouslySetInnerHTML` there would let any job board run
  script in this app. `PostingDescriptionModal` renders it as text with
  `pre-wrap`.
```

- [ ] **Step 3: Update the Layout section of `frontend/CLAUDE.md`**

In the `src/` tree, add the two new files:

```
  api/                      client.ts (fetch, ApiError), sources.ts (CRUD calls)
```

becomes

```
  services/                 client.ts (fetch, ApiError), sources.ts, postings.ts
```

and add below the `SourceFormModal` line:

```
  components/PostingDescriptionModal.tsx  one posting's description, as text
```

Note while you are there: the existing tree says `api/` where the directory is
actually `services/`. Fix it as shown — it is a stale name for the directory
this task is documenting, not unrelated tidying.

- [ ] **Step 4: Update the root `CLAUDE.md` Status section**

Replace:

```markdown
`frontend/` has a working sources screen — full CRUD against `/sources` — and
a placeholder postings page.
```

with:

```markdown
`frontend/` has a working sources screen — full CRUD against `/sources` — and
a working postings screen: a filterable, paged feed over `GET /postings`.
```

- [ ] **Step 5: Mark the spec implemented**

In `docs/superpowers/specs/2026-09-02-frontend-postings-page-design.md`, change
`Status: designed` to `Status: implemented`.

- [ ] **Step 6: Remove the seed data**

```bash
cd /Users/ykravchenko/www/JobSeeker
docker-compose exec -T postgres psql -U jobseeker -d jobseeker -c "
  delete from postings where url like 'https://example.com/job/%';
  delete from sources where name in ('Seed Board A', 'Seed Board B', 'Seed Board C');
  delete from users where email = 'empty@jobseeker.local';"
```

Then reload http://localhost:5173/postings.

Expected: "No postings yet" (assuming no real postings) — and importantly, no
error, which would mean the teardown broke a foreign key.

- [ ] **Step 7: Confirm the working tree is clean apart from the docs**

```bash
git status --short
```

Expected: only the three documentation files. If `frontend/src/` shows changes,
a temporary edit from Task 2 Step 8 (the broken `/sources-nope` path) or a
`.env.local` change from Task 1 Step 5 was not reverted. Revert it.

- [ ] **Step 8: Commit**

```bash
git add frontend/CLAUDE.md CLAUDE.md \
        docs/superpowers/specs/2026-09-02-frontend-postings-page-design.md
git commit -m "docs: record the postings page"
```

---

## Final verification

With all five tasks done:

```bash
cd /Users/ykravchenko/www/JobSeeker/frontend
npm run typecheck && npm run lint && npx @ant-design/cli lint ./src && npm run build
```

Expected: all four exit 0. `npm run build` is included here rather than
per-task because it is the only step that proves `tsc -b` and the production
bundle agree with what `npm run dev` has been serving.
