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
