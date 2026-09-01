import { z } from 'zod'

/** Above this, `limit` is clamped rather than rejected. */
export const MAX_LIMIT = 200

/**
 * Query strings arrive as strings. Fastify's Ajv has `coerceTypes` on, so the
 * published schema below both documents the parameters and turns "50" into 50
 * and "true" into true before a handler runs.
 */
const queryShape = {
  sourceId: z
    .uuid()
    .optional()
    .describe('Only postings from this source of yours'),
  includeBlocked: z
    .boolean()
    .default(false)
    .describe('Include postings a blocklist word matched'),
  limit: z
    .number()
    .int()
    .min(1)
    .default(50)
    .describe(`1-${MAX_LIMIT}; a larger value is clamped to ${MAX_LIMIT}`),
  offset: z.number().int().min(0).default(0),
}

/**
 * What Ajv validates and `/docs` publishes. No maximum is imposed at
 * `MAX_LIMIT` — a value above 200 is clamped, not rejected. Zod's implicit
 * safe-integer bound on `z.number().int()` still applies underneath (Ajv sees
 * `maximum: 9007199254740991` from it), so an absurd value like 2^60 is
 * rejected outright rather than clamped.
 */
export const PostingsQueryPublishedSchema = z.object(queryShape)

/**
 * The handler's schema. Same shape plus the clamp, kept out of the published
 * one because `z.toJSONSchema` cannot represent a transform.
 */
export const PostingsQuerySchema = z
  .object(queryShape)
  .transform((query) => ({
    ...query,
    limit: Math.min(query.limit, MAX_LIMIT),
  }))

export type PostingsQuery = z.infer<typeof PostingsQuerySchema>

export const PostingResponseSchema = z.object({
  id: z.uuid(),
  sourceId: z.uuid(),
  url: z.string().describe('Absolutized detail URL; the identity of a posting'),
  title: z.string(),
  company: z.string().nullable(),
  description: z.string().describe('Empty for a title-blocked posting, which was never fetched'),
  postedAtRaw: z
    .string()
    .nullable()
    .describe('As scraped, e.g. "3 days ago" — kept so a parse misfire stays visible'),
  postedAt: z
    .string()
    .nullable()
    .describe('Null when postedAtRaw was not a parseable date'),
  blockedBy: z
    .string()
    .nullable()
    .describe('Null means visible; otherwise the blocklist word that matched'),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
})

export const PostingListResponseSchema = z.object({
  items: z.array(PostingResponseSchema),
  total: z
    .number()
    .int()
    .nonnegative()
    .describe('Matching the filters, ignoring limit and offset'),
})

export type PostingResponse = z.infer<typeof PostingResponseSchema>
