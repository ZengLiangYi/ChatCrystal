/**
 * Determine if the current command should run in interactive (Ink) mode.
 * Interactive mode requires: TTY stdout, no --json flag, no --no-interactive flag.
 */
export function isInteractive(globalOpts: { json?: boolean; noInteractive?: boolean }): boolean {
  const isTTY = process.stdout.isTTY ?? false;
  return isTTY && !globalOpts.json && !globalOpts.noInteractive;
}
