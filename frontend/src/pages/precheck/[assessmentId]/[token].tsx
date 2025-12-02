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

// Sequential check order (removed fullscreen and tabSwitch)
const CHECK_ORDER: CheckType[] = ["browser", "network", "camera", "microphone"];

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
  const [currentCheckIndex, setCurrentCheckIndex] = useState(0);
  const [isCheckingSequence, setIsCheckingSequence] = useState(false);
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
  
  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAllStreams();
    };
  }, [stopAllStreams]);
  
  // Get current check type
  const currentCheckType = CHECK_ORDER[currentCheckIndex] || null;
  
  // Check if all checks in our order are passed
  const allSequentialChecksPassed = CHECK_ORDER.every(
    (type) => checks[type]?.status === "passed"
  );
  
  // Handle running the current check
  const handleRunCurrentCheck = useCallback(async () => {
    if (!currentCheckType || isCheckingSequence) return;
    
    setIsCheckingSequence(true);
    await runCheck(currentCheckType);
    setIsCheckingSequence(false);
  }, [currentCheckType, isCheckingSequence, runCheck]);
  
  // Handle moving to next check
  const handleNextCheck = useCallback(() => {
    if (currentCheckIndex < CHECK_ORDER.length - 1) {
      setCurrentCheckIndex(currentCheckIndex + 1);
    }
  }, [currentCheckIndex]);
  
  // Handle retry current check
  const handleRetryCurrentCheck = useCallback(async () => {
    if (!currentCheckType || isCheckingSequence) return;
    
    setIsCheckingSequence(true);
    await runCheck(currentCheckType);
    setIsCheckingSequence(false);
  }, [currentCheckType, isCheckingSequence, runCheck]);
  
  // Handle proceed to exam
  const handleProceed = useCallback(() => {
    stopAllStreams();
    router.push(`/assessment/${assessmentId}/${token}/instructions`);
  }, [assessmentId, token, router, stopAllStreams]);
  
  // Helper to get check label
  const getCheckLabel = (type: CheckType): string => {
    switch (type) {
      case "browser": return "Browser Compatibility";
      case "network": return "Network Connection";
      case "camera": return "Camera Access";
      case "microphone": return "Microphone Access";
      default: return type;
    }
  };
  
  // Helper to get check icon
  const getCheckIcon = (type: CheckType) => {
    switch (type) {
      case "browser":
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="4" />
            <line x1="21.17" y1="8" x2="12" y2="8" />
            <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
            <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
          </svg>
        );
      case "network":
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
        );
      case "camera":
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        );
      case "microphone":
        return (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        );
      default:
        return null;
    }
  };
  
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
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "2rem", textAlign: "center" }}>
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
        
        {/* Progress Indicator */}
        <div style={{ marginBottom: "2rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
              Step {Math.min(currentCheckIndex + 1, CHECK_ORDER.length)} of {CHECK_ORDER.length}
            </span>
            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
              {CHECK_ORDER.filter(type => checks[type]?.status === "passed").length} / {CHECK_ORDER.length} passed
            </span>
          </div>
          <div style={{ height: "8px", backgroundColor: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${(CHECK_ORDER.filter(type => checks[type]?.status === "passed").length / CHECK_ORDER.length) * 100}%`,
                backgroundColor: "#10b981",
                borderRadius: "4px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
        
        {/* Check Steps */}
        <div style={{ marginBottom: "2rem" }}>
          {CHECK_ORDER.map((type, index) => {
            const check = checks[type];
            const isCurrentStep = index === currentCheckIndex;
            const isPassed = check?.status === "passed";
            const isFailed = check?.status === "failed";
            const isRunning = check?.status === "running";
            const isPending = check?.status === "pending";
            const isCompleted = index < currentCheckIndex || isPassed;
            
            return (
              <div
                key={type}
                style={{
                  backgroundColor: isCurrentStep ? "#ffffff" : isPassed ? "#f0fdf4" : "#f8fafc",
                  border: isCurrentStep ? "2px solid #6953a3" : isPassed ? "1px solid #86efac" : isFailed ? "1px solid #fecaca" : "1px solid #e2e8f0",
                  borderRadius: "0.75rem",
                  padding: "1.25rem",
                  marginBottom: "0.75rem",
                  transition: "all 0.2s ease",
                  boxShadow: isCurrentStep ? "0 4px 12px rgba(105, 83, 163, 0.15)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  {/* Step Number / Status Icon */}
                  <div
                    style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "50%",
                      backgroundColor: isPassed ? "#10b981" : isFailed ? "#ef4444" : isCurrentStep ? "#6953a3" : "#e2e8f0",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                      color: isPassed || isFailed || isCurrentStep ? "#ffffff" : "#94a3b8",
                    }}
                  >
                    {isPassed ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : isFailed ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    ) : isRunning ? (
                      <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{ animation: "spin 1s linear infinite" }}
                      >
                        <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                      </svg>
                    ) : (
                      getCheckIcon(type)
                    )}
                  </div>
                  
                  {/* Check Info */}
                  <div style={{ flex: 1 }}>
                    <h3 style={{ 
                      fontSize: "1rem", 
                      fontWeight: 600, 
                      color: isPassed ? "#065f46" : isFailed ? "#dc2626" : "#1e293b",
                      margin: 0,
                    }}>
                      {getCheckLabel(type)}
                    </h3>
                    <p style={{ 
                      fontSize: "0.8125rem", 
                      color: isPassed ? "#047857" : isFailed ? "#dc2626" : "#64748b",
                      margin: "0.25rem 0 0 0",
                    }}>
                      {check?.message || "Waiting..."}
                    </p>
                  </div>
                  
                  {/* Action Button */}
                  {isCurrentStep && !isPassed && (
                    <button
                      type="button"
                      onClick={handleRunCurrentCheck}
                      disabled={isRunning || isCheckingSequence}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: isRunning ? "#e2e8f0" : "#6953a3",
                        color: isRunning ? "#94a3b8" : "#ffffff",
                        border: "none",
                        borderRadius: "0.5rem",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        cursor: isRunning ? "not-allowed" : "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      {isRunning ? "Checking..." : isFailed ? "Retry" : "Check"}
                    </button>
                  )}
                  
                  {isPassed && isCurrentStep && currentCheckIndex < CHECK_ORDER.length - 1 && (
                    <button
                      type="button"
                      onClick={handleNextCheck}
                      style={{
                        padding: "0.5rem 1rem",
                        backgroundColor: "#10b981",
                        color: "#ffffff",
                        border: "none",
                        borderRadius: "0.5rem",
                        fontSize: "0.875rem",
                        fontWeight: 500,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                      }}
                    >
                      Next
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  )}
                </div>
                
                {/* Camera Preview */}
                {type === "camera" && isCurrentStep && cameraStream && (
                  <div style={{ marginTop: "1rem" }}>
                    <video
                      autoPlay
                      playsInline
                      muted
                      ref={(el) => {
                        if (el && cameraStream) {
                          el.srcObject = cameraStream;
                        }
                      }}
                      style={{
                        width: "100%",
                        maxWidth: "320px",
                        borderRadius: "0.5rem",
                        backgroundColor: "#000",
                        transform: "scaleX(-1)",
                      }}
                    />
                  </div>
                )}
                
                {/* Audio Level */}
                {type === "microphone" && isCurrentStep && checks.microphone?.status === "passed" && (
                  <div style={{ marginTop: "1rem" }}>
                    <p style={{ fontSize: "0.75rem", color: "#64748b", marginBottom: "0.5rem" }}>
                      Speak to test your microphone:
                    </p>
                    <div style={{ height: "8px", backgroundColor: "#e2e8f0", borderRadius: "4px", overflow: "hidden" }}>
                      <div
                        style={{
                          height: "100%",
                          width: `${audioLevel * 100}%`,
                          backgroundColor: audioLevel > 0.5 ? "#10b981" : audioLevel > 0.2 ? "#eab308" : "#94a3b8",
                          borderRadius: "4px",
                          transition: "width 0.1s ease",
                        }}
                      />
                    </div>
                  </div>
                )}
                
                {/* Network Metrics */}
                {type === "network" && isCurrentStep && networkMetrics && (
                  <div style={{ marginTop: "1rem" }}>
                    <NetworkTest
                      metrics={networkMetrics}
                      isRunning={checks.network.status === "running"}
                      maxLatencyMs={maxLatencyMs}
                      minDownloadMbps={minDownloadMbps}
                    />
                  </div>
                )}
                
                {/* Browser Warnings */}
                {type === "browser" && isCurrentStep && browserInfo.warnings.length > 0 && (
                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "0.75rem",
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
                
                {/* Troubleshooting */}
                {isFailed && isCurrentStep && check?.troubleshooting && (
                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "0.75rem",
                      backgroundColor: "#fef2f2",
                      borderRadius: "0.375rem",
                      fontSize: "0.75rem",
                      color: "#dc2626",
                    }}
                  >
                    <strong>Troubleshooting:</strong>
                    <ul style={{ margin: "0.5rem 0 0 0", paddingLeft: "1rem" }}>
                      {check.troubleshooting.slice(0, 3).map((tip, i) => (
                        <li key={i} style={{ marginBottom: "0.25rem" }}>{tip}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        
        {/* System Ready Banner */}
        {allSequentialChecksPassed && (
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
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, color: "#065f46", margin: 0 }}>
                All Checks Passed!
              </h2>
              <p style={{ fontSize: "0.875rem", color: "#047857", margin: "0.25rem 0 0 0" }}>
                Your system is ready. Click proceed to start the exam.
              </p>
            </div>
            <button
              type="button"
              onClick={handleProceed}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#10b981",
                color: "#ffffff",
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
              Proceed to Exam
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
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
        
        {/* Privacy Notice */}
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

