"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { LocaleProvider } from "@/shared/i18n/context";
import { AuthProvider } from "@/shared/auth/auth-context";
import { AppSplash } from "@/shared/components/ui/app-splash";

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime:15_000, retry:1 } }
  }));

  // Registers public/sw.js -- see that file's own comment for why it's a
  // deliberate no-op passthrough (PWA installability, not offline
  // caching). Safe to call unconditionally; browsers without service
  // worker support just skip it.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Registration failing (e.g. unsupported browser, blocked by an
        // extension) should never affect the app itself -- this is purely
        // an installability nice-to-have.
      });
    }
  }, []);

  return (
    <AuthProvider>
      <QueryClientProvider client={client}>
        <LocaleProvider>
          <AppSplash />
          {children}
          <Toaster richColors position="bottom-right" toastOptions={{ style:{ borderRadius:8 } }} />
        </LocaleProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
}
