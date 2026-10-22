/// <reference types="vite/client" />

/** Injected at build time from package.json by vite.config.ts (`define`). */
declare const __APP_VERSION__: string;

declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.jpeg" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
