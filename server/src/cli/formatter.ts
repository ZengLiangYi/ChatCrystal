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

/**
 * Get the display width of a string in terminal columns.
 * CJK characters occupy 2 columns; ASCII characters occupy 1.
 */
function displayWidth(str: string): number {
  let w = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0)!;
    // CJK Unified Ideographs, CJK Extension A/B, CJK Compatibility, Fullwidth forms,
    // Hangul Syllables, CJK Symbols, Hiragana, Katakana, Bopomofo, etc.
    if (
      (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
      (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) || // CJK Radicals..Yi
      (code >= 0xac00 && code <= 0xd7a3) || // Hangul Syllables
      (code >= 0xf900 && code <= 0xfaff) || // CJK Compatibility Ideographs
      (code >= 0xfe10 && code <= 0xfe6f) || // CJK Compatibility Forms..Small Forms
      (code >= 0xff01 && code <= 0xff60) || // Fullwidth Forms
      (code >= 0xffe0 && code <= 0xffe6) || // Fullwidth Signs
      (code >= 0x20000 && code <= 0x2fffd) || // CJK Extension B+
      (code >= 0x30000 && code <= 0x3fffd)    // CJK Extension G+
    ) {
      w += 2;
    } else {
      w += 1;
    }
  }
  return w;
}

/** Pad string to target display width (handles CJK double-width characters). */
function padEndDisplay(str: string, targetWidth: number): string {
  const gap = targetWidth - displayWidth(str);
  return gap > 0 ? str + ' '.repeat(gap) : str;
}

function padStartDisplay(str: string, targetWidth: number): string {
  const gap = targetWidth - displayWidth(str);
  return gap > 0 ? ' '.repeat(gap) + str : str;
}

export function printTable(headers: string[], rows: (string | number)[][]): void {
  const widths = headers.map((h, i) => {
    const maxData = rows.reduce((max, row) => Math.max(max, displayWidth(String(row[i] ?? ''))), 0);
    return Math.max(displayWidth(h), maxData);
  });

  const headerLine = headers.map((h, i) => padEndDisplay(h, widths[i])).join('  ');
  console.log(`  ${BOLD}${headerLine}${RESET}`);
  console.log(`  ${widths.map(w => '─'.repeat(w)).join('──')}`);

  for (const row of rows) {
    const line = row.map((cell, i) => {
      const s = String(cell ?? '');
      return typeof cell === 'number' ? padStartDisplay(s, widths[i]) : padEndDisplay(s, widths[i]);
    }).join('  ');
    console.log(`  ${line}`);
  }
  console.log();
}

export function truncate(str: string, maxWidth: number): string {
  if (displayWidth(str) <= maxWidth) return str;
  let w = 0;
  let i = 0;
  for (const ch of str) {
    const cw = displayWidth(ch);
    if (w + cw + 3 > maxWidth) break; // reserve 3 for "..."
    w += cw;
    i += ch.length;
  }
  return str.slice(0, i) + '...';
}
