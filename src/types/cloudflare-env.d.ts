// Types for `import { env } from 'cloudflare:workers'`, inferred from cloudflare.config.ts.
// Optional auth/email secrets that are configured outside the config file are listed explicitly.
type HibikiBindings = import('cf/config').InferEnv<typeof import('../../cloudflare.config').worker>;
type HibikiOptionalSecrets = Omit<
  import('@/lib/auth/server').AuthEnvironment,
  keyof HibikiBindings
>;

// vinext's cache config binds version metadata under a computed key that InferEnv cannot see.
type HibikiVersionMetadata = {
  CF_VERSION_METADATA?: { id: string; tag: string; timestamp: string };
};

declare namespace Cloudflare {
  interface Env extends HibikiBindings, HibikiOptionalSecrets, HibikiVersionMetadata {}
}

// Only the runtime exports the app uses; workerd provides the module in dev, preview and production.
declare module 'cloudflare:workers' {
  export const env: Cloudflare.Env;
  export function waitUntil(promise: Promise<unknown>): void;
}
