# Job Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `users`, `sources` and `postings` tables plus a per-user CRUD API for job sources, documented in OpenAPI.

**Architecture:** A source is a database row describing how to scrape one job board, owned by exactly one user. Routes parse and validate, call one service, map to a status; the service holds logic and returns DTOs; the repository owns every query and exposes no method that does not take a `userId`. Nothing fetches any job board in this slice.

**Tech Stack:** Node 22, TypeScript (ESM, `NodeNext`), Fastify 5, Drizzle ORM over `postgres.js`, Zod 4, `@fastify/swagger` + swagger-ui, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-job-sources-design.md`

## Global Constraints

- All work happens in `api/`. Run every command from `api/`.
- **Relative imports end in `.js`, never `.ts`** — required by `NodeNext`.
- `strict` and `noUncheckedIndexedAccess` are on. Indexing an array yields `T | undefined`; handle it, do not assert it away.
- Layering is `routes → services → repositories`, one direction only. No SQL outside `src/repositories/`. A service never sees a `FastifyRequest` and never sets a status code.
- No `setErrorHandler`, no domain error classes. Routes handle their own expected failures inline.
- Wire format is **camelCase**; database columns are **snake_case**. Drizzle maps between them.
- Every repository method takes `userId` as its first parameter. There is no unscoped query.
- A source belonging to another user is a **404**, never a 403.
- After every task: `npm run typecheck && npm run lint && npm test` must all pass before committing.
- New top-level files must be covered by `tsconfig.json` or they go unchecked and unlinted.

## Known-broken baseline

`npm test` **fails on `main` right now**, before any of this work. `vitest.config.ts` sets only `LOG_LEVEL`, so importing `src/config.ts` finds no `DATABASE_URL` and calls `process.exit(1)`. `api/CLAUDE.md` claims otherwise. Task 1 fixes it; do not mistake it for damage you caused.

## Open item

The seeded user's email is `owner@jobseeker.local`, a placeholder. It goes into a migration, which is never edited afterwards. If a real address is wanted, change it in Task 2 **before** running `db:migrate`.

## File structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` | modify — add `DATABASE_URL` to the test env |
| `src/db/schema.ts` | the three Drizzle tables and their indexes |
| `drizzle/0000_*.sql` | generated DDL |
| `drizzle/0001_seed_owner.sql` | custom migration inserting the one user |
| `src/routes/sources.schema.ts` | Zod: create, update, response |
| `src/auth/current-user.ts` | `X-User-Id` → a userId or a failure |
| `src/repositories/users.repository.ts` | `UsersRepository` interface + Drizzle impl |
| `src/repositories/sources.repository.ts` | `SourcesRepository` interface, `SourceRow`, Drizzle impl |
| `src/services/sources.service.ts` | logic, ownership rules, row → DTO |
| `src/routes/sources.ts` | HTTP, status codes, OpenAPI schema declarations |
| `src/openapi.ts` | modify — `io` support, security scheme, `ErrorSchema` |
| `src/app.ts` | modify — dependency wiring, register the routes |

Tests mirror this: `test/sources.schema.test.ts`, `test/current-user.test.ts`, `test/sources.service.test.ts`, `test/sources.routes.test.ts`, and additions to `test/app.test.ts`.

---

### Task 1: Repair the test environment

**Files:**
- Modify: `api/vitest.config.ts`
- Modify: `api/CLAUDE.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a green `npm test`, which every later task depends on.

- [ ] **Step 1: Run the suite and see it fail**

Run: `npm test`
Expected: FAIL — `Error: process.exit unexpectedly called with "1"` from `src/config.ts:14`, with `Invalid environment: ... DATABASE_URL`.

- [ ] **Step 2: Give the test env a database URL**

`vitest.config.ts` — replace the `env` block:

```ts
    env: {
      LOG_LEVEL: 'silent',
      // config.ts exits the process on a missing var, so this must be set
      // even though no test opens a connection — postgres.js connects lazily,
      // so importing the client is free.
      DATABASE_URL: 'postgres://jobseeker:jobseeker@localhost:5432/jobseeker',
    },
```

- [ ] **Step 3: Run the suite and see it pass**

Run: `npm test`
Expected: PASS, 2 tests.

- [ ] **Step 4: Correct the claim in the docs**

In `api/CLAUDE.md`, the paragraph ending "`vitest.config.ts` sidesteps this by setting the vars itself." is now true — leave it. Add after it:

```markdown
The URL there points at the same local Postgres as `.env.example`, but nothing
in the unit suite connects: `postgres.js` opens a socket on first query, and
tests inject fake repositories rather than the real ones.
```

- [ ] **Step 5: Commit**

```bash
git add vitest.config.ts CLAUDE.md
git commit -m "fix: give vitest a DATABASE_URL so config.ts does not exit"
```

---

### Task 2: Database schema and migrations

**Files:**
- Modify: `api/src/db/schema.ts`
- Create: `api/drizzle/0000_*.sql` (generated)
- Create: `api/drizzle/0001_seed_owner.sql` (generated shell, filled by hand)

**Interfaces:**
- Consumes: nothing.
- Produces: `users`, `sources`, `postings` Drizzle tables exported from `src/db/schema.ts`. Later tasks import `sources` and `users` from here. Column-to-property mapping is camelCase in TS, snake_case in SQL.

- [ ] **Step 1: Write the tables**

Replace the whole of `src/db/schema.ts`:

```ts
import { sql } from 'drizzle-orm'
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Drizzle table definitions — the source of truth for the database.
 *
 * Column names are snake_case; the TypeScript properties are camelCase, which
 * is also the wire format. After changing anything here run
 * `npm run db:generate` and commit the SQL.
 */

/** A `text[]` column defaulting to the empty array. */
const wordList = (column: string) =>
  text(column)
    .array()
    .notNull()
    .default(sql`'{}'::text[]`)

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  // Blocklists live here rather than in a settings table: there is no other
  // user-level setting yet, so a second table would be a join earning nothing.
  blockedTitleWords: wordList('blocked_title_words'),
  blockedDescriptionWords: wordList('blocked_description_words'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    listingUrl: text('listing_url').notNull(),
    enabled: boolean('enabled').notNull().default(true),

    // Listing page.
    itemSelector: text('item_selector').notNull(),
    titleSelector: text('title_selector').notNull(),
    titleAttr: text('title_attr'),
    detailUrlSelector: text('detail_url_selector').notNull(),
    detailUrlAttr: text('detail_url_attr').notNull().default('href'),

    // Detail page.
    descriptionSelector: text('description_selector').notNull(),
    descriptionAttr: text('description_attr'),
    companySelector: text('company_selector'),
    companyAttr: text('company_attr'),
    postedAtSelector: text('posted_at_selector'),
    postedAtAttr: text('posted_at_attr'),

    blockedTitleWords: wordList('blocked_title_words'),
    blockedDescriptionWords: wordList('blocked_description_words'),

    requestTimeoutMs: integer('request_timeout_ms').notNull().default(10000),
    detailDelayMs: integer('detail_delay_ms').notNull().default(1000),
    maxItemsPerRun: integer('max_items_per_run').notNull().default(100),

    // Written by the ingestion pipeline, never by the API.
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    lastError: text('last_error'),

    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Partial, on two counts. Scoped to the user because a global constraint
    // would leak the existence of sources the caller cannot see. Excluding
    // soft-deleted rows because otherwise a deleted source holds its name
    // hostage forever.
    uniqueIndex('sources_user_name_uniq')
      .on(table.userId, table.name)
      .where(sql`${table.deletedAt} is null`),
    index('sources_user_live_idx')
      .on(table.userId)
      .where(sql`${table.deletedAt} is null`),
  ],
)

