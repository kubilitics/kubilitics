import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';
import { ErrorTracker } from '@/lib/errorTracker';

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
            errorId: null, // Will be set in componentDidCatch
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
        window.location.href = '/';
    };

    render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
                    <Card className="w-full max-w-md shadow-lg border-red-200 dark:border-red-900">
                        <CardHeader className="text-center pb-2">
                            <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center mb-4">
                                <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                            </div>
                            <CardTitle className="text-xl text-red-700 dark:text-red-400">
                                Something went wrong
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="text-center space-y-4">
                            <p className="text-muted-foreground text-sm">
                                We encountered an unexpected error. Ideally, you shouldn't see this.
                            </p>

                            {this.state.error && (
                                <div className="text-left bg-gray-100 dark:bg-gray-800 p-3 rounded-md overflow-auto max-h-32 text-xs font-mono text-red-900 dark:text-red-300 border border-gray-200 dark:border-gray-700">
                                    {this.state.error.toString()}
                                </div>
                            )}

                            {this.state.errorId && (
                                <p className="text-xs text-gray-400">
                                    Error ID: <span className="font-mono select-all">{this.state.errorId}</span>
                                </p>
                            )}
                        </CardContent>
                        <CardFooter className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
                            <Button onClick={this.handleReload} variant="default" className="w-full sm:w-auto">
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Reload Page
                            </Button>
                            <Button onClick={this.handleGoHome} variant="outline" className="w-full sm:w-auto">
                                <Home className="mr-2 h-4 w-4" />
                                Go Home
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            );
        }

        return this.props.children;
    }
}
