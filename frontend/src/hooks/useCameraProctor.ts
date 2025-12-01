import { useEffect, useRef, useState, useCallback } from "react";

// ============================================================================
// Types and Interfaces
// ============================================================================

export type CameraProctorEventType = 
  | "MULTI_FACE" 
  | "GAZE_AWAY" 
  | "SPOOF_DETECTED" 
  | "CAMERA_DENIED"
  | "CAMERA_ERROR";

export interface CameraProctorViolation {
  eventType: CameraProctorEventType;
  timestamp: string;
  assessmentId: string;
  userId: string;
  metadata?: Record<string, unknown>;
  snapshotBase64?: string | null;
}

export interface FaceBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
}

export interface GazeDirection {
  direction: "center" | "left" | "right" | "up" | "down" | "away";
  confidence: number;
}

interface UseCameraProctorOptions {
  userId: string;
  assessmentId: string;
  onViolation?: (violation: CameraProctorViolation) => void;
  detectionIntervalMs?: number;
  throttleIntervalMs?: number;
  gazeAwayThreshold?: number; // Consecutive checks before GAZE_AWAY
  multiFaceConfidenceThreshold?: number;
  blinkTimeoutSeconds?: number; // Time without blinks before SPOOF_DETECTED
  debugMode?: boolean;
  enabled?: boolean;
}

interface UseCameraProctorReturn {
  // State
  isCameraOn: boolean;
  isModelLoaded: boolean;
  facesCount: number;
  lastViolation: CameraProctorViolation | null;
  errors: string[];
  gazeDirection: GazeDirection | null;
  isBlinking: boolean;
  
  // Actions
  startCamera: () => Promise<boolean>;
  stopCamera: () => void;
  requestCameraPermission: () => Promise<boolean>;
  
  // Debug
  videoRef: React.RefObject<HTMLVideoElement>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  debugInfo: DebugInfo | null;
}

interface DebugInfo {
  fps: number;
  lastDetectionTime: number;
  faceBoxes: FaceBox[];
  gazeVector: { x: number; y: number } | null;
  blinkCount: number;
  headMovement: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_DETECTION_INTERVAL_MS = 700;
const DEFAULT_THROTTLE_INTERVAL_MS = 5000;
const DEFAULT_GAZE_AWAY_THRESHOLD = 3; // 3 consecutive checks ≈ 2.1s
const DEFAULT_MULTI_FACE_CONFIDENCE = 0.5;
const DEFAULT_BLINK_TIMEOUT_SECONDS = 6;
const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 360;
const INFERENCE_WIDTH = 320;
const INFERENCE_HEIGHT = 180;

// Eye aspect ratio threshold for blink detection
const EYE_AR_THRESHOLD = 0.2;

// Gaze thresholds (relative pupil position)
const GAZE_LEFT_THRESHOLD = -0.15;
const GAZE_RIGHT_THRESHOLD = 0.15;
const GAZE_UP_THRESHOLD = -0.12;
const GAZE_DOWN_THRESHOLD = 0.12;

// Head movement threshold for spoof detection
const HEAD_MOVEMENT_THRESHOLD = 2.5; // pixels of average landmark movement

// ============================================================================
// Helper Functions
// ============================================================================

const isDebugModeEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get("cameraDebug") === "true" || 
         urlParams.get("proctorDebug") === "true" ||
         process.env.NEXT_PUBLIC_CAMERA_DEBUG === "true";
};

// Calculate Eye Aspect Ratio (EAR) for blink detection
const calculateEAR = (eyeLandmarks: number[][]): number => {
  if (eyeLandmarks.length < 6) return 1;
  
  // Vertical distances
  const v1 = Math.sqrt(
    Math.pow(eyeLandmarks[1][0] - eyeLandmarks[5][0], 2) +
    Math.pow(eyeLandmarks[1][1] - eyeLandmarks[5][1], 2)
  );
  const v2 = Math.sqrt(
    Math.pow(eyeLandmarks[2][0] - eyeLandmarks[4][0], 2) +
    Math.pow(eyeLandmarks[2][1] - eyeLandmarks[4][1], 2)
  );
  
  // Horizontal distance
  const h = Math.sqrt(
    Math.pow(eyeLandmarks[0][0] - eyeLandmarks[3][0], 2) +
    Math.pow(eyeLandmarks[0][1] - eyeLandmarks[3][1], 2)
  );
  
  if (h === 0) return 1;
  return (v1 + v2) / (2.0 * h);
};