export const postings = pgTable(
  'postings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // No user_id: ownership is source_id's to answer. One fact stored once
    // cannot drift out of agreement with itself.
    sourceId: uuid('source_id')
      .notNull()
      .references(() => sources.id),
    /** Absolutized detail URL. The identity of a posting. */
    url: text('url').notNull(),
    title: text('title').notNull(),
    company: text('company'),
    description: text('description').notNull(),
    /** As scraped, e.g. "3 days ago" — kept so a parse misfire stays visible. */
    postedAtRaw: text('posted_at_raw'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    /** Null means visible; otherwise the blocklist word that matched. */
    blockedBy: text('blocked_by'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique('postings_source_url_uniq').on(table.sourceId, table.url)],
)
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck && npm run lint`
Expected: both pass.

- [ ] **Step 3: Generate the DDL migration**

Run: `npm run db:generate`
Expected: a new `drizzle/0000_*.sql` plus `drizzle/meta/`. Read the SQL and confirm it contains `create table "users"`, `create table "sources"`, `create table "postings"`, and a `create unique index "sources_user_name_uniq" ... where "deleted_at" is null`.

- [ ] **Step 4: Generate an empty custom migration for the seed**

Run: `npx drizzle-kit generate --custom --name=seed_owner`
Expected: an empty `drizzle/0001_seed_owner.sql`, registered in `drizzle/meta/_journal.json`.

This is how a data migration is added without hand-editing a generated DDL file — the tool creates and registers the file, you supply the body.

- [ ] **Step 5: Write the seed**

Put this in `drizzle/0001_seed_owner.sql`:

```sql
-- The single bootstrap user. Its id is fixed so that every environment uses
-- the same value in the X-User-Id header. Migrations are neither re-run nor
-- edited, so this row is permanent; add further users with a plain INSERT.
insert into "users" ("id", "email")
values ('00000000-0000-4000-8000-000000000001', 'owner@jobseeker.local')
on conflict ("email") do nothing;
```

- [ ] **Step 6: Apply the migrations against a real database**

```bash
cd .. && docker-compose up -d postgres && cd api
npm run db:migrate
```

Expected: `migrations applied`.

- [ ] **Step 7: Verify the schema landed**

```bash
docker exec -i $(docker ps -qf name=postgres) \
  psql -U jobseeker -d jobseeker -c '\d sources' -c 'select id, email from users;'
```

Expected: the sources columns as written above, and one user row with id `00000000-0000-4000-8000-000000000001`.

- [ ] **Step 8: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add users, sources and postings tables"
```

---

### Task 3: Zod schemas for the sources API

**Files:**
- Create: `api/src/routes/sources.schema.ts`
- Create: `api/test/sources.schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SourceCreateSchema` — a `z.ZodObject`; `type SourceCreate = z.infer<typeof SourceCreateSchema>` (all fields present after parsing, defaults applied).
  - `SourceUpdateSchema` — partial, rejects an empty object; `type SourceUpdate = z.infer<typeof SourceUpdateSchema>`.
  - `SourceResponseSchema` and `type SourceResponse`.
  - `SourceListResponseSchema` — `{ sources: SourceResponse[] }`.

Normalization note: trimming and lowercasing are **not** Zod transforms. `z.toJSONSchema` throws on transforms, and this schema has to survive that call to reach the OpenAPI document. Task 5's service does the normalizing.

- [ ] **Step 1: Write the failing test**

Create `test/sources.schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  SourceCreateSchema,
  SourceUpdateSchema,
} from '../src/routes/sources.schema.js'

const minimal = {
  name: 'Example Board',
  listingUrl: 'https://example.com/jobs',
  itemSelector: '.job',
  titleSelector: '.job-title',
  detailUrlSelector: 'a.job-link',
  descriptionSelector: '#description',
}

describe('SourceCreateSchema', () => {
  it('applies defaults to everything optional', () => {
    const parsed = SourceCreateSchema.parse(minimal)
    expect(parsed.enabled).toBe(true)
    expect(parsed.detailUrlAttr).toBe('href')
    expect(parsed.titleAttr).toBeNull()
    expect(parsed.blockedTitleWords).toEqual([])
    expect(parsed.blockedDescriptionWords).toEqual([])
    expect(parsed.requestTimeoutMs).toBe(10000)
    expect(parsed.detailDelayMs).toBe(1000)
    expect(parsed.maxItemsPerRun).toBe(100)
  })

  it('rejects a non-http url', () => {
    expect(SourceCreateSchema.safeParse({ ...minimal, listingUrl: 'ftp://x.com' }).success).toBe(false)
  })

  it('rejects an empty required selector', () => {
    expect(SourceCreateSchema.safeParse({ ...minimal, itemSelector: '' }).success).toBe(false)
  })

  it('rejects an out-of-range politeness value', () => {
    expect(SourceCreateSchema.safeParse({ ...minimal, detailDelayMs: 999999 }).success).toBe(false)
  })

  it('rejects unknown keys, so a typo is not silently dropped', () => {
    expect(SourceCreateSchema.safeParse({ ...minimal, userId: 'x' }).success).toBe(false)
  })
})

describe('SourceUpdateSchema', () => {
  it('accepts a single field', () => {
    expect(SourceUpdateSchema.parse({ enabled: false })).toEqual({ enabled: false })
  })

  it('leaves omitted keys absent rather than defaulting them', () => {
    expect(Object.keys(SourceUpdateSchema.parse({ enabled: false }))).toEqual(['enabled'])
  })

  it('accepts an explicit null to clear an optional selector', () => {
    expect(SourceUpdateSchema.parse({ companySelector: null })).toEqual({ companySelector: null })
  })

  it('rejects null on a required field', () => {
    expect(SourceUpdateSchema.safeParse({ name: null }).success).toBe(false)
  })

  it('rejects an empty body', () => {
    expect(SourceUpdateSchema.safeParse({}).success).toBe(false)
  })
})

describe('json schema conversion', () => {
  // The whole Ajv-documents/Zod-validates arrangement rests on this call not
  // throwing. It throws on transforms, which is why there are none.
  it('converts for request bodies without marking defaults required', () => {
    const json = z.toJSONSchema(SourceCreateSchema, { target: 'draft-7', io: 'input' })
    expect(json.required).toEqual([
      'name',
      'listingUrl',
      'itemSelector',
      'titleSelector',
      'detailUrlSelector',
      'descriptionSelector',
    ])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- sources.schema`
Expected: FAIL — cannot resolve `../src/routes/sources.schema.js`.

- [ ] **Step 3: Write the schemas**

Create `src/routes/sources.schema.ts`:

```ts
import { z } from 'zod'

/**
 * Zod is the single source of truth for both validation and the OpenAPI
 * document. Two rules follow from that and must not be broken:
 *
 * 1. **No transforms.** `z.toJSONSchema` throws on them. Trimming and
 *    lowercasing happen in the service instead.
 * 2. **Request bodies convert with `io: 'input'`.** Under the default
 *    `io: 'output'` every defaulted field is emitted as `required`, and Ajv
 *    would then reject bodies that Zod accepts.
 */

const selector = z.string().min(1).max(500)
const attr = z.string().min(1).max(100)
const word = z.string().min(1).max(100)

export const SourceCreateSchema = z
  .object({
    name: z.string().min(1).max(200).describe('Display label. Unique among your live sources.'),
    listingUrl: z
      .url({ protocol: /^https?$/ })
      .max(2000)
      .describe('Page listing the vacancies. Must be http or https — the published schema only says "uri".'),
    enabled: z.boolean().default(true),

    itemSelector: selector.describe('Matches once per vacancy on the listing page.'),
    titleSelector: selector.describe('Relative to an item.'),
    titleAttr: attr.nullable().default(null).describe('Null takes the element text.'),
    detailUrlSelector: selector,
    detailUrlAttr: attr.default('href'),

    descriptionSelector: selector.describe('On the detail page.'),
    descriptionAttr: attr.nullable().default(null),
    companySelector: selector.nullable().default(null),
    companyAttr: attr.nullable().default(null),
    postedAtSelector: selector.nullable().default(null),
    postedAtAttr: attr.nullable().default(null),

    blockedTitleWords: z
      .array(word)
      .max(500)
      .default([])
      .describe('Whole-word, case-insensitive. Stored lowercased and trimmed.'),
    blockedDescriptionWords: z.array(word).max(500).default([]),

    requestTimeoutMs: z.number().int().min(1000).max(60000).default(10000),
    detailDelayMs: z.number().int().min(0).max(10000).default(1000),
    maxItemsPerRun: z.number().int().min(1).max(500).default(100),
  })
  // An unknown key is a typo or a client sending `userId` — both should fail
  // loudly rather than be dropped.
  .strict()

export type SourceCreate = z.infer<typeof SourceCreateSchema>

export const SourceUpdateSchema = SourceCreateSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: 'Provide at least one field to update' },
)

export type SourceUpdate = z.infer<typeof SourceUpdateSchema>

/**
 * The wire shape of a source. `userId` is absent on purpose: every source a
 * caller can see is already theirs, so returning it says nothing. Declaring
 * this as a route's response schema also makes fast-json-stringify strip
 * anything not listed, which is what stops an owner id leaking by accident.
 */
export const SourceResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  listingUrl: z.string(),
  enabled: z.boolean(),

  itemSelector: z.string(),
  titleSelector: z.string(),
  titleAttr: z.string().nullable(),
  detailUrlSelector: z.string(),
  detailUrlAttr: z.string(),

  descriptionSelector: z.string(),
  descriptionAttr: z.string().nullable(),
  companySelector: z.string().nullable(),
  companyAttr: z.string().nullable(),
  postedAtSelector: z.string().nullable(),
  postedAtAttr: z.string().nullable(),

  blockedTitleWords: z.array(z.string()),
  blockedDescriptionWords: z.array(z.string()),

  requestTimeoutMs: z.number().int(),
  detailDelayMs: z.number().int(),
  maxItemsPerRun: z.number().int(),

  lastRunAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type SourceResponse = z.infer<typeof SourceResponseSchema>

export const SourceListResponseSchema = z.object({
  sources: z.array(SourceResponseSchema),
})
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- sources.schema`
Expected: PASS, 11 tests. If the `required` assertion fails, print the array and align the test with reality — the ordering follows declaration order.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/sources.schema.ts test/sources.schema.test.ts
git commit -m "feat: add Zod schemas for the sources API"
```

---

### Task 4: Resolving the caller from `X-User-Id`

**Files:**
- Create: `api/src/auth/current-user.ts`
- Create: `api/src/repositories/users.repository.ts`
- Create: `api/test/current-user.test.ts`

**Interfaces:**
- Consumes: `users` from `src/db/schema.js`, `db` from `src/db/client.js`.
- Produces:
  - `interface UsersRepository { exists(id: string): Promise<boolean> }`
  - `function createUsersRepository(): UsersRepository` — the Drizzle implementation.
  - `type CurrentUser = { ok: true; userId: string } | { ok: false; status: 400 | 404; message: string }`
  - `function resolveCurrentUser(headerValue: string | string[] | undefined, users: UsersRepository): Promise<CurrentUser>`

`resolveCurrentUser` takes the raw header value, not a `FastifyRequest`, so it is testable without an app and so the route stays the only thing that knows about HTTP.

- [ ] **Step 1: Write the failing test**

Create `test/current-user.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { resolveCurrentUser } from '../src/auth/current-user.js'
import type { UsersRepository } from '../src/repositories/users.repository.js'

const KNOWN = '00000000-0000-4000-8000-000000000001'
const UNKNOWN = '11111111-1111-4111-8111-111111111111'

const users: UsersRepository = {
  exists: (id) => Promise.resolve(id === KNOWN),
}

describe('resolveCurrentUser', () => {
  it('resolves a known user', async () => {
    expect(await resolveCurrentUser(KNOWN, users)).toEqual({ ok: true, userId: KNOWN })
  })

  it('400s when the header is absent', async () => {
    expect(await resolveCurrentUser(undefined, users)).toMatchObject({ ok: false, status: 400 })
  })

  it('400s when the header is not a uuid', async () => {
    expect(await resolveCurrentUser('not-a-uuid', users)).toMatchObject({ ok: false, status: 400 })
  })

  it('400s on a repeated header rather than picking one', async () => {
    expect(await resolveCurrentUser([KNOWN, UNKNOWN], users)).toMatchObject({ ok: false, status: 400 })
  })

  it('404s on a well-formed uuid naming no user', async () => {
    expect(await resolveCurrentUser(UNKNOWN, users)).toMatchObject({ ok: false, status: 404 })
  })

  it('does not look up a malformed id', async () => {
    let called = false
    const spy: UsersRepository = {
      exists: () => {
        called = true
        return Promise.resolve(true)
      },
    }
    await resolveCurrentUser('nope', spy)
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- current-user`
Expected: FAIL — cannot resolve `../src/auth/current-user.js`.

- [ ] **Step 3: Write the users repository**

Create `src/repositories/users.repository.ts`:

```ts
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'

/**
 * Narrow on purpose. Nothing in this slice creates, edits or lists users —
 * the one row that exists comes from a migration.
 */
export interface UsersRepository {
  exists(id: string): Promise<boolean>
}

export function createUsersRepository(): UsersRepository {
  return {
    async exists(id) {
      const rows = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      return rows.length > 0
    },
  }
}
```

- [ ] **Step 4: Write the resolver**

Create `src/auth/current-user.ts`:

```ts
import { z } from 'zod'
import type { UsersRepository } from '../repositories/users.repository.js'

/**
 * Stands in for authentication, which does not exist yet. The caller asserts
 * who they are in an `X-User-Id` header and is believed.
 *
 * THIS MUST NOT REACH A DEPLOYMENT — any caller can claim to be any user.
 * When sessions arrive, this function's body is the only thing that changes;
 * routes keep calling it and keep reading the same result shape.
 */
export const USER_ID_HEADER = 'x-user-id'

export type CurrentUser =
  | { ok: true; userId: string }
  | { ok: false; status: 400 | 404; message: string }

const uuid = z.uuid()

export async function resolveCurrentUser(
  headerValue: string | string[] | undefined,
  users: UsersRepository,
): Promise<CurrentUser> {
  if (headerValue === undefined) {
    return { ok: false, status: 400, message: `Missing ${USER_ID_HEADER} header` }
  }
  // A repeated header is ambiguous; guessing which one is meant would be worse
  // than refusing.
  if (Array.isArray(headerValue)) {
    return { ok: false, status: 400, message: `Repeated ${USER_ID_HEADER} header` }
  }
  if (!uuid.safeParse(headerValue).success) {
    return { ok: false, status: 400, message: `${USER_ID_HEADER} must be a uuid` }
  }
  // Checked rather than trusted: without this a typo'd id would quietly return
  // an empty list instead of failing.
  if (!(await users.exists(headerValue))) {
    return { ok: false, status: 404, message: 'No such user' }
  }
  return { ok: true, userId: headerValue }
}
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- current-user`
Expected: PASS, 6 tests.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/auth/current-user.ts src/repositories/users.repository.ts test/current-user.test.ts
git commit -m "feat: resolve the caller from an X-User-Id header"
```

---

### Task 5: The sources service

**Files:**
- Create: `api/src/repositories/sources.repository.ts` (interface and row type only — the Drizzle implementation is Task 6)
- Create: `api/src/services/sources.service.ts`
- Create: `api/test/sources.service.test.ts`

**Interfaces:**
- Consumes: `SourceCreate`, `SourceUpdate`, `SourceResponse` from `src/routes/sources.schema.js`.
- Produces:
  - `type SourceRow` — every `sources` column, camelCase, with `Date` for timestamps.
  - `type SourceInsert = SourceCreate & { userId: string }`
  - `interface SourcesRepository` with `list`, `findById`, `create`, `update`, `softDelete` — **every method takes `userId` first**.
  - `function createSourcesService(repo: SourcesRepository)` returning `{ list, get, create, update, remove }`.
  - `type SourcesService = ReturnType<typeof createSourcesService>`

- [ ] **Step 1: Write the repository interface and row type**

Create `src/repositories/sources.repository.ts`:

```ts
import type { SourceCreate, SourceUpdate } from '../routes/sources.schema.js'

/** A `sources` row as Drizzle returns it: camelCase, `Date` for timestamps. */
export interface SourceRow {
  id: string
  userId: string
  name: string
  listingUrl: string
  enabled: boolean

  itemSelector: string
  titleSelector: string
  titleAttr: string | null
  detailUrlSelector: string
  detailUrlAttr: string

  descriptionSelector: string
  descriptionAttr: string | null
  companySelector: string | null
  companyAttr: string | null
  postedAtSelector: string | null
  postedAtAttr: string | null

  blockedTitleWords: string[]
  blockedDescriptionWords: string[]

  requestTimeoutMs: number
  detailDelayMs: number
  maxItemsPerRun: number

  lastRunAt: Date | null
  lastSuccessAt: Date | null
  lastError: string | null

  deletedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type SourceInsert = SourceCreate & { userId: string }

/**
 * Every method takes `userId` first, and there is deliberately no method that
 * omits it. This is the isolation guarantee made structural: there is no
 * unscoped query for a later change to forget to scope.
 *
 * Soft-deleted rows are invisible to all of these.
 */
export interface SourcesRepository {
  list(userId: string): Promise<SourceRow[]>
  findById(userId: string, id: string): Promise<SourceRow | null>
  create(input: SourceInsert): Promise<SourceRow>
  update(userId: string, id: string, patch: SourceUpdate): Promise<SourceRow | null>
  /** True when a live row was marked deleted; false when there was none. */
  softDelete(userId: string, id: string): Promise<boolean>
}
```

- [ ] **Step 2: Write the failing test**

Create `test/sources.service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import type {
  SourceInsert,
  SourceRow,
  SourcesRepository,
} from '../src/repositories/sources.repository.js'
import type { SourceUpdate } from '../src/routes/sources.schema.js'
import { createSourcesService } from '../src/services/sources.service.js'
import { SourceCreateSchema } from '../src/routes/sources.schema.js'

const ALICE = '00000000-0000-4000-8000-00000000000a'
const BOB = '00000000-0000-4000-8000-00000000000b'

const validInput = SourceCreateSchema.parse({
  name: 'Example Board',
  listingUrl: 'https://example.com/jobs',
  itemSelector: '.job',
  titleSelector: '.job-title',
  detailUrlSelector: 'a.job-link',
  descriptionSelector: '#description',
})

function rowFrom(insert: SourceInsert, id: string): SourceRow {
  const now = new Date('2026-09-01T10:00:00.000Z')
  return {
    ...insert,
    id,
    lastRunAt: null,
    lastSuccessAt: null,
    lastError: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

/** An in-memory stand-in that enforces the same ownership rule as the real one. */
function fakeRepo(seed: SourceRow[] = []): SourcesRepository & { rows: SourceRow[] } {
  const rows = [...seed]
  let next = seed.length
  return {
    rows,
    list: (userId) => Promise.resolve(rows.filter((r) => r.userId === userId && !r.deletedAt)),
    findById: (userId, id) =>
      Promise.resolve(rows.find((r) => r.id === id && r.userId === userId && !r.deletedAt) ?? null),
    create: (input) => {
      const row = rowFrom(input, `id-${String(++next)}`)
      rows.push(row)
      return Promise.resolve(row)
    },
    update: (userId, id, patch: SourceUpdate) => {
      const row = rows.find((r) => r.id === id && r.userId === userId && !r.deletedAt)
      if (!row) return Promise.resolve(null)
      Object.assign(row, patch)
      return Promise.resolve(row)
    },
    softDelete: (userId, id) => {
      const row = rows.find((r) => r.id === id && r.userId === userId && !r.deletedAt)
      if (!row) return Promise.resolve(false)
      row.deletedAt = new Date()
      return Promise.resolve(true)
    },
  }
}

describe('createSourcesService', () => {
  let repo: ReturnType<typeof fakeRepo>
  let service: ReturnType<typeof createSourcesService>

  beforeEach(() => {
    repo = fakeRepo()
    service = createSourcesService(repo)
  })

  it('owns a created source by the given user, ignoring anything in the input', async () => {
    const created = await service.create(ALICE, validInput)
    expect(repo.rows[0]?.userId).toBe(ALICE)
    expect(created).not.toHaveProperty('userId')
    expect(created).not.toHaveProperty('deletedAt')
  })

  it('serializes timestamps as ISO strings', async () => {
    const created = await service.create(ALICE, validInput)
    expect(created.createdAt).toBe('2026-09-01T10:00:00.000Z')
    expect(created.lastRunAt).toBeNull()
  })

  it('lowercases and trims blocklist words', async () => {
    const created = await service.create(ALICE, {
      ...validInput,
      blockedTitleWords: ['  PHP ', 'Senior'],
    })
    expect(created.blockedTitleWords).toEqual(['php', 'senior'])
  })

  it('drops words that are empty once trimmed', async () => {
    const created = await service.create(ALICE, {
      ...validInput,
      blockedDescriptionWords: ['  ', 'ok'],
    })
    expect(created.blockedDescriptionWords).toEqual(['ok'])
  })

  it('normalizes words on update too', async () => {
    const created = await service.create(ALICE, validInput)
    const updated = await service.update(ALICE, created.id, { blockedTitleWords: [' Go '] })
    expect(updated?.blockedTitleWords).toEqual(['go'])
  })

  it('lists only the caller-owned sources', async () => {
    await service.create(ALICE, validInput)
    await service.create(BOB, { ...validInput, name: 'Bob Board' })
    expect(await service.list(ALICE)).toHaveLength(1)
  })

  it('returns null reading another user-owned source', async () => {
    const created = await service.create(ALICE, validInput)
    expect(await service.get(BOB, created.id)).toBeNull()
  })

  it('returns null updating another user-owned source', async () => {
    const created = await service.create(ALICE, validInput)
    expect(await service.update(BOB, created.id, { enabled: false })).toBeNull()
    expect(repo.rows[0]?.enabled).toBe(true)
  })

  it('returns false deleting another user-owned source', async () => {
    const created = await service.create(ALICE, validInput)
    expect(await service.remove(BOB, created.id)).toBe(false)
    expect(repo.rows[0]?.deletedAt).toBeNull()
  })

  it('hides a soft-deleted source from its own owner', async () => {
    const created = await service.create(ALICE, validInput)
    expect(await service.remove(ALICE, created.id)).toBe(true)
    expect(await service.get(ALICE, created.id)).toBeNull()
    expect(await service.list(ALICE)).toEqual([])
  })

  it('passes only the keys present in a patch', async () => {
    const created = await service.create(ALICE, validInput)
    const updated = await service.update(ALICE, created.id, { companySelector: null })
    expect(updated?.companySelector).toBeNull()
    expect(updated?.name).toBe('Example Board')
  })
})
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- sources.service`
Expected: FAIL — cannot resolve `../src/services/sources.service.js`.

- [ ] **Step 4: Write the service**

Create `src/services/sources.service.ts`:

```ts
import type {
  SourceRow,
  SourcesRepository,
} from '../repositories/sources.repository.js'
import type {
  SourceCreate,
  SourceResponse,
  SourceUpdate,
} from '../routes/sources.schema.js'

/**
 * Blocklist matching is case-insensitive, so words are stored lowercased and
 * trimmed rather than normalized on every comparison at scrape time. This lives
 * here and not in the Zod schema because `z.toJSONSchema` throws on transforms
 * and that schema has to reach the OpenAPI document.
 */
function normalizeWords(words: string[]): string[] {
  return words.map((word) => word.trim().toLowerCase()).filter((word) => word.length > 0)
}

/**
 * Row -> wire shape. Drops `userId` and `deletedAt`, which are internal, and
 * turns `Date` into an ISO string so the response matches
 * `SourceResponseSchema`.
 */
function toResponse(row: SourceRow): SourceResponse {
  const { userId: _userId, deletedAt: _deletedAt, ...rest } = row
  return {
    ...rest,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function createSourcesService(repo: SourcesRepository) {
  return {
    async list(userId: string): Promise<SourceResponse[]> {
      return (await repo.list(userId)).map(toResponse)
    },

    async get(userId: string, id: string): Promise<SourceResponse | null> {
      const row = await repo.findById(userId, id)
      return row ? toResponse(row) : null
    },

    async create(userId: string, input: SourceCreate): Promise<SourceResponse> {
      // userId comes from the header and nowhere else, so a caller cannot
      // create a source owned by somebody else.
      const row = await repo.create({
        ...input,
        userId,
        blockedTitleWords: normalizeWords(input.blockedTitleWords),
        blockedDescriptionWords: normalizeWords(input.blockedDescriptionWords),
      })
      return toResponse(row)
    },

    async update(
      userId: string,
      id: string,
      patch: SourceUpdate,
    ): Promise<SourceResponse | null> {
      // Only the keys actually present are touched: an absent key leaves the
      // column alone, an explicit null clears it.
      const normalized: SourceUpdate = { ...patch }
      if (patch.blockedTitleWords) {
        normalized.blockedTitleWords = normalizeWords(patch.blockedTitleWords)
      }
      if (patch.blockedDescriptionWords) {
        normalized.blockedDescriptionWords = normalizeWords(patch.blockedDescriptionWords)
      }
      const row = await repo.update(userId, id, normalized)
      return row ? toResponse(row) : null
    },

    async remove(userId: string, id: string): Promise<boolean> {
      return repo.softDelete(userId, id)
    },
  }
}

export type SourcesService = ReturnType<typeof createSourcesService>
```

- [ ] **Step 5: Run the tests**

Run: `npm test -- sources.service`
Expected: PASS, 11 tests.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/repositories/sources.repository.ts src/services/sources.service.ts test/sources.service.test.ts
git commit -m "feat: add the sources service with per-user isolation"
```

---

### Task 6: The Drizzle sources repository

**Files:**
- Modify: `api/src/repositories/sources.repository.ts`

**Interfaces:**
- Consumes: `SourcesRepository`, `SourceRow`, `SourceInsert` from this same file; `sources` from `src/db/schema.js`; `db` from `src/db/client.js`.
- Produces: `function createSourcesRepository(): SourcesRepository`.

**No unit tests.** Every method is a query; a fake database would only assert that Drizzle was called the way this file calls it. It is covered by `npm run typecheck` and by the manual smoke test in Task 9. Step 4 below is the real verification.

- [ ] **Step 1: Add the implementation**

Append to `src/repositories/sources.repository.ts`, and add the imports at the top:

```ts
import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sources } from '../db/schema.js'
```

```ts
/** Every query carries these two: the caller's id, and "not soft-deleted". */
const live = (userId: string) => and(eq(sources.userId, userId), isNull(sources.deletedAt))

export function createSourcesRepository(): SourcesRepository {
  return {
    async list(userId) {
      return db.select().from(sources).where(live(userId)).orderBy(sources.name)
    },

    async findById(userId, id) {
      const rows = await db
        .select()
        .from(sources)
        .where(and(live(userId), eq(sources.id, id)))
        .limit(1)
      return rows[0] ?? null
    },

    async create(input) {
      const rows = await db.insert(sources).values(input).returning()
      const row = rows[0]
      // `returning()` on a single-row insert always yields one row; a throw
      // here would mean Drizzle broke its contract, not a user error.
      if (!row) throw new Error('insert returned no row')
      return row
    },

    async update(userId, id, patch) {
      const rows = await db
        .update(sources)
        // `updatedAt` is set here rather than by a trigger: the API is the only
        // writer of these columns, and a trigger would also fire for the
        // pipeline's health-column writes.
        .set({ ...patch, updatedAt: new Date() })
        .where(and(live(userId), eq(sources.id, id)))
        .returning()
      return rows[0] ?? null
    },

    async softDelete(userId, id) {
      const rows = await db
        .update(sources)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(and(live(userId), eq(sources.id, id)))
        .returning({ id: sources.id })
      return rows.length > 0
    },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If `db.select().from(sources)` does not satisfy `SourceRow[]`, the row type in Step 1 of Task 5 has drifted from the table in Task 2 — fix the type, not the query.

- [ ] **Step 3: Lint and full suite**

Run: `npm run lint && npm test`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add src/repositories/sources.repository.ts
git commit -m "feat: implement the sources repository over Drizzle"
```

---

### Task 7: OpenAPI support for a documented, secured API

**Files:**
- Modify: `api/src/openapi.ts`
- Modify: `api/test/app.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `jsonSchema(schema, io?)` — `io` defaults to `'output'`, so the existing `health.ts` calls are unaffected.
  - `bodySchema(schema)` — shorthand for `jsonSchema(schema, 'input')`.
  - `ErrorSchema` — a plain JSON Schema object for Fastify's default error body.
  - `USER_ID_SECURITY` — the security requirement array routes spread into their schema.

- [ ] **Step 1: Write the failing test**

Add to `test/app.test.ts`:

```ts
describe('openapi security', () => {
  it('declares X-User-Id as an apiKey scheme', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' })
    expect(response.json<unknown>()).toMatchObject({
      components: {
        securitySchemes: {
          userId: { type: 'apiKey', in: 'header', name: 'X-User-Id' },
        },
      },
    })
  })

  it('no longer describes itself as single user', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' })
    const doc = response.json<{ info: { description: string } }>()
    expect(doc.info.description).not.toContain('Single user')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- app`
Expected: FAIL on both — no `securitySchemes`, and the description still says "Single user, self-hosted".

- [ ] **Step 3: Update openapi.ts**

Replace `jsonSchema` and `registerDocs` in `src/openapi.ts`, keeping the existing file comment:

```ts
/**
 * Zod schema -> the JSON Schema that Fastify already speaks.
 *
 * `io` matters and defaults to the safe choice for responses. Under
 * `'output'` — Zod's default — every field with a `.default()` is emitted as
 * `required`, because after parsing it always has a value. For a *request
 * body* that is wrong: Ajv would reject a body omitting `enabled`, which Zod
 * would happily default. Request bodies must therefore convert with `'input'`,
 * which is what `bodySchema` below is for.
 */
export function jsonSchema(
  schema: ZodType,
  io: 'input' | 'output' = 'output',
): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io })
}

/** Request bodies. See the `io` note on `jsonSchema`. */
export function bodySchema(schema: ZodType): Record<string, unknown> {
  return jsonSchema(schema, 'input')
}

/**
 * Fastify's default error body. There is no `setErrorHandler` (see CLAUDE.md,
 * Errors), so this is the shape every failure actually has — including the
 * ones routes produce themselves, which must match it deliberately.
 */
export const ErrorSchema = jsonSchema(
  z.object({
    statusCode: z.number().int(),
    error: z.string(),
    message: z.string(),
  }),
)

/**
 * Spread into a route's schema to mark it as requiring the caller's identity.
 * `userId` is the scheme registered below; when real authentication replaces
 * the header, this constant and the scheme are what change.
 */
export const USER_ID_SECURITY = [{ userId: [] }]

export function registerDocs(app: FastifyInstance): void {
  app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'JobSeeker API',
        description:
          'Aggregated job postings. Multi-user: every request identifies its ' +
          'caller with an X-User-Id header, and a caller only ever sees their ' +
          'own data.',
        version: '0.1.0',
      },
      components: {
        securitySchemes: {
          // A stand-in for authentication. An apiKey scheme rather than a
          // plain header parameter so swagger-ui offers an Authorize box you
          // fill once, and so a real scheme can replace it in place.
          userId: {
            type: 'apiKey',
            in: 'header',
            name: 'X-User-Id',
            description: 'A user uuid. Temporary — this is not authentication.',
          },
        },
      },
    },
  })

  app.register(swaggerUi, { routePrefix: '/docs' })
}
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- app`
Expected: PASS, 4 tests. The pre-existing `/health` document test must still pass — `health.ts` calls `jsonSchema` with one argument and keeps `'output'`.

- [ ] **Step 5: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/openapi.ts test/app.test.ts
git commit -m "feat: document X-User-Id as a security scheme, add input-mode schemas"
```

---

### Task 8: The sources routes

**Files:**
- Create: `api/src/routes/sources.ts`
- Modify: `api/src/app.ts`
- Create: `api/test/sources.routes.test.ts`

**Interfaces:**
- Consumes: `resolveCurrentUser`, `USER_ID_HEADER`, `UsersRepository`, `SourcesService`, the Zod schemas, `bodySchema`/`jsonSchema`/`ErrorSchema`/`USER_ID_SECURITY`.
- Produces:
  - `interface SourcesRoutesOptions { service: SourcesService; users: UsersRepository }`
  - `async function sourcesRoutes(app, options: SourcesRoutesOptions): Promise<void>`
  - `interface AppDeps { sources: SourcesService; users: UsersRepository }`
  - `buildApp(deps?: AppDeps)` — defaults to the real repositories, so tests inject fakes and `server.ts` needs no change.

- [ ] **Step 1: Write the failing test**

Create `test/sources.routes.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { UsersRepository } from '../src/repositories/users.repository.js'
import type {
  SourceInsert,
  SourceRow,
  SourcesRepository,
} from '../src/repositories/sources.repository.js'
import { createSourcesService } from '../src/services/sources.service.js'
import type { FastifyInstance } from 'fastify'

const ALICE = '00000000-0000-4000-8000-00000000000a'
const BOB = '00000000-0000-4000-8000-00000000000b'
const GHOST = '00000000-0000-4000-8000-0000000000ff'

const body = {
  name: 'Example Board',
  listingUrl: 'https://example.com/jobs',
  itemSelector: '.job',
  titleSelector: '.job-title',
  detailUrlSelector: 'a.job-link',
  descriptionSelector: '#description',
}

const users: UsersRepository = {
  exists: (id) => Promise.resolve(id === ALICE || id === BOB),
}

/** Mirrors the fake in sources.service.test.ts; kept local so each suite reads alone. */
function fakeRepo(): SourcesRepository {
  const rows: SourceRow[] = []
  let next = 0
  const find = (userId: string, id: string) =>
    rows.find((r) => r.id === id && r.userId === userId && !r.deletedAt)
  return {
    list: (userId) => Promise.resolve(rows.filter((r) => r.userId === userId && !r.deletedAt)),
    findById: (userId, id) => Promise.resolve(find(userId, id) ?? null),
    create: (input: SourceInsert) => {
      const now = new Date('2026-09-01T10:00:00.000Z')
      const row: SourceRow = {
        ...input,
        id: `00000000-0000-4000-8000-00000000000${String(++next)}`,
        lastRunAt: null,
        lastSuccessAt: null,
        lastError: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      }
      rows.push(row)
      return Promise.resolve(row)
    },
    update: (userId, id, patch) => {
      const row = find(userId, id)
      if (!row) return Promise.resolve(null)
      Object.assign(row, patch)
      return Promise.resolve(row)
    },
    softDelete: (userId, id) => {
      const row = find(userId, id)
      if (!row) return Promise.resolve(false)
      row.deletedAt = new Date()
      return Promise.resolve(true)
    },
  }
}

// Initialized at declaration, not in beforeEach: `noUncheckedIndexedAccess`
// and strict mode reject a `let app: FastifyInstance` that beforeEach reads
// before assigning.
let app: FastifyInstance = buildApp({ sources: createSourcesService(fakeRepo()), users })

beforeEach(async () => {
  await app.close()
  app = buildApp({ sources: createSourcesService(fakeRepo()), users })
})

afterAll(async () => {
  await app.close()
})

const as = (userId: string) => ({ 'x-user-id': userId })

async function createFor(userId: string, overrides: Record<string, unknown> = {}) {
  const response = await app.inject({
    method: 'POST',
    url: '/sources',
    headers: as(userId),
    payload: { ...body, ...overrides },
  })
  return response.json<{ id: string }>()
}

describe('X-User-Id handling', () => {
  it('400s without the header', async () => {
    const response = await app.inject({ method: 'GET', url: '/sources' })
    expect(response.statusCode).toBe(400)
    expect(Object.keys(response.json<object>()).sort()).toEqual(['error', 'message', 'statusCode'])
  })

  it('400s on a non-uuid header', async () => {
    const response = await app.inject({ method: 'GET', url: '/sources', headers: as('nope') })
    expect(response.statusCode).toBe(400)
  })

  it('404s on a uuid naming no user', async () => {
    const response = await app.inject({ method: 'GET', url: '/sources', headers: as(GHOST) })
    expect(response.statusCode).toBe(404)
  })
})

describe('POST /sources', () => {
  it('creates and returns 201 without userId in the body', async () => {
    const response = await app.inject({ method: 'POST', url: '/sources', headers: as(ALICE), payload: body })
    expect(response.statusCode).toBe(201)
    const created = response.json<Record<string, unknown>>()
    expect(created).not.toHaveProperty('userId')
    expect(created.enabled).toBe(true)
    expect(created.detailUrlAttr).toBe('href')
  })

  it('400s on a bad url, in the same body shape as a missing header', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: as(ALICE),
      payload: { ...body, listingUrl: 'ftp://example.com' },
    })
    expect(response.statusCode).toBe(400)
    expect(Object.keys(response.json<object>()).sort()).toEqual(['error', 'message', 'statusCode'])
  })

  it('400s on a missing required selector', async () => {
    const { itemSelector: _dropped, ...withoutSelector } = body
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: as(ALICE),
      payload: withoutSelector,
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('GET /sources', () => {
  it('returns only the caller-owned sources', async () => {
    await createFor(ALICE)
    await createFor(BOB, { name: 'Bob Board' })
    const response = await app.inject({ method: 'GET', url: '/sources', headers: as(ALICE) })
    expect(response.statusCode).toBe(200)
    expect(response.json<{ sources: unknown[] }>().sources).toHaveLength(1)
  })

  it('includes disabled sources so they can be re-enabled', async () => {
    const created = await createFor(ALICE)
    await app.inject({ method: 'PATCH', url: `/sources/${created.id}`, headers: as(ALICE), payload: { enabled: false } })
    const response = await app.inject({ method: 'GET', url: '/sources', headers: as(ALICE) })
    expect(response.json<{ sources: unknown[] }>().sources).toHaveLength(1)
  })
})

describe('ownership', () => {
  it('404s reading another user-owned source', async () => {
    const created = await createFor(ALICE)
    const response = await app.inject({ method: 'GET', url: `/sources/${created.id}`, headers: as(BOB) })
    expect(response.statusCode).toBe(404)
  })

  it('404s patching another user-owned source', async () => {
    const created = await createFor(ALICE)
    const response = await app.inject({
      method: 'PATCH',
      url: `/sources/${created.id}`,
      headers: as(BOB),
      payload: { enabled: false },
    })
    expect(response.statusCode).toBe(404)
  })

  it('404s deleting another user-owned source', async () => {
    const created = await createFor(ALICE)
    const response = await app.inject({ method: 'DELETE', url: `/sources/${created.id}`, headers: as(BOB) })
    expect(response.statusCode).toBe(404)
  })
})

describe('PATCH and DELETE', () => {
  it('patches one field and leaves the rest', async () => {
    const created = await createFor(ALICE)
    const response = await app.inject({
      method: 'PATCH',
      url: `/sources/${created.id}`,
      headers: as(ALICE),
      payload: { companySelector: '.company' },
    })
    expect(response.statusCode).toBe(200)
    const patched = response.json<{ companySelector: string; name: string }>()
    expect(patched.companySelector).toBe('.company')
    expect(patched.name).toBe('Example Board')
  })

  it('400s on an empty patch body', async () => {
    const created = await createFor(ALICE)
    const response = await app.inject({
      method: 'PATCH',
      url: `/sources/${created.id}`,
      headers: as(ALICE),
      payload: {},
    })
    expect(response.statusCode).toBe(400)
  })

  it('deletes with 204 and then 404s', async () => {
    const created = await createFor(ALICE)
    expect((await app.inject({ method: 'DELETE', url: `/sources/${created.id}`, headers: as(ALICE) })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: `/sources/${created.id}`, headers: as(ALICE) })).statusCode).toBe(404)
  })
})

describe('openapi document', () => {
  it('documents every sources path with its security requirement', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json<{
      paths: Record<string, Record<string, { security?: unknown }>>
    }>()
    expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/sources', '/sources/{id}']))
    expect(doc.paths['/sources']?.post?.security).toEqual([{ userId: [] }])
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- sources.routes`
Expected: FAIL — `buildApp` does not accept an argument.

- [ ] **Step 3: Write the routes**

Create `src/routes/sources.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'
import { USER_ID_HEADER, resolveCurrentUser } from '../auth/current-user.js'
import {
  ErrorSchema,
  USER_ID_SECURITY,
  bodySchema,
  jsonSchema,
} from '../openapi.js'
import type { UsersRepository } from '../repositories/users.repository.js'
import type { SourcesService } from '../services/sources.service.js'
import {
  SourceCreateSchema,
  SourceListResponseSchema,
  SourceResponseSchema,
  SourceUpdateSchema,
} from './sources.schema.js'

export interface SourcesRoutesOptions {
  service: SourcesService
  users: UsersRepository
}

const IdParams = z.object({ id: z.uuid() })

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = '23505'

/**
 * There is no `setErrorHandler` (see CLAUDE.md, Errors), so a route that
 * answers for itself must reproduce Fastify's default body by hand. Two
 * validators run against every body — Ajv from the published JSON Schema, then
 * Zod for the rules JSON Schema cannot express — and if their 400s had
 * different shapes the documented one would be true only half the time.
 */
function fail(reply: FastifyReply, statusCode: number, error: string, message: string) {
  return reply.code(statusCode).send({ statusCode, error, message })
}

function badRequest(reply: FastifyReply, message: string) {
  return fail(reply, 400, 'Bad Request', message)
}

function notFound(reply: FastifyReply, message = 'No such source') {
  return fail(reply, 404, 'Not Found', message)
}

/** Flattens a ZodError into one line, so the message field stays a string. */
function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(body)'}: ${issue.message}`)
    .join('; ')
}

const errorResponses = {
  400: ErrorSchema,
  404: ErrorSchema,
}

export async function sourcesRoutes(
  app: FastifyInstance,
  { service, users }: SourcesRoutesOptions,
): Promise<void> {
  /**
   * Resolves the caller or answers the request. Returns null when it has
   * already replied, so every handler starts with the same three lines.
   */
  async function caller(request: FastifyRequest, reply: FastifyReply): Promise<string | null> {
    const result = await resolveCurrentUser(request.headers[USER_ID_HEADER], users)
    if (result.ok) return result.userId
    if (result.status === 400) {
      await badRequest(reply, result.message)
    } else {
      await notFound(reply, result.message)
    }
    return null
  }

  /** Route params are uuids; anything else is a 400, not a lookup miss. */
  function params(request: FastifyRequest, reply: FastifyReply): string | null {
    const parsed = IdParams.safeParse(request.params)
    if (!parsed.success) {
      void badRequest(reply, 'id must be a uuid')
      return null
    }
    return parsed.data.id
  }

  app.get(
    '/sources',
    {
      schema: {
        tags: ['sources'],
        summary: 'List your sources',
        description: 'Excludes deleted sources; includes disabled ones.',
        security: USER_ID_SECURITY,
        response: { 200: jsonSchema(SourceListResponseSchema), ...errorResponses },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      return { sources: await service.list(userId) }
    },
  )

  app.get(
    '/sources/:id',
    {
      schema: {
        tags: ['sources'],
        summary: 'Read one of your sources',
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        response: { 200: jsonSchema(SourceResponseSchema), ...errorResponses },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      const id = params(request, reply)
      if (!id) return
      const source = await service.get(userId, id)
      // A source owned by somebody else is indistinguishable from one that
      // does not exist. A 403 would confirm the id is real.
      if (!source) return notFound(reply)
      return source
    },
  )

  app.post(
    '/sources',
    {
      schema: {
        tags: ['sources'],
        summary: 'Add a source',
        description:
          'The owner comes from X-User-Id and nowhere else. The published body ' +
          'schema is looser than the real rules — see each field description.',
        security: USER_ID_SECURITY,
        body: bodySchema(SourceCreateSchema),
        response: {
          201: jsonSchema(SourceResponseSchema),
          ...errorResponses,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      const parsed = SourceCreateSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(reply, zodMessage(parsed.error))
      try {
        return await reply.code(201).send(await service.create(userId, parsed.data))
      } catch (error) {
        return conflictOr(reply, error)
      }
    },
  )

  app.patch(
    '/sources/:id',
    {
      schema: {
        tags: ['sources'],
        summary: 'Update part of one of your sources',
        description:
          'An omitted key leaves the column alone; an explicit null clears an ' +
          'optional selector. At least one key is required.',
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        body: bodySchema(SourceCreateSchema.partial()),
        response: {
          200: jsonSchema(SourceResponseSchema),
          ...errorResponses,
          409: ErrorSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      const id = params(request, reply)
      if (!id) return
      // Parsed against the refined schema, not the one published above — the
      // "at least one key" rule is not expressible in JSON Schema.
      const parsed = SourceUpdateSchema.safeParse(request.body)
      if (!parsed.success) return badRequest(reply, zodMessage(parsed.error))
      try {
        const source = await service.update(userId, id, parsed.data)
        if (!source) return notFound(reply)
        return source
      } catch (error) {
        return conflictOr(reply, error)
      }
    },
  )

  app.delete(
    '/sources/:id',
    {
      schema: {
        tags: ['sources'],
        summary: 'Delete one of your sources',
        description: 'Soft — the row is retained so its postings keep resolving.',
        security: USER_ID_SECURITY,
        params: jsonSchema(IdParams),
        // No 204 entry: a declared schema for an empty body makes
        // fast-json-stringify serialize where Fastify would send nothing.
        response: errorResponses,
      },
    },
    async (request, reply) => {
      const userId = await caller(request, reply)
      if (!userId) return
      const id = params(request, reply)
      if (!id) return
      if (!(await service.remove(userId, id))) return notFound(reply)
      return reply.code(204).send()
    },
  )

  /**
   * `sources_user_name_uniq` is the only unique constraint reachable from
   * here, so a 23505 needs no disambiguation. The message avoids saying
   * anything about sources the caller cannot see.
   */
  function conflictOr(reply: FastifyReply, error: unknown) {
    const code = (error as { code?: string }).code
    if (code !== UNIQUE_VIOLATION) throw error
    return fail(reply, 409, 'Conflict', 'You already have a source with that name')
  }
}
```

- [ ] **Step 4: Wire it into the app**

Replace `src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify'
import { config } from './config.js'
import { registerDocs } from './openapi.js'
import { createSourcesRepository } from './repositories/sources.repository.js'
import { createUsersRepository } from './repositories/users.repository.js'
import { healthRoutes } from './routes/health.js'
import { sourcesRoutes } from './routes/sources.js'
import { createSourcesService } from './services/sources.service.js'
import type { UsersRepository } from './repositories/users.repository.js'
import type { SourcesService } from './services/sources.service.js'

export interface AppDeps {
  sources: SourcesService
  users: UsersRepository
}

/**
 * The real dependencies. Built lazily inside `buildApp` rather than at module
 * scope so that a test passing its own fakes never constructs them.
 */
function realDeps(): AppDeps {
  return {
    sources: createSourcesService(createSourcesRepository()),
    users: createUsersRepository(),
  }
}

/**
 * Builds a configured instance without binding a port, so tests can drive it
 * through `app.inject()`. Keep listening and process concerns in server.ts.
 *
 * `deps` exists so the unit suite can run the whole HTTP stack against
 * in-memory repositories — no database, per the test contract in CLAUDE.md.
 */
export function buildApp(deps: AppDeps = realDeps()): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } })

  // Before the routes: swagger only documents what is registered after it.
  registerDocs(app)

  app.register(healthRoutes)
  app.register(sourcesRoutes, { service: deps.sources, users: deps.users })

  return app
}
```

- [ ] **Step 5: Run the route tests**

Run: `npm test -- sources.routes`
Expected: PASS, 15 tests.

If the empty-patch test returns 200 instead of 400, Ajv accepted `{}` from the published partial schema and Zod's `.refine` should have caught it — check that the handler parses with `SourceUpdateSchema`, not the partial passed to `bodySchema`.

If route registration throws `unknown format "uuid"`, this Fastify build does not have `ajv-formats` enabled. The Zod parse in `params()` already covers it, so the fix is to drop `params: jsonSchema(IdParams)` from the three route schemas and document the parameter type in the `description` instead — do not add a custom validator compiler.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/routes/sources.ts src/app.ts test/sources.routes.test.ts
git commit -m "feat: add per-user CRUD routes for job sources"
```

---

### Task 9: Smoke test against a real database, and correct the docs

**Files:**
- Modify: `CLAUDE.md` (repo root)
- Modify: `api/CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: documentation matching the code, and one manual confirmation that the Drizzle repository — the only untested unit — actually works.

- [ ] **Step 1: Boot against Postgres**

```bash
cd .. && docker-compose up -d postgres && cd api
npm run db:migrate
npm run dev
```

Expected: the server listens on 3000 and `/health` reports `database: up`.

- [ ] **Step 2: Exercise the API by hand**

In a second terminal:

```bash
U=00000000-0000-4000-8000-000000000001
BASE=http://localhost:3000

# create
curl -s -X POST $BASE/sources -H "content-type: application/json" -H "x-user-id: $U" \
  -d '{"name":"Example","listingUrl":"https://example.com/jobs","itemSelector":".job",
       "titleSelector":".t","detailUrlSelector":"a","descriptionSelector":"#d",
       "blockedTitleWords":["  PHP "]}'

# list, patch, delete
curl -s $BASE/sources -H "x-user-id: $U"
ID=$(curl -s $BASE/sources -H "x-user-id: $U" | node -pe 'JSON.parse(require("fs").readFileSync(0)).sources[0].id')
curl -s -X PATCH $BASE/sources/$ID -H "content-type: application/json" -H "x-user-id: $U" -d '{"enabled":false}'
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $BASE/sources/$ID -H "x-user-id: $U"
curl -s -o /dev/null -w '%{http_code}\n' $BASE/sources/$ID -H "x-user-id: $U"
```

Expected: the create returns 201 with `"blockedTitleWords":["php"]`, `"enabled":true`, `"detailUrlAttr":"href"`, and **no** `userId`. The delete returns `204` and the read after it returns `404`.

- [ ] **Step 3: Confirm the duplicate-name conflict**

Run the create from Step 2 twice.
Expected: the second returns 409 with `"You already have a source with that name"`.

- [ ] **Step 4: Confirm a soft-deleted name can be reused**

This is the behavior the unit suite cannot prove.

```bash
# after the DELETE in step 2, create the same name again
```
Expected: 201, not 409 — the partial unique index ignores deleted rows.

- [ ] **Step 5: Open the docs UI**

Visit `http://localhost:3000/docs`. Expected: an Authorize button; the five sources operations under a `sources` tag; and after authorizing with the seeded uuid, a successful "Try it out" on `GET /sources`.

- [ ] **Step 6: Correct the root CLAUDE.md**

Under `## What it is`, replace:

```markdown
Aggregates job postings from multiple sources into one searchable place.
Single user, self-hosted.
```

with:

```markdown
Aggregates job postings from multiple sources into one searchable place.
**Multi-user**: every user owns their own sources, blocklists and postings, and
no data is shared between users. Self-hosted.
```

Under `## Architecture`, replace the paragraph beginning "The one seam that matters" and the "Duplicate handling is unsettled" paragraph with:

```markdown
The one seam that matters: **a source is a database row, not a code file.** One
generic adapter reads the row — a listing URL plus CSS selectors — so adding a
job board is a `POST /sources`, never a deploy. How the adapter fetches stays
inside the adapter; nothing outside it may assume HTML, JSON, or a rate-limit
shape.

**Duplicate handling is settled.** One row per source, keyed on the posting's
detail URL. A re-seen posting from the same source is assumed unchanged and
only has its `last_seen_at` advanced. Postings are *not* collapsed across
sources, and the API does not group them — the same job on three boards is
three results. See
`docs/superpowers/specs/2026-09-01-job-sources-design.md`.
```

- [ ] **Step 7: Correct api/CLAUDE.md**

Replace the whole `## Status: scaffold only` section with:

```markdown
## Status

The sources API is built: three tables (`users`, `sources`, `postings`), CRUD
at `/sources`, and an OpenAPI document at `/docs`. **Nothing fetches any job
board yet** — `postings` is created but written by nothing. The generic
adapter, the ingestion pipeline, the `POST` trigger and the 30-minute schedule
are the next slice.
```

In `## Decisions already made (not yet built)`, replace the "Source adapters stay behind one interface" bullet with:

```markdown
- **A source is a row, not a file.** One generic adapter reads `sources` — a
  listing URL plus CSS selectors, page one only, plain HTTP and cheerio, no
  headless browser. Adding a board is a `POST /sources`. This reverses an
  earlier decision that each board would be its own TypeScript file.
```

Delete the whole `## Open decisions — settle before writing the schema` section and add a new section after `## Errors`:

```markdown
## Two validators, one status code

Request bodies are validated **twice**, on purpose. The route declares
`body: bodySchema(Schema)` so Fastify's Ajv checks it and `@fastify/swagger`
publishes it; the handler then runs `Schema.safeParse` for the rules JSON
Schema cannot express — the http/https protocol check, the "at least one key"
rule on a patch.

Two consequences a later reader will otherwise take for bugs:

- **The published schema is deliberately looser than the real rule.** A body
  that satisfies the document can still be rejected. The strict rules live in
  each field's `.describe()`.
- **`bodySchema` converts with `io: 'input'`, `jsonSchema` with `'output'`.**
  Under `'output'` Zod marks every `.default()` field `required`, and Ajv would
  reject bodies that Zod accepts. Responses want `'output'`.

Because 400 is a documented response shape, handlers reproduce Fastify's
`{ statusCode, error, message }` body by hand rather than inventing one — with
no `setErrorHandler` there is nothing to normalize it for them.

## Isolation

Every user sees only their own data. `sources.user_id` is the sole ownership
record; postings derive theirs through `source_id`. `SourcesRepository` exposes
no method that does not take a `userId`, so there is no unscoped query to
forget to scope. Another user's source id returns **404**, never 403.

`X-User-Id` stands in for authentication and **must not reach a deployment** —
any caller can claim to be any user. `src/auth/current-user.ts` is the only
place that changes when sessions arrive.
```

- [ ] **Step 8: Final verification**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test`
Expected: all pass. If `format:check` fails, run `npm run format` and include the result in the commit.

- [ ] **Step 9: Commit**

```bash
git add ../CLAUDE.md CLAUDE.md
git commit -m "docs: record multi-user sources-as-rows and the two-validator split"
```

---

## Verification summary

| Requirement | Where it is proved |
|---|---|
| Three tables with the right columns | Task 2 step 7 (psql) |
| Partial unique index scoped per user | Task 9 steps 3–4 (manual — no unit coverage) |
| Seeded user exists with a fixed id | Task 2 step 7 |
| Defaults applied on create | Task 3, Task 8 |
| Words lowercased and trimmed | Task 5, Task 9 step 2 |
| Omitted ≠ null on patch | Task 3, Task 5, Task 8 |
| Another user's source is a 404 | Task 8 (read, patch, delete) |
| Owner never taken from the body | Task 5, Task 8 |
| `userId` never serialized | Task 5, Task 8, Task 9 step 2 |
| Soft delete hides the row | Task 5, Task 8, Task 9 step 2 |
| 409 on a duplicate name | Task 9 step 3 (manual — needs the real constraint) |
| Both 400 paths share one body shape | Task 8 |
| `X-User-Id` documented as a security scheme | Task 7, Task 8 |
| Docs match the code | Task 9 |

**Not covered by automated tests, by design:** the Drizzle repository bodies and both partial-unique-index behaviors. They need a live Postgres, which the unit suite deliberately does not have. Task 9 is their only verification, and it is manual.
