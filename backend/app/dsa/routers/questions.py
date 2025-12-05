from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Optional, Dict, Any
from datetime import datetime
from bson import ObjectId
import logging
from app.dsa.database import get_dsa_database as get_database
from app.dsa.models.question import Question, QuestionCreate, QuestionUpdate
from app.core.dependencies import get_current_user, require_editor

logger = logging.getLogger("backend")
router = APIRouter()

@router.get("/", response_model=List[dict])
async def get_questions(
    skip: int = 0, 
    limit: int = 1000,  # Increased limit to show all questions
    published_only: Optional[bool] = Query(None, description="Filter by published status. If None, returns all questions for the user"),
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get questions list for the current user (requires authentication)
    Only returns questions created by the current user
    - published_only=True: Only return published questions
    - published_only=False: Only return unpublished questions
    - published_only=None: Return all questions created by the user (both published and unpublished)
    """
    db = get_database()
    # Filter questions by the current user - STRICT: only return questions with created_by matching current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[get_questions] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()  # Ensure no whitespace
    
    logger.info(f"[get_questions] Fetching questions for user_id: '{user_id}' (type: {type(user_id).__name__})")
    logger.info(f"[get_questions] Current user data: id={current_user.get('id')}, _id={current_user.get('_id')}, email={current_user.get('email')}")
    
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
    
    # Filter by published status if specified
    # If published_only is None, don't add the filter - return all questions for the user (both published and unpublished)
    if published_only is not None:
        base_conditions.append({"is_published": published_only})
    
    query = {"$and": base_conditions}
    
    logger.info(f"[get_questions] STRICT MongoDB query: {query}")
    logger.info(f"[get_questions] Query will ONLY match questions where created_by exists, is not null, is not empty, and equals '{user_id_normalized}'")
    logger.info(f"[get_questions] User ID type: {type(user_id).__name__}, normalized: '{user_id_normalized}'")
    
    logger.info(f"[get_questions] MongoDB query: {query}")
    
    # Sort by created_at descending to show newest first
    questions_cursor = db.questions.find(query)
    questions = await questions_cursor.sort("created_at", -1).skip(skip).limit(limit).to_list(length=limit)
    
    logger.info(f"[get_questions] Found {len(questions)} questions in database for user_id: {user_id}")
    
    # CRITICAL SECURITY CHECK: Additional client-side filter as defense in depth
    # This is a FINAL safety net - filter out ANY question that doesn't match exactly
    questions_before_filter = len(questions)
    filtered_questions = []
    for q in questions:
        q_created_by = q.get("created_by")
        q_id = str(q.get("_id", ""))
        q_title = q.get("title", "Unknown")
        
        # ABSOLUTE STRICT CHECK: Reject if created_by is missing, null, empty, or doesn't match
        if q_created_by is None:
            logger.error(f"[get_questions] SECURITY VIOLATION: Question {q_id} ({q_title}) has NULL created_by - REJECTING")
            continue
        
        if q_created_by == "":
            logger.error(f"[get_questions] SECURITY VIOLATION: Question {q_id} ({q_title}) has EMPTY created_by - REJECTING")
            continue
        
        # Normalize both sides to string for comparison (handles ObjectId vs string mismatch)
        q_created_by_str = str(q_created_by).strip()
        # Use the already normalized user_id from above
        if q_created_by_str != user_id_normalized:
            logger.error(f"[get_questions] SECURITY VIOLATION: Question {q_id} ({q_title}) created_by='{q_created_by_str}' != user_id='{user_id_normalized}' - REJECTING")
            continue
        
        # Only add if it passes all checks
        filtered_questions.append(q)
    
    questions = filtered_questions
    
    if questions_before_filter != len(questions):
        logger.error(f"[get_questions] SECURITY: Filtered out {questions_before_filter - len(questions)} questions that didn't match user_id - this should not happen if query is correct")
    
    # Final verification log
    logger.info(f"[get_questions] Returning {len(questions)} questions for user_id: {user_id}")
    
    result = []
    for q in questions:
        question_dict = {
            "id": str(q["_id"]),
            "title": q.get("title", ""),
            "description": q.get("description", ""),
            "difficulty": q.get("difficulty", ""),
            "languages": q.get("languages", []),
            "starter_code": q.get("starter_code", {}),
            "public_testcases": q.get("public_testcases", []),
            "hidden_testcases": q.get("hidden_testcases", []),
            "is_published": q.get("is_published", False),
        }
        if "function_signature" in q and q.get("function_signature"):
            question_dict["function_signature"] = q["function_signature"]
        if "created_at" in q:
            question_dict["created_at"] = q["created_at"].isoformat() if isinstance(q.get("created_at"), datetime) else q.get("created_at")
        if "updated_at" in q:
            question_dict["updated_at"] = q["updated_at"].isoformat() if isinstance(q.get("updated_at"), datetime) else q.get("updated_at")
        result.append(question_dict)
    return result

@router.get("/{question_id}", response_model=dict)
async def get_question(
    question_id: str,
    current_user: Dict[str, Any] = Depends(get_current_user)
):
    """
    Get a specific question (requires authentication and ownership)
    """
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[get_question] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()
    
    logger.info(f"[get_question] Fetching question {question_id} for user_id: '{user_id}'")
    
    question = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    # CRITICAL SECURITY CHECK: Verify ownership
    question_created_by = question.get("created_by")
    if not question_created_by:
        logger.warning(f"[get_question] SECURITY: Question {question_id} has no created_by field")
        raise HTTPException(status_code=403, detail="You don't have permission to access this question")
    
    if str(question_created_by).strip() != user_id.strip():
        logger.error(f"[get_question] SECURITY ISSUE: User {user_id} attempted to access question {question_id} created by {question_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to access this question")
    
    logger.info(f"[get_question] Question {question_id} access granted to user {user_id}")
    
    # Convert ObjectId and datetime fields to JSON-serializable formats
    question_dict = {
        "id": str(question["_id"]),
        "title": question.get("title", ""),
        "description": question.get("description", ""),
        "difficulty": question.get("difficulty", ""),
        "languages": question.get("languages", []),
        "starter_code": question.get("starter_code", {}),
        "public_testcases": question.get("public_testcases", []),
        "hidden_testcases": question.get("hidden_testcases", []),
        "is_published": question.get("is_published", False),
    }
    
    # Add function_signature if it exists
    if "function_signature" in question and question.get("function_signature"):
        question_dict["function_signature"] = question["function_signature"]
    
    # Add optional fields if they exist
    if "created_at" in question:
        question_dict["created_at"] = question["created_at"].isoformat() if isinstance(question.get("created_at"), datetime) else question.get("created_at")
    if "updated_at" in question:
        question_dict["updated_at"] = question["updated_at"].isoformat() if isinstance(question.get("updated_at"), datetime) else question.get("updated_at")
    
    return question_dict

@router.post("/", response_model=dict)
async def create_question(
    question: QuestionCreate,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Create a new question (requires authentication)
    """
    db = get_database()
    question_dict = question.model_dump()
    # Store the actual user ID who created the question
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        logger.error(f"[create_question] Invalid user ID in current_user: {list(current_user.keys())}")
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id).strip()  # Ensure no whitespace
    question_dict["created_by"] = user_id
    
    logger.info(f"[create_question] Creating question with created_by={user_id}, title={question_dict.get('title')}")
    
    result = await db.questions.insert_one(question_dict)
    
    # Verify the question was created with correct created_by
    created_question_check = await db.questions.find_one({"_id": result.inserted_id})
    if created_question_check:
        actual_created_by = created_question_check.get("created_by")
        if actual_created_by != user_id:
            logger.error(f"[create_question] SECURITY ISSUE: Question created with created_by={actual_created_by} but expected {user_id}")
        else:
            logger.info(f"[create_question] Question created successfully with created_by={actual_created_by}")
    
    # Fetch the created question to return it
    created_question = await db.questions.find_one({"_id": result.inserted_id})
    if created_question:
        question_dict = {
            "id": str(created_question["_id"]),
            "title": created_question.get("title", ""),
            "description": created_question.get("description", ""),
            "difficulty": created_question.get("difficulty", ""),
            "languages": created_question.get("languages", []),
            "starter_code": created_question.get("starter_code", {}),
            "public_testcases": created_question.get("public_testcases", []),
            "hidden_testcases": created_question.get("hidden_testcases", []),
            "is_published": created_question.get("is_published", False),
        }
        if "function_signature" in created_question and created_question.get("function_signature"):
            question_dict["function_signature"] = created_question["function_signature"]
        if "created_at" in created_question:
            question_dict["created_at"] = created_question["created_at"].isoformat() if isinstance(created_question.get("created_at"), datetime) else created_question.get("created_at")
        if "updated_at" in created_question:
            question_dict["updated_at"] = created_question["updated_at"].isoformat() if isinstance(created_question.get("updated_at"), datetime) else created_question.get("updated_at")
        return question_dict
    
    # Fallback if fetch fails
    question_dict["id"] = str(result.inserted_id)
    if "created_at" in question_dict and isinstance(question_dict.get("created_at"), datetime):
        question_dict["created_at"] = question_dict["created_at"].isoformat()
    return question_dict

