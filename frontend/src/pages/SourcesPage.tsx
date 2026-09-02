import { Alert, Button, Empty, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import type { Source } from '../api/sources'
import { listSources } from '../api/sources'

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

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setSources(await listSources())
    } catch (caught) {
      // An ApiError carries the API's own message; anything else is a network
      // or programming fault and its message is the best we have.
      setError(
        caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : 'Could not load sources',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <>
      <Typography.Title level={3}>Sources</Typography.Title>
      {error ? (
        <Alert
          type="error"
          showIcon
          message="Could not load sources"
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
    </>
  )
}

export default SourcesPage
