export type BillingEnvironment = 'sandbox' | 'live';
export type BillingSettings = {
  AUTH_BASE_URL?: string;
  PADDLE_ENVIRONMENT?: string;
  PADDLE_ENABLED?: string;
  PADDLE_API_KEY?: string;
  PADDLE_WEBHOOK_SECRET?: string;
  PADDLE_CLIENT_TOKEN?: string;
  PADDLE_PRO_MONTHLY_PRICE_ID?: string;
  PADDLE_PRO_ANNUAL_PRICE_ID?: string;
};

export function billingEnvironment(settings: BillingSettings): BillingEnvironment {
  if (settings.PADDLE_ENVIRONMENT && !['sandbox', 'live'].includes(settings.PADDLE_ENVIRONMENT))
    throw new Error('Invalid billing environment');
  return settings.PADDLE_ENVIRONMENT === 'live' ? 'live' : 'sandbox';
}

export function paddleId(value: unknown, prefix: string): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[a-z0-9]{26}$`).test(value);
}

export function billingConfigured(settings: BillingSettings) {
  const environment = billingEnvironment(settings);
  return (
    settings.PADDLE_ENABLED === 'true' &&
    !!settings.PADDLE_API_KEY &&
    !!settings.PADDLE_WEBHOOK_SECRET &&
    !!settings.PADDLE_CLIENT_TOKEN?.startsWith(environment === 'sandbox' ? 'test_' : 'live_') &&
    paddleId(settings.PADDLE_PRO_MONTHLY_PRICE_ID, 'pri') &&
    paddleId(settings.PADDLE_PRO_ANNUAL_PRICE_ID, 'pri') &&
    settings.PADDLE_PRO_MONTHLY_PRICE_ID !== settings.PADDLE_PRO_ANNUAL_PRICE_ID
  );
}
