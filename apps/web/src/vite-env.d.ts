/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string
  /** Этап запуска: 1 — только осмотры, обход и структура; 2 — все разделы. По умолчанию 1. */
  readonly VITE_APP_STAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
