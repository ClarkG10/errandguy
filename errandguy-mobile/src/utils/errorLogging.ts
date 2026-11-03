/**
 * App-wide error logging.
 *
 * Installs handlers so that uncaught JS errors and unhandled promise
 * rejections print a clear, greppable line to the Metro / `npx expo start`
 * terminal (and to any attached remote logger). Without this, a crash — e.g.
 * a missing native module like "ExpoWebBrowser" — can surface as a cryptic
 * redbox with almost no context in the terminal, which makes answering
 * "what's the error?" needlessly hard.
 *
 * This ONLY adds logging: the previous global handler is chained, so React
 * Native's dev redbox and default crash reporting still work. Nothing is
 * swallowed.
 */
import { Platform } from 'react-native';
import api from '../services/api';
import { getAppVersionLabel } from './appVersion';

/** `{ app_version: "1.0.0 · 3f2a9c1b" }` (native version + OTA bundle), or {} if unreadable. */
function withAppVersion(): { app_version?: string } {
  try {
    const label = getAppVersionLabel();
    return label && label !== '—' ? { app_version: label } : {};
  } catch {
    return {};
  }
}

/**
 * Best-effort forward of a CRASH (a fatal JS error or a React render error) to
 * the server, so a production crash on a release build — where console.* goes
 * nowhere — becomes a visible, alertable server-side signal instead of
 * vanishing. Fire-and-forget: it must never throw, never block the crash path,
 * and never recurse. A failed POST rejects a promise we have ALREADY caught, so
 * it can't re-enter through the unhandled-rejection tracker; the `forwarding`
 * flag is a second guard against re-entrancy. Only crashes are forwarded (not
 * every logged warning / unhandled rejection) to keep volume — and cost — low.
 *
 * Signed-out screens report too: nothing here requires a session (the endpoint
 * accepts anonymous reports; a token, when there is one, simply rides along
 * via the api interceptor), and sign-up / login are exactly where a crash costs
 * a customer. Every report carries the app version and platform so a crash can
 * be pinned to the build — and OTA bundle — that produced it.
 */
let forwarding = false;

// The server's limits (ClientErrorController): message 1000 characters, stack
// and component_stack 8000 each, the whole body 24 KB. A report over any of
// them is refused, and since the forward is fire-and-forget it was silently
// lost — and the biggest stacks are usually the crashes worth seeing. Kept a
// little under the body cap for the other fields and JSON overhead.
const MAX_MESSAGE_CHARS = 1000;
const MAX_STACK_CHARS = 8000;
const MAX_BODY_BYTES = 20_000;

/** Cut to at most `max` UTF-16 units (the server counts characters, never more than this). */
function clip(text: string | undefined, max: number): string | undefined {
  if (text == null || text.length <= max) return text;
  let cut = text.slice(0, Math.max(0, max - 1));
  // Never end on half of a surrogate pair — a lone surrogate is invalid JSON
  // text for the server's decoder, which would drop the whole report.
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** UTF-8 byte length of a string (no TextEncoder dependency). */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdfff) bytes += 2; // half of a 4-byte pair
    else bytes += 3;
  }
  return bytes;
}

type CrashBody = {
  message: string;
  stack?: string;
  component_stack?: string;
  [key: string]: unknown;
};

/** The report, trimmed to fit every server limit. Exported for tests. */
export function fitCrashReport<T extends CrashBody>(body: T): T {
  const fitted: T = {
    ...body,
    message: clip(body.message, MAX_MESSAGE_CHARS) ?? '',
    stack: clip(body.stack, MAX_STACK_CHARS),
    component_stack: clip(body.component_stack, MAX_STACK_CHARS),
  };
  // Non-ASCII text can take 3 bytes a character, so the per-field caps alone
  // can still overshoot the body cap: halve the longer stack until it fits.
  for (let i = 0; i < 20 && utf8Length(JSON.stringify(fitted)) > MAX_BODY_BYTES; i += 1) {
    const key =
      (fitted.stack?.length ?? 0) >= (fitted.component_stack?.length ?? 0)
        ? 'stack'
        : 'component_stack';
    const current = fitted[key];
    if (!current) break;
    (fitted as CrashBody)[key] = clip(current, Math.floor(current.length / 2));
  }
  return fitted;
}

