# Job Ingestion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scrape job postings from a `sources` row into the `postings` table, triggered by `POST /sources/:id/ingest` or `POST /ingest`, and read them back with `GET /postings`.

**Architecture:** A two-phase HTML adapter (`listItems` / `fetchDetail`) knows selectors and nothing else; the ingestion service drives the loop and owns every decision — blocklists, the already-stored check, the per-item delay, the item cap, the counters. Both endpoints are thin entrypoints over that one service, because the 30-minute schedule will become a third caller and must not fork the pipeline.

**Tech Stack:** Node 22, TypeScript (ESM, `NodeNext`), Fastify 5, cheerio, Drizzle ORM over `postgres.js`, Zod 4, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-job-ingestion-design.md`

## Global Constraints

- All work happens in `api/`. Run every command from `api/`.
- **Relative imports end in `.js`, never `.ts`** — required by `NodeNext`.
- `strict` and `noUncheckedIndexedAccess` are on. Indexing an array yields `T | undefined`; handle it, do not assert it away.
- Layering is `routes → services → repositories`, one direction only. No SQL outside `src/repositories/`. A service never sees a `FastifyRequest` and never sets a status code. The adapter is an outbound driver: only the ingestion service touches it, and it contains no SQL and reads no blocklist.
- No `setErrorHandler`, no domain error classes. Routes handle their own expected failures inline and reproduce Fastify's `{ statusCode, error, message }` body by hand.
- Wire format is **camelCase**; database columns are **snake_case**.
- Every repository method takes `userId` as its first parameter. There is no unscoped query. Postings carry no owner column, so every postings query joins `sources`.
- A source belonging to another user is a **404**, never a 403. Another user's `sourceId` as a `/postings` filter is an **empty page**, never a 404.
- `last_run_at`, `last_success_at` and `last_error` are written **only** by the ingestion pipeline. The CRUD routes must never set them.
- Every unit test runs **without a database and without a network socket**. `fetchText` and every repository are injected.
- After every task: `npm run typecheck && npm run lint && npm test` must all pass before committing.
- New top-level files must be covered by `tsconfig.json` or they go unchecked and unlinted.

## Deviations from the spec, decided while planning

Two, both small, both stated here so a reviewer does not read them as drift:

1. **The spec's test note says "fake timers" for `detail_delay_ms`.** This plan injects a `sleep(ms)` function into the ingestion service instead. A spy on `sleep` asserts the delay directly and cannot flake; fake timers plus real promise scheduling can.
2. **The spec's file list omits `src/services/postings.service.ts`.** `GET /postings` needs one, or the route would call a repository directly and break the layering rule. Added.

## File structure

| File | Responsibility |
|---|---|
| `package.json` | modify — add the `cheerio` dependency |
| `src/adapters/fetch-text.ts` | create — `fetchText`: global `fetch` + `AbortSignal.timeout`, body as text |
| `src/adapters/html-source.adapter.ts` | create — cheerio parsing; `listItems` and `fetchDetail`. No SQL, no blocklists |
| `src/services/blocklist.ts` | create — `findBlockedWord`: whole-word, case-insensitive token match |
| `src/repositories/postings.repository.ts` | create — `PostingsRepository`, `PostingRow`, `PostingInsert`, Drizzle impl |
| `src/repositories/users.repository.ts` | modify — add `findBlocklists` |
| `src/repositories/sources.repository.ts` | modify — add `recordRunStart`, `recordRunResult` |
| `src/services/ingestion.service.ts` | create — the run: cap, delay, blocklists, counters, source status |
| `src/services/postings.service.ts` | create — search, row → DTO |
| `src/routes/http.ts` | create — `fail`/`badRequest`/`notFound`/`conflict`/`zodMessage`/`makeCaller`, extracted from `sources.ts` |
| `src/routes/sources.ts` | modify — use the extracted helpers |
| `src/routes/ingest.schema.ts` | create — Zod: run summary, bulk response |
| `src/routes/ingest.ts` | create — `POST /sources/:id/ingest`, `POST /ingest` |
| `src/routes/postings.schema.ts` | create — Zod: query, item, list response |
| `src/routes/postings.ts` | create — `GET /postings` |
| `src/app.ts` | modify — extend `AppDeps`, wire real deps, register both route files |
| `CLAUDE.md`, `../CLAUDE.md` | modify — status, new conventions, the caveats worth inheriting |

Tests: `test/fetch-text.test.ts`, `test/html-source.adapter.test.ts`, `test/blocklist.test.ts`, `test/ingestion.service.test.ts`, `test/ingest.routes.test.ts`, `test/postings.routes.test.ts`, plus additions to `test/app.test.ts`.

No migration. `postings` already exists and this slice does not change the schema.

---

### Task 1: `fetchText`

**Files:**
- Modify: `api/package.json`
- Create: `api/src/adapters/fetch-text.ts`
- Test: `api/test/fetch-text.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export type FetchText = (url: string, timeoutMs: number) => Promise<string>` and `export const fetchText: FetchText`. Every later task that fetches takes a `FetchText`, never the global.

- [ ] **Step 1: Install cheerio**

Run: `npm install cheerio@^1.0.0`

cheerio is not used until Task 2, but it is the only dependency this slice adds and installing it once keeps the later tasks free of `npm install` steps.

- [ ] **Step 2: Write the failing test**

Create `api/test/fetch-text.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchText } from '../src/adapters/fetch-text.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchText', () => {
  it('returns the body of a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>hi</html>'))),
    )
    await expect(fetchText('https://example.com', 1000)).resolves.toBe(
      '<html>hi</html>',
    )
  })

  it('throws with the status in the message on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
    )
    await expect(fetchText('https://example.com/x', 1000)).rejects.toThrow(
      'HTTP 503',
    )
  })

  it('passes a timeout signal and a User-Agent', async () => {
    const spy = vi.fn(() => Promise.resolve(new Response('ok')))
    vi.stubGlobal('fetch', spy)
    await fetchText('https://example.com', 250)
    const init = spy.mock.calls[0]?.[1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(
      (init?.headers as Record<string, string> | undefined)?.['user-agent'],
    ).toContain('JobSeeker')
  })

  it('reports a timeout as a readable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(new DOMException('aborted', 'TimeoutError')),
      ),
    )
    await expect(fetchText('https://example.com', 5)).rejects.toThrow(
      'timed out after 5ms',
    )
  })
})
```

- [ ] **Step 3: Run the test and see it fail**

Run: `npx vitest run test/fetch-text.test.ts`
Expected: FAIL — cannot resolve `../src/adapters/fetch-text.js`.

- [ ] **Step 4: Implement it**

Create `api/src/adapters/fetch-text.ts`:

```ts
/**
 * The one place this project performs an outbound HTTP request.
 *
 * Injected into the ingestion service rather than imported by it, so the unit
 * suite can pass canned HTML and never open a socket. Node 22's global `fetch`
 * is enough — no HTTP client dependency.
 */
export type FetchText = (url: string, timeoutMs: number) => Promise<string>

/** Sent so a board's operator can see who is scraping them and complain. */
const USER_AGENT = 'JobSeeker/0.1 (+https://github.com/jobseeker)'

export const fetchText: FetchText = async (url, timeoutMs) => {
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
    })
  } catch (error) {
    // An abort surfaces as a bare "This operation was aborted", which in a
    // stored `last_error` gives no clue that a timeout is what happened.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`${url}: timed out after ${timeoutMs}ms`)
    }
    throw new Error(
      `${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return response.text()
}
```

- [ ] **Step 5: Run the test and see it pass**

Run: `npx vitest run test/fetch-text.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

```bash
git add package.json package-lock.json src/adapters/fetch-text.ts test/fetch-text.test.ts
git commit -m "feat: add fetchText, the one outbound HTTP call, and install cheerio"
```

---

### Task 2: The adapter's listing phase

**Files:**
- Create: `api/src/adapters/html-source.adapter.ts`
- Test: `api/test/html-source.adapter.test.ts`

**Interfaces:**
- Consumes: `FetchText` from Task 1.
- Produces:

```ts
export interface ListedItem { title: string; detailUrl: string }
export interface ItemError { url: string; message: string }
export interface ListingResult { items: ListedItem[]; errors: ItemError[] }
export function listItems(source: SourceRow, fetch: FetchText): Promise<ListingResult>
```

`ItemError` is the shape that reaches the HTTP response's `errors[]` unchanged — Task 6 and Task 8 both depend on `{ url, message }`.

- [ ] **Step 1: Write the failing test**

Create `api/test/html-source.adapter.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { listItems } from '../src/adapters/html-source.adapter.js'
import type { SourceRow } from '../src/repositories/sources.repository.js'

const OWNER = '00000000-0000-4000-8000-00000000000a'

/** A source row with the defaults the CRUD API would have given it. */
export function sourceRow(overrides: Partial<SourceRow> = {}): SourceRow {
  const now = new Date('2026-09-01T10:00:00.000Z')
  return {
    id: '00000000-0000-4000-8000-000000000001',
    userId: OWNER,
    name: 'Example Board',
    listingUrl: 'https://example.com/jobs/',
    enabled: true,
    itemSelector: '.job',
    titleSelector: '.title',
    titleAttr: null,
    detailUrlSelector: 'a.link',
    detailUrlAttr: 'href',
    descriptionSelector: '#description',
    descriptionAttr: null,
    companySelector: null,
    companyAttr: null,
    postedAtSelector: null,
    postedAtAttr: null,
    blockedTitleWords: [],
    blockedDescriptionWords: [],
    requestTimeoutMs: 10000,
    detailDelayMs: 1000,
    maxItemsPerRun: 100,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

const oneOf = (html: string) => vi.fn(() => Promise.resolve(html))

describe('listItems', () => {
  it('reads a title and an absolutized detail url from each item', async () => {
    const fetch = oneOf(`
      <div class="job"><span class="title"> Senior Dev </span><a class="link" href="/jobs/1">go</a></div>
      <div class="job"><span class="title">Junior Dev</span><a class="link" href="https://other.test/2">go</a></div>
    `)
    const result = await listItems(sourceRow(), fetch)
    expect(result.errors).toEqual([])
    expect(result.items).toEqual([
      { title: 'Senior Dev', detailUrl: 'https://example.com/jobs/1' },
      { title: 'Junior Dev', detailUrl: 'https://other.test/2' },
    ])
  })

  it('fetches the listing url with the source timeout', async () => {
    const fetch = oneOf('')
    await listItems(sourceRow({ requestTimeoutMs: 250 }), fetch)
    expect(fetch).toHaveBeenCalledWith('https://example.com/jobs/', 250)
  })

  it('keeps the query string, which can carry the job id', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title">Dev</span><a class="link" href="/view?id=99&src=rss">go</a></div>',
    )
    const { items } = await listItems(sourceRow(), fetch)
    expect(items[0]?.detailUrl).toBe('https://example.com/view?id=99&src=rss')
  })

  it('reads a title from an attribute when titleAttr is set', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title" data-name="From Attr">ignored</span><a class="link" href="/1">go</a></div>',
    )
    const { items } = await listItems(
      sourceRow({ titleAttr: 'data-name' }),
      fetch,
    )
    expect(items[0]?.title).toBe('From Attr')
  })

  it('matches a selector against the item element itself, not only its children', async () => {
    const fetch = oneOf(
      '<a class="job link" href="/1"><span class="title">Dev</span></a>',
    )
    const { items } = await listItems(
      sourceRow({ itemSelector: 'a.job', detailUrlSelector: 'a.job' }),
      fetch,
    )
    expect(items).toEqual([
      { title: 'Dev', detailUrl: 'https://example.com/1' },
    ])
  })

  it('treats an empty listing as a run with no items, not an error', async () => {
    const { items, errors } = await listItems(sourceRow(), oneOf('<main></main>'))
    expect(items).toEqual([])
    expect(errors).toEqual([])
  })

  it('reports an item with no title instead of dropping it silently', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title">   </span><a class="link" href="/1">go</a></div>',
    )
    const { items, errors } = await listItems(sourceRow(), fetch)
    expect(items).toEqual([])
    expect(errors).toEqual([
      { url: 'https://example.com/jobs/', message: 'item 1: empty title' },
    ])
  })

  it('reports an item whose detail url selector matches nothing', async () => {
    const fetch = oneOf('<div class="job"><span class="title">Dev</span></div>')
    const { items, errors } = await listItems(sourceRow(), fetch)
    expect(items).toEqual([])
    expect(errors[0]?.message).toBe('item 1: no detail url')
  })

  it('rejects a non-http scheme', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title">Dev</span><a class="link" href="javascript:alert(1)">go</a></div>',
    )
    const { items, errors } = await listItems(sourceRow(), fetch)
    expect(items).toEqual([])
    expect(errors[0]?.message).toContain('not http')
  })

  it('lets a listing fetch failure escape, for the service to record', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('HTTP 503')))
    await expect(listItems(sourceRow(), fetch)).rejects.toThrow('HTTP 503')
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/html-source.adapter.test.ts`
Expected: FAIL — cannot resolve `../src/adapters/html-source.adapter.js`.

- [ ] **Step 3: Implement the listing phase**

Create `api/src/adapters/html-source.adapter.ts`:

```ts
import * as cheerio from 'cheerio'
import type { FetchText } from './fetch-text.js'
import type { SourceRow } from '../repositories/sources.repository.js'

