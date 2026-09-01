import { afterAll, describe, expect, it } from 'vitest'
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
    expect(response.json<{ items: unknown[] }>().items).toEqual([])
  })

  it('400s a missing X-User-Id', async () => {
    app = appWith(fakePostings().repo)
    const response = await app.inject({ method: 'GET', url: '/postings' })
    expect(response.statusCode).toBe(400)
  })
})
