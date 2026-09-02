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
  const [total, setTotal] = useState(0)
  // How many rows the next request should skip. Advanced by the number of
  // items actually returned, not by PAGE_SIZE, so a short page cannot leave a
  // gap.
  const [offset, setOffset] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)

  // Retry can be pressed while a load is already in flight, so two GETs can be
  // outstanding at once and can resolve in either order. `requestId` tags each
  // call so only the most recently *started* one may apply its result.
  const requestIdRef = useRef(0)

  const load = useCallback(
    async (nextOffset: number, { append = false }: { append?: boolean } = {}) => {
      const id = ++requestIdRef.current
      // A failed "Load more" must not blank the rows already on screen, so
      // appending drives its own button spinner and never touches `loading`.
      if (append) setLoadingMore(true)
      else setLoading(true)
      setError(null)
      try {
        const data = await listPostings({
          sourceId,
          limit: PAGE_SIZE,
          offset: nextOffset,
        })
        if (id !== requestIdRef.current) return
        setTotal(data.total)
        setOffset(nextOffset + data.items.length)
        setPostings((current) => {
          if (!append) return data.items
          // Ingestion runs every 30 minutes and inserts at the top of
          // `first_seen_at DESC`, so rows shift down between one request and
          // the next and an offset window can re-serve rows already on
          // screen. Without this, a background run makes duplicate rows
          // appear mid-list. The converse — a shift large enough to skip a
          // row entirely — is not fixable with offset paging; it needs cursor
          // paging, and it is not worth an API change for a 30-minute
          // schedule.
          const seen = new Set(current.map((posting) => posting.id))
          return [
            ...current,
            ...data.items.filter((posting) => !seen.has(posting.id)),
          ]
        })
      } catch (caught) {
        if (id === requestIdRef.current) {
          setError(
            caught instanceof Error
              ? caught.message
              : 'Could not load postings',
          )
        }
      } finally {
        if (id === requestIdRef.current) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [sourceId],
  )

  // `load` resets loading/error before awaiting. On mount both are already at
  // those values, so React bails out of the re-render and nothing cascades —
  // which is the harm `set-state-in-effect` exists to prevent. The rule flags
  // any effect calling a function that mentions setState anywhere, so it
  // cannot see that. Disabled here rather than restructured: ESLint 9 reports
  // unused disable directives, so this line disappears on its own if the rule
  // ever learns to tell the difference.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(0)
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
          style={{ marginBottom: 16 }}
          action={
            <Button size="small" onClick={() => void load(0)}>
              Retry
            </Button>
          }
        />
      ) : null}
      {/* The table stays mounted through an error so a failed "Load more"
          cannot blank the rows already on screen — the Alert above reports
          the failure instead. The one case it is hidden is a first load that
          failed outright: with no rows, the table's empty text would claim
          "No postings yet", which is a different and false statement. */}
      {error && postings.length === 0 ? null : (
        <>
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
          {postings.length < total ? (
            <Flex justify="center" style={{ marginTop: 16 }}>
              <Button
                loading={loadingMore}
                onClick={() => void load(offset, { append: true })}
              >
                Load more
              </Button>
            </Flex>
          ) : null}
        </>
      )}
    </>
  )
}

export default PostingsPage
