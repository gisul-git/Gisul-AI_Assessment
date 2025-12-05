from __future__ import annotations

import asyncio
import json
import logging
import re
from difflib import SequenceMatcher
from functools import lru_cache
from typing import Any, Dict, List

from fastapi import HTTPException

try:
    from openai import AsyncOpenAI
    # Import OpenAI exception types - available in openai>=1.0.0
    try:
        from openai import RateLimitError, APIError, APIConnectionError, AuthenticationError
    except ImportError:
        # For older versions, these exceptions might not exist
        # We'll handle errors by checking error messages instead
        RateLimitError = None
        APIError = None
        APIConnectionError = None
        AuthenticationError = None
except ImportError as exc:  # pragma: no cover - optional dependency guard
    raise RuntimeError("The openai package is required. Ensure it is installed.") from exc

from ..core.config import get_settings

logger = logging.getLogger(__name__)

_enrichment_cache: Dict[str, str] = {}


@lru_cache(maxsize=1)
def _get_client() -> AsyncOpenAI:
    settings = get_settings()
    if not settings.openai_api_key:
        raise ValueError("OpenAI API key not configured. Please set OPENAI_API_KEY in your environment variables.")
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


async def generate_topic_cards_from_job_designation(
    job_designation: str, 
    experience_min: int = 0, 
    experience_max: int = 10
) -> List[str]:
    """Generate technology/skill cards from job designation and experience range."""
    experience_level = ""
    if experience_min == 0 and experience_max <= 2:
        experience_level = "entry-level/junior"
    elif experience_min <= 2 and experience_max <= 5:
        experience_level = "mid-level"
    elif experience_min <= 5 and experience_max <= 10:
        experience_level = "senior-level"
    else:
        experience_level = "expert/lead-level"
    
    # Determine specific experience-based guidance
    experience_guidance = ""
    if experience_level == "entry-level/junior":
        experience_guidance = """For entry-level positions (0-2 years), focus on ROLE-SPECIFIC fundamental skills:
        - Include the PRIMARY technology/language mentioned in the job designation (e.g., for "Java Developer" include Java, Spring, Maven, etc.)
        - Include essential tools and frameworks directly related to the role
        - Include fundamental concepts specific to that technology stack
        - DO NOT include unrelated technologies (e.g., don't include Python/HTML/CSS for a Java Developer role unless it's a full-stack role)
        - Only include technologies that are directly relevant to the specific job designation"""
    elif experience_level == "mid-level":
        experience_guidance = "Include role-specific technologies AND related intermediate-level frameworks, tools, and libraries. Focus on technologies actually used in this specific role, not general programming skills."
    elif experience_level == "senior-level":
        experience_guidance = "Include advanced role-specific technologies, architectural patterns, enterprise tools, cloud platforms, and DevOps tools relevant to this specific role."
    else:
        experience_guidance = "Include cutting-edge role-specific technologies, advanced architectural patterns, enterprise solutions, and technologies for building large-scale systems in this domain."
    
    prompt = f"""You are an expert technical recruiter and technology consultant. Generate highly relevant technology and skill names specifically for the given job designation and experience level.

Job Designation: {job_designation}
Experience Range: {experience_min}-{experience_max} years ({experience_level})

CRITICAL REQUIREMENTS:
1. Technologies MUST be DIRECTLY and SPECIFICALLY relevant to "{job_designation}" - only include technologies actually used in this EXACT role
2. DO NOT include unrelated technologies. For example:
   - For "Java Developer": Include Java, Spring, Maven, Hibernate, JUnit, etc. DO NOT include Python, HTML, CSS, JavaScript unless it's explicitly a full-stack Java role
   - For "Python Developer": Include Python, Django/Flask, NumPy, Pandas, etc. DO NOT include Java, C++, etc. unless explicitly required
   - For "Frontend Developer": Include React, Vue, Angular, HTML, CSS, JavaScript. DO NOT include backend languages like Java, Python unless it's full-stack
3. Match the experience level: {experience_guidance}
4. For entry-level (0-2 years): Include role-specific fundamentals:
   - The primary technology/language of the role
   - Essential frameworks and tools for that technology stack
   - Basic concepts specific to that stack
   - DO NOT include unrelated general programming languages or tools
5. For mid-level (2-5 years): Include role-specific intermediate frameworks, popular libraries, and common tools in that specific domain
6. For senior-level (5-10 years): Include advanced role-specific frameworks, architectural patterns, cloud services, DevOps tools for that stack
7. For expert-level (10+ years): Include cutting-edge technologies, enterprise solutions, and advanced architectures in that specific domain

OUTPUT FORMAT:
- Generate exactly 8-12 technology names
- Each technology should be a single word or short phrase (max 2-3 words)
- Use standard, widely-recognized technology names
- Output ONLY the technology names, one per line
- No explanations, numbering, or descriptions
- No duplicates
- ALL technologies must be directly relevant to "{job_designation}"

Generate technologies now:"""

    try:
        client = _get_client()
    except ValueError as exc:
        # API key not configured
        logger.error(f"OpenAI API key not configured: {exc}")
        raise HTTPException(status_code=500, detail="OpenAI API key not configured. Please contact the administrator.") from exc
    
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """You are an expert technical recruiter who understands job roles, required technologies, and how experience levels affect technology choices. 
                    CRITICAL RULES:
                    1. Generate ONLY technologies that are DIRECTLY relevant to the specific job designation
                    2. DO NOT include unrelated technologies (e.g., don't include Python/HTML/CSS for a Java Developer role)
                    3. Focus on role-specific technologies, frameworks, and tools
                    4. For entry-level: Include role-specific fundamentals, not general programming skills
                    5. Match technologies to the exact job role, not general programming
                    Generate only technology names, one per line."""
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.5,  # Lower temperature for more consistent, focused results
        )
    except Exception as exc:
        # Check if this is a RateLimitError (quota/rate limit)
        is_rate_limit = False
        if RateLimitError is not None:
            is_rate_limit = isinstance(exc, RateLimitError)
        else:
            # Fallback: check error message or class name
            error_class_name = exc.__class__.__name__
            error_msg = str(exc)
            is_rate_limit = (
                'RateLimitError' in error_class_name or
                'rate limit' in error_msg.lower() or
                '429' in error_msg or
                'quota' in error_msg.lower()
            )
        
        if is_rate_limit:
            # Handle quota/rate limit errors specifically
            error_msg = str(exc)
            error_type = None
            error_code = None
            
            # Try to extract error details from the exception
            try:
                if hasattr(exc, 'response') and exc.response:
                    error_body = exc.response.get('error', {}) if isinstance(exc.response, dict) else {}
                    error_type = error_body.get('type', '')
                    error_code = error_body.get('code', '')
            except Exception:
                pass
            
            # Check for quota errors in error message or error details
            if (error_type == 'insufficient_quota' or 
                error_code == 'insufficient_quota' or 
                'quota' in error_msg.lower() or 
                'insufficient_quota' in error_msg.lower()):
                logger.error(f"OpenAI API quota exceeded: {exc}")
                raise HTTPException(
                    status_code=503,
                    detail="OpenAI API quota exceeded. Please check your OpenAI account billing and plan. The service is temporarily unavailable."
                ) from exc
            else:
                logger.error(f"OpenAI API rate limit error: {exc}")
                raise HTTPException(
                    status_code=503,
                    detail="OpenAI API rate limit exceeded. Please try again in a few moments."
                ) from exc
        
        # Check if this is an AuthenticationError
        is_auth_error = False
        if AuthenticationError is not None:
            is_auth_error = isinstance(exc, AuthenticationError)
        else:
            error_msg = str(exc)
            error_class_name = exc.__class__.__name__
            is_auth_error = (
                'AuthenticationError' in error_class_name or
                'api key' in error_msg.lower() or
                'authentication' in error_msg.lower() or
                '401' in error_msg
            )
        
        if is_auth_error:
            logger.error(f"OpenAI API authentication failed: {exc}")
            raise HTTPException(
                status_code=500,
                detail="OpenAI API authentication failed. Please check API key configuration."
            ) from exc
        
        # Check if this is an APIConnectionError
        is_conn_error = False
        if APIConnectionError is not None:
            is_conn_error = isinstance(exc, APIConnectionError)
        else:
            error_msg = str(exc)
            error_class_name = exc.__class__.__name__
            is_conn_error = (
                'APIConnectionError' in error_class_name or
                'connection' in error_msg.lower() or
                'timeout' in error_msg.lower()
            )
        
        if is_conn_error:
            logger.error(f"OpenAI API connection error: {exc}")
            raise HTTPException(
                status_code=503,
                detail="Failed to connect to OpenAI API. Please try again later."
            ) from exc
        
        # Check if this is a general APIError
        is_api_error = False
        if APIError is not None:
            is_api_error = isinstance(exc, APIError)
        
        if is_api_error:
            logger.error(f"OpenAI API error: {exc}", exc_info=True)
            error_msg = str(exc)
            raise HTTPException(
                status_code=500,
                detail=f"OpenAI API error: {error_msg}"
            ) from exc
        
        # If we get here, it's an unexpected error
        logger.error(f"Unexpected error calling OpenAI API: {exc}", exc_info=True)
        error_msg = str(exc)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate topic cards: {error_msg}"
        ) from exc

    text = response.choices[0].message.content.strip() if response.choices else ""
    if not text:
        logger.warning("OpenAI API returned empty response")
        raise HTTPException(status_code=500, detail="OpenAI API returned an empty response. Please try again.")
    
    # Parse the response - handle various formats and filter out non-technology entries
    cards = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        
        # Remove common prefixes and formatting
        line = line.strip("- •*")
        # Remove numbering (e.g., "1. Python" -> "Python")
        if ". " in line and (line[0].isdigit() or line.startswith("(")):
            line = line.split(". ", 1)[-1]
        # Remove any remaining numbering patterns
        line = line.lstrip("0123456789. )")
        line = line.strip()
        
        # Filter out non-technology entries (explanations, descriptions, etc.)
        if line and len(line) < 50:  # Technology names should be short
            # Skip lines that look like explanations or descriptions
            skip_keywords = ["example", "include", "such as", "like", "typically", "usually", "common", "focus on", "consider"]
            if not any(keyword in line.lower() for keyword in skip_keywords):
                cards.append(line)
    
    # Remove duplicates while preserving order, and filter out empty strings
    unique_cards = []
    seen = set()
    for card in cards:
        card_clean = card.strip()
        if card_clean and card_clean.lower() not in seen:
            seen.add(card_clean.lower())
            unique_cards.append(card_clean)
    
    # Limit to 12 cards max
    unique_cards = unique_cards[:12]
    
    if not unique_cards:
        logger.warning("No topic cards generated from OpenAI response")
        raise HTTPException(status_code=500, detail="Failed to parse topic cards from AI response. Please try again.")
    
    return unique_cards[:12]  # Limit to 12 cards


