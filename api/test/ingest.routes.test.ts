import { afterAll, describe, expect, it, vi } from 'vitest'
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
    app = appWith({ ingestOne, ingestAll: vi.fn() })

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
    expect(response.json<RunSummary>().errors).toHaveLength(1)
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
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() })

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
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() })

    const response = await app.inject({
      method: 'POST',
      url: `/sources/${SOURCE}/ingest`,
      headers: { 'x-user-id': GHOST },
    })

    expect(response.statusCode).toBe(404)
    expect(response.json<{ message: string }>().message).toBe('No such user')
  })

  it('400s a non-uuid source id', async () => {
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() })

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
    app = appWith({ ingestOne, ingestAll: vi.fn() })

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
    app = appWith({ ingestOne: vi.fn(), ingestAll })

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
    })

    const response = await app.inject({
      method: 'POST',
      url: '/ingest',
      headers: { 'x-user-id': ALICE },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ runs: [] })
  })

  it('400s a missing X-User-Id', async () => {
    app = appWith({ ingestOne: vi.fn(), ingestAll: vi.fn() })
    const response = await app.inject({ method: 'POST', url: '/ingest' })
    expect(response.statusCode).toBe(400)
  })
})
