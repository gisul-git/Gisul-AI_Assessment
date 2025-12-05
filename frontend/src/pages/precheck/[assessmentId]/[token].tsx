import React, { useEffect, useState } from "react";
import { useRouter } from "next/router";
import axios from "axios";
import { PrecheckModal } from "@/components/precheck/PrecheckModal";

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
  const [showModal, setShowModal] = useState(false);
  
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
    
    // Check if pre-check was already completed - if so, skip to instructions
    const precheckCompleted = sessionStorage.getItem(`precheckCompleted_${assessmentId}`);
    if (precheckCompleted && assessmentId && token) {
      router.replace(`/assessment/${assessmentId}/${token}/instructions`);
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

  // Handle modal completion
  const handlePrecheckComplete = () => {
    // Mark pre-check as completed in sessionStorage
    sessionStorage.setItem(`precheckCompleted_${assessmentId}`, "true");
    setShowModal(false);
    // Use router.replace to prevent back navigation to pre-check
    router.replace(`/assessment/${assessmentId}/${token}/instructions`);
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
    <>
      <div style={{ backgroundColor: "#f7f3e8", minHeight: "100vh", padding: "2rem", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: "600px", width: "100%", textAlign: "center" }}>
          {/* Header */}
          <div style={{ marginBottom: "2rem" }}>
            <h1 style={{ fontSize: "2rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>
              System Pre-Check
            </h1>
            {assessmentInfo && (
              <p style={{ color: "#64748b", fontSize: "1rem" }}>
                {assessmentInfo.title}
              </p>
            )}
            {name && email && (
              <p style={{ color: "#94a3b8", fontSize: "0.875rem", marginTop: "0.5rem" }}>
                {name} ({email})
              </p>
            )}
          </div>
          
          {/* Instructions */}
          <div
            style={{
              backgroundColor: "#ffffff",
              borderRadius: "1rem",
              padding: "2rem",
              marginBottom: "2rem",
              boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
            }}
          >
            <p style={{ color: "#64748b", fontSize: "1rem", lineHeight: 1.6, marginBottom: "1.5rem" }}>
              Before starting the assessment, we need to verify that your system meets the requirements.
              This will check your browser compatibility, network connection, camera, and microphone.
            </p>
            
            <button
              onClick={() => setShowModal(true)}
              style={{
                padding: "1rem 2rem",
                backgroundColor: "#6953a3",
                color: "#ffffff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "1.125rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.5rem",
                boxShadow: "0 4px 6px -1px rgba(105, 83, 163, 0.3)",
              }}
            >
              Start Pre-Check
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          </div>
          
          {/* Privacy Notice */}
          <div
            style={{
              backgroundColor: "#fffbeb",
              border: "1px solid #fcd34d",
              borderRadius: "0.5rem",
              padding: "1rem",
              fontSize: "0.875rem",
              color: "#92400e",
              lineHeight: 1.6,
            }}
          >
            <strong>Privacy Notice:</strong> We will access your camera and microphone to validate 
            your environment. No audio or video is recorded during this check. Streams are released 
            immediately after each test completes.
          </div>
          
          {/* Error Banner */}
          {error && (
            <div
              style={{
                backgroundColor: "#fef2f2",
                border: "2px solid #ef4444",
                borderRadius: "0.75rem",
                padding: "1rem",
                marginTop: "1.5rem",
              }}
              role="alert"
            >
              <p style={{ color: "#dc2626", margin: 0 }}>{error}</p>
            </div>
          )}
        </div>
      </div>
      
      {/* Precheck Modal */}
      <PrecheckModal
        isOpen={showModal}
        onComplete={handlePrecheckComplete}
        onClose={() => setShowModal(false)}
        assessmentId={(assessmentId as string) || ""}
        userId={email || ""}
        candidateName={name || undefined}
      />
    </>
  );
}
