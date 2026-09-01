import { describe, expect, it, vi } from 'vitest'
import { fetchDetail, listItems } from '../src/adapters/html-source.adapter.js'
import { sourceRow } from './fixtures.js'

const oneOf = (html: string) => vi.fn(() => Promise.resolve(html))

describe('listItems', () => {
  it('reads a title and an absolutized detail url from each item', async () => {
    const fetch = oneOf(`
      <div class="job"><span class="title"> Senior Dev </span><a class="link" href="/jobs/1">go</a></div>
      <div class="job"><span class="title">Junior Dev</span><a class="link" href="https://other.test/2">go</a></div>
    `)
    const result = await listItems(sourceRow(), fetch)
    expect(result.errors).toEqual([])
    expect(result.items).toEqual([
      { title: 'Senior Dev', detailUrl: 'https://example.com/jobs/1' },
      { title: 'Junior Dev', detailUrl: 'https://other.test/2' },
    ])
  })

  it('fetches the listing url with the source timeout', async () => {
    const fetch = oneOf('')
    await listItems(sourceRow({ requestTimeoutMs: 250 }), fetch)
    expect(fetch).toHaveBeenCalledWith('https://example.com/jobs/', 250)
  })

  it('keeps the query string, which can carry the job id', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title">Dev</span><a class="link" href="/view?id=99&src=rss">go</a></div>',
    )
    const { items } = await listItems(sourceRow(), fetch)
    expect(items[0]?.detailUrl).toBe('https://example.com/view?id=99&src=rss')
  })

  it('reads a title from an attribute when titleAttr is set', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title" data-name="From Attr">ignored</span><a class="link" href="/1">go</a></div>',
    )
    const { items } = await listItems(
      sourceRow({ titleAttr: 'data-name' }),
      fetch,
    )
    expect(items[0]?.title).toBe('From Attr')
  })

  it('matches a selector against the item element itself, not only its children', async () => {
    const fetch = oneOf(
      '<a class="job link" href="/1"><span class="title">Dev</span></a>',
    )
    const { items } = await listItems(
      sourceRow({ itemSelector: 'a.job', detailUrlSelector: 'a.job' }),
      fetch,
    )
    expect(items).toEqual([
      { title: 'Dev', detailUrl: 'https://example.com/1' },
    ])
  })

  it('treats an empty listing as a run with no items, not an error', async () => {
    const { items, errors } = await listItems(sourceRow(), oneOf('<main></main>'))
    expect(items).toEqual([])
    expect(errors).toEqual([])
  })

  it('reports an item with no title instead of dropping it silently', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title">   </span><a class="link" href="/1">go</a></div>',
    )
    const { items, errors } = await listItems(sourceRow(), fetch)
    expect(items).toEqual([])
    expect(errors).toEqual([
      { url: 'https://example.com/jobs/', message: 'item 1: empty title' },
    ])
  })

  it('reports an item whose detail url selector matches nothing', async () => {
    const fetch = oneOf('<div class="job"><span class="title">Dev</span></div>')
    const { items, errors } = await listItems(sourceRow(), fetch)
    expect(items).toEqual([])
    expect(errors[0]?.message).toBe('item 1: no detail url')
  })

  it('rejects a non-http scheme', async () => {
    const fetch = oneOf(
      '<div class="job"><span class="title">Dev</span><a class="link" href="javascript:alert(1)">go</a></div>',
    )
    const { items, errors } = await listItems(sourceRow(), fetch)
    expect(items).toEqual([])
    expect(errors[0]?.message).toContain('not http')
  })

  it('lets a listing fetch failure escape, for the service to record', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('HTTP 503')))
    await expect(listItems(sourceRow(), fetch)).rejects.toThrow('HTTP 503')
  })
})

describe('fetchDetail', () => {
  const page = `
    <div id="description"> We need a <b>dev</b>. </div>
    <span class="company">ACME</span>
    <time class="posted" datetime="2026-08-30T00:00:00Z">3 days ago</time>
  `

  it('reads the description from the detail page', async () => {
    const fetch = vi.fn(() => Promise.resolve(page))
    const detail = await fetchDetail(
      sourceRow(),
      'https://example.com/jobs/1',
      fetch,
    )
    expect(detail.description).toBe('We need a dev.')
    expect(fetch).toHaveBeenCalledWith('https://example.com/jobs/1', 10000)
  })

  it('leaves the optional fields null when no selector is configured', async () => {
    const detail = await fetchDetail(
      sourceRow(),
      'https://example.com/jobs/1',
      vi.fn(() => Promise.resolve(page)),
    )
    expect(detail.company).toBeNull()
    expect(detail.postedAtRaw).toBeNull()
  })

  it('reads the optional fields when selectors are configured', async () => {
    const detail = await fetchDetail(
      sourceRow({
        companySelector: '.company',
        postedAtSelector: 'time.posted',
        postedAtAttr: 'datetime',
      }),
      'https://example.com/jobs/1',
      vi.fn(() => Promise.resolve(page)),
    )
    expect(detail.company).toBe('ACME')
    expect(detail.postedAtRaw).toBe('2026-08-30T00:00:00Z')
  })

  it('leaves an optional field null when its selector matches nothing', async () => {
    const detail = await fetchDetail(
      sourceRow({ companySelector: '.nope' }),
      'https://example.com/jobs/1',
      vi.fn(() => Promise.resolve(page)),
    )
    expect(detail.company).toBeNull()
  })

  it('throws when the description selector matches nothing', async () => {
    await expect(
      fetchDetail(
        sourceRow(),
        'https://example.com/jobs/1',
        vi.fn(() => Promise.resolve('<main>no description here</main>')),
      ),
    ).rejects.toThrow('description selector matched nothing')
  })
})
