import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  SourceCreateSchema,
  SourceUpdateSchema,
} from '../src/routes/sources.schema.js'

const minimal = {
  name: 'Example Board',
  listingUrl: 'https://example.com/jobs',
  itemSelector: '.job',
  titleSelector: '.job-title',
  detailUrlSelector: 'a.job-link',
  descriptionSelector: '#description',
}

describe('SourceCreateSchema', () => {
  it('applies defaults to everything optional', () => {
    const parsed = SourceCreateSchema.parse(minimal)
    expect(parsed.enabled).toBe(true)
    expect(parsed.detailUrlAttr).toBe('href')
    expect(parsed.titleAttr).toBeNull()
    expect(parsed.blockedTitleWords).toEqual([])
    expect(parsed.blockedDescriptionWords).toEqual([])
    expect(parsed.requestTimeoutMs).toBe(10000)
    expect(parsed.detailDelayMs).toBe(1000)
    expect(parsed.maxItemsPerRun).toBe(100)
  })

  it('rejects a non-http url', () => {
    expect(
      SourceCreateSchema.safeParse({ ...minimal, listingUrl: 'ftp://x.com' })
        .success,
    ).toBe(false)
  })

  it('rejects an empty required selector', () => {
    expect(
      SourceCreateSchema.safeParse({ ...minimal, itemSelector: '' }).success,
    ).toBe(false)
  })

  it('rejects an out-of-range politeness value', () => {
    expect(
      SourceCreateSchema.safeParse({ ...minimal, detailDelayMs: 999999 })
        .success,
    ).toBe(false)
  })

  it('rejects unknown keys, so a typo is not silently dropped', () => {
    expect(
      SourceCreateSchema.safeParse({ ...minimal, userId: 'x' }).success,
    ).toBe(false)
  })
})

describe('SourceUpdateSchema', () => {
  it('accepts a single field', () => {
    expect(SourceUpdateSchema.parse({ enabled: false })).toEqual({
      enabled: false,
    })
  })

  it('leaves omitted keys absent rather than defaulting them', () => {
    expect(Object.keys(SourceUpdateSchema.parse({ enabled: false }))).toEqual([
      'enabled',
    ])
  })

  it('accepts an explicit null to clear an optional selector', () => {
    expect(SourceUpdateSchema.parse({ companySelector: null })).toEqual({
      companySelector: null,
    })
  })

  it('rejects null on a required field', () => {
    expect(SourceUpdateSchema.safeParse({ name: null }).success).toBe(false)
  })

  it('rejects an empty body', () => {
    expect(SourceUpdateSchema.safeParse({}).success).toBe(false)
  })
})

describe('json schema conversion', () => {
  // The whole Ajv-documents/Zod-validates arrangement rests on this call not
  // throwing. It throws on transforms, which is why there are none.
  it('converts for request bodies without marking defaults required', () => {
    const json = z.toJSONSchema(SourceCreateSchema, {
      target: 'draft-7',
      io: 'input',
    })
    expect(json.required).toEqual([
      'name',
      'listingUrl',
      'itemSelector',
      'titleSelector',
      'detailUrlSelector',
      'descriptionSelector',
    ])
  })
})
