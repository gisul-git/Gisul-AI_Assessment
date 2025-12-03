from fastapi import APIRouter, HTTPException, Query, Depends
from typing import List, Optional
from datetime import datetime
from bson import ObjectId
from app.dsa.database import get_dsa_database as get_database
from app.dsa.models.question import Question, QuestionCreate, QuestionUpdate

router = APIRouter()

@router.get("/", response_model=List[dict])
async def get_questions(
    skip: int = 0, 
    limit: int = 100,
    published_only: Optional[bool] = Query(None, description="Filter by published status. If None, returns all (for admin)")
):
    """
    Get questions list
    - published_only=True: Only return published questions (for users)
    - published_only=False: Only return unpublished questions
    - published_only=None: Return all questions (for admin)
    """
    db = get_database()
    query = {}
    
    # Filter by published status if specified
    if published_only is not None:
        query["is_published"] = published_only
    
    questions = await db.questions.find(query).skip(skip).limit(limit).to_list(length=limit)
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
async def get_question(question_id: str):
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
    question = await db.questions.find_one({"_id": ObjectId(question_id)})
    if not question:
        raise HTTPException(status_code=404, detail="Question not found")
    
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
async def create_question(question: QuestionCreate):
    """
    Create a new question (no auth required)
    """
    db = get_database()
    question_dict = question.model_dump()
    result = await db.questions.insert_one(question_dict)
    
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
    question_update: QuestionUpdate
):
    """
    Update a question (no auth required)
    """
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
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
    is_published: bool = Query(..., description="Set publish status")
):
    """
    Toggle publish status of a question (no auth required)
    """
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
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
async def delete_question(question_id: str):
    """
    Delete a question (no auth required)
    """
    db = get_database()
    if not ObjectId.is_valid(question_id):
        raise HTTPException(status_code=400, detail="Invalid question ID")
    
    result = await db.questions.delete_one({"_id": ObjectId(question_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Question not found")
    
    return {"message": "Question deleted successfully"}

