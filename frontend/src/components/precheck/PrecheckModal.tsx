import React, { useState, useRef, useEffect, useCallback } from "react";
import { usePrecheck, type CheckType } from "@/hooks/usePrecheck";
import { usePrecheckExtensions } from "@/hooks/usePrecheckExtensions";

interface PrecheckModalProps {
  isOpen: boolean;
  onComplete: () => void;
  onClose?: () => void;
  assessmentId: string;
  userId: string;
  candidateName?: string;
}

const CHECK_ORDER: CheckType[] = ["browser", "network", "camera", "microphone"];

export function PrecheckModal({
  isOpen,
  onComplete,
  onClose,
  assessmentId,
  userId,
  candidateName,
}: PrecheckModalProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  
  // Extension detection
  const {
    isScanning: isExtensionScanning,
    scanResult: extensionScanResult,
    scan: scanExtensions,
  } = usePrecheckExtensions();

  // Precheck hook
  const {
    checks,
    cameras,
    microphones,
    selectedCamera,
    selectedMicrophone,
    setSelectedCamera,
    setSelectedMicrophone,
    runCheck,
    cameraStream,
    microphoneStream,
    isRecording,
    recordedAudio,
    audioDbLevel,
    thresholdReached,
    startRecording,
    stopRecording,
    playRecording,
    stopAllStreams,
    networkMetrics,
    browserInfo,
  } = usePrecheck({
    assessmentId,
    userId,
    maxLatencyMs: 500,
    minDownloadMbps: 0.5,
    cameraRequired: true,
    microphoneRequired: true,
  });

  const currentCheckType = CHECK_ORDER[currentStep];
  const currentCheck = checks[currentCheckType];

  // Audio frequency visualization
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
      setIsChecking(false);
    } else {
      stopAllStreams();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    }
  }, [isOpen, stopAllStreams]);

  // Handle running current check
  const handleRunCheck = useCallback(async () => {
    if (isChecking) return;
    
    setIsChecking(true);
    try {
      await runCheck(currentCheckType);
      
      // For browser check, also scan extensions
      if (currentCheckType === "browser") {
        await scanExtensions();
      }
    } finally {
      setIsChecking(false);
    }
  }, [currentCheckType, isChecking, runCheck, scanExtensions]);

  // Handle next step
  const handleNext = useCallback(() => {
    if (currentStep < CHECK_ORDER.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      // All checks complete
      onComplete();
    }
  }, [currentStep, onComplete]);

  // Setup audio frequency visualization for microphone
  useEffect(() => {
    if (currentCheckType === "microphone" && microphoneStream) {
          const setupAudioVisualization = async () => {
        try {
          const audioContext = new AudioContext();
          audioContextRef.current = audioContext;
          
          const source = audioContext.createMediaStreamSource(microphoneStream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          analyser.smoothingTimeConstant = 0.8;
          source.connect(analyser);
          analyserRef.current = analyser;

          const canvas = canvasRef.current;
          if (!canvas) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          const draw = () => {
            if (!analyserRef.current || !canvas) return;
            
            animationFrameRef.current = requestAnimationFrame(draw);
            analyserRef.current.getByteFrequencyData(dataArray);

            ctx.fillStyle = "#f7f3e8";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            const barWidth = canvas.width / bufferLength * 2.5;
            let barHeight;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
              barHeight = (dataArray[i] / 255) * canvas.height;
              
              const gradient = ctx.createLinearGradient(0, canvas.height, 0, canvas.height - barHeight);
              gradient.addColorStop(0, "#6953a3");
              gradient.addColorStop(1, "#10b981");
              
              ctx.fillStyle = gradient;
              ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
              
              x += barWidth + 1;
            }
          };

          draw();
        } catch (error) {
          console.error("Audio visualization error:", error);
        }
      };

      setupAudioVisualization();
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        }
      };
    }, [currentCheckType, microphoneStream]);

  if (!isOpen) return null;

  const getCheckTitle = (type: CheckType): string => {
    switch (type) {
      case "browser": return "Browser Compatibility";
      case "network": return "Network Connection";
      case "camera": return "Camera Access";
      case "microphone": return "Microphone Access";
      default: return type;
    }
  };

  const isBlockedByExtensions = extensionScanResult?.hasHighRisk ?? false;
  const canProceed = currentCheck?.status === "passed" && 
    (currentCheckType !== "microphone" || thresholdReached) &&
    (currentCheckType !== "browser" || !isBlockedByExtensions);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        padding: "1rem",
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && onClose) {
          onClose();
        }
      }}
    >
      <div
        style={{
          backgroundColor: "#ffffff",
          borderRadius: "1rem",
          maxWidth: "600px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress Indicator */}
        <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
              Step {currentStep + 1} of {CHECK_ORDER.length}
            </span>
            <span style={{ fontSize: "0.875rem", color: "#64748b" }}>
              {CHECK_ORDER.filter((_, i) => i < currentStep && checks[CHECK_ORDER[i]]?.status === "passed").length} / {currentStep} passed
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {CHECK_ORDER.map((_, index) => (
              <div
                key={index}
                style={{
                  flex: 1,
                  height: "6px",
                  backgroundColor: index < currentStep
                    ? checks[CHECK_ORDER[index]]?.status === "passed" ? "#10b981" : "#ef4444"
                    : index === currentStep
                    ? "#6953a3"
                    : "#e2e8f0",
                  borderRadius: "3px",
                  transition: "background-color 0.3s",
                }}
              />
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: "2rem" }}>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 700, color: "#1e293b", marginBottom: "0.5rem" }}>
            {getCheckTitle(currentCheckType)}
          </h2>
          
          {candidateName && (
            <p style={{ fontSize: "0.875rem", color: "#64748b", marginBottom: "1.5rem" }}>
              Welcome, {candidateName}
            </p>
          )}

          {/* Browser Check */}
          {currentCheckType === "browser" && (
            <div>
              <p style={{ color: "#64748b", marginBottom: "1rem" }}>
                {currentCheck?.status === "pending" && "Click the button below to check your browser compatibility and detect any extensions."}
                {currentCheck?.status === "running" && "Checking browser compatibility..."}
                {currentCheck?.status === "passed" && currentCheck.message}
                {currentCheck?.status === "failed" && currentCheck.message}
              </p>

              {!currentCheck || currentCheck.status === "pending" ? (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking || isExtensionScanning}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#6953a3",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking || isExtensionScanning ? "not-allowed" : "pointer",
                    opacity: isChecking || isExtensionScanning ? 0.6 : 1,
                  }}
                >
                  {isChecking || isExtensionScanning ? "Scanning..." : "Check Browser"}
                </button>
              ) : null}

              {/* Extension Warnings */}
              {extensionScanResult && extensionScanResult.extensions.length > 0 && (
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "1rem",
                    backgroundColor: isBlockedByExtensions ? "#fef2f2" : "#fffbeb",
                    border: `1px solid ${isBlockedByExtensions ? "#fecaca" : "#fcd34d"}`,
                    borderRadius: "0.5rem",
                  }}
                >
                  <p style={{ fontWeight: 600, marginBottom: "0.5rem", color: isBlockedByExtensions ? "#dc2626" : "#92400e" }}>
                    {isBlockedByExtensions ? "⚠️ Action Required" : "ℹ️ Extensions Detected"}
                  </p>
                  <ul style={{ margin: 0, paddingLeft: "1.25rem", fontSize: "0.875rem", color: isBlockedByExtensions ? "#dc2626" : "#92400e" }}>
                    {extensionScanResult.extensions.map((ext, i) => (
                      <li key={i} style={{ marginBottom: "0.25rem" }}>
                        {ext.description} ({ext.category})
                      </li>
                    ))}
                  </ul>
                  {isBlockedByExtensions && (
                    <p style={{ marginTop: "0.75rem", fontSize: "0.875rem", color: "#dc2626" }}>
                      Please disable or remove these extensions before proceeding.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Network Check */}
          {currentCheckType === "network" && (
            <div>
              <p style={{ color: "#64748b", marginBottom: "1rem" }}>
                {currentCheck?.status === "pending" && "Click the button below to check your internet connection."}
                {currentCheck?.status === "running" && "Testing internet connection..."}
                {currentCheck?.status === "passed" && "✓ Internet connection is available"}
                {currentCheck?.status === "failed" && currentCheck.message}
              </p>

              {!currentCheck || currentCheck.status === "pending" ? (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#6953a3",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking ? "not-allowed" : "pointer",
                    opacity: isChecking ? 0.6 : 1,
                  }}
                >
                  {isChecking ? "Checking..." : "Check Connection"}
                </button>
              ) : null}
            </div>
          )}

          {/* Camera Check */}
          {currentCheckType === "camera" && (
            <div>
              {cameras.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                    Select Camera:
                  </label>
                  <select
                    value={selectedCamera || ""}
                    onChange={(e) => setSelectedCamera(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #e2e8f0",
                      fontSize: "0.875rem",
                    }}
                  >
                    {cameras.map((cam) => (
                      <option key={cam.deviceId} value={cam.deviceId}>
                        {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p style={{ color: "#64748b", marginBottom: "1rem" }}>
                {currentCheck?.status === "pending" && "Click the button below to test your camera."}
                {currentCheck?.status === "running" && "Accessing camera..."}
                {currentCheck?.status === "passed" && "✓ Camera is working"}
                {currentCheck?.status === "failed" && currentCheck.message}
              </p>

              {cameraStream && (
                <div style={{ marginBottom: "1rem", textAlign: "center" }}>
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
                      maxWidth: "400px",
                      borderRadius: "0.5rem",
                      backgroundColor: "#000",
                      transform: "scaleX(-1)",
                    }}
                  />
                </div>
              )}

              {!currentCheck || currentCheck.status === "pending" ? (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#6953a3",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking ? "not-allowed" : "pointer",
                    opacity: isChecking ? 0.6 : 1,
                  }}
                >
                  {isChecking ? "Checking..." : "Test Camera"}
                </button>
              ) : null}
            </div>
          )}

          {/* Microphone Check */}
          {currentCheckType === "microphone" && (
            <div>
              {microphones.length > 0 && (
                <div style={{ marginBottom: "1rem" }}>
                  <label style={{ display: "block", fontSize: "0.875rem", color: "#64748b", marginBottom: "0.5rem" }}>
                    Select Microphone:
                  </label>
                  <select
                    value={selectedMicrophone || ""}
                    onChange={(e) => setSelectedMicrophone(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      borderRadius: "0.375rem",
                      border: "1px solid #e2e8f0",
                      fontSize: "0.875rem",
                    }}
                  >
                    {microphones.map((mic) => (
                      <option key={mic.deviceId} value={mic.deviceId}>
                        {mic.label || `Microphone ${mic.deviceId.slice(0, 8)}`}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <p style={{ color: "#64748b", marginBottom: "1rem" }}>
                {currentCheck?.status === "pending" && "Click the button below to test your microphone."}
                {currentCheck?.status === "running" && "Accessing microphone..."}
                {currentCheck?.status === "passed" && "✓ Microphone is ready. Please record a test."}
                {currentCheck?.status === "failed" && currentCheck.message}
              </p>

              {currentCheck?.status === "passed" && (
                <>
                  {/* Frequency Display */}
                  <div style={{ marginBottom: "1rem", textAlign: "center" }}>
                    <canvas
                      ref={canvasRef}
                      width={500}
                      height={150}
                      style={{
                        width: "100%",
                        maxWidth: "500px",
                        height: "150px",
                        backgroundColor: "#f7f3e8",
                        borderRadius: "0.5rem",
                        border: "1px solid #e2e8f0",
                      }}
                    />
                  </div>

                  {/* Recording Controls */}
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        style={{
                          flex: 1,
                          padding: "0.75rem 1.5rem",
                          backgroundColor: "#6953a3",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "0.5rem",
                          fontSize: "1rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <circle cx="12" cy="12" r="3" fill="currentColor" />
                        </svg>
                        Start Recording
                      </button>
                    ) : (
                      <button
                        onClick={stopRecording}
                        style={{
                          flex: 1,
                          padding: "0.75rem 1.5rem",
                          backgroundColor: "#ef4444",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "0.5rem",
                          fontSize: "1rem",
                          fontWeight: 600,
                          cursor: "pointer",
                        }}
                      >
                        Recording... (2s)
                      </button>
                    )}

                    {recordedAudio && (
                      <button
                        onClick={playRecording}
                        style={{
                          padding: "0.75rem 1.5rem",
                          backgroundColor: "#10b981",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "0.5rem",
                          fontSize: "1rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                        Play
                      </button>
                    )}
                  </div>

                  {/* Threshold Status */}
                  {thresholdReached && (
                    <div
                      style={{
                        padding: "0.75rem",
                        backgroundColor: "#ecfdf5",
                        border: "1px solid #86efac",
                        borderRadius: "0.5rem",
                        fontSize: "0.875rem",
                        color: "#065f46",
                        textAlign: "center",
                      }}
                    >
                      ✓ Audio threshold reached! ({audioDbLevel.toFixed(1)} dB)
                    </div>
                  )}
                </>
              )}

              {!currentCheck || currentCheck.status === "pending" ? (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking}
                  style={{
                    width: "100%",
                    padding: "0.75rem 1.5rem",
                    backgroundColor: "#6953a3",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking ? "not-allowed" : "pointer",
                    opacity: isChecking ? 0.6 : 1,
                  }}
                >
                  {isChecking ? "Checking..." : "Test Microphone"}
                </button>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "1.5rem", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "space-between", gap: "1rem" }}>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: "0.75rem 1.5rem",
                backgroundColor: "#f1f5f9",
                color: "#64748b",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          )}
          
          {canProceed && (
            <button
              onClick={handleNext}
              style={{
                flex: 1,
                padding: "0.75rem 1.5rem",
                backgroundColor: "#10b981",
                color: "#ffffff",
                border: "none",
                borderRadius: "0.5rem",
                fontSize: "1rem",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
              }}
            >
              {currentStep < CHECK_ORDER.length - 1 ? (
                <>
                  Next
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </>
              ) : (
                "Complete"
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


