import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { useEffect } from "react";

import "@/styles/globals.css";

// Component to handle global token refresh
function TokenRefreshHandler() {
  const { update: updateSession } = useSession();

  useEffect(() => {
    // Listen for token refresh events from the interceptor
    const handleTokenRefresh = async (event: Event) => {
      const customEvent = event as CustomEvent<{ backendToken: string; refreshToken: string }>;
      const { backendToken, refreshToken } = customEvent.detail;
      console.log("Token refreshed globally, updating NextAuth session...");
      try {
        await updateSession({
          backendToken,
          refreshToken,
        });
        console.log("NextAuth session updated successfully");
      } catch (err) {
        console.error("Failed to update NextAuth session:", err);
      }
    };

    window.addEventListener("token-refreshed", handleTokenRefresh);

    return () => {
      window.removeEventListener("token-refreshed", handleTokenRefresh);
    };
  }, [updateSession]);

  return null;
}

export default function App({ Component, pageProps }: AppProps) {
  const { session, ...rest } = pageProps as any;
  return (
    <SessionProvider session={session}>
      <TokenRefreshHandler />
      <Component {...rest} />
    </SessionProvider>
  );
}