/**
 * The generic adapter. It knows HTML, CSS selectors and nothing else: no SQL,
 * no blocklists, and no opinion about whether a posting is worth fetching.
 *
 * It is split in two phases on purpose. The title blocklist must be applied
 * before a detail page is fetched (that is the whole point of it), and an
 * already-stored posting must not be re-fetched (that is why blocked postings
 * are stored at all). Both decisions need the blocklists and the database,
 * neither of which belongs here — so the service calls `listItems`, decides,
 * and calls `fetchDetail` only for the survivors.
 *
 * Consequence: the per-item delay and the item cap are the service's to
 * enforce. An adapter that fetched on its own schedule would take that back.
 */

export interface ListedItem {
  title: string
  detailUrl: string
}

/** One unusable item, or one failed detail fetch. Reaches the HTTP response as-is. */
export interface ItemError {
  url: string
  message: string
}

export interface ListingResult {
  items: ListedItem[]
  errors: ItemError[]
}

export interface DetailResult {
  description: string
  company: string | null
  postedAtRaw: string | null
}

type Api = cheerio.CheerioAPI
type Node = Parameters<Api>[0]

/**
 * A selector may name a descendant of the item or the item itself — a board
 * whose item element *is* the anchor is common enough that only supporting
 * `.find()` would make it unconfigurable.
 */
function pick($: Api, scope: cheerio.Cheerio<never>, selector: string) {
  const found = scope.find(selector)
  if (found.length > 0) return found.first()
  return scope.is(selector) ? scope : null
}

/** A null attribute means the element's trimmed text; otherwise that attribute. */
function read(
  el: ReturnType<typeof pick>,
  attr: string | null,
): string | null {
  if (!el) return null
  const raw = attr === null ? el.text() : el.attr(attr)
  const value = raw?.trim()
  return value ? value : null
}

