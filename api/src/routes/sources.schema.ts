import { z } from 'zod'

/**
 * Zod is the single source of truth for both validation and the OpenAPI
 * document. Two rules follow from that and must not be broken:
 *
 * 1. **No transforms.** `z.toJSONSchema` throws on them. Trimming and
 *    lowercasing happen in the service instead.
 * 2. **Request bodies convert with `io: 'input'`.** Under the default
 *    `io: 'output'` every defaulted field is emitted as `required`, and Ajv
 *    would then reject bodies that Zod accepts.
 */

// `\S` requires at least one non-whitespace character: `min(1)` alone lets
// a whitespace-only string through, which is a blank in disguise. A regex
// converts to `pattern` in the published JSON Schema, unlike `.refine()`
// (invisible to `z.toJSONSchema`) or `.trim()` (a transform the converter
// throws on). Selectors and `name` are identity- and behavior-critical, so a
// blank is rejected rather than silently repaired.
const selector = z.string().regex(/\S/).min(1).max(500)
const attr = z.string().regex(/\S/).min(1).max(100)
const word = z.string().min(1).max(100)

/**
 * Bare field definitions, with no `.default()`. `SourceUpdateSchema` is built
 * from these directly (via `.partial()`) rather than from
 * `SourceCreateSchema.partial()`: Zod resolves a defaulted field's default
 * value even when the key is entirely absent from the input, regardless of
 * an outer `.optional()`/`.partial()` wrapping. Partial-ing the defaulted
 * create schema would therefore fill in every omitted field on an update
 * instead of leaving it absent. `SourceCreateSchema` re-adds `.default()` on
 * top of these same field schemas.
 */
const fields = {
  name: z
    .string()
    .regex(/\S/)
    .min(1)
    .max(200)
    .describe('Display label. Unique among your live sources.'),
  listingUrl: z
    .url({ protocol: /^https?$/ })
    .max(2000)
    .describe(
      'Page listing the vacancies. Must be http or https — the published schema only says "uri".',
    ),
  enabled: z.boolean(),

  itemSelector: selector.describe(
    'Matches once per vacancy on the listing page.',
  ),
  titleSelector: selector.describe('Relative to an item.'),
  titleAttr: attr.nullable().describe('Null takes the element text.'),
  detailUrlSelector: selector,
  detailUrlAttr: attr,

  descriptionSelector: selector.describe('On the detail page.'),
  descriptionAttr: attr.nullable(),
  companySelector: selector.nullable(),
  companyAttr: attr.nullable(),
  postedAtSelector: selector.nullable(),
  postedAtAttr: attr.nullable(),

  blockedTitleWords: z
    .array(word)
    .max(500)
    .describe('Whole-word, case-insensitive. Stored lowercased and trimmed.'),
  blockedDescriptionWords: z.array(word).max(500),

  requestTimeoutMs: z.number().int().min(1000).max(60000),
  detailDelayMs: z.number().int().min(0).max(10000),
  maxItemsPerRun: z.number().int().min(1).max(500),
}

export const SourceCreateSchema = z
  .object({
    ...fields,
    enabled: fields.enabled.default(true),
    titleAttr: fields.titleAttr.default(null),
    detailUrlAttr: fields.detailUrlAttr.default('href'),
    descriptionAttr: fields.descriptionAttr.default(null),
    companySelector: fields.companySelector.default(null),
    companyAttr: fields.companyAttr.default(null),
    postedAtSelector: fields.postedAtSelector.default(null),
    postedAtAttr: fields.postedAtAttr.default(null),
    blockedTitleWords: fields.blockedTitleWords.default([]),
    blockedDescriptionWords: fields.blockedDescriptionWords.default([]),
    requestTimeoutMs: fields.requestTimeoutMs.default(10000),
    detailDelayMs: fields.detailDelayMs.default(1000),
    maxItemsPerRun: fields.maxItemsPerRun.default(100),
  })
  // An unknown key is a typo or a client sending `userId` — both should fail
  // loudly rather than be dropped.
  .strict()

export type SourceCreate = z.infer<typeof SourceCreateSchema>

/**
 * The unrefined partial that `SourceUpdateSchema` adds its "at least one key"
 * rule on top of. Exists so the OpenAPI document has something to publish for
 * PATCH: `z.toJSONSchema` throws on a `.refine()`, and publishing
 * `SourceCreateSchema.partial()` would document `default:` annotations for
 * fields a PATCH never defaults. The handler still parses with
 * `SourceUpdateSchema`, not this.
 */
export const SourceUpdateBaseSchema = z.object(fields).partial().strict()

export const SourceUpdateSchema = SourceUpdateBaseSchema.refine(
  (patch) => Object.keys(patch).length > 0,
  { message: 'Provide at least one field to update' },
)

export type SourceUpdate = z.infer<typeof SourceUpdateSchema>

/**
 * The wire shape of a source. `userId` is absent on purpose: every source a
 * caller can see is already theirs, so returning it says nothing. Declaring
 * this as a route's response schema also makes fast-json-stringify strip
 * anything not listed, which is what stops an owner id leaking by accident.
 */
export const SourceResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  listingUrl: z.string(),
  enabled: z.boolean(),

  itemSelector: z.string(),
  titleSelector: z.string(),
  titleAttr: z.string().nullable(),
  detailUrlSelector: z.string(),
  detailUrlAttr: z.string(),

  descriptionSelector: z.string(),
  descriptionAttr: z.string().nullable(),
  companySelector: z.string().nullable(),
  companyAttr: z.string().nullable(),
  postedAtSelector: z.string().nullable(),
  postedAtAttr: z.string().nullable(),

  blockedTitleWords: z.array(z.string()),
  blockedDescriptionWords: z.array(z.string()),

  requestTimeoutMs: z.number().int(),
  detailDelayMs: z.number().int(),
  maxItemsPerRun: z.number().int(),

  lastRunAt: z.iso.datetime().nullable(),
  lastSuccessAt: z.iso.datetime().nullable(),
  lastError: z.string().nullable(),

  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
})

export type SourceResponse = z.infer<typeof SourceResponseSchema>

export const SourceListResponseSchema = z.object({
  sources: z.array(SourceResponseSchema),
})
