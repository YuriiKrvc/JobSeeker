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
import { sourceRow } from './fixtures.js'

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

  it("keeps both lists when owner and source each block a different word", async () => {
    // A source-only or owner-only case cannot tell union from "whichever list
    // is non-empty wins" — both lists must be non-empty and disjoint so that
    // replacement in either direction fails this test.
    const source = sourceRow({ blockedTitleWords: ['php'] })
    const postings = fakePostings()
    const fetchText = pages()
    const service = createIngestionService({
      sources: fakeSources([source]).repo,
      postings: postings.repo,
      users: fakeUsers({
        blockedTitleWords: ['senior'],
        blockedDescriptionWords: [],
      }),
      fetchText,
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: { blocked: number; created: number }
    }

    expect(summary).toMatchObject({ blocked: 2, created: 0 })
    // Both items are title-blocked, so no detail page is ever fetched.
    expect(fetchText.mock.calls.map((call) => call[0])).toEqual([
      'https://example.com/jobs/',
    ])
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

  it('keeps a failed upsert of a title-blocked posting out of the run-aborting path', async () => {
    // The title branch's upsert must be wrapped exactly like the detail
    // branch's: a repository failure there is one item's error, not an
    // exception that unwinds the whole run and skips touchLastSeen /
    // recordRunResult.
    const source = sourceRow({ blockedTitleWords: ['php'] })
    const sources = fakeSources([source])
    const postings = fakePostings()
    const realUpsert = postings.repo.upsert.bind(postings.repo)
    postings.repo.upsert = (userId, posting) => {
      if (posting.url === 'https://example.com/2') {
        return Promise.reject(new Error('connection lost'))
      }
      return realUpsert(userId, posting)
    }
    const service = createIngestionService({
      sources: sources.repo,
      postings: postings.repo,
      users: fakeUsers(),
      fetchText: pages(),
      sleep: () => Promise.resolve(),
    })

    const { summary } = (await service.ingestOne(ALICE, source.id)) as {
      summary: {
        created: number
        blocked: number
        errors: { url: string; message: string }[]
      }
    }

    // The failed item lands in errors, not blocked; the run still completes
    // and the other item is still processed normally.
    expect(summary.created).toBe(1)
    expect(summary.blocked).toBe(0)
    expect(summary.errors).toEqual([
      { url: 'https://example.com/2', message: 'connection lost' },
    ])
    expect(sources.results).toEqual([{ id: source.id, lastError: null }])
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
