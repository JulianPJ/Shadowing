import type { HibikiAuth } from './auth/server';
import { adultConfirmationRequiredResponse, hasAdultSelfDeclaration } from './auth/eligibility';
import type { BillingEnvironment } from './billing/config';

export type AccessPlan = 'free' | 'pro';
export const PRO_FEATURES = [
  'ai-transcription',
  'translation',
  'shadowing-analysis',
  'quiz',
  'topic-vocabulary',
  'grammar-analysis',
  'difficulty',
  'recording',
  'advanced-practice',
  'vocabulary',
  'review',
  'knowledge',
  'progress',
  'learning-sync',
] as const;
export type ProFeature = (typeof PRO_FEATURES)[number];

/** One policy for browser controls and authenticated server operations. */
export function canUseFeature(plan: AccessPlan | undefined, feature: ProFeature): boolean {
  return plan === 'pro' && PRO_FEATURES.includes(feature);
}

/** Lookup is local/public; /api/dictionary stores personal learning data. */
export function accountRouteFeature(path: string): ProFeature | null {
  if (path === '/api/dictionary') return 'vocabulary';
  if (path === '/api/review') return 'review';
  if (path === '/api/knowledge') return 'knowledge';
  return null;
}

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

export function createD1AccessRepository(
  db: AccessDatabase,
  environment: BillingEnvironment = 'sandbox',
): AccessRepository {
  return {
    async plan(userId) {
      const row = await db
        .prepare(
          `SELECT plan, ${environment === 'sandbox' ? 'paddle_sandbox_until' : 'paddle_live_until'} AS paid_until FROM user_access WHERE user_id=?`,
        )
        .bind(userId)
        .first<{ plan: unknown; paid_until: string | null }>();
      return row?.plan === 'pro' || (row?.paid_until && Date.parse(row.paid_until) > Date.now())
        ? 'pro'
        : 'free';
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
  if (!hasAdultSelfDeclaration(session.user)) return adultConfirmationRequiredResponse();
  if ((await access.plan(session.user.id)) !== 'pro') return proRequiredResponse();
  return null;
}
