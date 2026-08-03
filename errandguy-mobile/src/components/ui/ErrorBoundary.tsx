import React, { type ErrorInfo } from 'react';
import { View, StyleSheet } from 'react-native';
import * as Updates from 'expo-updates';
import { AlertTriangle } from 'lucide-react-native';
import { ErrorState } from './ErrorState';
import { Button } from './Button';
import { reportError } from '../../utils/errorLogging';
import { LightColors } from '../../constants/colors';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Global render-error boundary.
 *
 * React render errors are caught by React itself and never reach the
 * ErrorUtils global handler installed in utils/errorLogging.ts — so
 * without a boundary a bad render blanks the whole app (or shows a bare
 * redbox in dev). This catches those, reports them to the same greppable
 * log stream, and shows the app's own full-screen ErrorState so the user
 * gets a real recovery path instead of a white screen.
 *
 * Two recovery actions:
 *  - "Try again" — clears the error state and re-renders the subtree. Good
 *    for a transient failure (a stale prop, a one-off null).
 *  - "Reload app" — Updates.reloadAsync() restarts the JS bundle from
 *    scratch. Good when the render is wedged and a clean boot is safer.
 *    No-op-safe in dev / Expo Go (reloadAsync is a soft reload there).
 *
 * Class component by necessity — getDerivedStateFromError /
 * componentDidCatch have no hooks equivalent.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(error, info?.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false });
  };

  private handleReload = () => {
    Updates.reloadAsync().catch(() => {
      // reloadAsync throws when updates aren't enabled (dev / Expo Go).
      // Fall back to a state reset so the button is never a dead end.
      this.handleReset();
    });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={s.fill}>
        <ErrorState
          icon={AlertTriangle}
          illustration={null}
          title="Something went wrong"
          description="The app hit an unexpected error. Try again, or reload to start fresh."
          onRetry={this.handleReset}
          retryLabel="Try again"
        />
        <View style={s.reloadRow}>
          <Button
            title="Reload app"
            variant="ghost"
            size="md"
            onPress={this.handleReload}
            accessibilityHint="Restarts the app from a clean state"
          />
        </View>
      </View>
    );
  }
}

const s = StyleSheet.create({
  fill: {
    flex: 1,
    backgroundColor: LightColors.background,
  },
  reloadRow: {
    alignItems: 'center',
    paddingBottom: 40,
  },
});