async def determine_topic_coding_support(topic: str) -> bool:
    """
    Determine if a topic supports coding based on Judge0 capabilities.
    
    STRICT VALIDATION: Returns True ONLY if the topic can actually be executed by Judge0.
    Topics that mention coding but can't be executed (e.g., React concepts, UI/UX, frameworks)
    will return False.
    
    Returns True if the topic relates to executable code that Judge0 can run.
    Returns False for theory-only topics, design topics, frameworks, or topics that
    don't involve executable code that Judge0 can validate.
    """
    # Judge0-supported languages (must be executable by Judge0)
    judge0_languages = [
        "c", "c++", "cpp", "java", "python", "javascript", "typescript", "php", "ruby",
        "swift", "go", "kotlin", "rust", "sql", "csharp", "c#", "vb.net", "vbnet",
        "bash", "lua", "perl", "r", "haskell", "prolog", "ocaml", "scala", "groovy",
        "f#", "fsharp", "scheme", "assembly", "pascal", "fortran", "cobol", "erlang",
        "elixir", "clojure", "lisp", "node.js", "nodejs"
    ]
    
    # Topics that support executable coding (can be validated by Judge0)
    executable_coding_keywords = [
        "data structures", "algorithms", "dsa", "competitive programming", "problem solving",
        "array", "linked list", "tree", "graph", "dynamic programming", "dp", "sorting", "searching",
        "recursion", "backtracking", "greedy", "binary search", "hash", "stack", "queue",
        "heap", "trie", "graph algorithms", "string algorithms", "number theory",
        "oop", "object oriented", "object-oriented", "programming", "coding", "code",
        "sql", "queries", "database queries", "scripting", "automation",
        "inheritance", "polymorphism", "encapsulation", "abstraction", "classes", "objects",
        "object oriented programming", "object-oriented programming"
    ]
    
    # Topics that do NOT support Judge0 execution (STRICT list)
    non_executable_keywords = [
        # Framework/library concepts (not executable standalone)
        "react", "angular", "vue", "django", "flask", "express", "spring", "laravel",
        "framework", "library", "npm", "package", "dependency",
        # UI/UX and design
        "ui/ux", "ui ux", "user interface", "user experience", "design", "graphic design",
        "frontend design", "web design", "responsive design", "css", "html", "styling",
        # Theory and concepts
        "theory", "concept", "principles", "fundamentals", "basics", "overview",
        "architecture", "design pattern", "methodology", "best practices",
        # Non-executable domains
        "hr", "human resources", "soft skills", "communication", "aptitude", "reasoning",
        "verbal", "quantitative", "logical reasoning", "numerical reasoning",
        # GUI and application development (not executable by Judge0)
        "swing", "gui", "graphical user interface", "application development",
        "full application", "file io", "file i/o", "local files", "file system",
        "operating system theory", "os theory", "dbms theory", "database theory",
        "computer networks theory", "cn theory", "network theory",
        # DevOps and infrastructure (not executable code)
        "devops", "docker", "kubernetes", "ci/cd", "deployment", "infrastructure",
        "aws", "cloud", "azure", "gcp", "terraform", "ansible",
        # Testing frameworks (not executable standalone)
        "jest", "mocha", "junit", "pytest", "testing framework",
        # Version control and tools
        "git", "github", "gitlab", "version control"
    ]
    
    topic_lower = topic.lower().strip()
    
    # STRICT CHECK: If topic contains non-executable keywords, return False immediately
    # (unless it explicitly mentions a Judge0 language for execution)
    for non_kw in non_executable_keywords:
        if non_kw in topic_lower:
            # Exception: if topic explicitly mentions a Judge0 language for coding/execution
            # e.g., "Python programming" or "Java coding" - these support execution
            has_executable_lang = any(
                lang in topic_lower and (
                    "programming" in topic_lower or 
                    "coding" in topic_lower or 
                    "code" in topic_lower or
                    "algorithm" in topic_lower or
                    "dsa" in topic_lower
                )
                for lang in judge0_languages
            )
            if not has_executable_lang:
                return False
    
    # Check for Judge0 language names with execution context
    for lang in judge0_languages:
        if lang in topic_lower:
            # Double-check: if it's explicitly theory-only or non-executable, skip
            if any(non_kw in topic_lower for non_kw in [
                "theory only", "theory-only", "pure theory", "concepts only",
                "framework", "library", "ui", "ux", "design"
            ]):
                # But allow if it's about programming/execution
                if "programming" in topic_lower or "coding" in topic_lower or "code" in topic_lower:
                    return True
                continue
            return True
    
    # Check for executable coding keywords (only if no non-executable keywords found)
    for keyword in executable_coding_keywords:
        if keyword in topic_lower:
            return True
    
    # Use AI for strict validation (fallback for ambiguous cases)
    try:
        client = _get_client()
        prompt = f"""Determine if the topic "{topic}" supports coding questions that can be EXECUTED and VALIDATED by Judge0.

Judge0 can execute code in: C, C++, Java, Python, JavaScript, TypeScript, PHP, Ruby, Swift, Go, Kotlin, Rust, C#, SQL, Bash, Lua, Perl, R, Haskell, Prolog, OCaml, Scala, Groovy, F#, Scheme, Assembly, etc.

CRITICAL: Only return "true" if the topic involves writing EXECUTABLE CODE that Judge0 can run and validate.

Topics that support coding (executable by Judge0):
- Data Structures & Algorithms (arrays, trees, graphs, etc.)
- Programming language fundamentals (Java programming, Python coding, C++ algorithms)
- OOP concepts with code execution (Java OOP, Python classes)
- Problem-solving / Competitive coding / DSA
- SQL queries and database programming
- Scripting and automation with executable code

Topics that do NOT support coding (NOT executable by Judge0):
- Framework/library concepts (React, Angular, Django, Spring) - these are not executable standalone
- UI/UX, design, CSS, HTML styling
- Theory subjects (OS theory, DBMS theory, CN theory)
- DevOps, Docker, Kubernetes, CI/CD, deployment
- Testing frameworks (Jest, JUnit, pytest) - not executable standalone
- Git, version control, tools
- HR, soft skills, aptitude
- GUI applications, file I/O, full applications
- Architecture, design patterns (conceptual, not executable)
- Any topic that mentions frameworks, libraries, or tools without executable code

Respond with ONLY "true" or "false" (no explanation, no quotes, just the word)."""

        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at classifying technical topics for code execution. Be STRICT - only return 'true' if code can be executed by Judge0. Respond with only 'true' or 'false'."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,  # Lower temperature for stricter validation
            max_tokens=10
        )
        
        result = response.choices[0].message.content.strip().lower()
        return result == "true"
    except Exception as e:
        logger.warning(f"Failed to determine coding support for topic '{topic}' using AI, defaulting to False: {e}")
        return False


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
- coding: Programming questions with code execution (ONLY for programming/coding domains)

