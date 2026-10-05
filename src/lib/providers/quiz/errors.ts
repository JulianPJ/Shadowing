export class QuizProviderError extends Error {
  constructor(
    public code: 'unconfigured' | 'unavailable' | 'malformed' | 'insufficient-transcript',
    message: string,
    public stage?:
      'configuration' | 'selection' | 'provider-call' | 'provider-response' | 'validation',
    public reason?: string,
  ) {
    super(message);
  }
}
