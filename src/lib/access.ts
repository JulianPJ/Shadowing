import type { HibikiAuth } from './auth/server';

export type AccessPlan = 'free' | 'pro';
export type ProFeature =
  'ai-transcription' | 'shadowing-analysis' | 'quiz' | 'topic-vocabulary' | 'grammar-analysis';

export const PRO_FEATURES: readonly ProFeature[] = [
  'ai-transcription',
  'shadowing-analysis',
  'quiz',
  'topic-vocabulary',
  'grammar-analysis',
];

export interface AccessRepository {
  plan(userId: string): Promise<AccessPlan>;
}
export interface AccessStatement {
  bind(...values: (string | number | null)[]): AccessStatement;
  first<T>(): Promise<T | null>;
}
export interface AccessDatabase {
  prepare(sql: string): AccessStatement;
}

export const freeAccess: AccessRepository = {
  async plan() {
    return 'free';
  },
};

export function createD1AccessRepository(db: AccessDatabase): AccessRepository {
  return {
    async plan(userId) {
      const row = await db
        .prepare('SELECT plan FROM user_access WHERE user_id=?')
        .bind(userId)
        .first<{ plan: unknown }>();
      return row?.plan === 'pro' ? 'pro' : 'free';
    },
  };
}

export function proRequiredResponse(status = 403) {
  return Response.json(
    {
      code: 'pro-required',
      error: 'Hibiki Pro is required for this feature.',
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' },
    },
  );
}

export async function requirePro(
  request: Request,
  auth: HibikiAuth,
  access: AccessRepository,
): Promise<Response | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session)
    return Response.json(
      { code: 'sign-in-required', error: 'Sign in to use Hibiki Pro features.' },
      { status: 401, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } },
    );
  if ((await access.plan(session.user.id)) !== 'pro') return proRequiredResponse();
  return null;
}
