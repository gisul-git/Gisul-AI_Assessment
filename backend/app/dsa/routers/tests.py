from fastapi import APIRouter, HTTPException, Query, Body, UploadFile, File, Depends
from typing import List, Dict, Any, Optional
from bson import ObjectId
from datetime import datetime
import secrets
import csv
import io
import logging
from pydantic import BaseModel
from app.dsa.database import get_dsa_database as get_database
from app.dsa.models.test import TestCreate, Test, TestSubmission, TestInviteRequest, AddCandidateRequest, CandidateLinkResponse
from app.dsa.services.ai_feedback import generate_code_feedback
from app.dsa.utils.judge0 import run_all_test_cases, LANGUAGE_IDS
from app.dsa.routers.assessment import (
    prepare_code_for_execution,
    format_public_result,
    format_hidden_result_for_admin,
)
from app.core.dependencies import get_current_user, require_editor

logger = logging.getLogger("backend")

router = APIRouter()

@router.get("/debug/user-info", response_model=dict)
async def debug_user_info(
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Debug endpoint to verify authentication and user ID extraction
    """
    db = get_database()
    user_id = current_user.get("id") or current_user.get("_id")
    user_id_str = str(user_id).strip() if user_id else None
    
    # Check how many tests exist for this user
    user_tests_count = 0
    all_tests_count = 0
    tests_without_created_by = 0
    
    if user_id_str:
        # Count tests for this user
        user_tests_count = await db.tests.count_documents({"created_by": user_id_str})
        
        # Count all tests
        all_tests_count = await db.tests.count_documents({})
        
        # Count tests without created_by
        tests_without_created_by = await db.tests.count_documents({"created_by": {"$exists": False}})
        
        # Get a sample of all tests to see created_by values
        sample_tests = await db.tests.find({}).limit(5).to_list(length=5)
        sample_created_by_values = [{"id": str(t.get("_id")), "created_by": t.get("created_by"), "title": t.get("title", "Unknown")} for t in sample_tests]
    
    return {
        "user_id": user_id_str,
        "user_id_type": type(user_id).__name__ if user_id else None,
        "current_user_keys": list(current_user.keys()),
        "current_user_id": current_user.get("id"),
        "current_user__id": current_user.get("_id"),
        "current_user_email": current_user.get("email"),
        "database_stats": {
            "user_tests_count": user_tests_count,
            "all_tests_count": all_tests_count,
            "tests_without_created_by": tests_without_created_by,
            "sample_tests": sample_created_by_values if user_id_str else []
        },
        "message": "Authentication working correctly"
    }

@router.post("/", response_model=dict)
async def create_test(
    test: TestCreate,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Create a new test (requires authentication)
    Validates that all question_ids belong to the current user
    """
    db = get_database()
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[create_test] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()  # Ensure no whitespace and consistent format
    
    logger.info(f"[create_test] User ID extracted: '{user_id}' (type: {type(user_id).__name__})")
    
    # Validate that all questions belong to the current user
    if test.question_ids:
        question_ids = [ObjectId(qid) if ObjectId.is_valid(qid) else None for qid in test.question_ids]
        question_ids = [qid for qid in question_ids if qid is not None]
        
        if question_ids:
            questions = await db.questions.find({"_id": {"$in": question_ids}}).to_list(length=len(question_ids))
            # Check if all questions exist and belong to the user
            found_question_ids = {str(q["_id"]) for q in questions}
            requested_question_ids = {str(qid) for qid in question_ids}
            
            if found_question_ids != requested_question_ids:
                raise HTTPException(status_code=400, detail="Some questions not found")
            
            # Verify ownership - normalize both sides for comparison
            for question in questions:
                q_created_by = question.get("created_by")
                if not q_created_by or str(q_created_by).strip() != user_id.strip():
                    raise HTTPException(status_code=403, detail=f"Question {question.get('title', 'Unknown')} does not belong to you")
    
    test_dict = test.model_dump()
    # Store the actual user ID who created the test - CRITICAL: Must be string, no whitespace
    # user_id is already normalized above
    test_dict["created_by"] = user_id
    test_dict["is_active"] = True
    test_dict["is_published"] = False  # Tests start as unpublished
    test_dict["invited_users"] = []  # Will be populated via add candidate
    test_dict["created_at"] = datetime.utcnow()  # Set creation timestamp
    
    logger.info(f"[create_test] Creating test with created_by='{user_id}' (type: {type(user_id).__name__}), title={test_dict.get('title')}")
    logger.info(f"[create_test] Current user data: id={current_user.get('id')}, _id={current_user.get('_id')}, email={current_user.get('email')}")
    
    result = await db.tests.insert_one(test_dict)
    
    # Verify the test was created with correct created_by
    created_test_check = await db.tests.find_one({"_id": result.inserted_id})
    if created_test_check:
        actual_created_by = created_test_check.get("created_by")
        if actual_created_by != user_id:
            logger.error(f"[create_test] SECURITY ISSUE: Test created with created_by='{actual_created_by}' but expected '{user_id}'")
            logger.error(f"[create_test] Test ID: {result.inserted_id}, Title: {test_dict.get('title')}")
        else:
            logger.info(f"[create_test] Test created successfully with created_by='{actual_created_by}'")
    
    # Fetch the created test
    created_test = await db.tests.find_one({"_id": result.inserted_id})
    if created_test:
        # Convert ObjectId to string and ensure all fields are JSON serializable
        test_dict = {
            "id": str(created_test["_id"]),
            "title": created_test.get("title", ""),
            "description": created_test.get("description", ""),
            "duration_minutes": created_test.get("duration_minutes", 0),
            "start_time": created_test.get("start_time").isoformat() if created_test.get("start_time") else None,
            "end_time": created_test.get("end_time").isoformat() if created_test.get("end_time") else None,
            "is_active": created_test.get("is_active", False),
            "is_published": created_test.get("is_published", False),
            "invited_users": created_test.get("invited_users", []),
            "question_ids": [str(qid) if isinstance(qid, ObjectId) else qid for qid in created_test.get("question_ids", [])],
            "test_token": created_test.get("test_token"),
        }
        # Add created_at if it exists
        if "created_at" in created_test and created_test.get("created_at"):
            test_dict["created_at"] = created_test.get("created_at").isoformat() if isinstance(created_test.get("created_at"), datetime) else created_test.get("created_at")
        # Add updated_at if it exists
        if "updated_at" in created_test and created_test.get("updated_at"):
            test_dict["updated_at"] = created_test.get("updated_at").isoformat() if isinstance(created_test.get("updated_at"), datetime) else created_test.get("updated_at")
        return test_dict
    
    # Fallback if fetch fails
    test_dict["_id"] = str(result.inserted_id)
    test_dict["id"] = str(result.inserted_id)
    test_dict["start_time"] = test_dict["start_time"].isoformat() if isinstance(test_dict.get("start_time"), datetime) else test_dict.get("start_time")
    test_dict["end_time"] = test_dict["end_time"].isoformat() if isinstance(test_dict.get("end_time"), datetime) else test_dict.get("end_time")
    return test_dict

# Handle both with and without trailing slash to avoid 307 redirects
@router.get("", response_model=List[dict], include_in_schema=False)
async def get_tests_no_slash(
    active_only: bool = False,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """Redirect handler for GET /api/dsa/tests (without trailing slash)"""
    return await get_tests(active_only, current_user)

@router.get("/", response_model=List[dict])
async def get_tests(
    active_only: bool = False,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get tests for the current user (requires authentication)
    Only returns tests created by the current user
    
    SECURITY: This endpoint MUST only return tests where created_by matches the authenticated user's ID
    """
    # CRITICAL SECURITY CHECK: Verify authentication
    if not current_user:
        logger.error("[get_tests] CRITICAL: current_user is None or empty - authentication failed")
        raise HTTPException(status_code=401, detail="Authentication required")
    
    db = get_database()
    # Filter tests by the current user - STRICT: only return tests with created_by matching current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[get_tests] CRITICAL: Invalid user ID in current_user. Keys: {list(current_user.keys())}")
        logger.error(f"[get_tests] CRITICAL: current_user content: {current_user}")
        raise HTTPException(status_code=400, detail="Invalid user ID - authentication failed")
    user_id = str(user_id).strip()  # Ensure no whitespace
    
    # CRITICAL: Log the user_id being used for filtering
    # Using print() as well to ensure visibility in console
    print(f"[get_tests] SECURITY: Filtering tests for authenticated user_id: '{user_id}'")
    logger.info(f"[get_tests] SECURITY: Filtering tests for authenticated user_id: '{user_id}'")
    
    print(f"[get_tests] Fetching tests for user_id: '{user_id}' (type: {type(user_id).__name__})")
    logger.info(f"[get_tests] Fetching tests for user_id: '{user_id}' (type: {type(user_id).__name__})")
    print(f"[get_tests] Current user data: id={current_user.get('id')}, _id={current_user.get('_id')}, email={current_user.get('email')}")
    logger.info(f"[get_tests] Current user data: id={current_user.get('id')}, _id={current_user.get('_id')}, email={current_user.get('email')}")
    
    # ABSOLUTE SECURITY: Use explicit $and with $exists to ensure field exists
    # This is the STRICTEST possible query - will NEVER match documents without created_by
    # CRITICAL: Normalize user_id to string for comparison (handles ObjectId vs string)
    user_id_normalized = str(user_id).strip()
    
    # Build strict query - exact string match (we store created_by as string)
    base_conditions = [
        {"created_by": {"$exists": True}},
        {"created_by": {"$ne": None}},
        {"created_by": {"$ne": ""}},
        {"created_by": user_id_normalized}  # Exact string match
    ]
    
    if active_only:
        base_conditions.append({"is_active": True})
        base_conditions.append({"start_time": {"$lte": datetime.utcnow()}})
        base_conditions.append({"end_time": {"$gte": datetime.utcnow()}})
    
    query = {"$and": base_conditions}
    
    print(f"[get_tests] STRICT MongoDB query: {query}")
    logger.info(f"[get_tests] STRICT MongoDB query: {query}")
    print(f"[get_tests] Query will ONLY match tests where created_by exists, is not null, is not empty, and equals '{user_id_normalized}'")
    logger.info(f"[get_tests] Query will ONLY match tests where created_by exists, is not null, is not empty, and equals '{user_id_normalized}'")
    print(f"[get_tests] User ID type: {type(user_id).__name__}, normalized: '{user_id_normalized}'")
    logger.info(f"[get_tests] User ID type: {type(user_id).__name__}, normalized: '{user_id_normalized}'")
    
    # DEBUG: Check what tests exist in database (for debugging)
    all_tests_sample = await db.tests.find({}).limit(5).to_list(length=5)
    logger.info(f"[get_tests] DEBUG: Sample of ALL tests in DB (first 5):")
    for t in all_tests_sample:
        logger.info(f"[get_tests] DEBUG: Test ID={str(t.get('_id'))}, created_by={t.get('created_by')}, title={t.get('title', 'Unknown')}")
    
    # Execute query with explicit security - CRITICAL: This query MUST filter by created_by
    logger.info(f"[get_tests] EXECUTING MongoDB query: {query}")
    logger.info(f"[get_tests] Query conditions: created_by must exist, not be None, not be empty, and equal '{user_id_normalized}'")
    
    # CRITICAL: Execute query - this MUST filter by created_by
    tests = await db.tests.find(query).sort("created_at", -1).to_list(length=100)
    
    print(f"[get_tests] MongoDB returned {len(tests)} tests for user_id: '{user_id_normalized}'")
    logger.info(f"[get_tests] MongoDB returned {len(tests)} tests for user_id: '{user_id_normalized}'")
    print(f"[get_tests] Query executed successfully. Filtering by created_by='{user_id_normalized}'")
    logger.info(f"[get_tests] Query executed successfully. Filtering by created_by='{user_id_normalized}'")
    
    # VERIFY: Log each test's created_by to ensure they all match
    for idx, test in enumerate(tests):
        test_created_by = test.get("created_by")
        logger.info(f"[get_tests] Test {idx+1}: ID={str(test.get('_id'))}, created_by='{test_created_by}', matches_user={str(test_created_by).strip() == user_id_normalized}")
    
    # CRITICAL SECURITY CHECK: Additional client-side filter as defense in depth
    # This is a FINAL safety net - filter out ANY test that doesn't match exactly
    tests_before_filter = len(tests)
    filtered_tests = []
    for test in tests:
        test_created_by = test.get("created_by")
        test_id = str(test.get("_id", ""))
        test_title = test.get("title", "Unknown")
        
        # ABSOLUTE STRICT CHECK: Reject if created_by is missing, null, empty, or doesn't match
        if test_created_by is None:
            logger.error(f"[get_tests] SECURITY VIOLATION: Test {test_id} ({test_title}) has NULL created_by - REJECTING")
            continue
        
        if test_created_by == "":
            logger.error(f"[get_tests] SECURITY VIOLATION: Test {test_id} ({test_title}) has EMPTY created_by - REJECTING")
            continue
        
        # Normalize both sides to string for comparison (handles ObjectId vs string mismatch)
        test_created_by_str = str(test_created_by).strip()
        # Use the already normalized user_id from above
        if test_created_by_str != user_id_normalized:
            logger.error(f"[get_tests] SECURITY VIOLATION: Test {test_id} ({test_title}) created_by='{test_created_by_str}' != user_id='{user_id_normalized}' - REJECTING")
            continue
        
        # Only add if it passes all checks
        filtered_tests.append(test)
    
    tests = filtered_tests
    
    if tests_before_filter != len(tests):
        logger.error(f"[get_tests] SECURITY: Filtered out {tests_before_filter - len(tests)} tests that didn't match user_id - this should not happen if query is correct")
    
    # Final verification log - CRITICAL: Verify ALL tests belong to this user
    logger.info(f"[get_tests] Final check: Returning {len(tests)} tests for user_id: '{user_id_normalized}'")
    
    # ABSOLUTE FINAL CHECK: Verify every single test belongs to this user (defense in depth)
    # Create a new list with only tests that match (safe iteration)
    final_tests = []
    security_violations = 0
    for test in tests:
        test_created_by_raw = test.get("created_by")
        test_created_by = str(test_created_by_raw).strip() if test_created_by_raw is not None else ""
        test_id = str(test.get("_id", ""))
        test_title = test.get("title", "Unknown")
        
        if test_created_by != user_id_normalized:
            security_violations += 1
            logger.error(f"[get_tests] CRITICAL SECURITY ERROR: Test {test_id} ({test_title}) has created_by='{test_created_by}' but user_id='{user_id_normalized}' - REJECTING")
            logger.error(f"[get_tests] SECURITY: This should NEVER happen if query is correct. Test will be removed from response.")
            continue
        final_tests.append(test)
    
    tests = final_tests
    
    if security_violations > 0:
        logger.error(f"[get_tests] CRITICAL: Removed {security_violations} tests that didn't belong to user '{user_id_normalized}' - SECURITY BREACH PREVENTED")
        logger.error(f"[get_tests] This indicates the MongoDB query may have failed. Original query was: {query}")
    
    print(f"[get_tests] After final security check: Returning {len(tests)} tests for user_id: '{user_id_normalized}'")
    logger.info(f"[get_tests] After final security check: Returning {len(tests)} tests for user_id: '{user_id_normalized}'")
    
    # ABSOLUTE FINAL VERIFICATION: Log every test being returned
    print(f"[get_tests] SECURITY VERIFICATION: Tests being returned:")
    logger.info(f"[get_tests] SECURITY VERIFICATION: Tests being returned:")
    for idx, test in enumerate(tests):
        test_info = f"[get_tests]   Test {idx+1}: ID={str(test.get('_id'))}, created_by='{test.get('created_by')}', title='{test.get('title', 'Unknown')}'"
        print(test_info)
        logger.info(test_info)
    
    result = []
    for test in tests:
        # Convert ObjectId to string and ensure all fields are JSON serializable
        test_dict = {
            "id": str(test["_id"]),
            "title": test.get("title", ""),
            "description": test.get("description", ""),
            "duration_minutes": test.get("duration_minutes", 0),
            "start_time": test.get("start_time").isoformat() if test.get("start_time") else None,
            "end_time": test.get("end_time").isoformat() if test.get("end_time") else None,
            "is_active": test.get("is_active", False),
            "is_published": test.get("is_published", False),
            "invited_users": test.get("invited_users", []),
            "question_ids": [str(qid) if isinstance(qid, ObjectId) else qid for qid in test.get("question_ids", [])],
            "test_token": test.get("test_token"),
            "created_by": str(test.get("created_by", "")),  # CRITICAL: Include for client-side verification
        }
        # Add created_at if it exists
        if "created_at" in test and test.get("created_at"):
            test_dict["created_at"] = test.get("created_at").isoformat() if isinstance(test.get("created_at"), datetime) else test.get("created_at")
        # Add updated_at if it exists (though it might not be in the model)
        if "updated_at" in test and test.get("updated_at"):
            test_dict["updated_at"] = test.get("updated_at").isoformat() if isinstance(test.get("updated_at"), datetime) else test.get("updated_at")
        result.append(test_dict)
    return result

@router.get("/{test_id}", response_model=dict)
async def get_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get test details (requires authentication and ownership)
    Only returns tests created by the current user
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Get current user ID
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[get_test] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    logger.info(f"[get_test] Fetching test {test_id} for user_id: '{user_id}'")
    
    # Find test and verify ownership
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # CRITICAL SECURITY CHECK: Verify ownership
    test_created_by = test.get("created_by")
    if not test_created_by:
        logger.warning(f"[get_test] SECURITY: Test {test_id} has no created_by field")
        raise HTTPException(status_code=403, detail="You don't have permission to view this test")
    
    if str(test_created_by).strip() != user_id.strip():
        logger.error(f"[get_test] SECURITY ISSUE: User {user_id} attempted to access test {test_id} created by {test_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to view this test")
    
    logger.info(f"[get_test] Test {test_id} access granted to user {user_id}")
    
    # Convert ObjectId to string and ensure all fields are JSON serializable
    test_dict = {
        "id": str(test["_id"]),
        "title": test.get("title", ""),
        "description": test.get("description", ""),
        "duration_minutes": test.get("duration_minutes", 0),
        "start_time": test.get("start_time").isoformat() if test.get("start_time") else None,
        "end_time": test.get("end_time").isoformat() if test.get("end_time") else None,
        "is_active": test.get("is_active", False),
        "is_published": test.get("is_published", False),
        "invited_users": test.get("invited_users", []),
        "question_ids": [str(qid) if isinstance(qid, ObjectId) else qid for qid in test.get("question_ids", [])],
        "question_time_limits": test.get("question_time_limits"),
        "test_token": test.get("test_token"),
    }
    return test_dict

@router.put("/{test_id}", response_model=dict)
async def update_test(
    test_id: str,
    test: TestCreate,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Update an existing test (requires authentication and ownership)
    Validates that all question_ids belong to the current user
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Check if test exists and belongs to the current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    existing_test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not existing_test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Verify ownership - normalize both sides for comparison
    existing_created_by = existing_test.get("created_by")
    if not existing_created_by:
        logger.error(f"[update_test] SECURITY: Test {test_id} has no created_by field")
        raise HTTPException(status_code=403, detail="You don't have permission to update this test")
    if str(existing_created_by).strip() != user_id.strip():
        logger.error(f"[update_test] SECURITY ISSUE: User {user_id} attempted to update test {test_id} created by {existing_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to update this test")
    
    # Validate that all questions belong to the current user
    if test.question_ids:
        question_ids = [ObjectId(qid) if ObjectId.is_valid(qid) else None for qid in test.question_ids]
        question_ids = [qid for qid in question_ids if qid is not None]
        
        if question_ids:
            questions = await db.questions.find({"_id": {"$in": question_ids}}).to_list(length=len(question_ids))
            # Check if all questions exist and belong to the user
            found_question_ids = {str(q["_id"]) for q in questions}
            requested_question_ids = {str(qid) for qid in question_ids}
            
            if found_question_ids != requested_question_ids:
                raise HTTPException(status_code=400, detail="Some questions not found")
            
            # Verify ownership - normalize both sides for comparison
            for question in questions:
                q_created_by = question.get("created_by")
                if not q_created_by or str(q_created_by).strip() != user_id.strip():
                    raise HTTPException(status_code=403, detail=f"Question {question.get('title', 'Unknown')} does not belong to you")
    
    # Prepare update data
    test_dict = test.model_dump()
    # Preserve existing fields that shouldn't be updated
    test_dict["is_active"] = existing_test.get("is_active", True)
    test_dict["is_published"] = existing_test.get("is_published", False)
    test_dict["invited_users"] = existing_test.get("invited_users", [])
    
    # Update the test
    result = await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": test_dict}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Fetch the updated test
    updated_test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if updated_test:
        # Convert ObjectId to string and ensure all fields are JSON serializable
        test_dict = {
            "id": str(updated_test["_id"]),
            "title": updated_test.get("title", ""),
            "description": updated_test.get("description", ""),
            "duration_minutes": updated_test.get("duration_minutes", 0),
            "start_time": updated_test.get("start_time").isoformat() if updated_test.get("start_time") else None,
            "end_time": updated_test.get("end_time").isoformat() if updated_test.get("end_time") else None,
            "is_active": updated_test.get("is_active", False),
            "is_published": updated_test.get("is_published", False),
            "invited_users": updated_test.get("invited_users", []),
            "question_ids": [str(qid) if isinstance(qid, ObjectId) else qid for qid in updated_test.get("question_ids", [])],
            "test_token": updated_test.get("test_token"),
        }
        return test_dict
    
    raise HTTPException(status_code=500, detail="Failed to update test")

@router.post("/{test_id}/start")
async def start_test(test_id: str, user_id: str = Query(..., description="User ID from link token")):
    """
    Start a test (user_id provided via query parameter)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    if not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid user ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=403, detail="Test is not published")
    
    # For test-taking platform, allow taking published tests regardless of time window
    # The time window is informational, not restrictive
    # Only check if test is active flag is set
    if not test.get("is_active", True):
        raise HTTPException(status_code=400, detail="Test is not active")
    
    # Check if user already started
    existing = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if existing:
        return {
            "test_submission_id": str(existing["_id"]),
            "started_at": existing["started_at"].isoformat() if isinstance(existing.get("started_at"), datetime) else existing.get("started_at"),
            "is_completed": existing.get("is_completed", False)
        }
    
    # Create test submission
    test_submission = {
        "test_id": test_id,
        "user_id": user_id,
        "submissions": [],
        "score": 0,
        "started_at": datetime.utcnow(),
        "is_completed": False,
    }
    
    result = await db.test_submissions.insert_one(test_submission)
    return {
        "test_submission_id": str(result.inserted_id),
        "started_at": test_submission["started_at"].isoformat(),
        "is_completed": False
    }

@router.get("/{test_id}/submission")
async def get_test_submission(test_id: str, user_id: str = Query(..., description="User ID from link token")):
    """
    Get test submission for user
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test_submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if not test_submission:
        raise HTTPException(status_code=404, detail="Test submission not found")
    
    # Convert ObjectId and datetime fields to JSON-serializable formats
    # Convert any ObjectId values in submissions array to strings
    submissions_list = test_submission.get("submissions", [])
    serialized_submissions = []
    for item in submissions_list:
        if isinstance(item, ObjectId):
            serialized_submissions.append(str(item))
        else:
            serialized_submissions.append(item)
    
    submission_dict = {
        "id": str(test_submission["_id"]),
        "test_id": str(test_submission.get("test_id", "")) if isinstance(test_submission.get("test_id"), ObjectId) else test_submission.get("test_id", ""),
        "user_id": str(test_submission.get("user_id", "")) if isinstance(test_submission.get("user_id"), ObjectId) else test_submission.get("user_id", ""),
        "submissions": serialized_submissions,
        "score": test_submission.get("score", 0),
        "started_at": test_submission.get("started_at").isoformat() if isinstance(test_submission.get("started_at"), datetime) else test_submission.get("started_at"),
        "is_completed": test_submission.get("is_completed", False),
    }
    
    # Handle submitted_at if it exists
    if "submitted_at" in test_submission:
        submitted_at_val = test_submission.get("submitted_at")
        if isinstance(submitted_at_val, datetime):
            submission_dict["submitted_at"] = submitted_at_val.isoformat()
        else:
            submission_dict["submitted_at"] = submitted_at_val
    
    return submission_dict


@router.patch("/{test_id}/submission")
async def update_test_submission(
    test_id: str,
    user_id: str = Query(..., description="User ID from link token"),
    is_completed: bool = Query(False, description="Mark as completed"),
    submitted_at: str = Query(None, description="Submission timestamp")
):
    """
    Update test submission (mark as completed)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    update_data: dict = {"is_completed": is_completed}
    if submitted_at:
        try:
            # Handle ISO format with or without timezone
            if submitted_at.endswith('Z'):
                submitted_at = submitted_at[:-1] + '+00:00'
            update_data["submitted_at"] = datetime.fromisoformat(submitted_at)
        except:
            update_data["submitted_at"] = datetime.utcnow()
    elif is_completed:
        update_data["submitted_at"] = datetime.utcnow()
    
    result = await db.test_submissions.update_one(
        {"test_id": test_id, "user_id": user_id},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Test submission not found")
    
    test_submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    test_submission["id"] = str(test_submission["_id"])
    return test_submission


class QuestionSubmission(BaseModel):
    question_id: str
    code: str
    language: str

class FinalTestSubmissionRequest(BaseModel):
    question_submissions: List[QuestionSubmission]
    activity_logs: Optional[List[Dict[str, Any]]] = []


@router.post("/{test_id}/final-submit")
async def final_submit_test(
    test_id: str,
    user_id: str = Query(..., description="User ID from link token"),
    request: FinalTestSubmissionRequest = Body(...)
):
    """
    Final test submission - collects all code, generates AI feedback, and saves logs.
    Does NOT use Judge0 for evaluation.
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Get test details
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Get or create test submission
    test_submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if not test_submission:
        raise HTTPException(status_code=404, detail="Test submission not found. Please start the test first.")
    
    # Process each question submission
    final_submissions = []
    total_score = 0
    
    for q_sub in request.question_submissions:
        question_id = q_sub.question_id
        if not ObjectId.is_valid(question_id):
            continue
        
        # Get question details
        question = await db.questions.find_one({"_id": ObjectId(question_id)})
        if not question:
            continue
        
        # Get language ID from language name
        language_id = LANGUAGE_IDS.get(q_sub.language.lower(), None)
        if not language_id:
            logger.warning(f"Unknown language: {q_sub.language}, skipping question {question_id}")
            continue
        
        # Prepare code for execution (validate + wrap if needed)
        prepared_code, prep_error, code_warnings = await prepare_code_for_execution(
            source_code=q_sub.code,
            language_id=language_id,
            question=question
        )
        
        if prep_error:
            logger.error(f"Code preparation error for question {question_id}: {prep_error}")
            # Still create submission but mark as error
            submission_data = {
                "user_id": user_id,
                "question_id": question_id,
                "language": q_sub.language,
                "code": q_sub.code,
                "status": "compilation_error",
                "test_results": [],
                "passed_testcases": 0,
                "total_testcases": 0,
                "ai_feedback": {"error": prep_error},
                "created_at": datetime.utcnow(),
                "is_final_submission": True,
            }
            submission_result = await db.submissions.insert_one(submission_data)
            final_submissions.append(str(submission_result.inserted_id))
            continue
        
        # Build test cases array - PUBLIC + HIDDEN
        public_test_cases = []
        hidden_test_cases = []
        all_test_cases = []
        
        # Add public test cases
        for i, tc in enumerate(question.get("public_testcases", [])):
            tc_data = {
                "id": f"public_{i}",
                "stdin": tc.get("input", ""),
                "expected_output": tc.get("expected_output", ""),
                "is_hidden": False,
                "points": tc.get("points", 1),
            }
            public_test_cases.append(tc_data)
            all_test_cases.append(tc_data)
        
        # Add hidden test cases
        for i, tc in enumerate(question.get("hidden_testcases", [])):
            tc_data = {
                "id": f"hidden_{i}",
                "stdin": tc.get("input", ""),
                "expected_output": tc.get("expected_output", ""),
                "is_hidden": True,
                "points": tc.get("points", 1),
            }
            hidden_test_cases.append(tc_data)
            all_test_cases.append(tc_data)
        
        if not all_test_cases:
            logger.warning(f"No test cases for question {question_id}")
            continue
        
        # Get execution constraints
        cpu_time_limit = 2.0
        memory_limit = 128000
        
        # Run ALL test cases with prepared code
        results = await run_all_test_cases(
            source_code=prepared_code,
            language_id=language_id,
            test_cases=all_test_cases,
            cpu_time_limit=cpu_time_limit,
            memory_limit=memory_limit,
            stop_on_compilation_error=True,
        )
        
        # Process test case results
        all_results = results.get("results", [])
        public_count = len(public_test_cases)
        
        # Process public test case results
        public_results = []
        for i in range(public_count):
            if i < len(all_results):
                public_results.append(format_public_result(all_results[i], i + 1))
        
        # Process hidden test case results (full details for AI feedback)
        full_hidden_results = []
        hidden_passed = 0
        for i in range(public_count, len(all_results)):
            hidden_index = i - public_count
            result = all_results[i]
            tc = hidden_test_cases[hidden_index]
            full_hidden_results.append(format_hidden_result_for_admin(
                result, hidden_index + 1, tc["stdin"], tc["expected_output"]
            ))
            if result.get("passed", False):
                hidden_passed += 1
        
        # Calculate totals
        public_passed = sum(1 for r in public_results if r.get("passed", False))
        public_total = len(public_test_cases)
        hidden_total = len(hidden_test_cases)
        total_passed = public_passed + hidden_passed
        total_tests = public_total + hidden_total
        
        # Generate AI feedback based on actual test results
        ai_feedback = None
        try:
            all_test_results = public_results + full_hidden_results
            
            # Get starter code for the language
            starter_code = None
            starter_code_dict = question.get("starter_code", {})
            if isinstance(starter_code_dict, dict):
                starter_code = starter_code_dict.get(q_sub.language) or starter_code_dict.get(q_sub.language.lower())
            
            ai_feedback = generate_code_feedback(
                source_code=q_sub.code,
                language=q_sub.language,
                question_title=question.get("title", ""),
                question_description=question.get("description", ""),
                test_results=all_test_results,
                total_passed=total_passed,
                total_tests=total_tests,
                time_spent_seconds=None,
                public_passed=public_passed,
                public_total=public_total,
                hidden_passed=hidden_passed,
                hidden_total=hidden_total,
                starter_code=starter_code,
            )
            logger.info(f"Generated AI feedback for question {question_id} with {total_passed}/{total_tests} tests passed")
        except Exception as e:
            logger.error(f"Failed to generate AI feedback for question {question_id}: {e}")
            ai_feedback = {"error": str(e)}
        
        # Determine status
        if results.get("compilation_error"):
            status = "compilation_error"
        elif total_passed == total_tests:
            status = "accepted"
        elif total_passed > 0:
            status = "partially_accepted"
        else:
            status = "wrong_answer"
        
        # Create submission record with actual test results
        submission_data = {
            "user_id": user_id,
            "question_id": question_id,
            "language": q_sub.language,
            "code": q_sub.code,
            "status": status,
            "test_results": all_test_results,
            "public_results": public_results,
            "hidden_results_full": full_hidden_results,
            "passed_testcases": total_passed,
            "total_testcases": total_tests,
            "public_passed": public_passed,
            "public_total": public_total,
            "hidden_passed": hidden_passed,
            "hidden_total": hidden_total,
            "ai_feedback": ai_feedback,
            "created_at": datetime.utcnow(),
            "is_final_submission": True,
        }
        
        # Save submission
        submission_result = await db.submissions.insert_one(submission_data)
        final_submissions.append(str(submission_result.inserted_id))
        
        # Calculate score from AI feedback if available
        if ai_feedback and isinstance(ai_feedback, dict):
            score = ai_feedback.get("overall_score", 0)
            total_score += score
    
    # Update test submission with final data
    update_data = {
        "is_completed": True,
        "submitted_at": datetime.utcnow(),
        "submissions": final_submissions,
        "score": total_score,
        "activity_logs": request.activity_logs,
        "final_submission_data": {
            "question_submissions": [
                {
                    "question_id": q_sub.question_id,
                    "language": q_sub.language,
                    "code_length": len(q_sub.code),
                }
                for q_sub in request.question_submissions
            ],
            "submitted_at": datetime.utcnow().isoformat(),
        }
    }
    
    await db.test_submissions.update_one(
        {"test_id": test_id, "user_id": user_id},
        {"$set": update_data}
    )
    
    # Return submission summary
    return {
        "message": "Test submitted successfully",
        "test_id": test_id,
        "user_id": user_id,
        "submissions_count": len(final_submissions),
        "total_score": total_score,
        "submitted_at": update_data["submitted_at"].isoformat(),
    }


@router.post("/{test_id}/add-candidate")
async def add_candidate(
    test_id: str,
    candidate: AddCandidateRequest
):
    """
    Add a candidate to a test (creates user account)
    Uses a single shared test link for all candidates
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=400, detail="Test must be published before adding candidates")
    
    # Check if candidate already exists for this test
    existing_candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "email": candidate.email
    })
    if existing_candidate:
        raise HTTPException(status_code=400, detail="Candidate already added to this test")
    
    # Check if user already exists
    existing_user = await db.users.find_one({"email": candidate.email})
    if existing_user:
        user_id = str(existing_user["_id"])
    else:
        # Create new user account
        user_dict = {
            "username": candidate.name.lower().replace(" ", "_"),
            "email": candidate.email,
            "hashed_password": "",  # No password - candidates use shared link
            "is_admin": False,
            "total_score": 0,
            "questions_solved": 0,
        }
        result = await db.users.insert_one(user_dict)
        user_id = str(result.inserted_id)
    
    # Store candidate record (no link_token needed - using shared test token)
    candidate_record = {
        "test_id": test_id,
        "user_id": user_id,
        "name": candidate.name,
        "email": candidate.email,
        "created_at": datetime.utcnow(),
    }
    await db.test_candidates.insert_one(candidate_record)
    
    # Add email to invited_users if not already there
    current_invited = set(test.get("invited_users", []))
    current_invited.add(candidate.email)
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"invited_users": list(current_invited)}}
    )
    
    # Get the shared test link
    test_token = test.get("test_token")
    if not test_token:
        # Generate token if not exists (shouldn't happen if test is published)
        test_token = secrets.token_urlsafe(32)
        await db.tests.update_one(
            {"_id": ObjectId(test_id)},
            {"$set": {"test_token": test_token}}
        )
    
    test_link = f"/test/{test_id}?token={test_token}"
    
    return {
        "candidate_id": user_id,
        "test_link": test_link,
        "name": candidate.name,
        "email": candidate.email,
    }


