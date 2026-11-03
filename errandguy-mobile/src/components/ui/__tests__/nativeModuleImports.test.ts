import fs from 'fs';
import path from 'path';

/**
 * The wallet CSV export and the photo "Save" resolved their native modules
 * through `globalThis.require('expo-…')`. Metro defines no global `require`
 * (only `__r`, which takes module ids), and a module reached only that way is
 * never bundled — so both features answered "Please rebuild the app" on every
 * phone. They import the modules normally now, like the runner earnings export.
 */
const read = (...p: string[]) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', ...p), 'utf8');
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('native modules are imported, never looked up by name at runtime', () => {
  it.each([
    ['components/ui/ImageLightbox.tsx'],
    ['app/(customer)/wallet/index.tsx'],
  ])('%s', (file) => {
    const src = stripComments(read(...file.split('/')));
    expect(src).not.toMatch(/globalThis as any\)\.require/);
    expect(src).not.toMatch(/rebuild the app/i);
    expect(src).toContain("import * as FileSystem from 'expo-file-system/legacy';");
  });
});
