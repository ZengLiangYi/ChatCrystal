/**
 * Output formatting utilities for CLI.
 * TTY → colored table output. Non-TTY (pipe/redirect) → JSON.
 */

const isTTY = process.stdout.isTTY ?? false;

// ANSI color codes
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RED = '\x1b[31m';

export function shouldOutputJson(forceJson: boolean): boolean {
  return forceJson || !isTTY;
}

export function outputJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printHeader(text: string): void {
  console.log(`\n${BOLD}${CYAN}${text}${RESET}\n`);
}

export function printSuccess(text: string): void {
  console.log(`${GREEN}${text}${RESET}`);
}

export function printWarning(text: string): void {
  console.log(`${YELLOW}${text}${RESET}`);
}

export function printError(text: string): void {
  console.error(`${RED}${text}${RESET}`);
}

export function printKeyValue(key: string, value: string | number | boolean): void {
  console.log(`  ${DIM}${key}:${RESET} ${value}`);
}

export function printTable(headers: string[], rows: (string | number)[][]): void {
  const widths = headers.map((h, i) => {
    const maxData = rows.reduce((max, row) => Math.max(max, String(row[i] ?? '').length), 0);
    return Math.max(h.length, maxData);
  });

  const headerLine = headers.map((h, i) => h.padEnd(widths[i])).join('  ');
  console.log(`  ${BOLD}${headerLine}${RESET}`);
  console.log(`  ${widths.map(w => '─'.repeat(w)).join('──')}`);

  for (const row of rows) {
    const line = row.map((cell, i) => {
      const s = String(cell ?? '');
      return typeof cell === 'number' ? s.padStart(widths[i]) : s.padEnd(widths[i]);
    }).join('  ');
    console.log(`  ${line}`);
  }
  console.log();
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}