@router.post("/{test_id}/bulk-add-candidates")
async def bulk_add_candidates(
    test_id: str,
    file: UploadFile = File(...)
):
    """
    Bulk add candidates from CSV file
    CSV format: name,email (header row required)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=400, detail="Test must be published before adding candidates")
    
    # Read CSV file
    contents = await file.read()
    try:
        csv_text = contents.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Please use UTF-8 encoded CSV.")
    
    csv_reader = csv.DictReader(io.StringIO(csv_text))
    
    # Validate CSV format
    if not csv_reader.fieldnames or 'name' not in csv_reader.fieldnames or 'email' not in csv_reader.fieldnames:
        raise HTTPException(
            status_code=400,
            detail="CSV must have 'name' and 'email' columns"
        )
    
    results = {
        "success": [],
        "failed": [],
        "duplicates": []
    }
    
    current_invited = set(test.get("invited_users", []))
    
    for row in csv_reader:
        name = row.get('name', '').strip()
        email = row.get('email', '').strip()
        
        if not name or not email:
            results["failed"].append({
                "name": name or "N/A",
                "email": email or "N/A",
                "reason": "Name or email is empty"
            })
            continue
        
        # Check if candidate already exists for this test
        existing_candidate = await db.test_candidates.find_one({
            "test_id": test_id,
            "email": email
        })
        
        if existing_candidate:
            results["duplicates"].append({
                "name": name,
                "email": email,
                "reason": "Already added to this test"
            })
            continue
        
        try:
            # Check if user already exists
            existing_user = await db.users.find_one({"email": email})
            if existing_user:
                user_id = str(existing_user["_id"])
            else:
                # Create new user account
                user_dict = {
                    "username": name.lower().replace(" ", "_"),
                    "email": email,
                    "hashed_password": "",
                    "is_admin": False,
                    "total_score": 0,
                    "questions_solved": 0,
                }
                result = await db.users.insert_one(user_dict)
                user_id = str(result.inserted_id)
            
            # Generate unique test link token
            link_token = secrets.token_urlsafe(32)
            
            # Store candidate record
            candidate_record = {
                "test_id": test_id,
                "user_id": user_id,
                "name": name,
                "email": email,
                "link_token": link_token,
                "created_at": datetime.utcnow(),
            }
            await db.test_candidates.insert_one(candidate_record)
            
            # Add email to invited_users
            current_invited.add(email)
            
            test_link = f"/test/{test_id}?token={link_token}"
            
            results["success"].append({
                "name": name,
                "email": email,
                "test_link": test_link,
                "candidate_id": user_id
            })
        except Exception as e:
            results["failed"].append({
                "name": name,
                "email": email,
                "reason": str(e)
            })
    
    # Update test with all invited users
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"invited_users": list(current_invited)}}
    )
    
    return {
        "message": f"Processed {len(results['success']) + len(results['failed']) + len(results['duplicates'])} candidates",
        "success_count": len(results["success"]),
        "failed_count": len(results["failed"]),
        "duplicate_count": len(results["duplicates"]),
        "results": results
    }


@router.get("/{test_id}/candidates")
async def get_test_candidates(
    test_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all candidates for a test (requires authentication and ownership)
    Only test creators can view candidates
    """
    db = get_database()
    # Get current user ID
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[get_test_candidates] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    # Verify test exists and belongs to current user
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # CRITICAL SECURITY CHECK: Verify ownership
    test_created_by = test.get("created_by")
    if not test_created_by or str(test_created_by).strip() != user_id:
        logger.error(f"[get_test_candidates] SECURITY ISSUE: User {user_id} attempted to access candidates for test {test_id} created by {test_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to view candidates for this test")
    
    candidates = await db.test_candidates.find({"test_id": test_id}).sort("created_at", -1).to_list(length=1000)
    
    result = []
    for candidate in candidates:
        # Get submission status
        submission = await db.test_submissions.find_one({
            "test_id": test_id,
            "user_id": candidate["user_id"]
        })
        
        result.append({
            "candidate_id": str(candidate["_id"]),
            "user_id": candidate["user_id"],
            "name": candidate.get("name", ""),
            "email": candidate.get("email", ""),
            "created_at": candidate.get("created_at").isoformat() if candidate.get("created_at") else None,
            "has_submitted": submission is not None and submission.get("is_completed", False),
            "submission_score": submission.get("score", 0) if submission else 0,
            "submitted_at": submission.get("submitted_at").isoformat() if submission and submission.get("submitted_at") else None,
        })
    
    return result


