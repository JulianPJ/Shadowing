import { readBoundedText } from '../http-body';
import { billingEnvironment, type BillingSettings } from './config';

export type PaddleRequest = (path: string, body?: unknown) => Promise<Record<string, unknown>>;

export function paddleApi(
  settings: BillingSettings,
  transport: typeof fetch = fetch,
): PaddleRequest {
  const base =
    billingEnvironment(settings) === 'sandbox'
      ? 'https://sandbox-api.paddle.com'
      : 'https://api.paddle.com';
  return async (path, body) => {
    if (!settings.PADDLE_API_KEY) throw new Error('Billing unavailable');
    const response = await transport(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: `Bearer ${settings.PADDLE_API_KEY}`,
        'Content-Type': 'application/json',
        'Paddle-Version': '1',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error('Billing provider unavailable');
    const result = JSON.parse(await readBoundedText(response, 262144));
    return object(result.data);
  };
}

export function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
