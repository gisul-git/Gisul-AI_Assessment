from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional, Any

from pydantic import BaseModel, Field


# Supported proctoring event types
PROCTOR_EVENT_TYPES = {
    "TAB_SWITCH",
    "FULLSCREEN_EXIT",
    "FULLSCREEN_ENABLED",
    "FULLSCREEN_REFUSED",
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
    # Live human proctoring events
    "PROCTOR_SESSION_STARTED",
    "PROCTOR_SESSION_VIEWING",
    "PROCTOR_SESSION_ENDED",
}

# Human-readable labels for event types
EVENT_TYPE_LABELS: Dict[str, str] = {
    "TAB_SWITCH": "Tab switch detected",
    "FULLSCREEN_EXIT": "Fullscreen was exited",
    "FULLSCREEN_ENABLED": "Fullscreen was enabled",
    "FULLSCREEN_REFUSED": "Fullscreen was declined",
    "COPY_RESTRICT": "Copy restriction violated",
    "FOCUS_LOST": "Window focus was lost",
    "DEVTOOLS_OPEN": "Developer tools opened",
    "SCREENSHOT_ATTEMPT": "Screenshot attempt detected",
    "PASTE_ATTEMPT": "Paste attempt blocked",
    "RIGHT_CLICK": "Right click blocked",
    "IDLE": "Idle timeout detected",
    "GAZE_AWAY": "Gaze away detected",
    "MULTI_FACE": "Multiple faces detected",
    "SPOOF_DETECTED": "Spoof attempt detected",
    "FACE_MISMATCH": "Face doesn't match verified identity",
    "CAMERA_DENIED": "Camera access was denied",
    "CAMERA_ERROR": "Camera error occurred",
    "PRECHECK_WARNING": "Pre-check warning",
    "REFERENCE_PHOTO_CAPTURED": "Reference photo captured",
    # Live human proctoring events
    "PROCTOR_SESSION_STARTED": "Human proctor session started",
    "PROCTOR_SESSION_VIEWING": "Proctor is viewing candidate",
    "PROCTOR_SESSION_ENDED": "Human proctor session ended",
}


class ProctorEventIn(BaseModel):
    """Input model for recording a proctoring event."""
    userId: str = Field(..., min_length=1, max_length=255, description="Candidate user ID (email)")
    assessmentId: str = Field(..., min_length=1, max_length=100, description="Assessment ID")
    eventType: str = Field(..., min_length=1, max_length=50, description="Type of proctoring event")
    timestamp: str = Field(..., description="ISO8601 timestamp when event occurred")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="Additional event metadata")
    snapshotBase64: Optional[str] = Field(default=None, description="Base64 encoded screenshot/snapshot")


class ProctorEventOut(BaseModel):
    """Output model for a proctoring event document."""
    id: str = Field(..., alias="_id", description="Document ID")
    userId: str
    assessmentId: str
    eventType: str
    timestamp: str
    metadata: Optional[Dict[str, Any]] = None
    snapshotBase64: Optional[str] = None
    receivedAt: str = Field(..., description="ISO8601 timestamp when event was received by server")

    class Config:
        populate_by_name = True


class ProctorSummaryOut(BaseModel):
    """Output model for proctoring summary."""
    summary: Dict[str, int] = Field(..., description="Count of each event type")
    totalViolations: int = Field(..., description="Total number of violations")
    violations: List[Dict[str, Any]] = Field(..., description="List of all violation documents")
    eventTypeLabels: Dict[str, str] = Field(
        default_factory=lambda: EVENT_TYPE_LABELS,
        description="Human-readable labels for event types"
    )

