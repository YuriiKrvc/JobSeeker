import {
  DeleteOutlined,
  EditOutlined,
  PlayCircleOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import {
  App,
  Alert,
  Button,
  Empty,
  Flex,
  Popconfirm,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RunSummary, Source } from '../services/sources'
import {
  deleteSource,
  listSources,
  runSource,
  updateSource,
} from '../services/sources'
import SourceFormModal from '../components/SourceFormModal'

/** A copy of `current` without `id`. Module scope so it is not a hook dependency. */
const without = (current: Set<string>, id: string) => {
  const next = new Set(current)
  next.delete(id)
  return next
}

/** A run with nothing the user needs to know about beyond the counts. */
const isRunClean = (summary: RunSummary) =>
  !summary.truncated && summary.errors.length === 0

/**
 * One finished run as one line. `blocked` is omitted when zero because most
 * runs block nothing and the line reads better without it; `created` and
 * `updated` always appear, so "0 new, 0 unchanged" still says the run happened.
 */
const describeRun = (name: string, summary: RunSummary): string => {
  const counts = [`${summary.created} new`, `${summary.updated} unchanged`]
  if (summary.blocked > 0) counts.push(`${summary.blocked} blocked`)

  const notes: string[] = []
  if (summary.truncated) notes.push('truncated')
  if (summary.errors.length === 1) notes.push('1 item failed')
  else if (summary.errors.length > 1) {
    notes.push(`${summary.errors.length} items failed`)
  }

  const suffix = notes.length > 0 ? ` (${notes.join(', ')})` : ''
  return `${name}: ${counts.join(', ')}${suffix}`
}

const buildColumns = (
  onRun: (source: Source) => void,
  onEdit: (source: Source) => void,
  onToggle: (source: Source, enabled: boolean) => void,
  onDelete: (source: Source) => void,
  pending: Set<string>,
  running: Set<string>,
): TableProps<Source>['columns'] => [
  {
    title: 'Name',
    dataIndex: 'name',
    key: 'name',
  },
  {
    title: 'Listing URL',
    dataIndex: 'listingUrl',
    key: 'listingUrl',
    ellipsis: true,
    render: (url: string) => (
      <Typography.Link href={url} target="_blank" rel="noreferrer">
        {url}
      </Typography.Link>
    ),
  },
  {
    title: 'Enabled',
    dataIndex: 'enabled',
    key: 'enabled',
    width: 110,
    render: (enabled: boolean, source) => (
      <Switch
        checked={enabled}
        loading={pending.has(source.id)}
        onChange={(checked) => onToggle(source, checked)}
      />
    ),
  },
  {
    title: 'Last run',
    dataIndex: 'lastRunAt',
    key: 'lastRunAt',
    width: 200,
    render: (lastRunAt: string | null) =>
      lastRunAt ? new Date(lastRunAt).toLocaleString() : '—',
  },
  {
    title: 'Status',
    key: 'status',
    width: 150,
    render: (_, source) => {
      if (source.lastError) {
        return (
          <Tooltip title={source.lastError}>
            <Tag color="error">Failed</Tag>
          </Tooltip>
        )
      }
      if (source.lastSuccessAt) return <Tag color="success">OK</Tag>
      return <Tag>Never run</Tag>
    },
  },
  {
    // Icon-only, so every button carries both a tooltip for the mouse and an
    // aria-label for anything that cannot see one.
    title: 'Actions',
    key: 'actions',
    width: 120,
    render: (_, source) => (
      <Flex gap={4}>
        <Tooltip title="Run now">
          <Button
            type="text"
            aria-label="Run now"
            icon={<PlayCircleOutlined />}
            loading={running.has(source.id)}
            disabled={pending.has(source.id)}
            onClick={() => onRun(source)}
          />
        </Tooltip>
        <Tooltip title="Edit">
          <Button
            type="text"
            aria-label="Edit"
            icon={<EditOutlined />}
            disabled={pending.has(source.id)}
            onClick={() => onEdit(source)}
          />
        </Tooltip>
        <Popconfirm
          title="Delete this source?"
          description="Its postings stop appearing. This cannot be undone."
          okText="Delete"
          okButtonProps={{ danger: true }}
          onConfirm={() => onDelete(source)}
        >
          <Tooltip title="Delete">
            <Button
              type="text"
              danger
              aria-label="Delete"
              icon={<DeleteOutlined />}
              disabled={pending.has(source.id)}
            />
          </Tooltip>
        </Popconfirm>
      </Flex>
    ),
  },
]

const SourcesPage = () => {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Source | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const openCreate = () => {
    setEditing(null)
    setModalOpen(true)
  }

  const openEdit = useCallback((source: Source) => {
    setEditing(source)
    setModalOpen(true)
  }, [])

  // Each row-level mutation (toggle, delete) awaits its own `load()`
  // afterwards. Two mutations fired close together therefore have two
  // `load()` calls in flight at once, and their GETs can resolve in either
  // order — if the older one resolves last, it would overwrite the newer
  // one's result and briefly show stale state. `requestId` tags each call so
  // only the most recently *started* call is allowed to apply its result.
  const requestIdRef = useRef(0)

  // `load` is self-contained: it resets loading/error itself so it is safe
  // to call from anywhere (the mount effect, the Retry button, and later a
  // post-mutation reload) without the caller having to remember to reset
  // first.
  const load = useCallback(async () => {
    const id = ++requestIdRef.current
    setLoading(true)
    setError(null)
    try {
      const data = await listSources()
      if (id === requestIdRef.current) setSources(data)
    } catch (caught) {
      // An ApiError carries the API's own message; anything else is a network
      // or programming fault and its message is the best we have.
      if (id === requestIdRef.current) {
        setError(
          caught instanceof Error ? caught.message : 'Could not load sources',
        )
      }
    } finally {
      if (id === requestIdRef.current) setLoading(false)
    }
  }, [])

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

  const { message } = App.useApp()
  /** Ids with a row-level request in flight, so only that row shows a spinner. */
  const [pending, setPending] = useState<Set<string>>(new Set())
  // `pending` disables a row's buttons whichever request is running, so it
  // cannot drive the Run spinner — a toggle would spin the Run button too.
  // This tracks only runs.
  const [running, setRunning] = useState<Set<string>>(new Set())

  const withPending = useCallback(
    async (id: string, action: () => Promise<unknown>) => {
      setPending((current) => new Set(current).add(id))
      try {
        await action()
        await load()
      } catch (caught) {
        message.error(
          caught instanceof Error ? caught.message : 'The request failed',
        )
      } finally {
        setPending((current) => without(current, id))
      }
    },
    [load, message],
  )

  const toggle = useCallback(
    (source: Source, enabled: boolean) =>
      void withPending(source.id, () => updateSource(source.id, { enabled })),
    [withPending],
  )

  // A run holds the connection for `maxItemsPerRun x detailDelayMs` — minutes,
  // not seconds — so the row stays spinning that whole time. A disabled source
  // is left clickable: the API's 409 arrives as "Source is disabled" through
  // `withPending`'s error path, which is the message we would have written
  // anyway.
  const run = useCallback(
    (source: Source) =>
      void withPending(source.id, async () => {
        setRunning((current) => new Set(current).add(source.id))
        try {
          const summary = await runSource(source.id)
          const text = describeRun(source.name, summary)
          if (isRunClean(summary)) message.success(text)
          else message.warning(text)
        } finally {
          setRunning((current) => without(current, source.id))
        }
      }),
    [withPending, message],
  )

  const remove = useCallback(
    (source: Source) =>
      void withPending(source.id, async () => {
        await deleteSource(source.id)
        message.success(`Deleted ${source.name}`)
      }),
    [withPending, message],
  )

  // `run`, `toggle` and `remove` never read `requestIdRef` themselves — it's `load`,
  // several closures downstream, that does — but `react-hooks/refs` walks the
  // whole call graph and flags any function reachable from a ref read being
  // passed to something invoked during render (this `useMemo` factory).
  // `buildColumns` only stores these as event-handler closures (Button
  // `onClick`, Switch `onChange`, Popconfirm `onConfirm`) and never calls them
  // synchronously
  // while building the column list, so the ref is never actually touched
  // during render; the rule can't see that, so it's disabled per-line here
  // rather than restructured.
  const columns = useMemo(
    // eslint-disable-next-line react-hooks/refs
    () => buildColumns(run, openEdit, toggle, remove, pending, running),
    [run, openEdit, toggle, remove, pending, running],
  )

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Sources
        </Typography.Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add source
        </Button>
      </Flex>
      {error ? (
        <Alert
          type="error"
          showIcon
          title="Could not load sources"
          description={error}
          action={
            <Button size="small" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      ) : (
        <Table<Source>
          rowKey="id"
          columns={columns}
          dataSource={sources}
          loading={loading}
          pagination={false}
          locale={{
            emptyText: <Empty description="No sources configured yet" />,
          }}
        />
      )}
      <SourceFormModal
        open={modalOpen}
        source={editing}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />
    </>
  )
}

export default SourcesPage
