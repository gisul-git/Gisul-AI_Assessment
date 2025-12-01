import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import { usePrecheck, type CheckType } from "@/hooks/usePrecheck";
import { PrecheckCard, NetworkTest } from "@/components/precheck";

interface AssessmentInfo {
  title: string;
  startTime: string;
  endTime: string;
}

export default function PrecheckPage() {
  const router = useRouter();
  const { assessmentId, token } = router.query;
  
  // State
  const [email, setEmail] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [assessmentInfo, setAssessmentInfo] = useState<AssessmentInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);
  const [retryingCheck, setRetryingCheck] = useState<CheckType | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  
  // Policy settings (could come from API)
  const [cameraRequired] = useState(true);
  const [microphoneRequired] = useState(true);
  
  // Network thresholds
  const maxLatencyMs = 500;
  const minDownloadMbps = 0.5;
  
  // Initialize precheck hook
  const {
    checks,
    isReady,
    isRunning,
    mandatoryChecksPassed,
    cameras,
    microphones,
    selectedCamera,
    selectedMicrophone,
    setSelectedCamera,
    setSelectedMicrophone,
    networkMetrics,
    browserInfo,
    runAllChecks,
    runCheck,
    cameraStream,
    audioLevel,
    stopAllStreams,
    logs,
    clearLogs,
  } = usePrecheck({
    assessmentId: (assessmentId as string) || "",
    userId: email || "",
    maxLatencyMs,
    minDownloadMbps,
    cameraRequired,
    microphoneRequired,
    debugMode,
  });
  
  // Check debug mode
  useEffect(() => {
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      setDebugMode(
        urlParams.get("debug") === "1" || 
        process.env.NEXT_PUBLIC_PRECHECK_DEBUG === "1"
      );
    }
  }, []);
  
  // Load session and assessment info
  useEffect(() => {
    const storedEmail = sessionStorage.getItem("candidateEmail");
    const storedName = sessionStorage.getItem("candidateName");
    
    setEmail(storedEmail);
    setName(storedName);
    
    if (!storedEmail || !storedName) {
      // Redirect to verification if no session
      if (assessmentId && token) {
        router.replace(`/assessment/${assessmentId}/${token}`);
      }
      return;
    }
    
    // Fetch assessment info
    const fetchAssessment = async () => {
      try {
        const response = await axios.get(
          `/api/assessment/get-schedule?assessmentId=${assessmentId}&token=${token}`
        );
        
        if (response.data?.success) {
          setAssessmentInfo({
            title: response.data.data.title || "Assessment",
            startTime: response.data.data.startTime,
            endTime: response.data.data.endTime,
          });
        }
      } catch (err) {
        console.error("Error fetching assessment:", err);
        setError("Failed to load assessment information");
      } finally {
        setIsLoading(false);
      }
    };
    
    if (assessmentId && token) {
      fetchAssessment();
    }
  }, [assessmentId, token, router]);
  
  // Run checks when page loads
  useEffect(() => {
    if (!isLoading && email && assessmentId) {
      runAllChecks();
    }
  }, [isLoading, email, assessmentId]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllStreams();
    };
  }, [stopAllStreams]);
  
  // Handle individual check retry
  const handleRetry = useCallback(async (type: CheckType) => {
    setRetryingCheck(type);
    await runCheck(type);
    setRetryingCheck(null);
  }, [runCheck]);
  
  // Handle fullscreen test
  const handleFullscreenTest = useCallback(async () => {
    try {
      const elem = document.documentElement;
      
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if ((elem as any).webkitRequestFullscreen) {
        await (elem as any).webkitRequestFullscreen();
      } else if ((elem as any).mozRequestFullScreen) {
        await (elem as any).mozRequestFullScreen();
      }
      
      // Wait a moment then exit
      setTimeout(async () => {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        }
        
        // Mark as passed
        await handleRetry("fullscreen");
      }, 1500);
    } catch (error) {
      console.error("Fullscreen test error:", error);
    }
  }, [handleRetry]);
  
  // Handle proceed to exam
  const handleProceed = useCallback(() => {
    stopAllStreams();
    router.push(`/assessment/${assessmentId}/${token}/instructions`);
  }, [assessmentId, token, router, stopAllStreams]);
  
  // Handle proceed with risk (when camera denied but policy allows)
  const handleProceedWithRisk = useCallback(async () => {
    // Record camera denied event
    try {
      await fetch("/api/proctor/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "CAMERA_DENIED",
          timestamp: new Date().toISOString(),
          assessmentId,
          userId: email,
          metadata: { source: "precheck_proceed_with_risk" },
        }),
      });
    } catch (err) {
      console.error("Error recording camera denied:", err);
    }
    
    stopAllStreams();
    sessionStorage.setItem("cameraProctorEnabled", "false");
    router.push(`/assessment/${assessmentId}/${token}/instructions`);
  }, [assessmentId, token, email, router, stopAllStreams]);
  
  if (isLoading) {
    return (
      <div style={{ backgroundColor: "#f7f3e8", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#6953a3"
            strokeWidth="2"
            style={{ animation: "spin 1s linear infinite", margin: "0 auto" }}
          >
            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
          </svg>
          <p style={{ color: "#64748b", marginTop: "1rem" }}>Loading pre-check...</p>
        </div>
        <style jsx>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: "#f7f3e8", minHeight: "100vh", padding: "2rem" }}>
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>
            System Pre-Check
          </h1>
          {assessmentInfo && (
            <p style={{ color: "#64748b", fontSize: "0.9375rem" }}>
              {assessmentInfo.title}
            </p>
          )}
          {name && email && (
            <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginTop: "0.25rem" }}>
              {name} ({email})
            </p>
          )}
        </div>
        
        {/* Consent Notice */}
        <div
          style={{
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1.5rem",
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#d97706"
            strokeWidth="2"
            style={{ flexShrink: 0, marginTop: "2px" }}
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <div style={{ fontSize: "0.8125rem", color: "#92400e", lineHeight: 1.6 }}>
            <strong>Privacy Notice:</strong> We will access your camera and microphone to validate 
            your environment. No audio or video is recorded during this check. Streams are released 
            immediately after each test completes.
          </div>
        </div>
        
        {/* System Ready Banner */}
        {mandatoryChecksPassed && (
          <div
            style={{
              backgroundColor: "#ecfdf5",
              border: "2px solid #10b981",
              borderRadius: "0.75rem",
              padding: "1.25rem",
              marginBottom: "1.5rem",
              display: "flex",
              alignItems: "center",
              gap: "1rem",
            }}
            role="alert"
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                backgroundColor: "#10b981",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#065f46", margin: 0 }}>
                System Ready
              </h2>
              <p style={{ fontSize: "0.875rem", color: "#047857", margin: "0.25rem 0 0 0" }}>
                All mandatory checks have passed. You can proceed to the exam.
              </p>
            </div>
          </div>
        )}
        
        {/* Error Banner */}
        {error && (
          <div
            style={{
              backgroundColor: "#fef2f2",
              border: "2px solid #ef4444",
              borderRadius: "0.75rem",
              padding: "1rem",
              marginBottom: "1.5rem",
            }}
            role="alert"
          >
            <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>
          </div>
        )}
        
        {/* Check Cards Grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
            gap: "1rem",
            marginBottom: "1.5rem",
          }}
        >
          {/* Camera Check */}
          <PrecheckCard
            check={checks.camera}
            onRetry={() => handleRetry("camera")}
            isRetrying={retryingCheck === "camera"}
            videoStream={cameraStream}
            devices={cameras}
            selectedDevice={selectedCamera}
            onDeviceChange={setSelectedCamera}
          />
          
          {/* Microphone Check */}
          <PrecheckCard
            check={checks.microphone}
            onRetry={() => handleRetry("microphone")}
            isRetrying={retryingCheck === "microphone"}
            audioLevel={audioLevel}
            devices={microphones}
            selectedDevice={selectedMicrophone}
            onDeviceChange={setSelectedMicrophone}
          />
          
          {/* Network Check */}
          <PrecheckCard
            check={checks.network}
            onRetry={() => handleRetry("network")}
            isRetrying={retryingCheck === "network"}
          >
            <NetworkTest
              metrics={networkMetrics}
              isRunning={checks.network.status === "running"}
              maxLatencyMs={maxLatencyMs}
              minDownloadMbps={minDownloadMbps}
            />
          </PrecheckCard>
          
          {/* Fullscreen Check */}
          <PrecheckCard
            check={checks.fullscreen}
            onRetry={() => handleRetry("fullscreen")}
            isRetrying={retryingCheck === "fullscreen"}
            onAction={handleFullscreenTest}
            actionLabel="Test Fullscreen"
          />
          
          {/* Tab Switch Check */}
          <PrecheckCard
            check={checks.tabSwitch}
            onRetry={() => handleRetry("tabSwitch")}
            isRetrying={retryingCheck === "tabSwitch"}
            onAction={() => handleRetry("tabSwitch")}
            actionLabel="Test Tab Switch"
          >
            {checks.tabSwitch.status === "running" && (
              <div
                style={{
                  padding: "0.75rem",
                  backgroundColor: "#eff6ff",
                  borderRadius: "0.375rem",
                  fontSize: "0.8125rem",
                  color: "#1e40af",
                }}
              >
                <strong>Instructions:</strong> Switch to another browser tab for 1-2 seconds, 
                then return to this tab to complete the test.
              </div>
            )}
          </PrecheckCard>
          
          {/* Browser Check */}
          <PrecheckCard
            check={checks.browser}
            onRetry={() => handleRetry("browser")}
            isRetrying={retryingCheck === "browser"}
          >
            {browserInfo.warnings.length > 0 && (
              <div
                style={{
                  padding: "0.5rem",
                  backgroundColor: "#fffbeb",
                  borderRadius: "0.375rem",
                  fontSize: "0.75rem",
                  color: "#92400e",
                }}
              >
                {browserInfo.warnings.map((warning, i) => (
                  <p key={i} style={{ margin: i > 0 ? "0.25rem 0 0 0" : 0 }}>
                    ⚠️ {warning}
                  </p>
                ))}
              </div>
            )}
          </PrecheckCard>
        </div>
        
        {/* Action Buttons */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: "0.75rem",
            marginBottom: "1.5rem",
          }}
        >
          {/* Run All Checks */}
          <button
            type="button"
            onClick={runAllChecks}
            disabled={isRunning}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: isRunning ? "#e2e8f0" : "#f1f5f9",
              color: isRunning ? "#94a3b8" : "#475569",
              border: "1px solid #e2e8f0",
              borderRadius: "0.5rem",
              fontSize: "0.9375rem",
              fontWeight: 500,
              cursor: isRunning ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              transition: "background-color 0.2s",
            }}
          >
            {isRunning ? (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  style={{ animation: "spin 1s linear infinite" }}
                >
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                </svg>
                Running Checks...
              </>
            ) : (
              <>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Run All Checks
              </>
            )}
          </button>
          
          {/* Proceed to Exam */}
          <button
            type="button"
            onClick={handleProceed}
            disabled={!isReady || isRunning}
            style={{
              padding: "0.75rem 1.5rem",
              backgroundColor: isReady && !isRunning ? "#10b981" : "#94a3b8",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: isReady && !isRunning ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem",
              transition: "background-color 0.2s",
              marginLeft: "auto",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
            Proceed to Exam
          </button>
        </div>
        
        {/* Proceed with Risk (when camera failed but policy allows) */}
        {!cameraRequired && checks.camera.status === "failed" && (
          <div
            style={{
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "0.5rem",
              padding: "1rem",
              marginBottom: "1.5rem",
            }}
          >
            <p style={{ fontSize: "0.875rem", color: "#dc2626", marginBottom: "0.75rem" }}>
              <strong>Warning:</strong> Camera check failed. You can proceed without camera proctoring, 
              but this may affect your assessment validity.
            </p>
            <button
              type="button"
              onClick={handleProceedWithRisk}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#fef2f2",
                color: "#dc2626",
                border: "1px solid #fecaca",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Proceed Without Camera
            </button>
          </div>
        )}
        
        {/* Debug Logs Panel */}
        {debugMode && (
          <div
            style={{
              backgroundColor: "#1e293b",
              borderRadius: "0.5rem",
              padding: "1rem",
              marginTop: "1.5rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "0.75rem",
              }}
            >
              <h3 style={{ color: "#10b981", fontSize: "0.875rem", fontWeight: 600, margin: 0 }}>
                Debug Logs
              </h3>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  type="button"
                  onClick={() => setShowLogs(!showLogs)}
                  style={{
                    padding: "0.25rem 0.5rem",
                    backgroundColor: "#334155",
                    color: "#94a3b8",
                    border: "none",
                    borderRadius: "0.25rem",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  {showLogs ? "Hide" : "Show"} Logs
                </button>
                <button
                  type="button"
                  onClick={clearLogs}
                  style={{
                    padding: "0.25rem 0.5rem",
                    backgroundColor: "#334155",
                    color: "#94a3b8",
                    border: "none",
                    borderRadius: "0.25rem",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                  }}
                >
                  Clear
                </button>
              </div>
            </div>
            
            {/* Device Info */}
            <div style={{ marginBottom: "0.75rem", fontSize: "0.75rem", color: "#94a3b8" }}>
              <p style={{ margin: 0 }}>Cameras: {cameras.length} | Microphones: {microphones.length}</p>
              <p style={{ margin: "0.25rem 0 0 0" }}>
                Browser: {browserInfo.name} {browserInfo.version} | Secure: {browserInfo.isSecureContext ? "Yes" : "No"}
              </p>
            </div>
            
            {showLogs && (
              <div
                style={{
                  backgroundColor: "#0f172a",
                  borderRadius: "0.25rem",
                  padding: "0.75rem",
                  maxHeight: "200px",
                  overflowY: "auto",
                  fontFamily: "monospace",
                  fontSize: "0.6875rem",
                  color: "#94a3b8",
                  lineHeight: 1.5,
                }}
              >
                {logs.length === 0 ? (
                  <p style={{ margin: 0, color: "#64748b" }}>No logs yet...</p>
                ) : (
                  logs.map((log, i) => (
                    <p key={i} style={{ margin: i > 0 ? "0.25rem 0 0 0" : 0 }}>
                      {log}
                    </p>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* CSS for animations */}
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

