import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'
import type { UsersRepository } from '../src/repositories/users.repository.js'
import type {
  SourceInsert,
  SourceRow,
  SourcesRepository,
} from '../src/repositories/sources.repository.js'
import { createSourcesService } from '../src/services/sources.service.js'
import type { IngestionService } from '../src/services/ingestion.service.js'
import type { PostingsService } from '../src/services/postings.service.js'
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
  findBlocklists: () =>
    Promise.resolve({ blockedTitleWords: [], blockedDescriptionWords: [] }),
}

/** Mirrors the fake in sources.service.test.ts; kept local so each suite reads alone. */
function fakeRepo(): SourcesRepository {
  const rows: SourceRow[] = []
  let next = 0
  const find = (userId: string, id: string) =>
    rows.find((r) => r.id === id && r.userId === userId && !r.deletedAt)
  return {
    list: (userId) =>
      Promise.resolve(rows.filter((r) => r.userId === userId && !r.deletedAt)),
    findById: (userId, id) => Promise.resolve(find(userId, id) ?? null),
    create: (input: SourceInsert) => {
      const now = new Date('2026-09-01T10:00:00.000Z')
      const row: SourceRow = {
        ...input,
        // Padded to 12 hex chars so the id stays a well-formed uuid past nine rows.
        id: `00000000-0000-4000-8000-${String(++next).padStart(12, '0')}`,
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
    recordRunStart: () => Promise.resolve(),
    recordRunResult: () => Promise.resolve(),
  }
}

/**
 * A repo whose `create` always throws. Used to drive `conflictOr` without a
 * real database — the shape mirrors what drizzle-orm 0.45 actually produces
 * against Postgres: a wrapper error (`DrizzleQueryError`) whose own `.code`
 * is undefined, with the real `postgres.js` error nested at `.cause`.
 */
function fakeRepoThatThrows(error: Error): SourcesRepository {
  return {
    ...fakeRepo(),
    create: () => Promise.reject(error),
  }
}

const uniqueViolation = () =>
  Object.assign(new Error('duplicate key value violates unique constraint'), {
    cause: Object.assign(
      new Error('duplicate key value violates unique constraint'),
      {
        code: '23505',
        constraint_name: 'sources_user_name_uniq',
      },
    ),
  })

// Initialized at declaration, not in beforeEach: `noUncheckedIndexedAccess`
// and strict mode reject a `let app: FastifyInstance` that beforeEach reads
// before assigning.
let app: FastifyInstance = buildApp({
  sources: createSourcesService(fakeRepo()),
  postings: {} as PostingsService,
  users,
  ingestion: {} as IngestionService,
})

beforeEach(async () => {
  await app.close()
  app = buildApp({
    sources: createSourcesService(fakeRepo()),
    postings: {} as PostingsService,
    users,
    ingestion: {} as IngestionService,
  })
})

afterAll(async () => {
  await app.close()
})

const as = (userId: string) => ({ 'x-user-id': userId })

async function createFor(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
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
    expect(Object.keys(response.json<object>()).sort()).toEqual([
      'error',
      'message',
      'statusCode',
    ])
  })

  it('400s on a non-uuid header', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sources',
      headers: as('nope'),
    })
    expect(response.statusCode).toBe(400)
  })

  it('404s on a uuid naming no user', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/sources',
      headers: as(GHOST),
    })
    expect(response.statusCode).toBe(404)
  })
})

describe('POST /sources', () => {
  it('creates and returns 201 without userId in the body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: as(ALICE),
      payload: body,
    })
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
    expect(Object.keys(response.json<object>()).sort()).toEqual([
      'error',
      'message',
      'statusCode',
    ])
  })

  it('400s on a missing required selector, in the same body shape as a Zod-only rejection', async () => {
    const { itemSelector: _dropped, ...withoutSelector } = body
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: as(ALICE),
      payload: withoutSelector,
    })
    expect(response.statusCode).toBe(400)
    // This one is rejected by Ajv against the published JSON Schema (a
    // required property is missing) rather than by Zod — the pair above only
    // ever exercises Zod against itself.
    expect(Object.keys(response.json<object>()).sort()).toEqual([
      'error',
      'message',
      'statusCode',
    ])
  })

  it('ignores a userId sent in the body; the header is the only source of ownership', async () => {
    // Ajv's `removeAdditional: true` strips `userId` before Zod's `.strict()`
    // ever sees it, so this also guards against `.strict()` being mistaken
    // for the thing enforcing this.
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: as(ALICE),
      payload: { ...body, userId: BOB },
    })
    expect(response.statusCode).toBe(201)
    const created = response.json<{ id: string }>()

    const asAlice = await app.inject({
      method: 'GET',
      url: '/sources',
      headers: as(ALICE),
    })
    expect(
      asAlice.json<{ sources: { id: string }[] }>().sources.map((s) => s.id),
    ).toContain(created.id)

    const asBob = await app.inject({
      method: 'GET',
      url: '/sources',
      headers: as(BOB),
    })
    expect(
      asBob.json<{ sources: { id: string }[] }>().sources.map((s) => s.id),
    ).not.toContain(created.id)
  })

  it('400s on a whitespace-only name', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: as(ALICE),
      payload: { ...body, name: '   ' },
    })
    expect(response.statusCode).toBe(400)
  })

  it('400s on a whitespace-only required selector', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sources',
      headers: as(ALICE),
      payload: { ...body, itemSelector: '   ' },
    })
    expect(response.statusCode).toBe(400)
  })
})