export async function listItems(
  source: SourceRow,
  fetchText: FetchText,
): Promise<ListingResult> {
  // Deliberately not caught: a listing that cannot be fetched or parsed is a
  // source-level failure, and only the service can write `last_error`.
  const html = await fetchText(source.listingUrl, source.requestTimeoutMs)
  const $ = cheerio.load(html)

  const items: ListedItem[] = []
  const errors: ItemError[] = []

  $(source.itemSelector).each((index, element) => {
    const scope = $(element as Node) as unknown as cheerio.Cheerio<never>
    // 1-based: this number is read by a human comparing it against the page.
    const where = `item ${index + 1}`

    const title = read(pick($, scope, source.titleSelector), source.titleAttr)
    if (!title) {
      errors.push({ url: source.listingUrl, message: `${where}: empty title` })
      return
    }

    const href = read(
      pick($, scope, source.detailUrlSelector),
      source.detailUrlAttr,
    )
    if (!href) {
      errors.push({ url: source.listingUrl, message: `${where}: no detail url` })
      return
    }

    let resolved: URL
    try {
      // Absolutizes a relative href. Query strings are kept: some boards carry
      // the job id there, and the URL is this posting's identity.
      resolved = new URL(href, source.listingUrl)
    } catch {
      errors.push({
        url: source.listingUrl,
        message: `${where}: unresolvable detail url ${href}`,
      })
      return
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      errors.push({
        url: source.listingUrl,
        message: `${where}: detail url is not http/https (${resolved.protocol})`,
      })
      return
    }

    items.push({ title, detailUrl: resolved.toString() })
  })

  return { items, errors }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/html-source.adapter.test.ts`
Expected: PASS, 11 tests.

If the `pick` cast fights the cheerio types, keep the runtime behavior and adjust the annotations — `scope.find(...)` / `scope.is(...)` / `.attr(...)` / `.text()` are the only cheerio calls needed. Do not silence it with `any`; `lint` runs type-aware rules and will reject it.

- [ ] **Step 5: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/adapters/html-source.adapter.ts test/html-source.adapter.test.ts
git commit -m "feat: add the listing phase of the generic HTML adapter"
```

---

### Task 3: The adapter's detail phase

**Files:**
- Modify: `api/src/adapters/html-source.adapter.ts`
- Test: `api/test/html-source.adapter.test.ts`

**Interfaces:**
- Consumes: `pick`, `read`, `DetailResult` from Task 2.
- Produces: `export function fetchDetail(source: SourceRow, url: string, fetch: FetchText): Promise<DetailResult>`.

- [ ] **Step 1: Write the failing test**

Append to `api/test/html-source.adapter.test.ts`:

```ts
import { fetchDetail } from '../src/adapters/html-source.adapter.js'

describe('fetchDetail', () => {
  const page = `
    <div id="description"> We need a <b>dev</b>. </div>
    <span class="company">ACME</span>
    <time class="posted" datetime="2026-08-30T00:00:00Z">3 days ago</time>
  `

  it('reads the description from the detail page', async () => {
    const fetch = vi.fn(() => Promise.resolve(page))
    const detail = await fetchDetail(
      sourceRow(),
      'https://example.com/jobs/1',
      fetch,
    )
    expect(detail.description).toBe('We need a dev.')
    expect(fetch).toHaveBeenCalledWith('https://example.com/jobs/1', 10000)
  })

  it('leaves the optional fields null when no selector is configured', async () => {
    const detail = await fetchDetail(
      sourceRow(),
      'https://example.com/jobs/1',
      vi.fn(() => Promise.resolve(page)),
    )
    expect(detail.company).toBeNull()
    expect(detail.postedAtRaw).toBeNull()
  })

  it('reads the optional fields when selectors are configured', async () => {
    const detail = await fetchDetail(
      sourceRow({
        companySelector: '.company',
        postedAtSelector: 'time.posted',
        postedAtAttr: 'datetime',
      }),
      'https://example.com/jobs/1',
      vi.fn(() => Promise.resolve(page)),
    )
    expect(detail.company).toBe('ACME')
    expect(detail.postedAtRaw).toBe('2026-08-30T00:00:00Z')
  })

  it('leaves an optional field null when its selector matches nothing', async () => {
    const detail = await fetchDetail(
      sourceRow({ companySelector: '.nope' }),
      'https://example.com/jobs/1',
      vi.fn(() => Promise.resolve(page)),
    )
    expect(detail.company).toBeNull()
  })

  it('throws when the description selector matches nothing', async () => {
    await expect(
      fetchDetail(
        sourceRow(),
        'https://example.com/jobs/1',
        vi.fn(() => Promise.resolve('<main>no description here</main>')),
      ),
    ).rejects.toThrow('description selector matched nothing')
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/html-source.adapter.test.ts -t fetchDetail`
Expected: FAIL — `fetchDetail` is not exported.

- [ ] **Step 3: Implement the detail phase**

Append to `api/src/adapters/html-source.adapter.ts`:

```ts
export async function fetchDetail(
  source: SourceRow,
  url: string,
  fetchText: FetchText,
): Promise<DetailResult> {
  const html = await fetchText(url, source.requestTimeoutMs)
  const $ = cheerio.load(html)
  const root = $.root() as unknown as cheerio.Cheerio<never>

  const description = read(
    pick($, root, source.descriptionSelector),
    source.descriptionAttr,
  )
  // `postings.description` is NOT NULL and a posting with no body is useless.
  // Throwing puts this item in the run's `errors[]` and leaves it unstored, so
  // the next run retries it — which is what a page that failed to render wants.
  if (!description) {
    throw new Error(
      `${url}: description selector matched nothing (${source.descriptionSelector})`,
    )
  }

  // The optional fields are optional twice over: the selector may be unset, and
  // a configured selector may match nothing. Neither is a failure — a board
  // that omits the company on some postings is normal.
  const company = source.companySelector
    ? read(pick($, root, source.companySelector), source.companyAttr)
    : null
  const postedAtRaw = source.postedAtSelector
    ? read(pick($, root, source.postedAtSelector), source.postedAtAttr)
    : null

  return { description, company, postedAtRaw }
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/html-source.adapter.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/adapters/html-source.adapter.ts test/html-source.adapter.test.ts
git commit -m "feat: add the detail phase of the generic HTML adapter"
```

---

### Task 4: The blocklist matcher

**Files:**
- Create: `api/src/services/blocklist.ts`
- Test: `api/test/blocklist.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export function findBlockedWord(text: string, words: string[]): string | null` — returns the first word in `words` order that matches, or null.

- [ ] **Step 1: Write the failing test**

Create `api/test/blocklist.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { findBlockedWord } from '../src/services/blocklist.js'

describe('findBlockedWord', () => {
  it('matches a whole word regardless of case', () => {
    expect(findBlockedWord('Senior PHP Developer', ['php'])).toBe('php')
  })

  it('does not match inside a longer word', () => {
    expect(findBlockedWord('phpMyAdmin specialist', ['php'])).toBeNull()
  })

  it('matches a word followed by punctuation', () => {
    expect(findBlockedWord('We need PHP, urgently', ['php'])).toBe('php')
    expect(findBlockedWord('Must know PHP.', ['php'])).toBe('php')
  })

  it('keeps + and # so c++ and c# are matchable', () => {
    expect(findBlockedWord('C++ Engineer', ['c++'])).toBe('c++')
    expect(findBlockedWord('C# Engineer', ['c#'])).toBe('c#')
    expect(findBlockedWord('C++ Engineer', ['c'])).toBeNull()
  })

  it('returns the first matching word in list order', () => {
    expect(findBlockedWord('PHP and Drupal', ['drupal', 'php'])).toBe('drupal')
  })

  it('returns null for an empty word list', () => {
    expect(findBlockedWord('anything at all', [])).toBeNull()
  })

  it('ignores an empty or whitespace entry rather than matching everything', () => {
    expect(findBlockedWord('anything at all', ['', '   '])).toBeNull()
  })

  it('matches across newlines, as a description arrives', () => {
    expect(findBlockedWord('Stack:\n  - PHP\n  - MySQL', ['mysql'])).toBe('mysql')
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/blocklist.test.ts`
Expected: FAIL — cannot resolve `../src/services/blocklist.js`.

- [ ] **Step 3: Implement it**

Create `api/src/services/blocklist.ts`:

```ts
/**
 * Whole-word, case-insensitive blocklist matching. `php` blocks "PHP
 * Developer" and not "phpMyAdmin".
 *
 * Tokenizing beats a `\b`-anchored regex here: `\bc\+\+\b` cannot match "C++"
 * at all, because `+` is not a word character and the trailing boundary never
 * appears. Splitting on everything except letters, digits, `+` and `#` makes
 * "c++" and "c#" matchable and keeps trailing punctuation ("PHP.") from
 * defeating a match.
 *
 * The consequence, and it is worth knowing before you write a blocklist: a dot
 * is a separator, so "node.js" tokenizes to `node` and `js`. Block `node`, not
 * `node.js`. Entries are single tokens — phrase matching is not supported.
 *
 * Words arrive already lowercased and trimmed (the sources service normalizes
 * them on write); the guards here exist because a hand-written row need not.
 */
const SEPARATORS = /[^\p{L}\p{N}+#]+/u

export function findBlockedWord(text: string, words: string[]): string | null {
  if (words.length === 0) return null
  const tokens = new Set(
    text.toLowerCase().split(SEPARATORS).filter((token) => token.length > 0),
  )
  for (const word of words) {
    const needle = word.trim().toLowerCase()
    // An empty entry would otherwise match every text, blocking a whole board.
    if (needle.length === 0) continue
    if (tokens.has(needle)) return word
  }
  return null
}
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/blocklist.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/services/blocklist.ts test/blocklist.test.ts
git commit -m "feat: add whole-word blocklist matching"
```

---

### Task 5: Repositories

**Files:**
- Create: `api/src/repositories/postings.repository.ts`
- Modify: `api/src/repositories/users.repository.ts`
- Modify: `api/src/repositories/sources.repository.ts`

**Interfaces:**
- Consumes: `postings`, `sources` from `src/db/schema.ts`.
- Produces:

```ts
// postings.repository.ts
export interface PostingRow {
  id: string; sourceId: string; url: string; title: string
  company: string | null; description: string
  postedAtRaw: string | null; postedAt: Date | null
  blockedBy: string | null; firstSeenAt: Date; lastSeenAt: Date
}
export interface PostingInsert {
  sourceId: string; url: string; title: string; company: string | null
  description: string; postedAtRaw: string | null; postedAt: Date | null
  blockedBy: string | null
}
export interface PostingSearch {
  sourceId?: string; includeBlocked: boolean; limit: number; offset: number
}
export interface PostingsRepository {
  findExistingUrls(userId: string, sourceId: string): Promise<Set<string>>
  touchLastSeen(userId: string, sourceId: string, urls: string[]): Promise<void>
  upsert(userId: string, posting: PostingInsert): Promise<void>
  search(userId: string, filters: PostingSearch): Promise<{ items: PostingRow[]; total: number }>
}
export function createPostingsRepository(): PostingsRepository

// users.repository.ts — added to the existing interface
findBlocklists(userId: string): Promise<{ blockedTitleWords: string[]; blockedDescriptionWords: string[] }>

// sources.repository.ts — added to the existing interface
recordRunStart(userId: string, id: string): Promise<void>
recordRunResult(userId: string, id: string, result: { lastError: string | null }): Promise<void>
```

**Note on testing.** This task ships no test, and that is deliberate rather than an omission: these methods are pure SQL, the suite has no database (see the `npm test` contract in `CLAUDE.md`), and the existing `sources.repository.ts` has no test either for the same reason. Testing them against fakes would assert that the fake works. Their gate is `typecheck` + `lint`, and Task 6 exercises the interfaces through in-memory doubles. The spec names the two behaviors this leaves unproven.

- [ ] **Step 1: Create the postings repository**

Create `api/src/repositories/postings.repository.ts`:

```ts
import { and, desc, eq, exists, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '../db/client.js'
import { postings, sources } from '../db/schema.js'

/** A `postings` row as Drizzle returns it: camelCase, `Date` for timestamps. */
export interface PostingRow {
  id: string
  sourceId: string
  url: string
  title: string
  company: string | null
  description: string
  postedAtRaw: string | null
  postedAt: Date | null
  blockedBy: string | null
  firstSeenAt: Date
  lastSeenAt: Date
}

/** What the pipeline supplies. The timestamps default in the database. */
export interface PostingInsert {
  sourceId: string
  url: string
  title: string
  company: string | null
  description: string
  postedAtRaw: string | null
  postedAt: Date | null
  blockedBy: string | null
}

export interface PostingSearch {
  sourceId?: string
  includeBlocked: boolean
  limit: number
  offset: number
}

/**
 * Postings carry no owner column — ownership is `sources.user_id`'s to answer,
 * so every method here joins or constrains through `sources`. As with
 * `SourcesRepository`, no method omits `userId`: the isolation guarantee is
 * structural, so there is no unscoped query for a later change to forget.
 */
export interface PostingsRepository {
  /** The URLs already stored for this source, in one query. */
  findExistingUrls(userId: string, sourceId: string): Promise<Set<string>>
  /** Advances `last_seen_at` on postings re-seen in a run. */
  touchLastSeen(userId: string, sourceId: string, urls: string[]): Promise<void>
  /** Insert, or advance `last_seen_at` if this URL is already stored. */
  upsert(userId: string, posting: PostingInsert): Promise<void>
  search(
    userId: string,
    filters: PostingSearch,
  ): Promise<{ items: PostingRow[]; total: number }>
}

/** Explicit, because a joined `select()` would nest the rows under table keys. */
const postingColumns = {
  id: postings.id,
  sourceId: postings.sourceId,
  url: postings.url,
  title: postings.title,
  company: postings.company,
  description: postings.description,
  postedAtRaw: postings.postedAtRaw,
  postedAt: postings.postedAt,
  blockedBy: postings.blockedBy,
  firstSeenAt: postings.firstSeenAt,
  lastSeenAt: postings.lastSeenAt,
}

/** The caller owns this source and it is not soft-deleted. */
const ownsSource = (userId: string, sourceId: string) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(sources)
      .where(
        and(
          eq(sources.id, sourceId),
          eq(sources.userId, userId),
          isNull(sources.deletedAt),
        ),
      ),
  )

export function createPostingsRepository(): PostingsRepository {
  return {
    async findExistingUrls(userId, sourceId) {
      const rows = await db
        .select({ url: postings.url })
        .from(postings)
        .where(
          and(eq(postings.sourceId, sourceId), ownsSource(userId, sourceId)),
        )
      return new Set(rows.map((row) => row.url))
    },

    async touchLastSeen(userId, sourceId, urls) {
      // `inArray` with an empty list generates `in ()`, which is a syntax error.
      if (urls.length === 0) return
      await db
        .update(postings)
        .set({ lastSeenAt: new Date() })
        .where(
          and(
            eq(postings.sourceId, sourceId),
            inArray(postings.url, urls),
            ownsSource(userId, sourceId),
          ),
        )
    },

    async upsert(userId, posting) {
      // Raw SQL because an INSERT takes no WHERE: the ownership guard has to be
      // an INSERT ... SELECT, and this keeps it to one statement with no
      // check-then-act gap. `on conflict` makes an overlapping run harmless
      // instead of a unique violation.
      await db.execute(sql`
        insert into postings
          (source_id, url, title, company, description,
           posted_at_raw, posted_at, blocked_by)
        select
          ${posting.sourceId}::uuid,
          ${posting.url}::text,
          ${posting.title}::text,
          ${posting.company}::text,
          ${posting.description}::text,
          ${posting.postedAtRaw}::text,
          ${posting.postedAt}::timestamptz,
          ${posting.blockedBy}::text
        from sources
        where sources.id = ${posting.sourceId}::uuid
          and sources.user_id = ${userId}::uuid
          and sources.deleted_at is null
        on conflict (source_id, url) do update set last_seen_at = now()
      `)
    },

    async search(userId, { sourceId, includeBlocked, limit, offset }) {
      const conditions = [
        eq(sources.userId, userId),
        isNull(sources.deletedAt),
      ]
      // A filter, not a lookup: another user's sourceId simply matches nothing.
      if (sourceId) conditions.push(eq(postings.sourceId, sourceId))
      if (!includeBlocked) conditions.push(isNull(postings.blockedBy))
      const where = and(...conditions)

      const items = await db
        .select(postingColumns)
        .from(postings)
        .innerJoin(sources, eq(postings.sourceId, sources.id))
        .where(where)
        // `id` breaks ties so paging cannot show or skip a row when several
        // share a `first_seen_at` — every posting from one run does.
        .orderBy(desc(postings.firstSeenAt), desc(postings.id))
        .limit(limit)
        .offset(offset)

      const counted = await db
        // `::int` because postgres.js returns bigint counts as strings.
        .select({ total: sql<number>`count(*)::int` })
        .from(postings)
        .innerJoin(sources, eq(postings.sourceId, sources.id))
        .where(where)

      return { items, total: counted[0]?.total ?? 0 }
    },
  }
}
```

- [ ] **Step 2: Add `findBlocklists` to the users repository**

In `api/src/repositories/users.repository.ts`, add to the `UsersRepository` interface:

```ts
  /**
   * The owner's two blocklists, which apply across all of their sources. Read
   * once per source run and unioned with the source's own lists.
   */
  findBlocklists(
    userId: string,
  ): Promise<{ blockedTitleWords: string[]; blockedDescriptionWords: string[] }>
```

and to the returned object in `createUsersRepository()`:

```ts
    async findBlocklists(userId) {
      const rows = await db
        .select({
          blockedTitleWords: users.blockedTitleWords,
          blockedDescriptionWords: users.blockedDescriptionWords,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
      // A caller that got this far was resolved by `resolveCurrentUser`, so the
      // row exists; empty lists are the safe reading if it somehow does not.
      return rows[0] ?? { blockedTitleWords: [], blockedDescriptionWords: [] }
    },
```

Add whatever imports are missing (`users`, `eq`, `db`) to match the file's existing style.

- [ ] **Step 3: Add the run-status writers to the sources repository**

In `api/src/repositories/sources.repository.ts`, add to the `SourcesRepository` interface:

```ts
  /**
   * The pipeline's health columns. These two methods are the only writers of
   * `last_run_at`, `last_success_at` and `last_error` — the CRUD routes must
   * never touch them, and `update()` cannot: `SourceUpdate` has no such keys.
   *
   * Neither reports whether a row matched. The caller has already read the row
   * through `findById`, and a source deleted mid-run does not need a second
   * error path.
   */
  recordRunStart(userId: string, id: string): Promise<void>
  recordRunResult(
    userId: string,
    id: string,
    result: { lastError: string | null },
  ): Promise<void>
```

and to `createSourcesRepository()`:

```ts
    async recordRunStart(userId, id) {
      await db
        .update(sources)
        // `updatedAt` is deliberately not touched: it tracks edits to the
        // user's configuration, and a scrape run is not an edit.
        .set({ lastRunAt: new Date() })
        .where(and(live(userId), eq(sources.id, id)))
    },

    async recordRunResult(userId, id, { lastError }) {
      await db
        .update(sources)
        .set(
          lastError === null
            ? { lastSuccessAt: new Date(), lastError: null }
            : { lastError },
        )
        .where(and(live(userId), eq(sources.id, id)))
    },
```

- [ ] **Step 4: Gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass. The suite is unchanged in size — nothing tests these directly, per the note above.

```bash
git add src/repositories/
git commit -m "feat: add the postings repository and the pipeline's status writers"
```

---

### Task 6: The ingestion service

**Files:**
- Create: `api/src/services/ingestion.service.ts`
- Test: `api/test/ingestion.service.test.ts`

**Interfaces:**
- Consumes: `listItems`, `fetchDetail`, `ItemError` (Task 2/3), `findBlockedWord` (Task 4), `PostingsRepository`, `SourcesRepository`, `UsersRepository` (Task 5), `FetchText` (Task 1).
- Produces:

```ts
export interface RunSummary {
  sourceId: string; fetched: number; created: number; updated: number
  blocked: number; truncated: boolean; errors: ItemError[]
}
export type IngestOneResult =
  | { ok: true; summary: RunSummary }
  | { ok: false; reason: 'not-found' | 'disabled' }
export interface IngestionDeps {
  sources: SourcesRepository; postings: PostingsRepository
  users: UsersRepository; fetchText: FetchText
  sleep?: (ms: number) => Promise<void>
}
export function createIngestionService(deps: IngestionDeps): IngestionService
// service: ingestOne(userId, sourceId): Promise<IngestOneResult>
//          ingestAll(userId): Promise<RunSummary[]>
export type IngestionService = ReturnType<typeof createIngestionService>
```

Task 8 maps `reason: 'not-found'` to 404 and `'disabled'` to 409. The service returns a reason and never a status code.

- [ ] **Step 1: Write the failing test**

Create `api/test/ingestion.service.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { createIngestionService } from '../src/services/ingestion.service.js'
import type {
  PostingInsert,
  PostingsRepository,
} from '../src/repositories/postings.repository.js'
import type {
  SourceRow,
  SourcesRepository,
} from '../src/repositories/sources.repository.js'
import type { UsersRepository } from '../src/repositories/users.repository.js'
import { sourceRow } from './html-source.adapter.test.js'

const ALICE = '00000000-0000-4000-8000-00000000000a'

/** Records what was written, and enforces the URL identity rule. */
function fakePostings(existing: string[] = []) {
  const inserted: PostingInsert[] = []
  const touched: string[] = []
  const urls = new Set(existing)
  const repo: PostingsRepository = {
    findExistingUrls: () => Promise.resolve(new Set(urls)),
    touchLastSeen: (_userId, _sourceId, list) => {
      touched.push(...list)
      return Promise.resolve()
    },
    upsert: (_userId, posting) => {
      inserted.push(posting)
      urls.add(posting.url)
      return Promise.resolve()
    },
    search: () => Promise.resolve({ items: [], total: 0 }),
  }
  return { repo, inserted, touched }
}

function fakeSources(rows: SourceRow[]) {
  const started: string[] = []
  const results: { id: string; lastError: string | null }[] = []
  const repo: SourcesRepository = {
    list: () => Promise.resolve(rows),
    findById: (_userId, id) => Promise.resolve(rows.find((r) => r.id === id) ?? null),
    create: () => Promise.reject(new Error('not used')),
    update: () => Promise.reject(new Error('not used')),
    softDelete: () => Promise.reject(new Error('not used')),
    recordRunStart: (_userId, id) => {
      started.push(id)
      return Promise.resolve()
    },
    recordRunResult: (_userId, id, { lastError }) => {
      results.push({ id, lastError })
      return Promise.resolve()
    },
  }
  return { repo, started, results }
}

function fakeUsers(
  blocklists = { blockedTitleWords: [] as string[], blockedDescriptionWords: [] as string[] },
): UsersRepository {
  return {
    exists: () => Promise.resolve(true),
    findBlocklists: () => Promise.resolve(blocklists),
  }
}

const LISTING = `
  <div class="job"><span class="title">Senior Dev</span><a class="link" href="/1">go</a></div>
  <div class="job"><span class="title">PHP Dev</span><a class="link" href="/2">go</a></div>
`
const DETAIL = '<div id="description">A good job with Kubernetes.</div>'

/** Serves the listing for the listing URL and a detail page for anything else. */
function pages(listing = LISTING, detail = DETAIL) {
  return vi.fn((url: string) =>
    Promise.resolve(url === 'https://example.com/jobs/' ? listing : detail),
  )
}

describe('ingestOne', () => {
  it('stores new postings and reports the counters', async () => {
    const source = sourceRow()
    const sources = fakeSources([source])
    const postings = fakePostings()
    const service = createIngestionService({
      sources: sources.repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })

    const result = await service.ingestOne(ALICE, source.id)

    expect(result).toMatchObject({
      ok: true,
      summary: {
        sourceId: source.id,
        fetched: 2,
        created: 2,
        updated: 0,
        blocked: 0,
        truncated: false,
        errors: [],
      },
    })
    expect(postings.inserted.map((p) => p.url)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
    ])
    expect(postings.inserted[0]).toMatchObject({
      title: 'Senior Dev',
      description: 'A good job with Kubernetes.',
      blockedBy: null,
    })
    expect(sources.started).toEqual([source.id])
    expect(sources.results).toEqual([{ id: source.id, lastError: null }])
  })

  it('never fetches the detail page of a title-blocked posting', async () => {
    const source = sourceRow({ blockedTitleWords: ['php'] })
    const postings = fakePostings()
    const fetchText = pages()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText,
      sleep: () => Promise.resolve(),
    })

    const result = await service.ingestOne(ALICE, source.id)

    expect(result).toMatchObject({
      ok: true,
      summary: { fetched: 2, created: 1, blocked: 1 },
    })
    // The saved request is the feature, so assert on the spy and not only the row.
    expect(fetchText.mock.calls.map((call) => call[0])).toEqual([
      'https://example.com/jobs/',
      'https://example.com/1',
    ])
    const blocked = postings.inserted.find((p) => p.blockedBy !== null)
    expect(blocked).toMatchObject({
      url: 'https://example.com/2',
      blockedBy: 'php',
      description: '',
    })
  })

  it("unions the owner's blocklist with the source's", async () => {
    const source = sourceRow()
    const postings = fakePostings()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers({
        blockedTitleWords: ['senior'],
        blockedDescriptionWords: [],
      }),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: { blocked: number }
    }

    expect(summary.blocked).toBe(1)
    expect(postings.inserted[0]).toMatchObject({ blockedBy: 'senior' })
  })

  it('blocks on the description only after fetching the detail page', async () => {
    const source = sourceRow({ blockedDescriptionWords: ['kubernetes'] })
    const postings = fakePostings()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: { created: number; blocked: number }
    }

    expect(summary).toMatchObject({ created: 0, blocked: 2 })
    // Stored with the body, unlike a title block: the fetch already happened.
    expect(postings.inserted[0]).toMatchObject({
      blockedBy: 'kubernetes',
      description: 'A good job with Kubernetes.',
    })
  })

  it('skips the detail fetch for a posting already stored and bumps lastSeenAt', async () => {
    const source = sourceRow()
    const postings = fakePostings(['https://example.com/1'])
    const fetchText = pages()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText,
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: { updated: number; created: number }
    }

    expect(summary).toMatchObject({ updated: 1, created: 1 })
    expect(postings.touched).toEqual(['https://example.com/1'])
    expect(fetchText.mock.calls.map((call) => call[0])).toEqual([
      'https://example.com/jobs/',
      'https://example.com/2',
    ])
  })

  it('truncates at maxItemsPerRun and says so', async () => {
    const source = sourceRow({ maxItemsPerRun: 1 })
    const postings = fakePostings()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: { fetched: number; truncated: boolean }
    }

    expect(summary).toMatchObject({ fetched: 1, truncated: true })
    expect(postings.inserted).toHaveLength(1)
  })

  it('waits detailDelayMs between detail fetches but not before the first', async () => {
    const source = sourceRow({ detailDelayMs: 750 })
    const sleep = vi.fn(() => Promise.resolve())
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: fakePostings().repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep,
    })

    await service.ingestOne(ALICE, source.id)

    expect(sleep.mock.calls).toEqual([[750]])
  })

  it('keeps a failed detail fetch out of storage and the run alive', async () => {
    const source = sourceRow()
    const postings = fakePostings()
    const fetchText = vi.fn((url: string) => {
      if (url === 'https://example.com/jobs/') return Promise.resolve(LISTING)
      if (url === 'https://example.com/1') return Promise.reject(new Error('HTTP 503'))
      return Promise.resolve(DETAIL)
    })
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText,
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: { fetched: number; created: number; errors: unknown[] }
    }

    expect(summary).toMatchObject({ fetched: 2, created: 1 })
    expect(summary.errors).toEqual([
      { url: 'https://example.com/1', message: 'HTTP 503' },
    ])
    expect(postings.inserted.map((p) => p.url)).toEqual([
      'https://example.com/2',
    ])
  })

  it('records lastError and returns fetched:0 when the listing fetch fails', async () => {
    const source = sourceRow()
    const sources = fakeSources([source])
    const service = createIngestionService({
      sources: sources.repo,
      postings: fakePostings().repo,
      users: fakeUsers(),
      fetchText: vi.fn(() => Promise.reject(new Error('HTTP 500'))),
      sleep: () => Promise.resolve(),
    })

    const result = await service.ingestOne(ALICE, source.id)

    // Still ok:true — a dead board is a reported run, not a failed request.
    expect(result).toMatchObject({
      ok: true,
      summary: {
        fetched: 0,
        created: 0,
        errors: [{ url: 'https://example.com/jobs/', message: 'HTTP 500' }],
      },
    })
    expect(sources.results).toEqual([
      { id: source.id, lastError: 'HTTP 500' },
    ])
  })

  it('reports unusable listing items in errors and counts them in fetched', async () => {
    const source = sourceRow()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: fakePostings().repo,
      users: fakeUsers(),
      fetchText: pages(
        '<div class="job"><span class="title"></span></div>' + LISTING,
      ),
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: { fetched: number; created: number; errors: unknown[] }
    }

    // The invariant: created + updated + blocked + errors.length === fetched.
    expect(summary.fetched).toBe(3)
    expect(summary.created).toBe(2)
    expect(summary.errors).toHaveLength(1)
  })

  it('parses postedAt when it is a real date and keeps the raw string either way', async () => {
    const source = sourceRow({
      postedAtSelector: 'time',
      postedAtAttr: 'datetime',
    })
    const postings = fakePostings()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText: pages(
        '<div class="job"><span class="title">Dev</span><a class="link" href="/1">go</a></div>',
        '<div id="description">Body</div><time datetime="2026-08-30T00:00:00Z">x</time>',
      ),
      sleep: () => Promise.resolve(),
    })

    await service.ingestOne(ALICE, source.id)

    expect(postings.inserted[0]).toMatchObject({
      postedAtRaw: '2026-08-30T00:00:00Z',
      postedAt: new Date('2026-08-30T00:00:00Z'),
    })
  })

  it('leaves postedAt null for a relative date, keeping the raw string visible', async () => {
    const source = sourceRow({ postedAtSelector: 'time' })
    const postings = fakePostings()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText: pages(
        '<div class="job"><span class="title">Dev</span><a class="link" href="/1">go</a></div>',
        '<div id="description">Body</div><time>3 days ago</time>',
      ),
      sleep: () => Promise.resolve(),
    })

    await service.ingestOne(ALICE, source.id)

    expect(postings.inserted[0]).toMatchObject({
      postedAtRaw: '3 days ago',
      postedAt: null,
    })
  })

  it('reports not-found for an unknown source', async () => {
    const service = createIngestionService({
      sources: fakeSources([]).repo,
      postings: fakePostings().repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })
    await expect(
      service.ingestOne(ALICE, '00000000-0000-4000-8000-0000000000ff'),
    ).resolves.toEqual({ ok: false, reason: 'not-found' })
  })

  it('refuses a disabled source without starting a run', async () => {
    const source = sourceRow({ enabled: false })
    const sources = fakeSources([source])
    const fetchText = pages()
    const service = createIngestionService({
      sources: sources.repo,
      postings: fakePostings().repo,
      users: fakeUsers(),
      fetchText,
      sleep: () => Promise.resolve(),
    })

    await expect(service.ingestOne(ALICE, source.id)).resolves.toEqual({
      ok: false,
      reason: 'disabled',
    })
    expect(sources.started).toEqual([])
    expect(fetchText).not.toHaveBeenCalled()
  })
})