Rules:
1. If the domain is related to programming, software development, computer science, coding, algorithms, or software engineering → Include ALL types: MCQ, Subjective, Pseudo Code, Descriptive, coding
2. If the domain is NOT programming-related (e.g., Mechanical Engineering, Civil Engineering, Aptitude, Soft Skills, etc.) → Exclude Pseudo Code and coding: MCQ, Subjective, Descriptive

Respond with ONLY a comma-separated list of question types (e.g., "MCQ, Subjective, Descriptive" or "MCQ, Subjective, Pseudo Code, Descriptive, coding").
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
    valid_types = {"MCQ", "Subjective", "Pseudo Code", "Descriptive", "coding"}
    filtered_types = [qt for qt in question_types if qt in valid_types]
    
    # If no valid types found, return safe defaults
    if not filtered_types:
        return ["MCQ", "Subjective", "Descriptive"]
    
    return filtered_types


async def get_question_type_for_topic(topic: str) -> str:
    """
    Optimized function to determine the most appropriate question type for a specific topic.
    Uses fast keyword matching first, then AI only if needed.
    Returns a single question type (not a list).
    """
    if not topic or not topic.strip():
        return "MCQ"
    
    topic_lower = topic.lower().strip()
    
    # Fast keyword-based matching (no AI call needed)
    # Coding-related topics
    coding_keywords = [
        "algorithm", "data structure", "programming", "coding", "code", 
        "leetcode", "hackerrank", "problem solving", "competitive programming",
        "array", "linked list", "tree", "graph", "dynamic programming", "dp",
        "sorting", "searching", "recursion", "backtracking", "greedy",
        "python", "java", "javascript", "c++", "c#", "go", "rust", "sql",
        "oops", "oop", "object oriented", "object-oriented", "design pattern", "system design",
        "inheritance", "polymorphism", "encapsulation", "abstraction", "classes", "objects"
    ]
    
    # Subjective/Descriptive topics (theory/conceptual)
    theory_keywords = [
        "theory", "concept", "overview", "introduction", "fundamentals",
        "architecture", "design", "methodology", "process", "framework",
        "best practices", "principles", "guidelines", "standards"
    ]
    
    # Pseudo Code topics (algorithm design without execution)
    pseudo_code_keywords = [
        "pseudo code", "pseudocode", "algorithm design", "flowchart",
        "logic", "step by step", "procedure", "methodology"
    ]
    
    # MCQ keywords (factual, definition-based, quick assessment topics)
    mcq_keywords = [
        "definition", "what is", "basics", "fundamentals", "introduction", "overview",
        "concept", "principles", "features", "characteristics", "types", "kinds",
        "components", "parts", "elements", "tools", "technologies", "frameworks",
        "libraries", "packages", "syntax", "keywords", "operators", "data types",
        "variables", "functions", "methods", "classes", "modules", "imports",
        "comparison", "difference", "similarities", "advantages", "disadvantages",
        "benefits", "limitations", "use cases", "examples", "applications"
    ]
    
    # Subjective keywords (explanation, reasoning, understanding-based topics)
    subjective_keywords = [
        "explain", "describe", "how", "why", "when", "where", "discuss",
        "analyze", "evaluate", "compare", "contrast", "elaborate", "detail",
        "reasoning", "logic", "approach", "strategy", "method", "process",
        "workflow", "pipeline", "architecture", "design", "pattern", "best practices",
        "optimization", "performance", "scalability", "security", "testing",
        "debugging", "troubleshooting", "implementation", "deployment", "maintenance"
    ]
    
    # PRIORITY ORDER: Check MCQ and Subjective FIRST before coding/descriptive
    # This ensures more variety in question types instead of always defaulting to coding/descriptive
    
    # 1. Check for MCQ topics first (most common for tech topics)
    # Expand MCQ keywords to include common tech topic patterns
    expanded_mcq_indicators = mcq_keywords + [
        "framework", "library", "tool", "technology", "language", "platform",
        "features", "syntax", "api", "component", "module", "package"
    ]
    if any(keyword in topic_lower for keyword in expanded_mcq_indicators):
        return "MCQ"
    
    # 2. Check for Subjective topics (explanation-based)
    # Expand Subjective keywords to include common explanation patterns
    expanded_subjective_indicators = subjective_keywords + [
        "working", "functionality", "mechanism", "operation", "behavior",
        "lifecycle", "rendering", "state management", "routing", "authentication"
    ]
    if any(keyword in topic_lower for keyword in expanded_subjective_indicators):
        return "Subjective"
    
    # 3. Check for pseudo code topics (algorithm design)
    if any(keyword in topic_lower for keyword in pseudo_code_keywords):
        return "Pseudo Code"
    
    # 4. Check for explicit coding execution keywords (very specific - only for actual code execution)
    explicit_coding_keywords = ["leetcode", "hackerrank", "competitive programming", "code solution", "write code", "implement algorithm"]
    if any(kw in topic_lower for kw in explicit_coding_keywords):
        coding_supported = await determine_topic_coding_support(topic)
        if coding_supported:
            return "coding"
        # If not supported, continue to other checks
    
    # 5. Check for coding-related topics (but be more selective)
    # Only check coding keywords if topic explicitly mentions execution/implementation
    execution_keywords = ["implementation", "execute", "run", "compile", "debug", "algorithm", "data structure", "dsa", "problem solving"]
    has_execution_context = any(kw in topic_lower for kw in execution_keywords)
    
    if has_execution_context and any(keyword in topic_lower for keyword in coding_keywords):
        coding_supported = await determine_topic_coding_support(topic)
        if coding_supported:
            # Only return coding if it's explicitly about writing/running code
            return "coding"
        # If not supported, default to Subjective
        return "Subjective"
    
    # 6. For topics with coding keywords but no execution context, prefer MCQ/Subjective
    if any(keyword in topic_lower for keyword in coding_keywords):
        # Check if it's more about basics/fundamentals (MCQ) or concepts (Subjective)
        if any(kw in topic_lower for kw in ["basics", "fundamentals", "introduction", "overview", "what is", "definition", "features", "syntax"]):
            return "MCQ"
        if any(kw in topic_lower for kw in ["how", "why", "explain", "describe", "concept", "understanding", "working"]):
            return "Subjective"
        # Default to MCQ for general tech topics
        return "MCQ"
    
    # 7. Check for theory/conceptual topics (but prioritize MCQ/Subjective)
    if any(keyword in topic_lower for keyword in theory_keywords):
        # Check if it's more about explanation (Subjective) or factual (MCQ)
        if any(kw in topic_lower for kw in subjective_keywords):
            return "Subjective"
        if any(kw in topic_lower for kw in mcq_keywords):
            return "MCQ"
        # Only use Descriptive if it truly requires comprehensive explanation
        return "Descriptive"
    
    # For ambiguous cases, use AI (but optimized with low temperature and max_tokens)
    # First check if topic supports coding before allowing AI to return "coding"
    coding_supported = await determine_topic_coding_support(topic)
    
    try:
        client = _get_client()
        prompt = f"""Determine the most appropriate question type for the topic: "{topic}"

Available question types:
- MCQ: Multiple choice questions (best for factual knowledge, definitions, quick assessments, "what is" questions)
- Subjective: Open-ended questions requiring explanation (best for understanding concepts, reasoning, "how/why" questions)
- Pseudo Code: Algorithm design and logical problem-solving (best for algorithm design without code execution)
- Descriptive: Detailed explanation questions (best for comprehensive understanding, theory, long-form answers)
- coding: Programming questions with code execution via Judge0 (ONLY for executable code)

CRITICAL RULES:
1. Return "coding" ONLY if:
   - Topic involves executable code that Judge0 can run (e.g., Data Structures, Algorithms, DSA, Programming languages with execution)
   - Topic is about writing code that can be validated (e.g., Python programming, Java coding, C++ algorithms)
   - NOT for frameworks (React, Angular, Django), UI/UX, theory, or non-executable concepts

2. Do NOT return "coding" for:
   - Framework/library concepts (React, Angular, Vue, Django, Flask, Spring)
   - UI/UX, design, CSS, HTML styling
   - Theory subjects (OS theory, DBMS theory, CN theory)
   - DevOps, Docker, Kubernetes, deployment tools
   - Testing frameworks (Jest, JUnit, pytest)
   - Architecture, design patterns (conceptual only)
   - Git, version control, tools

3. PRIORITY ORDER (MUST follow this order strictly):
   a) For factual/definition/"what is"/basics/fundamentals topics → "MCQ" (HIGHEST PRIORITY - use for most tech topics)
   b) For explanation/"how/why"/process/understanding topics → "Subjective" (SECOND PRIORITY - use for conceptual topics)
   c) For algorithm design without execution → "Pseudo Code" (ONLY if explicitly about algorithm design)
   d) For executable code topics (leetcode, hackerrank, coding problems) → "coding" (ONLY if explicitly about code execution)
   e) For theoretical/conceptual topics requiring VERY detailed explanation → "Descriptive" (LAST RESORT - avoid if possible)

4. DEFAULT PREFERENCES (IMPORTANT - follow these defaults):
   - MOST tech topics (frameworks, libraries, tools, languages) → "MCQ" (default choice)
   - Conceptual/explanation topics (how things work, processes) → "Subjective" (default choice)
   - Algorithm/data structure problems requiring code → "coding" (only if explicitly about execution)
   - Comprehensive theory requiring long-form answers → "Descriptive" (rarely use)
   
5. WHEN TO USE EACH TYPE:
   - "MCQ": Use for 70% of topics - frameworks, libraries, tools, syntax, features, basics, fundamentals
   - "Subjective": Use for 20% of topics - explanations, processes, how things work, concepts
   - "Pseudo Code": Use for 5% of topics - algorithm design, flowcharts, step-by-step logic
   - "coding": Use for 3% of topics - only explicit coding problems (leetcode-style)
   - "Descriptive": Use for 2% of topics - only comprehensive theory requiring long answers

IMPORTANT: Prefer "MCQ" for factual/definition topics and "Subjective" for explanation topics. Only use "Descriptive" for topics requiring very detailed, comprehensive explanations. Only return "coding" if code can be EXECUTED by Judge0.

Respond with ONLY one word: the question type name (e.g., "MCQ", "Subjective", "Pseudo Code", "Descriptive", or "coding").
No explanation, just the type name."""

        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert at determining appropriate question types. Respond with only the question type name."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,  # Very low temperature for consistency
            max_tokens=15,  # Limit response length for speed
        )
        
        result = response.choices[0].message.content.strip() if response.choices else ""
        result = result.strip('"\'')  # Remove quotes if present
        
        # Validate result and ensure "coding" is only returned if topic supports coding
        valid_types = {"MCQ", "Subjective", "Pseudo Code", "Descriptive", "coding"}
        if result in valid_types:
            # If AI returned "coding" but topic doesn't support coding, change to safe default
            if result == "coding" and not coding_supported:
                logger.warning(f"AI returned 'coding' for topic '{topic}' but topic doesn't support coding. Changing to 'Subjective'.")
                return "Subjective"
            return result
    except Exception as e:
        logger.warning(f"Failed to determine question type for topic '{topic}' using AI, defaulting to MCQ: {e}")
    
    # Default fallback
    return "MCQ"


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
    
    # Default question types for technical skills
    all_types = ["MCQ", "Subjective", "Pseudo Code", "Descriptive", "coding"]
    
    # If it's clearly non-technical, exclude Pseudo Code and coding
    if is_non_technical and not is_technical:
        return ["MCQ", "Subjective", "Descriptive"]
    
    # If it's technical or unclear, include all types including coding
    return all_types