@router.get("/{test_id}/candidates/{user_id}/analytics")
async def get_candidate_analytics(
    test_id: str,
    user_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get detailed analytics for a candidate including AI feedback (requires authentication and ownership)
    Only test creators can view candidate analytics
    """
    db = get_database()
    # Get current user ID
    current_user_id = current_user.get("id") or current_user.get("_id")
    if not current_user_id:
        logger.error(f"[get_candidate_analytics] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    current_user_id = str(current_user_id).strip()
    
    # Verify test exists and belongs to current user
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # CRITICAL SECURITY CHECK: Verify ownership
    test_created_by = test.get("created_by")
    if not test_created_by or str(test_created_by).strip() != current_user_id:
        logger.error(f"[get_candidate_analytics] SECURITY ISSUE: User {current_user_id} attempted to access analytics for test {test_id} created by {test_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to view analytics for this test")
    if not ObjectId.is_valid(test_id) or not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid test ID or user ID")
    
    # Get candidate info
    candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    # Get test submission
    submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if not submission:
        return {
            "candidate": {
                "name": candidate.get("name", ""),
                "email": candidate.get("email", ""),
            },
            "submission": None,
            "question_analytics": []
        }
    
    # Get all submissions for this test
    submission_ids = submission.get("submissions", [])
    question_analytics = []
    
    for sub_id in submission_ids:
        if isinstance(sub_id, ObjectId):
            sub_id_str = str(sub_id)
        else:
            sub_id_str = sub_id
        
        try:
            sub = await db.submissions.find_one({"_id": ObjectId(sub_id_str)})
            if sub:
                # Get question details
                question = await db.questions.find_one({"_id": ObjectId(sub["question_id"])})
                
                question_analytics.append({
                    "question_id": sub["question_id"],
                    "question_title": question.get("title", "Unknown") if question else "Unknown",
                    "language": sub.get("language", ""),
                    "status": sub.get("status", ""),
                    "passed_testcases": sub.get("passed_testcases", 0),
                    "total_testcases": sub.get("total_testcases", 0),
                    "execution_time": sub.get("execution_time"),
                    "memory_used": sub.get("memory_used"),
                    "code": sub.get("code", ""),
                    "test_results": sub.get("test_results", []),
                    "ai_feedback": sub.get("ai_feedback"),
                    "created_at": sub.get("created_at").isoformat() if sub.get("created_at") else None,
                })
        except Exception:
            continue
    
    # Get activity logs
    activity_logs = submission.get("activity_logs", [])
    
    return {
        "candidate": {
            "name": candidate.get("name", ""),
            "email": candidate.get("email", ""),
        },
        "submission": {
            "score": submission.get("score", 0),
            "started_at": submission.get("started_at").isoformat() if submission.get("started_at") else None,
            "submitted_at": submission.get("submitted_at").isoformat() if submission.get("submitted_at") else None,
            "is_completed": submission.get("is_completed", False),
        },
        "question_analytics": question_analytics,
        "activity_logs": activity_logs,
    }


@router.post("/{test_id}/bulk-add-candidates")
async def bulk_add_candidates(
    test_id: str,
    file: UploadFile = File(...)
):
    """
    Bulk add candidates from CSV file
    CSV format: name,email (header row required)
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=400, detail="Test must be published before adding candidates")
    
    # Read CSV file
    contents = await file.read()
    try:
        csv_text = contents.decode('utf-8')
    except UnicodeDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file encoding. Please use UTF-8 encoded CSV.")
    
    csv_reader = csv.DictReader(io.StringIO(csv_text))
    
    # Validate CSV format
    if not csv_reader.fieldnames or 'name' not in csv_reader.fieldnames or 'email' not in csv_reader.fieldnames:
        raise HTTPException(
            status_code=400,
            detail="CSV must have 'name' and 'email' columns"
        )
    
    results = {
        "success": [],
        "failed": [],
        "duplicates": []
    }
    
    current_invited = set(test.get("invited_users", []))
    
    for row in csv_reader:
        name = row.get('name', '').strip()
        email = row.get('email', '').strip()
        
        if not name or not email:
            results["failed"].append({
                "name": name or "N/A",
                "email": email or "N/A",
                "reason": "Name or email is empty"
            })
            continue
        
        # Check if candidate already exists for this test
        existing_candidate = await db.test_candidates.find_one({
            "test_id": test_id,
            "email": email
        })
        
        if existing_candidate:
            results["duplicates"].append({
                "name": name,
                "email": email,
                "reason": "Already added to this test"
            })
            continue
        
        try:
            # Check if user already exists
            existing_user = await db.users.find_one({"email": email})
            if existing_user:
                user_id = str(existing_user["_id"])
            else:
                # Create new user account
                user_dict = {
                    "username": name.lower().replace(" ", "_"),
                    "email": email,
                    "hashed_password": "",
                    "is_admin": False,
                    "total_score": 0,
                    "questions_solved": 0,
                }
                result = await db.users.insert_one(user_dict)
                user_id = str(result.inserted_id)
            
            # Generate unique test link token
            link_token = secrets.token_urlsafe(32)
            
            # Store candidate record
            candidate_record = {
                "test_id": test_id,
                "user_id": user_id,
                "name": name,
                "email": email,
                "link_token": link_token,
                "created_at": datetime.utcnow(),
            }
            await db.test_candidates.insert_one(candidate_record)
            
            # Add email to invited_users
            current_invited.add(email)
            
            test_link = f"/test/{test_id}?token={link_token}"
            
            results["success"].append({
                "name": name,
                "email": email,
                "test_link": test_link,
                "candidate_id": user_id
            })
        except Exception as e:
            results["failed"].append({
                "name": name,
                "email": email,
                "reason": str(e)
            })
    
    # Update test with all invited users
    await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": {"invited_users": list(current_invited)}}
    )
    
    return {
        "message": f"Processed {len(results['success']) + len(results['failed']) + len(results['duplicates'])} candidates",
        "success_count": len(results["success"]),
        "failed_count": len(results["failed"]),
        "duplicate_count": len(results["duplicates"]),
        "results": results
    }