describe('GET /sources', () => {
  it('returns only the caller-owned sources', async () => {
    await createFor(ALICE)
    await createFor(BOB, { name: 'Bob Board' })
    const response = await app.inject({
      method: 'GET',
      url: '/sources',
      headers: as(ALICE),
    })
    expect(response.statusCode).toBe(200)
    expect(response.json<{ sources: unknown[] }>().sources).toHaveLength(1)
  })

  it('includes disabled sources so they can be re-enabled', async () => {
    const created = await createFor(ALICE)
    await app.inject({
      method: 'PATCH',
      url: `/sources/${created.id}`,
      headers: as(ALICE),
      payload: { enabled: false },
    })
    const response = await app.inject({
      method: 'GET',
      url: '/sources',
      headers: as(ALICE),
    })
    expect(response.json<{ sources: unknown[] }>().sources).toHaveLength(1)
  })
})

describe('ownership', () => {
  it('404s reading another user-owned source', async () => {
    const created = await createFor(ALICE)
    const response = await app.inject({
      method: 'GET',
      url: `/sources/${created.id}`,
      headers: as(BOB),
    })
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
    const response = await app.inject({
      method: 'DELETE',
      url: `/sources/${created.id}`,
      headers: as(BOB),
    })
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
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/sources/${created.id}`,
          headers: as(ALICE),
        })
      ).statusCode,
    ).toBe(204)
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/sources/${created.id}`,
          headers: as(ALICE),
        })
      ).statusCode,
    ).toBe(404)
  })
})

describe('openapi document', () => {
  it('documents every sources path with its security requirement', async () => {
    const doc = (await app.inject({ method: 'GET', url: '/docs/json' })).json<{
      paths: Record<
        string,
        Record<
          string,
          { security?: unknown; responses?: Record<string, unknown> }
        >
      >
    }>()
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining(['/sources', '/sources/{id}']),
    )
    expect(doc.paths['/sources']?.post?.security).toEqual([{ userId: [] }])
    // DELETE must declare its success status, not only its error statuses.
    expect(doc.paths['/sources/{id}']?.delete?.responses).toHaveProperty('204')
  })
})

describe('POST /sources conflict handling', () => {
  it('409s on a duplicate name, wrapped the way drizzle-orm actually wraps it', async () => {
    const conflictApp = buildApp({
      sources: createSourcesService(fakeRepoThatThrows(uniqueViolation())),
      postings: {} as PostingsService,
      users,
      ingestion: {} as IngestionService,
    })
    try {
      const response = await conflictApp.inject({
        method: 'POST',
        url: '/sources',
        headers: as(ALICE),
        payload: body,
      })
      expect(response.statusCode).toBe(409)
      expect(response.json<{ message: string }>().message).toBe(
        'You already have a source with that name',
      )
      expect(Object.keys(response.json<object>()).sort()).toEqual([
        'error',
        'message',
        'statusCode',
      ])
    } finally {
      await conflictApp.close()
    }
  })

  it('500s, not 409s, on an error that is not a unique violation', async () => {
    const otherError = Object.assign(new Error('connection reset'), {
      cause: Object.assign(new Error('connection reset'), { code: '57P01' }),
    })
    const brokenApp = buildApp({
      sources: createSourcesService(fakeRepoThatThrows(otherError)),
      postings: {} as PostingsService,
      users,
      ingestion: {} as IngestionService,
    })
    try {
      const response = await brokenApp.inject({
        method: 'POST',
        url: '/sources',
        headers: as(ALICE),
        payload: body,
      })
      expect(response.statusCode).toBe(500)
    } finally {
      await brokenApp.close()
    }
  })
})
