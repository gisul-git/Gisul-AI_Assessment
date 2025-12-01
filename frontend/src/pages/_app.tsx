import type { AppProps } from "next/app";
import { SessionProvider, useSession } from "next-auth/react";
import { useEffect, useRef } from "react";
import { getSession } from "next-auth/react";
import { checkTokenExpiration } from "@/lib/jwt";
import axios from "axios";
import Lenis from "lenis";

import "@/styles/globals.css";

function SmoothScroll() {
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      orientation: 'vertical',
      gestureOrientation: 'vertical',
      smoothWheel: true,
      wheelMultiplier: 1,
      smoothTouch: false,
      touchMultiplier: 2,
      infinite: false,
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);

  return null;
}

function SessionRefreshListener() {
  const { update } = useSession();
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);

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

    // Proactive token refresh: Check every 5 minutes and refresh if expiring soon
    const checkAndRefreshToken = async () => {
      try {
        const session = await getSession();
        const token = (session as any)?.backendToken;
        
        if (!token) {
          return;
        }

        const tokenStatus = checkTokenExpiration(token, 5); // Check if expiring within 5 minutes
        
        if (tokenStatus.isExpired || tokenStatus.isExpiringSoon) {
          const refreshToken = (session as any)?.refreshToken || 
            (typeof window !== "undefined" ? sessionStorage.getItem("temp_refresh_token") : null);
          
          if (refreshToken) {
            try {
              const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
              const response = await axios.post(
                `${baseURL}/api/auth/refresh-token`,
                { refreshToken }
              );

              const newAccessToken = response.data?.data?.token;
              const newRefreshToken = response.data?.data?.refreshToken;

              if (newAccessToken) {
                // Store temporarily
                if (typeof window !== "undefined") {
                  try {
                    sessionStorage.setItem("temp_access_token", newAccessToken);
                    if (newRefreshToken) {
                      sessionStorage.setItem("temp_refresh_token", newRefreshToken);
                    }
                  } catch (e) {
                    // Ignore storage errors
                  }
                }

                // Trigger session update
                window.dispatchEvent(
                  new CustomEvent("token-refreshed", {
                    detail: {
                      backendToken: newAccessToken,
                      refreshToken: newRefreshToken || refreshToken,
                    }
                  })
                );
              }
            } catch (error) {
              console.error("Proactive token refresh failed:", error);
              // If refresh fails and token is expired, redirect to login
              if (tokenStatus.isExpired) {
                if (typeof window !== "undefined") {
                  window.location.href = "/auth/signin";
                }
              }
            }
          } else if (tokenStatus.isExpired) {
            // No refresh token and token is expired, redirect to login
            if (typeof window !== "undefined") {
              window.location.href = "/auth/signin";
            }
          }
        }
      } catch (error) {
        console.error("Error checking token expiration:", error);
      }
    };

    // Check immediately on mount
    checkAndRefreshToken();

    // Then check every 5 minutes (300000 ms)
    refreshIntervalRef.current = setInterval(checkAndRefreshToken, 5 * 60 * 1000);

    return () => {
      window.removeEventListener("token-refreshed", handleTokenRefreshed);
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [update]);

  return null;
}

export default function App({ Component, pageProps }: AppProps) {
  const { session, ...rest } = pageProps as any;
  return (
    <SessionProvider session={session}>
      <SmoothScroll />
      <SessionRefreshListener />
      <Component {...rest} />
    </SessionProvider>
  );
}