function forwardCrash(payload: {
  message: string;
  stack?: string;
  component_stack?: string;
  fatal: boolean;
}): void {
  if (forwarding) return;
  forwarding = true;
  try {
    api
      .post(
        '/client-errors',
        fitCrashReport({ ...payload, platform: Platform.OS, ...withAppVersion() }),
        // Never spin the global activity indicator or hit the read cache for a
        // crash report, and don't dedupe (each crash is its own event).
        { silent: true, noCache: true, noDedupe: true },
      )
      .catch(() => {})
      .finally(() => {
        forwarding = false;
      });
  } catch {
    // Synchronous failure (e.g. api not ready) — swallow; the console logs above
    // still captured it. Reset so a later crash can still try.
    forwarding = false;
  }
}

export function installErrorLogging(): void {
  const g = global as unknown as {
    ErrorUtils?: {
      setGlobalHandler: (h: (error: unknown, isFatal?: boolean) => void) => void;
      getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
    };
  };

  const describe = (error: unknown): { message: string; stack?: string } => {
    if (error instanceof Error) {
      return { message: `${error.name}: ${error.message}`, stack: error.stack };
    }
    if (error && typeof error === 'object') {
      const e = error as { name?: string; message?: string; stack?: string };
      if (e.message) return { message: `${e.name ?? 'Error'}: ${e.message}`, stack: e.stack };
      try {
        return { message: JSON.stringify(error) };
      } catch {
        return { message: String(error) };
      }
    }
    return { message: String(error) };
  };

  // 1) Uncaught / fatal JS errors.
  if (g.ErrorUtils?.setGlobalHandler) {
    const previous = g.ErrorUtils.getGlobalHandler?.();
    g.ErrorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      const { message, stack } = describe(error);
      // Distinct emoji + tag makes these trivial to spot / grep in the
      // stream of Metro logs.
      console.error(`${isFatal ? '🔴 [ErrandGuy] FATAL' : '🟠 [ErrandGuy] ERROR'}: ${message}`);
      if (stack) console.error(stack);
      // Forward FATAL crashes to the server (release builds have no console).
      if (isFatal) forwardCrash({ message, stack, fatal: true });
      // Keep the platform's default behaviour (dev redbox / crash report).
      previous?.(error, isFatal);
    });
  }

  // 2) Unhandled promise rejections — async errors that never got a .catch().
  //    These are the silent ones: no redbox, the app just misbehaves.
  try {
    // React Native bundles the `promise` polyfill which exposes rejection
    // tracking. Requiring the internal path is the documented way to enable
    // it; guard in try/catch in case the JS engine doesn't expose it.
    const tracking = require('promise/setimmediate/rejection-tracking');
    tracking.enable({
      allRejections: true,
      onUnhandled: (_id: number, error: unknown) => {
        const { message, stack } = describe(error);
        console.error(`🟠 [ErrandGuy] UNHANDLED PROMISE REJECTION: ${message}`);
        if (stack) console.error(stack);
      },
      onHandled: () => {
        // A rejection that was handled late — no need to log.
      },
    });
  } catch {
    // rejection-tracking unavailable — the global handler above still
    // covers synchronous crashes and most async ones.
  }
}

/**
 * Report a caught render error to the same greppable log stream used by
 * the global handlers above. Called by <ErrorBoundary/> from
 * componentDidCatch — a React render error is caught by React and never
 * reaches ErrorUtils, so we surface it here with the same tag/format so
 * every crash path looks identical in the Metro terminal (and any
 * attached remote logger). `componentStack` is React's own component
 * trace, which pinpoints the failing subtree far better than the JS stack.
 */
export function reportError(
  error: unknown,
  componentStack?: string | null,
): void {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : String((error as { message?: string } | null)?.message ?? error);
  console.error(`🔴 [ErrandGuy] RENDER ERROR: ${message}`);
  if (error instanceof Error && error.stack) console.error(error.stack);
  if (componentStack) console.error(`Component stack:${componentStack}`);

  // A render error is a crash of the subtree — forward it too.
  forwardCrash({
    message,
    stack: error instanceof Error ? error.stack : undefined,
    component_stack: componentStack ?? undefined,
    fatal: true,
  });
}
