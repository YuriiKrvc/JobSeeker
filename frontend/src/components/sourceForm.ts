import type { FormRule } from 'antd'

import type { SourceInput } from '../api/sources'

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
      if (words.length > 500) return Promise.reject(new Error('At most 500 words'))
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

export type SourceFormValues = SourceInput

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
