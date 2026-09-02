# Frontend Sources Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/sources` from a placeholder into a working screen that lists, creates, edits, deletes and toggles job sources against the existing API.

**Architecture:** One `request<T>()` helper owns `fetch`, the `/api` prefix, the `X-User-Id` header and a typed `ApiError`; one `sources.ts` module exposes the four CRUD calls over a locally-declared `Source` type; `SourcesPage` holds `{ sources, loading, error }` in `useState` and re-lists after every mutation; one `SourceFormModal` serves both create and edit.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Ant Design 6.6.2 (`@ant-design/icons` 6), react-router 8. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-02-frontend-sources-page-design.md`

## Global Constraints

- **No imports from `api/`.** Not a type, not a constant, not a schema. The frontend declares the wire shape itself. (`CLAUDE.md`, both files.)
- **`react-router`, not `react-router-dom`.** The latter is not installed.
- **antd 6 + `@ant-design/icons` 6.** Never guess an antd API from memory — run `npx @ant-design/cli info <Component> --format json` before using an unfamiliar prop, and `npx @ant-design/cli lint ./src --format json` after every change.
- **Use `destroyOnHidden`, not `destroyOnClose`,** on `Modal`. Both exist in 6.6.2; `destroyOnHidden` (since 5.25.0) is the current one and the linter flags the other.
- **There is no test runner in `frontend/`,** and this plan does not add one. Every task's verification is `npm run typecheck`, `npm run lint`, `npx @ant-design/cli lint ./src`, plus the explicit manual steps given in that task. A task is not done until the manual steps have actually been run and produced the stated output.
- **Every API call needs `X-User-Id`.** The seeded bootstrap user is `00000000-0000-4000-8000-000000000001` (`api/drizzle/0001_seed_owner.sql`).
- **API error envelope is always `{ statusCode, error, message }`** (`api/src/routes/http.ts`).
- **Field limits, copied verbatim from `api/src/routes/sources.schema.ts`:** `name` 1–200 non-blank; `listingUrl` http/https, max 2000; selectors 1–500 non-blank; attrs 1–100 non-blank; blocklist words 1–100 chars, max 500 entries; `requestTimeoutMs` 1000–60000; `detailDelayMs` 0–10000; `maxItemsPerRun` 1–500. All integers.
- **API defaults for a new source:** `enabled: true`, `titleAttr: null`, `detailUrlAttr: 'href'`, `descriptionAttr: null`, `companySelector: null`, `companyAttr: null`, `postedAtSelector: null`, `postedAtAttr: null`, both blocklists `[]`, `requestTimeoutMs: 10000`, `detailDelayMs: 1000`, `maxItemsPerRun: 100`.

---

## Running environment

Every task's manual verification needs all three of these up. Start them once, in three terminals, and leave them running:

```bash
# 1. Postgres (standalone binary — this machine has no `docker compose` plugin)
cd /Users/ykravchenko/www/JobSeeker && docker-compose up -d postgres

# 2. API on :3000
cd /Users/ykravchenko/www/JobSeeker/api && npm install && npm run db:migrate && npm run dev

# 3. Frontend on :5173
cd /Users/ykravchenko/www/JobSeeker/frontend && npm install && npm run dev
```

Sanity check before starting Task 1:

```bash
curl -s -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' http://localhost:3000/sources
```

Expected: `{"sources":[]}` (or a list, if you have already created some).

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/.env.example` | Documents `VITE_USER_ID`. Committed. |
| `frontend/src/vite-env.d.ts` | Types `import.meta.env.VITE_USER_ID`. |
| `frontend/src/services/client.ts` | `request<T>()`, `ApiError`. The only file that calls `fetch`. |
| `frontend/src/services/sources.ts` | `Source`, `SourceInput`, and the four CRUD calls. |
| `frontend/src/components/SourceFormModal.tsx` | The create/edit form, its validation rules, and the PATCH diff. |
| `frontend/src/pages/SourcesPage.tsx` | Table, load/error/empty state, and the row actions. |

---

## Task 1: API client and a read-only sources table

Deliverable: `/sources` lists real sources from the API, with a loading state, a typed error state with retry, and an empty state.

**Files:**
- Create: `frontend/.env.example`
- Create: `frontend/src/vite-env.d.ts`
- Create: `frontend/src/services/client.ts`
- Create: `frontend/src/services/sources.ts`
- Modify: `frontend/src/pages/SourcesPage.tsx` (replace all 9 lines)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `class ApiError extends Error { readonly status: number; readonly error: string }` — `message` comes from `Error`.
  - `request<T>(path: string, init?: RequestInit): Promise<T>`
  - `interface Source` — 25 fields, exactly as written in Step 4.
  - `type SourceInput = Omit<Source, 'id' | 'lastRunAt' | 'lastSuccessAt' | 'lastError' | 'createdAt' | 'updatedAt'>` — the 19 editable fields.
  - `listSources(): Promise<Source[]>`, `createSource(input: SourceInput): Promise<Source>`, `updateSource(id: string, patch: Partial<SourceInput>): Promise<Source>`, `deleteSource(id: string): Promise<void>`

