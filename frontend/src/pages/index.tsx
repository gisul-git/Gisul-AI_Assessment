'use client'

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";
import Navbar from "@/components/landing/Navbar";
import ScrollProgress from "@/components/landing/ScrollProgress";
import Hero from "@/components/landing/Hero";
import SocialProof from "@/components/landing/SocialProof";
import Features from "@/components/landing/Features";
import HowItWorks from "@/components/landing/HowItWorks";
import Testimonials from "@/components/landing/Testimonials";
import Pricing from "@/components/landing/Pricing";
import FAQ from "@/components/landing/FAQ";
import FinalCTA from "@/components/landing/FinalCTA";
import Footer from "@/components/landing/Footer";

export default function HomePage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    // Only redirect authenticated users away from home page
    // Add a small delay to prevent race conditions with signin redirects
    if (status === "authenticated") {
      const redirectTimer = setTimeout(async () => {
        try {
          // Check if we just signed in (session storage flag set by signin page)
          const justSignedIn = typeof window !== "undefined" && 
            sessionStorage.getItem("justSignedIn") === "true";
          
          // If we just signed in, clear the flag and let signin page handle redirect
          if (justSignedIn) {
            sessionStorage.removeItem("justSignedIn");
            return; // Don't redirect, signin page will handle it
          }
          
          const session = await fetch("/api/auth/session").then((res) => res.json());
          const userRole = session?.user?.role;
          
          if (userRole === "super_admin") {
            router.replace("/super-admin");
          } else if (userRole) {
            // Only redirect if we have a role (org_admin, editor, viewer, etc.)
            router.replace("/dashboard");
          }
        } catch (error) {
          // If session fetch fails, don't redirect (let user stay on home page)
          console.error("Failed to fetch session for redirect:", error);
        }
      }, 200); // Small delay to allow signin redirects to complete
      
      return () => clearTimeout(redirectTimer);
    }
  }, [status, router]);

  return (
    <main>
      <ScrollProgress />
      <Navbar />
      <Hero />
      <SocialProof />
      <Features />
      <HowItWorks />
      <Testimonials />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  );
}
