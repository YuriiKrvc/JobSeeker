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
