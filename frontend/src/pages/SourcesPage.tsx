import { PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Flex, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import type { Source } from '../api/sources'
import { listSources } from '../api/sources'
import SourceFormModal from '../components/SourceFormModal'

const columns: TableProps<Source>['columns'] = [
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
    render: (enabled: boolean) => (
      <Tag color={enabled ? 'green' : 'default'}>
        {enabled ? 'Enabled' : 'Disabled'}
      </Tag>
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
]

const SourcesPage = () => {
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  // `load` is self-contained: it resets loading/error itself so it is safe
  // to call from anywhere (the mount effect, the Retry button, and later a
  // post-mutation reload) without the caller having to remember to reset
  // first.
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSources(await listSources())
    } catch (caught) {
      // An ApiError carries the API's own message; anything else is a network
      // or programming fault and its message is the best we have.
      setError(caught instanceof Error ? caught.message : 'Could not load sources')
    } finally {
      setLoading(false)
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

  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 16 }}>
        <Typography.Title level={3} style={{ margin: 0 }}>
          Sources
        </Typography.Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setModalOpen(true)}
        >
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
        source={null}
        onClose={() => setModalOpen(false)}
        onSaved={() => void load()}
      />
    </>
  )
}

export default SourcesPage