describe('ingestAll', () => {
  it('runs only enabled sources, one at a time', async () => {
    const a = sourceRow({ id: '00000000-0000-4000-8000-000000000001' })
    const off = sourceRow({
      id: '00000000-0000-4000-8000-000000000002',
      enabled: false,
    })
    const service = createIngestionService({
      sources: fakeSources([a, off]).repo,
      postings: fakePostings().repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })

    const runs = await service.ingestAll(ALICE)

    expect(runs.map((run) => run.sourceId)).toEqual([a.id])
  })

  it('keeps going after one source throws, reporting it', async () => {
    const a = sourceRow({ id: '00000000-0000-4000-8000-000000000001' })
    const b = sourceRow({ id: '00000000-0000-4000-8000-000000000002' })
    const postings = fakePostings()
    // A repository failure, not a fetch failure: the run's own error handling
    // does not cover this, so `ingestAll` must.
    let calls = 0
    postings.repo.findExistingUrls = () => {
      calls += 1
      return calls === 1
        ? Promise.reject(new Error('connection lost'))
        : Promise.resolve(new Set())
    }
    const service = createIngestionService({
      sources: fakeSources([a, b]).repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })

    const runs = await service.ingestAll(ALICE)

    expect(runs).toHaveLength(2)
    expect(runs[0]?.errors[0]?.message).toContain('connection lost')
    expect(runs[1]?.created).toBe(2)
  })

  it('returns an empty list for a user with no sources', async () => {
    const service = createIngestionService({
      sources: fakeSources([]).repo,
      postings: fakePostings().repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })
    await expect(service.ingestAll(ALICE)).resolves.toEqual([])
  })
})
```

Note: this imports `sourceRow` from `test/html-source.adapter.test.ts`, which is why Task 2 exported it. Vitest importing a helper from another test file is fine — that file's own tests do not re-run.

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/ingestion.service.test.ts`
Expected: FAIL — cannot resolve `../src/services/ingestion.service.js`.

