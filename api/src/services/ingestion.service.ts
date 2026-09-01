import { fetchDetail, listItems } from '../adapters/html-source.adapter.js'
import { findBlockedWord } from './blocklist.js'
import type { FetchText } from '../adapters/fetch-text.js'
import type { ItemError } from '../adapters/html-source.adapter.js'
import type { PostingsRepository } from '../repositories/postings.repository.js'
import type {
  SourceRow,
  SourcesRepository,
} from '../repositories/sources.repository.js'
import type { UsersRepository } from '../repositories/users.repository.js'

/**
 * The pipeline. Both HTTP triggers call this, and the 30-minute schedule will
 * become a third caller — so a trigger stays a thin entrypoint and never a
 * second copy of what is below.
 *
 * Everything the adapter is not allowed to know lives here: the blocklists,
 * the already-stored check, the per-item delay, the item cap, and the counters.
 */

export interface RunSummary {
  sourceId: string
  /** Items accounted for: post-truncation items plus unusable listing entries. */
  fetched: number
  /** Inserted with `blockedBy` null. */
  created: number
  /** Already stored; `lastSeenAt` advanced. Includes previously blocked ones. */
  updated: number
  /** Inserted with `blockedBy` set, whether the title or the description matched. */
  blocked: number
  /** True when `maxItemsPerRun` cut the list. Never a silent cap. */
  truncated: boolean
  errors: ItemError[]
}

export type IngestOneResult =
  | { ok: true; summary: RunSummary }
  | { ok: false; reason: 'not-found' | 'disabled' }

export interface IngestionDeps {
  sources: SourcesRepository
  postings: PostingsRepository
  users: UsersRepository
  fetchText: FetchText
  /** Injected so tests assert the delay on a spy instead of waiting for it. */
  sleep?: (ms: number) => Promise<void>
}

const realSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms))

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * `posted_at_raw` keeps whatever the board said; `posted_at` is set only when
 * that string is a real date. "3 days ago" leaves it null on purpose — the raw
 * column exists so a parse misfire stays visible instead of becoming a wrong
 * timestamp. Relative-date parsing is out of scope.
 */
function parsePostedAt(raw: string | null): Date | null {
  if (!raw) return null
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function createIngestionService(deps: IngestionDeps) {
  const sleep = deps.sleep ?? realSleep

  async function runSource(
    userId: string,
    source: SourceRow,
  ): Promise<RunSummary> {
    const summary: RunSummary = {
      sourceId: source.id,
      fetched: 0,
      created: 0,
      updated: 0,
      blocked: 0,
      truncated: false,
      errors: [],
    }

    await deps.sources.recordRunStart(userId, source.id)

    // A source may add markers to its owner's but can never remove one, which
    // is just concatenation: the owner's list is always present.
    const owner = await deps.users.findBlocklists(userId)
    const titleWords = [...source.blockedTitleWords, ...owner.blockedTitleWords]
    const descriptionWords = [
      ...source.blockedDescriptionWords,
      ...owner.blockedDescriptionWords,
    ]

    let listing
    try {
      listing = await listItems(source, deps.fetchText)
    } catch (error) {
      // A source-level failure. Recorded, reported, and still a 200 upstream:
      // the caller asked for a run and this is what the run did.
      const message = messageOf(error)
      summary.errors.push({ url: source.listingUrl, message })
      await deps.sources.recordRunResult(userId, source.id, {
        lastError: message,
      })
      return summary
    }

    const items = listing.items.slice(0, source.maxItemsPerRun)
    const errors = listing.errors.slice(0, source.maxItemsPerRun)
    summary.errors.push(...errors)
    summary.truncated =
      items.length < listing.items.length ||
      errors.length < listing.errors.length
    summary.fetched = items.length + errors.length

    const known = await deps.postings.findExistingUrls(userId, source.id)
    const reseen: string[] = []
    let fetchedOnce = false

    for (const item of items) {
      // Checked before any blocklist: a stored posting is never re-examined,
      // which is why storing a blocked one saves the fetch forever.
      if (known.has(item.detailUrl)) {
        reseen.push(item.detailUrl)
        summary.updated += 1
        continue
      }

      const titleHit = findBlockedWord(item.title, titleWords)
      if (titleHit) {
        // Stored rather than dropped, so the detail page is never fetched on a
        // later run and an over-eager marker stays visible. The description is
        // empty because nothing was fetched to fill it.
        //
        // Wrapped like the detail branch's upsert below: a repository failure
        // here must become one item's error, not an aborted run that loses
        // every counter and skips touchLastSeen/recordRunResult.
        try {
          await deps.postings.upsert(userId, {
            sourceId: source.id,
            url: item.detailUrl,
            title: item.title,
            company: null,
            description: '',
            postedAtRaw: null,
            postedAt: null,
            blockedBy: titleHit,
          })
          known.add(item.detailUrl)
          summary.blocked += 1
        } catch (error) {
          summary.errors.push({
            url: item.detailUrl,
            message: messageOf(error),
          })
        }
        continue
      }

      try {
        // Between fetches, not before the first: politeness to the board, not
        // a warm-up.
        if (fetchedOnce && source.detailDelayMs > 0) {
          await sleep(source.detailDelayMs)
        }
        fetchedOnce = true
        const detail = await fetchDetail(source, item.detailUrl, deps.fetchText)
        const descriptionHit = findBlockedWord(
          detail.description,
          descriptionWords,
        )
        await deps.postings.upsert(userId, {
          sourceId: source.id,
          url: item.detailUrl,
          title: item.title,
          company: detail.company,
          description: detail.description,
          postedAtRaw: detail.postedAtRaw,
          postedAt: parsePostedAt(detail.postedAtRaw),
          blockedBy: descriptionHit,
        })
        known.add(item.detailUrl)
        if (descriptionHit) summary.blocked += 1
        else summary.created += 1
      } catch (error) {
        // Nothing is stored, so the next run retries this posting. One dead
        // detail page does not make a working source a failed one.
        summary.errors.push({
          url: item.detailUrl,
          message: messageOf(error),
        })
      }
    }

    await deps.postings.touchLastSeen(userId, source.id, reseen)
    await deps.sources.recordRunResult(userId, source.id, { lastError: null })
    return summary
  }

  return {
    async ingestOne(
      userId: string,
      sourceId: string,
    ): Promise<IngestOneResult> {
      // Scoped read: another user's source is indistinguishable from a missing
      // one, and the route turns both into a 404.
      const source = await deps.sources.findById(userId, sourceId)
      if (!source) return { ok: false, reason: 'not-found' }
      // An explicit single-source trigger refuses a disabled source rather than
      // quietly overriding the switch. `ingestAll` skips it silently instead —
      // that is the one place the two triggers disagree.
      if (!source.enabled) return { ok: false, reason: 'disabled' }
      return { ok: true, summary: await runSource(userId, source) }
    },

    async ingestAll(userId: string): Promise<RunSummary[]> {
      // Already ordered by name; `list` excludes soft-deleted rows.
      const all = await deps.sources.list(userId)
      const runs: RunSummary[] = []
      for (const source of all) {
        if (!source.enabled) continue
        try {
          runs.push(await runSource(userId, source))
        } catch (error) {
          // `runSource` handles fetch failures itself, so reaching here means
          // a repository failed. One broken source must not end the batch.
          runs.push({
            sourceId: source.id,
            fetched: 0,
            created: 0,
            updated: 0,
            blocked: 0,
            truncated: false,
            errors: [{ url: source.listingUrl, message: messageOf(error) }],
          })
        }
      }
      return runs
    },
  }
}

export type IngestionService = ReturnType<typeof createIngestionService>
