from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from motor.motor_asyncio import AsyncIOMotorDatabase
from pydantic import BaseModel

from ..db.mongo import get_db
from ..schemas.proctor import ProctorEventIn, ProctorSummaryOut, EVENT_TYPE_LABELS
from ..utils.responses import success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/proctor", tags=["proctor"])


# ============================================================================
# WebRTC Signalling Models
# ============================================================================

class CreateSessionRequest(BaseModel):
    assessmentId: str
    candidateId: str  # userId/email of candidate
    adminId: str  # userId of admin creating session


class SessionResponse(BaseModel):
    sessionId: str
    status: str


class SDPRequest(BaseModel):
    sessionId: str
    sdp: str
    sdpType: str  # "offer" or "answer"
    sender: str  # "candidate" or "admin"


class ICECandidateRequest(BaseModel):
    sessionId: str
    candidate: str
    sdpMid: Optional[str] = None
    sdpMLineIndex: Optional[int] = None
    sender: str  # "candidate" or "admin"


# ============================================================================
# WebRTC Live Proctoring Endpoints
# ============================================================================

@router.post("/live/create-session")
async def create_live_session(
    request: CreateSessionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Create a new live proctoring session for WebRTC signalling.
    Called by admin when they want to start watching a candidate.
    Automatically ends any existing pending/active sessions for this candidate.
    """
    try:
        # End any existing pending/active sessions for this candidate first
        await db.proctor_sessions.update_many(
            {
                "assessmentId": request.assessmentId,
                "candidateId": request.candidateId,
                "status": {"$in": ["pending", "active", "offer_sent"]},
            },
            {
                "$set": {
                    "status": "ended",
                    "endedAt": datetime.now(timezone.utc).isoformat(),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        session_id = str(uuid.uuid4())
        
        session = {
            "sessionId": session_id,
            "assessmentId": request.assessmentId,
            "candidateId": request.candidateId,
            "adminId": request.adminId,
            "status": "pending",  # pending -> active -> ended
            "offer": None,
            "answer": None,
            "candidateICE": [],
            "adminICE": [],
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": datetime.now(timezone.utc).isoformat(),
        }
        
        await db.proctor_sessions.insert_one(session)
        
        logger.info(f"[LiveProctor] Session created: {session_id} for candidate {request.candidateId}")
        
        return success_response("Session created", {"sessionId": session_id, "status": "pending"})
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error creating session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/live/session/{session_id}")
async def get_live_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get current session state including SDP and ICE candidates."""
    try:
        session = await db.proctor_sessions.find_one({"sessionId": session_id})
        
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
        
        session["_id"] = str(session["_id"])
        
        return success_response("Session fetched", session)
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error fetching session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/offer")
async def post_offer(
    request: SDPRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Post WebRTC offer SDP.
    Candidate sends offer when starting to stream.
    """
    try:
        result = await db.proctor_sessions.update_one(
            {"sessionId": request.sessionId},
            {
                "$set": {
                    "offer": {"sdp": request.sdp, "type": request.sdpType, "sender": request.sender},
                    "status": "offer_sent",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"[LiveProctor] Offer received for session {request.sessionId}")
        
        return success_response("Offer saved", {"sessionId": request.sessionId})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error saving offer: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/answer")
async def post_answer(
    request: SDPRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Post WebRTC answer SDP.
    Admin sends answer after receiving candidate's offer.
    """
    try:
        result = await db.proctor_sessions.update_one(
            {"sessionId": request.sessionId},
            {
                "$set": {
                    "answer": {"sdp": request.sdp, "type": request.sdpType, "sender": request.sender},
                    "status": "active",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"[LiveProctor] Answer received for session {request.sessionId}")
        
        return success_response("Answer saved", {"sessionId": request.sessionId})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error saving answer: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/ice")
async def post_ice_candidate(
    request: ICECandidateRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Post ICE candidate for WebRTC connection.
    Both candidate and admin send ICE candidates.
    """
    try:
        ice_field = "candidateICE" if request.sender == "candidate" else "adminICE"
        
        ice_candidate = {
            "candidate": request.candidate,
            "sdpMid": request.sdpMid,
            "sdpMLineIndex": request.sdpMLineIndex,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        
        result = await db.proctor_sessions.update_one(
            {"sessionId": request.sessionId},
            {
                "$push": {ice_field: ice_candidate},
                "$set": {"updatedAt": datetime.now(timezone.utc).isoformat()},
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        return success_response("ICE candidate saved", {"sessionId": request.sessionId})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error saving ICE candidate: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/end-session/{session_id}")
async def end_live_session(
    session_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """End a live proctoring session."""
    try:
        result = await db.proctor_sessions.update_one(
            {"sessionId": session_id},
            {
                "$set": {
                    "status": "ended",
                    "endedAt": datetime.now(timezone.utc).isoformat(),
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                }
            }
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Session not found")
        
        logger.info(f"[LiveProctor] Session ended: {session_id}")
        
        return success_response("Session ended", {"sessionId": session_id, "status": "ended"})
    
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error ending session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/live/pending/{assessment_id}/{candidate_id}")
async def get_pending_session(
    assessment_id: str,
    candidate_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Check if there's a pending live proctoring session for a candidate.
    Candidate polls this to know when admin wants to watch them.
    """
    try:
        session = await db.proctor_sessions.find_one({
            "assessmentId": assessment_id,
            "candidateId": candidate_id,
            "status": {"$in": ["pending", "offer_sent", "active"]},
        })
        
        if not session:
            return success_response("No active session", {"hasSession": False})
        
        session["_id"] = str(session["_id"])
        
        return success_response("Session found", {"hasSession": True, "session": session})
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error checking pending session: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


# ============================================================================
# Multi-Candidate Live Proctoring Endpoints
# ============================================================================

class CreateMultiSessionRequest(BaseModel):
    assessmentId: str
    adminId: str


@router.get("/live/active-candidates/{assessment_id}")
async def get_active_candidates(
    assessment_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get all candidates who are currently taking the assessment.
    These are candidates who have started but not yet submitted.
    """
    try:
        # Find candidates who have started but not submitted
        # Look in assessment_sessions collection for active sessions
        active_sessions = await db.assessment_sessions.find({
            "assessmentId": assessment_id,
            "startedAt": {"$exists": True},
            "submittedAt": {"$exists": False},
        }).to_list(length=100)
        
        candidates = []
        for session in active_sessions:
            # Check if there's an active proctoring session
            proctor_session = await db.proctor_sessions.find_one({
                "assessmentId": assessment_id,
                "candidateId": session.get("email", session.get("candidateId")),
                "status": {"$in": ["pending", "offer_sent", "active"]},
            })
            
            candidates.append({
                "email": session.get("email", session.get("candidateId")),
                "name": session.get("name", "Unknown"),
                "startedAt": session.get("startedAt"),
                "hasActiveSession": proctor_session is not None,
                "sessionId": proctor_session.get("sessionId") if proctor_session else None,
                "sessionStatus": proctor_session.get("status") if proctor_session else None,
            })
        
        return success_response("Active candidates retrieved", {
            "count": len(candidates),
            "candidates": candidates
        })
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error getting active candidates: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/live/create-multi-session")
async def create_multi_live_sessions(
    request: CreateMultiSessionRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Create live proctoring sessions for ALL active candidates in an assessment.
    Used for the multi-candidate proctoring dashboard.
    """
    try:
        # Find all active candidates (started but not submitted)
        active_sessions = await db.assessment_sessions.find({
            "assessmentId": request.assessmentId,
            "startedAt": {"$exists": True},
            "submittedAt": {"$exists": False},
        }).to_list(length=100)
        
        created_sessions = []
        
        for session in active_sessions:
            candidate_id = session.get("email", session.get("candidateId"))
            
            # End any existing sessions for this candidate
            await db.proctor_sessions.update_many(
                {
                    "assessmentId": request.assessmentId,
                    "candidateId": candidate_id,
                    "status": {"$in": ["pending", "active", "offer_sent"]},
                },
                {
                    "$set": {
                        "status": "ended",
                        "endedAt": datetime.now(timezone.utc).isoformat(),
                        "updatedAt": datetime.now(timezone.utc).isoformat(),
                    }
                }
            )
            
            # Create new session
            session_id = str(uuid.uuid4())
            
            new_session = {
                "sessionId": session_id,
                "assessmentId": request.assessmentId,
                "candidateId": candidate_id,
                "candidateName": session.get("name", "Unknown"),
                "adminId": request.adminId,
                "status": "pending",
                "offer": None,
                "answer": None,
                "candidateICE": [],
                "adminICE": [],
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "updatedAt": datetime.now(timezone.utc).isoformat(),
            }
            
            await db.proctor_sessions.insert_one(new_session)
            
            created_sessions.append({
                "sessionId": session_id,
                "candidateId": candidate_id,
                "candidateName": session.get("name", "Unknown"),
                "status": "pending",
            })
            
            logger.info(f"[LiveProctor] Multi-session created: {session_id} for {candidate_id}")
        
        return success_response("Sessions created for all active candidates", {
            "count": len(created_sessions),
            "sessions": created_sessions
        })
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error creating multi-sessions: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/live/all-sessions/{assessment_id}")
async def get_all_sessions(
    assessment_id: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get all active proctoring sessions for an assessment.
    Used by the multi-proctor dashboard to display all candidate streams.
    """
    try:
        sessions = await db.proctor_sessions.find({
            "assessmentId": assessment_id,
            "status": {"$in": ["pending", "offer_sent", "active"]},
        }).to_list(length=100)
        
        # Convert ObjectId to string
        for session in sessions:
            session["_id"] = str(session["_id"])
        
        return success_response("Sessions retrieved", {
            "count": len(sessions),
            "sessions": sessions
        })
    
    except Exception as exc:
        logger.exception(f"[LiveProctor] Error getting all sessions: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/record")
async def record_proctor_event(
    payload: ProctorEventIn,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Record a proctoring event from the browser.
    
    This endpoint receives proctoring violation events (tab switches, fullscreen exits, etc.)
    and stores them in MongoDB for later review by admins.
    """
    try:
        # Create the document to store
        proctor_event = {
            "userId": payload.userId.strip(),
            "assessmentId": payload.assessmentId.strip(),
            "eventType": payload.eventType.strip(),
            "timestamp": payload.timestamp,
            "metadata": payload.metadata,
            "snapshotBase64": payload.snapshotBase64,
            "receivedAt": datetime.now(timezone.utc).isoformat(),
        }

        # Insert into proctor_events collection
        result = await db.proctor_events.insert_one(proctor_event)
        
        # Log the event
        logger.info(
            f"[Proctor API] Event recorded: {payload.eventType} for user {payload.userId} "
            f"in assessment {payload.assessmentId} (id: {result.inserted_id})"
        )
        
        # Log if snapshot was included
        if payload.snapshotBase64:
            logger.info(f"[Proctor API] Snapshot saved for event (id: {result.inserted_id})")

        return {"status": "ok", "id": str(result.inserted_id)}
    
    except Exception as exc:
        logger.exception(f"[Proctor] Error recording event: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record proctoring event: {str(exc)}"
        ) from exc


@router.get("/summary/{assessmentId}/{userId}")
async def get_proctor_summary(
    assessmentId: str,
    userId: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get proctoring violation summary for a specific candidate in an assessment.
    
    Returns:
    - summary: Count of each event type
    - totalViolations: Total number of violations
    - violations: List of all violation documents
    """
    try:
        # Query all events for this user and assessment
        query = {
            "assessmentId": assessmentId.strip(),
            "userId": userId.strip(),
        }
        
        cursor = db.proctor_events.find(query).sort("timestamp", 1)
        violations = []
        
        async for doc in cursor:
            # Convert ObjectId to string for JSON serialization
            doc["_id"] = str(doc["_id"])
            violations.append(doc)
        
        # Aggregate counts by event type
        summary: Dict[str, int] = {}
        for violation in violations:
            event_type = violation.get("eventType", "UNKNOWN")
            summary[event_type] = summary.get(event_type, 0) + 1
        
        total_violations = len(violations)
        
        logger.info(
            f"[Proctor] Summary fetched for user {userId} in assessment {assessmentId}: "
            f"{total_violations} total violations"
        )

        return success_response(
            "Proctoring summary fetched successfully",
            {
                "summary": summary,
                "totalViolations": total_violations,
                "violations": violations,
                "eventTypeLabels": EVENT_TYPE_LABELS,
            }
        )
    
    except Exception as exc:
        logger.exception(f"[Proctor] Error fetching summary: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch proctoring summary: {str(exc)}"
        ) from exc


@router.get("/logs/{assessmentId}/{userId}")
async def get_proctor_logs(
    assessmentId: str,
    userId: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get full proctoring logs for a specific candidate in an assessment.
    Returns all violation documents with metadata and snapshotBase64 for evidence gallery.
    
    Returns:
    - logs: List of all violation documents sorted by timestamp (newest first)
    - totalCount: Total number of logs
    """
    try:
        # Query all events for this user and assessment, sorted newest first
        query = {
            "assessmentId": assessmentId.strip(),
            "userId": userId.strip(),
        }
        
        cursor = db.proctor_events.find(query).sort("timestamp", -1)
        logs = []
        
        async for doc in cursor:
            # Convert ObjectId to string for JSON serialization
            doc["_id"] = str(doc["_id"])
            logs.append(doc)
        
        logger.info(
            f"[Proctor API] Logs fetched for user {userId} in assessment {assessmentId}: "
            f"{len(logs)} total logs"
        )

        return success_response(
            "Proctoring logs fetched successfully",
            {
                "logs": logs,
                "totalCount": len(logs),
                "eventTypeLabels": EVENT_TYPE_LABELS,
            }
        )
    
    except Exception as exc:
        logger.exception(f"[Proctor API] Error fetching logs: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch proctoring logs: {str(exc)}"
        ) from exc


@router.get("/assessment/{assessmentId}/all")
async def get_all_proctor_events_for_assessment(
    assessmentId: str,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """
    Get all proctoring events for an assessment, grouped by user.
    
    Returns a dictionary where keys are userIds and values contain
    their violation summary and details.
    """
    try:
        # Query all events for this assessment
        query = {"assessmentId": assessmentId.strip()}
        
        cursor = db.proctor_events.find(query).sort("timestamp", 1)
        
        # Group by user
        users_data: Dict[str, Dict[str, Any]] = {}
        
        async for doc in cursor:
            user_id = doc.get("userId", "unknown")
            doc["_id"] = str(doc["_id"])
            
            if user_id not in users_data:
                users_data[user_id] = {
                    "violations": [],
                    "summary": {},
                    "totalViolations": 0,
                }
            
            users_data[user_id]["violations"].append(doc)
            event_type = doc.get("eventType", "UNKNOWN")
            users_data[user_id]["summary"][event_type] = users_data[user_id]["summary"].get(event_type, 0) + 1
            users_data[user_id]["totalViolations"] += 1
        
        logger.info(
            f"[Proctor API] All events fetched for assessment {assessmentId}: "
            f"{len(users_data)} users with violations"
        )

        return success_response(
            "All proctoring events fetched successfully",
            {
                "users": users_data,
                "eventTypeLabels": EVENT_TYPE_LABELS,
            }
        )
    
    except Exception as exc:
        logger.exception(f"[Proctor API] Error fetching all events: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch proctoring events: {str(exc)}"
        ) from exc

