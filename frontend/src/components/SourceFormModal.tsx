import {
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Switch,
  Typography,
} from 'antd'
import { useEffect, useState } from 'react'

import { ApiError } from '../api/client'
import type { Source } from '../api/sources'
import { createSource, updateSource } from '../api/sources'
import {
  CREATE_DEFAULTS,
  diffInput,
  LISTING_URL_RULES,
  NAME_RULES,
  optionalAttr,
  optionalSelector,
  requiredAttr,
  requiredSelector,
  toFormValues,
  toInput,
  WORD_LIST_RULES,
} from './sourceForm'
import type { SourceFormValues } from './sourceForm'

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
      // Mirrors the same-shaped exception in SourcesPage.tsx's load effect:
      // this only runs when `open` flips to true, which happens from a user
      // click, never from a render this effect itself caused — so there is
      // no cascade for the rule to be guarding against here.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailure(null)
      form.setFieldsValue(source ? toFormValues(source) : CREATE_DEFAULTS)
    }
  }, [open, source, form])

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
    } catch (caught) {
      // 409 is always the unique name — it is the only unique constraint the
      // route can hit — so it belongs on the name field, not in a banner the
      // user has to translate back into "which box do I fix".
      if (caught instanceof ApiError && caught.status === 409) {
        form.setFields([{ name: 'name', errors: [caught.message] }])
      } else {
        setFailure(
          caught instanceof Error
            ? caught.message
            : 'Could not save the source',
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={source ? 'Edit source' : 'Add source'}
      okText={source ? 'Save' : 'Create'}
      onOk={() => void submit()}
      onCancel={onClose}
      confirmLoading={saving}
      cancelButtonProps={{ disabled: saving }}
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
          <InputNumber
            min={1000}
            max={60000}
            step={500}
            style={{ width: 200 }}
          />
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
