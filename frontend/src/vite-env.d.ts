/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** UUID sent as the X-User-Id header. See .env.example. */
  readonly VITE_USER_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
