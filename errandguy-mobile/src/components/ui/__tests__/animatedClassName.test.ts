import * as fs from 'fs';
import * as path from 'path';

/**
 * NativeWind doesn't apply `className` to Reanimated's Animated components, so
 * any layout or colour given that way silently disappears: the six code cells
 * on the sign-in and reset-password screens stacked into a column, and bottom
 * sheets lost their position and background. Layout and colour on an
 * Animated.* element go in `style`.
 */
const SRC = path.resolve(__dirname, '../../..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === '__mocks__' ? [] : sourceFiles(full);
    return /\.tsx$/.test(entry.name) ? [full] : [];
  });
}

describe('Animated components', () => {
  it('never take className (NativeWind drops it)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = fs.readFileSync(file, 'utf8');
      // The opening tag of each <Animated.X …>, up to its closing `>`.
      const tags = text.match(/<Animated\.[A-Za-z]+\b[^>]*>/g) ?? [];
      for (const tag of tags) {
        if (/\sclassName=/.test(tag)) offenders.push(`${path.relative(SRC, file)}: ${tag.slice(0, 60)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
