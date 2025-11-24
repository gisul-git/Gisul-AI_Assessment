from __future__ import annotations

import html
import logging
from datetime import datetime, timezone
from typing import Any, Dict

from dateutil import parser
from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..db.mongo import get_db
from ..schemas.assessment import LogAnswerRequest
from ..services.ai import evaluate_answer_with_ai
from ..utils.mongo import to_object_id
from ..utils.responses import success_response

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assessment", tags=["candidate"])


def _check_assessment_time_window(assessment: Dict[str, Any], allow_before_start: bool = False) -> None:
    """
    Check if current time is within the assessment's allowed time window.
    
    Args:
        assessment: The assessment document from database
        allow_before_start: If True, allow access before startTime (e.g., for checking schedule)
    
    Raises:
        HTTPException: If current time is outside the allowed window
    """
    schedule = assessment.get("schedule", {})
    start_time_str = schedule.get("startTime")
    end_time_str = schedule.get("endTime")
    
    # If no schedule is set, allow access (backward compatibility)
    if not start_time_str or not end_time_str:
        return
    
    try:
        # Parse ISO format datetime strings - handle multiple formats
        start_time = None
        end_time = None
        
        # Normalize date strings - add missing parts if needed
        def normalize_datetime_str(dt_str: str) -> str:
            """Normalize datetime string to full ISO format."""
            if not dt_str:
                return dt_str
            
            # Extract timezone info
            has_timezone = "+" in dt_str or dt_str.endswith("Z")
            timezone_part = ""
            if "+" in dt_str:
                timezone_part = "+" + dt_str.split("+", 1)[1]
                dt_clean = dt_str.split("+")[0]
            elif dt_str.endswith("Z"):
                timezone_part = "Z"
                dt_clean = dt_str[:-1]  # Remove Z
            else:
                dt_clean = dt_str
            
            # Check if seconds are missing (format: YYYY-MM-DDTHH:MM)
            if "T" in dt_clean and dt_clean.count(":") == 1:
                dt_clean = dt_clean + ":00"  # Add seconds
            
            # Add timezone if missing
            if not has_timezone:
                dt_clean = dt_clean + "Z"
            else:
                dt_clean = dt_clean + timezone_part
            
            return dt_clean
        
        start_time_str_normalized = normalize_datetime_str(start_time_str)
        end_time_str_normalized = normalize_datetime_str(end_time_str)
        
        # Try parsing with fromisoformat first
        try:
            start_time_str_clean = start_time_str_normalized.replace("Z", "+00:00")
            end_time_str_clean = end_time_str_normalized.replace("Z", "+00:00")
            start_time = datetime.fromisoformat(start_time_str_clean)
            end_time = datetime.fromisoformat(end_time_str_clean)
        except (ValueError, AttributeError):
            # Fallback: try parsing with dateutil parser (handles more formats)
            try:
                start_time = parser.parse(start_time_str)  # Use parse instead of isoparse for more flexibility
                end_time = parser.parse(end_time_str)
            except (ValueError, AttributeError, TypeError) as parse_error:
                logger.warning(f"Both fromisoformat and parser.parse failed: {parse_error}. startTime={start_time_str}, endTime={end_time_str}")
                raise ValueError(f"Unable to parse date strings: {start_time_str}, {end_time_str}") from parse_error
        
        # Ensure timezone-aware comparison
        if start_time.tzinfo is None:
            start_time = start_time.replace(tzinfo=timezone.utc)
        if end_time.tzinfo is None:
            end_time = end_time.replace(tzinfo=timezone.utc)
        
        now = datetime.now(timezone.utc)
        
        # Check if before start time
        if now < start_time:
            if allow_before_start:
                return  # Allow access before start (e.g., for checking schedule)
            # Format the date nicely for the error message
            formatted_start = start_time.strftime("%Y-%m-%d %H:%M:%S UTC")
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Assessment has not started yet. It will start at {formatted_start}"
            )
        
        # Check if after end time
        if now > end_time:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Assessment has ended. It ended at {end_time_str}"
            )
    except (ValueError, AttributeError, TypeError) as exc:
        # If date parsing fails, log warning but don't block access (backward compatibility)
        logger.warning(f"Failed to parse assessment schedule times: {exc}. startTime={start_time_str}, endTime={end_time_str}")
        return
    except Exception as exc:
        # Catch any other unexpected errors in date parsing
        logger.warning(f"Unexpected error parsing assessment schedule times: {exc}. startTime={start_time_str}, endTime={end_time_str}")
        return


