import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchText } from '../src/adapters/fetch-text.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchText', () => {
  it('returns the body of a 200 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>hi</html>'))),
    )
    await expect(fetchText('https://example.com', 1000)).resolves.toBe(
      '<html>hi</html>',
    )
  })

  it('throws with the status in the message on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('nope', { status: 503 }))),
    )
    await expect(fetchText('https://example.com/x', 1000)).rejects.toThrow(
      'HTTP 503',
    )
  })

  it('passes a timeout signal and a User-Agent', async () => {
    const spy = vi.fn(() => Promise.resolve(new Response('ok')))
    vi.stubGlobal('fetch', spy)
    await fetchText('https://example.com', 250)
    const init = ((spy.mock.calls as unknown[][])[0])?.[1] as RequestInit | undefined
    expect(init?.signal).toBeInstanceOf(AbortSignal)
    expect(
      (init?.headers as Record<string, string> | undefined)?.['user-agent'],
    ).toContain('JobSeeker')
  })

  it('reports a timeout as a readable message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.reject(new DOMException('aborted', 'TimeoutError')),
      ),
    )
    await expect(fetchText('https://example.com', 5)).rejects.toThrow(
      'timed out after 5ms',
    )
  })
})
