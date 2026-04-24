/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly PBINFO_USE_LIBRARY_SHELL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
