import React, { useImperativeHandle, useRef, useState, forwardRef } from 'react';
import { View, PanResponder, type LayoutChangeEvent } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Imperative handle exposed to parents — `clear()` wipes the canvas
 * and `exportToFile()` rasterises the current strokes to a JPEG file
 * in the app's cache directory and returns its `file://` URI.
 *
 * The exported file plugs directly into the existing
 * `runnerService.updateBookingStatus({ signature })` upload path —
 * the multipart helper already accepts a local file URI and ships it
 * to the backend's `signature` field, which writes `signature_url` on
 * the booking. No backend changes required.
 */
export interface SignaturePadHandle {
  clear: () => void;
  isEmpty: () => boolean;
  exportToFile: () => Promise<string | null>;
}

interface SignaturePadProps {
  /** Visible height of the pad. Width is inherited from parent. */
  height?: number;
  /** Stroke colour — defaults to ink black so it scans cleanly. */
  strokeColor?: string;
  /** Stroke thickness in px. */
  strokeWidth?: number;
  /** Fired the first time the user starts drawing. Lets the parent
   *  flip its "signed" state for the submit button. */
  onBegin?: () => void;
}

/**
 * Lightweight signature canvas built on PanResponder + react-native-svg.
 *
 * We deliberately avoid `react-native-signature-canvas` (WebView based)
 * because the project already ships the two pieces we need: gesture
 * touches via PanResponder and vector rendering via `react-native-svg`.
 * On submit the SVG view is converted to a base64 PNG via
 * `Svg.toDataURL()` (built into react-native-svg ≥ 10), then written
 * to disk through expo-file-system so the existing FormData upload
 * path can attach it without extra plumbing.
 */
export const SignaturePad = forwardRef<SignaturePadHandle, SignaturePadProps>(
  function SignaturePad(
    { height = 180, strokeColor = '#0F172A', strokeWidth = 2.5, onBegin },
    ref,
  ) {
    // Each path is a separate stroke (pen down → pen up). Keeping them
    // as discrete strings means lifting the finger creates a visual
    // break instead of teleporting the line back to the new touch.
    const [paths, setPaths] = useState<string[]>([]);
    const currentPathRef = useRef<string>('');
    const svgRef = useRef<Svg>(null);
    const sizeRef = useRef<{ w: number; h: number }>({ w: 0, h: height });
    const beganRef = useRef(false);

    const onLayout = (e: LayoutChangeEvent) => {
      const { width, height: h } = e.nativeEvent.layout;
      sizeRef.current = { w: width, h };
    };

    // PanResponder is recreated only once because `setPaths` is stable
    // and we only need access to refs inside the callbacks.
    const panResponder = useRef(
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentPathRef.current = `M${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          if (!beganRef.current) {
            beganRef.current = true;
            onBegin?.();
          }
        },
        onPanResponderMove: (evt) => {
          const { locationX, locationY } = evt.nativeEvent;
          currentPathRef.current += ` L${locationX.toFixed(1)},${locationY.toFixed(1)}`;
          // Live-update the in-progress stroke by replacing the last
          // tentative entry. We keep this fast by mutating only the
          // tail of the array.
          setPaths((prev) => {
            const next = prev.slice();
            // Tag the in-progress stroke at the very end with a
            // sentinel so we can find/replace it without tracking an
            // extra index.
            if (next.length > 0 && next[next.length - 1].startsWith('__live__')) {
              next[next.length - 1] = `__live__${currentPathRef.current}`;
            } else {
              next.push(`__live__${currentPathRef.current}`);
            }
            return next;
          });
        },
        onPanResponderRelease: () => {
          // Commit the in-progress stroke as a permanent path.
          setPaths((prev) => {
            const next = prev.slice();
            if (next.length > 0 && next[next.length - 1].startsWith('__live__')) {
              next[next.length - 1] = currentPathRef.current;
            }
            return next;
          });
          currentPathRef.current = '';
        },
        onPanResponderTerminate: () => {
          setPaths((prev) => prev.filter((p) => !p.startsWith('__live__')));
          currentPathRef.current = '';
        },
      }),
    ).current;

    useImperativeHandle(ref, () => ({
      clear: () => {
        setPaths([]);
        currentPathRef.current = '';
        beganRef.current = false;
      },
      isEmpty: () => paths.length === 0,
      exportToFile: async () => {
        if (paths.length === 0) return null;
        // react-native-svg exposes `toDataURL` on the Svg ref — it
        // returns a base64 PNG (no `data:` prefix). We persist it via
        // expo-file-system so the existing upload path can attach a
        // standard local file URI.
        return new Promise<string | null>((resolve) => {
          // `toDataURL` is a runtime method on the native ref that the
          // react-native-svg type definitions don't surface — narrow
          // the ref through `unknown` so the cast is honest.
          const native = svgRef.current as unknown as {
            toDataURL?: (cb: (base64: string) => void) => void;
          } | null;
          if (!native?.toDataURL) {
            resolve(null);
            return;
          }
          native.toDataURL(async (base64: string) => {
            try {
              const path = `${FileSystem.cacheDirectory}signature-${Date.now()}.png`;
              await FileSystem.writeAsStringAsync(path, base64, {
                encoding: FileSystem.EncodingType.Base64,
              });
              resolve(path);
            } catch {
              resolve(null);
            }
          });
        });
      },
    }));

    return (
      <View
        onLayout={onLayout}
        style={{
          height,
          backgroundColor: '#FFFFFF',
          borderRadius: 12,
          borderWidth: 1,
          borderColor: '#E2E8F0',
          overflow: 'hidden',
        }}
        {...panResponder.panHandlers}
      >
        <Svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${sizeRef.current.w || 1} ${sizeRef.current.h || height}`}
        >
          {paths.map((d, i) => (
            <Path
              key={i}
              d={d.startsWith('__live__') ? d.slice('__live__'.length) : d}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          ))}
        </Svg>
      </View>
    );
  },
);