- [ ] **Step 1: Create `frontend/.env.example`**

```bash
# The UUID sent as the X-User-Id header on every API request.
#
# The API has no authentication yet — it believes whatever this header says
# (see api/src/auth/current-user.ts). This value is the bootstrap user seeded
# by api/drizzle/0001_seed_owner.sql, and is the same in every environment.
#
# Copy this file to .env.local, then restart `npm run dev` — Vite only reads
# env files at startup. If the variable is unset the header is omitted and
# every request fails with 400 "Missing x-user-id header".
VITE_USER_ID=00000000-0000-4000-8000-000000000001
```

- [ ] **Step 2: Copy it to `.env.local` and confirm `.env.local` is ignored by git**

```bash
cd frontend && cp .env.example .env.local && git check-ignore -v .env.local
```

Expected: a line naming the `.gitignore` rule that matches (Vite's template ignores `*.local`). If it prints nothing, `.env.local` is **not** ignored — add `.env.local` to `frontend/.gitignore` before continuing, because it is about to hold a user id.

- [ ] **Step 3: Create `frontend/src/vite-env.d.ts`**

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** UUID sent as the X-User-Id header. See .env.example. */
  readonly VITE_USER_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

It is declared optional on purpose: the variable genuinely may be absent, and pretending otherwise would hide the one case the client has to handle.

- [ ] **Step 4: Create `frontend/src/services/client.ts`**

```ts
/**
 * The only file in this app that calls `fetch`.
 *
 * `/api` is a dev-server fiction: vite.config.ts proxies it to the Fastify
 * API and strips the prefix, so `/api/sources` arrives as `/sources`. A
 * deployment has to reproduce that rewrite — see frontend/CLAUDE.md.
 */
const BASE = '/api'

export class ApiError extends Error {
  readonly status: number
  /** The envelope's `error` field, e.g. 'Bad Request', 'Conflict'. */
  readonly error: string

  constructor(status: number, error: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.error = error
  }
}

/** Every API failure arrives in this shape — see api/src/routes/http.ts. */
interface ErrorBody {
  statusCode: number
  error: string
  message: string
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const body = value as Record<string, unknown>
  return typeof body.error === 'string' && typeof body.message === 'string'
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers)
  const userId = import.meta.env.VITE_USER_ID
  // Omitted rather than sent blank when unset: the API's 400 for a missing
  // header names the problem, the one for a malformed value does not.
  if (userId) headers.set('X-User-Id', userId)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')

  const response = await fetch(`${BASE}${path}`, { ...init, headers })

  if (!response.ok) throw await toApiError(response)
  // DELETE answers 204, which has no body to parse.
  if (response.status === 204) return undefined as unknown as T
  return (await response.json()) as T
}

/**
 * A failing response is not guaranteed to carry the error envelope. A dead
 * proxy, or a dev server with no API behind it, answers with HTML — and
 * `response.json()` would then throw a SyntaxError whose message ("Unexpected
 * token <") tells the user nothing about what went wrong.
 */
async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    body = undefined
  }
  if (isErrorBody(body)) {
    return new ApiError(response.status, body.error, body.message)
  }
  return new ApiError(
    response.status,
    response.statusText || 'Error',
    `Request failed with status ${response.status}`,
  )
}
```

- [ ] **Step 5: Create `frontend/src/services/sources.ts`**

```ts
import { request } from './client'

/**
 * The frontend's own restatement of the wire shape, transcribed from
 * api/src/routes/sources.schema.ts. Deliberately not imported from `api/`:
 * the REST API is the whole contract between the two projects. When the API
 * changes, this is the file that changes with it.
 *
 * Timestamps are ISO-8601 strings, not Dates — JSON has no date type and
 * nothing here needs date arithmetic.
 */
export interface Source {
  id: string
  name: string
  listingUrl: string
  enabled: boolean

  // Listing page.
  itemSelector: string
  titleSelector: string
  titleAttr: string | null
  detailUrlSelector: string
  detailUrlAttr: string

  // Detail page.
  descriptionSelector: string
  descriptionAttr: string | null
  companySelector: string | null
  companyAttr: string | null
  postedAtSelector: string | null
  postedAtAttr: string | null

  blockedTitleWords: string[]
  blockedDescriptionWords: string[]

  requestTimeoutMs: number
  detailDelayMs: number
  maxItemsPerRun: number

  // Server-owned.
  lastRunAt: string | null
  lastSuccessAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

/** The 19 fields a caller may write. */
export type SourceInput = Omit<
  Source,
  'id' | 'lastRunAt' | 'lastSuccessAt' | 'lastError' | 'createdAt' | 'updatedAt'
>

export async function listSources(): Promise<Source[]> {
  const { sources } = await request<{ sources: Source[] }>('/sources')
  return sources
}

export function createSource(input: SourceInput): Promise<Source> {
  return request<Source>('/sources', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** An omitted key leaves the column alone; an explicit null clears it. */
export function updateSource(
  id: string,
  patch: Partial<SourceInput>,
): Promise<Source> {
  return request<Source>(`/sources/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export function deleteSource(id: string): Promise<void> {
  return request<void>(`/sources/${id}`, { method: 'DELETE' })
}
```

- [ ] **Step 6: Replace `frontend/src/pages/SourcesPage.tsx`**

```tsx
import { Alert, Button, Empty, Table, Tag, Tooltip, Typography } from 'antd'
import type { TableProps } from 'antd'
import { useCallback, useEffect, useState } from 'react'

import { ApiError } from '../services/client'
import type { Source } from '../services/sources'
import { listSources } from '../services/sources'

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
```

The error state replaces the table rather than sitting above it: a toast over a page with no content behind it fades and leaves an empty screen with no explanation.

- [ ] **Step 7: Typecheck, lint, and antd-lint**

```bash
cd frontend && npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0 with no errors. Fix anything antd-lint reports before continuing — that is what it is there for.

- [ ] **Step 8: Verify the empty state in the browser**

Open `http://localhost:5173/sources`.

Expected: the "Sources" heading and an empty table reading "No sources configured yet". Open the browser devtools Network tab and confirm a request to `/api/sources` returned **200**, with an `X-User-Id` request header equal to `00000000-0000-4000-8000-000000000001`.

- [ ] **Step 9: Verify a real row renders**

Create one through the API, then reload the page:

```bash
curl -s -X POST http://localhost:3000/sources \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' \
  -d '{
    "name": "Plan smoke test",
    "listingUrl": "https://example.com/jobs",
    "itemSelector": ".job",
    "titleSelector": ".title",
    "detailUrlSelector": "a",
    "descriptionSelector": ".description"
  }'
```

Expected: a 201 body with an `id`. Reload `/sources` and confirm the row shows the name, the URL as a link, a green "Enabled" tag, "—" under Last run, and a "Never run" tag under Status.

- [ ] **Step 10: Verify the error state**

Stop the API process (Ctrl-C in its terminal), reload `/sources`.

Expected: a red `Alert` reading "Could not load sources" with a description that is a readable sentence — **not** a JSON parse error. Restart the API, click **Retry**, and confirm the table comes back.

- [ ] **Step 11: Verify the missing-env path**

Comment out the line in `frontend/.env.local`, restart `npm run dev`, reload `/sources`.

Expected: the `Alert` shows `Missing x-user-id header`. Restore the line and restart.

- [ ] **Step 12: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/.env.example frontend/src/vite-env.d.ts frontend/src/services/client.ts frontend/src/services/sources.ts frontend/src/pages/SourcesPage.tsx
git commit -m "feat(frontend): list sources from the API"
```

---

## Task 2: The create form

Deliverable: an "Add source" button opens a modal covering all 19 editable fields, validated client-side, that POSTs and refreshes the table. A duplicate name shows as an inline error on the name field.

**Files:**
- Create: `frontend/src/components/SourceFormModal.tsx`
- Modify: `frontend/src/pages/SourcesPage.tsx`

**Interfaces:**
- Consumes: `Source`, `SourceInput`, `createSource` from `../services/sources`; `ApiError` from `../services/client`.
- Produces:
  - `interface SourceFormModalProps { open: boolean; source: Source | null; onClose: () => void; onSaved: () => void }` — `source: null` means create mode. Task 3 adds edit mode behind the same prop.
  - `type SourceFormValues = SourceInput` — an alias, so the form's raw state and the API's input have one type. Raw state may still hold `''` where the API needs `null`; `toInput()` is what closes that gap.
  - `toInput(values: SourceFormValues): SourceInput` — trims every string and maps blank optional fields to `null`.
  - default export `SourceFormModal`.

- [ ] **Step 1: Create `frontend/src/components/SourceFormModal.tsx`**

```tsx
import { Form, Input, InputNumber, Modal, Select, Switch, Typography } from 'antd'
import type { FormRule } from 'antd'
import { useEffect, useState } from 'react'

import { ApiError } from '../services/client'
import type { Source, SourceInput } from '../services/sources'
import { createSource } from '../services/sources'

/**
 * Validation rules transcribed from api/src/routes/sources.schema.ts.
 *
 * This duplicates the Zod schema by hand and can drift from it. The real fix
 * is generating these from the OpenAPI document the API publishes at /docs,
 * which is out of scope here. They are grouped into these consts rather than
 * written inline so that generator has a single seam to replace, and so a
 * reviewer can diff them against the schema in one place.
 *
 * `whitespace: true` is antd's spelling of the API's `/\S/` pattern: a
 * whitespace-only string is a blank in disguise and the API rejects it.
 */
const NAME_RULES: FormRule[] = [
  { required: true, whitespace: true, message: 'Name is required' },
  { max: 200, message: 'At most 200 characters' },
]

const LISTING_URL_RULES: FormRule[] = [
  { required: true, message: 'Listing URL is required' },
  { type: 'url', message: 'Must be a valid http(s) URL' },
  { max: 2000, message: 'At most 2000 characters' },
  {
    // antd's `type: 'url'` accepts ftp:// and others; the API takes only these
    // two, and its published schema says merely "uri", so the check is here.
    pattern: /^https?:\/\//,
    message: 'Must start with http:// or https://',
  },
]

const requiredSelector: FormRule[] = [
  { required: true, whitespace: true, message: 'Required' },
  { max: 500, message: 'At most 500 characters' },
]

const optionalSelector: FormRule[] = [
  { whitespace: true, message: 'Cannot be only whitespace' },
  { max: 500, message: 'At most 500 characters' },
]

const requiredAttr: FormRule[] = [
  { required: true, whitespace: true, message: 'Required' },
  { max: 100, message: 'At most 100 characters' },
]

const optionalAttr: FormRule[] = [
  { whitespace: true, message: 'Cannot be only whitespace' },
  { max: 100, message: 'At most 100 characters' },
]

const WORD_LIST_RULES: FormRule[] = [
  {
    validator: (_rule, value: string[] | undefined) => {
      const words = value ?? []
      if (words.length > 500) return Promise.reject(new Error('At most 500 words'))
      if (words.some((word) => word.length > 100)) {
        return Promise.reject(new Error('Each word is at most 100 characters'))
      }
      return Promise.resolve()
    },
  },
]

/** The API's own defaults, so a created source matches what POST would apply. */
const CREATE_DEFAULTS: SourceFormValues = {
  name: '',
  listingUrl: '',
  enabled: true,
  itemSelector: '',
  titleSelector: '',
  titleAttr: null,
  detailUrlSelector: '',
  detailUrlAttr: 'href',
  descriptionSelector: '',
  descriptionAttr: null,
  companySelector: null,
  companyAttr: null,
  postedAtSelector: null,
  postedAtAttr: null,
  blockedTitleWords: [],
  blockedDescriptionWords: [],
  requestTimeoutMs: 10000,
  detailDelayMs: 1000,
  maxItemsPerRun: 100,
}

export type SourceFormValues = SourceInput

/**
 * An empty Input yields '' , which fails the API's `/\S/` pattern with a 400.
 * `null` is the documented way to say "this board has no company selector".
 */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/** Normalizes raw form state into exactly what the API accepts. */
export function toInput(values: SourceFormValues): SourceInput {
  return {
    ...values,
    name: values.name.trim(),
    listingUrl: values.listingUrl.trim(),
    itemSelector: values.itemSelector.trim(),
    titleSelector: values.titleSelector.trim(),
    titleAttr: blankToNull(values.titleAttr),
    detailUrlSelector: values.detailUrlSelector.trim(),
    detailUrlAttr: values.detailUrlAttr.trim(),
    descriptionSelector: values.descriptionSelector.trim(),
    descriptionAttr: blankToNull(values.descriptionAttr),
    companySelector: blankToNull(values.companySelector),
    companyAttr: blankToNull(values.companyAttr),
    postedAtSelector: blankToNull(values.postedAtSelector),
    postedAtAttr: blankToNull(values.postedAtAttr),
    blockedTitleWords: values.blockedTitleWords ?? [],
    blockedDescriptionWords: values.blockedDescriptionWords ?? [],
  }
}

export interface SourceFormModalProps {
  open: boolean
  /** null means create mode. */
  source: Source | null
  onClose: () => void
  onSaved: () => void
}

const Group = ({ children }: { children: string }) => (
  <Typography.Title level={5} style={{ marginTop: 24 }}>
    {children}
  </Typography.Title>
)

const SourceFormModal = ({
  open,
  source,
  onClose,
  onSaved,
}: SourceFormModalProps) => {
  const [form] = Form.useForm<SourceFormValues>()
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // The modal is destroyed on hide, but `form` is not, so its values have to
  // be reset explicitly whenever the modal is (re)opened.
  useEffect(() => {
    if (open) {
      setFailure(null)
      form.setFieldsValue(CREATE_DEFAULTS)
    }
  }, [open, form])

  const submit = async () => {
    let values: SourceFormValues
    try {
      values = await form.validateFields()
    } catch {
      // antd already marked the offending fields; there is nothing to add.
      return
    }

    setSaving(true)
    setFailure(null)
    try {
      await createSource(toInput(values))
      onSaved()
      onClose()
    } catch (caught) {
      // 409 is always the unique name — it is the only unique constraint the
      // route can hit — so it belongs on the name field, not in a banner the
      // user has to translate back into "which box do I fix".
      if (caught instanceof ApiError && caught.status === 409) {
        form.setFields([{ name: 'name', errors: [caught.message] }])
      } else {
        setFailure(
          caught instanceof Error ? caught.message : 'Could not save the source',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title="Add source"
      okText="Create"
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={saving}
      destroyOnHidden
      width={720}
      styles={{ body: { maxHeight: '70vh', overflowY: 'auto' } }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={CREATE_DEFAULTS}
        // Errors surface on the field; a form-wide banner is only for the
        // failures that belong to no single field.
        validateTrigger="onBlur"
      >
        {failure ? (
          <Typography.Text type="danger">{failure}</Typography.Text>
        ) : null}

        <Group>Basics</Group>
        <Form.Item label="Name" name="name" rules={NAME_RULES}>
          <Input placeholder="Example Job Board" />
        </Form.Item>
        <Form.Item
          label="Listing URL"
          name="listingUrl"
          rules={LISTING_URL_RULES}
          extra="The page that lists the vacancies."
        >
          <Input placeholder="https://example.com/jobs" />
        </Form.Item>
        <Form.Item label="Enabled" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>

        <Group>Listing page</Group>
        <Form.Item
          label="Item selector"
          name="itemSelector"
          rules={requiredSelector}
          extra="Matches once per vacancy on the listing page."
        >
          <Input placeholder=".job-card" />
        </Form.Item>
        <Form.Item
          label="Title selector"
          name="titleSelector"
          rules={requiredSelector}
          extra="Relative to an item."
        >
          <Input placeholder=".job-card__title" />
        </Form.Item>
        <Form.Item
          label="Title attribute"
          name="titleAttr"
          rules={optionalAttr}
          extra="Leave empty to take the element's text."
        >
          <Input placeholder="(element text)" />
        </Form.Item>
        <Form.Item
          label="Detail URL selector"
          name="detailUrlSelector"
          rules={requiredSelector}
        >
          <Input placeholder="a.job-card__link" />
        </Form.Item>
        <Form.Item
          label="Detail URL attribute"
          name="detailUrlAttr"
          rules={requiredAttr}
        >
          <Input placeholder="href" />
        </Form.Item>

        <Group>Detail page</Group>
        <Form.Item
          label="Description selector"
          name="descriptionSelector"
          rules={requiredSelector}
        >
          <Input placeholder=".job-description" />
        </Form.Item>
        <Form.Item
          label="Description attribute"
          name="descriptionAttr"
          rules={optionalAttr}
        >
          <Input placeholder="(element text)" />
        </Form.Item>
        <Form.Item
          label="Company selector"
          name="companySelector"
          rules={optionalSelector}
        >
          <Input placeholder="(none)" />
        </Form.Item>
        <Form.Item
          label="Company attribute"
          name="companyAttr"
          rules={optionalAttr}
        >
          <Input placeholder="(element text)" />
        </Form.Item>
        <Form.Item
          label="Posted-at selector"
          name="postedAtSelector"
          rules={optionalSelector}
        >
          <Input placeholder="(none)" />
        </Form.Item>
        <Form.Item
          label="Posted-at attribute"
          name="postedAtAttr"
          rules={optionalAttr}
        >
          <Input placeholder="datetime" />
        </Form.Item>

        <Group>Blocklists</Group>
        <Form.Item
          label="Blocked title words"
          name="blockedTitleWords"
          rules={WORD_LIST_RULES}
          extra="Whole-word and case-insensitive. Press Enter after each word."
        >
          <Select mode="tags" open={false} tokenSeparators={[',']} />
        </Form.Item>
        <Form.Item
          label="Blocked description words"
          name="blockedDescriptionWords"
          rules={WORD_LIST_RULES}
          extra="Press Enter after each word."
        >
          <Select mode="tags" open={false} tokenSeparators={[',']} />
        </Form.Item>

        <Group>Limits</Group>
        <Form.Item
          label="Request timeout (ms)"
          name="requestTimeoutMs"
          rules={[{ required: true, type: 'number', min: 1000, max: 60000 }]}
        >
          <InputNumber min={1000} max={60000} step={500} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item
          label="Delay between detail fetches (ms)"
          name="detailDelayMs"
          rules={[{ required: true, type: 'number', min: 0, max: 10000 }]}
        >
          <InputNumber min={0} max={10000} step={100} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item
          label="Max items per run"
          name="maxItemsPerRun"
          rules={[{ required: true, type: 'number', min: 1, max: 500 }]}
        >
          <InputNumber min={1} max={500} style={{ width: 200 }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}

export default SourceFormModal
```

`open={false}` on the two `Select`s suppresses the dropdown: in `tags` mode with no `options` it would otherwise open an empty "No data" panel on every keystroke.

`FormRule` is antd's top-level alias for the `Rule` type its `form` module exports; import it from `'antd'` rather than reaching into `antd/es/form`.

- [ ] **Step 2: Wire the button into `SourcesPage.tsx`**

Add to the imports:

```tsx
import { PlusOutlined } from '@ant-design/icons'
import { Flex } from 'antd'

import SourceFormModal from '../components/SourceFormModal'
```

Add state inside the component, below `const [error, setError] = useState<string | null>(null)`:

```tsx
const [modalOpen, setModalOpen] = useState(false)
```

Replace the `<Typography.Title level={3}>Sources</Typography.Title>` line with:

```tsx
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
```

And add the modal immediately before the closing `</>`:

```tsx
<SourceFormModal
  open={modalOpen}
  source={null}
  onClose={() => setModalOpen(false)}
  onSaved={() => void load()}
/>
```

- [ ] **Step 3: Typecheck, lint, and antd-lint**

```bash
cd frontend && npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0.

- [ ] **Step 4: Verify validation blocks a bad submit**

Open `/sources`, click **Add source**, and click **Create** with everything blank.

Expected: the modal stays open, no network request is made, and "Name is required" plus "Required" appear under Name, Listing URL, Item selector, Title selector, Detail URL selector and Description selector. Now type `not-a-url` into Listing URL and blur it — expected: "Must be a valid http(s) URL".

- [ ] **Step 5: Verify a successful create**

Fill in: Name `Manual test board`, Listing URL `https://example.com/jobs`, Item selector `.job`, Title selector `.title`, Detail URL selector `a`, Description selector `.description`. Leave everything else alone. Click **Create**.

Expected: the modal closes and the new row appears in the table without a page reload. Confirm the optional fields really went out as `null`, not `''`:

```bash
curl -s -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' \
  http://localhost:3000/sources | python3 -m json.tool | grep -A1 companySelector
```

Expected: `"companySelector": null`.

- [ ] **Step 6: Verify the 409 lands on the name field**

Click **Add source** again and submit the same name `Manual test board` with the same required fields.

Expected: the modal stays open and the message `You already have a source with that name` appears **under the Name field**, not as a banner or a toast.

- [ ] **Step 7: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/src/components/SourceFormModal.tsx frontend/src/pages/SourcesPage.tsx
git commit -m "feat(frontend): add sources through a modal form"
```

---

## Task 3: Edit mode, sending only what changed

Deliverable: an Edit action per row opens the same modal pre-filled, and saving PATCHes only the fields the user actually changed.

**Files:**
- Modify: `frontend/src/components/SourceFormModal.tsx`
- Modify: `frontend/src/pages/SourcesPage.tsx`

**Interfaces:**
- Consumes: everything from Task 2.
- Produces: `export function diffInput(before: SourceInput, after: SourceInput): Partial<SourceInput>` — returns only the keys whose values differ, comparing arrays by value.

- [ ] **Step 1: Add the diff helper to `SourceFormModal.tsx`**

Place it directly below `toInput`:

```ts
/** Value equality for the three shapes a SourceInput field can hold. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index])
  }
  return a === b
}

/**
 * Only the changed keys, which is what PATCH means.
 *
 * This matters concretely: the ingestion service writes lastRunAt and
 * lastError to the same row, and a scheduled run can land between opening the
 * modal and saving it. Sending all 19 fields would be a last-write-wins
 * overwrite of everything, including fields the user never looked at.
 */
export function diffInput(
  before: SourceInput,
  after: SourceInput,
): Partial<SourceInput> {
  const patch: Partial<SourceInput> = {}
  for (const key of Object.keys(after) as (keyof SourceInput)[]) {
    if (!sameValue(before[key], after[key])) {
      // Each key is assigned from the same key of a value of the same type;
      // TS cannot follow that through a dynamic key, hence the assertion.
      patch[key] = after[key] as never
    }
  }
  return patch
}
```

- [ ] **Step 2: Derive the form's starting values from the `source` prop**

Add below `CREATE_DEFAULTS`:

```ts
/** The editable subset of a source, in the shape the form holds. */
function toFormValues(source: Source): SourceFormValues {
  return {
    name: source.name,
    listingUrl: source.listingUrl,
    enabled: source.enabled,
    itemSelector: source.itemSelector,
    titleSelector: source.titleSelector,
    titleAttr: source.titleAttr,
    detailUrlSelector: source.detailUrlSelector,
    detailUrlAttr: source.detailUrlAttr,
    descriptionSelector: source.descriptionSelector,
    descriptionAttr: source.descriptionAttr,
    companySelector: source.companySelector,
    companyAttr: source.companyAttr,
    postedAtSelector: source.postedAtSelector,
    postedAtAttr: source.postedAtAttr,
    blockedTitleWords: source.blockedTitleWords,
    blockedDescriptionWords: source.blockedDescriptionWords,
    requestTimeoutMs: source.requestTimeoutMs,
    detailDelayMs: source.detailDelayMs,
    maxItemsPerRun: source.maxItemsPerRun,
  }
}
```

Replace the reset effect with:

```tsx
useEffect(() => {
  if (open) {
    setFailure(null)
    form.setFieldsValue(source ? toFormValues(source) : CREATE_DEFAULTS)
  }
}, [open, source, form])
```

- [ ] **Step 3: Branch `submit` on the mode**

Replace the body of `submit`'s `try` block (the three lines from `await createSource(...)` through `onClose()`) with:

```tsx
if (source) {
  const patch = diffInput(toFormValues(source), toInput(values))
  // The API rejects a PATCH with no keys, and sending one to earn a
  // guaranteed 400 is pointless.
  if (Object.keys(patch).length > 0) await updateSource(source.id, patch)
} else {
  await createSource(toInput(values))
}
onSaved()
onClose()
```

Add `updateSource` to the import from `../services/sources`.

- [ ] **Step 4: Make the modal's title and button reflect the mode**

Replace the two `Modal` props:

```tsx
title={source ? 'Edit source' : 'Add source'}
okText={source ? 'Save' : 'Create'}
```

- [ ] **Step 5: Add the Edit action column in `SourcesPage.tsx`**

`columns` currently sits at module scope and now needs a callback, so turn it into a function above the component:

Keep the five existing column entries (Name, Listing URL, Enabled, Last run, Status) byte-for-byte as Task 1 wrote them, move them inside this function, and append the sixth:

```tsx
const buildColumns = (
  onEdit: (source: Source) => void,
): TableProps<Source>['columns'] => [
  // Name, Listing URL, Enabled, Last run and Status exactly as in Task 1.
  {
    title: 'Actions',
    key: 'actions',
    width: 120,
    render: (_, source) => (
      <Button type="link" onClick={() => onEdit(source)}>
        Edit
      </Button>
    ),
  },
]
```

Replace the page's modal state and usage:

```tsx
const [editing, setEditing] = useState<Source | null>(null)
const [modalOpen, setModalOpen] = useState(false)

const openCreate = () => {
  setEditing(null)
  setModalOpen(true)
}

const openEdit = (source: Source) => {
  setEditing(source)
  setModalOpen(true)
}
```

Point the "Add source" button at `openCreate`, pass `columns={buildColumns(openEdit)}` to the `Table`, and pass `source={editing}` to the modal.

- [ ] **Step 6: Typecheck, lint, and antd-lint**

```bash
cd frontend && npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0.

- [ ] **Step 7: Verify the diff really is a diff**

Open `/sources`, click **Edit** on `Manual test board`, change **only** Max items per run to `50`, and click **Save**. Watch the devtools Network tab.

Expected: exactly one `PATCH /api/sources/<id>` whose **request payload is `{"maxItemsPerRun":50}`** — one key, nothing else. The row updates and the modal closes.

- [ ] **Step 8: Verify an unchanged save makes no request**

Click **Edit**, change nothing, click **Save**.

Expected: the modal closes and **no** network request is made.

- [ ] **Step 9: Verify clearing an optional selector**

Click **Edit**, type `.company` into Company selector, save. Then edit again, clear that field entirely, and save.

Expected: the second save's payload is `{"companySelector":null}` — `null`, not `""`. Confirm the column really cleared:

```bash
curl -s -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' \
  http://localhost:3000/sources | python3 -m json.tool | grep companySelector
```

Expected: `"companySelector": null`.

- [ ] **Step 10: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/src/components/SourceFormModal.tsx frontend/src/pages/SourcesPage.tsx
git commit -m "feat(frontend): edit a source, patching only changed fields"
```

---

## Task 4: Delete, and the inline enabled switch

Deliverable: each row can be deleted behind a confirmation, and its `enabled` flag toggled in place without opening the form.

**Files:**
- Modify: `frontend/src/pages/SourcesPage.tsx`

**Interfaces:**
- Consumes: `deleteSource`, `updateSource` from `../services/sources`; `App` from `antd` for toasts.
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Add the toast handle and the pending-row state**

`App.useApp()` is the supported way to get `message` — the static `message.*` import does not see the `ConfigProvider` theme, and `main.tsx` already wraps everything in `<AntdApp>`.

Add to the imports:

```tsx
import { App, Popconfirm, Switch } from 'antd'
import { deleteSource, updateSource } from '../services/sources'
```

Inside the component, directly below the `load` callback (both handlers call it):

```tsx
const { message } = App.useApp()
/** Ids with a row-level request in flight, so only that row shows a spinner. */
const [pending, setPending] = useState<Set<string>>(new Set())

const withPending = async (id: string, action: () => Promise<unknown>) => {
  setPending((current) => new Set(current).add(id))
  try {
    await action()
    await load()
  } catch (caught) {
    message.error(
      caught instanceof Error ? caught.message : 'The request failed',
    )
  } finally {
    setPending((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }
}

const toggle = (source: Source, enabled: boolean) =>
  void withPending(source.id, () => updateSource(source.id, { enabled }))

const remove = (source: Source) =>
  void withPending(source.id, async () => {
    await deleteSource(source.id)
    message.success(`Deleted ${source.name}`)
  })
```

`withPending` re-lists on success, so a failed toggle leaves the switch showing the server's state — the row is never left claiming something the API refused. That is why it reloads rather than patching local state.

- [ ] **Step 2: Extend `buildColumns` to take the handlers**

```tsx
const buildColumns = (
  onEdit: (source: Source) => void,
  onToggle: (source: Source, enabled: boolean) => void,
  onDelete: (source: Source) => void,
  pending: Set<string>,
): TableProps<Source>['columns'] => [
  // Name, Listing URL, Last run and Status keep the bodies Task 1 gave them.
  // Only Enabled and Actions change, below.
]
```

Replace the Enabled column with:

```tsx
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
```

Replace the Actions column with:

```tsx
{
  title: 'Actions',
  key: 'actions',
  width: 160,
  render: (_, source) => (
    <>
      <Button type="link" onClick={() => onEdit(source)}>
        Edit
      </Button>
      <Popconfirm
        title="Delete this source?"
        description="Its postings stop appearing. This cannot be undone."
        okText="Delete"
        okButtonProps={{ danger: true }}
        onConfirm={() => onDelete(source)}
      >
        <Button type="link" danger>
          Delete
        </Button>
      </Popconfirm>
    </>
  ),
},
```

Update the call site: `columns={buildColumns(openEdit, toggle, remove, pending)}`.

- [ ] **Step 3: Typecheck, lint, and antd-lint**

```bash
cd frontend && npm run typecheck && npm run lint && npx @ant-design/cli lint ./src
```

Expected: all three exit 0. `antd lint` is especially worth reading here — `Popconfirm` and `Switch` are two of the components the antd skill calls out for frequent prop renames.

- [ ] **Step 4: Verify the toggle**

Flip the switch on `Manual test board` to off.

Expected: the switch shows a brief loading state, then settles in the off position. The Network tab shows `PATCH /api/sources/<id>` with payload `{"enabled":false}` followed by a `GET /api/sources`. Confirm it stuck:

```bash
curl -s -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' \
  http://localhost:3000/sources | python3 -m json.tool | grep '"enabled"'
```

Expected: `"enabled": false`. Flip it back on.

- [ ] **Step 5: Verify a failed toggle reverts**

Stop the API, flip the switch, and watch.

Expected: an error toast appears and the switch returns to its previous position rather than staying where you dragged it. Restart the API.

- [ ] **Step 6: Verify delete**

Click **Delete** on `Manual test board`.

Expected: a confirmation popover with a red **Delete** button. Confirm it: a success toast appears and the row leaves the table. Then verify the API agrees:

```bash
curl -s -H 'X-User-Id: 00000000-0000-4000-8000-000000000001' http://localhost:3000/sources
```

Expected: the deleted source is absent from `sources`.

- [ ] **Step 7: Clean up the smoke-test row**

Delete `Plan smoke test` from Task 1 the same way, so the database is left as you found it.

- [ ] **Step 8: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add frontend/src/pages/SourcesPage.tsx
git commit -m "feat(frontend): delete sources and toggle them inline"
```

---

## Task 5: Documentation

Deliverable: both `CLAUDE.md` files stop saying the frontend makes no API calls, and the spec is marked implemented.

**Files:**
- Modify: `frontend/CLAUDE.md`
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-09-02-frontend-sources-page-design.md`

- [ ] **Step 1: Rewrite the Status section of `frontend/CLAUDE.md`**

It currently reads "Scaffold only… **Nothing calls the API yet** — there is no fetch, no API client, and no handling of `X-User-Id`." That is now false. Replace with:

```markdown
## Status

`/sources` is a working screen: it lists, creates, edits, deletes and toggles
sources against the API. `/postings` is still a placeholder.

`src/services/client.ts` is the only file that calls `fetch`. It owns the `/api`
prefix, the `X-User-Id` header (from `VITE_USER_ID` — copy `.env.example` to
`.env.local`) and the `ApiError` every caller catches. See
`docs/superpowers/specs/2026-09-02-frontend-sources-page-design.md`.
```

- [ ] **Step 2: Add a Layout note to `frontend/CLAUDE.md`**

Under the existing `## Layout` tree, add `api/` to the tree and this note beneath it:

```markdown
`src/services/` is the boundary. Components call the functions in `sources.ts` and
catch `ApiError`; nothing above that layer touches `fetch` or knows the header
exists.
```

- [ ] **Step 3: Update the root `CLAUDE.md` Status section**

It currently says the frontend "makes no API calls yet". Replace that sentence with:

```markdown
`frontend/` has a working sources screen — full CRUD against `/sources` — and
a placeholder postings page. Its commands and conventions live in
**`frontend/CLAUDE.md`**.
```

- [ ] **Step 4: Mark the spec implemented**

Change its `Status:` line to `Status: implemented`.

- [ ] **Step 5: Verify the claims are true**

```bash
cd /Users/ykravchenko/www/JobSeeker
grep -rn "fetch(" frontend/src --include=*.tsx --include=*.ts
grep -rn "Nothing calls the API\|makes no API calls" CLAUDE.md frontend/CLAUDE.md
```

Expected: the first prints exactly one hit, in `frontend/src/services/client.ts`. The second prints nothing.

- [ ] **Step 6: Final full check**

```bash
cd frontend && npm run typecheck && npm run lint && npm run format:check && npx @ant-design/cli lint ./src && npm run build
```

Expected: all five exit 0. Run `npm run format` first if `format:check` complains.

- [ ] **Step 7: Commit**

```bash
cd /Users/ykravchenko/www/JobSeeker
git add CLAUDE.md frontend/CLAUDE.md docs/superpowers/specs/2026-09-02-frontend-sources-page-design.md
git commit -m "docs: describe the sources screen and its API client"
```

---

## Out of scope

Named so they are not smuggled in mid-implementation:

- `PostingsPage` — still a placeholder when this plan is done.
- A "Run now" button calling `POST /ingest`. The obvious next slice.
- Any authentication beyond `VITE_USER_ID`.
- Theme tokens; `ConfigProvider` keeps the stock theme.
- Generating types and validation rules from the OpenAPI document at `/docs` — the real fix for the hand-copied rules in Task 2, deliberately deferred.
- A test runner. The `diffInput` helper in Task 3 is the first code here with a real argument for one; the next slice that touches it should reconsider.