- [ ] **Step 3: Implement the service**

Create `api/src/services/ingestion.service.ts`:

```ts
import { fetchDetail, listItems } from '../adapters/html-source.adapter.js'
import { findBlockedWord } from './blocklist.js'
import type { FetchText } from '../adapters/fetch-text.js'
import type { ItemError } from '../adapters/html-source.adapter.js'
import type { PostingsRepository } from '../repositories/postings.repository.js'
import type {
  SourceRow,
  SourcesRepository,
} from '../repositories/sources.repository.js'
import type { UsersRepository } from '../repositories/users.repository.js'

/**
 * The pipeline. Both HTTP triggers call this, and the 30-minute schedule will
 * become a third caller — so a trigger stays a thin entrypoint and never a
 * second copy of what is below.
 *
 * Everything the adapter is not allowed to know lives here: the blocklists,
 * the already-stored check, the per-item delay, the item cap, and the counters.
 */

export interface RunSummary {
  sourceId: string
  /** Items accounted for: post-truncation items plus unusable listing entries. */
  fetched: number
  /** Inserted with `blockedBy` null. */
  created: number
  /** Already stored; `lastSeenAt` advanced. Includes previously blocked ones. */
  updated: number
  /** Inserted with `blockedBy` set, whether the title or the description matched. */
  blocked: number
  /** True when `maxItemsPerRun` cut the list. Never a silent cap. */
  truncated: boolean
  errors: ItemError[]
}

export type IngestOneResult =
  | { ok: true; summary: RunSummary }
  | { ok: false; reason: 'not-found' | 'disabled' }

export interface IngestionDeps {
  sources: SourcesRepository
  postings: PostingsRepository
  users: UsersRepository
  fetchText: FetchText
  /** Injected so tests assert the delay on a spy instead of waiting for it. */
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `posted_at_raw` keeps whatever the board said; `posted_at` is set only when
 * that string is a real date. "3 days ago" leaves it null on purpose — the raw
 * column exists so a parse misfire stays visible instead of becoming a wrong
 * timestamp. Relative-date parsing is out of scope.
 */
function parsePostedAt(raw: string | null): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function createIngestionService(deps: IngestionDeps) {
  const sleep = deps.sleep ?? realSleep

  async function runSource(
    userId: string,
    source: SourceRow,
  ): Promise<RunSummary> {
    const summary: RunSummary = {
      sourceId: source.id,
      fetched: 0,
      created: 0,
      updated: 0,
      blocked: 0,
      truncated: false,
      errors: [],
    }

    await deps.sources.recordRunStart(userId, source.id)

    // A source may add markers to its owner's but can never remove one, which
    // is just concatenation: the owner's list is always present.
    const owner = await deps.users.findBlocklists(userId)
    const titleWords = [
      ...source.blockedTitleWords,
      ...owner.blockedTitleWords,
    ]
    const descriptionWords = [
      ...source.blockedDescriptionWords,
      ...owner.blockedDescriptionWords,
    ]

    let listing
    try {
      listing = await listItems(source, deps.fetchText)
    } catch (error) {
      // A source-level failure. Recorded, reported, and still a 200 upstream:
      // the caller asked for a run and this is what the run did.
      const message = messageOf(error)
      summary.errors.push({ url: source.listingUrl, message })
      await deps.sources.recordRunResult(userId, source.id, {
        lastError: message,
      })
      return summary
    }

    summary.errors.push(...listing.errors)
    let items = listing.items
    if (items.length > source.maxItemsPerRun) {
      items = items.slice(0, source.maxItemsPerRun)
      summary.truncated = true
    }
    summary.fetched = items.length + listing.errors.length

    const known = await deps.postings.findExistingUrls(userId, source.id)
    const reseen: string[] = []
    let fetchedOnce = false

    for (const item of items) {
      // Checked before any blocklist: a stored posting is never re-examined,
      // which is why storing a blocked one saves the fetch forever.
      if (known.has(item.detailUrl)) {
        reseen.push(item.detailUrl)
        summary.updated += 1
        continue
      }

      const titleHit = findBlockedWord(item.title, titleWords)
      if (titleHit) {
        // Stored rather than dropped, so the detail page is never fetched on a
        // later run and an over-eager marker stays visible. The description is
        // empty because nothing was fetched to fill it.
        await deps.postings.upsert(userId, {
          sourceId: source.id,
          url: item.detailUrl,
          title: item.title,
          company: null,
          description: '',
          postedAtRaw: null,
          postedAt: null,
          blockedBy: titleHit,
        })
        summary.blocked += 1
        continue
      }

      try {
        // Between fetches, not before the first: politeness to the board, not
        // a warm-up.
        if (fetchedOnce && source.detailDelayMs > 0) {
          await sleep(source.detailDelayMs)
        }
        fetchedOnce = true
        const detail = await fetchDetail(source, item.detailUrl, deps.fetchText)
        const descriptionHit = findBlockedWord(
          detail.description,
          descriptionWords,
        )
        await deps.postings.upsert(userId, {
          sourceId: source.id,
          url: item.detailUrl,
          title: item.title,
          company: detail.company,
          description: detail.description,
          postedAtRaw: detail.postedAtRaw,
          postedAt: parsePostedAt(detail.postedAtRaw),
          blockedBy: descriptionHit,
        })
        if (descriptionHit) summary.blocked += 1
        else summary.created += 1
      } catch (error) {
        // Nothing is stored, so the next run retries this posting. One dead
        // detail page does not make a working source a failed one.
        summary.errors.push({
          url: item.detailUrl,
          message: messageOf(error),
        })
      }
    }

    await deps.postings.touchLastSeen(userId, source.id, reseen)
    await deps.sources.recordRunResult(userId, source.id, { lastError: null })
    return summary
  }

  return {
    async ingestOne(
      userId: string,
      sourceId: string,
    ): Promise<IngestOneResult> {
      // Scoped read: another user's source is indistinguishable from a missing
      // one, and the route turns both into a 404.
      const source = await deps.sources.findById(userId, sourceId)
      if (!source) return { ok: false, reason: 'not-found' }
      // An explicit single-source trigger refuses a disabled source rather than
      // quietly overriding the switch. `ingestAll` skips it silently instead —
      // that is the one place the two triggers disagree.
      if (!source.enabled) return { ok: false, reason: 'disabled' }
      return { ok: true, summary: await runSource(userId, source) }
    },

    async ingestAll(userId: string): Promise<RunSummary[]> {
      // Already ordered by name; `list` excludes soft-deleted rows.
      const all = await deps.sources.list(userId)
      const runs: RunSummary[] = []
      for (const source of all) {
        if (!source.enabled) continue
        try {
          runs.push(await runSource(userId, source))
        } catch (error) {
          // `runSource` handles fetch failures itself, so reaching here means
          // a repository failed. One broken source must not end the batch.
          runs.push({
            sourceId: source.id,
            fetched: 0,
            created: 0,
            updated: 0,
            blocked: 0,
            truncated: false,
            errors: [
              { url: source.listingUrl, message: messageOf(error) },
            ],
          })
        }
      }
      return runs
    },
  }
}

export type IngestionService = ReturnType<typeof createIngestionService>
```

- [ ] **Step 4: Run the test and see it pass**

Run: `npx vitest run test/ingestion.service.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/services/ingestion.service.ts test/ingestion.service.test.ts
git commit -m "feat: add the ingestion pipeline"
```

---

### Task 7: Extract the shared route helpers

**Files:**
- Create: `api/src/routes/http.ts`
- Modify: `api/src/routes/sources.ts`

**Interfaces:**
- Consumes: `resolveCurrentUser`, `USER_ID_HEADER` from `src/auth/current-user.ts`.
- Produces:

```ts
export function fail(reply, statusCode: number, error: string, message: string)
export function badRequest(reply, message: string)
export function notFound(reply, message?: string)
export function conflict(reply, message: string)
export function zodMessage(error: z.ZodError): string
export function makeCaller(users: UsersRepository):
  (request: FastifyRequest, reply: FastifyReply) => Promise<string | null>
```

