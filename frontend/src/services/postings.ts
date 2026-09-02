import { request } from './client'

/**
 * The frontend's own restatement of the wire shape, transcribed from
 * api/src/routes/postings.schema.ts. Deliberately not imported from `api/`:
 * the REST API is the whole contract between the two projects. When the API
 * changes, this is the file that changes with it.
 *
 * Timestamps are ISO-8601 strings, not Dates — JSON has no date type, and the
 * one place a date is rendered parses it at the call site.
 */
export interface Posting {
  id: string
  sourceId: string
  /** Absolutized detail URL. The identity of a posting. */
  url: string
  title: string
  company: string | null
  /** Empty for a title-blocked posting, which was never fetched. */
  description: string
  /** As scraped, e.g. "3 days ago" — kept so a parse misfire stays visible. */
  postedAtRaw: string | null
  /** Null when postedAtRaw was not a parseable date. */
  postedAt: string | null
  /** Null means visible; otherwise the blocklist word that matched. */
  blockedBy: string | null
  firstSeenAt: string
  lastSeenAt: string
}

/**
 * `includeBlocked` is deliberately absent: the postings page never asks for
 * blocked postings, so the API's own `false` default applies. `blockedBy` is
 * still on `Posting` above — it is in the response shape, and omitting a field
 * from the wire type would be a lie about the contract — it simply never
 * renders. Adding a "show blocked" toggle later means adding one field here.
 *
 * `limit` and `offset` have API-side defaults (50 and 0); this type leaves both
 * optional so a caller can omit them, and the page passes them explicitly.
 */
export interface PostingsQuery {
  sourceId?: string
  limit?: number
  offset?: number
}

export interface PostingsResult {
  items: Posting[]
  /** Matching the filters, ignoring limit and offset. */
  total: number
}

/**
 * Newest first — ordered by when *we* first saw a posting, not when it was
 * posted (`first_seen_at DESC, id DESC` in the API's repository).
 *
 * Only defined keys are appended. An absent `sourceId` must not become the
 * literal string "undefined", which the API rejects as a malformed uuid with
 * a 400.
 */
export function listPostings(
  query: PostingsQuery = {},
): Promise<PostingsResult> {
  const params = new URLSearchParams()
  if (query.sourceId !== undefined) params.set('sourceId', query.sourceId)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const search = params.toString()
  return request<PostingsResult>(`/postings${search ? `?${search}` : ''}`)
}
