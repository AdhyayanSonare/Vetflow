import { Toaster } from "@/components/ui/sonner";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

function Router() {
  return (
    <Switch>
      <Route path={"/404"} component={NotFound} />
      {/* One Home instance owns every module path, so the store and shell
          aren't remounted when moving between "/" and other routes. */}
      <Route component={Home} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <Toaster position="top-center" />
        <Router />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
