import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildApp } from '../src/app.js'
import { bodySchema, jsonSchema } from '../src/openapi.js'

const app = buildApp()

afterAll(async () => {
  await app.close()
})

describe('buildApp', () => {
  it('serves without binding a port', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' })
    expect(response.statusCode).toBe(404)
  })
})

describe('openapi document', () => {
  it('documents routes registered after the swagger plugin', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' })
    expect(response.statusCode).toBe(200)

    // Asserted as one shape rather than by indexing: `json()` is `any` without
    // a type argument, which the type-aware lint rules reject, and
    // `noUncheckedIndexedAccess` makes every step of a deep path optional.
    // The `status` schema came from the Zod literal via z.toJSONSchema — note
    // @fastify/swagger rewrites its `const` into an equivalent single-value
    // `enum` on the way into the document.
    expect(response.json<unknown>()).toMatchObject({
      openapi: '3.1.0',
      paths: {
        '/health': {
          get: {
            responses: {
              200: {
                content: {
                  'application/json': {
                    schema: {
                      properties: { status: { type: 'string', enum: ['ok'] } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })
  })
})

describe('openapi security', () => {
  it('declares X-User-Id as an apiKey scheme', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' })
    expect(response.json<unknown>()).toMatchObject({
      components: {
        securitySchemes: {
          userId: { type: 'apiKey', in: 'header', name: 'X-User-Id' },
        },
      },
    })
  })

  it('no longer describes itself as single user', async () => {
    const response = await app.inject({ method: 'GET', url: '/docs/json' })
    const doc = response.json<{ info: { description: string } }>()
    expect(doc.info.description).not.toContain('Single user')
  })

  it('documents the ingest and postings paths with their security requirement', () => {
    const document = app.swagger() as {
      paths: Record<string, Record<string, { security?: unknown }>>
    }
    for (const path of ['/sources/{id}/ingest', '/ingest']) {
      expect(document.paths[path]?.post?.security).toEqual([{ userId: [] }])
    }
    expect(document.paths['/postings']?.get?.security).toEqual([{ userId: [] }])
  })

  it('publishes the response shapes declared on /postings and the ingest 409', () => {
    const document = app.swagger() as {
      paths: Record<
        string,
        Record<string, { responses?: Record<string, unknown> }>
      >
    }
    expect(
      Object.keys(document.paths['/postings']?.get?.responses ?? {}).sort(),
    ).toEqual(['200', '400', '404'])
    expect(
      document.paths['/sources/{id}/ingest']?.post?.responses,
    ).toHaveProperty('409')
  })
})

describe('jsonSchema / bodySchema io modes', () => {
  const withDefault = z.object({
    name: z.string(),
    enabled: z.boolean().default(true),
  })

  it('jsonSchema (output, the response default) requires a defaulted field', () => {
    const schema = jsonSchema(withDefault) as { required?: string[] }
    expect(schema.required).toContain('enabled')
  })

  it('bodySchema (input) leaves a defaulted field out of required', () => {
    const schema = bodySchema(withDefault) as { required?: string[] }
    expect(schema.required).not.toContain('enabled')
  })
})
