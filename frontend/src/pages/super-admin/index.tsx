import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { GetServerSideProps } from "next";
import { requireAuth } from "../../lib/auth";
import Image from "next/image";
import axios from "axios";

interface Assessment {
  id: string;
  title: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

interface OrgAdmin {
  id: string;
  name: string;
  email: string;
  role: string;
  organization?: string;
  emailVerified?: boolean;
  createdAt?: string;
  assessmentCount: number;
  assessments: Assessment[];
}

interface SuperAdminDashboardProps {
  session: any;
}

export default function SuperAdminDashboard({ session: serverSession }: SuperAdminDashboardProps) {
  const { data: session, update: updateSession } = useSession();
  const router = useRouter();
  
  const activeSession = serverSession || session;
  const [orgAdmins, setOrgAdmins] = useState<OrgAdmin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = (activeSession?.user as any)?.role ?? "unknown";
  const isSuperAdmin = role === "super_admin";

  useEffect(() => {
    // Redirect if not super admin
    if (activeSession && !isSuperAdmin) {
      router.push("/dashboard");
      return;
    }

    // Check if session has backendToken, if not try to refresh
    if (session?.user && !session.backendToken) {
      updateSession().then(() => {
        setTimeout(() => {
          fetchOrgAdmins();
        }, 500);
      }).catch((err) => {
        console.error("Failed to update session:", err);
        fetchOrgAdmins();
      });
    } else {
      fetchOrgAdmins();
    }
  }, [session, updateSession, activeSession, isSuperAdmin, router]);

  const fetchOrgAdmins = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.get("/api/users/org-admins");
      if (response.data?.success && response.data?.data) {
        setOrgAdmins(response.data.data.orgAdmins || []);
      } else {
        setError(response.data?.message || "Failed to load organization admins");
      }
    } catch (err: any) {
      console.error("Error fetching org admins:", err);
      const errorMsg = err.response?.data?.message || err.response?.data?.detail || err.message || "Failed to load organization admins";
      
      if (err.response?.status === 401) {
        setError("Session expired. Please refresh the page or sign in again.");
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    try {
      return new Date(dateString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  if (!isSuperAdmin) {
    return null; // Will redirect in useEffect
  }

  return (
    <div style={{ backgroundColor: "#ffffff", minHeight: "100vh" }}>
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
              onClick={async () => {
                await signOut({ redirect: false });
                window.location.href = "/auth/signin";
              }}
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
                Super Admin Dashboard
              </h1>
              <p style={{ color: "#2D7A52", margin: 0, fontSize: "0.875rem" }}>
                Signed in as <strong>{activeSession?.user?.email}</strong> • Role:{" "}
                <span className="badge badge-mint" style={{ marginLeft: "0.25rem" }}>
                  {role}
                </span>
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card">
            <div style={{ textAlign: "center", padding: "3rem" }}>
              <div className="spinner" style={{ fontSize: "2rem", marginBottom: "1rem" }}>⟳</div>
              <p style={{ color: "#2D7A52" }}>Loading organization admins...</p>
            </div>
          </div>
        ) : error ? (
          <div className="card">
            <div className="alert alert-error">{error}</div>
            <button type="button" className="btn-primary" onClick={fetchOrgAdmins} style={{ marginTop: "1rem" }}>
              Retry
            </button>
          </div>
        ) : (
          <div className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
              <h2 style={{ margin: 0, fontSize: "1.5rem", color: "#1a1625", fontWeight: 700 }}>
                Organization Admins
              </h2>
              <span
                className="badge badge-mint"
                style={{ fontSize: "0.875rem", padding: "0.5rem 1rem" }}
              >
                {orgAdmins.length} Total
              </span>
            </div>

            {orgAdmins.length === 0 ? (
              <div style={{ textAlign: "center", padding: "4rem 2rem" }}>
                <div
                  style={{
                    width: "80px",
                    height: "80px",
                    margin: "0 auto 1.5rem",
                    backgroundColor: "#E8FAF0",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "2.5rem",
                  }}
                >
                  👥
                </div>
                <h2 style={{ color: "#1a1625", marginBottom: "1rem", fontSize: "1.5rem" }}>
                  No organization admins found
                </h2>
                <p style={{ color: "#2D7A52", marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
                  Organization admins will appear here once they sign up.
                </p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                {orgAdmins.map((admin) => (
                  <div
                    key={admin.id}
                    className="card-hover"
                    style={{
                      border: "1px solid #A8E8BC",
                      borderRadius: "0.75rem",
                      padding: "1.5rem",
                      backgroundColor: "#ffffff",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: "1rem", flexWrap: "wrap", gap: "1rem" }}>
                      <div style={{ flex: 1, minWidth: "200px" }}>
                        <h3 style={{ margin: 0, color: "#1a1625", fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>
                          {admin.name || "N/A"}
                        </h3>
                        <p style={{ margin: 0, color: "#2D7A52", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                          <strong>Email:</strong> {admin.email}
                        </p>
                        <p style={{ margin: 0, color: "#2D7A52", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                          <strong>Created:</strong> {formatDate(admin.createdAt)}
                        </p>
                        <p style={{ margin: 0, color: "#2D7A52", fontSize: "0.875rem" }}>
                          <strong>Email Verified:</strong>{" "}
                          <span style={{ color: admin.emailVerified ? "#10b981" : "#ef4444" }}>
                            {admin.emailVerified ? "✓ Yes" : "✗ No"}
                          </span>
                        </p>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          className="badge badge-mint"
                          style={{ fontSize: "1rem", padding: "0.75rem 1.5rem", marginBottom: "0.5rem", display: "inline-block" }}
                        >
                          {admin.assessmentCount} Assessment{admin.assessmentCount !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </div>

                    {admin.assessments && admin.assessments.length > 0 && (
                      <div style={{ marginTop: "1.5rem", paddingTop: "1.5rem", borderTop: "1px solid #E8FAF0" }}>
                        <h4 style={{ margin: 0, marginBottom: "1rem", fontSize: "1rem", color: "#1a1625", fontWeight: 600 }}>
                          Assessments:
                        </h4>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                          {admin.assessments.map((assessment) => (
                            <div
                              key={assessment.id}
                              style={{
                                padding: "0.75rem",
                                backgroundColor: "#F9FAFB",
                                borderRadius: "0.5rem",
                                border: "1px solid #E5E7EB",
                              }}
                            >
                              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", flexWrap: "wrap", gap: "0.5rem" }}>
                                <div style={{ flex: 1, minWidth: "200px" }}>
                                  <p style={{ margin: 0, color: "#1a1625", fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.25rem" }}>
                                    {assessment.title}
                                  </p>
                                  <p style={{ margin: 0, color: "#6b7280", fontSize: "0.75rem" }}>
                                    Created: {formatDate(assessment.createdAt)}
                                  </p>
                                </div>
                                <span
                                  className="badge"
                                  style={{
                                    backgroundColor: assessment.status === "ready" ? "#dcfce7" : "#f3f4f6",
                                    color: assessment.status === "ready" ? "#166534" : "#374151",
                                    border: `1px solid ${assessment.status === "ready" ? "#10b981" : "#d1d5db"}`,
                                    textTransform: "capitalize",
                                    fontSize: "0.75rem",
                                    padding: "0.25rem 0.75rem",
                                  }}
                                >
                                  {assessment.status}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = requireAuth;

