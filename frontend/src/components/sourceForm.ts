import type { FormRule } from 'antd'

import type { Source, SourceInput } from '../api/sources'

/**
 * Validation rules transcribed from api/src/routes/sources.schema.ts.
 *
 * This duplicates the Zod schema by hand and can drift from it. The real fix
 * is generating these from the OpenAPI document the API publishes at /docs,
 * which is out of scope here. They are grouped into these consts rather than
 * written inline so that generator has a single seam to replace, and so a
 * reviewer can diff them against the schema in one place.
 *
 * `whitespace: true` is antd's spelling of the API's `/\S/` pattern: a
 * whitespace-only string is a blank in disguise and the API rejects it.
 *
 * Kept in this sibling module, rather than in SourceFormModal.tsx itself, so
 * that file only exports the component: `react-refresh/only-export-components`
 * flags any other export sharing a file with a component, and this module is
 * also the single seam a future OpenAPI-driven generator would replace.
 */
export const NAME_RULES: FormRule[] = [
  { required: true, whitespace: true, message: 'Name is required' },
  { max: 200, message: 'At most 200 characters' },
]

export const LISTING_URL_RULES: FormRule[] = [
  { required: true, message: 'Listing URL is required' },
  { type: 'url', message: 'Must be a valid http(s) URL' },
  { max: 2000, message: 'At most 2000 characters' },
  {
    // antd's `type: 'url'` accepts ftp:// and others; the API takes only these
    // two, and its published schema says merely "uri", so the check is here.
    pattern: /^https?:\/\//,
    message: 'Must start with http:// or https://',
  },
]

export const requiredSelector: FormRule[] = [
  { required: true, whitespace: true, message: 'Required' },
  { max: 500, message: 'At most 500 characters' },
]

export const optionalSelector: FormRule[] = [
  { whitespace: true, message: 'Cannot be only whitespace' },
  { max: 500, message: 'At most 500 characters' },
]

export const requiredAttr: FormRule[] = [
  { required: true, whitespace: true, message: 'Required' },
  { max: 100, message: 'At most 100 characters' },
]

export const optionalAttr: FormRule[] = [
  { whitespace: true, message: 'Cannot be only whitespace' },
  { max: 100, message: 'At most 100 characters' },
]

export const WORD_LIST_RULES: FormRule[] = [
  {
    validator: (_rule, value: string[] | undefined) => {
      const words = value ?? []
      if (words.length > 500)
        return Promise.reject(new Error('At most 500 words'))
      if (words.some((word) => word.length > 100)) {
        return Promise.reject(new Error('Each word is at most 100 characters'))
      }
      // The API's word schema is `z.string().min(1).max(100)`: an empty
      // string is rejected with a 400. `tokenSeparators={[',']}` can produce
      // one from a pasted "foo,,bar", so a trimmed-blank word here is a blank
      // in disguise the same way an empty Input is — reject it client-side
      // rather than letting it reach the API as a generic failure.
      if (words.some((word) => word.trim().length === 0)) {
        return Promise.reject(new Error('Words cannot be blank'))
      }
      return Promise.resolve()
    },
  },
]

export const TIMEOUT_RULES: FormRule[] = [
  {
    required: true,
    type: 'number',
    min: 1000,
    max: 60000,
    message: 'Request timeout is required and must be 1,000-60,000 ms',
  },
]

export const DELAY_RULES: FormRule[] = [
  {
    required: true,
    type: 'number',
    min: 0,
    max: 10000,
    message: 'Delay is required and must be 0-10,000 ms',
  },
]

export const MAX_ITEMS_RULES: FormRule[] = [
  {
    required: true,
    type: 'number',
    min: 1,
    max: 500,
    message: 'Max items per run is required and must be 1-500',
  },
]

export type SourceFormValues = SourceInput

/** The editable subset of a source, in the shape the form holds. */
export function toFormValues(source: Source): SourceFormValues {
  return {
    name: source.name,
    listingUrl: source.listingUrl,
    enabled: source.enabled,
    itemSelector: source.itemSelector,
    titleSelector: source.titleSelector,
    titleAttr: source.titleAttr,
    detailUrlSelector: source.detailUrlSelector,
    detailUrlAttr: source.detailUrlAttr,
    descriptionSelector: source.descriptionSelector,
    descriptionAttr: source.descriptionAttr,
    companySelector: source.companySelector,
    companyAttr: source.companyAttr,
    postedAtSelector: source.postedAtSelector,
    postedAtAttr: source.postedAtAttr,
    blockedTitleWords: source.blockedTitleWords,
    blockedDescriptionWords: source.blockedDescriptionWords,
    requestTimeoutMs: source.requestTimeoutMs,
    detailDelayMs: source.detailDelayMs,
    maxItemsPerRun: source.maxItemsPerRun,
  }
}

/** The API's own defaults, so a created source matches what POST would apply. */
export const CREATE_DEFAULTS: SourceFormValues = {
  name: '',
  listingUrl: '',
  enabled: true,
  itemSelector: '',
  titleSelector: '',
  titleAttr: null,
  detailUrlSelector: '',
  detailUrlAttr: 'href',
  descriptionSelector: '',
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
}

/**
 * An empty Input yields '' , which fails the API's `/\S/` pattern with a 400.
 * `null` is the documented way to say "this board has no company selector".
 */
export function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** Normalizes raw form state into exactly what the API accepts. */
export function toInput(values: SourceFormValues): SourceInput {
  return {
    ...values,
    name: values.name.trim(),
    listingUrl: values.listingUrl.trim(),
    itemSelector: values.itemSelector.trim(),
    titleSelector: values.titleSelector.trim(),
    titleAttr: blankToNull(values.titleAttr),
    detailUrlSelector: values.detailUrlSelector.trim(),
    detailUrlAttr: values.detailUrlAttr.trim(),
    descriptionSelector: values.descriptionSelector.trim(),
    descriptionAttr: blankToNull(values.descriptionAttr),
    companySelector: blankToNull(values.companySelector),
    companyAttr: blankToNull(values.companyAttr),
    postedAtSelector: blankToNull(values.postedAtSelector),
    postedAtAttr: blankToNull(values.postedAtAttr),
    // The API service trims and lowercases these before storing them; the
    // frontend deliberately does neither here, unlike the selector/attr
    // fields above — sending the words back as typed lets the API's own
    // normalization stay the one source of truth for how a word compares.
    blockedTitleWords: values.blockedTitleWords ?? [],
    blockedDescriptionWords: values.blockedDescriptionWords ?? [],
  }
}

/** Value equality for the three shapes a SourceInput field can hold. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index])
  }
  return a === b
}

/**
 * Only the changed keys, which is what PATCH means.
 *
 * This matters concretely: the ingestion service writes lastRunAt and
 * lastError to the same row, and a scheduled run can land between opening the
 * modal and saving it. Sending all 19 fields would be a last-write-wins
 * overwrite of everything, including fields the user never looked at.
 */
export function diffInput(
  before: SourceInput,
  after: SourceInput,
): Partial<SourceInput> {
  const patch: Partial<SourceInput> = {}
  for (const key of Object.keys(after) as (keyof SourceInput)[]) {
    if (!sameValue(before[key], after[key])) {
      // Each key is assigned from the same key of a value of the same type;
      // TS cannot follow that through a dynamic key, hence the assertion.
      patch[key] = after[key] as never
    }
  }
  return patch
}
