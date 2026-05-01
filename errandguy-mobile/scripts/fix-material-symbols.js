#!/usr/bin/env node
/**
 * Upstream bug: @expo-google-fonts/material-symbols ships its 600SemiBold
 * and 700Bold weights with a `MaterialSymbols_*.ttf.png` file but no
 * actual `.ttf`. Metro then crashes the Android bundle with:
 *
 *   Unable to resolve "./600SemiBold/MaterialSymbols_600SemiBold.ttf"
 *
 * The package is pulled in transitively by `expo-symbols` →
 * `expo-router`'s native-tabs, so we can't drop the dep. Workaround:
 * after install, copy the working 500Medium TTF in place of the missing
 * weights so the bundler can resolve them. Glyphs aren't visually
 * different at this scale because the app never actually renders the
 * 600/700 weights — they're just imported.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(
  __dirname,
  '..',
  'node_modules',
  '@expo-google-fonts',
  'material-symbols',
);
const SOURCE = path.join(ROOT, '500Medium', 'MaterialSymbols_500Medium.ttf');

const TARGETS = [
  { dir: '600SemiBold', file: 'MaterialSymbols_600SemiBold.ttf' },
  { dir: '700Bold', file: 'MaterialSymbols_700Bold.ttf' },
];

if (!fs.existsSync(SOURCE)) {
  // Package not installed or layout changed — nothing we can safely do.
  process.exit(0);
}

for (const { dir, file } of TARGETS) {
  const target = path.join(ROOT, dir, file);
  if (fs.existsSync(target)) continue;
  try {
    fs.copyFileSync(SOURCE, target);
    console.log(`[fix-material-symbols] shimmed ${dir}/${file}`);
  } catch (err) {
    console.warn(`[fix-material-symbols] failed to shim ${dir}/${file}:`, err.message);
  }
}
