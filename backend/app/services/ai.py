from __future__ import annotations

import asyncio
import json
import logging
import re
from functools import lru_cache
from typing import Any, Dict, List

from fastapi import HTTPException

try:
    from openai import AsyncOpenAI
except ImportError as exc:  # pragma: no cover - optional dependency guard
    raise RuntimeError("The openai package is required. Ensure it is installed.") from exc

from ..core.config import get_settings

logger = logging.getLogger(__name__)

_enrichment_cache: Dict[str, str] = {}


@lru_cache(maxsize=1)
def _get_client() -> AsyncOpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")
    return AsyncOpenAI(api_key=settings.openai_api_key)


def _get_paragraph_requirements(difficulty: str) -> Dict[str, str]:
    """Get paragraph requirements based on difficulty level."""
    requirements = {
        "Easy": {
            "min_paragraphs": "1",
            "max_paragraphs": "1",
            "description": "within 1 paragraph (short and easy)",
            "length_note": "Keep it concise - exactly 1 paragraph, short and straightforward."
        },
        "Medium": {
            "min_paragraphs": "2",
            "max_paragraphs": "2",
            "description": "above 1 paragraph and within 2 paragraphs",
            "length_note": "Should be more than 1 paragraph but exactly 2 paragraphs total - provide moderate detail."
        },
        "Hard": {
            "min_paragraphs": "3",
            "max_paragraphs": "3",
            "description": "above 2 paragraphs and within 3 paragraphs",
            "length_note": "Should be more than 2 paragraphs but exactly 3 paragraphs total - provide comprehensive detail and complexity."
        }
    }
    return requirements.get(difficulty, requirements["Medium"])


async def generate_topics_from_input(job_role: str, experience: str, skills: List[str], num_topics: int) -> List[str]:
    prompt = f"""
You are an AI assistant that generates technical assessment topics.
Based on:
- Job Role: {job_role}
- Experience Range: {experience}
- Key Skills: {', '.join(skills)}

Generate exactly {num_topics} concise, relevant technical topics.
Output only a simple list (no explanation).
"""

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
    except Exception as exc:  # pragma: no cover - external API
        raise HTTPException(status_code=500, detail="Failed to generate topics") from exc

    text = response.choices[0].message.content.strip() if response.choices else ""
    topics = [line.strip("- ") for line in text.splitlines() if line.strip()]
    topics = [t.split(". ", 1)[-1] if ". " in t else t for t in topics]
    return topics[:num_topics]


async def generate_topic_cards_from_job_designation(job_designation: str) -> List[str]:
    """Generate technology/skill cards from job designation."""
    prompt = f"""
You are an AI assistant that generates relevant technology and skill names for a job designation.
Based on the job designation: {job_designation}

Generate 8-12 relevant technology names, programming languages, frameworks, or tools that are commonly associated with this job role.
Output only a simple list of technology names (no explanation, no numbering, no descriptions).
Each technology should be a single word or short phrase (e.g., "Python", "JavaScript", "React", "Node.js", "HTML", "CSS").
Output only the technology names, one per line.
"""

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
    except Exception as exc:  # pragma: no cover - external API
        raise HTTPException(status_code=500, detail="Failed to generate topic cards") from exc

    text = response.choices[0].message.content.strip() if response.choices else ""
    cards = [line.strip("- ") for line in text.splitlines() if line.strip()]
    cards = [c.split(". ", 1)[-1] if ". " in c else c for c in cards]
    # Filter out empty cards and return unique values
    unique_cards = list(dict.fromkeys([c.strip() for c in cards if c.strip()]))
    return unique_cards[:12]  # Limit to 12 cards


