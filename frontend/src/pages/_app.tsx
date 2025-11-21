import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { useEffect } from "react";

import "@/styles/globals.css";

function SessionRefreshListener() {
  const { update } = useSession();

  useEffect(() => {
    const handleTokenRefreshed = async (event: Event) => {
      const { backendToken, refreshToken } = (event as CustomEvent<{
        backendToken: string;
        refreshToken: string;
      }>).detail || {};

      if (!backendToken) return;

      try {
        await update({
          backendToken,
          refreshToken,
        });

        if (typeof window !== "undefined") {
          try {
            sessionStorage.removeItem("temp_access_token");
            sessionStorage.removeItem("temp_refresh_token");
          } catch (storageError) {
            // Ignore storage errors
          }
        }
      } catch (err) {
        console.error("Failed to persist refreshed tokens:", err);
      }
    };

    window.addEventListener("token-refreshed", handleTokenRefreshed);

    return () => {
      window.removeEventListener("token-refreshed", handleTokenRefreshed);
    };
  }, [update]);

  return null;
}

export default function App({ Component, pageProps }: AppProps) {
  const { session, ...rest } = pageProps as any;
  return (
    <SessionProvider session={session}>
      <SessionRefreshListener />
      <Component {...rest} />
    </SessionProvider>
  );
}
