import PQueue from 'p-queue';
import type {} from 'p-queue';

export const summarizeQueue: InstanceType<typeof PQueue> = new PQueue({
  concurrency: 1,
  intervalCap: 1,
  interval: 1000,
  carryoverConcurrencyCount: true,
});

export async function enqueueWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  const result = await summarizeQueue.add(
    async () => {
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await fn();
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (lastError.message.includes('429') && attempt < maxRetries) {
            const delay = 1000 * 2 ** attempt;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          throw lastError;
        }
      }
      throw lastError;
    },
    { throwOnTimeout: true },
  );
  return result as T;
}

export function getQueueStatus() {
  return {
    size: summarizeQueue.size,
    pending: summarizeQueue.pending,
    isPaused: summarizeQueue.isPaused,
  };
}
