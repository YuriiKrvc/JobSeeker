import { Empty, Modal, Typography } from 'antd'

import type { Posting } from '../services/postings'

export interface PostingDescriptionModalProps {
  /** The posting to show. The page renders this component only when it has one. */
  posting: Posting
  onClose: () => void
}

/**
 * One posting's description. No fetch: `GET /postings` already returns the full
 * description on every list row, so the row has everything.
 *
 * The description is scraped text from a third-party page, so it is rendered
 * **as text** with `white-space: pre-wrap` to keep its line breaks. It must
 * never go through `dangerouslySetInnerHTML` — the reason is not stylistic:
 * that would let any job board run script in this app.
 */
const PostingDescriptionModal = ({
  posting,
  onClose,
}: PostingDescriptionModalProps) => (
  <Modal
    open
    title={posting.title}
    footer={null}
    width={720}
    destroyOnHidden
    onCancel={onClose}
  >
    {posting.description.trim() === '' ? (
      // Blocked postings never reach this page, but "the API can return
      // `description` empty" is part of the contract, so this is honoured
      // rather than rendering a blank box.
      <Empty description="This posting has no description" />
    ) : (
      <Typography.Paragraph
        style={{
          whiteSpace: 'pre-wrap',
          marginBottom: 0,
          maxHeight: '60vh',
          overflowY: 'auto',
        }}
      >
        {posting.description}
      </Typography.Paragraph>
    )}
  </Modal>
)

export default PostingDescriptionModal
