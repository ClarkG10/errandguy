import React from 'react';
import fs from 'fs';
import path from 'path';
import { render } from '@testing-library/react-native';
import {
  CHROME_MAX_FONT_SCALE,
  NUMERAL_MAX_FONT_SCALE,
  BODY_MAX_FONT_SCALE,
} from '../fontScale';

/**
 * Pins the font-scaling decision recorded in src/constants/fontScale.ts:
 * OS text scaling is ON app-wide, and layout is protected per component with
 * an explicit `maxFontSizeMultiplier`, NOT with a global `defaultProps` lock.
 *
 * The dead lock these tests guard against is genuinely hard to spot by hand:
 * `react-native/jest/setup.js` swaps `Text` for a CLASS mock (jest/mockComponent.js),
 * and React still resolves `defaultProps` on classes — so a naive component
 * test would happily "prove" a lock that does nothing on a device.
 */
describe('font scaling', () => {
  it('React 19 ignores defaultProps on FUNCTION components under the automatic JSX runtime', () => {
    // This is exactly the shape of react-native's `Text` (Libraries/Text/Text.js
    // exports an arrow component in both feature-flag branches), and exactly why
    // `Text.defaultProps.allowFontScaling = false` stopped applying.
    let seen: unknown = 'unset';
    function Probe(props: { allowFontScaling?: boolean }) {
      seen = props.allowFontScaling;
      return null;
    }
    (Probe as { defaultProps?: object }).defaultProps = { allowFontScaling: false };

    render(<Probe />);
    expect(seen).toBeUndefined();

    // ...while the LEGACY createElement path still resolves them, which is why
    // the old global lock silently applied to some third-party libraries and to
    // nothing in our own screens.
    seen = 'unset';
    render(React.createElement(Probe));
    expect(seen).toBe(false);
  });

  it('the root layout does not reintroduce a defaultProps font lock', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', '..', 'app', '_layout.tsx'),
      'utf8',
    );
    // Only comments may mention it — no executable assignment.
    const executable = source
      .split('\n')
      .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');
    expect(executable).not.toMatch(/defaultProps/);
    expect(executable).not.toMatch(/allowFontScaling/);
  });

  it('exposes the multipliers the existing layouts were written against', () => {
    // 1.3 is the value hard-coded in Button.tsx, Typography.tsx and
    // ToastProvider.tsx; changing it here without sweeping those is a lie.
    expect(CHROME_MAX_FONT_SCALE).toBe(1.3);
    expect(NUMERAL_MAX_FONT_SCALE).toBeLessThan(CHROME_MAX_FONT_SCALE);
    expect(BODY_MAX_FONT_SCALE).toBeGreaterThan(CHROME_MAX_FONT_SCALE);
  });
});
