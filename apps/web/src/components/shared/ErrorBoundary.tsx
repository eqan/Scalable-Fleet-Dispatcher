/**
 * ErrorBoundary -- catches React render errors with graceful fallback.
 *
 * Production-grade error handling:
 *   - Prevents the entire app from crashing on component errors
 *   - Shows a dark-themed error card with recovery action
 *   - Logs error details to console (extensible to telemetry)
 *   - "Try Again" resets the boundary and re-renders children
 *
 * This is a class component because React only supports error
 * boundaries via componentDidCatch / getDerivedStateFromError.
 */

import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional custom fallback UI. Falls back to built-in card. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log for debugging / future telemetry integration
    console.error("[ErrorBoundary] Caught error:", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="error-boundary">
          <div className="error-boundary__card">
            <div className="error-boundary__icon">!</div>
            <h2 className="error-boundary__title">Something went wrong</h2>
            <p className="error-boundary__message">
              {this.state.error?.message ?? "An unexpected error occurred"}
            </p>
            <div className="error-boundary__actions">
              <button className="btn btn-primary" onClick={this.handleReset}>
                Try Again
              </button>
              <button
                className="btn"
                onClick={() => window.location.reload()}
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