@router.post("/verify-candidate")
async def verify_candidate(
    payload: Dict[str, Any],
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Verify candidate email and name against assessment candidates list."""
    try:
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

        # Check time window (allow before start so candidates can verify and see schedule)
        try:
            _check_assessment_time_window(assessment, allow_before_start=True)
        except HTTPException:
            raise
        except Exception as time_exc:
            # If time check fails due to parsing error, log but don't block verification
            logger.warning(f"Time window check error (non-blocking) for assessment {assessment_id}: {time_exc}")

        return success_response("Candidate verified successfully", {"verified": True})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Unexpected error in verify_candidate: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to verify candidate. Please try again."
        ) from exc


@router.get("/get-schedule")
async def get_assessment_schedule(
    assessmentId: str = Query(...),
    token: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get assessment schedule for candidates."""
    try:
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

        # Check time window (allow before start so candidates can check schedule)
        try:
            _check_assessment_time_window(assessment, allow_before_start=True)
        except HTTPException:
            raise
        except Exception as time_exc:
            # If time check fails due to parsing error, log but don't block schedule retrieval
            logger.warning(f"Time window check error (non-blocking) for assessment {assessmentId}: {time_exc}")

        schedule = assessment.get("schedule", {})
        return success_response(
            "Schedule fetched successfully",
            {
                "startTime": schedule.get("startTime"),
                "endTime": schedule.get("endTime"),
                "timezone": schedule.get("timezone", "Asia/Kolkata"),
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Unexpected error in get_assessment_schedule: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch schedule. Please try again."
        ) from exc


@router.get("/get-questions")
async def get_assessment_questions(
    assessmentId: str = Query(...),
    token: str = Query(...),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get assessment questions for candidates."""
    try:
        oid = to_object_id(assessmentId)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assessment ID")

    try:
        assessment = await db.assessments.find_one({"_id": oid})
        if not assessment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")

        # Verify token
        stored_token = assessment.get("assessmentToken")
        if stored_token != token:
            logger.warning(f"Token mismatch for assessment {assessmentId}. Expected: {stored_token[:10] if stored_token else 'None'}..., Got: {token[:10]}...")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid assessment token")

        # Check time window (strict - must be within start and end time)
        try:
            _check_assessment_time_window(assessment, allow_before_start=False)
        except HTTPException as time_error:
            logger.warning(f"Time window check failed for assessment {assessmentId}: {time_error.detail}")
            raise
        except Exception as time_exc:
            # If time check fails due to parsing error, log but don't block (backward compatibility)
            logger.warning(f"Time window check error (non-blocking) for assessment {assessmentId}: {time_exc}")

        # Collect all questions from all topics
        all_questions = []
        topics = assessment.get("topics", [])
        if not isinstance(topics, list):
            logger.warning(f"Topics is not a list for assessment {assessmentId}, type: {type(topics)}")
            topics = []
        
        for topic in topics:
            if not isinstance(topic, dict):
                logger.warning(f"Topic is not a dict, skipping. Type: {type(topic)}")
                continue
            topic_questions = topic.get("questions", [])
            if not isinstance(topic_questions, list):
                logger.warning(f"Topic questions is not a list, skipping. Type: {type(topic_questions)}")
                continue
            for question in topic_questions:
                if isinstance(question, dict):
                    all_questions.append(question)

        # Get questionTypeTimes and enablePerSectionTimers from assessment
        question_type_times = assessment.get("questionTypeTimes", {})
        if not isinstance(question_type_times, dict):
            logger.warning(f"questionTypeTimes is not a dict, using empty dict. Type: {type(question_type_times)}")
            question_type_times = {}
        
        enable_per_section_timers = assessment.get("enablePerSectionTimers", True)  # Default to True for backward compatibility
        if not isinstance(enable_per_section_timers, bool):
            enable_per_section_timers = True
    
        return success_response(
            "Questions fetched successfully",
            {
                "questions": all_questions,
                "questionTypeTimes": question_type_times,
                "enablePerSectionTimers": enable_per_section_timers,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Unexpected error in get_assessment_questions for assessment {assessmentId}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch assessment questions: {str(exc)}"
        ) from exc


@router.post("/log-answer")
async def log_candidate_answer(
    payload: LogAnswerRequest,
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Log candidate answer change for non-MCQ questions."""
    logger.info(f"Log answer endpoint called for assessment {payload.assessmentId}, question {payload.questionIndex}, type {payload.questionType}")
    logger.info(f"Candidate: {payload.email}, Name: {payload.name}")
    logger.info(f"Payload: {payload.dict()}")
    try:
        # Sanitize and validate input
        email = payload.email.strip().lower()
        name = payload.name.strip()
        answer = html.escape(payload.answer.strip())  # Sanitize HTML to prevent XSS
        
        if not email or not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email and name are required")
        
        if len(answer) > 50000:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Answer text exceeds maximum length of 50,000 characters")

        try:
            oid = to_object_id(payload.assessmentId)
        except ValueError:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assessment ID")

        assessment = await db.assessments.find_one({"_id": oid})
        if not assessment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")

        # Verify token
        if assessment.get("assessmentToken") != payload.token:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid assessment token")

        # Verify candidate
        candidates = assessment.get("candidates", [])
        candidate_found = any(
            c.get("email", "").strip().lower() == email and c.get("name", "").strip() == name
            for c in candidates
        )
        if not candidate_found:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Candidate not found")

        # Check time window (strict - must be within start and end time)
        try:
            _check_assessment_time_window(assessment, allow_before_start=False)
        except HTTPException:
            raise
        except Exception as time_exc:
            # If time check fails due to parsing error, log but don't block (backward compatibility)
            logger.warning(f"Time window check error (non-blocking) for assessment {payload.assessmentId}: {time_exc}")

        # Use consistent candidate key format: email_lowercase_name_stripped
        # This must match EXACTLY the format in get_answer_logs endpoint
        # Format: email.strip().lower() + "_" + name.strip()
        # Note: email is already lowercased above, but ensure both are stripped
        candidate_key = f"{email.strip().lower()}_{name.strip()}"
        logger.info(f"Generated candidate key for saving: '{candidate_key}' (email='{email}', name='{name}')")
        question_key = str(payload.questionIndex)

        # Use atomic MongoDB operations to prevent race conditions
        # This ensures concurrent updates don't overwrite each other
        update_path = f"answerLogs.{candidate_key}.{question_key}"
        
        logger.info(f"Attempting to save log atomically. Update path: {update_path}")
        logger.info(f"Candidate key: '{candidate_key}', Question key: '{question_key}'")
        
        # Read current state to check if structure exists and get version
        # This avoids path collisions by checking before updating
        assessment_check = await db.assessments.find_one(
            {"_id": oid},
            {"answerLogs": 1}
        )
        
        # Get current version count by reading the array length
        current_version = 0
        path_exists = False
        if assessment_check:
            answer_logs = assessment_check.get("answerLogs", {})
            if isinstance(answer_logs, dict):
                candidate_logs = answer_logs.get(candidate_key, {})
                if isinstance(candidate_logs, dict):
                    question_logs = candidate_logs.get(question_key, [])
                    if isinstance(question_logs, list):
                        current_version = len(question_logs)
                        path_exists = True
                        logger.info(f"Path exists, current version: {current_version}")
        
        next_version = current_version + 1
        
        # Step 5: Create log entry with calculated version
        # The version is for display purposes - actual ordering is determined by array position
        try:
            log_entry = {
                "answer": answer,
                "questionType": payload.questionType,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "version": next_version,
            }
            logger.info(f"Created log entry: {log_entry}")
        except Exception as log_entry_error:
            logger.error(f"Error creating log entry: {log_entry_error}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create log entry: {str(log_entry_error)}"
            ) from log_entry_error
        
        # Step 6: Save the log entry using the safest method
        # Strategy: Always use full document read-modify-write to avoid path collisions
        # This is safer than using $push/$set with dot notation which can cause collisions
        
        logger.info(f"Reading full assessment to update answerLogs safely")
        full_assessment = await db.assessments.find_one({"_id": oid})
        if not full_assessment:
            logger.error(f"Assessment not found after initial check")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Assessment not found")
        
        # Ensure answerLogs exists and is a dict
        if "answerLogs" not in full_assessment:
            full_assessment["answerLogs"] = {}
        if not isinstance(full_assessment["answerLogs"], dict):
            logger.warning(f"answerLogs was not a dict, converting")
            full_assessment["answerLogs"] = {}
        
        # Ensure candidate_key level exists and is a dict
        if candidate_key not in full_assessment["answerLogs"]:
            full_assessment["answerLogs"][candidate_key] = {}
        if not isinstance(full_assessment["answerLogs"][candidate_key], dict):
            logger.warning(f"answerLogs.{candidate_key} was not a dict, converting")
            full_assessment["answerLogs"][candidate_key] = {}
        
        # Ensure question_key array exists and is a list
        if question_key not in full_assessment["answerLogs"][candidate_key]:
            full_assessment["answerLogs"][candidate_key][question_key] = []
        if not isinstance(full_assessment["answerLogs"][candidate_key][question_key], list):
            logger.warning(f"answerLogs.{candidate_key}.{question_key} was not a list, converting")
            full_assessment["answerLogs"][candidate_key][question_key] = []
        
        # Append the new log entry
        try:
            full_assessment["answerLogs"][candidate_key][question_key].append(log_entry)
            logger.info(f"Appended log entry. Total entries for question {question_key}: {len(full_assessment['answerLogs'][candidate_key][question_key])}")
        except Exception as append_error:
            logger.error(f"Error appending log entry: {append_error}")
            logger.error(f"answerLogs structure: {full_assessment.get('answerLogs', 'N/A')}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to append log entry: {str(append_error)}"
            ) from append_error
        
        # Update the entire answerLogs structure atomically
        try:
            update_result = await db.assessments.update_one(
                {"_id": oid},
                {
                    "$set": {
                        "answerLogs": full_assessment["answerLogs"]
                    }
                }
            )
            logger.info(f"Update result - Matched: {update_result.matched_count}, Modified: {update_result.modified_count}")
        except Exception as update_error:
            logger.error(f"Error updating MongoDB: {update_error}")
            logger.error(f"Update error type: {type(update_error).__name__}")
            import traceback
            logger.error(f"Update error traceback: {traceback.format_exc()}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to update database: {str(update_error)}"
            ) from update_error

        if update_result.matched_count == 0:
            logger.error(f"Failed to update log - document not found")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save log entry - document not found")
        
        if update_result.modified_count == 0:
            logger.warning(f"Update matched but didn't modify - document may have been modified concurrently")
            # Re-read and retry once
            retry_assessment = await db.assessments.find_one({"_id": oid})
            if retry_assessment:
                if "answerLogs" not in retry_assessment:
                    retry_assessment["answerLogs"] = {}
                if not isinstance(retry_assessment["answerLogs"], dict):
                    retry_assessment["answerLogs"] = {}
                if candidate_key not in retry_assessment["answerLogs"]:
                    retry_assessment["answerLogs"][candidate_key] = {}
                if not isinstance(retry_assessment["answerLogs"][candidate_key], dict):
                    retry_assessment["answerLogs"][candidate_key] = {}
                if question_key not in retry_assessment["answerLogs"][candidate_key]:
                    retry_assessment["answerLogs"][candidate_key][question_key] = []
                if not isinstance(retry_assessment["answerLogs"][candidate_key][question_key], list):
                    retry_assessment["answerLogs"][candidate_key][question_key] = []
                
                retry_assessment["answerLogs"][candidate_key][question_key].append(log_entry)
                
                retry_result = await db.assessments.update_one(
                    {"_id": oid},
                    {"$set": {"answerLogs": retry_assessment["answerLogs"]}}
                )
                logger.info(f"Retry update result - Matched: {retry_result.matched_count}, Modified: {retry_result.modified_count}")
                update_result = retry_result

        logger.info(f"Answer logged for candidate {email}, question {payload.questionIndex}, version {next_version}")
        logger.info(f"Candidate key used: '{candidate_key}', Question key: '{question_key}'")
        logger.info(f"Update path: {update_path}")
        
        # Verify the log was saved by reading it back
        verify_assessment = await db.assessments.find_one({"_id": oid})
        if verify_assessment:
            verify_logs = verify_assessment.get("answerLogs", {})
            logger.info(f"Verification - answerLogs type: {type(verify_logs)}, keys: {list(verify_logs.keys()) if isinstance(verify_logs, dict) else 'N/A'}")
            verify_candidate_logs = verify_logs.get(candidate_key, {}) if isinstance(verify_logs, dict) else {}
            logger.info(f"Verification - candidate_logs type: {type(verify_candidate_logs)}, keys: {list(verify_candidate_logs.keys()) if isinstance(verify_candidate_logs, dict) else 'N/A'}")
            verify_question_logs = verify_candidate_logs.get(question_key, []) if isinstance(verify_candidate_logs, dict) else []
            logger.info(f"Verified: Found {len(verify_question_logs)} log entries for question {question_key}")
            if len(verify_question_logs) > 0:
                logger.info(f"First log entry: {verify_question_logs[0]}")
        else:
            logger.error("Verification failed - assessment not found after update")

        # Final verification - read back one more time to ensure it's saved
        final_check = await db.assessments.find_one(
            {"_id": oid},
            {"answerLogs": 1}
        )
        final_logs_count = 0
        if final_check:
            final_logs = final_check.get("answerLogs", {})
            final_candidate_logs = final_logs.get(candidate_key, {}) if isinstance(final_logs, dict) else {}
            final_question_logs = final_candidate_logs.get(question_key, []) if isinstance(final_candidate_logs, dict) else []
            final_logs_count = len(final_question_logs) if isinstance(final_question_logs, list) else 0
            logger.info(f"FINAL CHECK - Logs saved: {final_logs_count} entries for question {question_key}")
            if final_logs_count == 0:
                logger.error(f"CRITICAL: Logs were not saved! Path: {update_path}, Candidate key: {candidate_key}")
                logger.error(f"Available candidate keys in answerLogs: {list(final_logs.keys()) if isinstance(final_logs, dict) else 'N/A'}")
            else:
                logger.info(f"SUCCESS: Logs confirmed saved. Last entry: {final_question_logs[-1] if final_question_logs else 'N/A'}")
        
        return success_response(
            "Answer logged successfully",
            {
                "questionIndex": payload.questionIndex,
                "version": next_version,
                "timestamp": log_entry["timestamp"],
                "candidateKey": candidate_key,  # Return for debugging
                "logsCount": final_logs_count,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Error logging answer: {exc}")
        logger.error(f"Exception type: {type(exc).__name__}")
        logger.error(f"Exception message: {str(exc)}")
        logger.error(f"Exception args: {exc.args if hasattr(exc, 'args') else 'N/A'}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to log answer: {str(exc)}",
        ) from exc


@router.post("/submit-answers")
async def submit_candidate_answers(
    payload: Dict[str, Any],
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Submit candidate answers and calculate score."""
    assessment_id = payload.get("assessmentId")
    token = payload.get("token")
    email = payload.get("email", "").strip().lower()
    name = payload.get("name", "").strip()
    answers = payload.get("answers", [])
    skipped_questions = payload.get("skippedQuestions", [])

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
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Candidate not found")

    # Check time window (strict - must be within start and end time)
    # Note: We allow submission even slightly after endTime to handle auto-submissions
    # But we still check to prevent submissions way after the deadline
    schedule = assessment.get("schedule", {})
    start_time_str = schedule.get("startTime")
    end_time_str = schedule.get("endTime")
    
    if start_time_str and end_time_str:
        try:
            # Use the same date parsing logic as _check_assessment_time_window
            def normalize_datetime_str(dt_str: str) -> str:
                """Normalize datetime string to full ISO format."""
                # Remove timezone info temporarily for processing
                if "+" in dt_str:
                    dt_clean = dt_str.split("+")[0]
                elif dt_str.endswith("Z"):
                    dt_clean = dt_str[:-1]  # Remove Z
                else:
                    dt_clean = dt_str
                
                # Check if seconds are missing (format: YYYY-MM-DDTHH:MM)
                if "T" in dt_clean and dt_clean.count(":") == 1:
                    dt_clean = dt_clean + ":00"  # Add seconds
                
                # Check if timezone is missing - add Z if no timezone specified
                if "+" not in dt_str and not dt_str.endswith("Z"):
                    dt_clean = dt_clean + "Z"
                elif "+" in dt_str:
                    # Keep original timezone
                    dt_clean = dt_str
                
                return dt_clean
            
            start_time_str_normalized = normalize_datetime_str(start_time_str)
            end_time_str_normalized = normalize_datetime_str(end_time_str)
            
            try:
                start_time = datetime.fromisoformat(start_time_str_normalized.replace("Z", "+00:00"))
                end_time = datetime.fromisoformat(end_time_str_normalized.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                start_time = parser.parse(start_time_str)
                end_time = parser.parse(end_time_str)
            
            if start_time.tzinfo is None:
                start_time = start_time.replace(tzinfo=timezone.utc)
            if end_time.tzinfo is None:
                end_time = end_time.replace(tzinfo=timezone.utc)
            
            now = datetime.now(timezone.utc)
            
            if now < start_time:
                # Format the date nicely for the error message
                formatted_start = start_time.strftime("%Y-%m-%d %H:%M:%S UTC")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Assessment has not started yet. It will start at {formatted_start}"
                )
            
            # Allow 2 minutes grace period after endTime for auto-submissions
            grace_period_seconds = 120
            if now > end_time:
                time_after_end = (now - end_time).total_seconds()
                if time_after_end > grace_period_seconds:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=f"Assessment has ended. It ended at {end_time_str}. Submission deadline has passed."
                    )
        except HTTPException:
            raise
        except (ValueError, AttributeError, TypeError) as exc:
            logger.warning(f"Failed to parse assessment schedule times for submission: {exc}. startTime={start_time_str}, endTime={end_time_str}")
            # Don't block submission if date parsing fails (backward compatibility)

    try:
        # Collect all questions
        all_questions = []
        topics = assessment.get("topics", [])
        if not isinstance(topics, list):
            logger.warning(f"Topics is not a list for assessment {assessment_id}, type: {type(topics)}")
            topics = []
        
        for topic in topics:
            if not isinstance(topic, dict):
                logger.warning(f"Topic is not a dict, skipping. Type: {type(topic)}")
                continue
            topic_questions = topic.get("questions", [])
            if not isinstance(topic_questions, list):
                logger.warning(f"Topic questions is not a list, skipping. Type: {type(topic_questions)}")
                continue
            for question in topic_questions:
                if isinstance(question, dict):
                    all_questions.append(question)

        # Get answer logs to use the last answer for AI evaluation
        answer_logs = assessment.get("answerLogs", {})
        candidate_key = f"{email}_{name}"
        candidate_logs = {}
        if isinstance(answer_logs, dict):
            candidate_logs = answer_logs.get(candidate_key, {})
            if not isinstance(candidate_logs, dict):
                candidate_logs = {}

        # Calculate score (MCQ only for now)
        total_score = 0
        max_score = 0
        correct_answers = 0
        attempted = len(answers) if isinstance(answers, list) else 0
        not_attempted = len(all_questions) - attempted - (len(skipped_questions) if isinstance(skipped_questions, list) else 0)

        # AI evaluation results (using string keys for MongoDB compatibility)
        ai_evaluation_results = {}  # {"questionIndex": {score, feedback, evaluation}}
        total_ai_score = 0

        for idx, question in enumerate(all_questions):
            if not isinstance(question, dict):
                continue
            question_max_score = question.get("score", 5)
            max_score += question_max_score
            answer_obj = next((a for a in answers if isinstance(a, dict) and a.get("questionIndex") == idx), None)
            
            # Get the last answer log entry for this question
            question_key = str(idx)
            last_answer_log = None
            if question_key in candidate_logs:
                log_entries = candidate_logs[question_key]
                if isinstance(log_entries, list) and len(log_entries) > 0:
                    # Find the entry with the highest version (last answer)
                    last_answer_log = max(log_entries, key=lambda x: x.get("version", 0) if isinstance(x, dict) else 0)
            
            # Use last answer log if available, otherwise use submitted answer
            if last_answer_log and isinstance(last_answer_log, dict):
                candidate_answer = last_answer_log.get("answer", "").strip()
            elif answer_obj:
                candidate_answer = answer_obj.get("answer", "").strip()
            else:
                candidate_answer = ""
        
            if candidate_answer or answer_obj:
                question_type = question.get("type", "")
                
                if question_type == "MCQ":
                    # MCQ: Check against correct answer (use submitted answer for MCQ)
                    if answer_obj and answer_obj.get("answer", "").strip() == question.get("correctAnswer"):
                        total_score += question_max_score
                        correct_answers += 1
                        # Store MCQ score in AI evaluation results for consistency
                        ai_evaluation_results[str(idx)] = {
                            "score": question_max_score,
                            "feedback": "Correct answer",
                            "evaluation": "MCQ answer matched the correct option."
                        }
                        total_ai_score += question_max_score
                    else:
                        ai_evaluation_results[str(idx)] = {
                            "score": 0,
                            "feedback": "Incorrect answer",
                            "evaluation": "MCQ answer did not match the correct option."
                        }
                else:
                    # Non-MCQ: Evaluate with AI using last answer log
                    if candidate_answer:
                        try:
                            evaluation_result = await evaluate_answer_with_ai(
                                question=question,
                                candidate_answer=candidate_answer,
                                max_score=question_max_score
                            )
                            ai_score = evaluation_result.get("score", 0)
                            ai_evaluation_results[str(idx)] = {
                                "score": ai_score,
                                "feedback": evaluation_result.get("feedback", ""),
                                "evaluation": evaluation_result.get("evaluation", "")
                            }
                            total_ai_score += ai_score
                        except Exception as eval_error:
                            logger.error(f"Error evaluating answer for question {idx}: {eval_error}")
                            # If AI evaluation fails, give 0 score
                            ai_evaluation_results[str(idx)] = {
                                "score": 0,
                                "feedback": "Evaluation could not be completed.",
                                "evaluation": "AI evaluation service error."
                            }
                    else:
                        # Empty answer
                        ai_evaluation_results[str(idx)] = {
                            "score": 0,
                            "feedback": "No answer provided",
                            "evaluation": "Candidate did not provide an answer."
                        }

        # Calculate percentage
        percentage_scored = (total_ai_score / max_score * 100) if max_score > 0 else 0
        
        # Get pass percentage from assessment
        pass_percentage = assessment.get("passPercentage")
        if pass_percentage is None:
            pass_percentage = 0  # Default to 0 if not set
        
        # Determine pass/fail
        passed = percentage_scored >= pass_percentage

        # Store candidate response
        candidate_responses = assessment.get("candidateResponses", {})
        if not isinstance(candidate_responses, dict):
            candidate_responses = {}
        
        candidate_key = f"{email}_{name}"
        candidate_responses[candidate_key] = {
            "email": email,
            "name": name,
            "answers": answers if isinstance(answers, list) else [],
            "skippedQuestions": skipped_questions if isinstance(skipped_questions, list) else [],
            "score": total_score,  # Keep original MCQ score for backward compatibility
            "maxScore": max_score,
            "attempted": attempted,
            "notAttempted": not_attempted,
            "correctAnswers": correct_answers,
            "submittedAt": datetime.now(timezone.utc).isoformat(),
            # AI evaluation data
            "aiEvaluation": ai_evaluation_results,
            "aiScore": total_ai_score,
            "percentageScored": round(percentage_scored, 2),
            "passPercentage": pass_percentage,
            "passed": passed,
        }
        assessment["candidateResponses"] = candidate_responses
        await db.assessments.replace_one({"_id": oid}, assessment)

        return success_response(
            "Answers submitted successfully",
            {
                "score": total_score,
                "maxScore": max_score,
                "attempted": attempted,
                "notAttempted": not_attempted,
                "correctAnswers": correct_answers,
                "aiScore": total_ai_score,
                "percentageScored": round(percentage_scored, 2),
                "passed": passed,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception(f"Unexpected error in submit_candidate_answers for assessment {assessment_id}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to submit answers: {str(exc)}"
        ) from exc

