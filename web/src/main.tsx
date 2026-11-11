import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { FeedbackProvider } from "./components/ui/feedback";
import { TooltipProvider } from "./components/ui/tooltip";
import { ApiError, isServerStarting } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Keep retrying while the host wakes up; don't retry permission/validation errors; retry other failures once.
      retry: (count, err) => (isServerStarting(err) ? count < 6 : !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 1),
      retryDelay: (attempt, err) => (isServerStarting(err) ? 5_000 : Math.min(1000 * 2 ** attempt, 30_000)),
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <FeedbackProvider>
            <App />
          </FeedbackProvider>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
