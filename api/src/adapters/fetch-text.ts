/**
 * The one place this project performs an outbound HTTP request.
 *
 * Injected into the ingestion service rather than imported by it, so the unit
 * suite can pass canned HTML and never open a socket. Node 22's global `fetch`
 * is enough — no HTTP client dependency.
 */
export type FetchText = (url: string, timeoutMs: number) => Promise<string>

/** Sent so a board's operator can see who is scraping them and complain. */
const USER_AGENT = 'JobSeeker/0.1 (+https://github.com/jobseeker)'

/**
 * A single page's HTML lands in `postings.description`, an unbounded `text`
 * column, and is later returned verbatim by `GET /postings`. Without a cap a
 * misbehaving or hostile page can buffer unlimited bytes into memory and into
 * that column, so the body is read as a stream against a byte budget instead
 * of via `response.text()`.
 */
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024

async function readBodyWithLimit(
  response: Response,
  url: string,
): Promise<string> {
  // `Response.body` is typed as `ReadableStream | null` (no generic) by the
  // undici types Node ships, so it must be pinned to the byte stream fetch
  // actually returns to avoid `any` flowing through the reader below.
  const body = response.body as ReadableStream<Uint8Array> | null
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new Error(
        `${url}: response exceeded ${MAX_RESPONSE_BYTES} byte limit`,
      )
    }
    chunks.push(value)
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

export const fetchText: FetchText = async (url, timeoutMs) => {
  let response: Response
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
    })
  } catch (error) {
    // An abort surfaces as a bare "This operation was aborted", which in a
    // stored `last_error` gives no clue that a timeout is what happened.
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`${url}: timed out after ${timeoutMs}ms`)
    }
    throw new Error(
      `${url}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`)
  }
  return readBodyWithLimit(response, url)
}
