'use client';
import type { PaddleEventData } from '@paddle/paddle-js';

export type BillingSummary = {
  checkout?: Checkout;
  enabled: boolean;
  environment: 'sandbox' | 'live';
  canManage: boolean;
  subscriptions: {
    id: string;
    status: string;
    interval: string;
    periodEnd: string | null;
    cancelAt: string | null;
    refunded: boolean;
  }[];
};
export type Checkout = {
  transactionId: string;
  clientToken: string;
  environment: 'sandbox' | 'live';
};

export async function billingRequest<T>(userId: string, path = '', body?: unknown): Promise<T> {
  const response = await fetch(`/api/billing${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'X-Hibiki-Account': userId,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Billing is temporarily unavailable.');
  return result;
}

// Load Paddle only when a learner opens checkout, keeping third-party work off the player path.
export async function openCheckout(checkout: Checkout, onEvent: (event: PaddleEventData) => void) {
  // Paddle auto-opens _ptxn on initialization. Only our authorized transaction may be opened.
  const url = new URL(window.location.href);
  if (url.searchParams.has('_ptxn')) {
    url.searchParams.delete('_ptxn');
    window.history.replaceState(null, '', url.href);
  }
  const { initializePaddle } = await import('@paddle/paddle-js');
  const paddle = await initializePaddle({
    token: checkout.clientToken,
    environment: checkout.environment === 'live' ? 'production' : 'sandbox',
    eventCallback: onEvent,
  });
  if (!paddle) throw new Error('Could not open checkout. Please try again.');
  paddle.Checkout.open({
    transactionId: checkout.transactionId,
    settings: { displayMode: 'overlay' },
  });
}
