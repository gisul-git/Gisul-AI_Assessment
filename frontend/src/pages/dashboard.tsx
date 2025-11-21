import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { GetServerSideProps } from "next";
import { requireAuth } from "../lib/auth";
import Link from "next/link";
import Image from "next/image";
import axios from "axios";

interface Assessment {
  id: string;
  title: string;
  status: string;
  hasSchedule: boolean;
  scheduleStatus?: {
    startTime?: string;
    endTime?: string;
    duration?: number;
    isActive?: boolean;
  } | null;
  createdAt?: string;
  updatedAt?: string;
}

interface DashboardPageProps {
  session: any;
}

export default function DashboardPage({ session: serverSession }: DashboardPageProps) {
  const { data: session, update: updateSession } = useSession();
  const router = useRouter();
  
  // Use server session if available, fallback to client session
  const activeSession = serverSession || session;
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = (activeSession?.user as any)?.role ?? "unknown";
  const isOrgAdmin = role === "org_admin";

  useEffect(() => {
    // Listen for token refresh events from the interceptor
    const handleTokenRefresh = async (event: Event) => {
      const customEvent = event as CustomEvent<{ backendToken: string; refreshToken: string }>;
      const { backendToken, refreshToken } = customEvent.detail;
      try {
        await updateSession({
          backendToken,
          refreshToken,
        });
        // Refetch assessments after session update
        setTimeout(() => {
          fetchAssessments();
        }, 300);
      } catch (err) {
        console.error("Failed to update NextAuth session:", err);
      }
    };

    window.addEventListener("token-refreshed", handleTokenRefresh);

    // Check if session has backendToken, if not try to refresh
    if (session?.user && !session.backendToken) {
      // Trigger a session update to re-run the JWT callback
      updateSession().then(() => {
        // Wait a bit for session to update, then fetch
        setTimeout(() => {
          fetchAssessments();
        }, 500);
      }).catch((err) => {
        console.error("Failed to update session:", err);
        fetchAssessments(); // Try anyway
      });
    } else {
      fetchAssessments();
    }

    return () => {
      window.removeEventListener("token-refreshed", handleTokenRefresh);
    };
  }, [session, updateSession]);

  const fetchAssessments = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.get("/api/assessments/list");
      if (response.data?.success && response.data?.data) {
        setAssessments(response.data.data);
      } else {
        setError(response.data?.message || "Failed to load assessments");
      }
    } catch (err: any) {
      console.error("Error fetching assessments:", err);
      const errorMsg = err.response?.data?.message || err.response?.data?.detail || err.message || "Failed to load assessments";
      
      // If it's a 401, the interceptor should handle token refresh automatically
      // But if it still fails, show the error
      if (err.response?.status === 401) {
        setError("Session expired. Please refresh the page or sign in again.");
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAssessment = async (assessmentId: string, assessmentTitle: string) => {
    if (!confirm(`Are you sure you want to delete "${assessmentTitle}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      const response = await axios.delete(`/api/assessments/delete-assessment?assessmentId=${assessmentId}`);
      
      if (response.data?.success) {
        setAssessments(assessments.filter((a) => a.id !== assessmentId));
      } else {
        setError(response.data?.message || "Failed to delete assessment");
      }
    } catch (err: any) {
      console.error("Error deleting assessment:", err);
      setError(err.response?.data?.message || err.message || "Failed to delete assessment");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready":
        return { bg: "#dcfce7", text: "#166534", border: "#10b981" };
      case "draft":
        return { bg: "rgba(105, 83, 163, 0.1)", text: "#6953a3", border: "#6953a3" };
      case "scheduled":
        return { bg: "rgba(105, 83, 163, 0.1)", text: "#6953a3", border: "#6953a3" };
      case "active":
        return { bg: "#dbeafe", text: "#1e40af", border: "#3b82f6" };
      default:
        return { bg: "#f1f5f9", text: "#475569", border: "#94a3b8" };
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateString;
    }
  };

  return (
    <div style={{ backgroundColor: "#f1dcba", minHeight: "100vh" }}>
      <header className="enterprise-header">
        <div className="enterprise-header-content">
          <div style={{ display: "flex", alignItems: "center", gap: "1rem", flex: 1, minWidth: 0, marginLeft: "-5rem" }}>
            <Image 
              src="/gisullogo.png" 
              alt="Gisul Logo" 
              width={250} 
              height={100} 
              style={{ 
                objectFit: "contain", 
                height: "auto", 
                maxHeight: "100px",
                width: "auto",
                maxWidth: "200px"
              }}
              priority
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <span className="mobile-hidden" style={{ fontSize: "0.875rem", opacity: 0.9 }}>
              {activeSession?.user?.email}
            </span>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/auth/signin" })}
              className="btn-secondary"
              style={{
                marginTop: 0,
                padding: "0.5rem 1rem",
                fontSize: "0.8125rem",
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                borderColor: "rgba(255, 255, 255, 0.3)",
                color: "#ffffff",
                whiteSpace: "nowrap",
              }}
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <div className="container">
        <div className="card" style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div>
              <h1 style={{ margin: 0, marginBottom: "0.5rem", fontSize: "clamp(1.5rem, 4vw, 2rem)", color: "#1a1625", fontWeight: 700 }}>
                Assessments Dashboard
              </h1>
              <p style={{ color: "#6b6678", margin: 0, fontSize: "0.875rem" }}>
                Signed in as <strong>{activeSession?.user?.email}</strong> • Role:{" "}
                <span className="badge badge-purple" style={{ marginLeft: "0.25rem" }}>
                  {role}
                </span>
              </p>
            </div>
            <Link href="/assessments/create-new" style={{ width: "100%" }}>
              <button type="button" className="btn-primary" style={{ marginTop: 0, width: "100%" }}>
                + Create New Assessment
              </button>
            </Link>
          </div>
        </div>

        {loading ? (
          <div className="card">
            <div style={{ textAlign: "center", padding: "3rem" }}>
              <div className="spinner" style={{ fontSize: "2rem", marginBottom: "1rem" }}>⟳</div>
              <p style={{ color: "#6b6678" }}>Loading assessments...</p>
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <div className="alert alert-error">{error}</div>
            <button type="button" className="btn-primary" onClick={fetchAssessments} style={{ marginTop: "1rem" }}>
              Retry
            </button>
          </div>
        ) : assessments.length === 0 ? (
          <div className="card">
            <div style={{ textAlign: "center", padding: "4rem 2rem" }}>
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  margin: "0 auto 1.5rem",
                  backgroundColor: "#f1dcba",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "2.5rem",
                }}
              >
                📋
              </div>
              <h2 style={{ color: "#1a1625", marginBottom: "1rem", fontSize: "1.5rem" }}>
                No assessments yet
              </h2>
              <p style={{ color: "#6b6678", marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
                Create your first assessment to get started with AI-powered topic and question
                generation.
              </p>
              <Link href="/assessments/create-new">
                <button type="button" className="btn-primary" style={{ marginTop: 0 }}>
                  Create Your First Assessment
                </button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
                Your Assessments
              </h2>
              <span
                className="badge badge-purple"
                style={{ fontSize: "0.875rem", padding: "0.5rem 1rem" }}
              >
                {assessments.length} Total
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 280px), 1fr))",
                gap: "1rem",
              }}
            >
              {assessments.map((assessment) => {
                const statusColors = getStatusColor(assessment.status);
                return (
                  <div
                    key={assessment.id}
                    className="card-hover"
                    style={{
                      border: "1px solid #e8e0d0",
                      borderRadius: "0.75rem",
                      padding: "1.5rem",
                      backgroundColor: "#ffffff",
                      cursor: "pointer",
                    }}
                    onClick={() => router.push(`/assessments/${assessment.id}`)}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "start",
                        marginBottom: "1rem",
                      }}
                    >
                      <h3
                        style={{
                          margin: 0,
                          color: "#1a1625",
                          fontSize: "1.125rem",
                          fontWeight: 600,
                          flex: 1,
                        }}
                      >
                        {assessment.title}
                      </h3>
                      <span
                        className="badge"
                        style={{
                          backgroundColor: statusColors.bg,
                          color: statusColors.text,
                          border: `1px solid ${statusColors.border}`,
                          textTransform: "capitalize",
                          marginLeft: "0.5rem",
                        }}
                      >
                        {assessment.status}
                      </span>
                    </div>
                    <div style={{ color: "#6b6678", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
                      <div style={{ marginBottom: "0.25rem" }}>
                        <strong>Created:</strong> {formatDate(assessment.createdAt)}
                      </div>
                      {assessment.hasSchedule && assessment.scheduleStatus && (
                        <div>
                          {assessment.scheduleStatus.isActive ? (
                            <span style={{ color: "#10b981" }}>🟢 Active</span>
                          ) : (
                            <span style={{ color: "#f59e0b" }}>⏸️ Scheduled</span>
                          )}
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem", paddingTop: "1rem", borderTop: "1px solid #f1dcba" }}>
                      <button
                        type="button"
                        className="btn-secondary"
                        style={{
                          fontSize: "0.875rem",
                          padding: "0.5rem 1rem",
                          marginTop: 0,
                          width: "100%",
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/assessments/${assessment.id}`);
                        }}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        style={{
                          fontSize: "0.875rem",
                          padding: "0.5rem 1rem",
                          backgroundColor: "#ef4444",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "0.375rem",
                          cursor: "pointer",
                          transition: "background-color 0.2s",
                          width: "100%",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#dc2626";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "#ef4444";
                        }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteAssessment(assessment.id, assessment.title);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;
