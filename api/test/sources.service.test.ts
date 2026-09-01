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
