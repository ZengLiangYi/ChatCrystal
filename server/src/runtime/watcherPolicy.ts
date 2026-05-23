export type WatcherPolicyInput = {
  cloudMode: boolean;
  startWatcher?: boolean;
};

export function shouldStartWatcher(input: WatcherPolicyInput): boolean {
  if (input.cloudMode) return false;
  return input.startWatcher ?? true;
}
