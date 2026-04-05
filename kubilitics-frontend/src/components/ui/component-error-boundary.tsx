import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  name: string;
}

interface State {
  hasError: boolean;
  error: string;
}

/**
 * Lightweight error boundary for individual page sections/components.
 * When a child throws, this renders an inline fallback instead of crashing
 * the entire page.
 */
export class ComponentErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: '' };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center py-8 px-4 text-muted-foreground">
          <AlertTriangle className="h-6 w-6 mb-2 text-amber-500" />
          <p className="text-sm font-medium">Failed to load {this.props.name}</p>
          <p className="text-xs mt-1">{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}
