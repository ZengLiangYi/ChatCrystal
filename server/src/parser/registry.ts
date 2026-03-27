import type { SourceAdapter } from './adapter.js';

const adapters = new Map<string, SourceAdapter>();

export function registerAdapter(adapter: SourceAdapter): void {
  if (adapters.has(adapter.name)) {
    console.warn(
      `[Parser] Adapter "${adapter.name}" already registered, overwriting.`,
    );
  }
  adapters.set(adapter.name, adapter);
  console.log(`[Parser] Registered adapter: ${adapter.displayName}`);
}

export function getAdapter(name: string): SourceAdapter | undefined {
  return adapters.get(name);
}

export function getAllAdapters(): SourceAdapter[] {
  return Array.from(adapters.values());
}

export async function detectAllSources() {
  const results = await Promise.all(
    getAllAdapters().map(async (adapter) => {
      const info = await adapter.detect();
      return info ? { adapter, info } : null;
    }),
  );
  return results.filter(Boolean) as {
    adapter: SourceAdapter;
    info: NonNullable<Awaited<ReturnType<SourceAdapter['detect']>>>;
  }[];
}