async def generate_coding_question_for_topic(topic: str, difficulty: str, language_id: str) -> Dict[str, Any]:
    """
    Generate a coding question similar to DSA questions.
    Uses the DSA AI generator to create LeetCode-style questions.
    """
    # Validate language_id
    if not language_id:
        raise ValueError("Language ID is required for coding questions")
    
    # Map Judge0 language IDs to language names for DSA generator
    language_id_to_name = {
        "50": "c",
        "54": "cpp",
        "62": "java",
        "71": "python",
        "70": "python2",
        "63": "javascript",
        "74": "typescript",
        "68": "php",
        "72": "ruby",
        "83": "swift",
        "60": "go",
        "78": "kotlin",
        "73": "rust",
        "82": "sql",
        "51": "csharp",
        "84": "vbnet"
    }
    
    # Map difficulty format (Easy/Medium/Hard to easy/medium/hard)
    difficulty_map = {
        "Easy": "easy",
        "Medium": "medium",
        "Hard": "hard"
    }
    difficulty_lower = difficulty_map.get(difficulty, "medium")
    
    # Get language name from ID
    language_name = language_id_to_name.get(language_id)
    if not language_name:
        raise ValueError(f"Invalid language ID: {language_id}")
    
    # Import DSA generator (lazy import to avoid circular dependencies)
    # Use absolute import to avoid issues
    try:
        import importlib
        dsa_module = importlib.import_module("app.dsa.services.ai_generator")
        generate_dsa_question = dsa_module.generate_question
    except ImportError as e:
        logger.error(f"Failed to import DSA generator: {e}")
        raise ValueError(f"Failed to import DSA question generator: {e}") from e
    
    try:
        # Generate question using DSA generator
        question_data = await generate_dsa_question(
            difficulty=difficulty_lower,
            topic=topic,
            concepts=None,
            languages=[language_name]
        )
        
        # Validate that we got valid data
        if not question_data or not isinstance(question_data, dict):
            raise ValueError(f"Invalid question data returned from DSA generator: {type(question_data)}")
        
        # Convert DSA question format to assessment question format
        # Build questionText from description, examples, and constraints
        question_text_parts = [question_data.get("description", "")]
        
        # Add examples
        examples = question_data.get("examples", [])
        if examples:
            question_text_parts.append("\n\nExamples:")
            for i, ex in enumerate(examples, 1):
                ex_text = f"Example {i}:\nInput: {ex.get('input', '')}\nOutput: {ex.get('output', '')}"
                if ex.get('explanation'):
                    ex_text += f"\nExplanation: {ex.get('explanation')}"
                question_text_parts.append(ex_text)
        
        # Add constraints
        constraints = question_data.get("constraints", [])
        if constraints:
            question_text_parts.append("\n\nConstraints:")
            for constraint in constraints:
                question_text_parts.append(f"- {constraint}")
        
        question_text = "\n".join(question_text_parts)
        
        # Build the question object in assessment format
        question = {
            "questionText": question_text,
            "type": "coding",
            "difficulty": difficulty,
            "judge0_enabled": True,  # Always enabled for coding
            "language": language_id,
            # Store DSA-specific data for later use
            "coding_data": {
                "title": question_data.get("title", ""),
                "description": question_data.get("description", ""),
                "examples": examples,
                "constraints": constraints,
                "function_signature": question_data.get("function_signature"),
                "public_testcases": question_data.get("public_testcases", []),
                "hidden_testcases": question_data.get("hidden_testcases", []),
                "starter_code": question_data.get("starter_code", {}),
                "languages": question_data.get("languages", [])
            }
        }
        
        return question
    except ValueError as e:
        # Re-raise ValueError with more context
        error_msg = str(e)
        logger.error(f"Error generating coding question (ValueError): {error_msg}")
        raise ValueError(f"Failed to generate coding question: {error_msg}") from e
    except Exception as e:
        # Log full exception details
        logger.exception(f"Error generating coding question: {type(e).__name__}: {e}")
        # Re-raise with better error message
        raise Exception(f"Failed to generate coding question: {str(e)}") from e


