/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAME_URL?: string;
  readonly VITE_CAMPAIGN_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
