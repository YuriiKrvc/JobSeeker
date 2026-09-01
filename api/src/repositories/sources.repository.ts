import { and, eq, isNull } from 'drizzle-orm'
import { db } from '../db/client.js'
import { sources } from '../db/schema.js'
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
