import * as fs from 'fs';
import * as path from 'path';

/**
 * Tailwind 3.3 (what NativeWind compiles with here) has no 15/35/45/55/65/85
 * opacity steps — those arrived in 3.4. A class like `text-white/85` or
 * `bg-white/15` silently generates nothing: white captions on the wallet card
 * fell back to the default (dark) text colour and a loading bar vanished.
 * Use a step that exists (…/10, /20, /80, /90) or an arbitrary `/[0.85]`.
 */
const SRC = path.resolve(__dirname, '../../..');
const MISSING_STEP = /\b(?:text|bg|border|ring|from|via|to|divide|placeholder|shadow|outline|fill|stroke|decoration|accent|caret)-[a-zA-Z0-9-]+\/(?:15|35|45|55|65|85)\b/g;

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__mocks__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('Tailwind opacity steps', () => {
  it('only uses steps Tailwind 3.3 generates', () => {
    const offenders = sourceFiles(SRC).flatMap((file) =>
      (fs.readFileSync(file, 'utf8').match(MISSING_STEP) ?? []).map((cls) => `${path.relative(SRC, file)}: ${cls}`),
    );
    expect(offenders).toEqual([]);
  });
});
