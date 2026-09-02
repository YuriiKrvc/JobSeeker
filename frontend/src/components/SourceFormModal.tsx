import { Form, Input, InputNumber, Modal, Select, Switch, Typography } from 'antd'
import type { FormRule } from 'antd'
import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import type { Source, SourceInput } from '../api/sources'
import { createSource } from '../api/sources'

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

export type SourceFormValues = SourceInput

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

/**
 * An empty Input yields '' , which fails the API's `/\S/` pattern with a 400.
 * `null` is the documented way to say "this board has no company selector".
 */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed === '' ? null : trimmed
}

/**
 * Normalizes raw form state into exactly what the API accepts.
 *
 * `toInput` is part of this file's declared interface (see the task brief)
 * so its trim/null-mapping logic can be exercised independent of the modal;
 * splitting it into its own file to satisfy fast-refresh is not worth the
 * indirection for one pure function.
 */
// eslint-disable-next-line react-refresh/only-export-components
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
  // `source` is unused until Task 3 adds edit mode behind this same prop; it
  // stays in the signature now so that task only has to add behavior, not
  // the parameter.
  void source

  // The modal is destroyed on hide, but `form` is not, so its values have to
  // be reset explicitly whenever the modal is (re)opened.
  useEffect(() => {
    if (open) {
      // Mirrors the same-shaped exception in SourcesPage.tsx's load effect:
      // this only runs when `open` flips to true, which happens from a user
      // click, never from a render this effect itself caused — so there is
      // no cascade for the rule to be guarding against here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
