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
  },
  debug: process.env.NODE_ENV === "development",
  providers: [
    CredentialsProvider({
      name: "Password Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        mode: { label: "Mode", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error("Email and password are required");
        }

        const endpoint =
          credentials.mode === "super_admin" ? "/api/auth/superadmin-login" : "/api/auth/login";

        try {
          const response = await fastApiClient.post(endpoint, {
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
            token: data.token,
          };
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
        
        // Quick health check before OAuth login
        try {
          await fastApiClient.get("/health", { timeout: 10000 });
        } catch (healthError: any) {
          console.error("Backend health check failed:", healthError);
          if (healthError?.code === "ECONNREFUSED" || healthError?.message?.includes("ECONNREFUSED")) {
            throw new Error("Backend server is not running. Please start the backend server on http://localhost:8000");
          } else if (healthError?.code === "ETIMEDOUT" || healthError?.message?.includes("timeout")) {
            throw new Error("Backend server is not responding. Please check if it's running on http://localhost:8000");
          }
          // If health check fails but it's not a connection issue, continue with OAuth login
        }
        
        console.log("Calling backend OAuth login at:", `${baseURL}/api/auth/oauth-login`);
        
        const response = await fastApiClient.post("/api/auth/oauth-login", {
          email: user.email,
          name: user.name ?? (profile as any)?.name ?? user.email.split("@")[0],
          provider: account.provider,
        });

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
          token: data.token,
        };

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
    async jwt({ token, user, account }) {
      if (user) {
        token.id = (user as BackendUser).id ?? token.sub;
        token.role = (user as BackendUser).role ?? token.role;
        token.organization = (user as BackendUser).organization ?? token.organization;
        token.backendToken = (user as BackendUser).token ?? token.backendToken;
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
      }

      (session as any).backendToken = token.backendToken as string | undefined;
      (session as any).provider = token.provider as string | undefined;
      return session;
    },
  },
};

export default NextAuth(authOptions);