async def generate_questions_for_topic(topic: str, config: Dict[str, Any], coding_supported: bool = True) -> List[Dict[str, Any]]:
    num_questions = config.get("numQuestions")
    if not topic or not num_questions or num_questions <= 0:
        return []
    
    # Check if this is a coding question type
    question_type = config.get("Q1type", "Subjective")
    if question_type == "coding":
        # Validate that topic supports coding
        if not coding_supported:
            logger.warning(f"Coding question requested for topic '{topic}' which does not support coding. Skipping.")
            return []
        # Generate coding questions using DSA-style generation
        difficulty = config.get("Q1difficulty", "Medium")
        language_id = config.get("language")  # No default - must be specified
        
        # Language must be specified for coding questions
        if not language_id:
            logger.warning(f"Language not specified for coding question on topic: {topic}. Skipping generation.")
            return []
        
        questions = []
        for i in range(num_questions):
            try:
                coding_question = await generate_coding_question_for_topic(topic, difficulty, language_id)
                questions.append(coding_question)
            except ValueError as e:
                # Language validation error - skip this question
                logger.warning(f"Invalid language for coding question {i+1} on topic {topic}: {e}")
                continue
            except Exception as e:
                logger.error(f"Error generating coding question {i+1}: {e}")
                # Add fallback question only if we have a valid language_id
                if language_id:
                    questions.append({
                        "questionText": f"Write a program to solve a problem related to {topic}.",
                        "type": "coding",
                        "difficulty": difficulty,
                        "judge0_enabled": True,
                        "language": language_id,
                    })
        return questions

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
- type (string): Must match exactly - "MCQ", "Subjective", "Pseudo Code", "Descriptive", "Aptitude", "Reasoning", or "coding"
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
        
        # For coding questions, always set judge0_enabled to true and language if provided
        if q_type == "coding":
            q["judge0_enabled"] = True  # Always enabled for coding
            if "language" in config:
                q["language"] = config.get("language")
        
        validated_questions.append(q)
    
    return validated_questions