This task adds no behavior. Its gate is that the existing suite stays green — `sources.routes.test.ts` is the safety net, so do not modify it.

- [ ] **Step 1: Confirm the baseline is green**

Run: `npm test`
Expected: PASS. Note the test count; it must be identical at the end of this task.

- [ ] **Step 2: Create the shared module**

Create `api/src/routes/http.ts`, moving the helpers out of `sources.ts` unchanged:

```ts
import { USER_ID_HEADER, resolveCurrentUser } from '../auth/current-user.js'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { z } from 'zod'
import type { UsersRepository } from '../repositories/users.repository.js'

/**
 * There is no `setErrorHandler` (see CLAUDE.md, Errors), so a route that
 * answers for itself must reproduce Fastify's default body by hand. Two
 * validators run against every body — Ajv from the published JSON Schema, then
 * Zod for the rules JSON Schema cannot express — and if their 400s had
 * different shapes the documented one would be true only half the time.
 *
 * Extracted here because three route files now need the same five helpers.
 */
export function fail(
  reply: FastifyReply,
  statusCode: number,
  error: string,
  message: string,
) {
  return reply.code(statusCode).send({ statusCode, error, message })
}

export function badRequest(reply: FastifyReply, message: string) {
  return fail(reply, 400, 'Bad Request', message)
}

export function notFound(reply: FastifyReply, message = 'No such source') {
  return fail(reply, 404, 'Not Found', message)
}

export function conflict(reply: FastifyReply, message: string) {
  return fail(reply, 409, 'Conflict', message)
}

/** Flattens a ZodError into one line, so the message field stays a string. */
export function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
    .join('; ')
}

/**
 * Resolves the caller or answers the request. The returned function yields null
 * when it has already replied, so every handler starts with the same two lines.
 */
export function makeCaller(users: UsersRepository) {
  return async function caller(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | null> {
    const result = await resolveCurrentUser(
      request.headers[USER_ID_HEADER],
      users,
    )
    if (result.ok) return result.userId
    if (result.status === 400) {
      await badRequest(reply, result.message)
    } else {
      await notFound(reply, result.message)
    }
    return null
  }
}
```

- [ ] **Step 3: Point `sources.ts` at it**

In `api/src/routes/sources.ts`: delete the local `fail`, `badRequest`, `notFound`, `zodMessage` and the inner `caller` function, import the shared ones, and build the caller once inside `sourcesRoutes`:

```ts
import {
  badRequest,
  fail,
  makeCaller,
  notFound,
  zodMessage,
} from './http.js'
```

```ts
export async function sourcesRoutes(
  app: FastifyInstance,
  { service, users }: SourcesRoutesOptions,
): Promise<void> {
  const caller = makeCaller(users)
  // ... handlers unchanged
```

Keep `conflictOr` and the `UNIQUE_VIOLATION` constant in `sources.ts` — the Postgres-error unwrapping is specific to source-name collisions and no other route needs it. Have it call the shared `fail` (or `conflict`).

Remove the now-unused `resolveCurrentUser` / `USER_ID_HEADER` imports if `lint` flags them.

- [ ] **Step 4: Prove nothing changed**

Run: `npm test`
Expected: PASS, with exactly the count from Step 1.

- [ ] **Step 5: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/routes/http.ts src/routes/sources.ts
git commit -m "refactor: extract the shared route helpers three route files need"
```

---

### Task 8: The ingest endpoints

**Files:**
- Create: `api/src/routes/ingest.schema.ts`
- Create: `api/src/routes/ingest.ts`
- Modify: `api/src/app.ts`
- Test: `api/test/ingest.routes.test.ts`

**Interfaces:**
- Consumes: `IngestionService` (Task 6), the helpers in `src/routes/http.ts` (Task 7), `jsonSchema` / `ErrorSchema` / `USER_ID_SECURITY` from `src/openapi.ts`.
- Produces: `ingestRoutes(app, { service, users })`, `RunSummarySchema`, `BulkRunResponseSchema`, and `AppDeps.ingestion` on `buildApp`.

- [ ] **Step 1: Write the failing test**

Create `api/test/ingest.routes.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import type { FastifyInstance } from 'fastify'
import type { UsersRepository } from '../src/repositories/users.repository.js'
import type {
  IngestOneResult,
  IngestionService,
  RunSummary,
} from '../src/services/ingestion.service.js'
import type { SourcesService } from '../src/services/sources.service.js'
import type { PostingsService } from '../src/services/postings.service.js'

const ALICE = '00000000-0000-4000-8000-00000000000a'
const GHOST = '00000000-0000-4000-8000-0000000000ff'
const SOURCE = '00000000-0000-4000-8000-000000000001'

const users: UsersRepository = {
  exists: (id) => Promise.resolve(id === ALICE),
  findBlocklists: () =>
    Promise.resolve({ blockedTitleWords: [], blockedDescriptionWords: [] }),
}

const summary = (overrides: Partial<RunSummary> = {}): RunSummary => ({
  sourceId: SOURCE,
  fetched: 2,
  created: 1,
  updated: 1,
  blocked: 0,
  truncated: false,
  errors: [],
  ...overrides,
})

/** Only the two methods the routes call; the rest of the app is stubbed out. */
function appWith(ingestion: IngestionService): FastifyInstance {
  return buildApp({
    sources: {} as SourcesService,
    postings: {} as PostingsService,
    users,
    ingestion,
  })
}

let app: FastifyInstance

afterAll(async () => {
  await app?.close()
})

describe('POST /sources/:id/ingest', () => {
  it('returns the run summary', async () => {
    const ingestOne = vi.fn(
      (): Promise<IngestOneResult> =>
        Promise.resolve({ ok: true, summary: summary() }),
    )
    app = appWith({ ingestOne, ingestAll: vi.fn() } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual(summary())
    expect(ingestOne).toHaveBeenCalledWith(ALICE, SOURCE)
  })

  it('returns 200 with the failure reported when the listing fetch failed', async () => {
    const failed = summary({
      fetched: 0,
      created: 0,
      updated: 0,
      errors: [{ url: 'https://example.com/jobs/', message: 'HTTP 503' }],
    })
    app = appWith({
      ingestOne: () => Promise.resolve({ ok: true, summary: failed }),
      ingestAll: vi.fn(),
    } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().errors).toHaveLength(1)
  })

  it('404s an unknown or someone else’s source', async () => {
    app = appWith({
      ingestOne: () => Promise.resolve({ ok: false, reason: 'not-found' }),
      ingestAll: vi.fn(),
    } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'No such source',
    })
  })

  it('409s a disabled source', async () => {
    app = appWith({
      ingestOne: () => Promise.resolve({ ok: false, reason: 'disabled' }),
      ingestAll: vi.fn(),
    } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      statusCode: 409,
      error: 'Conflict',
      message: 'Source is disabled',
    })
  })

  it('400s a missing or malformed X-User-Id', async () => {
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() } as unknown as IngestionService)

    const missing = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
    })
    expect(missing.statusCode).toBe(400)

    const malformed = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': 'not-a-uuid' },
    })
    expect(malformed.statusCode).toBe(400)
  })

  it('404s a well-formed id naming no user', async () => {
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': GHOST },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json().message).toBe('No such user')
  })

  it('400s a non-uuid source id', async () => {
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: '/sources/nope/ingest',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(400)
  })

  it('ignores a userId supplied in the body', async () => {
    const ingestOne = vi.fn(
      (): Promise<IngestOneResult> =>
        Promise.resolve({ ok: true, summary: summary() }),
    )
    app = appWith({ ingestOne, ingestAll: vi.fn() } as unknown as IngestionService)

    await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': ALICE },
      payload: { userId: GHOST },
    })

    expect(ingestOne).toHaveBeenCalledWith(ALICE, SOURCE)
  })
})

