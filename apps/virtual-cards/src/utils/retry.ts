export interface RetryOptions {
  /** Maximum number of attempts (including the first). */
  maxAttempts?: number;
  /** Base delay in ms for the first backoff. */
  baseDelayMs?: number;
  /** Cap on any individual backoff delay. */
  maxDelayMs?: number;
  /** Returns true if the given error is a safe, transient failure to retry. */
  isRetryable: (error: unknown) => boolean;
  /** Optional sleep override (used by tests to avoid real timers). */
  sleep?: (ms: number) => Promise<void>;
  /** Optional hook invoked before each retry (for logging/metrics). */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` with exponential backoff, retrying ONLY when `isRetryable` returns
 * true (e.g. rate limits / transient 5xx / connection errors).
 *
 * Validation and authentication failures must be classified as non-retryable by
 * the caller so they fail immediately.
 *
 * `fn` receives the attempt number; the caller is responsible for reusing the
 * same idempotency key across attempts.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 200;
  const maxDelayMs = options.maxDelayMs ?? 2_000;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !options.isRetryable(error)) {
        throw error;
      }
      const exponential = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.floor(Math.random() * baseDelayMs);
      const delayMs = Math.min(exponential + jitter, maxDelayMs);
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}
