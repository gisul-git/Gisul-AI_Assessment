import React, { useState, useRef, useEffect, useCallback } from "react";

interface CameraProctorModalProps {
  isOpen: boolean;
  onAccept: () => Promise<boolean>;
  onDeny: () => void;
  candidateName?: string;
  isLoading?: boolean;
  cameraError?: string | null;
}

/**
 * Modal for camera proctoring consent and initialization.
 * Shows privacy notice and requires explicit consent before starting camera monitoring.
 */
export function CameraProctorModal({
  isOpen,
  onAccept,
  onDeny,
  candidateName,
  isLoading = false,
  cameraError = null,
}: CameraProctorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);

  // Focus the accept button when modal opens
  useEffect(() => {
    if (isOpen && acceptButtonRef.current && consentChecked) {
      acceptButtonRef.current.focus();
    }
  }, [isOpen, consentChecked]);

  // Prevent ESC from closing modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isOpen]);

  // Trap focus within modal
  useEffect(() => {
    if (!isOpen) return;

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    };

    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, [isOpen]);

  // Cleanup preview stream on unmount
  useEffect(() => {
    return () => {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Stop preview when modal closes
  useEffect(() => {
    if (!isOpen && previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach(track => track.stop());
      previewStreamRef.current = null;
      setShowPreview(false);
    }
  }, [isOpen]);

  const handlePreviewCamera = useCallback(async () => {
    try {
      setLocalError(null);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 360 },
          facingMode: "user",
        },
      });
      
      previewStreamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play();
      }
      setShowPreview(true);
    } catch (error) {
      console.error("Camera preview error:", error);
      setLocalError("Could not access camera. Please check your permissions.");
    }
  }, []);

  const handleAcceptClick = async () => {
    if (!consentChecked) return;
    
    setIsStarting(true);
    setLocalError(null);
    
    // Stop preview if running
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach(track => track.stop());
      previewStreamRef.current = null;
      setShowPreview(false);
    }
    
    try {
      const success = await onAccept();
      if (!success) {
        setLocalError("Failed to start camera proctoring. Please try again.");
      }
    } catch (error) {
      setLocalError("An error occurred. Please try again.");
    } finally {
      setIsStarting(false);
    }
  };

  const handleDenyClick = () => {
    // Stop preview if running
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach(track => track.stop());
      previewStreamRef.current = null;
    }
    onDeny();
  };

  const displayError = cameraError || localError;

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
        padding: "1rem",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-proctor-modal-title"
      onClick={(e) => e.stopPropagation()}
    >
      <div
        ref={modalRef}
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "1rem",
          maxWidth: "580px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          padding: "2rem",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          animation: "cameraModalFadeIn 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Icon */}
        <div
          style={{
            width: "72px",
            height: "72px",
            backgroundColor: displayError ? "#fef2f2" : "#ecfdf5",
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 1.5rem",
          }}
        >
          {displayError ? (
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#ef4444"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#10b981"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
          )}
        </div>

        {/* Title */}
        <h2
          id="camera-proctor-modal-title"
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            color: displayError ? "#dc2626" : "#1e293b",
            textAlign: "center",
            marginBottom: "0.75rem",
          }}
        >
          {displayError ? "Camera Access Required" : "Camera Proctoring"}
        </h2>

        {/* Greeting */}
        {candidateName && !displayError && (
          <p
            style={{
              textAlign: "center",
              color: "#64748b",
              marginBottom: "1rem",
              fontSize: "0.9375rem",
            }}
          >
            Welcome, <strong>{candidateName}</strong>!
          </p>
        )}

        {/* Error message */}
        {displayError && (
          <div
            style={{
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "0.5rem",
              padding: "1rem",
              marginBottom: "1rem",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, color: "#dc2626", fontSize: "0.875rem", fontWeight: 500 }}>
              {displayError}
            </p>
          </div>
        )}

        {/* Camera Preview */}
        {showPreview && (
          <div
            style={{
              marginBottom: "1rem",
              borderRadius: "0.5rem",
              overflow: "hidden",
              backgroundColor: "#000",
              aspectRatio: "16/9",
            }}
          >
            <video
              ref={previewVideoRef}
              autoPlay
              playsInline
              muted
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                transform: "scaleX(-1)", // Mirror the video
              }}
            />
          </div>
        )}

        {/* Description */}
        <div
          style={{
            backgroundColor: "#f0fdf4",
            border: "1px solid #86efac",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1rem",
          }}
        >
          <h4 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem", fontWeight: 600, color: "#166534" }}>
            What we monitor:
          </h4>
          <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.8125rem", color: "#14532d", lineHeight: 1.7 }}>
            <li><strong>Face presence:</strong> Ensures you remain visible during the exam</li>
            <li><strong>Multiple faces:</strong> Detects if additional people appear on camera</li>
            <li><strong>Gaze direction:</strong> Monitors if you look away from the screen</li>
            <li><strong>Liveness check:</strong> Basic verification that you&apos;re present (blinks, movement)</li>
          </ul>
        </div>

        {/* Privacy Notice */}
        <div
          style={{
            backgroundColor: "#fffbeb",
            border: "1px solid #fcd34d",
            borderRadius: "0.5rem",
            padding: "1rem",
            marginBottom: "1.25rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: "0.75rem" }}>
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
              <strong>Privacy Notice:</strong> Video processing occurs locally in your browser — no video 
              is streamed to servers. Snapshots are captured <em>only</em> when a violation is detected 
              and are retained according to your organization&apos;s data policy.
            </div>
          </div>
        </div>

        {/* Test Camera Button */}
        {!showPreview && (
          <button
            type="button"
            onClick={handlePreviewCamera}
            style={{
              width: "100%",
              padding: "0.75rem",
              backgroundColor: "#f1f5f9",
              color: "#475569",
              border: "1px solid #e2e8f0",
              borderRadius: "0.5rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              cursor: "pointer",
              marginBottom: "1rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              transition: "background-color 0.2s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.backgroundColor = "#e2e8f0";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "#f1f5f9";
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="23 7 16 12 23 17 23 7" />
              <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
            </svg>
            Preview Camera
          </button>
        )}

        {/* Consent Checkbox */}
        <label
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "0.75rem",
            cursor: "pointer",
            marginBottom: "1.25rem",
            padding: "0.75rem",
            backgroundColor: consentChecked ? "#f0fdf4" : "#f8fafc",
            border: `2px solid ${consentChecked ? "#10b981" : "#e2e8f0"}`,
            borderRadius: "0.5rem",
            transition: "all 0.2s",
          }}
        >
          <input
            type="checkbox"
            checked={consentChecked}
            onChange={(e) => setConsentChecked(e.target.checked)}
            style={{
              width: "1.25rem",
              height: "1.25rem",
              marginTop: "2px",
              accentColor: "#10b981",
            }}
          />
          <span style={{ fontSize: "0.875rem", color: "#334155", lineHeight: 1.5 }}>
            I understand that my camera will be used for proctoring purposes and consent to 
            face monitoring during this assessment. I acknowledge that snapshots will be 
            captured only when violations are detected.
          </span>
        </label>

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button
            type="button"
            onClick={handleDenyClick}
            disabled={isStarting || isLoading}
            style={{
              flex: 1,
              padding: "0.875rem",
              backgroundColor: "#f1f5f9",
              color: "#64748b",
              border: "1px solid #e2e8f0",
              borderRadius: "0.5rem",
              fontSize: "0.9375rem",
              fontWeight: 500,
              cursor: isStarting || isLoading ? "not-allowed" : "pointer",
              opacity: isStarting || isLoading ? 0.7 : 1,
              transition: "background-color 0.2s",
            }}
            onMouseOver={(e) => {
              if (!isStarting && !isLoading) {
                e.currentTarget.style.backgroundColor = "#e2e8f0";
              }
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.backgroundColor = "#f1f5f9";
            }}
          >
            Deny Camera
          </button>
          
          <button
            ref={acceptButtonRef}
            type="button"
            onClick={handleAcceptClick}
            disabled={!consentChecked || isStarting || isLoading}
            style={{
              flex: 2,
              padding: "0.875rem",
              backgroundColor: consentChecked && !isStarting && !isLoading ? "#10b981" : "#94a3b8",
              color: "#ffffff",
              border: "none",
              borderRadius: "0.5rem",
              fontSize: "0.9375rem",
              fontWeight: 600,
              cursor: consentChecked && !isStarting && !isLoading ? "pointer" : "not-allowed",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              transition: "background-color 0.2s",
            }}
            onMouseOver={(e) => {
              if (consentChecked && !isStarting && !isLoading) {
                e.currentTarget.style.backgroundColor = "#059669";
              }
            }}
            onMouseOut={(e) => {
              if (consentChecked && !isStarting && !isLoading) {
                e.currentTarget.style.backgroundColor = "#10b981";
              }
            }}
          >
            {isStarting || isLoading ? (
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
                Starting Camera...
              </>
            ) : (
              <>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                Allow Camera &amp; Start Proctoring
              </>
            )}
          </button>
        </div>

        {/* Warning about denying */}
        <p
          style={{
            textAlign: "center",
            color: "#94a3b8",
            fontSize: "0.75rem",
            marginTop: "1rem",
          }}
        >
          Denying camera access may affect your ability to complete this assessment.
        </p>
      </div>

      {/* CSS for animations */}
      <style jsx>{`
        @keyframes cameraModalFadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default CameraProctorModal;

