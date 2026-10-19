import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import {
  APIError,
  addOAuthServerContext,
  createAuthMiddleware,
  getOAuthState,
} from 'better-auth/api';
import {
  ADULT_CONFIRMATION_MESSAGE,
  ADULT_CONFIRMATION_REQUIRED,
  adultConfirmed,
} from './eligibility';
import { safeReturnPath } from './return-path';

export type AuthEnvironment = {
  AUTH_SECRET?: string;
  AUTH_BASE_URL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
};
export type AuthMail = { to: string; subject: string; text: string };

export function createAuth(
  database: NonNullable<BetterAuthOptions['database']>,
  env: AuthEnvironment,
  background?: (promise: Promise<unknown>) => void,
  mailer?: (mail: AuthMail) => Promise<void>,
) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32 || !env.AUTH_BASE_URL)
    throw new Error('Authentication configuration unavailable');
  const origin = new URL(env.AUTH_BASE_URL).origin;
  const send =
    mailer ??
    (async (mail: AuthMail) => {
      if (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) throw new Error('Email unavailable');
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: env.AUTH_EMAIL_FROM, ...mail }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error('Email delivery failed');
    });
  const auth = betterAuth({
    appName: 'Hibiki',
    database,
    secret: env.AUTH_SECRET,
    baseURL: origin,
    trustedOrigins: [origin],
    logger: { disabled: true },
    user: {
      // Set only by the hooks below or the account confirmation route, never by request bodies or
      // provider profiles (`input: false`).
      additionalFields: {
        adultSelfDeclaredAt: { type: 'date', required: false, input: false },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const signUp =
          ctx.path === '/sign-up/email' ||
          (ctx.path === '/sign-in/social' && ctx.body?.requestSignUp === true);
        if (!signUp) return;
        const confirmation = ctx.path === '/sign-up/email' ? ctx.body : ctx.body?.additionalData;
        if (!adultConfirmed(confirmation)) throw adultConfirmationError();
        // Client `additionalData` is untrusted on the callback; server context is not.
        if (ctx.path === '/sign-in/social')
          await addOAuthServerContext({ adultSelfDeclaredAt: Date.now() });
      }),
    },
    databaseHooks: {
      user: {
        create: {
          // Backstop for every user-creation path: no record of a confirmation, no account.
          before: async (user, ctx) => {
            const declaredAt = await adultDeclarationFor(ctx);
            if (!declaredAt) throw adultConfirmationError();
            return { data: { ...user, adultSelfDeclaredAt: declaredAt } };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await send({
          to: user.email,
          subject: 'Reset your Hibiki password',
          text: `Reset your password: ${url}`,
        });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await send({
          to: user.email,
          subject: 'Verify your Hibiki email',
          text: `Verify your email: ${url}`,
        });
      },
    },
    socialProviders:
      env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
              accessType: 'online',
              // Google may only create an account from registration, after the 18+ confirmation.
              disableImplicitSignUp: true,
            },
          }
        : {},
    plugins: [
      {
        id: 'hibiki-auth-indexes',
        schema: {
          account: {
            fields: {},
            indexes: [
              {
                fields: ['providerId', 'accountId'],
                unique: true,
                name: 'account_provider_identity_unique',
              },
            ],
          },
        },
      },
    ],
    account: {
      encryptOAuthTokens: true,
      accountLinking: { enabled: true, disableImplicitLinking: true, allowDifferentEmails: false },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 14,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-up/email': { window: 60, max: 5 },
        '/request-password-reset': { window: 60, max: 3 },
        '/send-verification-email': { window: 60, max: 3 },
        '/link-social': { window: 60, max: 5 },
      },
    },
    advanced: {
      useSecureCookies: origin.startsWith('https:'),
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      // D1 migrations own the schema and tests/auth-schema.test.ts checks it against Better Auth.
      // Runtime validation would introspect every table (~400 D1 rows) in each new isolate.
      database: { validateSchema: false },
      ...(background ? { backgroundTasks: { handler: background } } : {}),
    },
  });
  if (mailer) authMailConfigured.add(auth);
  return auth;
}
export type HibikiAuth = ReturnType<typeof createAuth>;

function adultConfirmationError() {
  return new APIError('FORBIDDEN', {
    code: ADULT_CONFIRMATION_REQUIRED,
    message: ADULT_CONFIRMATION_MESSAGE,
  });
}

async function adultDeclarationFor(
  ctx: { path?: string; body?: unknown } | null | undefined,
): Promise<Date | null> {
  if (ctx?.path === '/sign-up/email') return adultConfirmed(ctx.body) ? new Date() : null;
  try {
    const declared = (await getOAuthState())?.serverContext?.adultSelfDeclaredAt;
    return typeof declared === 'number' && Number.isFinite(declared) ? new Date(declared) : null;
  } catch {
    return null;
  }
}

// The application only allows these return paths, including email action redirects.
export function allowedAuthRedirect(value: unknown, origin: string) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020]/.test(value)) return false;
  try {
    const url = new URL(value, origin);
    const path = `${url.pathname}${url.search}${url.hash}`;
    return (
      url.origin === origin &&
      (safeReturnPath(path, '') === path ||
        ['/sign-in', '/reset-password'].includes(url.pathname)) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

export async function handleAuthRequest(request: Request, auth: HibikiAuth, env: AuthEnvironment) {
  const origin = new URL(env.AUTH_BASE_URL!).origin;
  const url = new URL(request.url);
  if (url.origin !== origin) return Response.json({ error: 'Invalid origin' }, { status: 403 });
  for (const field of ['callbackURL', 'redirectTo']) {
    if (url.searchParams.has(field) && !allowedAuthRedirect(url.searchParams.get(field), origin))
      return Response.json(
        { error: 'Invalid return path' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } },
      );
  }
  if (request.method === 'POST') {
    // Auth bodies are small; enforce a streaming limit before the framework parses them.
    const { readBoundedText } = await import('../http-body');
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(await readBoundedText(request.clone(), 16384));
    } catch {
      return Response.json({ error: 'Invalid request' }, { status: 400 });
    }
    for (const field of ['callbackURL', 'newUserCallbackURL', 'errorCallbackURL', 'redirectTo']) {
      if (body[field] !== undefined && !allowedAuthRedirect(body[field], origin))
        return Response.json({ error: 'Invalid return path' }, { status: 400 });
    }
    if (
      /\/(sign-up\/email|request-password-reset|send-verification-email)$/.test(
        new URL(request.url).pathname,
      ) &&
      (!env.RESEND_API_KEY || !env.AUTH_EMAIL_FROM) &&
      !authMailConfigured.has(auth)
    )
      return Response.json(
        {
          code: 'EMAIL_SERVICE_UNAVAILABLE',
          message: 'Email authentication is awaiting email service setup.',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
  }
  const response = await auth.handler(request);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
// Test/local mail transport can be supplied without exposing email links in logs.
const authMailConfigured = new WeakSet<HibikiAuth>();
export function markAuthMailConfigured(auth: HibikiAuth) {
  authMailConfigured.add(auth);
}