async def generate_topics_from_selected_skills(skills: List[str], experience_min: str, experience_max: str) -> List[str]:
    """Generate topics from multiple selected skills/technologies."""
    if not skills:
        return []
    
    skills_list = ", ".join(skills)
    prompt = f"""
You are an AI assistant that generates assessment topics.
Based on:
- Selected Skills/Technologies: {skills_list}
- Experience Range: {experience_min} to {experience_max} years

Generate 5-8 concise, relevant topics for each selected skill/technology.
If multiple skills are provided, generate topics that cover all of them.
Output only a simple list (no explanation, no numbering).
Each topic should be a single line, starting with "- " or just the topic name.
Make sure topics are specific to the selected skills.
"""

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
    except Exception as exc:  # pragma: no cover - external API
        raise HTTPException(status_code=500, detail="Failed to generate topics") from exc

    text = response.choices[0].message.content.strip() if response.choices else ""
    topics = [line.strip("- ") for line in text.splitlines() if line.strip()]
    topics = [t.split(". ", 1)[-1] if ". " in t else t for t in topics]
    # Filter out empty topics and return
    return [t for t in topics if t.strip()]


async def generate_topics_from_skill(skill: str, experience_min: str, experience_max: str) -> List[str]:
    """Generate topics from a single skill/domain input."""
    prompt = f"""
You are an AI assistant that generates assessment topics.
Based on:
- Skill/Domain: {skill}
- Experience Range: {experience_min} to {experience_max} years

Generate 5-8 concise, relevant topics for this skill/domain.
Output only a simple list (no explanation, no numbering).
Each topic should be a single line, starting with "- " or just the topic name.
"""

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )
    except Exception as exc:  # pragma: no cover - external API
        raise HTTPException(status_code=500, detail="Failed to generate topics") from exc

    text = response.choices[0].message.content.strip() if response.choices else ""
    topics = [line.strip("- ") for line in text.splitlines() if line.strip()]
    topics = [t.split(". ", 1)[-1] if ". " in t else t for t in topics]
    # Filter out empty topics and return
    return [t for t in topics if t.strip()]


async def get_relevant_question_types_from_domain(domain: str) -> List[str]:
    """Determine relevant question types based on domain/designation using AI."""
    if not domain or not domain.strip():
        return ["MCQ", "Subjective", "Descriptive"]
    
    prompt = f"""
You are an AI assistant that determines appropriate question types for assessments.
Based on the domain/designation: "{domain}"

Determine if this domain requires programming/coding skills (like software development, computer science, etc.) or not.

Question types available:
- MCQ: Multiple Choice Questions (suitable for all domains)
- Subjective: Open-ended questions requiring explanation (suitable for all domains)
- Pseudo Code: Algorithm design and logical problem-solving (ONLY for programming/coding domains)
- Descriptive: Detailed explanation questions (suitable for all domains)

Rules:
1. If the domain is related to programming, software development, computer science, coding, algorithms, or software engineering → Include ALL types: MCQ, Subjective, Pseudo Code, Descriptive
2. If the domain is NOT programming-related (e.g., Mechanical Engineering, Civil Engineering, Aptitude, Soft Skills, etc.) → Exclude Pseudo Code: MCQ, Subjective, Descriptive

Respond with ONLY a comma-separated list of question types (e.g., "MCQ, Subjective, Descriptive" or "MCQ, Subjective, Pseudo Code, Descriptive").
Do not include any explanation, just the list.
"""

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,  # Lower temperature for more consistent results
        )
    except Exception as exc:  # pragma: no cover - external API
        # Fallback to safe defaults if AI fails
        logger.warning(f"Failed to get question types from AI, using fallback: {exc}")
        return ["MCQ", "Subjective", "Descriptive"]
    
    text = response.choices[0].message.content.strip() if response.choices else ""
    
    # Parse the response
    question_types = [qt.strip() for qt in text.split(",") if qt.strip()]
    
    # Validate question types
    valid_types = {"MCQ", "Subjective", "Pseudo Code", "Descriptive"}
    filtered_types = [qt for qt in question_types if qt in valid_types]
    
    # If no valid types found, return safe defaults
    if not filtered_types:
        return ["MCQ", "Subjective", "Descriptive"]
    
    return filtered_types


