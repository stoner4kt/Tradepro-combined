/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_REVIEWS_INTEGRATION?: string;
  readonly VITE_API_PROXY_TARGET?: string;
  readonly VITE_API_URL?: string;
  readonly VITE_APP_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_API_TIMEOUT_MS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}