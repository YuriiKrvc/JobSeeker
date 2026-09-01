import * as cheerio from 'cheerio'
import type { FetchText } from './fetch-text.js'
import type { SourceRow } from '../repositories/sources.repository.js'

/**
 * The generic adapter. It knows HTML, CSS selectors and nothing else: no SQL,
 * no blocklists, and no opinion about whether a posting is worth fetching.
 *
 * It is split in two phases on purpose. The title blocklist must be applied
 * before a detail page is fetched (that is the whole point of it), and an
 * already-stored posting must not be re-fetched (that is why blocked postings
 * are stored at all). Both decisions need the blocklists and the database,
 * neither of which belongs here — so the service calls `listItems`, decides,
 * and calls `fetchDetail` only for the survivors.
 *
 * Consequence: the per-item delay and the item cap are the service's to
 * enforce. An adapter that fetched on its own schedule would take that back.
 */

export interface ListedItem {
  title: string
  detailUrl: string
}

/** One unusable item, or one failed detail fetch. Reaches the HTTP response as-is. */
export interface ItemError {
  url: string
  message: string
}

export interface ListingResult {
  items: ListedItem[]
  errors: ItemError[]
}

export interface DetailResult {
  description: string
  company: string | null
  postedAtRaw: string | null
}

type Api = cheerio.CheerioAPI
type Scope = ReturnType<Api>

/**
 * A selector may name a descendant of the item or the item itself — a board
 * whose item element *is* the anchor is common enough that only supporting
 * `.find()` would make it unconfigurable.
 */
function pick($: Api, scope: Scope, selector: string): Scope | null {
  const found = scope.find(selector)
  if (found.length > 0) return found.first()
  return scope.is(selector) ? scope : null
}

/** A null attribute means the element's trimmed text; otherwise that attribute. */
function read(el: Scope | null, attr: string | null): string | null {
  if (!el) return null
  const raw = attr === null ? el.text() : el.attr(attr)
  const value = raw?.trim()
  return value ? value : null
}

export async function listItems(
  source: SourceRow,
  fetchText: FetchText,
): Promise<ListingResult> {
  // Deliberately not caught: a listing that cannot be fetched or parsed is a
  // source-level failure, and only the service can write `last_error`.
  const html = await fetchText(source.listingUrl, source.requestTimeoutMs)
  const $ = cheerio.load(html)

  const items: ListedItem[] = []
  const errors: ItemError[] = []

  $(source.itemSelector).each((index, element) => {
    const scope = $(element)
    // 1-based: this number is read by a human comparing it against the page.
    const where = `item ${index + 1}`

    const title = read(pick($, scope, source.titleSelector), source.titleAttr)
    if (!title) {
      errors.push({ url: source.listingUrl, message: `${where}: empty title` })
      return
    }

    const href = read(
      pick($, scope, source.detailUrlSelector),
      source.detailUrlAttr,
    )
    if (!href) {
      errors.push({
        url: source.listingUrl,
        message: `${where}: no detail url`,
      })
      return
    }

    let resolved: URL
    try {
      // Absolutizes a relative href. Query strings are kept: some boards carry
      // the job id there, and the URL is this posting's identity.
      resolved = new URL(href, source.listingUrl)
    } catch {
      errors.push({
        url: source.listingUrl,
        message: `${where}: unresolvable detail url ${href}`,
      })
      return
    }
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
      errors.push({
        url: source.listingUrl,
        message: `${where}: detail url is not http/https (${resolved.protocol})`,
      })
      return
    }

    items.push({ title, detailUrl: resolved.toString() })
  })

  return { items, errors }
}

export async function fetchDetail(
  source: SourceRow,
  url: string,
  fetchText: FetchText,
): Promise<DetailResult> {
  const html = await fetchText(url, source.requestTimeoutMs)
  const $ = cheerio.load(html)
  const root = $.root()

  const description = read(
    pick($, root, source.descriptionSelector),
    source.descriptionAttr,
  )
  // `postings.description` is NOT NULL and a posting with no body is useless.
  // Throwing puts this item in the run's `errors[]` and leaves it unstored, so
  // the next run retries it — which is what a page that failed to render wants.
  if (!description) {
    throw new Error(
      `${url}: description selector matched nothing (${source.descriptionSelector})`,
    )
  }

  // The optional fields are optional twice over: the selector may be unset, and
  // a configured selector may match nothing. Neither is a failure — a board
  // that omits the company on some postings is normal.
  const company = source.companySelector
    ? read(pick($, root, source.companySelector), source.companyAttr)
    : null
  const postedAtRaw = source.postedAtSelector
    ? read(pick($, root, source.postedAtSelector), source.postedAtAttr)
    : null

  return { description, company, postedAtRaw }
}