// Calculate gaze direction from iris position relative to eye corners
const calculateGazeDirection = (
  leftIris: number[] | null,
  rightIris: number[] | null,
  leftEyeCorners: number[][] | null,
  rightEyeCorners: number[][] | null
): GazeDirection => {
  if (!leftIris || !rightIris || !leftEyeCorners || !rightEyeCorners) {
    return { direction: "away", confidence: 0.5 };
  }
  
  // Calculate relative position of iris within eye socket
  const leftEyeWidth = Math.abs(leftEyeCorners[1][0] - leftEyeCorners[0][0]);
  const leftEyeHeight = Math.abs(leftEyeCorners[3][1] - leftEyeCorners[2][1]) || leftEyeWidth * 0.5;
  const leftIrisRelX = leftEyeWidth > 0 
    ? (leftIris[0] - (leftEyeCorners[0][0] + leftEyeCorners[1][0]) / 2) / leftEyeWidth 
    : 0;
  const leftIrisRelY = leftEyeHeight > 0
    ? (leftIris[1] - (leftEyeCorners[2][1] + leftEyeCorners[3][1]) / 2) / leftEyeHeight
    : 0;
    
  const rightEyeWidth = Math.abs(rightEyeCorners[1][0] - rightEyeCorners[0][0]);
  const rightEyeHeight = Math.abs(rightEyeCorners[3][1] - rightEyeCorners[2][1]) || rightEyeWidth * 0.5;
  const rightIrisRelX = rightEyeWidth > 0
    ? (rightIris[0] - (rightEyeCorners[0][0] + rightEyeCorners[1][0]) / 2) / rightEyeWidth
    : 0;
  const rightIrisRelY = rightEyeHeight > 0
    ? (rightIris[1] - (rightEyeCorners[2][1] + rightEyeCorners[3][1]) / 2) / rightEyeHeight
    : 0;
  
  // Average the gaze from both eyes
  const avgX = (leftIrisRelX + rightIrisRelX) / 2;
  const avgY = (leftIrisRelY + rightIrisRelY) / 2;
  
  // Determine direction
  let direction: GazeDirection["direction"] = "center";
  let confidence = 0.8;
  
  if (avgX < GAZE_LEFT_THRESHOLD) {
    direction = "left";
    confidence = Math.min(1, Math.abs(avgX - GAZE_LEFT_THRESHOLD) * 5 + 0.6);
  } else if (avgX > GAZE_RIGHT_THRESHOLD) {
    direction = "right";
    confidence = Math.min(1, Math.abs(avgX - GAZE_RIGHT_THRESHOLD) * 5 + 0.6);
  } else if (avgY < GAZE_UP_THRESHOLD) {
    direction = "up";
    confidence = Math.min(1, Math.abs(avgY - GAZE_UP_THRESHOLD) * 5 + 0.6);
  } else if (avgY > GAZE_DOWN_THRESHOLD) {
    direction = "down";
    confidence = Math.min(1, Math.abs(avgY - GAZE_DOWN_THRESHOLD) * 5 + 0.6);
  }
  
  return { direction, confidence };
};

// ============================================================================
// Main Hook
// ============================================================================

