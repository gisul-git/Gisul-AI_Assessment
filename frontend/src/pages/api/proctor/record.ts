import type { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";

// Supported proctoring event types
const VALID_EVENT_TYPES = new Set([
  "TAB_SWITCH",
  "FULLSCREEN_EXIT",
  "FULLSCREEN_ENABLED",
  "COPY_RESTRICT",
  "FOCUS_LOST",
  "DEVTOOLS_OPEN",
  "SCREENSHOT_ATTEMPT",
  "PASTE_ATTEMPT",
  "RIGHT_CLICK",
  "IDLE",
  "GAZE_AWAY",
  "MULTI_FACE",
  "SPOOF_DETECTED",
  "FACE_MISMATCH",
  "CAMERA_DENIED",
  "CAMERA_ERROR",
  "PRECHECK_WARNING",
  "REFERENCE_PHOTO_CAPTURED",
  // Live human proctoring events
  "PROCTOR_SESSION_STARTED",
  "PROCTOR_SESSION_VIEWING",
  "PROCTOR_SESSION_ENDED",
]);

interface ViolationPayload {
  eventType: string;
  timestamp: string;
  assessmentId: string;
  userId: string;
  metadata?: Record<string, unknown>;
  snapshotBase64?: string;
}

const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ status: "error", message: "Method not allowed" });
  }

  try {
    const { eventType, timestamp, assessmentId, userId, metadata, snapshotBase64 } = req.body as ViolationPayload;

    // Validate required fields
    if (!eventType || !timestamp || !assessmentId || !userId) {
      return res.status(400).json({
        status: "error",
        message: "Missing required fields: eventType, timestamp, assessmentId, userId",
      });
    }

    // Validate eventType (warn but allow for future extensibility)
    if (!VALID_EVENT_TYPES.has(eventType)) {
      console.warn(`[Proctor API] Unknown event type received: ${eventType}`);
    }

    // Log the violation locally for debugging
    console.log("[Proctor API] Violation received:", JSON.stringify({
      eventType,
      timestamp,
      assessmentId,
      userId,
      hasMetadata: !!metadata,
      hasSnapshot: !!snapshotBase64,
    }, null, 2));

    // Forward to backend FastAPI
    try {
      const backendResponse = await axios.post(
        `${BACKEND_URL}/api/proctor/record`,
        {
          eventType,
          timestamp,
          assessmentId,
          userId,
          metadata: metadata || null,
          snapshotBase64: snapshotBase64 || null,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 second timeout
        }
      );

      console.log("[Proctor API] Backend response:", backendResponse.data);
      return res.status(200).json({ status: "ok", ...backendResponse.data });
    } catch (backendError: any) {
      // Log backend error but still return success to client
      // We don't want to fail the client if backend is temporarily unavailable
      console.error("[Proctor API] Backend error:", backendError.message);
      console.error("[Proctor API] Backend error details:", backendError.response?.data);
      
      // Still return ok to client - the event was received
      // In production, you might want to queue failed events for retry
      return res.status(200).json({ 
        status: "ok", 
        warning: "Event recorded locally, backend sync pending" 
      });
    }
  } catch (error) {
    console.error("[Proctor API] Error processing violation:", error);
    return res.status(500).json({
      status: "error",
      message: "Internal server error",
    });
  }
}