@router.put("/{question_id}", response_model=dict)
async def update_question(
    question_id: str, 
    question_update: QuestionUpdate,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Update a question (requires authentication and ownership)
    """
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
    # Check if question exists and belongs to the current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    existing_question = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not existing_question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    # Verify ownership
    existing_created_by = existing_question.get("created_by")
    if not existing_created_by or str(existing_created_by).strip() != user_id.strip():
        logger.error(f"[update_question] SECURITY ISSUE: User {user_id} attempted to update question {question_id} created by {existing_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to update this question")
    
    update_data = {k: v for k, v in question_update.model_dump().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")
    
    update_data["updated_at"] = datetime.utcnow()
    
    result = await db.questions.update_one(
        {"_id": ObjectId(question_id)},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    
    question = await db.questions.find_one({"_id": ObjectId(question_id)})
    question_dict = {
        "id": str(question["_id"]),
        "title": question.get("title", ""),
        "description": question.get("description", ""),
        "difficulty": question.get("difficulty", ""),
        "languages": question.get("languages", []),
        "starter_code": question.get("starter_code", {}),
        "public_testcases": question.get("public_testcases", []),
        "hidden_testcases": question.get("hidden_testcases", []),
        "is_published": question.get("is_published", False),
    }
    if "function_signature" in question and question.get("function_signature"):
        question_dict["function_signature"] = question["function_signature"]
    if "created_at" in question:
        question_dict["created_at"] = question["created_at"].isoformat() if isinstance(question.get("created_at"), datetime) else question.get("created_at")
    if "updated_at" in question:
        question_dict["updated_at"] = question["updated_at"].isoformat() if isinstance(question.get("updated_at"), datetime) else question.get("updated_at")
    return question_dict

@router.patch("/{question_id}/publish", response_model=dict)
async def toggle_publish_question(
    question_id: str, 
    is_published: bool = Query(..., description="Set publish status"),
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Toggle publish status of a question (requires authentication and ownership)
    """
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
    # Check if question exists and belongs to the current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    existing_question = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not existing_question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    # Verify ownership
    existing_created_by = existing_question.get("created_by")
    if not existing_created_by or str(existing_created_by).strip() != user_id.strip():
        logger.error(f"[toggle_publish_question] SECURITY ISSUE: User {user_id} attempted to publish/unpublish question {question_id} created by {existing_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to publish/unpublish this question")
    
    result = await db.questions.update_one(
        {"_id": ObjectId(question_id)},
        {"$set": {"is_published": is_published, "updated_at": datetime.utcnow()}}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    
    question = await db.questions.find_one({"_id": ObjectId(question_id)})
    question_dict = {
        "id": str(question["_id"]),
        "title": question.get("title", ""),
        "description": question.get("description", ""),
        "difficulty": question.get("difficulty", ""),
        "languages": question.get("languages", []),
        "starter_code": question.get("starter_code", {}),
        "public_testcases": question.get("public_testcases", []),
        "hidden_testcases": question.get("hidden_testcases", []),
        "is_published": question.get("is_published", False),
    }
    if "function_signature" in question and question.get("function_signature"):
        question_dict["function_signature"] = question["function_signature"]
    if "created_at" in question:
        question_dict["created_at"] = question["created_at"].isoformat() if isinstance(question.get("created_at"), datetime) else question.get("created_at")
    if "updated_at" in question:
        question_dict["updated_at"] = question["updated_at"].isoformat() if isinstance(question.get("updated_at"), datetime) else question.get("updated_at")
    return question_dict

@router.delete("/{question_id}")
async def delete_question(
    question_id: str,
    current_user: Dict[str, Any] = Depends(require_editor)
):
    """
    Delete a question (requires authentication and ownership)
    """
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
    # Check if question exists and belongs to the current user
    user_id = current_user.get("id") or current_user.get("_id")
    if not user_id:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    user_id = str(user_id)
    existing_question = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not existing_question:
        raise HTTPException(status_code=404, detail="Question not found")
    
    # Verify ownership
    existing_created_by = existing_question.get("created_by")
    if not existing_created_by or str(existing_created_by).strip() != user_id.strip():
        logger.error(f"[delete_question] SECURITY ISSUE: User {user_id} attempted to delete question {question_id} created by {existing_created_by}")
        raise HTTPException(status_code=403, detail="You don't have permission to delete this question")
    
    result = await db.questions.delete_one({"_id": ObjectId(question_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    
    return {"message": "Question deleted successfully"}

