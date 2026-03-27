import PQueue from 'p-queue';
import type {} from 'p-queue';
import { taskTracker } from './tracker.js';

export { taskTracker } from './tracker.js';
export type { TaskSnapshot, TaskEntry } from './tracker.js';

export const summarizeQueue: InstanceType<typeof PQueue> = new PQueue({
  concurrency: 1,
  intervalCap: 1,
  interval: 1000,
  carryoverConcurrencyCount: true,
});

export async function enqueueWithRetry<T>(
  taskId: string,
  taskTitle: string,
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  taskTracker.add(taskId, taskTitle);

  const result = await summarizeQueue.add(
    async () => {
      taskTracker.start(taskId);
      let lastError: Error | undefined;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const res = await fn();
          taskTracker.complete(taskId);
          return res;
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (lastError.message.includes('429') && attempt < maxRetries) {
            const delay = 1000 * 2 ** attempt;
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          taskTracker.fail(taskId, lastError.message);
          throw lastError;
        }
      }
      taskTracker.fail(taskId, lastError?.message || 'Unknown error');
      throw lastError;
    },
    { throwOnTimeout: true },
  );
  return result as T;
}

export function getQueueStatus() {
  return taskTracker.getSnapshot();
}

/** Clear pending items from the queue and cancel tracked tasks */
export function cancelQueue() {
  summarizeQueue.clear(); // Remove pending jobs from p-queue
  const cancelled = taskTracker.cancelQueued(); // Mark queued tasks as cancelled
  return { cancelled: cancelled.length, queue: getQueueStatus() };
}
