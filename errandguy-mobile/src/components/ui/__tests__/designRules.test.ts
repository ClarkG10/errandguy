import * as fs from 'fs';
import * as path from 'path';
import { LightColors } from '../../../constants/colors';

/**
 * The owner's twenty polish rules, where a rule can be checked in code. Each
 * failure names the rule it breaks.
 */
const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__mocks__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const FILES = sourceFiles(SRC).map((file) => ({
  file: path.relative(SRC, file),
  text: fs.readFileSync(file, 'utf8'),
}));

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('polish rules that can be checked in code', () => {
  it('rule 3 — no italic text', () => {
    const offenders = FILES.filter(({ text }) =>
      /className="[^"]*\bitalic\b|fontStyle:\s*'italic'/.test(text),
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('rule 4 — no monospace type', () => {
    const offenders = FILES.filter(({ text }) => /font-mono|monospace|SpaceMono|Menlo|Courier/.test(text)).map(
      ({ file }) => file,
    );
    expect(offenders).toEqual([]);
  });

  it('rule 12 — one icon set (Lucide); the tab bars were the last on Ionicons', () => {
    const offenders = FILES.filter(({ text }) =>
      /from '@expo\/vector-icons|from 'react-native-vector-icons/.test(text),
    ).map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('rule 15 — secondary and tertiary text clear WCAG AA (4.5:1) on every light background', () => {
    for (const bg of [LightColors.surface, LightColors.background, LightColors.surfaceMuted]) {
      expect(contrast(LightColors.textSecondary, bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(LightColors.textTertiary, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('rule 15 — the Tailwind tertiary class is the same colour as the token', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const tw = require('../../../../tailwind.config.js');
    const colors = tw.theme.extend.colors;
    expect(colors.textTertiary).toBe(LightColors.textTertiary);
    expect(colors['text-tertiary']).toBe(LightColors.textTertiary);
  });
});
