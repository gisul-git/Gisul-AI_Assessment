import type { NextAuthOptions } from "next-auth";
import NextAuth from "next-auth";
import AzureADProvider from "next-auth/providers/azure-ad";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";

import fastApiClient from "lib/fastapi";
import type { BackendUser } from "types/auth";

export const authOptions: NextAuthOptions = {
  pages: {
    signIn: "/auth/signin",
  },
  session: {
    strategy: "jwt",
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
        const response = await fastApiClient.post("/api/auth/oauth-login", {
          email: user.email,
          name: user.name ?? (profile as any)?.name ?? user.email.split("@")[0],
          provider: account.provider,
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

        Object.assign(user, backendUser);
        return true;
      } catch (error: any) {
        console.error("OAuth sign-in failed", error);
        throw new Error(error?.message ?? "OAuth sign-in failed");
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
