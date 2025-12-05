import type { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

import fastApiClient from "../../../lib/fastapi";
import type { BackendUser } from "../../../types/auth";

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days (matches refresh token expiration)
  },
  debug: process.env.NODE_ENV === "development",
  useSecureCookies: process.env.NODE_ENV === "production", // Secure cookies only in production
  cookies: {
    sessionToken: {
      name: `${process.env.NODE_ENV === "production" ? "__Secure-" : ""}next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: "lax", // Changed from strict to allow OAuth redirects
        path: "/",
        secure: process.env.NODE_ENV === "production", // Only secure in production
      },
    },
  },
  providers: [
    CredentialsProvider({
      name: "Password Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        try {
          const response = await fastApiClient.post("/api/auth/login", {
            email: credentials.email,
            password: credentials.password,
          });

          const data = response.data?.data;
          if (!data?.token || !data?.user) {
            throw new Error("Invalid response from authentication service");
          }

          const backendUser: BackendUser = {
            id: data.user.id,
            name: data.user.name,
            email: data.user.email,
            role: data.user.role,
            organization: data.user.organization,
            phone: data.user.phone || undefined,
            country: data.user.country || undefined,
            token: data.token,
            refreshToken: data.refreshToken, // Store refresh token
          } as BackendUser;
          return backendUser;
        } catch (error: any) {
          throw new Error(error?.message ?? "Authentication failed");
        }
      },
    }),
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    AzureADProvider({
      clientId: process.env.AZURE_AD_CLIENT_ID ?? "",
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET ?? "",
      tenantId: process.env.AZURE_AD_TENANT_ID ?? "common",
      authorization: { params: { prompt: "select_account" } },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (!account || account.provider === "credentials") {
        return true;
      }

      if (!user?.email) {
        throw new Error("Email is required for OAuth login");
      }

      try {
        const baseURL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        
        // Skip health check for OAuth - go directly to login
        // Health check was causing timeouts. OAuth login will fail fast if backend is down.
        console.log("Calling backend OAuth login at:", `${baseURL}/api/auth/oauth-login`);
        
        let response;
        try {
          // Use a longer timeout for OAuth login (30 seconds)
          response = await fastApiClient.post("/api/auth/oauth-login", {
            email: user.email,
            name: user.name ?? (profile as any)?.name ?? user.email.split("@")[0],
            provider: account.provider,
          }, {
            timeout: 30000, // 30 seconds for OAuth login
          });
        } catch (oauthError: any) {
          console.error("OAuth login API call failed:", {
            code: oauthError?.code,
            message: oauthError?.message,
            status: oauthError?.response?.status,
            data: oauthError?.response?.data,
            baseURL,
          });
          
          // Provide specific error messages
          if (oauthError?.code === "ECONNREFUSED" || oauthError?.message?.includes("ECONNREFUSED")) {
            throw new Error("Cannot connect to backend server. Please ensure the backend is running on http://localhost:8000");
          } else if (oauthError?.code === "ETIMEDOUT" || oauthError?.message?.includes("timeout")) {
            throw new Error("Backend request timed out. Please ensure the backend server is running and MongoDB is connected.");
          } else if (oauthError?.code === "ERR_NETWORK" || oauthError?.message?.includes("Network Error")) {
            throw new Error("Network error. Please check if the backend server is running on http://localhost:8000");
          }
          // Re-throw with original error details
          throw oauthError;
        }

        const data = response.data?.data;
        if (!data?.token || !data?.user) {
          console.error("Invalid OAuth response:", response.data);
          throw new Error("Invalid response from authentication service");
        }

        const backendUser: BackendUser = {
          id: data.user.id,
          name: data.user.name,
          email: data.user.email,
          role: data.user.role,
          organization: data.user.organization,
          phone: data.user.phone || undefined,
          country: data.user.country || undefined,
          token: data.token,
          refreshToken: data.refreshToken, // Store refresh token
        } as BackendUser;

        Object.assign(user, backendUser);
        console.log("OAuth sign-in successful for:", user.email);
        return true;
      } catch (error: any) {
        console.error("OAuth sign-in failed:", {
          message: error?.message,
          response: error?.response?.data,
          status: error?.response?.status,
          code: error?.code,
          baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000",
        });
        
        // Provide more helpful error messages
        if (error?.code === "ECONNREFUSED" || error?.message?.includes("ECONNREFUSED")) {
          throw new Error("Cannot connect to backend server. Please ensure the backend is running on http://localhost:8000");
        } else if (error?.code === "ETIMEDOUT" || error?.message?.includes("timeout")) {
          throw new Error("Backend request timed out. Please ensure the backend server is running and MongoDB is connected. Check http://localhost:8000/health");
        } else if (error?.code === "ERR_NETWORK" || error?.message?.includes("Network Error")) {
          throw new Error("Network error. Please check if the backend server is running on http://localhost:8000");
        }
        
        throw new Error((error?.response?.data?.detail || error?.response?.data?.message || error?.message) ?? "OAuth sign-in failed");
      }
    },
    async jwt({ token, user, account, trigger, session }) {
      // Handle token refresh via update() call
      if (trigger === "update" && session) {
        const updatedSession = session as any;
        if (updatedSession.backendToken) {
          token.backendToken = updatedSession.backendToken;
        }
        if (updatedSession.refreshToken) {
          token.refreshToken = updatedSession.refreshToken;
        }
        return token;
      }

      if (user) {
        token.id = (user as BackendUser).id ?? token.sub;
        token.role = (user as BackendUser).role ?? token.role;
        token.organization = (user as BackendUser).organization ?? token.organization;
        token.phone = ((user as any) as BackendUser).phone ?? token.phone;
        token.country = ((user as any) as BackendUser).country ?? token.country;
        token.backendToken = (user as BackendUser).token ?? token.backendToken;
        token.refreshToken = (user as BackendUser).refreshToken ?? token.refreshToken;
      }

      if (account) {
        token.provider = account.provider;
      }

      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id as string;
        (session.user as any).role = token.role as string | undefined;
        (session.user as any).organization = token.organization as string | undefined;
        (session.user as any).phone = token.phone as string | undefined;
        (session.user as any).country = token.country as string | undefined;
      }

      (session as any).backendToken = token.backendToken as string | undefined;
      (session as any).refreshToken = token.refreshToken as string | undefined;
      (session as any).provider = token.provider as string | undefined;
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Handle role-based redirects
      // If redirecting to home page or dashboard, we'll let the pages handle it
      // This prevents interfering with explicit redirects from signin
      if (url === `${baseUrl}/` || url === baseUrl) {
        // If going to home, let home page handle redirect based on role
        return url;
      }
      
      // For other URLs, allow them through
      return url.startsWith(baseUrl) ? url : baseUrl;
    },
  },
};

export default NextAuth(authOptions);