@router.get("/{test_id}/candidates")
async def get_test_candidates(
    test_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get all candidates for a test (requires authentication and ownership)
    Only test creators can view candidates
    """
    db = get_database()
    # Get current user ID
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[get_test_candidates] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    # Verify test exists and belongs to current user
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # CRITICAL SECURITY CHECK: Verify ownership
    test_created_by = test.get("created_by")
    if not test_created_by or str(test_created_by).strip() != user_id:
        logger.error(f"[get_test_candidates] SECURITY ISSUE: User {user_id} attempted to access candidates for test {test_id} created by {test_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to view candidates for this test")
    
    candidates = await db.test_candidates.find({"test_id": test_id}).sort("created_at", -1).to_list(length=1000)
    
    result = []
    for candidate in candidates:
        # Get submission status
        submission = await db.test_submissions.find_one({
            "test_id": test_id,
            "user_id": candidate["user_id"]
        })
        
        result.append({
            "candidate_id": str(candidate["_id"]),
            "user_id": candidate["user_id"],
            "name": candidate.get("name", ""),
            "email": candidate.get("email", ""),
            "created_at": candidate.get("created_at").isoformat() if candidate.get("created_at") else None,
            "has_submitted": submission is not None and submission.get("is_completed", False),
            "submission_score": submission.get("score", 0) if submission else 0,
            "submitted_at": submission.get("submitted_at").isoformat() if submission and submission.get("submitted_at") else None,
        })
    
    return result


@router.get("/{test_id}/candidates/{user_id}/analytics")
async def get_candidate_analytics(
    test_id: str,
    user_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get detailed analytics for a candidate including AI feedback (requires authentication and ownership)
    Only test creators can view candidate analytics
    """
    db = get_database()
    # Get current user ID
    current_user_id = current_user.get("id") or current_user.get("_id")
    if not current_user_id:
        logger.error(f"[get_candidate_analytics] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    current_user_id = str(current_user_id).strip()
    
    # Verify test exists and belongs to current user
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # CRITICAL SECURITY CHECK: Verify ownership
    test_created_by = test.get("created_by")
    if not test_created_by or str(test_created_by).strip() != current_user_id:
        logger.error(f"[get_candidate_analytics] SECURITY ISSUE: User {current_user_id} attempted to access analytics for test {test_id} created by {test_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to view analytics for this test")
    if not ObjectId.is_valid(test_id) or not ObjectId.is_valid(user_id):
        raise HTTPException(status_code=400, detail="Invalid test ID or user ID")
    
    # Get candidate info
    candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    
    # Get test submission
    submission = await db.test_submissions.find_one({
        "test_id": test_id,
        "user_id": user_id
    })
    
    if not submission:
        return {
            "candidate": {
                "name": candidate.get("name", ""),
                "email": candidate.get("email", ""),
            },
            "submission": None,
            "question_analytics": []
        }
    
    # Get all submissions for this test
    submission_ids = submission.get("submissions", [])
    question_analytics = []
    
    for sub_id in submission_ids:
        if isinstance(sub_id, ObjectId):
            sub_id_str = str(sub_id)
        else:
            sub_id_str = sub_id
        
        try:
            sub = await db.submissions.find_one({"_id": ObjectId(sub_id_str)})
            if sub:
                # Get question details
                question = await db.questions.find_one({"_id": ObjectId(sub["question_id"])})
                
                question_analytics.append({
                    "question_id": sub["question_id"],
                    "question_title": question.get("title", "Unknown") if question else "Unknown",
                    "language": sub.get("language", ""),
                    "status": sub.get("status", ""),
                    "passed_testcases": sub.get("passed_testcases", 0),
                    "total_testcases": sub.get("total_testcases", 0),
                    "execution_time": sub.get("execution_time"),
                    "memory_used": sub.get("memory_used"),
                    "code": sub.get("code", ""),
                    "test_results": sub.get("test_results", []),
                    "ai_feedback": sub.get("ai_feedback"),
                    "created_at": sub.get("created_at").isoformat() if sub.get("created_at") else None,
                })
        except Exception:
            continue
    
    # Get activity logs
    activity_logs = submission.get("activity_logs", [])
    
    return {
        "candidate": {
            "name": candidate.get("name", ""),
            "email": candidate.get("email", ""),
        },
        "submission": {
            "score": submission.get("score", 0),
            "started_at": submission.get("started_at").isoformat() if submission.get("started_at") else None,
            "submitted_at": submission.get("submitted_at").isoformat() if submission.get("submitted_at") else None,
            "is_completed": submission.get("is_completed", False),
        },
        "question_analytics": question_analytics,
        "activity_logs": activity_logs,
    }


@router.get("/{test_id}/verify-link")
async def verify_test_link(test_id: str, token: str):
    """
    Verify test link token (shared token for all candidates)
    Returns test info if token is valid
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Verify the shared test token
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    if test.get("test_token") != token:
        raise HTTPException(status_code=404, detail="Invalid test link")
    
    if not test.get("is_published", False):
        raise HTTPException(status_code=403, detail="Test is not published")
    
    return {
        "test_id": test_id,
        "test_title": test.get("title", ""),
        "test_description": test.get("description", ""),
        "valid": True
    }


@router.post("/{test_id}/verify-candidate")
async def verify_candidate(
    test_id: str,
    email: str = Query(..., description="Candidate email"),
    name: str = Query(..., description="Candidate name")
):
    """
    Verify candidate email/name and return user_id
    Used with shared test link
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Find candidate by email
    candidate = await db.test_candidates.find_one({
        "test_id": test_id,
        "email": email.strip().lower()
    })
    
    if not candidate:
        raise HTTPException(status_code=404, detail="Email not found in candidate list for this test")
    
    # Verify name matches (case-insensitive)
    if candidate.get("name", "").lower() != name.strip().lower():
        raise HTTPException(status_code=400, detail="Name does not match the email")
    
    return {
        "user_id": candidate["user_id"],
        "name": candidate["name"],
        "email": candidate["email"],
        "test_id": test_id
    }


class PublishTestRequest(BaseModel):
    is_published: bool

@router.patch("/{test_id}/publish")
async def publish_test(
    test_id: str,
    request: PublishTestRequest = Body(...),
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Publish or unpublish a test (requires authentication and ownership)
    When publishing, generates a single shared test token if not already exists
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Check if test exists and belongs to the current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Verify ownership
    test_created_by = test.get("created_by")
    if not test_created_by or str(test_created_by).strip() != user_id.strip():
        logger.error(f"[publish_test] SECURITY ISSUE: User {user_id} attempted to publish/unpublish test {test_id} created by {test_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to publish/unpublish this test")
    
    # Use boolean directly from request body
    is_published_bool = request.is_published
    
    update_data = {"is_published": is_published_bool}
    
    # If publishing and no token exists, generate a shared test token
    if is_published_bool:
        if not test.get("test_token"):
            update_data["test_token"] = secrets.token_urlsafe(32)
    
    result = await db.tests.update_one(
        {"_id": ObjectId(test_id)},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Test not found")
    
    test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Convert ObjectId to string and ensure all fields are JSON serializable
    test_dict = {
        "id": str(test["_id"]),
        "title": test.get("title", ""),
        "description": test.get("description", ""),
        "duration_minutes": test.get("duration_minutes", 0),
        "start_time": test.get("start_time").isoformat() if test.get("start_time") else None,
        "end_time": test.get("end_time").isoformat() if test.get("end_time") else None,
        "is_active": test.get("is_active", False),
        "is_published": test.get("is_published", False),
        "invited_users": test.get("invited_users", []),
        "question_ids": [str(qid) if isinstance(qid, ObjectId) else qid for qid in test.get("question_ids", [])],
        "question_time_limits": test.get("question_time_limits"),
        "test_token": test.get("test_token"),
    }
    return test_dict

@router.delete("/{test_id}")
async def delete_test(
    test_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Delete a test (requires authentication and ownership)
    Note: This will delete the test but not associated submissions or candidate records.
    Consider adding cascade delete if needed.
    """
    db = get_database()
    if not ObjectId.is_valid(test_id):
        raise HTTPException(status_code=400, detail="Invalid test ID")
    
    # Check if test exists and belongs to the current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    existing_test = await db.tests.find_one({"_id": ObjectId(test_id)})
    if not existing_test:
        raise HTTPException(status_code=404, detail="Test not found")
    
    # Verify ownership
    existing_created_by = existing_test.get("created_by")
    if not existing_created_by or str(existing_created_by).strip() != user_id.strip():
        logger.error(f"[delete_test] SECURITY ISSUE: User {user_id} attempted to delete test {test_id} created by {existing_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to delete this test")
    
    result = await db.tests.delete_one({"_id": ObjectId(test_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Test not found")
    
    return {"message": "Test deleted successfully"}

