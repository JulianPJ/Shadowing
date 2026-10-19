// Hibiki accounts and subscriptions are for adults. Eligibility is a self-declaration recorded as a
// timestamp; no date of birth is collected and nothing here verifies a learner's age.
export const MINIMUM_ACCOUNT_AGE = 18;
export const ADULT_CONFIRMATION_REQUIRED = 'ADULT_CONFIRMATION_REQUIRED';
export const ADULT_CONFIRMATION_MESSAGE = `Confirm that you are ${MINIMUM_ACCOUNT_AGE} or older to create a Hibiki account.`;

/** Only an explicit boolean `true` counts as confirmation; strings, numbers and absence do not. */
export function adultConfirmed(body: unknown): boolean {
  return (
    !!body && typeof body === 'object' && (body as Record<string, unknown>).adultConfirmed === true
  );
}

/** A stored self-declaration, as Better Auth returns it from the D1 `user` row. */
export function hasAdultSelfDeclaration(user: { adultSelfDeclaredAt?: unknown }): boolean {
  const value = user.adultSelfDeclaredAt;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return (typeof value === 'string' || typeof value === 'number') && !!value;
}

export function adultConfirmationRequiredResponse() {
  return Response.json(
    {
      code: 'adult-confirmation-required',
      error: `Confirm that you are ${MINIMUM_ACCOUNT_AGE} or older to continue using your account.`,
    },
    { status: 403, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } },
  );
}
