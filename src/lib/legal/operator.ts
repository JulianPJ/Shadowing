/**
 * LAUNCH BLOCKER: replace each bracketed value with verified public trader details before merging.
 * Do not infer these from the GitHub account, domain registration or payment provider.
 * Keep one source of truth across every public legal page.
 */
export const LEGAL_OPERATOR = {
  name: '[VERIFY: your full legal name]',
  tradingName: 'Hibiki',
  legalForm: 'Sole trader',
  establishedIn: '[VERIFY: country of establishment — UK if confirmed]',
  address: '[VERIFY: geographic business address]',
  email: '[VERIFY: monitored support email]',
  privacyEmail: '[VERIFY: monitored privacy contact email]',
  registration: 'Not applicable — sole trader, not a registered limited company',
  vat: '[VERIFY: VAT number if registered, otherwise state not registered]',
} as const;
