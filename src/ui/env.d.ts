/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** The online server, such as wss://arena.onrender.com; without it online play is hidden. */
  readonly VITE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
