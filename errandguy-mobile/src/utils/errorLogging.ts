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

/**
 * Best-effort forward of a CRASH (a fatal JS error or a React render error) to
 * the server, so a production crash on a release build — where console.* goes
 * nowhere — becomes a visible, alertable server-side signal instead of
 * vanishing. Fire-and-forget: it must never throw, never block the crash path,
 * and never recurse. A failed POST rejects a promise we have ALREADY caught, so
 * it can't re-enter through the unhandled-rejection tracker; the `forwarding`
 * flag is a second guard against re-entrancy. Only crashes are forwarded (not
 * every logged warning / unhandled rejection) to keep volume — and cost — low.
 */
let forwarding = false;
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
        { ...payload, platform: Platform.OS },
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
