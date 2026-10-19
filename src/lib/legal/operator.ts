/**
 * LAUNCH BLOCKER: replace each bracketed value with verified public trader details before merging.
 * Do not infer these from the GitHub account, domain registration or payment provider.
 * Keep one source of truth across every public legal page.
 */
export const LEGAL_OPERATOR = {
  name: '[VERIFY: legal trading name]',
  establishedIn: '[VERIFY: country of establishment]',
  address: '[VERIFY: geographic business address]',
  email: '[VERIFY: monitored support email]',
  privacyEmail: '[VERIFY: monitored privacy contact email]',
  registration: '[VERIFY: registration number if applicable, otherwise state not applicable]',
  vat: '[VERIFY: VAT number if registered, otherwise state not registered]',
} as const;