async def get_relevant_question_types(skill: str) -> List[str]:
    """Determine relevant question types based on skill/domain (legacy function for backward compatibility)."""
    # Technical/coding skills that support all types including Pseudo Code
    technical_keywords = [
        "programming", "code", "coding", "developer", "software", "algorithm", 
        "data structure", "python", "java", "javascript", "c++", "c#", "react", 
        "node", "backend", "frontend", "fullstack", "database", "sql", "api",
        "framework", "library", "git", "docker", "kubernetes", "aws", "cloud"
    ]
    
    # Non-technical skills that don't need Pseudo Code
    non_technical_keywords = [
        "softskill", "soft skill", "communication", "leadership", "management",
        "teamwork", "presentation", "negotiation", "sales", "marketing", "hr",
        "human resources", "training", "coaching", "mentoring"
    ]
    
    skill_lower = skill.lower()
    
    # Check if it's a technical skill
    is_technical = any(keyword in skill_lower for keyword in technical_keywords)
    
    # Check if it's explicitly non-technical
    is_non_technical = any(keyword in skill_lower for keyword in non_technical_keywords)
    
    # Default question types
    all_types = ["MCQ", "Subjective", "Pseudo Code", "Descriptive"]
    
    # If it's clearly non-technical, exclude Pseudo Code
    if is_non_technical and not is_technical:
        return ["MCQ", "Subjective", "Descriptive"]
    
    # If it's technical or unclear, include all types
    return all_types


