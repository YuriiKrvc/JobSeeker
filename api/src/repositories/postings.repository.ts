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
      const conditions = [eq(sources.userId, userId), isNull(sources.deletedAt)]
      // A filter, not a lookup: another user's sourceId simply matches nothing.
      // Checked with `!== undefined`, not truthiness — an empty string must
      // narrow to nothing, not silently widen to every one of the user's
      // sources.
      if (sourceId !== undefined)
        conditions.push(eq(postings.sourceId, sourceId))
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