async def suggest_time_and_score(question: Dict[str, Any]) -> Dict[str, Any]:
    """Suggest time (in minutes) and score for a question based on its type and difficulty."""
    question_type = question.get("type", "Subjective")
    difficulty = question.get("difficulty", "Medium")
    question_text = question.get("questionText", "")
    
    prompt = f"""
You are an expert assessment evaluator. Based on the following question, suggest appropriate time (in minutes) and score (points).

Question Type: {question_type}
Difficulty: {difficulty}
Question: {question_text[:200]}...

Provide your suggestion in the following format:
- Time: [number] minutes (considering the question type and difficulty)
- Score: [number] points (considering the question complexity and importance)

Guidelines:
- MCQ questions: Usually 1-3 minutes, 1-2 points
- Subjective questions: 5-15 minutes, 3-10 points depending on difficulty
- Pseudo Code questions: 10-20 minutes, 5-15 points depending on difficulty
- Descriptive questions: 10-20 minutes, 5-15 points depending on difficulty
- Easy difficulty: Lower time and score
- Medium difficulty: Moderate time and score
- Hard difficulty: Higher time and score

Respond ONLY with a JSON object in this exact format:
{{"time": <number>, "score": <number>}}
"""

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
    except Exception as exc:
        # Fallback to default values
        defaults = {
            "MCQ": {"time": 2, "score": 1},
            "Subjective": {"time": 10, "score": 5},
            "Pseudo Code": {"time": 15, "score": 10},
            "Descriptive": {"time": 15, "score": 10},
        }
        difficulty_multiplier = {"Easy": 0.7, "Medium": 1.0, "Hard": 1.5}
        base = defaults.get(question_type, {"time": 10, "score": 5})
        multiplier = difficulty_multiplier.get(difficulty, 1.0)
        return {
            "time": int(base["time"] * multiplier),
            "score": int(base["score"] * multiplier),
        }
    
    text = response.choices[0].message.content.strip() if response.choices else ""
    
    # Try to parse JSON from response
    try:
        import json
        # Extract JSON from text
        if "{" in text and "}" in text:
            start = text.find("{")
            end = text.rfind("}") + 1
            parsed = json.loads(text[start:end])
            if "time" in parsed and "score" in parsed:
                return {"time": int(parsed["time"]), "score": int(parsed["score"])}
    except:
        pass
    
    # Fallback
    defaults = {
        "MCQ": {"time": 2, "score": 1},
        "Subjective": {"time": 10, "score": 5},
        "Pseudo Code": {"time": 15, "score": 10},
        "Descriptive": {"time": 15, "score": 10},
    }
    difficulty_multiplier = {"Easy": 0.7, "Medium": 1.0, "Hard": 1.5}
    base = defaults.get(question_type, {"time": 10, "score": 5})
    multiplier = difficulty_multiplier.get(difficulty, 1.0)
    return {
        "time": int(base["time"] * multiplier),
        "score": int(base["score"] * multiplier),
    }


