from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..db.mongo import get_db
from ..utils.mongo import to_object_id
from ..utils.responses import success_response

router = APIRouter(prefix="/api/assessment", tags=["candidate"])


@router.post("/verify-candidate")
async def verify_candidate(
    payload: Dict[str, Any],
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Verify candidate email and name against assessment candidates list."""
    assessment_id = payload.get("assessmentId")
    token = payload.get("token")
    email = payload.get("email", "").strip().lower()
    name = payload.get("name", "").strip()

    if not assessment_id or not token or not email or not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing required fields")

    try:
        oid = to_object_id(assessment_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assessment ID")

    assessment = await db.assessments.find_one({"_id": oid})
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")

    # Verify token
    if assessment.get("assessmentToken") != token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid assessment token")

    # Verify candidate
    candidates = assessment.get("candidates", [])
    candidate_found = any(
        c.get("email", "").strip().lower() == email and c.get("name", "").strip() == name
        for c in candidates
    )

    if not candidate_found:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Email and name combination not found in candidate list")

    return success_response("Candidate verified successfully", {"verified": True})


@router.get("/get-schedule")
async def get_assessment_schedule(
    assessmentId: str = Query(...),
    token: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get assessment schedule for candidates."""
    try:
        oid = to_object_id(assessmentId)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assessment ID")

    assessment = await db.assessments.find_one({"_id": oid})
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")

    # Verify token
    if assessment.get("assessmentToken") != token:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid assessment token")

    schedule = assessment.get("schedule", {})
    return success_response(
        "Schedule fetched successfully",
        {
            "startTime": schedule.get("startTime"),
            "endTime": schedule.get("endTime"),
            "timezone": schedule.get("timezone", "Asia/Kolkata"),
        }
    )