export function useCameraProctor({
  userId,
  assessmentId,
  onViolation,
  detectionIntervalMs = DEFAULT_DETECTION_INTERVAL_MS,
  throttleIntervalMs = DEFAULT_THROTTLE_INTERVAL_MS,
  gazeAwayThreshold = DEFAULT_GAZE_AWAY_THRESHOLD,
  multiFaceConfidenceThreshold = DEFAULT_MULTI_FACE_CONFIDENCE,
  blinkTimeoutSeconds = DEFAULT_BLINK_TIMEOUT_SECONDS,
  debugMode = isDebugModeEnabled(),
  enabled = true,
}: UseCameraProctorOptions): UseCameraProctorReturn {
  // ============================================================================
  // State
  // ============================================================================
  
  const [isCameraOn, setIsCameraOn] = useState(false);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [facesCount, setFacesCount] = useState(0);
  const [lastViolation, setLastViolation] = useState<CameraProctorViolation | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [gazeDirection, setGazeDirection] = useState<GazeDirection | null>(null);
  const [isBlinking, setIsBlinking] = useState(false);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  
  // ============================================================================
  // Refs
  // ============================================================================
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const faceDetectorRef = useRef<any>(null);
  const faceMeshRef = useRef<any>(null);
  
  // Tracking refs
  const lastEventTimeRef = useRef<Record<string, number>>({});
  const gazeAwayCountRef = useRef(0);
  const lastBlinkTimeRef = useRef<number>(Date.now());
  const blinkCountRef = useRef(0);
  const previousLandmarksRef = useRef<number[][] | null>(null);
  const headMovementHistoryRef = useRef<number[]>([]);
  const fpsCounterRef = useRef({ frames: 0, lastTime: Date.now() });
  
  // ============================================================================
  // Debug Logger
  // ============================================================================
  
  const debugLog = useCallback((...args: unknown[]) => {
    if (debugMode) {
      console.log("[CameraProctor Debug]", ...args);
    }
  }, [debugMode]);
  
  // ============================================================================
  // Throttle Check
  // ============================================================================
  
  const shouldRecordEvent = useCallback((eventType: string): boolean => {
    const now = Date.now();
    const lastTime = lastEventTimeRef.current[eventType] || 0;
    
    if (now - lastTime < throttleIntervalMs) {
      debugLog(`Throttled ${eventType} (last: ${now - lastTime}ms ago)`);
      return false;
    }
    
    lastEventTimeRef.current[eventType] = now;
    return true;
  }, [throttleIntervalMs, debugLog]);
  
  // ============================================================================
  // Capture Snapshot
  // ============================================================================
  
  const captureSnapshot = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    
    try {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      
      canvas.width = VIDEO_WIDTH;
      canvas.height = VIDEO_HEIGHT;
      ctx.drawImage(videoRef.current, 0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);
      
      return canvas.toDataURL("image/jpeg", 0.7);
    } catch (error) {
      debugLog("Error capturing snapshot:", error);
      return null;
    }
  }, [debugLog]);
  
  // ============================================================================
  // Record Violation
  // ============================================================================
  
  const recordViolation = useCallback(async (
    eventType: CameraProctorEventType,
    metadata?: Record<string, unknown>,
    captureImage: boolean = true
  ) => {
    if (!userId || !assessmentId) {
      debugLog("Skipped recording - missing userId or assessmentId");
      return;
    }
    
    if (!shouldRecordEvent(eventType)) {
      return;
    }
    
    const snapshotBase64 = captureImage ? captureSnapshot() : null;
    
    const violation: CameraProctorViolation = {
      eventType,
      timestamp: new Date().toISOString(),
      assessmentId,
      userId,
      metadata,
      snapshotBase64,
    };
    
    setLastViolation(violation);
    
    debugLog(`Event recorded: ${eventType}`, metadata);
    console.log(`[CameraProctor] ${eventType} violation recorded:`, { eventType, userId, assessmentId });
    
    if (onViolation) {
      onViolation(violation);
    }
    
    // Send to backend
    try {
      const response = await fetch("/api/proctor/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(violation),
      });
      
      if (!response.ok) {
        console.error("[CameraProctor] Failed to record violation:", response.statusText);
      } else {
        debugLog("Event sent to server successfully");
      }
    } catch (error) {
      console.error("[CameraProctor] Error sending violation:", error);
    }
  }, [userId, assessmentId, onViolation, shouldRecordEvent, captureSnapshot, debugLog]);
  
  // ============================================================================
  // Load Models (BlazeFace + FaceMesh via TensorFlow.js)
  // ============================================================================
  
  const loadModels = useCallback(async (): Promise<boolean> => {
    try {
      debugLog("Loading TensorFlow.js models...");
      
      // Dynamically import TensorFlow.js and models
      const tf = await import("@tensorflow/tfjs");
      await tf.ready();
      
      // Set backend (prefer WebGL for performance)
      await tf.setBackend("webgl");
      debugLog("TensorFlow backend:", tf.getBackend());
      
      // Load BlazeFace for face detection
      const blazeface = await import("@tensorflow-models/blazeface");
      faceDetectorRef.current = await blazeface.load();
      debugLog("BlazeFace model loaded");
      
      // Load FaceMesh for landmark detection (includes iris)
      const faceLandmarksDetection = await import("@tensorflow-models/face-landmarks-detection");
      faceMeshRef.current = await faceLandmarksDetection.createDetector(
        faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
        {
          runtime: "tfjs",
          refineLandmarks: true, // Enable iris detection
          maxFaces: 3,
        }
      );
      debugLog("FaceMesh model loaded");
      
      setIsModelLoaded(true);
      return true;
    } catch (error) {
      console.error("[CameraProctor] Failed to load models:", error);
      setErrors(prev => [...prev, `Model loading failed: ${(error as Error).message}`]);
      return false;
    }
  }, [debugLog]);
  
  // ============================================================================
  // Detection Logic
  // ============================================================================
  
  const runDetection = useCallback(async () => {
    if (!videoRef.current || !faceDetectorRef.current || !faceMeshRef.current) {
      return;
    }
    
    if (videoRef.current.readyState !== 4) {
      return; // Video not ready
    }
    
    const startTime = performance.now();
    
    try {
      // ========== Face Detection (BlazeFace) ==========
      const predictions = await faceDetectorRef.current.estimateFaces(videoRef.current, false);
      const validFaces = predictions.filter((p: any) => p.probability[0] > multiFaceConfidenceThreshold);
      
      setFacesCount(validFaces.length);
      
      // Check for multiple faces
      if (validFaces.length > 1) {
        const faceBoxes: FaceBox[] = validFaces.map((p: any) => ({
          x: p.topLeft[0],
          y: p.topLeft[1],
          width: p.bottomRight[0] - p.topLeft[0],
          height: p.bottomRight[1] - p.topLeft[1],
          confidence: p.probability[0],
        }));
        
        await recordViolation("MULTI_FACE", {
          facesCount: validFaces.length,
          boxes: faceBoxes,
        });
      }
      
      // ========== Face Mesh (Landmarks + Gaze + Blink) ==========
      if (validFaces.length >= 1) {
        const meshPredictions = await faceMeshRef.current.estimateFaces(videoRef.current);
        
        if (meshPredictions.length > 0) {
          const face = meshPredictions[0];
          const keypoints = face.keypoints;
          
          // Extract key landmarks for gaze detection
          // MediaPipe FaceMesh landmark indices:
          // Left eye: 33, 133, 160, 144, 145, 153
          // Right eye: 362, 263, 387, 373, 374, 380
          // Left iris center: 468
          // Right iris center: 473
          
          const leftEyeLandmarks = [33, 133, 160, 144, 145, 153].map(i => 
            keypoints[i] ? [keypoints[i].x, keypoints[i].y] : [0, 0]
          );
          const rightEyeLandmarks = [362, 263, 387, 373, 374, 380].map(i => 
            keypoints[i] ? [keypoints[i].x, keypoints[i].y] : [0, 0]
          );
          
          const leftIris = keypoints[468] ? [keypoints[468].x, keypoints[468].y] : null;
          const rightIris = keypoints[473] ? [keypoints[473].x, keypoints[473].y] : null;
          
          const leftEyeCorners = [33, 133, 159, 145].map(i => 
            keypoints[i] ? [keypoints[i].x, keypoints[i].y] : [0, 0]
          );
          const rightEyeCorners = [362, 263, 386, 374].map(i => 
            keypoints[i] ? [keypoints[i].x, keypoints[i].y] : [0, 0]
          );
          
          // ========== Gaze Direction ==========
          const gaze = calculateGazeDirection(leftIris, rightIris, leftEyeCorners, rightEyeCorners);
          setGazeDirection(gaze);
          
          if (gaze.direction !== "center") {
            gazeAwayCountRef.current += 1;
            
            if (gazeAwayCountRef.current >= gazeAwayThreshold) {
              const durationSeconds = (gazeAwayCountRef.current * detectionIntervalMs) / 1000;
              await recordViolation("GAZE_AWAY", {
                direction: gaze.direction,
                durationSeconds,
                confidence: gaze.confidence,
              });
              gazeAwayCountRef.current = 0; // Reset after recording
            }
          } else {
            gazeAwayCountRef.current = 0;
          }
          
          // ========== Blink Detection ==========
          const leftEAR = calculateEAR(leftEyeLandmarks);
          const rightEAR = calculateEAR(rightEyeLandmarks);
          const avgEAR = (leftEAR + rightEAR) / 2;
          
          const wasBlinking = isBlinking;
          const nowBlinking = avgEAR < EYE_AR_THRESHOLD;
          setIsBlinking(nowBlinking);
          
          // Detect blink transition (open -> closed -> open)
          if (wasBlinking && !nowBlinking) {
            blinkCountRef.current += 1;
            lastBlinkTimeRef.current = Date.now();
            debugLog("Blink detected! Total:", blinkCountRef.current);
          }
          
          // ========== Spoof Detection ==========
          // Check 1: No blinks in N seconds
          const timeSinceLastBlink = (Date.now() - lastBlinkTimeRef.current) / 1000;
          if (timeSinceLastBlink > blinkTimeoutSeconds && blinkCountRef.current > 0) {
            // Only trigger if we had blinks before (to avoid false positive at start)
            await recordViolation("SPOOF_DETECTED", {
              reason: "noBlink",
              lastBlinkSecondsAgo: timeSinceLastBlink,
              totalBlinks: blinkCountRef.current,
            });
          }
          
          // Check 2: Near-zero head micro movement
          const currentLandmarks = keypoints.slice(0, 68).map((kp: any) => [kp.x, kp.y]);
          
          if (previousLandmarksRef.current) {
            let totalMovement = 0;
            for (let i = 0; i < Math.min(currentLandmarks.length, previousLandmarksRef.current.length); i++) {
              const dx = currentLandmarks[i][0] - previousLandmarksRef.current[i][0];
              const dy = currentLandmarks[i][1] - previousLandmarksRef.current[i][1];
              totalMovement += Math.sqrt(dx * dx + dy * dy);
            }
            const avgMovement = totalMovement / currentLandmarks.length;
            
            headMovementHistoryRef.current.push(avgMovement);
            if (headMovementHistoryRef.current.length > 10) {
              headMovementHistoryRef.current.shift();
            }
            
            // If movement is consistently low over multiple frames
            const recentAvgMovement = headMovementHistoryRef.current.reduce((a, b) => a + b, 0) / 
              headMovementHistoryRef.current.length;
            
            if (headMovementHistoryRef.current.length >= 10 && recentAvgMovement < HEAD_MOVEMENT_THRESHOLD) {
              await recordViolation("SPOOF_DETECTED", {
                reason: "staticHead",
                avgMovement: recentAvgMovement,
              });
              headMovementHistoryRef.current = []; // Reset to avoid repeated triggers
            }
          }
          
          previousLandmarksRef.current = currentLandmarks;
          
          // ========== Debug Info Update ==========
          if (debugMode) {
            fpsCounterRef.current.frames += 1;
            const now = Date.now();
            const elapsed = now - fpsCounterRef.current.lastTime;
            
            let fps = debugInfo?.fps || 0;
            if (elapsed >= 1000) {
              fps = Math.round((fpsCounterRef.current.frames * 1000) / elapsed);
              fpsCounterRef.current.frames = 0;
              fpsCounterRef.current.lastTime = now;
            }
            
            setDebugInfo({
              fps,
              lastDetectionTime: performance.now() - startTime,
              faceBoxes: validFaces.map((p: any) => ({
                x: p.topLeft[0],
                y: p.topLeft[1],
                width: p.bottomRight[0] - p.topLeft[0],
                height: p.bottomRight[1] - p.topLeft[1],
                confidence: p.probability[0],
              })),
              gazeVector: leftIris && rightIris ? {
                x: (leftIris[0] + rightIris[0]) / 2,
                y: (leftIris[1] + rightIris[1]) / 2,
              } : null,
              blinkCount: blinkCountRef.current,
              headMovement: headMovementHistoryRef.current.length > 0 
                ? headMovementHistoryRef.current[headMovementHistoryRef.current.length - 1]
                : 0,
            });
          }
        } else {
          // No face mesh detected - face might be turned away
          gazeAwayCountRef.current += 1;
          if (gazeAwayCountRef.current >= gazeAwayThreshold) {
            await recordViolation("GAZE_AWAY", {
              direction: "away",
              durationSeconds: (gazeAwayCountRef.current * detectionIntervalMs) / 1000,
              reason: "noFaceMesh",
            });
            gazeAwayCountRef.current = 0;
          }
        }
      } else if (validFaces.length === 0) {
        // No face detected
        gazeAwayCountRef.current += 1;
        setGazeDirection({ direction: "away", confidence: 1 });
        
        if (gazeAwayCountRef.current >= gazeAwayThreshold) {
          await recordViolation("GAZE_AWAY", {
            direction: "away",
            durationSeconds: (gazeAwayCountRef.current * detectionIntervalMs) / 1000,
            reason: "noFaceDetected",
          });
          gazeAwayCountRef.current = 0;
        }
      }
      
    } catch (error) {
      console.error("[CameraProctor] Detection error:", error);
      debugLog("Detection error:", error);
    }
  }, [
    multiFaceConfidenceThreshold,
    gazeAwayThreshold,
    blinkTimeoutSeconds,
    detectionIntervalMs,
    recordViolation,
    debugMode,
    debugInfo,
    isBlinking,
    debugLog,
  ]);
  
  // ============================================================================
  // Camera Control
  // ============================================================================
  
  const requestCameraPermission = useCallback(async (): Promise<boolean> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: VIDEO_WIDTH },
          height: { ideal: VIDEO_HEIGHT },
          facingMode: "user",
        },
      });
      
      // Permission granted, stop the stream (we'll start it properly later)
      stream.getTracks().forEach(track => track.stop());
      debugLog("Camera permission granted");
      return true;
    } catch (error) {
      console.error("[CameraProctor] Camera permission denied:", error);
      
      await recordViolation("CAMERA_DENIED", {
        error: (error as Error).message,
      }, false);
      
      setErrors(prev => [...prev, "Camera access denied"]);
      return false;
    }
  }, [recordViolation, debugLog]);
  
  const startCamera = useCallback(async (): Promise<boolean> => {
    if (!enabled) {
      debugLog("Camera proctoring is disabled");
      return false;
    }
    
    try {
      debugLog("Starting camera...");
      
      // Load models first
      const modelsLoaded = await loadModels();
      if (!modelsLoaded) {
        setErrors(prev => [...prev, "Failed to load detection models"]);
        return false;
      }
      
      // Get camera stream
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: VIDEO_WIDTH },
          height: { ideal: VIDEO_HEIGHT },
          facingMode: "user",
        },
      });
      
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      setIsCameraOn(true);
      lastBlinkTimeRef.current = Date.now(); // Initialize blink timer
      
      // Start detection loop
      detectionIntervalRef.current = setInterval(runDetection, detectionIntervalMs);
      
      debugLog("Camera started successfully");
      return true;
    } catch (error) {
      console.error("[CameraProctor] Failed to start camera:", error);
      
      await recordViolation("CAMERA_ERROR", {
        error: (error as Error).message,
        stage: "startCamera",
      }, false);
      
      setErrors(prev => [...prev, `Camera error: ${(error as Error).message}`]);
      return false;
    }
  }, [enabled, loadModels, runDetection, detectionIntervalMs, recordViolation, debugLog]);
  
  const stopCamera = useCallback(() => {
    debugLog("Stopping camera...");
    
    // Stop detection loop
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    
    // Stop media stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    
    // Clear video source
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsCameraOn(false);
    setFacesCount(0);
    setGazeDirection(null);
    
    debugLog("Camera stopped");
  }, [debugLog]);
  
  // ============================================================================
  // Cleanup on unmount
  // ============================================================================
  
  useEffect(() => {
    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);
  
  // ============================================================================
  // Return
  // ============================================================================
  
  return {
    // State
    isCameraOn,
    isModelLoaded,
    facesCount,
    lastViolation,
    errors,
    gazeDirection,
    isBlinking,
    
    // Actions
    startCamera,
    stopCamera,
    requestCameraPermission,
    
    // Debug
    videoRef,
    canvasRef,
    debugInfo,
  };
}

export default useCameraProctor;

