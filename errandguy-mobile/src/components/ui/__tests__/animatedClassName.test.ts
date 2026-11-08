import * as fs from 'fs';
import * as path from 'path';

/**
 * NativeWind doesn't apply `className` to Reanimated's Animated components, so
 * any layout or colour given that way silently disappears: the six code cells
 * on the sign-in and reset-password screens stacked into a column, and bottom
 * sheets lost their position and background. Layout and colour on an
 * Animated.* element go in `style`.
 *
 * Moti's components are Reanimated components too: the runner offer card,
 * the completion sheet and the photo picker sheet all rendered without their
 * background because it was given as className on a MotiView.
 */
const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__mocks__' ? [] : sourceFiles(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

/** Opening tags of animated elements, read brace-aware (an `=>` inside an
 *  attribute doesn't end the tag). Covers Animated.X, Reanimated.X (as
 *  tracking imports it) and Moti components. */
function animatedTags(text: string): string[] {
  const tags: string[] = [];
  const start = /<(?:Animated|Reanimated)\.[A-Za-z]+\b|<Moti[A-Z][A-Za-z]*\b/g;
  let match: RegExpExecArray | null;
  while ((match = start.exec(text))) {
    let depth = 0;
    let i = match.index + match[0].length;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0 && text[i - 1] !== '=') break;
    }
    tags.push(text.slice(match.index, i + 1));
  }
  return tags;
}

describe('Animated components', () => {
  it('never take className (NativeWind drops it) — Animated.*, Reanimated.* and Moti*', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const tag of animatedTags(text)) {
        // className at the top level of the tag (not inside a child's props).
        if (/\sclassName=/.test(tag)) offenders.push(`${path.relative(SRC, file)}: ${tag.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the scanner sees past arrow functions in earlier props', () => {
    const tag = animatedTags('<Animated.View onLayout={(e) => go(e)} className="flex-row">x</Animated.View>')[0];
    expect(tag).toMatch(/className=/);
  });
});
