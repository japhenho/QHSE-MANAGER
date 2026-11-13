import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Guards the contrast promises of the design tokens (WCAG relative luminance). */
const css = readFileSync(resolve(process.cwd(), 'src/styles/index.css'), 'utf8');

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(css);
  if (!match?.[1]) throw new Error(`Missing token --color-${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(token(a)), luminance(token(b))].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

const TEXT_PAIRS: [string, string][] = [
  ['fg', 'page'],
  ['fg', 'surface'],
  ['fg-muted', 'surface'],
  ['fg-muted', 'page'],
  ['on-primary', 'primary'],
  ['on-chrome', 'chrome'],
  ['on-chrome-muted', 'chrome'],
  ['success-fg', 'success-surface'],
  ['warning-fg', 'warning-surface'],
  ['danger-fg', 'danger-surface'],
  ['info-fg', 'info-surface'],
  ['neutral-fg', 'neutral-surface'],
];

const INDICATOR_PAIRS: [string, string][] = [
  ['line-strong', 'surface'],
  ['focus', 'surface'],
  ['focus', 'page'],
  ['focus-on-chrome', 'chrome'],
  ['accent', 'chrome'],
  ['success', 'success-surface'],
  ['warning', 'warning-surface'],
  ['danger', 'danger-surface'],
  ['info', 'info-surface'],
  ['neutral', 'neutral-surface'],
];

describe('design tokens contrast', () => {
  it.each(TEXT_PAIRS)('text %s on %s is at least 7:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(7);
  });

  it.each(INDICATOR_PAIRS)('indicator %s on %s is at least 3:1', (fg, bg) => {
    expect(contrast(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});
