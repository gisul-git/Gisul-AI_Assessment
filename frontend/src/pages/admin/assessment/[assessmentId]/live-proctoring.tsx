/**
 * Live Proctoring Dashboard
 * 
 * CCTV-style view to monitor all candidates taking an assessment.
 * Shows webcam + screen for each active candidate.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { GetServerSideProps } from "next";
import { getSession } from "next-auth/react";
import Link from "next/link";
import { useMultiLiveProctorAdmin } from "@/hooks/useMultiLiveProctorAdmin";
import { MultiProctorGrid } from "@/components/proctor/MultiProctorGrid";

export default function LiveProctoringPage() {
  const router = useRouter();
  const { assessmentId } = router.query;
  const [adminEmail, setAdminEmail] = useState<string>("");
  const [isStarted, setIsStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get admin email from session
  useEffect(() => {
    const fetchSession = async () => {
      const session = await getSession();
      if (session?.user?.email) {
        setAdminEmail(session.user.email);
      }
    };
    fetchSession();
  }, []);

  // Multi-proctor hook
  const {
    candidateStreams,
    activeCandidates,
    isLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
  } = useMultiLiveProctorAdmin({
    assessmentId: (assessmentId as string) || "",
    adminId: adminEmail,
    onError: (err) => setError(err),
    debugMode: true,
  });

  // Start monitoring
  const handleStart = async () => {
    setError(null);
    setIsStarted(true);
    await startMonitoring();
  };

  // Stop monitoring
  const handleStop = () => {
    stopMonitoring();
    setIsStarted(false);
  };

  // Count connected candidates
  const connectedCount = candidateStreams.filter(
    (s) => s.connectionState === "connected"
  ).length;

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#0f172a",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Header */}
      <header
        style={{
          backgroundColor: "#1e293b",
          borderBottom: "1px solid #334155",
          padding: "1rem 1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          <Link
            href={`/assessments/${assessmentId}`}
            style={{ color: "#94a3b8", textDecoration: "none", display: "flex", alignItems: "center", gap: "0.5rem" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back
          </Link>
          <div
            style={{
              width: "1px",
              height: "24px",
              backgroundColor: "#334155",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
            <div
              style={{
                width: "40px",
                height: "40px",
                backgroundColor: "#dc2626",
                borderRadius: "0.5rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                <circle cx="12" cy="13" r="4" />
              </svg>
            </div>
            <div>
              <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700, color: "#f1f5f9" }}>
                Live Proctoring
              </h1>
              <p style={{ margin: 0, fontSize: "0.75rem", color: "#94a3b8" }}>
                Monitor all candidates in real-time
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Status Indicators */}
          <div style={{ display: "flex", alignItems: "center", gap: "1.5rem" }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#10b981" }}>
                {connectedCount}
              </div>
              <div style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>Connected</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#f59e0b" }}>
                {candidateStreams.length - connectedCount}
              </div>
              <div style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>Pending</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: "#f1f5f9" }}>
                {activeCandidates.length}
              </div>
              <div style={{ fontSize: "0.6875rem", color: "#94a3b8" }}>Total</div>
            </div>
          </div>

          {/* Controls */}
          {!isStarted ? (
            <button
              type="button"
              onClick={handleStart}
              disabled={isLoading || !adminEmail}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: isLoading || !adminEmail ? "not-allowed" : "pointer",
                opacity: isLoading || !adminEmail ? 0.6 : 1,
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              {isLoading ? (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                  </svg>
                  Connecting...
                </>
              ) : (
                <>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Start Monitoring
                </>
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleStop}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#ef4444",
                color: "#fff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="6" y="6" width="12" height="12" />
              </svg>
              Stop Monitoring
            </button>
          )}
        </div>
      </header>

      {/* Error Banner */}
      {error && (
        <div
          style={{
            backgroundColor: "#7f1d1d",
            color: "#fecaca",
            padding: "0.75rem 1.5rem",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "#fecaca",
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content */}
      <main style={{ flex: 1, overflow: "hidden" }}>
        {!isStarted ? (
          // Welcome Screen
          <div
            style={{
              height: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              color: "#94a3b8",
              padding: "2rem",
            }}
          >
            <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <h2 style={{ marginTop: "1.5rem", fontSize: "1.5rem", color: "#f1f5f9", fontWeight: 600 }}>
              Live Proctoring Dashboard
            </h2>
            <p style={{ marginTop: "0.5rem", textAlign: "center", maxWidth: "500px", lineHeight: 1.6 }}>
              Monitor all candidates taking this assessment in real-time. 
              Click <strong style={{ color: "#10b981" }}>"Start Monitoring"</strong> to begin viewing 
              webcam and screen feeds from active candidates.
            </p>
            
            <div
              style={{
                marginTop: "2rem",
                padding: "1.5rem",
                backgroundColor: "#1e293b",
                borderRadius: "0.75rem",
                maxWidth: "500px",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "0.9375rem", color: "#f1f5f9", fontWeight: 600, marginBottom: "1rem" }}>
                How it works:
              </h3>
              <ol style={{ margin: 0, paddingLeft: "1.25rem", color: "#94a3b8", lineHeight: 1.8 }}>
                <li>Click "Start Monitoring" to create viewing sessions</li>
                <li>Candidates who are currently taking the test will appear</li>
                <li>View each candidate's webcam and screen share</li>
                <li>Click on any candidate to expand their view</li>
                <li>Scroll to see more candidates if needed</li>
              </ol>
            </div>
          </div>
        ) : (
          // Grid View
          <MultiProctorGrid
            candidateStreams={candidateStreams}
            onRefreshCandidate={refreshCandidate}
            isLoading={isLoading}
          />
        )}
      </main>

      {/* Footer */}
      <footer
        style={{
          backgroundColor: "#1e293b",
          borderTop: "1px solid #334155",
          padding: "0.75rem 1.5rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ color: "#64748b", fontSize: "0.75rem" }}>
          Assessment ID: {assessmentId}
        </span>
        {isStarted && (
          <span style={{ color: "#64748b", fontSize: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: "#ef4444",
                animation: "pulse 1.5s infinite",
              }}
            />
            LIVE
          </span>
        )}
      </footer>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// Server-side authentication check
export const getServerSideProps: GetServerSideProps = async (context) => {
  const session = await getSession(context);

  if (!session) {
    return {
      redirect: {
        destination: "/auth/signin",
        permanent: false,
      },
    };
  }

  return {
    props: {},
  };
};

