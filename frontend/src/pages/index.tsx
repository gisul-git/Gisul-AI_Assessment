import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession } from "next-auth/react";
import { useRouter } from "next/router";

export default function HomePage() {
  const { status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  return (
    <main style={{ backgroundColor: "#0f172a", minHeight: "100vh", color: "#f8fafc" }}>
      <header style={{ padding: "2rem 1.5rem", borderBottom: "1px solid rgba(148, 163, 184, 0.3)" }}>
        <div  
          style={{
            maxWidth: "1100px",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}         
        >
          <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
            <Image src="/logo.svg" alt="AI Assessment Platform" width={56} height={56} />
            <span style={{ fontSize: "1.25rem", fontWeight: 600 }}>AI Assessment Platform</span>
          </div>
          
        </div>
      </header>

      <section
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
          padding: "5rem 1.5rem 3rem",
          display: "grid",
          gap: "3rem",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          alignItems: "center",
        }}
      >
        <div>
          <h1 style={{ fontSize: "3rem", lineHeight: 1.1, marginBottom: "1.5rem" }}>
            Intelligent hiring for high-performing teams
          </h1>
          <p style={{ color: "#cbd5f5", fontSize: "1.125rem", lineHeight: 1.8, marginBottom: "2rem" }}>
            Design AI-powered assessments, generate job-specific topics in seconds, and manage candidates in a secure,
            collaborative workspace. Built for fast-growing organizations that demand smarter hiring decisions.
          </p>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <Link href="/auth/signin" className="btn-primary" style={{ backgroundColor: "#2563eb" }}>
              Get a Demo
            </Link>
  
          </div>
        </div>
      </section>

      <footer
        style={{
          padding: "2rem 1.5rem",
          borderTop: "1px solid rgba(148, 163, 184, 0.3)",
          color: "#94a3b8",
          textAlign: "center",
        }}
      >
        © {new Date().getFullYear()} AI Assessment Platform. All rights reserved.
      </footer>
    </main>
  );
}
