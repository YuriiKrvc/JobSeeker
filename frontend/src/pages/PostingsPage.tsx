import { Alert, Button, Empty, Flex, Select, Table, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { Posting } from '../services/postings'
import { listPostings } from '../services/postings'
import type { Source } from '../services/sources'
import { listSources } from '../services/sources'

/** How many postings one request asks for. The API's own default is the same. */
const PAGE_SIZE = 50

/**
 * `postedAt` is null whenever the scraped date did not parse. The raw string
 * (`postedAtRaw`) is not shown: the column is an absolute date by design, and
 * an unparseable date reads the same as a missing one. The raw value stays on
 * the type for whoever wants a tooltip later.
 */
const formatPostedAt = (postedAt: string | null) =>
  postedAt ? new Date(postedAt).toLocaleDateString() : '—'

/**
 * `sourceNames` maps a source id to its name. It is complete by construction,
 * not by luck: `GET /postings` joins `sources` with `deleted_at is null`
 * exactly as `GET /sources` does, so a posting can only come from a source
 * that is in the list. The `?? '—'` covers one real gap — the sources request
 * is still in flight, or it failed — and a source deleted in another tab
 * between the two requests.
 */
const buildColumns = (
  sourceNames: Map<string, string>,
): TableProps<Posting>['columns'] => [
  {
    title: 'Title',
    dataIndex: 'title',
    key: 'title',
    ellipsis: true,
    // The title is the way out of this page: the real listing, in a new tab.
    // `rel="noreferrer"` because these URLs are third-party.
    render: (title: string, posting) => (
      <Typography.Link href={posting.url} target="_blank" rel="noreferrer">
        {title}
      </Typography.Link>
    ),
  },
  {
    title: 'Company',
    dataIndex: 'company',
    key: 'company',
    width: 200,
    ellipsis: true,
    render: (company: string | null) => company ?? '—',
  },
  {
    title: 'Source',
    dataIndex: 'sourceId',
    key: 'sourceId',
    width: 180,
    ellipsis: true,
    render: (sourceId: string) => sourceNames.get(sourceId) ?? '—',
  },
  {
    title: 'Posted',
    dataIndex: 'postedAt',
    key: 'postedAt',
    width: 130,
    render: formatPostedAt,
  },
]

const PostingsPage = () => {
  const [postings, setPostings] = useState<Posting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sourceId, setSourceId] = useState<string | undefined>(undefined)
  const [sources, setSources] = useState<Source[]>([])
  const [sourcesLoading, setSourcesLoading] = useState(true)

  // Retry can be pressed while a load is already in flight, so two GETs can be
  // outstanding at once and can resolve in either order. `requestId` tags each
  // call so only the most recently *started* one may apply its result.
  const requestIdRef = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await listPostings({
        sourceId,
        limit: PAGE_SIZE,
        offset: 0,
      })
      if (id === requestIdRef.current) setPostings(data.items)
    } catch (caught) {
      // An ApiError carries the API's own message; anything else is a network
      // or programming fault and its message is the best we have.
      if (id === requestIdRef.current) {
        setError(
          caught instanceof Error ? caught.message : 'Could not load postings',
        )
      }
    } finally {
      if (id === requestIdRef.current) setLoading(false)
    }
  }, [sourceId])

  // `load` resets loading/error before awaiting. On mount both are already at
  // those values, so React bails out of the re-render and nothing cascades —
  // which is the harm `set-state-in-effect` exists to prevent. The rule flags
  // any effect calling a function that mentions setState anywhere, so it
  // cannot see that. Disabled here rather than restructured: ESLint 9 reports
  // unused disable directives, so this line disappears on its own if the rule
  // ever learns to tell the difference.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load])

  // One request serves both the filter's options and the Source column's
  // name lookup. It runs once: the sources list is not what this page is
  // about, and a stale name is a cosmetic problem where a stale feed is not.
  useEffect(() => {
    let cancelled = false
    const loadSources = async () => {
      try {
        const data = await listSources()
        if (!cancelled) setSources(data)
      } catch {
        // Swallowed on purpose. The feed is readable without source names, so
        // this failure gets no error Alert — that is reserved for the postings
        // request, whose failure leaves nothing on screen. The consequences
        // show where they matter: an empty dropdown and dashes in the Source
        // column.
        if (!cancelled) setSources([])
      } finally {
        if (!cancelled) setSourcesLoading(false)
      }
    }
    void loadSources()
    return () => {
      cancelled = true
    }
  }, [])

  const sourceNames = useMemo(
    () => new Map(sources.map((source) => [source.id, source.name])),
    [sources],
  )

  const sourceOptions = useMemo(
    () => sources.map((source) => ({ label: source.name, value: source.id })),
    [sources],
  )

  const columns = useMemo(() => buildColumns(sourceNames), [sourceNames])

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Postings
        </Typography.Title>
        <Select
          // Clearing gives `undefined`, which `listPostings` drops from the
          // query string entirely — not an empty `sourceId=`, which the API
          // would reject as a malformed uuid.
          allowClear
          loading={sourcesLoading}
          placeholder="All sources"
          options={sourceOptions}
          value={sourceId}
          onChange={setSourceId}
          style={{ width: 240 }}
        />
      </Flex>
      {error ? (
        <Alert
          type="error"
          showIcon
          title="Could not load postings"
          description={error}
          action={
            <Button size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : (
        <Table<Posting>
          rowKey="id"
          columns={columns}
          dataSource={postings}
          loading={loading}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                description={
                  // With a filter on, an undifferentiated "No postings yet"
                  // reads as "ingestion is broken". Naming the filter says
                  // which of the two it is.
                  sourceId
                    ? 'No postings from this source'
                    : 'No postings yet'
                }
              />
            ),
          }}
        />
      )}
    </>
  )
}

export default PostingsPage
