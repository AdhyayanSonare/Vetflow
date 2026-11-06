import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type State = { failed: boolean };

/**
 * Last line of defence: a rendering bug shows a plain message and a reload button, not a blank page.
 * The technical detail goes to the console for support, and is never shown to the user.
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] unhandled error:", error.message, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="flex max-w-md flex-col items-center gap-4 text-center">
          <AlertTriangle className="size-10 text-danger" />
          <h1>Something went wrong</h1>
          <p className="text-muted-foreground">The page hit an unexpected problem. Your saved work is safe. Reload to continue.</p>
          <Button onClick={() => window.location.reload()}><RotateCcw /> Reload</Button>
        </div>
      </div>
    );
  }
}
