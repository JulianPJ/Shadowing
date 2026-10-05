export type PreparationErrorCode =
  | 'invalid-url'
  | 'video-unavailable'
  | 'no-japanese-captions'
  | 'provider-blocked'
  | 'provider-incompatible'
  | 'network-timeout'
  | 'network'
  | 'internal';

export class CaptionError extends Error {
  constructor(
    public code: PreparationErrorCode,
    message: string,
    public stage: string,
    public provider = 'youtube-transcript-plus',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'CaptionError';
  }
}

const messages: Record<PreparationErrorCode, string> = {
  'invalid-url': 'Enter a valid YouTube video URL.',
  'video-unavailable': 'This video is unavailable or private. Check the link or try another video.',
  'no-japanese-captions':
    'This video has no Japanese captions. Import a Japanese transcript or try another video.',
  'provider-blocked':
    'YouTube is limiting automatic caption access. Import a transcript or try again later.',
  'provider-incompatible':
    'Automatic captions are temporarily unavailable. Import a transcript or try the demo.',
  'network-timeout':
    'Caption retrieval took too long. Try again, import a transcript, or use the demo.',
  network: 'The caption service could not be reached. Try again or import a transcript.',
  internal: 'We couldn’t prepare this lesson. Try again, import a transcript, or use the demo.',
};

export function normalizePreparationError(error: unknown, signal?: AbortSignal) {
  const name = error instanceof Error ? error.name : 'UnknownError';
  let code: PreparationErrorCode;
  if (signal?.aborted || name === 'TimeoutError' || name === 'AbortError') {
    code =
      signal?.reason?.name === 'TimeoutError' || name === 'TimeoutError'
        ? 'network-timeout'
        : 'network';
  } else if (error instanceof CaptionError) code = error.code;
  else if (name === 'YoutubeTranscriptVideoUnavailableError') code = 'video-unavailable';
  else if (name === 'YoutubeTranscriptTooManyRequestError') code = 'provider-blocked';
  else if (
    name === 'YoutubeTranscriptNotAvailableLanguageError' ||
    name === 'YoutubeTranscriptDisabledError'
  )
    code = 'no-japanese-captions';
  // The library also throws NotAvailable for a missing API key, rejected player or empty HTTP 200 body.
  else if (name === 'YoutubeTranscriptNotAvailableError') code = 'provider-incompatible';
  else if (
    name === 'NotSupportedError' ||
    name === 'ReferenceError' ||
    (error instanceof TypeError &&
      /not implemented|won.t be implemented|is not a function|illegal invocation|not supported/i.test(
        error.message,
      ))
  )
    code = 'provider-incompatible';
  else code = 'internal';
  return { code, error: messages[code] };
}

export function logPreparationError(
  error: unknown,
  context: {
    stage: string;
    provider: string;
    videoId?: string;
    elapsedMs?: number;
    signal?: AbortSignal;
  },
) {
  const { signal, ...fields } = context;
  const normalized = normalizePreparationError(error, signal);
  const redact = (value: string) => value.replace(/https?:\/\/\S+/g, '[url]').slice(0, 500);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
  console.error(
    JSON.stringify({
      event: 'preparation.failed',
      ...fields,
      ...normalized,
      stage: error instanceof CaptionError ? error.stage : context.stage,
      provider: error instanceof CaptionError ? error.provider : context.provider,
      name: error instanceof Error ? error.name : 'UnknownError',
      // Never log URLs (caption URLs contain signed query parameters) or stack traces.
      message: redact(error instanceof Error ? error.message : 'Unknown failure'),
      causeName: cause?.name,
      causeMessage: cause ? redact(cause.message) : undefined,
      aborted: signal?.aborted ?? false,
      abortReason: signal?.reason?.name ?? null,
    }),
  );
  return normalized;
}
