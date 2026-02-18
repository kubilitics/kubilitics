import React from 'react';
import { Loader2 } from 'lucide-react';

interface PageLoadingStateProps {
    message?: string;
    className?: string;
    fullScreen?: boolean;
}

export function PageLoadingState({
    message = 'Loading...',
    className = '',
    fullScreen = true,
}: PageLoadingStateProps) {
    const containerClasses = fullScreen
        ? 'min-h-[60vh] flex items-center justify-center'
        : 'py-12 flex items-center justify-center';

    return (
        <div className={`${containerClasses} ${className}`}>
            <div className="text-center space-y-3">
                <Loader2 className="h-10 w-10 animate-spin text-primary mx-auto opacity-80" />
                <p className="text-muted-foreground text-sm font-medium animate-pulse">
                    {message}
                </p>
            </div>
        </div>
    );
}
