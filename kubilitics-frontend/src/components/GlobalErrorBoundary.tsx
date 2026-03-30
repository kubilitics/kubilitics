import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { ErrorTracker } from '@/lib/errorTracker';
import { CrashReportDialog } from '@/components/CrashReportDialog';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorId: string | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = {
            hasError: false,
            error: null,
            errorId: null,
        };
    }

    static getDerivedStateFromError(error: Error): State {
        return {
            hasError: true,
            error,
            errorId: null,
        };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('GLOBAL_ERROR_BOUNDARY_CAUGHT:', error);
        const errorId = ErrorTracker.captureException(error, {
            extra: {
                componentStack: errorInfo.componentStack,
            },
        });

        this.setState({ errorId });
    }

    handleReload = () => {
        window.location.reload();
    };

    handleGoHome = () => {
        // In Tauri (MemoryRouter), window.location.reload() resets to the start route.
        // Using href='/index.html' works for Tauri; '/' works for browser.
        window.location.reload();
    };

    render() {
        if (this.state.hasError && this.state.error) {
            return (
                <CrashReportDialog
                    error={this.state.error}
                    errorId={this.state.errorId}
                />
            );
        }

        return this.props.children;
    }
}

/**
 * Route-level error boundary: catches errors in a single route/page without
 * crashing the whole app (layout/sidebar stays intact). Shows an inline error
 * panel with a "Try Again" button that resets the boundary so the user can
 * retry without a full reload.
 *
 * Usage: wrap individual route elements or the <Suspense> block inside each route.
 */

interface RouteErrorBoundaryProps {
    children: ReactNode;
    /** Optional route name shown in the error panel (e.g. "Pods"). */
    routeName?: string;
    /** Optional callback when the user clicks "Go Back" — typically useNavigate(-1). */
    onGoBack?: () => void;
}

interface RouteErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
    constructor(props: RouteErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ROUTE_ERROR_BOUNDARY_CAUGHT:', error);
        ErrorTracker.captureException(error, {
            extra: { componentStack: errorInfo.componentStack, routeName: this.props.routeName },
        });
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="flex flex-col items-center justify-center min-h-[50vh] p-8 text-center">
                    <div className="w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                        <AlertCircle className="h-6 w-6 text-red-500 dark:text-red-400" />
                    </div>
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-1">
                        {this.props.routeName ? `Failed to load ${this.props.routeName}` : 'Page error'}
                    </h2>
                    <p className="text-sm text-muted-foreground mb-2 max-w-sm">
                        {this.state.error?.message || 'An unexpected error occurred loading this page.'}
                    </p>
                    <div className="flex gap-2 mt-4">
                        {this.props.onGoBack && (
                            <Button variant="outline" size="sm" onClick={this.props.onGoBack}>
                                <Home className="mr-2 h-4 w-4" />
                                Go Back
                            </Button>
                        )}
                        <Button size="sm" onClick={this.handleReset}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Try Again
                        </Button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
