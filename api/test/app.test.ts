import { afterAll, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.js'

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