async def evaluate_answer_with_ai(
    question: Dict[str, Any],
    candidate_answer: str,
    max_score: int
) -> Dict[str, Any]:
    """Evaluate candidate answer using AI and return score, feedback, and evaluation details."""
    question_text = question.get("questionText", "").strip()
    question_type = question.get("type", "Subjective")
    ideal_answer = question.get("idealAnswer", "")
    expected_logic = question.get("expectedLogic", "")
    difficulty = question.get("difficulty", "Medium")
    candidate_answer_clean = candidate_answer.strip()
    
    # Pre-check: If candidate answer is too similar to question text, return 0 immediately
    if candidate_answer_clean:
        # Normalize both texts for comparison (lowercase, remove extra spaces, punctuation)
        question_normalized = " ".join(question_text.lower().split())
        answer_normalized = " ".join(candidate_answer_clean.lower().split())
        
        # Check if answer is identical or very similar to question
        if question_normalized and answer_normalized:
            # Use SequenceMatcher for accurate similarity calculation
            similarity = SequenceMatcher(None, question_normalized, answer_normalized).ratio()
            
            # Check 1: Exact match or very high similarity (80%+)
            if similarity >= 0.80:
                return {
                    "score": 0,
                    "feedback": "Answer appears to be copied from the question text. No marks awarded.",
                    "evaluation": "The candidate's answer is identical or very similar (80%+) to the question itself, indicating they copied the question without providing an actual answer. This demonstrates no understanding of the concept."
                }
            
            # Check 2: If answer is shorter or similar length to question and has high similarity (60%+)
            question_words = question_normalized.split()
            answer_words = answer_normalized.split()
            
            if len(question_words) > 0:
                # If answer length is similar to question (not much longer), and similarity is 60%+
                if similarity >= 0.60 and len(answer_words) <= len(question_words) * 1.3:
                    return {
                        "score": 0,
                        "feedback": "Answer appears to be copied from the question text. No marks awarded.",
                        "evaluation": "The candidate's answer is very similar (60%+) to the question itself and has similar length, indicating they copied the question without providing an actual answer. This demonstrates no understanding of the concept."
                    }
                
                # Check 3: If answer starts with question text (even if longer)
                if answer_normalized.startswith(question_normalized[:min(len(question_normalized), len(answer_normalized))]):
                    if len(answer_words) <= len(question_words) * 1.2:  # Answer is not much longer than question
                        return {
                            "score": 0,
                            "feedback": "Answer appears to be copied from the question text. No marks awarded.",
                            "evaluation": "The candidate's answer starts with the question text, indicating they copied the question without providing an actual answer. This demonstrates no understanding of the concept."
                        }
                
                # Check 4: If answer contains question text as substring (exact match within answer)
                if question_normalized in answer_normalized and len(answer_words) <= len(question_words) * 1.5:
                    return {
                        "score": 0,
                        "feedback": "Answer appears to be copied from the question text. No marks awarded.",
                        "evaluation": "The candidate's answer contains the question text, indicating they copied the question without providing an actual answer. This demonstrates no understanding of the concept."
                    }
    
    prompt = f"""
You are a strict assessment evaluator. Evaluate the candidate's answer for the following question and provide a score.

Question Type: {question_type}
Difficulty: {difficulty}
Question: {question_text}

Ideal Answer (if provided): {ideal_answer if ideal_answer else "Not provided"}
Expected Logic (if provided): {expected_logic if expected_logic else "Not provided"}

Candidate's Answer: {candidate_answer_clean}

CRITICAL EVALUATION RULES - BE VERY STRICT:
1. FIRST CHECK: If the candidate's answer is identical, nearly identical, or very similar (more than 60% similar) to the question text itself, this means the candidate just copied the question without providing an actual answer. You MUST give 0 points immediately.
2. If the candidate's answer is empty, too short (less than 15 words for subjective/descriptive questions), or irrelevant, give 0 points.
3. The answer MUST demonstrate actual understanding and knowledge, not just repeat or rephrase the question.
4. Compare the candidate's answer with the ideal answer (if provided). The answer should show the candidate understands the concept and can explain it, not just copy the question.
5. Evaluate based on:
   - Does the answer actually address the question with NEW information? (not just copying/rephrasing the question)
   - Accuracy and correctness compared to ideal answer
   - Completeness - does it cover the key points expected?
   - Understanding - does it show the candidate truly understands the concept?
   - Quality of explanation (for descriptive/subjective questions)
   - Logic and reasoning (for pseudo code questions)
   - Originality - is it the candidate's own work demonstrating knowledge?

Scoring Guidelines - BE STRICT:
- Maximum Score: {max_score} points
- Award full marks ONLY if the answer is completely correct, comprehensive, demonstrates clear understanding, and provides substantial information beyond the question
- Award partial marks (1-{max_score-1}) ONLY if the answer shows some understanding and provides relevant information:
  * 1-{max_score//3} points: Minimal understanding, partially correct but incomplete
  * {max_score//3 + 1}-{max_score*2//3} points: Good understanding, mostly correct but missing some details
  * {max_score*2//3 + 1}-{max_score-1} points: Very good understanding, correct and comprehensive but minor gaps
- Award 0 points if:
  * Answer is identical, nearly identical, or very similar (60%+) to the question text
  * Answer is empty or too short (less than 15 words)
  * Answer is completely incorrect or irrelevant
  * Answer shows no understanding of the concept
  * Answer just rephrases the question without providing actual information

VERY IMPORTANT: 
- If the candidate's answer is similar to the question text (even if rephrased), it means they copied it. Give 0 points.
- The answer must provide NEW information, explanations, or solutions that demonstrate knowledge.
- Be very strict - it's better to give 0 points than to give marks for copied content.

Provide your evaluation in the following JSON format:
{{
    "score": <number between 0 and {max_score}>,
    "feedback": "<brief feedback explaining the score, MUST mention if answer was copied or too similar to question>",
    "evaluation": "<detailed evaluation explaining why this score was given, compare with ideal answer, explain if it was copied>"
}}

Respond ONLY with the JSON object, no additional text.
"""

    client = _get_client()
    try:
        response = await client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
        )
    except Exception as exc:
        logger.error(f"Error in AI evaluation: {exc}")
        # Fallback: return 0 score if evaluation fails
        return {
            "score": 0,
            "feedback": "Evaluation could not be completed automatically.",
            "evaluation": "AI evaluation service unavailable."
        }
    
    text = response.choices[0].message.content.strip() if response.choices else ""
    
    # Try to parse JSON from response
    try:
        import json
        # Extract JSON from text
        if "{" in text and "}" in text:
            start = text.find("{")
            end = text.rfind("}") + 1
            parsed = json.loads(text[start:end])
            
            # Validate and clamp score
            score = int(parsed.get("score", 0))
            score = max(0, min(score, max_score))  # Clamp between 0 and max_score
            
            return {
                "score": score,
                "feedback": parsed.get("feedback", "No feedback provided."),
                "evaluation": parsed.get("evaluation", "No detailed evaluation provided.")
            }
    except Exception as parse_error:
        logger.error(f"Error parsing AI evaluation response: {parse_error}")
    
    # Fallback: return 0 score if parsing fails
    return {
        "score": 0,
        "feedback": "Evaluation response could not be parsed.",
        "evaluation": "AI evaluation response was invalid."
    }


async def generate_questions_for_topic_safe(topic: str, config: Dict[str, Any], coding_supported: bool = True) -> List[Dict[str, Any]]:
    try:
        result = await generate_questions_for_topic(topic, config, coding_supported)
        return result if isinstance(result, list) else []
    except HTTPException:
        raise
    except Exception:  # pragma: no cover - guard for unexpected errors
        return []

