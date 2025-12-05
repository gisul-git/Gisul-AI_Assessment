import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { GetServerSideProps } from "next";
import { requireAuth } from "../lib/auth";
import Link from "next/link";
import Image from "next/image";
import axios from "axios";
import dsaApi from "../lib/dsa/api";

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
  type?: 'assessment' | 'dsa'; // Add type to distinguish
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
  const [showProfile, setShowProfile] = useState(false);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);


  useEffect(() => {
    // Close profile dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (showProfile && !target.closest('[data-profile-dropdown]')) {
        setShowProfile(false);
      }
    };

    if (showProfile) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showProfile]);

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
      
      // CRITICAL: Clear any cached/stale assessments first
      setAssessments([]);
      
      // Get current user ID - try multiple sources
      const currentUserId = (session?.user as any)?.id || (activeSession?.user as any)?.id;
      console.log(`[Dashboard] Fetching assessments for user_id: ${currentUserId}`);
      console.log(`[Dashboard] Session user:`, session?.user);
      console.log(`[Dashboard] Active session user:`, activeSession?.user);
      
      if (!currentUserId) {
        console.error("[Dashboard] CRITICAL: No user ID found in session - cannot filter DSA tests securely");
      }
      
      // Fetch both regular assessments and DSA tests in parallel
      // CRITICAL: DSA tests endpoint filters by created_by automatically via authentication
      const [assessmentsResponse, dsaTestsResponse] = await Promise.allSettled([
        axios.get("/api/assessments/list"),
        dsaApi.get("/tests/", { params: { active_only: false } })  // Explicit trailing slash and params
      ]);
      
      const allAssessments: Assessment[] = [];
      
      // Process regular assessments
      if (assessmentsResponse.status === 'fulfilled' && assessmentsResponse.value.data?.success && assessmentsResponse.value.data?.data) {
        const regularAssessments = assessmentsResponse.value.data.data.map((a: any) => ({
          ...a,
          type: 'assessment' as const
        }));
        allAssessments.push(...regularAssessments);
      } else if (assessmentsResponse.status === 'rejected') {
        console.error("Error fetching regular assessments:", assessmentsResponse.reason);
      }
      
      // Process DSA tests
      if (dsaTestsResponse.status === 'fulfilled' && Array.isArray(dsaTestsResponse.value.data)) {
        const rawDsaTests = dsaTestsResponse.value.data;
        console.log(`[Dashboard] Received ${rawDsaTests.length} DSA tests from backend`);
        console.log(`[Dashboard] Raw DSA tests:`, rawDsaTests.map((t: any) => ({ id: t.id, title: t.title, created_by: t.created_by })));
        
        // CRITICAL SECURITY: Client-side filter to ensure we only show tests that belong to current user
        // This is a defense-in-depth measure - backend should already filter, but this ensures safety
        if (!currentUserId) {
          console.error("[Dashboard] SECURITY: No user ID available - NOT showing any DSA tests (fail secure)");
        } else {
          const dsaTests = rawDsaTests
            .filter((test: any) => {
              const testCreatedBy = test.created_by;
              if (!testCreatedBy) {
                console.warn(`[Dashboard] SECURITY: Test ${test.id || test._id} has no created_by field - hiding it`);
                return false;
              }
              
              if (!currentUserId) {
                console.warn(`[Dashboard] SECURITY: Cannot verify ownership - hiding test ${test.id || test._id}`);
                return false;
              }
              
              const testCreatedByStr = String(testCreatedBy).trim();
              const currentUserIdStr = String(currentUserId).trim();
              const matches = testCreatedByStr === currentUserIdStr;
              
              if (!matches) {
                console.error(`[Dashboard] SECURITY: Filtered out test ${test.id || test._id} (${test.title}) - created_by='${testCreatedByStr}' != user_id='${currentUserIdStr}'`);
              } else {
                console.log(`[Dashboard] Test ${test.id || test._id} (${test.title}) belongs to current user - showing it`);
              }
              
              return matches;
            })
            .map((test: any) => ({
              id: test.id || test._id,
              title: test.title || 'Untitled DSA Test',
              status: test.is_published ? 'published' : 'draft',
              hasSchedule: !!(test.start_time && test.end_time),
              scheduleStatus: test.start_time && test.end_time ? {
                startTime: test.start_time,
                endTime: test.end_time,
                duration: test.duration_minutes || 0,
                isActive: test.is_active || false
              } : null,
              createdAt: test.created_at || null,
              updatedAt: test.updated_at || null,
              type: 'dsa' as const
            }));
          allAssessments.push(...dsaTests);
          console.log(`[Dashboard] Loaded ${dsaTests.length} DSA tests for current user (filtered from ${rawDsaTests.length} total from backend)`);
        }
      } else if (dsaTestsResponse.status === 'rejected') {
        console.error("Error fetching DSA tests:", dsaTestsResponse.reason);
        console.error("DSA tests response error details:", dsaTestsResponse.reason?.response?.data);
      }
      
      // Sort by creation date (newest first)
      allAssessments.sort((a, b) => {
        const dateA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const dateB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return dateB - dateA;
      });
      
      setAssessments(allAssessments);
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

  const handleDeleteAssessment = async (assessmentId: string, assessmentTitle: string, assessmentType?: 'assessment' | 'dsa') => {
    if (!confirm(`Are you sure you want to delete "${assessmentTitle}"? This action cannot be undone.`)) {
      return;
    }

    try {
      setError(null);
      
      if (assessmentType === 'dsa') {
        // Delete DSA test
        await dsaApi.delete(`/tests/${assessmentId}`);
        setAssessments(assessments.filter((a) => a.id !== assessmentId));
      } else {
        // Delete regular assessment
      const response = await axios.delete(`/api/assessments/delete-assessment?assessmentId=${assessmentId}`);
      if (response.data?.success) {
        setAssessments(assessments.filter((a) => a.id !== assessmentId));
      } else {
        setError(response.data?.message || "Failed to delete assessment");
        }
      }
    } catch (err: any) {
      console.error("Error deleting assessment:", err);
      setError(err.response?.data?.message || err.message || "Failed to delete assessment");
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "ready":
        return { bg: "#dcfce7", text: "#166534", border: "#10b981" }; // Keep success green
      case "draft":
        return { bg: "rgba(201, 244, 212, 0.2)", text: "#1E5A3B", border: "#C9F4D4" }; // Mint Cream theme
      case "scheduled":
        return { bg: "rgba(201, 244, 212, 0.2)", text: "#1E5A3B", border: "#C9F4D4" }; // Mint Cream theme
      case "active":
        return { bg: "#dbeafe", text: "#1e40af", border: "#3b82f6" }; // Keep info blue
      default:
        return { bg: "rgba(232, 250, 240, 0.5)", text: "#2D7A52", border: "#A8E8BC" }; // Mint 50/400
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

  const fetchUserProfile = async () => {
    // First, try to use session data if available (faster)
    if (activeSession?.user) {
      const sessionUser = activeSession.user as any;
      if (sessionUser.name || sessionUser.email) {
        // Use session data immediately, then fetch full profile in background
        setUserProfile({
          name: sessionUser.name,
          email: sessionUser.email,
          phone: sessionUser.phone,
          country: sessionUser.country,
        });
      }
    }

    try {
      setLoadingProfile(true);
      const response = await axios.get("/api/users/me");
      if (response.data?.success && response.data?.data) {
        setUserProfile(response.data.data);
      }
    } catch (err: any) {
      console.error("Error fetching user profile:", err);
      // If API fails but we have session data, keep using it
      if (!userProfile && activeSession?.user) {
        const sessionUser = activeSession.user as any;
        setUserProfile({
          name: sessionUser.name,
          email: sessionUser.email,
          phone: sessionUser.phone,
          country: sessionUser.country,
        });
      }
    } finally {
      setLoadingProfile(false);
    }
  };

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
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0, position: "relative" }}>
            <button
              type="button"
              onClick={() => {
                const newShowState = !showProfile;
                setShowProfile(newShowState);
                if (newShowState) {
                  // If we don't have profile data or session has more info, fetch it
                  if (!userProfile || (activeSession?.user && !userProfile.phone && !userProfile.country)) {
                    fetchUserProfile();
                  }
                }
              }}
              style={{
                marginTop: 0,
                padding: "0.5rem",
                fontSize: "1.25rem",
                backgroundColor: "rgba(255, 255, 255, 0.2)",
                border: "1px solid rgba(255, 255, 255, 0.3)",
                borderRadius: "50%",
                color: "#ffffff",
                width: "40px",
                height: "40px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "pointer",
                transition: "background-color 0.2s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.3)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = "rgba(255, 255, 255, 0.2)";
              }}
              title={activeSession?.user?.name || activeSession?.user?.email || "Profile"}
            >
              👤
            </button>
            {showProfile && (
              <div
                data-profile-dropdown
                style={{
                  position: "absolute",
                  top: "100%",
                  right: 0,
                  marginTop: "0.5rem",
                  backgroundColor: "#ffffff",
                  border: "1px solid #e2e8f0",
                  borderRadius: "0.5rem",
                  boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                  minWidth: "250px",
                  zIndex: 1000,
                  padding: "1rem",
                }}
              >
                {loadingProfile && !userProfile ? (
                  <div style={{ textAlign: "center", padding: "1rem" }}>Loading...</div>
                ) : userProfile ? (
                  <div>
                    <div style={{ marginBottom: "1rem", paddingBottom: "1rem", borderBottom: "1px solid #e2e8f0" }}>
                      <div style={{ fontWeight: 600, fontSize: "1rem", color: "#1a1625", marginBottom: "0.25rem" }}>
                        {userProfile.name || "User"}
                      </div>
                      <div style={{ fontSize: "0.875rem", color: "#64748b" }}>{userProfile.email}</div>
                    </div>
                    <div style={{ fontSize: "0.875rem", color: "#1e293b", marginBottom: "0.5rem" }}>
                      <div><strong>Phone:</strong> {userProfile.phone || "Not provided"}</div>
                      <div><strong>Country:</strong> {userProfile.country || "Not provided"}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                      className="btn-secondary"
                      style={{
                        width: "100%",
                        marginTop: "0.5rem",
                        padding: "0.5rem 1rem",
                        fontSize: "0.875rem",
                      }}
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", padding: "1rem" }}>Failed to load profile</div>
                )}
              </div>
            )}
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
              <p style={{ color: "#2D7A52", margin: 0, fontSize: "0.875rem" }}>
                Signed in as <strong>{activeSession?.user?.name || activeSession?.user?.email || "User"}</strong>
              </p>
            </div>
            <div style={{ display: "flex", gap: "1rem", width: "100%" }}>
              <Link 
                href="/assessments/create-new" 
                style={{ flex: 1 }}
                onClick={() => {
                  // Clear any draft from localStorage to ensure a fresh start
                  try {
                    localStorage.removeItem('currentDraftAssessmentId');
                  } catch (err) {
                    console.error("Error clearing draft ID:", err);
                  }
                }}
              >
              <button type="button" className="btn-primary" style={{ marginTop: 0, width: "100%" }}>
                + Create New Assessment
              </button>
            </Link>
              <Link href="/dsa" style={{ flex: 1 }}>
                <button type="button" className="btn-primary" style={{ marginTop: 0, width: "100%" }}>
                  Create DSA Competency
                </button>
              </Link>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="card">
            <div style={{ textAlign: "center", padding: "3rem" }}>
              <div className="spinner" style={{ fontSize: "2rem", marginBottom: "1rem" }}>⟳</div>
              <p style={{ color: "#2D7A52" }}>Loading assessments...</p>
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
                  backgroundColor: "#E8FAF0", // Mint 50
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
              <p style={{ color: "#2D7A52", marginBottom: "2rem", maxWidth: "500px", margin: "0 auto 2rem" }}>
                Create your first assessment to get started with AI-powered topic and question
                generation.
              </p>
              <Link 
                href="/assessments/create-new"
                onClick={() => {
                  // Clear any draft from localStorage to ensure a fresh start
                  try {
                    localStorage.removeItem('currentDraftAssessmentId');
                  } catch (err) {
                    console.error("Error clearing draft ID:", err);
                  }
                }}
              >
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
                className="badge badge-mint"
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
                      border: "1px solid #A8E8BC", // Mint 400
                      borderRadius: "0.75rem",
                      padding: "1.5rem",
                      backgroundColor: "#ffffff",
                      cursor: "pointer",
                    }}
                    onClick={() => {
                      if (assessment.type === 'dsa') {
                        router.push(`/dsa/tests`);
                      } else if (assessment.status === 'draft') {
                        router.push(`/assessments/create-new?id=${assessment.id}`);
                      } else {
                        router.push(`/assessments/${assessment.id}/analytics`);
                      }
                    }}
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
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        {assessment.type === 'dsa' && (
                          <span
                            className="badge"
                            style={{
                              backgroundColor: "#E8FAF0",
                              color: "#2D7A52",
                              border: "1px solid #A8E8BC",
                              fontSize: "0.75rem",
                              padding: "0.25rem 0.5rem",
                            }}
                          >
                            DSA
                          </span>
                        )}
                        <span
                          className="badge"
                          style={{
                            backgroundColor: statusColors.bg,
                            color: statusColors.text,
                            border: `1px solid ${statusColors.border}`,
                            textTransform: "capitalize",
                          }}
                        >
                          {assessment.status}
                        </span>
                      </div>
                    </div>
                    <div style={{ color: "#2D7A52", fontSize: "0.875rem", marginBottom: "0.75rem" }}>
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
                    <div style={{ marginTop: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem", paddingTop: "1rem", borderTop: "1px solid #E8FAF0" }}>
                      {assessment.status === 'draft' && (
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
                            router.push(`/assessments/create-new?id=${assessment.id}`);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      {assessment.type !== 'dsa' && (
                        <button
                          type="button"
                          className="btn-secondary"
                          style={{
                            fontSize: "0.875rem",
                            padding: "0.5rem 1rem",
                            marginTop: 0,
                            width: "100%",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "0.5rem",
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/assessments/${assessment.id}/analytics`);
                          }}
                        >
                          <svg 
                            width="16" 
                            height="16" 
                            viewBox="0 0 24 24" 
                            fill="none" 
                            stroke="currentColor" 
                            strokeWidth="2" 
                            strokeLinecap="round" 
                            strokeLinejoin="round"
                          >
                            <line x1="18" y1="20" x2="18" y2="10" />
                            <line x1="12" y1="20" x2="12" y2="4" />
                            <line x1="6" y1="20" x2="6" y2="14" />
                          </svg>
                          Analytics
                        </button>
                      )}
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
                          handleDeleteAssessment(assessment.id, assessment.title, assessment.type);
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
