/**
 * LAUNCH BLOCKER: replace each bracketed value with verified public trader details before merging.
 * Do not infer these from the GitHub account, domain registration or payment provider.
 * Keep one source of truth across every public legal page.
 */
export const LEGAL_OPERATOR = {
  name: 'Julian Popovski-Jones',
  tradingName: 'Hibiki',
  legalForm: 'Sole trader',
  establishedIn: 'United Kingdom',
  address: '6 Riverlight Quay, London, SW11 8EA',
  email: 'hibiki.dev.shadowing@gmail.com',
  privacyEmail: 'hibiki.dev.shadowing@gmail.com',
  registration: 'Not applicable — sole trader, not a registered limited company',
  vat: '[VERIFY: VAT number if registered, otherwise state not registered]',
} as const;