describe('POST /ingest', () => {
  it('returns one summary per source it ran', async () => {
    const runs = [summary(), summary({ sourceId: '00000000-0000-4000-8000-000000000002' })]
    const ingestAll = vi.fn(() => Promise.resolve(runs))
    app = appWith({ ingestOne: vi.fn(), ingestAll } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ runs })
    expect(ingestAll).toHaveBeenCalledWith(ALICE)
  })

  it('returns an empty list rather than a 404 when nothing is enabled', async () => {
    app = appWith({
      ingestOne: vi.fn(),
      ingestAll: () => Promise.resolve([]),
    } as unknown as IngestionService)

    const response = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ runs: [] })
  })

  it('400s a missing X-User-Id', async () => {
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() } as unknown as IngestionService)
    const response = await app.inject({ method: 'POST', url: '/ingest' })
    expect(response.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/ingest.routes.test.ts`
Expected: FAIL — `AppDeps` has no `ingestion`, and `postings.service.js` does not exist.

Task 9 creates `PostingsService`. To keep this task self-contained, create the file now with only its type, and fill it in in Task 9:

```ts
// src/services/postings.service.ts — Task 9 replaces the body of `search`.
import type { PostingsRepository } from '../repositories/postings.repository.js'

export function createPostingsService(repo: PostingsRepository) {
  return { repo }
}

export type PostingsService = ReturnType<typeof createPostingsService>
```

It takes the repository now, even though nothing reads it yet: Step 5 wires
`createPostingsService(postingsRepo)` into `app.ts`, and a zero-argument stub
would fail `typecheck` there.

- [ ] **Step 3: Write the response schemas**

Create `api/src/routes/ingest.schema.ts`:

```ts
import { z } from 'zod'

/**
 * One unusable listing item, or one detail page that could not be fetched. A
 * run reports these and still succeeds: a board where one posting 503s is a
 * working board.
 */
export const ItemErrorSchema = z.object({
  url: z.string().describe('The listing URL for a bad item, else the detail URL'),
  message: z.string(),
})

export const RunSummarySchema = z.object({
  sourceId: z.uuid(),
  fetched: z
    .number()
    .int()
    .nonnegative()
    .describe(
      'Items accounted for: post-truncation items plus unusable listing entries. ' +
        'created + updated + blocked + errors.length equals this.',
    ),
  created: z.number().int().nonnegative().describe('Newly stored and visible'),
  updated: z
    .number()
    .int()
    .nonnegative()
    .describe('Already stored; lastSeenAt advanced and no detail page fetched'),
  blocked: z
    .number()
    .int()
    .nonnegative()
    .describe('Newly stored with blockedBy set'),
  truncated: z
    .boolean()
    .describe('True when maxItemsPerRun cut the listing short'),
  errors: z.array(ItemErrorSchema),
})

export const BulkRunResponseSchema = z.object({
  runs: z.array(RunSummarySchema),
})
```

- [ ] **Step 4: Write the routes**

Create `api/src/routes/ingest.ts`:

```ts
import { z } from 'zod'
import {
  ErrorSchema,
  USER_ID_SECURITY,
  jsonSchema,
} from '../openapi.js'
import { conflict, makeCaller, notFound } from './http.js'
import { BulkRunResponseSchema, RunSummarySchema } from './ingest.schema.js'
import type { FastifyInstance } from 'fastify'
import type { UsersRepository } from '../repositories/users.repository.js'
import type { IngestionService } from '../services/ingestion.service.js'

export interface IngestRoutesOptions {
  service: IngestionService
  users: UsersRepository
}

const IdParams = z.object({ id: z.uuid() })

const errorResponses = {
  400: ErrorSchema,
  404: ErrorSchema,
}

/**
 * Both routes are thin: resolve the caller, call the one ingestion service, map
 * its result to a status code. The 30-minute schedule will be a third caller of
 * that same service, which is why no logic may accumulate here.
 *
 * Runs are synchronous. A source with the default 100-item cap and 1s delay
 * takes ~100 seconds, and POST /ingest runs sources one at a time, so a caller
 * needs a long timeout and a proxy with a 60s read timeout will cut the
 * connection while the run finishes server-side.
 */
export async function ingestRoutes(
  app: FastifyInstance,
  { service, users }: IngestRoutesOptions,
): Promise<void> {
  const caller = makeCaller(users)

  app.post(
    '/sources/:id/ingest',
    {
      schema: {
        tags: ['ingest'],
        summary: 'Scrape one of your sources now',
        description:
          'Runs synchronously and answers when the run finishes; expect this ' +
          'to take maxItemsPerRun x detailDelayMs. A listing page that cannot ' +
          'be fetched is still a 200: the failure is in errors[] and in the ' +
          "source's lastError. A disabled source is a 409.",
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        response: {
          200: jsonSchema(RunSummarySchema),
          ...errorResponses,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      // Ajv already validated `id` against `params` above; parsing again here
      // would be dead code.
      const { id } = request.params as z.infer<typeof IdParams>
      const result = await service.ingestOne(userId, id)
      if (!result.ok) {
        // A source owned by somebody else is indistinguishable from one that
        // does not exist. A 403 would confirm the id is real.
        return result.reason === 'not-found'
          ? notFound(reply)
          : conflict(reply, 'Source is disabled')
      }
      return result.summary
    },
  )

  app.post(
    '/ingest',
    {
      schema: {
        tags: ['ingest'],
        summary: 'Scrape all of your enabled sources now',
        description:
          'Sources run one at a time in name order, so this can take the sum ' +
          'of all of them. Disabled sources are skipped silently — unlike the ' +
          'single-source route, which refuses them. A source that fails still ' +
          'contributes a summary and the next source runs.',
        security: USER_ID_SECURITY,
        response: {
          200: jsonSchema(BulkRunResponseSchema),
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      return { runs: await service.ingestAll(userId) }
    },
  )
}
```

- [ ] **Step 5: Wire it into the app**

In `api/src/app.ts`: extend `AppDeps`, build the real service, register the routes.

```ts
import { fetchText } from './adapters/fetch-text.js'
import { createPostingsRepository } from './repositories/postings.repository.js'
import { createIngestionService } from './services/ingestion.service.js'
import { ingestRoutes } from './routes/ingest.js'
import type { IngestionService } from './services/ingestion.service.js'
import type { PostingsService } from './services/postings.service.js'
```

```ts
export interface AppDeps {
  sources: SourcesService
  postings: PostingsService
  users: UsersRepository
  ingestion: IngestionService
}

function realDeps(): AppDeps {
  const users = createUsersRepository()
  const sourcesRepo = createSourcesRepository()
  const postingsRepo = createPostingsRepository()
  return {
    sources: createSourcesService(sourcesRepo),
    postings: createPostingsService(postingsRepo),
    users,
    // `fetchText` is injected rather than imported by the service, so the unit
    // suite never opens a socket.
    ingestion: createIngestionService({
      sources: sourcesRepo,
      postings: postingsRepo,
      users,
      fetchText,
    }),
  }
}
```

and after the existing registration:

```ts
  app.register(ingestRoutes, { service: deps.ingestion, users: deps.users })
```

`createPostingsService` takes no argument until Task 9 completes it; pass the repository now and let Task 9 use it.

- [ ] **Step 6: Repair the two existing suites that call `buildApp`**

`AppDeps` gained two required keys, so every existing `buildApp({ ... })` call is
now a type error. Two files call it:

- `test/sources.routes.test.ts`
- `test/app.test.ts`

In each, add the two new keys to every `buildApp` call. These suites do not
exercise either dependency, so a cast is honest here — a real fake would be
dead code:

```ts
import type { IngestionService } from '../src/services/ingestion.service.js'
import type { PostingsService } from '../src/services/postings.service.js'
```

```ts
  const app = buildApp({
    sources: createSourcesService(repo),
    postings: {} as PostingsService,
    users,
    ingestion: {} as IngestionService,
  })
```

Also add `findBlocklists` to the `users` fake in `test/sources.routes.test.ts`,
which the widened `UsersRepository` interface now requires:

```ts
const users: UsersRepository = {
  exists: (id) => Promise.resolve(id === ALICE || id === BOB),
  findBlocklists: () =>
    Promise.resolve({ blockedTitleWords: [], blockedDescriptionWords: [] }),
}
```

Do not change any assertion in those files. Their job this task is to prove the
wiring change broke nothing.

- [ ] **Step 7: Run the test and see it pass**

Run: `npx vitest run test/ingest.routes.test.ts`
Expected: PASS, 11 tests.

Run: `npm test`
Expected: PASS — the existing suites included.

- [ ] **Step 8: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/routes/ingest.ts src/routes/ingest.schema.ts src/services/postings.service.ts src/app.ts test/ingest.routes.test.ts test/sources.routes.test.ts test/app.test.ts
git commit -m "feat: add the ingest endpoints over the shared pipeline"
```

---

### Task 9: `GET /postings`

**Files:**
- Create: `api/src/routes/postings.schema.ts`
- Create: `api/src/routes/postings.ts`
- Modify: `api/src/services/postings.service.ts`
- Modify: `api/src/app.ts`
- Test: `api/test/postings.routes.test.ts`

**Interfaces:**
- Consumes: `PostingsRepository`, `PostingRow`, `PostingSearch` (Task 5), the route helpers (Task 7).
- Produces:

```ts
export const MAX_LIMIT = 200
export const PostingsQueryPublishedSchema  // what Ajv checks and /docs shows
export const PostingsQuerySchema           // the handler's, clamping limit
export function createPostingsService(repo: PostingsRepository): PostingsService
// service: search(userId, query): Promise<{ items: PostingResponse[]; total: number }>
export function postingsRoutes(app, { service, users })
```

- [ ] **Step 1: Write the failing test**

Create `api/test/postings.routes.test.ts`:

```ts
import { afterAll, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.js'
import { createPostingsService } from '../src/services/postings.service.js'
import type { FastifyInstance } from 'fastify'
import type {
  PostingRow,
  PostingSearch,
  PostingsRepository,
} from '../src/repositories/postings.repository.js'
import type { UsersRepository } from '../src/repositories/users.repository.js'
import type { IngestionService } from '../src/services/ingestion.service.js'
import type { SourcesService } from '../src/services/sources.service.js'

const ALICE = '00000000-0000-4000-8000-00000000000a'
const SOURCE = '00000000-0000-4000-8000-000000000001'

const users: UsersRepository = {
  exists: (id) => Promise.resolve(id === ALICE),
  findBlocklists: () =>
    Promise.resolve({ blockedTitleWords: [], blockedDescriptionWords: [] }),
}

const row = (overrides: Partial<PostingRow> = {}): PostingRow => ({
  id: '00000000-0000-4000-8000-0000000000aa',
  sourceId: SOURCE,
  url: 'https://example.com/1',
  title: 'Senior Dev',
  company: 'ACME',
  description: 'A good job.',
  postedAtRaw: '3 days ago',
  postedAt: null,
  blockedBy: null,
  firstSeenAt: new Date('2026-09-01T10:00:00.000Z'),
  lastSeenAt: new Date('2026-09-01T12:00:00.000Z'),
  ...overrides,
})

/** Captures the filters the route computed, which is what these tests assert. */
function fakePostings(items: PostingRow[] = [row()]) {
  const calls: PostingSearch[] = []
  const repo: PostingsRepository = {
    findExistingUrls: () => Promise.resolve(new Set()),
    touchLastSeen: () => Promise.resolve(),
    upsert: () => Promise.resolve(),
    search: (_userId, filters) => {
      calls.push(filters)
      return Promise.resolve({ items, total: 137 })
    },
  }
  return { repo, calls }
}

function appWith(repo: PostingsRepository): FastifyInstance {
  return buildApp({
    sources: {} as SourcesService,
    postings: createPostingsService(repo),
    users,
    ingestion: {} as IngestionService,
  })
}

let app: FastifyInstance

afterAll(async () => {
  await app?.close()
})

describe('GET /postings', () => {
  it('returns items with ISO timestamps and the unpaged total', async () => {
    app = appWith(fakePostings().repo)

    const response = await app.inject({
      method: 'GET',
      url: '/postings',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      total: 137,
      items: [
        {
          id: '00000000-0000-4000-8000-0000000000aa',
          sourceId: SOURCE,
          url: 'https://example.com/1',
          title: 'Senior Dev',
          company: 'ACME',
          description: 'A good job.',
          postedAtRaw: '3 days ago',
          postedAt: null,
          blockedBy: null,
          firstSeenAt: '2026-09-01T10:00:00.000Z',
          lastSeenAt: '2026-09-01T12:00:00.000Z',
        },
      ],
    })
  })

  it('excludes blocked postings by default', async () => {
    const fake = fakePostings()
    app = appWith(fake.repo)

    await app.inject({
      method: 'GET',
      url: '/postings',
      headers: { 'x-user-id': ALICE },
    })

    expect(fake.calls[0]).toEqual({
      sourceId: undefined,
      includeBlocked: false,
      limit: 50,
      offset: 0,
    })
  })

  it('includes them when asked', async () => {
    const fake = fakePostings()
    app = appWith(fake.repo)

    await app.inject({
      method: 'GET',
      url: '/postings?includeBlocked=true',
      headers: { 'x-user-id': ALICE },
    })

    expect(fake.calls[0]?.includeBlocked).toBe(true)
  })

  it('passes a sourceId filter through', async () => {
    const fake = fakePostings()
    app = appWith(fake.repo)

    await app.inject({
      method: 'GET',
      url: `/postings?sourceId=${SOURCE}`,
      headers: { 'x-user-id': ALICE },
    })

    expect(fake.calls[0]?.sourceId).toBe(SOURCE)
  })

  it('clamps an oversized limit instead of rejecting it', async () => {
    const fake = fakePostings()
    app = appWith(fake.repo)

    const response = await app.inject({
      method: 'GET',
      url: '/postings?limit=1000',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(fake.calls[0]?.limit).toBe(200)
  })

  it('rejects a limit below 1 and a negative offset', async () => {
    app = appWith(fakePostings().repo)

    const zero = await app.inject({
      method: 'GET',
      url: '/postings?limit=0',
      headers: { 'x-user-id': ALICE },
    })
    expect(zero.statusCode).toBe(400)

    const negative = await app.inject({
      method: 'GET',
      url: '/postings?offset=-1',
      headers: { 'x-user-id': ALICE },
    })
    expect(negative.statusCode).toBe(400)
  })

  it('400s a non-uuid sourceId', async () => {
    app = appWith(fakePostings().repo)

    const response = await app.inject({
      method: 'GET',
      url: '/postings?sourceId=nope',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(400)
  })

  it('returns an empty page, not a 404, for a sourceId that matches nothing', async () => {
    app = appWith(fakePostings([]).repo)

    const response = await app.inject({
      method: 'GET',
      url: '/postings?sourceId=00000000-0000-4000-8000-0000000000ff',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().items).toEqual([])
  })

  it('400s a missing X-User-Id', async () => {
    app = appWith(fakePostings().repo)
    const response = await app.inject({ method: 'GET', url: '/postings' })
    expect(response.statusCode).toBe(400)
  })
})
```

- [ ] **Step 2: Run the test and see it fail**

Run: `npx vitest run test/postings.routes.test.ts`
Expected: FAIL — `createPostingsService` takes no repository and there is no `/postings` route.

- [ ] **Step 3: Write the schemas**

Create `api/src/routes/postings.schema.ts`:

```ts
import { z } from 'zod'

/** Above this, `limit` is clamped rather than rejected. */
export const MAX_LIMIT = 200

/**
 * Query strings arrive as strings. Fastify's Ajv has `coerceTypes` on, so the
 * published schema below both documents the parameters and turns "50" into 50
 * and "true" into true before a handler runs.
 */
const queryShape = {
  sourceId: z
    .uuid()
    .optional()
    .describe('Only postings from this source of yours'),
  includeBlocked: z
    .boolean()
    .default(false)
    .describe('Include postings a blocklist word matched'),
  limit: z
    .number()
    .int()
    .min(1)
    .default(50)
    .describe(`1-${MAX_LIMIT}; a larger value is clamped to ${MAX_LIMIT}`),
  offset: z.number().int().min(0).default(0),
}

/**
 * What Ajv validates and `/docs` publishes. Deliberately carries no maximum on
 * `limit`: Ajv would reject 1000, and the contract is to clamp it.
 */
export const PostingsQueryPublishedSchema = z.object(queryShape)

/**
 * The handler's schema. Same shape plus the clamp, kept out of the published
 * one because `z.toJSONSchema` cannot represent a transform.
 */
export const PostingsQuerySchema = z
  .object(queryShape)
  .transform((query) => ({
    ...query,
    limit: Math.min(query.limit, MAX_LIMIT),
  }))

export type PostingsQuery = z.infer<typeof PostingsQuerySchema>

export const PostingResponseSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  url: z.string().describe('Absolutized detail URL; the identity of a posting'),
  title: z.string(),
  company: z.string().nullable(),
  description: z.string().describe('Empty for a title-blocked posting, which was never fetched'),
  postedAtRaw: z
    .string()
    .nullable()
    .describe('As scraped, e.g. "3 days ago" — kept so a parse misfire stays visible'),
  postedAt: z
    .string()
    .nullable()
    .describe('Null when postedAtRaw was not a parseable date'),
  blockedBy: z
    .string()
    .nullable()
    .describe('Null means visible; otherwise the blocklist word that matched'),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
})

export const PostingListResponseSchema = z.object({
  items: z.array(PostingResponseSchema),
  total: z
    .number()
    .int()
    .nonnegative()
    .describe('Matching the filters, ignoring limit and offset'),
})

export type PostingResponse = z.infer<typeof PostingResponseSchema>
```

- [ ] **Step 4: Complete the service**

Replace `api/src/services/postings.service.ts`:

```ts
import type {
  PostingRow,
  PostingsRepository,
} from '../repositories/postings.repository.js'
import type {
  PostingResponse,
  PostingsQuery,
} from '../routes/postings.schema.js'

/** Row -> wire shape: `Date` becomes an ISO string, nothing is dropped. */
function toResponse(row: PostingRow): PostingResponse {
  return {
    ...row,
    postedAt: row.postedAt?.toISOString() ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
  }
}

export function createPostingsService(repo: PostingsRepository) {
  return {
    async search(
      userId: string,
      query: PostingsQuery,
    ): Promise<{ items: PostingResponse[]; total: number }> {
      const { items, total } = await repo.search(userId, query)
      return { items: items.map(toResponse), total }
    },
  }
}

export type PostingsService = ReturnType<typeof createPostingsService>
```

- [ ] **Step 5: Write the route**

Create `api/src/routes/postings.ts`:

```ts
import { ErrorSchema, USER_ID_SECURITY, jsonSchema } from '../openapi.js'
import { badRequest, makeCaller, zodMessage } from './http.js'
import {
  PostingListResponseSchema,
  PostingsQueryPublishedSchema,
  PostingsQuerySchema,
} from './postings.schema.js'
import type { FastifyInstance } from 'fastify'
import type { UsersRepository } from '../repositories/users.repository.js'
import type { PostingsService } from '../services/postings.service.js'

export interface PostingsRoutesOptions {
  service: PostingsService
  users: UsersRepository
}

export async function postingsRoutes(
  app: FastifyInstance,
  { service, users }: PostingsRoutesOptions,
): Promise<void> {
  const caller = makeCaller(users)

  app.get(
    '/postings',
    {
      schema: {
        tags: ['postings'],
        summary: 'Search your postings',
        description:
          'Newest first. Scoped to your own sources, so another user’s ' +
          'sourceId returns an empty page rather than a 404 — it is a filter, ' +
          'not a lookup. Blocked postings are excluded unless asked for.',
        security: USER_ID_SECURITY,
        querystring: jsonSchema(PostingsQueryPublishedSchema, 'input'),
        response: {
          200: jsonSchema(PostingListResponseSchema),
          400: ErrorSchema,
          404: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      // Ajv has already coerced and defaulted the query; this second parse
      // applies the clamp, which JSON Schema cannot express.
      const parsed = PostingsQuerySchema.safeParse(request.query)
      if (!parsed.success) return badRequest(reply, zodMessage(parsed.error))
      return service.search(userId, parsed.data)
    },
  )
}
```

- [ ] **Step 6: Register it**

In `api/src/app.ts`, add the import and register after the ingest routes:

```ts
import { postingsRoutes } from './routes/postings.js'
```

```ts
  app.register(postingsRoutes, { service: deps.postings, users: deps.users })
```

- [ ] **Step 7: Run the test and see it pass**

Run: `npx vitest run test/postings.routes.test.ts`
Expected: PASS, 9 tests.

If the two 400 cases fail with a 200, Ajv's `min` is not being applied to the coerced query — check that `jsonSchema(..., 'input')` emitted `minimum: 1` and that the parameter is typed `integer`.

- [ ] **Step 8: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`

```bash
git add src/routes/postings.ts src/routes/postings.schema.ts src/services/postings.service.ts src/app.ts test/postings.routes.test.ts
git commit -m "feat: add GET /postings so a scrape run is verifiable through the API"
```

---

### Task 10: Documentation and the OpenAPI assertions

**Files:**
- Modify: `api/test/app.test.ts`
- Modify: `api/CLAUDE.md`
- Modify: `CLAUDE.md` (repo root)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing code depends on.

- [ ] **Step 1: Write the failing assertions**

Add to `api/test/app.test.ts`, following the shape of the existing swagger test there:

```ts
  it('documents the ingest and postings paths with their security requirement', () => {
    const document = app.swagger() as {
      paths: Record<string, Record<string, { security?: unknown }>>
    }
    for (const path of ['/sources/{id}/ingest', '/ingest']) {
      expect(document.paths[path]?.post?.security).toEqual([{ userId: [] }])
    }
    expect(document.paths['/postings']?.get?.security).toEqual([
      { userId: [] },
    ])
  })
```

Build the app in that test with the same fake deps the file already uses, extended with `postings` and `ingestion` stubs.

- [ ] **Step 2: Run it and see it fail, then pass**

Run: `npx vitest run test/app.test.ts`
Expected: FAIL if the routes are not registered before swagger collects them; PASS once they are. No production change should be needed — this assertion exists to catch a later reordering of `registerDocs`.

- [ ] **Step 3: Update `api/CLAUDE.md`**

Replace the **Status** section:

```markdown
## Status

The sources API and the ingestion pipeline are both built: three tables, CRUD
at `/sources`, a generic HTML adapter, `POST /sources/:id/ingest` and
`POST /ingest`, `GET /postings`, and an OpenAPI document at `/docs`.

**Nothing runs on a schedule.** Scraping happens only when someone calls an
ingest endpoint. The 30-minute `@fastify/schedule` job is the next slice; it
must call `createIngestionService(...)` exactly as the routes do.
```

Add a section after **Layering**:

```markdown
## The adapter is a fourth layer

`routes → services → repositories` still holds, and `src/adapters/` sits beside
it as an outbound driver. Only `ingestion.service.ts` touches it.

- `fetch-text.ts` is the one place this project makes an outbound HTTP request.
  It is **injected**, never imported by a service, so no unit test opens a
  socket.
- `html-source.adapter.ts` knows HTML and selectors. It performs no SQL, reads
  no blocklist, and decides nothing about whether a posting is worth fetching.
- It is **two functions, not one**, and this is load-bearing: the title
  blocklist must run before a detail page is fetched, and an already-stored
  posting must never be re-fetched. Both decisions need the blocklists and the
  database. The service therefore drives the loop and calls `fetchDetail` only
  for survivors — which also makes the delay and the item cap the service's to
  enforce.

## Ingestion caveats worth knowing

- **Runs are synchronous.** Default caps mean ~100 seconds per source, and
  `POST /ingest` is sequential. A proxy with a 60s read timeout will cut the
  connection while the run completes server-side.
- **A stored blocked posting is never re-examined.** Removing a blocklist word
  does not un-block existing rows; there is no un-block path. Delete them.
- **`postedAt` is null unless `postedAtRaw` parsed as a date.** "3 days ago"
  keeps the raw string and nothing else. Relative-date parsing is out of scope.
- **Blocklist words are tokens, split on everything but letters, digits, `+`
  and `#`.** Block `net`, not `.net`; `node`, not `node.js`.
- **Two overlapping runs of one source over-report `created`.** The rows are
  right, the counter is not. Relevant once the scheduler exists.
```

- [ ] **Step 4: Update the root `CLAUDE.md`**

In **Status**, replace "nothing fetches a job board yet" with:

```markdown
`api/` has the sources CRUD API, the ingestion pipeline, and `GET /postings` in
front of Postgres. Scraping runs only on request — there is no schedule yet.
Its commands, layout, and layering rules live in **`api/CLAUDE.md`**.
```

In **Architecture**, after the paragraph about a source being a database row, add:

```markdown
The adapter is two phases — list, then fetch each detail page — because the
title blocklist has to run before a detail fetch and an already-stored posting
must never be re-fetched. Those decisions need the database, so the ingestion
service drives the loop and the adapter stays a pure HTML reader. See
`docs/superpowers/specs/2026-09-01-job-ingestion-design.md`.
```

Leave the **Scope** section's 30-minute-schedule note as it is: still in scope, still not built.

- [ ] **Step 5: Full gate and commit**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

```bash
git add test/app.test.ts CLAUDE.md ../CLAUDE.md
git commit -m "docs: record the ingestion pipeline, the adapter layer and its caveats"
```

- [ ] **Step 6: Verify against a real board, by hand**

The unit suite proves the logic; it cannot prove the SQL. With Postgres up
(`cd .. && docker-compose up -d postgres`, then `npm run db:migrate`) and
`npm run dev` running, add a source through `POST /sources`, then:

```bash
USER=<the seeded user uuid>
curl -s -X POST localhost:3000/ingest -H "x-user-id: $USER" | jq
curl -s "localhost:3000/postings?limit=5" -H "x-user-id: $USER" | jq
```

What this checks that no test does: that `on conflict (source_id, url)` advances
`last_seen_at` instead of inserting a duplicate (run the ingest twice — the
second should report `updated`, not `created`), and that the ownership join in
`search` returns rows at all.
