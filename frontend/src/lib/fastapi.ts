import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { getSession } from "next-auth/react";

const fastApiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
  headers: {
    "Content-Type": "application/json",
  },
  timeout: 120000, // 120 seconds (2 minutes) timeout - increased for slow backend responses
});

// Request interceptor to add Authorization header
fastApiClient.interceptors.request.use(
  async (config) => {
    // Only add token for admin API routes (not auth routes or candidate assessment routes)
    // Candidate assessment routes use token from URL params, not JWT
    const isAuthRoute = config.url?.includes("/api/auth/");
    const isCandidateRoute = config.url?.includes("/api/assessment/");
    
    if (!isAuthRoute && !isCandidateRoute && typeof window !== "undefined") {
      // Check for temporary token first (from recent refresh)
      let token: string | null = null;
      try {
        token = sessionStorage.getItem("temp_access_token");
      } catch (e) {
        // Ignore storage errors
      }

      // Priority: Check sessionStorage first (has latest refreshed tokens)
      // Then fallback to session (may have expired tokens)
      if (!token && typeof window !== "undefined") {
        try {
          token = sessionStorage.getItem("temp_access_token");
        } catch (e) {
          // Ignore storage errors
        }
      }
      
      // If no temp token, get from session
      if (!token) {
        const session = await getSession();
        token = session?.backendToken || null;
      }

      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Flag to prevent multiple simultaneous refresh attempts
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (value?: any) => void;
  reject: (error?: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

// Response interceptor to handle token refresh
fastApiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // If error is 401 and we haven't retried yet
    if (error.response?.status === 401 && !originalRequest._retry && typeof window !== "undefined") {
      if (isRefreshing) {
        // If already refreshing, queue this request
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return fastApiClient(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const session = await getSession();
        let refreshToken = (session as any)?.refreshToken;
        
        // Fallback: check sessionStorage for temp refresh token
        if (!refreshToken && typeof window !== "undefined") {
          try {
            refreshToken = sessionStorage.getItem("temp_refresh_token");
          } catch (e) {
            // Ignore storage errors
          }
        }

        if (!refreshToken) {
          // No refresh token, redirect to login
          console.error("No refresh token available in session or sessionStorage");
          processQueue(new Error("No refresh token available"), null);
          if (typeof window !== "undefined") {
            window.location.href = "/auth/signin";
          }
          return Promise.reject(error);
        }

        // Call refresh token endpoint
        const response = await axios.post(
          `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/auth/refresh-token`,
          { refreshToken }
        );

        const newAccessToken = response.data?.data?.token;
        const newRefreshToken = response.data?.data?.refreshToken;

        if (newAccessToken) {
          // Update the request with new access token
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
          }

          // Store new tokens in sessionStorage for immediate use
          // These will be used by the request interceptor before checking the session
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
          
          // CRITICAL: Trigger session update by dispatching a custom event
          // Components listening to this event will call update() to refresh the NextAuth session
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("token-refreshed", {
              detail: {
                backendToken: newAccessToken,
                refreshToken: newRefreshToken || refreshToken,
              }
            }));
          }

          processQueue(null, newAccessToken);

          // Retry the original request
          return fastApiClient(originalRequest);
        } else {
          throw new Error("Failed to refresh token");
        }
      } catch (refreshError) {
        processQueue(refreshError, null);
        // Refresh failed, redirect to login
        if (typeof window !== "undefined") {
          window.location.href = "/auth/signin";
        }
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Extract error message from different possible response structures
    let message = error.message;
    
    if (error.response?.data) {
      // Try different possible error message fields
      message = (error.response.data as any).detail || 
                (error.response.data as any).message || 
                (error.response.data as any).error ||
                (error.response.data as any).msg ||
                error.message;
      
      // Handle array of messages
      if (Array.isArray(message)) {
        message = message.join(", ");
      }
    }
    
    return Promise.reject(new Error(message || "An error occurred. Please try again."));
  }
);

export default fastApiClient;
