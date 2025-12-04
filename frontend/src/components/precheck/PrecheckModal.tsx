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

const STEP_ICONS: Record<CheckType, React.ReactNode> = {
  browser: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  ),
  network: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <line x1="12" y1="20" x2="12.01" y2="20" />
    </svg>
  ),
  camera: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  ),
  microphone: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  ),
  fullscreen: null,
  tabSwitch: null,
};

const STEP_TITLES: Record<CheckType, string> = {
  browser: "Browser Check",
  network: "Network Check", 
  camera: "Camera Access",
  microphone: "Microphone Test",
  fullscreen: "Fullscreen",
  tabSwitch: "Tab Switch",
};

const NEXT_STEP_LABELS: Record<number, string> = {
  0: "Next: Network Check →",
  1: "Next: Camera Access →",
  2: "Next: Microphone Test →",
  3: "Complete Pre-Check →",
};

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

  // Track if modal was previously open
  const wasOpenRef = useRef(false);
  
  // Reset ONLY when modal first opens (not on every render)
  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      // Modal just opened - reset to step 0
      setCurrentStep(0);
      setIsChecking(false);
      wasOpenRef.current = true;
    } else if (!isOpen && wasOpenRef.current) {
      // Modal just closed - cleanup
      stopAllStreams();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      wasOpenRef.current = false;
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

  // Setup clean audio visualization for microphone
  useEffect(() => {
    if (currentCheckType === "microphone" && microphoneStream) {
      const setupAudioVisualization = async () => {
        try {
          const audioContext = new AudioContext();
          audioContextRef.current = audioContext;
          
          const source = audioContext.createMediaStreamSource(microphoneStream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 64; // Fewer bars for cleaner look
          analyser.smoothingTimeConstant = 0.85;
          source.connect(analyser);
          analyserRef.current = analyser;

          const canvas = canvasRef.current;
          if (!canvas) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);
          const barCount = 24; // Fixed number of bars for consistent look
          const barGap = 4;
          const barWidth = (canvas.width - (barCount - 1) * barGap) / barCount;

          const draw = () => {
            if (!analyserRef.current || !canvas) return;
            
            animationFrameRef.current = requestAnimationFrame(draw);
            analyserRef.current.getByteFrequencyData(dataArray);

            // Clear with background
            ctx.fillStyle = "#f8fafc";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw threshold line
            const thresholdY = canvas.height * 0.6;
            ctx.strokeStyle = "#e2e8f0";
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, thresholdY);
            ctx.lineTo(canvas.width, thresholdY);
            ctx.stroke();
            ctx.setLineDash([]);

            // Calculate average for each bar group
            const samplesPerBar = Math.floor(bufferLength / barCount);
            
            for (let i = 0; i < barCount; i++) {
              // Average the frequency data for this bar
              let sum = 0;
              for (let j = 0; j < samplesPerBar; j++) {
                sum += dataArray[i * samplesPerBar + j];
              }
              const avg = sum / samplesPerBar;
              
              // Calculate bar height with minimum height
              const normalizedHeight = avg / 255;
              const barHeight = Math.max(4, normalizedHeight * canvas.height * 0.9);
              
              const x = i * (barWidth + barGap);
              const y = canvas.height - barHeight;
              
              // Color based on intensity
              const intensity = normalizedHeight;
              if (intensity > 0.4) {
                ctx.fillStyle = "#10b981"; // Green - good level
              } else if (intensity > 0.15) {
                ctx.fillStyle = "#fbbf24"; // Yellow - moderate
              } else {
                ctx.fillStyle = "#cbd5e1"; // Gray - low
              }
              
              // Draw rounded bar
              ctx.beginPath();
              ctx.roundRect(x, y, barWidth, barHeight, 2);
              ctx.fill();
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

  // Only block if HARMFUL extension is detected (screen recorder, automation, remote desktop)
  const hasHarmfulExtension = extensionScanResult?.hasHarmfulExtension ?? false;
  const canProceed = currentCheck?.status === "passed" && 
    (currentCheckType !== "microphone" || thresholdReached) &&
    (currentCheckType !== "browser" || !hasHarmfulExtension);

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.6)",
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
          maxWidth: "480px",
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Step Indicator - Matching the camera modal style */}
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          justifyContent: "center", 
          padding: "1.5rem 1.5rem 1rem",
          gap: "0.5rem",
        }}>
          {CHECK_ORDER.map((_, index) => (
            <React.Fragment key={index}>
              <div
                style={{
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  backgroundColor: index < currentStep
                    ? "#10b981"
                    : index === currentStep
                    ? "#10b981"
                    : "#e2e8f0",
                  color: index <= currentStep ? "#ffffff" : "#94a3b8",
                  transition: "all 0.3s ease",
                }}
              >
                {index < currentStep ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              {index < CHECK_ORDER.length - 1 && (
                <div
                  style={{
                    width: "40px",
                    height: "2px",
                    backgroundColor: index < currentStep ? "#10b981" : "#e2e8f0",
                    transition: "background-color 0.3s ease",
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Header with Icon and Title */}
        <div style={{ 
          display: "flex", 
          alignItems: "center", 
          gap: "0.75rem",
          padding: "0 1.5rem 1rem",
        }}>
          <div style={{
            width: "48px",
            height: "48px",
            borderRadius: "12px",
            backgroundColor: "#f0fdf4",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#10b981",
          }}>
            {STEP_ICONS[currentCheckType]}
          </div>
          <div>
            <h2 style={{ 
              fontSize: "1.25rem", 
              fontWeight: 700, 
              color: "#1e293b", 
              margin: 0,
            }}>
              Step {currentStep + 1}: {STEP_TITLES[currentCheckType]}
            </h2>
            {candidateName && (
              <p style={{ 
                fontSize: "0.875rem", 
                color: "#10b981", 
                margin: 0,
                fontWeight: 500,
              }}>
                Welcome, {candidateName}
              </p>
            )}
          </div>
        </div>

        {/* Content Area */}
        <div style={{ padding: "0 1.5rem 1.5rem" }}>
          
          {/* Browser Check */}
          {currentCheckType === "browser" && (
            <div>
              {currentCheck?.status === "passed" && !isBlockedByExtensions ? (
                <div style={{
                  backgroundColor: "#f0fdf4",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                }}>
                  <div style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    backgroundColor: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1rem",
                  }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p style={{ color: "#065f46", fontWeight: 600, fontSize: "1rem", margin: 0 }}>
                    {browserInfo.name} {browserInfo.version} is compatible
                  </p>
                </div>
              ) : currentCheck?.status === "running" || isExtensionScanning ? (
                <div style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  textAlign: "center",
                }}>
                  <div style={{
                    width: "48px",
                    height: "48px",
                    border: "3px solid #e2e8f0",
                    borderTopColor: "#10b981",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    margin: "0 auto 1rem",
                  }} />
                  <p style={{ color: "#64748b", margin: 0 }}>Checking browser compatibility...</p>
                </div>
              ) : (
                <div style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                }}>
                  <div style={{ color: "#94a3b8", marginBottom: "1rem" }}>
                    {STEP_ICONS[currentCheckType]}
                  </div>
                  <p style={{ color: "#64748b", margin: 0, marginBottom: "1rem" }}>
                    Click the button below to verify your browser is compatible
                  </p>
                </div>
              )}

              {/* Extension Warnings - Only show for HARMFUL extensions */}
              {extensionScanResult && hasHarmfulExtension && (
                <div
                  style={{
                    padding: "1rem",
                    backgroundColor: "#fef2f2",
                    border: "1px solid #fecaca",
                    borderRadius: "0.75rem",
                    marginBottom: "1rem",
                  }}
                >
                  <p style={{ fontWeight: 600, marginBottom: "0.5rem", color: "#dc2626", margin: 0 }}>
                    ⚠️ Harmful Extensions Detected
                  </p>
                  <ul style={{ margin: "0.5rem 0 0", paddingLeft: "1.25rem", fontSize: "0.875rem", color: "#dc2626" }}>
                    {extensionScanResult.extensions
                      .filter(ext => ext.category === "screen_recorder" || ext.category === "automation" || ext.category === "remote_desktop")
                      .map((ext, i) => (
                        <li key={i} style={{ marginBottom: "0.25rem" }}>
                          {ext.description}
                        </li>
                      ))}
                  </ul>
                  <p style={{ marginTop: "0.75rem", marginBottom: "0.75rem", fontSize: "0.875rem", color: "#dc2626" }}>
                    These extensions can interfere with the assessment. Please disable them and click &quot;Re-scan&quot;.
                  </p>
                  <button
                    onClick={async () => {
                      setIsChecking(true);
                      await scanExtensions();
                      setIsChecking(false);
                    }}
                    disabled={isChecking || isExtensionScanning}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      backgroundColor: "#dc2626",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "0.5rem",
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      cursor: isChecking || isExtensionScanning ? "not-allowed" : "pointer",
                      opacity: isChecking || isExtensionScanning ? 0.6 : 1,
                    }}
                  >
                    {isExtensionScanning ? "Scanning..." : "🔄 Re-scan for Extensions"}
                  </button>
                </div>
              )}

              {(!currentCheck || currentCheck.status === "pending") && (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking || isExtensionScanning}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    backgroundColor: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking || isExtensionScanning ? "not-allowed" : "pointer",
                    opacity: isChecking || isExtensionScanning ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                  }}
                >
                  🔍 Check Browser
                </button>
              )}
            </div>
          )}

          {/* Network Check */}
          {currentCheckType === "network" && (
            <div>
              {currentCheck?.status === "passed" ? (
                <div style={{
                  backgroundColor: "#f0fdf4",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                }}>
                  <div style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    backgroundColor: "#10b981",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    margin: "0 auto 1rem",
                  }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                  <p style={{ color: "#065f46", fontWeight: 600, fontSize: "1rem", margin: 0, marginBottom: "1rem" }}>
                    Internet Connection Verified
                  </p>
                  
                  {/* Speed Display */}
                  {networkMetrics && (
                    <div style={{ 
                      display: "flex", 
                      justifyContent: "center", 
                      gap: "1.5rem",
                      padding: "0.75rem",
                      backgroundColor: "#ffffff",
                      borderRadius: "0.5rem",
                      border: "1px solid #d1fae5",
                    }}>
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#059669" }}>
                          ↓ {networkMetrics.downloadSpeedMbps}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Mbps Down</div>
                      </div>
                      <div style={{ width: "1px", backgroundColor: "#d1fae5" }} />
                      <div style={{ textAlign: "center" }}>
                        <div style={{ fontSize: "1.25rem", fontWeight: 700, color: "#059669" }}>
                          ↑ {networkMetrics.uploadSpeedMbps || "N/A"}
                        </div>
                        <div style={{ fontSize: "0.75rem", color: "#6b7280" }}>Mbps Up</div>
                      </div>
                    </div>
                  )}
                </div>
              ) : currentCheck?.status === "running" ? (
                <div style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  textAlign: "center",
                }}>
                  <div style={{
                    width: "48px",
                    height: "48px",
                    border: "3px solid #e2e8f0",
                    borderTopColor: "#10b981",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    margin: "0 auto 1rem",
                  }} />
                  <p style={{ color: "#64748b", margin: 0 }}>{currentCheck.message || "Testing connection..."}</p>
                </div>
              ) : currentCheck?.status === "failed" ? (
                <div style={{
                  backgroundColor: "#fef2f2",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                }}>
                  <p style={{ color: "#dc2626", fontWeight: 600, margin: 0 }}>
                    ❌ {currentCheck.message}
                  </p>
                </div>
              ) : (
                <div style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                }}>
                  <div style={{ color: "#94a3b8", marginBottom: "1rem" }}>
                    {STEP_ICONS[currentCheckType]}
                  </div>
                  <p style={{ color: "#64748b", margin: 0 }}>
                    Click to test your internet speed
                  </p>
                </div>
              )}

              {(!currentCheck || currentCheck.status === "pending" || currentCheck.status === "failed") && (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    backgroundColor: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking ? "not-allowed" : "pointer",
                    opacity: isChecking ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                  }}
                >
                  📶 {currentCheck?.status === "failed" ? "Retry Connection" : "Test Speed"}
                </button>
              )}
            </div>
          )}

          {/* Camera Check */}
          {currentCheckType === "camera" && (
            <div>
              {/* Camera Preview */}
              {cameraStream ? (
                <div style={{
                  marginBottom: "1rem",
                  borderRadius: "0.75rem",
                  overflow: "hidden",
                  backgroundColor: "#000",
                }}>
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
                      height: "240px",
                      objectFit: "cover",
                      transform: "scaleX(-1)",
                    }}
                  />
                </div>
              ) : (
                <div style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                  minHeight: "200px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  {currentCheck?.status === "running" ? (
                    <>
                      <div style={{
                        width: "48px",
                        height: "48px",
                        border: "3px solid #e2e8f0",
                        borderTopColor: "#10b981",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                        marginBottom: "1rem",
                      }} />
                      <p style={{ color: "#64748b", margin: 0 }}>Accessing camera...</p>
                    </>
                  ) : currentCheck?.status === "failed" ? (
                    <>
                      <div style={{ color: "#ef4444", marginBottom: "1rem" }}>
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                      </div>
                      <p style={{ color: "#dc2626", fontWeight: 600, margin: 0 }}>{currentCheck.message}</p>
                    </>
                  ) : (
                    <>
                      <div style={{ color: "#94a3b8", marginBottom: "1rem" }}>
                        {STEP_ICONS[currentCheckType]}
                      </div>
                      <p style={{ color: "#64748b", margin: 0 }}>Camera preview will appear here</p>
                    </>
                  )}
                </div>
              )}

              {/* Camera Selector */}
              {cameras.length > 1 && (
                <div style={{ marginBottom: "1rem" }}>
                  <select
                    value={selectedCamera || ""}
                    onChange={(e) => setSelectedCamera(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #e2e8f0",
                      fontSize: "0.875rem",
                      backgroundColor: "#fff",
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

              {(!currentCheck || currentCheck.status === "pending" || currentCheck.status === "failed") && (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    backgroundColor: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking ? "not-allowed" : "pointer",
                    opacity: isChecking ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                  }}
                >
                  📷 {currentCheck?.status === "failed" ? "Retry Camera" : "Test Camera"}
                </button>
              )}
            </div>
          )}

          {/* Microphone Check */}
          {currentCheckType === "microphone" && (
            <div>
              {/* Microphone Selector */}
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
                      padding: "0.75rem",
                      borderRadius: "0.5rem",
                      border: "1px solid #e2e8f0",
                      fontSize: "0.875rem",
                      backgroundColor: "#fff",
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

              {currentCheck?.status === "passed" ? (
                <>
                  {/* Audio Visualizer */}
                  <div style={{
                    marginBottom: "1rem",
                    borderRadius: "0.75rem",
                    overflow: "hidden",
                    border: "1px solid #e2e8f0",
                  }}>
                    <canvas
                      ref={canvasRef}
                      width={500}
                      height={120}
                      style={{
                        width: "100%",
                        height: "120px",
                        backgroundColor: "#f8fafc",
                        display: "block",
                      }}
                    />
                  </div>

                  {/* dB Level Indicator */}
                  <div style={{
                    marginBottom: "1rem",
                    padding: "0.75rem",
                    backgroundColor: "#f8fafc",
                    borderRadius: "0.5rem",
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.5rem" }}>
                      <span style={{ fontSize: "0.875rem", color: "#64748b" }}>Audio Level</span>
                      <span style={{ fontSize: "0.875rem", fontWeight: 600, color: thresholdReached ? "#10b981" : "#64748b" }}>
                        {audioDbLevel > -Infinity ? `${audioDbLevel.toFixed(1)} dB` : "-- dB"}
                      </span>
                    </div>
                    <div style={{
                      height: "8px",
                      backgroundColor: "#e2e8f0",
                      borderRadius: "4px",
                      overflow: "hidden",
                    }}>
                      <div style={{
                        height: "100%",
                        width: `${Math.max(0, Math.min(100, (audioDbLevel + 60) * 2))}%`,
                        backgroundColor: thresholdReached ? "#10b981" : "#fbbf24",
                        transition: "width 0.1s ease",
                      }} />
                    </div>
                  </div>

                  {/* Recording Controls */}
                  <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        style={{
                          flex: 1,
                          padding: "1rem",
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
                        🎙️ Start Recording (2s)
                      </button>
                    ) : (
                      <button
                        onClick={stopRecording}
                        style={{
                          flex: 1,
                          padding: "1rem",
                          backgroundColor: "#ef4444",
                          color: "#ffffff",
                          border: "none",
                          borderRadius: "0.5rem",
                          fontSize: "1rem",
                          fontWeight: 600,
                          cursor: "pointer",
                          animation: "pulse 1s infinite",
                        }}
                      >
                        ⏺️ Recording...
                      </button>
                    )}

                    {recordedAudio && (
                      <button
                        onClick={playRecording}
                        style={{
                          padding: "1rem 1.5rem",
                          backgroundColor: "#3b82f6",
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
                        ▶️ Play
                      </button>
                    )}
                  </div>

                  {/* Threshold Status */}
                  {thresholdReached ? (
                    <div
                      style={{
                        padding: "1rem",
                        backgroundColor: "#f0fdf4",
                        border: "1px solid #86efac",
                        borderRadius: "0.5rem",
                        textAlign: "center",
                      }}
                    >
                      <p style={{ color: "#065f46", fontWeight: 600, margin: 0 }}>
                        ✓ Audio verified! Your microphone is working.
                      </p>
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: "1rem",
                        backgroundColor: "#fffbeb",
                        border: "1px solid #fcd34d",
                        borderRadius: "0.5rem",
                        textAlign: "center",
                      }}
                    >
                      <p style={{ color: "#92400e", margin: 0, fontSize: "0.875rem" }}>
                        💡 Click &quot;Start Recording&quot; and speak clearly for 2 seconds
                      </p>
                    </div>
                  )}
                </>
              ) : currentCheck?.status === "running" ? (
                <div style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  textAlign: "center",
                }}>
                  <div style={{
                    width: "48px",
                    height: "48px",
                    border: "3px solid #e2e8f0",
                    borderTopColor: "#10b981",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                    margin: "0 auto 1rem",
                  }} />
                  <p style={{ color: "#64748b", margin: 0 }}>Accessing microphone...</p>
                </div>
              ) : currentCheck?.status === "failed" ? (
                <div style={{
                  backgroundColor: "#fef2f2",
                  borderRadius: "0.75rem",
                  padding: "1.5rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                }}>
                  <p style={{ color: "#dc2626", fontWeight: 600, margin: 0 }}>
                    ❌ {currentCheck.message}
                  </p>
                </div>
              ) : (
                <div style={{
                  backgroundColor: "#f8fafc",
                  borderRadius: "0.75rem",
                  padding: "2rem",
                  textAlign: "center",
                  marginBottom: "1rem",
                }}>
                  <div style={{ color: "#94a3b8", marginBottom: "1rem" }}>
                    {STEP_ICONS[currentCheckType]}
                  </div>
                  <p style={{ color: "#64748b", margin: 0 }}>
                    Click to test your microphone
                  </p>
                </div>
              )}

              {(!currentCheck || currentCheck.status === "pending" || currentCheck.status === "failed") && (
                <button
                  onClick={handleRunCheck}
                  disabled={isChecking}
                  style={{
                    width: "100%",
                    padding: "1rem",
                    backgroundColor: "#10b981",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "0.5rem",
                    fontSize: "1rem",
                    fontWeight: 600,
                    cursor: isChecking ? "not-allowed" : "pointer",
                    opacity: isChecking ? 0.6 : 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: "0.5rem",
                  }}
                >
                  🎤 {currentCheck?.status === "failed" ? "Retry Microphone" : "Test Microphone"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Footer with Next Button */}
        <div style={{ 
          padding: "1rem 1.5rem 1.5rem", 
          borderTop: "1px solid #f1f5f9",
        }}>
          <button
            onClick={handleNext}
            disabled={!canProceed}
            style={{
              width: "100%",
              padding: "1rem",
              backgroundColor: canProceed ? "#10b981" : "#e2e8f0",
              color: canProceed ? "#ffffff" : "#94a3b8",
              border: "none",
              borderRadius: "0.5rem",
              fontSize: "1rem",
              fontWeight: 600,
              cursor: canProceed ? "pointer" : "not-allowed",
              transition: "all 0.2s ease",
            }}
          >
            {NEXT_STEP_LABELS[currentStep]}
          </button>
        </div>

        {/* CSS for animations */}
        <style jsx>{`
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
          }
        `}</style>
      </div>
    </div>
  );
}


