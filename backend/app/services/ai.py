from __future__ import annotations

import json
from functools import lru_cache
from typing import Any, Dict, List

from fastapi import HTTPException

try:
    from openai import AsyncOpenAI
except ImportError as exc:  # pragma: no cover - optional dependency guard
    raise RuntimeError("The openai package is required. Ensure it is installed.") from exc

from ..core.config import get_settings

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
You are an expert assessment writer. Generate {num_questions} {question_type_label} questions for the topic "{topic}".

QUESTION CONFIGURATION:
{config_list}

IMPORTANT PARAGRAPH REQUIREMENTS BY DIFFICULTY:
{para_requirements_text}

QUESTION STYLE REQUIREMENTS:
1. Generate a MIX of both DIRECT and SCENARIO-BASED questions:
   - Direct questions: Straightforward, concise questions that test knowledge directly
   - Scenario-based questions: Questions embedded in realistic professional contexts or situations
   - Vary the style - some questions should be direct, others should be scenario-based
   - For scenario-based questions: Include realistic context, background, and professional situations
   - For direct questions: Get straight to the point without extensive context

2. Paragraph Length Requirements (STRICT):
   - Easy: Exactly 1 paragraph - short, easy, and concise. {_get_paragraph_requirements("Easy")["length_note"]}
   - Medium: Exactly 2 paragraphs - moderate detail. {_get_paragraph_requirements("Medium")["length_note"]}
   - Hard: Exactly 3 paragraphs - comprehensive detail. {_get_paragraph_requirements("Hard")["length_note"]}

3. Question Quality:
   - Questions must be realistic, professional, and test understanding
   - Make questions engaging and relevant to the topic
   - Ensure questions are appropriate for their specified difficulty level
   - Easy questions should be straightforward and short
   - Medium questions should require moderate thinking and detail
   - Hard questions should be complex and comprehensive

QUESTION FORMAT REQUIREMENTS:
- questionText: Must follow the paragraph requirements above. Use exactly the required number of paragraphs based on difficulty.
- type: Must match the specified type exactly (MCQ, Subjective, Pseudo Code, Descriptive, Aptitude, or Reasoning)
- difficulty: Must match the specified difficulty exactly (Easy, Medium, or Hard)
- idealAnswer: For Subjective/Descriptive questions, provide comprehensive answers (2-3 paragraphs for Medium/Hard, 1-2 for Easy)
- expectedLogic: For Pseudo Code questions, provide detailed logic explanation
- options: For MCQ questions, provide 4-5 realistic options with one correct answer
- correctAnswer: For MCQ questions, specify the correct option (e.g., "A", "B", "C", etc.)

SPECIFIC QUESTION TYPE REQUIREMENTS:
- MCQ: Provide 4-5 plausible options. Options should test deep understanding, not just surface knowledge.
  * For aptitude MCQ questions: Focus on numerical reasoning, logical thinking, verbal ability, or problem-solving skills. 
    Questions should test analytical and reasoning capabilities, not technical knowledge.
    Provide clear, well-structured multiple choice options with one correct answer.
- Subjective: Focus on understanding, analysis, and explanation. Provide comprehensive idealAnswer.
- Pseudo Code: Require logical thinking and algorithm design. Provide detailed expectedLogic.
- Descriptive: Test ability to explain concepts clearly and comprehensively.
- Aptitude: Test numerical, logical, or problem-solving abilities. Can be direct or scenario-based.
- Reasoning: Test logical reasoning, analytical thinking, or pattern recognition. Can be direct or scenario-based.

IMPORTANT FOR APTITUDE QUESTIONS:
- If generating aptitude questions (Quantitative, Logical Reasoning, Verbal Ability, Numerical Reasoning), 
  ALL questions MUST be MCQ format only.
- Aptitude MCQ questions should focus on problem-solving, reasoning, and analytical skills.
- Do NOT generate Subjective, Pseudo Code, or Descriptive questions for aptitude topics.

IMPORTANT: 
- Vary question styles - do NOT make all questions scenario-based
- Some questions should be direct and straightforward
- Some questions should be scenario-based with context
- Follow paragraph requirements STRICTLY based on difficulty level
- Each question must have exactly the number of paragraphs specified for its difficulty

Output a JSON array with {num_questions} question objects. Each question must follow its specific difficulty's paragraph requirements and be either direct or scenario-based.
"""

    client = _get_client()
    try:
        # Calculate tokens based on difficulty levels
        # Easy: 1 paragraph (~200 tokens), Medium: 2 paragraphs (~400 tokens), Hard: 3 paragraphs (~600 tokens)
        # Plus answers: Easy (~200), Medium (~400), Hard (~600)
        max_tokens_per_question = {
            "Easy": 500,   # 1 para question + answer
            "Medium": 900,  # 2 para question + answer
            "Hard": 1400   # 3 para question + answer
        }
        
        # Calculate total tokens needed
        total_tokens = 0
        for qc in question_config:
            total_tokens += max_tokens_per_question.get(qc["difficulty"], 900)
        total_tokens += 500  # Buffer for JSON structure and formatting
        
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
            max_tokens=min(total_tokens, 4000),  # Cap at 4000 tokens
        )
    except Exception as exc:  # pragma: no cover - external API
        raise HTTPException(status_code=500, detail="Failed to generate questions") from exc

    raw = response.choices[0].message.content.strip() if response.choices else ""
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1]
        raw = raw.rsplit("```", 1)[0]

    parsed: Any
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        match = None
        if "[" in raw and "]" in raw:
            match = raw[raw.find("[") : raw.rfind("]") + 1]
        if match:
            try:
                parsed = json.loads(match)
            except json.JSONDecodeError:
                parsed = []
        else:
            parsed = []

    questions: List[Dict[str, Any]] = []
    if isinstance(parsed, list):
        questions = [q for q in parsed if isinstance(q, dict) and q.get("questionText")]
    elif isinstance(parsed, dict):
        data = parsed.get("questions")
        if isinstance(data, list):
            questions = [q for q in data if isinstance(q, dict) and q.get("questionText")]
        elif parsed.get("questionText"):
            questions = [parsed]

    return questions


async def generate_questions_for_topic_safe(topic: str, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    try:
        result = await generate_questions_for_topic(topic, config)
        return result if isinstance(result, list) else []
    except HTTPException:
        raise
    except Exception:  # pragma: no cover - guard for unexpected errors
        return []
