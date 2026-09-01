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
