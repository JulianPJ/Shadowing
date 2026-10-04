export const WORKERS_AI_GENERATIVE_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export const WORKERS_AI_DECISION_MODEL = '@cf/cloudflare/clef-flash';
export const WORKERS_AI_TRANSLATION_MODEL = '@cf/meta/m2m100-1.2b';

export type WorkersAiBindingLike = {
  run(model: string, input: Record<string, unknown>, options?: { rejectIfBusy?: boolean }): Promise<unknown>;
};

export class WorkersAiCallError extends Error {}

export async function runWorkersAi<T>(
  ai: WorkersAiBindingLike,
  model: string,
  input: Record<string, unknown>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw new WorkersAiCallError('cancelled');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new WorkersAiCallError('cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve()
      .then(() => {
        if (signal.aborted) throw new WorkersAiCallError('cancelled');
        return ai.run(model, input, { rejectIfBusy: true });
      })
      .then(value => resolve(value as T), reject)
      .finally(() => signal.removeEventListener('abort', abort));
  });
}
