from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.dsa.services.ai_generator import generate_question
from typing import Optional

router = APIRouter()


class GenerateQuestionRequest(BaseModel):
    difficulty: str = "medium"
    topic: Optional[str] = None
    concepts: Optional[str] = None


@router.post("/generate-question")
async def generate_question_endpoint(
    request: GenerateQuestionRequest
):
    """
    Generate a complete coding question using AI (no auth required)
    
    Automatically generates:
    - Title and description
    - Starter code for all 10 DSA languages (Python, JavaScript, TypeScript, C++, Java, C, Go, Rust, Kotlin, C#)
    - Public testcases (at least 3) with inputs and expected outputs
    - Hidden testcases (at least 3) with inputs and expected outputs
    
    Provide topic and/or concepts to guide the generation.
    """
    # All supported DSA languages for question generation
    all_languages = ["python", "javascript", "typescript", "cpp", "java", "c", "go", "rust", "kotlin", "csharp"]
    
    try:
        question_data = await generate_question(
            difficulty=request.difficulty,
            topic=request.topic,
            concepts=request.concepts,
            languages=all_languages
        )
        return question_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