async def generate_questions_for_topic(topic: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    num_questions = config.get("numQuestions")
    if not topic or not num_questions or num_questions <= 0:
        return []

    question_config = []
    for i in range(1, num_questions + 1):
        q_type = config.get(f"Q{i}type", "Subjective")
        difficulty = config.get(f"Q{i}difficulty", "Easy")
        question_config.append({"type": q_type, "difficulty": difficulty})

    # Build detailed configuration list with paragraph requirements
    config_list_parts = []
    for idx, qc in enumerate(question_config):
        para_req = _get_paragraph_requirements(qc["difficulty"])
        config_list_parts.append(
            f"{idx + 1}. {qc['type']} ({qc['difficulty']}) - {para_req['description']}"
        )
    config_list = "; ".join(config_list_parts)

    # Build paragraph requirements description for the prompt
    para_requirements_text = "\n".join([
        f"- {difficulty}: {_get_paragraph_requirements(difficulty)['description']}"
        for difficulty in ["Easy", "Medium", "Hard"]
    ])

    # Determine if this is an aptitude topic based on topic name
    aptitude_topics = ["Quantitative", "Logical Reasoning", "Verbal Ability", "Numerical Reasoning"]
    is_aptitude = any(apt_topic.lower() in topic.lower() for apt_topic in aptitude_topics)
    
    # Check if all questions are MCQ (indicates aptitude)
    all_mcq = all(config.get(f"Q{i}type", "") == "MCQ" for i in range(1, num_questions + 1))
    is_aptitude = is_aptitude or all_mcq
    
    question_type_label = "aptitude" if is_aptitude else "technical"
    
    prompt = f"""
You are an expert assessment writer with years of experience creating high-quality technical and aptitude assessments. 
Generate {num_questions} high-quality {question_type_label} questions for the topic "{topic}".

CRITICAL REQUIREMENTS - READ CAREFULLY:

QUESTION CONFIGURATION:
{config_list}

PARAGRAPH REQUIREMENTS BY DIFFICULTY (STRICT - MUST FOLLOW):
{para_requirements_text}

QUALITY STANDARDS (MANDATORY):
1. **Question Authenticity**: 
   - Questions must be realistic and reflect real-world scenarios or professional contexts
   - Avoid generic or overly simplistic questions
   - Each question should test genuine understanding, not just memorization

2. **Question Variety**:
   - Mix DIRECT questions (straightforward, test core knowledge) with SCENARIO-BASED questions (realistic professional situations)
   - Vary the complexity and approach - do NOT make all questions identical in style
   - Include practical, application-based questions that test problem-solving skills

3. **Difficulty Appropriateness**:
   - Easy: Test fundamental concepts, basic understanding. Questions should be solvable with foundational knowledge.
   - Medium: Require analysis, comparison, or application of concepts. Moderate complexity.
   - Hard: Test deep understanding, complex problem-solving, or advanced concepts. Require critical thinking.

4. **Paragraph Structure (STRICT)**:
   - Easy: EXACTLY 1 paragraph - concise, clear, and to the point
   - Medium: EXACTLY 2 paragraphs - first paragraph sets context, second presents the question
   - Hard: EXACTLY 3 paragraphs - comprehensive context, detailed scenario, and clear question

QUESTION FORMAT REQUIREMENTS:
Each question MUST be a valid JSON object with these exact fields:
- questionText (string): The question text following paragraph requirements above
- type (string): Must match exactly - "MCQ", "Subjective", "Pseudo Code", "Descriptive", "Aptitude", or "Reasoning"
- difficulty (string): Must match exactly - "Easy", "Medium", or "Hard"
- idealAnswer (string, required for Subjective/Descriptive): Comprehensive answer (2-3 paragraphs for Medium/Hard, 1-2 for Easy)
- expectedLogic (string, required for Pseudo Code): Detailed step-by-step logic explanation
- options (array of strings, required for MCQ): Exactly 4-5 realistic, plausible options
- correctAnswer (string, required for MCQ): The correct option letter (e.g., "A", "B", "C", "D", "E")

SPECIFIC QUESTION TYPE REQUIREMENTS:

MCQ Questions:
- Provide exactly 4-5 options (preferably 4 for clarity)
- Options must be plausible and test deep understanding
- Only ONE option should be clearly correct
- Options should be similar in length and structure
- For aptitude: Focus on numerical reasoning, logical thinking, verbal ability, problem-solving
- Avoid obviously wrong options - make all options credible

Subjective Questions:
- Require explanation, analysis, or reasoning
- idealAnswer must be comprehensive and well-structured
- Should test understanding, not just recall
- idealAnswer should be 2-3 paragraphs for Medium/Hard, 1-2 for Easy

Pseudo Code Questions:
- Require algorithm design or logical problem-solving
- expectedLogic must provide detailed step-by-step explanation
- Should test logical thinking and problem-solving approach

Descriptive Questions:
- Test ability to explain concepts clearly
- idealAnswer should be comprehensive and well-organized
- Should demonstrate deep understanding of the topic

Aptitude Questions (if applicable):
- MUST be MCQ format only
- Focus on numerical reasoning, logical thinking, verbal ability, or problem-solving
- Test analytical and reasoning capabilities
- Should be realistic and practical

Reasoning Questions:
- Test logical reasoning, analytical thinking, or pattern recognition
- Can be MCQ or Subjective format
- Should require critical thinking

OUTPUT FORMAT:
You MUST output a valid JSON array containing exactly {num_questions} question objects.
Each question object must be complete with all required fields based on its type.

EXAMPLE STRUCTURE (DO NOT COPY, USE AS REFERENCE):
[
  {{
    "questionText": "Paragraph 1 for context.\\n\\nParagraph 2 with the actual question?",
    "type": "MCQ",
    "difficulty": "Medium",
    "options": ["Option A", "Option B", "Option C", "Option D"],
    "correctAnswer": "B"
  }},
  {{
    "questionText": "Single paragraph question for easy difficulty?",
    "type": "Subjective",
    "difficulty": "Easy",
    "idealAnswer": "Comprehensive answer explaining the concept..."
  }}
]

CRITICAL REMINDERS:
- Generate EXACTLY {num_questions} questions
- Follow paragraph requirements STRICTLY (1 for Easy, 2 for Medium, 3 for Hard)
- Ensure all required fields are present based on question type
- Make questions high-quality, realistic, and professionally relevant
- Vary question styles (mix direct and scenario-based)
- Output ONLY valid JSON - no markdown, no explanations, just the JSON array
"""

    client = _get_client()
    max_retries = 3
    last_error = None
    
    for attempt in range(max_retries):
        try:
            # Calculate tokens based on difficulty levels
            # Easy: 1 paragraph (~200 tokens), Medium: 2 paragraphs (~400 tokens), Hard: 3 paragraphs (~600 tokens)
            # Plus answers: Easy (~200), Medium (~400), Hard (~600)
            max_tokens_per_question = {
                "Easy": 600,   # 1 para question + answer
                "Medium": 1000,  # 2 para question + answer
                "Hard": 1600   # 3 para question + answer
            }
            
            # Calculate total tokens needed
            total_tokens = 0
            for qc in question_config:
                total_tokens += max_tokens_per_question.get(qc["difficulty"], 1000)
            total_tokens += 1000  # Buffer for JSON structure and formatting
            
            # Use gpt-4o-mini for better quality, with higher token limit
            response = await client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": "You are an expert assessment writer. Always output valid JSON arrays. Never include markdown code blocks or explanations outside the JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=min(total_tokens, 8000),  # Increased cap for better quality
            )
            break  # Success, exit retry loop
        except Exception as exc:  # pragma: no cover - external API
            last_error = exc
            if attempt < max_retries - 1:
                # Wait before retry (exponential backoff)
                await asyncio.sleep(2 ** attempt)
                continue
            else:
                raise HTTPException(status_code=500, detail=f"Failed to generate questions after {max_retries} attempts: {str(exc)}") from exc

    raw = response.choices[0].message.content.strip() if response.choices else ""
    
    # Clean up markdown code blocks if present
    if raw.startswith("```json"):
        raw = raw[7:]  # Remove ```json
    elif raw.startswith("```"):
        raw = raw[3:]  # Remove ```
    if raw.endswith("```"):
        raw = raw[:-3]  # Remove trailing ```
    raw = raw.strip()

    parsed: Any = None
    questions: List[Dict[str, Any]] = []
    
    # Try parsing as JSON
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        # Try to extract JSON array from text
        if "[" in raw and "]" in raw:
            start_idx = raw.find("[")
            end_idx = raw.rfind("]") + 1
            try:
                parsed = json.loads(raw[start_idx:end_idx])
            except json.JSONDecodeError:
                pass
    
    # Parse the result
    if parsed is None:
        # Last resort: try to find and parse individual question objects
        json_objects = re.findall(r'\{[^{}]*"questionText"[^{}]*\}', raw, re.DOTALL)
        for obj_str in json_objects:
            try:
                obj = json.loads(obj_str)
                if isinstance(obj, dict) and obj.get("questionText"):
                    questions.append(obj)
            except json.JSONDecodeError:
                continue
    elif isinstance(parsed, list):
        questions = [q for q in parsed if isinstance(q, dict) and q.get("questionText")]
    elif isinstance(parsed, dict):
        # Check if it's a wrapper object
        if "questions" in parsed and isinstance(parsed["questions"], list):
            questions = [q for q in parsed["questions"] if isinstance(q, dict) and q.get("questionText")]
        elif parsed.get("questionText"):
            questions = [parsed]
        # Check for array-like structure in values
        elif any(isinstance(v, list) for v in parsed.values()):
            for v in parsed.values():
                if isinstance(v, list):
                    questions.extend([q for q in v if isinstance(q, dict) and q.get("questionText")])
                    break

    # Validate and clean questions
    validated_questions = []
    for q in questions:
        if not isinstance(q, dict):
            continue
        if not q.get("questionText"):
            continue
        
        # Ensure required fields based on type
        q_type = q.get("type", "").strip()
        q["type"] = q_type
        q["difficulty"] = q.get("difficulty", "Medium").strip()
        
        # Validate MCQ questions have options and correctAnswer
        if q_type == "MCQ":
            if not q.get("options") or not isinstance(q.get("options"), list) or len(q.get("options", [])) < 2:
                continue  # Skip invalid MCQ
            if not q.get("correctAnswer"):
                # Try to infer from options
                if q.get("options"):
                    q["correctAnswer"] = "A"  # Default to first option
                else:
                    continue
        
        # Validate Subjective/Descriptive have idealAnswer
        if q_type in ["Subjective", "Descriptive"]:
            if not q.get("idealAnswer"):
                q["idealAnswer"] = "Answer not provided."
        
        # Validate Pseudo Code has expectedLogic
        if q_type == "Pseudo Code":
            if not q.get("expectedLogic"):
                q["expectedLogic"] = "Logic explanation not provided."
        
        validated_questions.append(q)
    
    return validated_questions


async def generate_questions_for_topic_safe(topic: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    try:
        result = await generate_questions_for_topic(topic, config)
        return result if isinstance(result, list) else []
    except HTTPException:
        raise
    except Exception:  # pragma: no cover - guard for unexpected errors
        return []
