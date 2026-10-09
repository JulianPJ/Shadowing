// Types for `import { env } from 'cloudflare:workers'`, inferred from cloudflare.config.ts.
// Optional auth/email secrets that are configured outside the config file are listed explicitly.
type HibikiBindings = import('cf/config').InferEnv<typeof import('../../cloudflare.config').worker>;
type HibikiOptionalSecrets = Omit<
  import('@/lib/auth/server').AuthEnvironment,
  keyof HibikiBindings
>;

declare namespace Cloudflare {
  interface Env extends HibikiBindings, HibikiOptionalSecrets {}
}

// Only the runtime exports the app uses; workerd provides the module in dev, preview and production.
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
  export function waitUntil(promise: Promise<unknown>): void;
}
