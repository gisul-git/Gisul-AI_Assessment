import React, { useState, useRef, useEffect, useCallback } from "react";

interface CameraProctorModalProps {
  isOpen: boolean;
  onAccept: (referencePhoto: string, screenStream: MediaStream) => Promise<boolean>;
  candidateName?: string;
  isLoading?: boolean;
  cameraError?: string | null;
}

/**
 * Modal for camera proctoring consent and initialization.
 * Step 1: Camera preview + capture photo
 * Step 2: Screen share + Start Assessment
 */
export function CameraProctorModal({
  isOpen,
  onAccept,
  candidateName,
  isLoading = false,
  cameraError = null,
}: CameraProctorModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const acceptButtonRef = useRef<HTMLButtonElement>(null);
  
  // Step management: 1 = camera/photo, 2 = screen share
  const [currentStep, setCurrentStep] = useState(1);
  
  // Step 1 states
  const [consentChecked, setConsentChecked] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isCameraLoading, setIsCameraLoading] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  
  // Step 2 states
  const [isRequestingScreen, setIsRequestingScreen] = useState(false);
  const [screenShareGranted, setScreenShareGranted] = useState(false);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  // Auto-start camera when modal opens
  useEffect(() => {
    if (isOpen && !previewStreamRef.current) {
      startCameraPreview();
    }
    
    // Cleanup when modal closes
    if (!isOpen) {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(track => track.stop());
        previewStreamRef.current = null;
      }
      setCameraReady(false);
      setIsCameraLoading(false);
      setCurrentStep(1);
      setCapturedPhoto(null);
      setConsentChecked(false);
      setScreenShareGranted(false);
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        setScreenStream(null);
      }
    }
  }, [isOpen]);

  // Focus the accept button when modal opens and consent is checked
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach(track => track.stop());
      }
      if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  const startCameraPreview = useCallback(async () => {
    try {
      setIsCameraLoading(true);
      setLocalError(null);
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: "user",
        },
      });
      
      previewStreamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play();
      }
      setCameraReady(true);
    } catch (error) {
      console.error("Camera preview error:", error);
      setLocalError("Could not access camera. Please check your permissions and try again.");
    } finally {
      setIsCameraLoading(false);
    }
  }, []);

  // Capture photo from video stream
  const handleCapturePhoto = useCallback(() => {
    if (!previewVideoRef.current || !canvasRef.current || !cameraReady) return;
    
    setIsCapturing(true);
    
    const video = previewVideoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    
    if (!ctx) {
      setIsCapturing(false);
      return;
    }
    
    // Use smaller resolution for faster processing
    const maxWidth = 640;
    const maxHeight = 480;
    let targetWidth = video.videoWidth;
    let targetHeight = video.videoHeight;
    
    if (targetWidth > maxWidth) {
      const ratio = maxWidth / targetWidth;
      targetWidth = maxWidth;
      targetHeight = Math.round(video.videoHeight * ratio);
    }
    if (targetHeight > maxHeight) {
      const ratio = maxHeight / targetHeight;
      targetHeight = maxHeight;
      targetWidth = Math.round(targetWidth * ratio);
    }
    
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    const photoData = canvas.toDataURL("image/jpeg", 0.6);
    setCapturedPhoto(photoData);
    sessionStorage.setItem("candidateReferencePhoto", photoData);
    
    setIsCapturing(false);
  }, [cameraReady]);

  // Retake photo
  const handleRetakePhoto = useCallback(() => {
    setCapturedPhoto(null);
    sessionStorage.removeItem("candidateReferencePhoto");
  }, []);

  // Move to Step 2
  const handleNextStep = useCallback(() => {
    if (capturedPhoto && consentChecked) {
      setCurrentStep(2);
    }
  }, [capturedPhoto, consentChecked]);

  // Request screen share
  const handleRequestScreenShare = useCallback(async () => {
    setIsRequestingScreen(true);
    setLocalError(null);
    
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          displaySurface: "monitor", // Prefer entire screen
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      
      setScreenStream(stream);
      setScreenShareGranted(true);
      
      // Store in sessionStorage that screen share was granted
      sessionStorage.setItem("screenShareGranted", "true");
      
      // Handle if user stops sharing
      stream.getVideoTracks()[0].onended = () => {
        setScreenShareGranted(false);
        setScreenStream(null);
        sessionStorage.removeItem("screenShareGranted");
      };
      
    } catch (error) {
      console.error("Screen share error:", error);
      setLocalError("Screen sharing is required. Please click 'Share Screen' and select 'Entire Screen'.");
    } finally {
      setIsRequestingScreen(false);
    }
  }, []);

  // Start assessment
  const handleStartAssessment = async () => {
    if (!capturedPhoto || !screenStream) return;
    
    setIsStarting(true);
    setLocalError(null);
    
    // Stop camera preview (the actual proctoring camera will start separately)
    if (previewStreamRef.current) {
      previewStreamRef.current.getTracks().forEach(track => track.stop());
      previewStreamRef.current = null;
      setCameraReady(false);
    }
    
    try {
      const success = await onAccept(capturedPhoto, screenStream);
      if (!success) {
        setLocalError("Failed to start. Please try again.");
      }
    } catch (error) {
      setLocalError("An error occurred. Please try again.");
    } finally {
      setIsStarting(false);
    }
  };

  const displayError = cameraError || localError;

  if (!isOpen) return null;

  return (
    <div
      ref={modalContainerRef}
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
        padding: "0.5rem",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="camera-proctor-modal-title"
      onClick={(e) => e.stopPropagation()}
    >
      <canvas ref={canvasRef} style={{ display: "none" }} />
      
      <div
        ref={modalRef}
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "0.75rem",
          maxWidth: "480px",
          width: "100%",
          padding: "1.25rem",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
          animation: "cameraModalFadeIn 0.2s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step Indicator */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem", marginBottom: "1rem" }}>
          <div style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            backgroundColor: currentStep >= 1 ? "#10b981" : "#e2e8f0",
            color: currentStep >= 1 ? "#fff" : "#64748b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.75rem",
            fontWeight: 700,
          }}>
            {currentStep > 1 ? "✓" : "1"}
          </div>
          <div style={{ width: "40px", height: "2px", backgroundColor: currentStep >= 2 ? "#10b981" : "#e2e8f0" }} />
          <div style={{
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            backgroundColor: currentStep >= 2 ? "#10b981" : "#e2e8f0",
            color: currentStep >= 2 ? "#fff" : "#64748b",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "0.75rem",
            fontWeight: 700,
          }}>
            2
          </div>
        </div>

        {/* STEP 1: Camera & Photo Capture */}
        {currentStep === 1 && (
          <>
            {/* Title Row */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{
                width: "40px",
                height: "40px",
                backgroundColor: displayError ? "#fef2f2" : "#ecfdf5",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={displayError ? "#ef4444" : "#10b981"} strokeWidth="2">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
              </div>
              <div>
                <h2 id="camera-proctor-modal-title" style={{ fontSize: "1.125rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Step 1: Capture Your Photo
                </h2>
                {candidateName && (
                  <p style={{ margin: 0, color: "#64748b", fontSize: "0.8125rem" }}>
                    Welcome, <strong>{candidateName}</strong>
                  </p>
                )}
              </div>
            </div>

            {/* Error message */}
            {displayError && (
              <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "0.75rem", textAlign: "center" }}>
                <p style={{ margin: 0, color: "#dc2626", fontSize: "0.8125rem", fontWeight: 500 }}>{displayError}</p>
                <button type="button" onClick={startCameraPreview} style={{ marginTop: "0.5rem", padding: "0.375rem 0.75rem", backgroundColor: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "0.375rem", fontSize: "0.75rem", fontWeight: 500, cursor: "pointer" }}>
                  Retry Camera Access
                </button>
              </div>
            )}

            {/* Camera Preview / Captured Photo */}
            <div style={{ marginBottom: "0.75rem", borderRadius: "0.5rem", overflow: "hidden", backgroundColor: "#000", aspectRatio: "16/10", position: "relative", border: capturedPhoto ? "2px solid #10b981" : "2px solid #e2e8f0" }}>
              {isCameraLoading && (
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", backgroundColor: "#1e293b", zIndex: 1 }}>
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                    <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                  </svg>
                  <p style={{ color: "#94a3b8", marginTop: "0.75rem", fontSize: "0.875rem" }}>Initializing camera...</p>
                </div>
              )}
              
              {capturedPhoto ? (
                <img src={capturedPhoto} alt="Captured photo" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <video ref={previewVideoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)", display: cameraReady ? "block" : "none" }} />
              )}
              
              {capturedPhoto && (
                <div style={{ position: "absolute", top: "0.75rem", left: "0.75rem", backgroundColor: "#10b981", color: "#fff", padding: "0.375rem 0.75rem", borderRadius: "1rem", fontSize: "0.75rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.375rem" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                  Photo Captured
                </div>
              )}
            </div>

            {/* Capture / Retake Buttons */}
            <div style={{ marginBottom: "0.75rem" }}>
              {!capturedPhoto ? (
                <button type="button" onClick={handleCapturePhoto} disabled={!cameraReady || isCapturing} style={{ width: "100%", padding: "0.625rem", backgroundColor: cameraReady && !isCapturing ? "#3b82f6" : "#94a3b8", color: "#ffffff", border: "none", borderRadius: "0.375rem", fontSize: "0.875rem", fontWeight: 600, cursor: cameraReady && !isCapturing ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                  {isCapturing ? "Capturing..." : "📸 Capture Your Photo"}
                </button>
              ) : (
                <button type="button" onClick={handleRetakePhoto} style={{ width: "100%", padding: "0.5rem", backgroundColor: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0", borderRadius: "0.375rem", fontSize: "0.8125rem", fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "0.375rem" }}>
                  🔄 Retake Photo
                </button>
              )}
            </div>

            {/* Consent Checkbox */}
            <label style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", cursor: "pointer", marginBottom: "0.75rem", padding: "0.5rem 0.625rem", backgroundColor: consentChecked ? "#f0fdf4" : "#f8fafc", border: `1.5px solid ${consentChecked ? "#10b981" : "#e2e8f0"}`, borderRadius: "0.375rem" }}>
              <input type="checkbox" checked={consentChecked} onChange={(e) => setConsentChecked(e.target.checked)} style={{ width: "1rem", height: "1rem", marginTop: "1px", accentColor: "#10b981" }} />
              <span style={{ fontSize: "0.75rem", color: "#334155", lineHeight: 1.4 }}>
                I consent to camera and screen monitoring during this assessment
              </span>
            </label>

            {/* Next Button */}
            <button
              type="button"
              onClick={handleNextStep}
              disabled={!capturedPhoto || !consentChecked}
              style={{
                width: "100%",
                padding: "0.625rem",
                backgroundColor: capturedPhoto && consentChecked ? "#10b981" : "#94a3b8",
                color: "#ffffff",
                border: "none",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: capturedPhoto && consentChecked ? "pointer" : "not-allowed",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.375rem",
              }}
            >
              Next: Share Screen →
            </button>

            {(!capturedPhoto || !consentChecked) && (
              <p style={{ textAlign: "center", color: "#94a3b8", fontSize: "0.6875rem", marginTop: "0.5rem" }}>
                {!capturedPhoto ? "📸 Capture photo first" : "☑️ Check consent box"}
              </p>
            )}
          </>
        )}

        {/* STEP 2: Screen Share */}
        {currentStep === 2 && (
          <>
            {/* Title Row */}
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
              <div style={{
                width: "40px",
                height: "40px",
                backgroundColor: screenShareGranted ? "#ecfdf5" : "#fef3c7",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={screenShareGranted ? "#10b981" : "#f59e0b"} strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <div>
                <h2 style={{ fontSize: "1.125rem", fontWeight: 700, color: "#1e293b", margin: 0 }}>
                  Step 2: Share Your Screen
                </h2>
                <p style={{ margin: 0, color: "#64748b", fontSize: "0.8125rem" }}>
                  Select "Entire Screen" for proctoring
                </p>
              </div>
            </div>

            {/* Error message */}
            {localError && (
              <div style={{ backgroundColor: "#fef2f2", border: "1px solid #fecaca", borderRadius: "0.5rem", padding: "0.75rem", marginBottom: "0.75rem", textAlign: "center" }}>
                <p style={{ margin: 0, color: "#dc2626", fontSize: "0.8125rem", fontWeight: 500 }}>{localError}</p>
              </div>
            )}

            {/* Screen Share Status */}
            <div style={{ marginBottom: "1rem", padding: "1rem", backgroundColor: screenShareGranted ? "#f0fdf4" : "#fffbeb", borderRadius: "0.5rem", border: `1px solid ${screenShareGranted ? "#86efac" : "#fcd34d"}`, textAlign: "center" }}>
              {screenShareGranted ? (
                <>
                  <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>✅</div>
                  <p style={{ margin: 0, color: "#16a34a", fontSize: "0.9375rem", fontWeight: 600 }}>Screen Sharing Active</p>
                  <p style={{ margin: "0.25rem 0 0", color: "#22c55e", fontSize: "0.75rem" }}>Your entire screen is being shared</p>
                </>
              ) : (
                <>
                  <div style={{ fontSize: "2.5rem", marginBottom: "0.5rem" }}>🖥️</div>
                  <p style={{ margin: 0, color: "#92400e", fontSize: "0.9375rem", fontWeight: 600 }}>Screen Share Required</p>
                  <p style={{ margin: "0.25rem 0 0", color: "#a16207", fontSize: "0.75rem" }}>Click below and select "Entire screen"</p>
                </>
              )}
            </div>

            {/* Instructions */}
            {!screenShareGranted && (
              <div style={{ backgroundColor: "#f8fafc", borderRadius: "0.375rem", padding: "0.75rem", marginBottom: "0.75rem", fontSize: "0.75rem", color: "#475569" }}>
                <strong style={{ color: "#334155" }}>Instructions:</strong>
                <ol style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem" }}>
                  <li>Click "Share Screen" button below</li>
                  <li>Select the <strong>"Entire screen"</strong> tab</li>
                  <li>Select your screen and click "Share"</li>
                </ol>
              </div>
            )}

            {/* Share Screen Button or Start Assessment Button */}
            {!screenShareGranted ? (
              <button
                type="button"
                onClick={handleRequestScreenShare}
                disabled={isRequestingScreen}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  backgroundColor: isRequestingScreen ? "#94a3b8" : "#f59e0b",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  cursor: isRequestingScreen ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                {isRequestingScreen ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                    Requesting...
                  </>
                ) : (
                  <>🖥️ Share Screen</>
                )}
              </button>
            ) : (
              <button
                ref={acceptButtonRef}
                type="button"
                onClick={handleStartAssessment}
                disabled={isStarting || isLoading}
                style={{
                  width: "100%",
                  padding: "0.75rem",
                  backgroundColor: isStarting || isLoading ? "#94a3b8" : "#10b981",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "0.375rem",
                  fontSize: "0.9375rem",
                  fontWeight: 600,
                  cursor: isStarting || isLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                }}
              >
                {isStarting || isLoading ? (
                  <>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: "spin 1s linear infinite" }}>
                      <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
                    </svg>
                    Starting Assessment...
                  </>
                ) : (
                  <>🚀 Start Assessment</>
                )}
              </button>
            )}

            {/* Back button */}
            <button
              type="button"
              onClick={() => { setCurrentStep(1); setLocalError(null); }}
              style={{
                width: "100%",
                marginTop: "0.5rem",
                padding: "0.5rem",
                backgroundColor: "transparent",
                color: "#64748b",
                border: "none",
                borderRadius: "0.375rem",
                fontSize: "0.8125rem",
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              ← Back to Photo
            </button>
          </>
        )}
      </div>

      <style jsx>{`
        @keyframes cameraModalFadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
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
