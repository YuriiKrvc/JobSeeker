import { request } from './client'

/**
 * The frontend's own restatement of the wire shape, transcribed from
 * api/src/routes/sources.schema.ts. Deliberately not imported from `api/`:
 * the REST API is the whole contract between the two projects. When the API
 * changes, this is the file that changes with it.
 *
 * Timestamps are ISO-8601 strings, not Dates — JSON has no date type and
 * nothing here needs date arithmetic.
 */
export interface Source {
  id: string
  name: string
  listingUrl: string
  enabled: boolean

  // Listing page.
  itemSelector: string
  titleSelector: string
  titleAttr: string | null
  detailUrlSelector: string
  detailUrlAttr: string

  // Detail page.
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

  // Server-owned.
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/** The 19 fields a caller may write. */
export type SourceInput = Omit<
  Source,
  'id' | 'lastRunAt' | 'lastSuccessAt' | 'lastError' | 'createdAt' | 'updatedAt'
>

export async function listSources(): Promise<Source[]> {
  const { sources } = await request<{ sources: Source[] }>('/sources')
  return sources
}

export function createSource(input: SourceInput): Promise<Source> {
  return request<Source>('/sources', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** An omitted key leaves the column alone; an explicit null clears it. */
export function updateSource(
  id: string,
  patch: Partial<SourceInput>,
): Promise<Source> {
  return request<Source>(`/sources/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteSource(id: string): Promise<void> {
  return request<void>(`/sources/${id}`, { method: 'DELETE' })
}
