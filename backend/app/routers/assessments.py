from __future__ import annotations

import asyncio
import logging
import secrets
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..core.dependencies import require_editor
from ..core.security import sanitize_input, sanitize_text_field
from ..db.mongo import get_db
from ..schemas.assessment import (
    AddCustomTopicsRequest,
    AddNewQuestionRequest,
    CreateAssessmentFromJobDesignationRequest,
    DeleteQuestionRequest,
    DeleteTopicQuestionsRequest,
    FinalizeAssessmentRequest,
    GenerateQuestionsFromConfigRequest,
    GenerateQuestionsRequest,
    GenerateTopicCardsRequest,
    GenerateTopicsFromSkillRequest,
    GenerateTopicsRequest,
    RegenerateSingleTopicRequest,
    RemoveCustomTopicsRequest,
    ScheduleUpdateRequest,
    TopicConfigRow,
    UpdateAssessmentDraftRequest,
    UpdateQuestionsRequest,
    UpdateSingleQuestionRequest,
    UpdateTopicSettingsRequest,
    ValidateQuestionTypeRequest,
)
from ..services.ai import (
    determine_topic_coding_support,
    generate_questions_for_topic_safe,
    generate_topics_from_input,
    generate_topics_from_skill,
    generate_topics_from_selected_skills,
    generate_topic_cards_from_job_designation,
    get_question_type_for_topic,
    get_relevant_question_types,
    get_relevant_question_types_from_domain,
    suggest_time_and_score,
)
from ..utils.mongo import convert_object_ids, serialize_document, to_object_id
from ..utils.responses import success_response
from ..models.aptitude_topics import (
    APTITUDE_MAIN_TOPICS,
    APTITUDE_TOPICS_STRUCTURE,
    get_aptitude_subtopics,
    get_aptitude_question_types,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/assessments", tags=["assessments"])


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _check_assessment_access(assessment: Dict[str, Any], current_user: Dict[str, Any]) -> None:
    if current_user.get("role") == "super_admin":
        return
    
    # Normalize organization IDs to strings for comparison
    assessment_org = assessment.get("organization")
    if assessment_org is not None:
        # Convert ObjectId to string if needed
        assessment_org = str(assessment_org)
    
    user_org = current_user.get("organization")
    if user_org is not None:
        # Already a string from serialization, but ensure it's a string
        user_org = str(user_org)
    
    # Allow access if organizations match (including both None)
    if assessment_org == user_org:
        return
    
    # If assessment has no organization, allow access if user is the creator
    if assessment_org is None:
        assessment_created_by = assessment.get("createdBy")
        user_id = current_user.get("id")
        if assessment_created_by is not None and user_id is not None:
            # Convert both to strings for comparison (createdBy is ObjectId, user_id is string)
            if str(assessment_created_by) == str(user_id):
                return
    
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Access denied. You can only access your organization's assessments.",
    )


async def _get_assessment(db: AsyncIOMotorDatabase, assessment_id: str) -> Dict[str, Any]:
    try:
        oid = to_object_id(assessment_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assessment ID") from exc

    assessment = await db.assessments.find_one({"_id": oid})
    if not assessment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessment not found")
    return assessment


async def _save_assessment(db: AsyncIOMotorDatabase, assessment: Dict[str, Any]) -> None:
    assessment_id = assessment.get("_id")
    if not assessment_id:
        raise RuntimeError("Assessment document missing _id")
    assessment["updatedAt"] = _now_utc()
    await db.assessments.replace_one({"_id": assessment_id}, assessment)


def _ensure_topic_structure(topic: Dict[str, Any]) -> Dict[str, Any]:
    topic.setdefault("questions", [])
    topic.setdefault("questionConfigs", [])
    topic.setdefault("questionTypes", [])
    return topic


def _is_aptitude_skill(skill: str) -> bool:
    """Check if a skill is aptitude-related."""
    skill_lower = skill.lower().strip()
    aptitude_keywords = ["aptitude", "apti"]
    
    # Check for aptitude keywords
    if any(keyword in skill_lower for keyword in aptitude_keywords):
        return True
    
    # Check if skill matches aptitude main topics
    aptitude_main_topics_lower = [topic.lower() for topic in APTITUDE_MAIN_TOPICS]
    for apt_topic in aptitude_main_topics_lower:
        if apt_topic in skill_lower or skill_lower in apt_topic:
            return True
    
    # Check for common variations
    if "quantitative" in skill_lower or "logical reasoning" in skill_lower or "verbal ability" in skill_lower:
        return True
    
    return False


def _is_aptitude_requested(job_designation: str, selected_skills: List[str]) -> bool:
    """Check if aptitude assessment is requested based on job designation or selected skills."""
    # Normalize inputs for case-insensitive matching
    job_designation_lower = job_designation.lower().strip()
    
    # Check job designation
    aptitude_keywords = ["aptitude", "apti"]
    if any(keyword in job_designation_lower for keyword in aptitude_keywords):
        return True
    
    # Check selected skills
    for skill in selected_skills:
        if _is_aptitude_skill(skill):
            return True
    
    return False


def _separate_skills(selected_skills: List[str]) -> tuple[List[str], List[str]]:
    """Separate selected skills into aptitude skills and technical skills.
    
    Returns:
        Tuple of (aptitude_skills, technical_skills)
    """
    aptitude_skills = []
    technical_skills = []
    
    for skill in selected_skills:
        if _is_aptitude_skill(skill):
            aptitude_skills.append(skill)
        else:
            technical_skills.append(skill)
    
    return aptitude_skills, technical_skills


@router.post("/generate-topics")
async def generate_topics(
    payload: GenerateTopicsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    # Validate assessment type
    valid_types = {"aptitude", "technical"}
    assessment_types = set(payload.assessmentType)
    if not assessment_types.issubset(valid_types):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid assessment type. Must be one or more of: {valid_types}",
        )

    # Validate required fields based on assessment type
    if "technical" in assessment_types:
        if not payload.jobRole or not payload.experience or not payload.skills or len(payload.skills) == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Job role, experience, and at least one skill are required for technical assessments",
            )
        if not payload.numTopics or payload.numTopics < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Number of topics is required and must be at least 1 for technical assessments",
            )

    if "aptitude" in assessment_types:
        if not payload.aptitudeConfig:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Aptitude configuration is required for aptitude assessments",
            )
        # Check if at least one aptitude category is enabled
        apt_config = payload.aptitudeConfig
        has_enabled = (
            (apt_config.quantitative and apt_config.quantitative.enabled)
            or (apt_config.logicalReasoning and apt_config.logicalReasoning.enabled)
            or (apt_config.verbalAbility and apt_config.verbalAbility.enabled)
            or (apt_config.numericalReasoning and apt_config.numericalReasoning.enabled)
        )
        if not has_enabled:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one aptitude category must be enabled",
            )

    topic_docs: List[Dict[str, Any]] = []
    custom_topics: List[str] = []
    title_parts: List[str] = []
    description_parts: List[str] = []

    # Handle Aptitude topics
    if "aptitude" in assessment_types and payload.aptitudeConfig:
        apt_config = payload.aptitudeConfig
        aptitude_category_map = {
            "quantitative": "Quantitative",
            "logicalReasoning": "Logical Reasoning",
            "verbalAbility": "Verbal Ability",
            "numericalReasoning": "Numerical Reasoning",
        }

        for key, category_name in aptitude_category_map.items():
            category_config = getattr(apt_config, key, None)
            if category_config and category_config.enabled:
                # Aptitude topics don't support coding
                coding_supported = await determine_topic_coding_support(category_name)
                topic_docs.append(
                    {
                        "topic": category_name,
                        "numQuestions": category_config.numQuestions,
                        "questionTypes": ["MCQ"],
                        "difficulty": category_config.difficulty,
                        "source": "AI",
                        "category": "aptitude",
                        "questions": [],
                        "questionConfigs": [],
                        "coding_supported": coding_supported,
                    }
                )
                custom_topics.append(category_name)
                title_parts.append(category_name)
                description_parts.append(f"{category_name} ({category_config.difficulty})")

    # Handle Technical topics
    if "technical" in assessment_types:
        # Sanitize user inputs
        sanitized_job_role = sanitize_text_field(payload.jobRole)
        sanitized_skills = [sanitize_text_field(skill) for skill in payload.skills]
        
        topics = await generate_topics_from_input(sanitized_job_role, payload.experience, sanitized_skills, payload.numTopics)
        # Sanitize generated topics
        sanitized_topics = [sanitize_text_field(topic) for topic in topics]
        # Determine coding support for each topic
        technical_topic_docs = []
        for t in sanitized_topics:
            coding_supported = await determine_topic_coding_support(t)
            technical_topic_docs.append({
                "topic": t,
                "numQuestions": 0,
                "questionTypes": [],
                "difficulty": "Medium",
                "source": "AI",
                "category": "technical",
                "questions": [],
                "questionConfigs": [],
                "coding_supported": coding_supported,
            })
        topic_docs.extend(technical_topic_docs)
        custom_topics.extend(sanitized_topics)
        title_parts.append(sanitized_job_role)
        description_parts.append(f"{sanitized_job_role} test for {payload.experience} exp level")

    # Build title and description
    # Sanitize title parts to prevent XSS
    sanitized_title_parts = [sanitize_text_field(part) for part in title_parts]
    sanitized_description_parts = [sanitize_text_field(part) for part in description_parts]
    
    if len(sanitized_title_parts) == 1:
        title = f"{sanitized_title_parts[0]} Assessment"
    elif len(sanitized_title_parts) == 2:
        title = f"{sanitized_title_parts[0]} & {sanitized_title_parts[1]} Assessment"
    else:
        title = "Assessment"

    description = ". ".join(sanitized_description_parts) if sanitized_description_parts else "Assessment"

    assessment_doc: Dict[str, Any] = {
        "title": title,
        "description": description,
        "topics": topic_docs,
        "customTopics": custom_topics,
        "assessmentType": list(assessment_types),
        "status": "draft",
        "createdBy": to_object_id(current_user.get("id")),
        "organization": to_object_id(current_user.get("organization")) if current_user.get("organization") else None,
        "isGenerated": False,
        "createdAt": _now_utc(),
        "updatedAt": _now_utc(),
    }

    # Store configuration
    if "technical" in assessment_types:
        assessment_doc["technicalConfig"] = {
            "jobRole": payload.jobRole,
            "experience": payload.experience,
            "skills": payload.skills,
        }

    if "aptitude" in assessment_types and payload.aptitudeConfig:
        apt_config_dict: Dict[str, Any] = {}
        if payload.aptitudeConfig.quantitative:
            apt_config_dict["quantitative"] = payload.aptitudeConfig.quantitative.model_dump()
        if payload.aptitudeConfig.logicalReasoning:
            apt_config_dict["logicalReasoning"] = payload.aptitudeConfig.logicalReasoning.model_dump()
        if payload.aptitudeConfig.verbalAbility:
            apt_config_dict["verbalAbility"] = payload.aptitudeConfig.verbalAbility.model_dump()
        if payload.aptitudeConfig.numericalReasoning:
            apt_config_dict["numericalReasoning"] = payload.aptitudeConfig.numericalReasoning.model_dump()
        assessment_doc["aptitudeConfig"] = apt_config_dict

    result = await db.assessments.insert_one(assessment_doc)
    assessment_doc["_id"] = result.inserted_id
    return success_response("Topics generated successfully", serialize_document(assessment_doc))


@router.post("/update-topics")
async def update_topic_settings(
    payload: UpdateTopicSettingsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if not payload.updatedTopics:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid input")

    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topics = assessment.get("topics", [])
    for update in payload.updatedTopics:
        # Sanitize topic name
        sanitized_topic = sanitize_text_field(update.topic)
        topic_obj = next((t for t in topics if t.get("topic") == sanitized_topic), None)
        if not topic_obj:
            continue
        topic_obj = _ensure_topic_structure(topic_obj)
        
        # Update topic name if sanitized
        if sanitized_topic != update.topic:
            topic_obj["topic"] = sanitized_topic

        if update.numQuestions is not None:
            topic_obj["numQuestions"] = update.numQuestions
        if update.questionTypes is not None:
            topic_obj["questionTypes"] = update.questionTypes
        if update.difficulty:
            topic_obj["difficulty"] = sanitize_text_field(update.difficulty) if update.difficulty else update.difficulty

        if update.questions:
            for idx, question_config in enumerate(update.questions):
                if idx < len(topic_obj.get("questions", [])):
                    existing_question = topic_obj["questions"][idx]
                    existing_question.update(question_config.model_dump(exclude_unset=True))

        if update.questionConfigs:
            topic_obj["questionConfigs"] = [qc.model_dump(exclude_unset=True) for qc in update.questionConfigs]

    assessment["topics"] = topics
    await _save_assessment(db, assessment)
    # Serialize topics to convert ObjectIds and datetimes to JSON-serializable formats
    serialized_topics = convert_object_ids(assessment["topics"])
    return success_response("Topic settings updated successfully", serialized_topics)


@router.post("/add-topic")
async def add_custom_topics(
    payload: AddCustomTopicsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if not payload.newTopics:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid input")

    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topics = assessment.get("topics", [])
    custom_topics = set(assessment.get("customTopics", []))

    for topic_data in payload.newTopics:
        if isinstance(topic_data, str):
            # Sanitize topic name
            topic_name = sanitize_text_field(topic_data)
            exists = any(t.get("topic") == topic_name for t in topics)
            if not exists:
                # Automatically determine if topic supports coding
                coding_supported = await determine_topic_coding_support(topic_name)
                topics.append(
                    {
                        "topic": topic_name,
                        "numQuestions": 0,
                        "questionTypes": [],
                        "difficulty": "Medium",
                        "source": "User",
                        "questions": [],
                        "questionConfigs": [],
                        "coding_supported": coding_supported,
                    }
                )
            custom_topics.add(topic_name)
        else:
            topic_dict = topic_data.model_dump(exclude_unset=True)
            # Sanitize topic name and difficulty
            topic_name = sanitize_text_field(topic_dict.get("topic", ""))
            sanitized_difficulty = sanitize_text_field(topic_dict.get("difficulty", "Medium")) if topic_dict.get("difficulty") else "Medium"
            exists = any(t.get("topic") == topic_name for t in topics)
            if not exists:
                topics.append(
                    {
                        "topic": topic_name,
                        "numQuestions": topic_dict.get("numQuestions", 0),
                        "questionTypes": topic_dict.get("questionTypes", []),
                        "difficulty": sanitized_difficulty,
                        "source": "User",
                        "questions": [],
                        "questionConfigs": topic_dict.get("questionConfigs", []),
                    }
                )
            custom_topics.add(topic_name)

    assessment["topics"] = topics
    assessment["customTopics"] = list(custom_topics)
    await _save_assessment(db, assessment)
    # Serialize topics to convert ObjectIds and datetimes to JSON-serializable formats
    serialized_topics = convert_object_ids(assessment["topics"])
    return success_response("Custom topics added successfully", serialized_topics)


@router.delete("/remove-topic")
async def remove_custom_topics(
    payload: RemoveCustomTopicsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    if not payload.topicsToRemove:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid input")

    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topics_to_remove = set(payload.topicsToRemove)
    
    # Remove topics from topics array
    assessment["topics"] = [t for t in assessment.get("topics", []) if t.get("topic") not in topics_to_remove]
    
    # Remove topics from customTopics array
    assessment["customTopics"] = [t for t in assessment.get("customTopics", []) if t not in topics_to_remove]
    
    # Remove questions that belong to removed topics
    # Questions are stored in assessment["questions"] array, and each question has a "topic" field
    if "questions" in assessment and isinstance(assessment["questions"], list):
        assessment["questions"] = [
            q for q in assessment["questions"] 
            if q.get("topic") not in topics_to_remove
        ]
    
    # Also remove questions from topic objects themselves
    for topic in assessment.get("topics", []):
        if isinstance(topic, dict) and "questions" in topic:
            if isinstance(topic["questions"], list):
                # Keep only questions that don't belong to removed topics
                # (though this shouldn't be necessary if questions are properly structured)
                topic["questions"] = [
                    q for q in topic["questions"]
                    if q.get("topic") not in topics_to_remove
                ]

    await _save_assessment(db, assessment)
    # Serialize topics to convert ObjectIds and datetimes to JSON-serializable formats
    serialized_topics = convert_object_ids(assessment["topics"])
    return success_response("Topics removed successfully", serialized_topics)


# New flow endpoints
@router.post("/generate-topic-cards")
async def generate_topic_cards_endpoint(
    payload: GenerateTopicCardsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
):
    """Generate topic cards (technologies/skills) from job designation."""
    try:
        # Sanitize input to prevent XSS
        sanitized_job_designation = sanitize_text_field(payload.jobDesignation)
        experience_min = payload.experienceMin if payload.experienceMin is not None else 0
        experience_max = payload.experienceMax if payload.experienceMax is not None else 10
        cards = await generate_topic_cards_from_job_designation(
            sanitized_job_designation, 
            experience_min, 
            experience_max
        )
        
        return success_response(
            "Topic cards generated successfully",
            {
                "cards": cards,
            }
        )
    except HTTPException:
        # Re-raise HTTPExceptions as-is (they already have proper status codes and messages)
        raise
    except Exception as exc:
        logger.error(f"Error generating topic cards: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to generate topic cards: {str(exc)}") from exc


@router.post("/generate-topics-from-skill")
async def generate_topics_from_skill_endpoint(
    payload: GenerateTopicsFromSkillRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Generate topics from skill(s) input. Handles both single skill and comma-separated multiple skills."""
    try:
        # Parse skills: if comma-separated, split into list; otherwise treat as single skill
        skill_input = payload.skill.strip()
        if "," in skill_input:
            # Multiple skills (comma-separated) - use generate_topics_from_selected_skills
            skills_list = [s.strip() for s in skill_input.split(",") if s.strip()]
            if not skills_list:
                raise HTTPException(status_code=400, detail="No valid skills provided")
            
            # Filter out aptitude skills (only use technical skills for topic generation)
            _, technical_skills = _separate_skills(skills_list)
            if not technical_skills:
                raise HTTPException(status_code=400, detail="No technical skills found. Please provide technical skills for topic generation.")
            
            topics = await generate_topics_from_selected_skills(
                technical_skills,
                payload.experienceMin,
                payload.experienceMax
            )
            # Get question types from the first skill (or combine if needed)
            question_types = await get_relevant_question_types(technical_skills[0] if technical_skills else skill_input)
        else:
            # Single skill - use generate_topics_from_skill
            topics = await generate_topics_from_skill(payload.skill, payload.experienceMin, payload.experienceMax)
            question_types = await get_relevant_question_types(payload.skill)
        
        return success_response(
            "Topics generated successfully",
            {
                "topics": topics,
                "questionTypes": question_types,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error generating topics from skill: {exc}")
        raise HTTPException(status_code=500, detail="Failed to generate topics") from exc


@router.post("/validate-question-type")
async def validate_question_type_endpoint(
    payload: ValidateQuestionTypeRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
):
    """
    Validate if a question type is appropriate for a given topic.
    Specifically validates that 'coding' type is only used for topics that support Judge0 execution.
    """
    try:
        # Sanitize input to prevent XSS
        sanitized_topic = sanitize_text_field(payload.topic)
        question_type = payload.questionType.strip()
        
        if not sanitized_topic or not sanitized_topic.strip():
            raise HTTPException(status_code=400, detail="Topic name is required")
        
        if question_type not in ["MCQ", "Subjective", "Pseudo Code", "Descriptive", "coding"]:
            raise HTTPException(
                status_code=400, 
                detail=f"Invalid question type: {question_type}. Must be one of: MCQ, Subjective, Pseudo Code, Descriptive, coding"
            )
        
        # Special validation for coding type
        if question_type == "coding":
            coding_supported = await determine_topic_coding_support(sanitized_topic)
            if not coding_supported:
                # Also determine the appropriate question type for this topic
                suggested_type = await get_question_type_for_topic(sanitized_topic)
                return success_response(
                    "Question type validation failed",
                    {
                        "valid": False,
                        "reason": f"Topic '{sanitized_topic}' does not support coding questions that can be executed by Judge0. Topics related to frameworks, UI/UX, theory, or non-executable concepts do not support coding type.",
                        "suggestedType": suggested_type,
                        "codingSupported": False,
                    }
                )
            return success_response(
                "Question type is valid",
                {
                    "valid": True,
                    "codingSupported": True,
                }
            )
        
        # For non-coding types, they're generally valid for any topic
        # But we can still check if the topic would be better suited for coding
        coding_supported = await determine_topic_coding_support(sanitized_topic)
        suggested_type = await get_question_type_for_topic(sanitized_topic)
        
        return success_response(
            "Question type is valid",
            {
                "valid": True,
                "codingSupported": coding_supported,
                "suggestedType": suggested_type,
                "note": f"Topic supports coding: {coding_supported}. Suggested type: {suggested_type}" if coding_supported and question_type != "coding" else None,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error validating question type: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to validate question type: {str(exc)}") from exc


@router.post("/regenerate-single-topic")
async def regenerate_single_topic_endpoint(
    payload: RegenerateSingleTopicRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Regenerate a new topic name based on skills, update question type and coding support, delete its questions."""
    try:
        # Sanitize input to prevent XSS
        old_topic_name = sanitize_text_field(payload.topic)
        
        if not old_topic_name or not old_topic_name.strip():
            raise HTTPException(status_code=400, detail="Topic name is required")
        
        new_topic_name = old_topic_name
        question_type = "MCQ"
        coding_supported = False
        
        # If assessmentId is provided, regenerate topic based on skills and update the assessment
        if payload.assessmentId:
            assessment = await _get_assessment(db, payload.assessmentId)
            _check_assessment_access(assessment, current_user)
            
            # Get skills and experience from assessment
            selected_skills = assessment.get("selectedSkills", [])
            experience_min = assessment.get("experienceMin", 0)
            experience_max = assessment.get("experienceMax", 10)
            
            # Find the topic to regenerate
            topics = assessment.get("topics", [])
            topic_obj = next((t for t in topics if t.get("topic") == old_topic_name), None)
            
            if topic_obj:
                # Only regenerate technical topics (not aptitude)
                if not topic_obj.get("isAptitude", False) and selected_skills:
                    # Generate a new topic based on skills
                    try:
                        # Filter out aptitude skills
                        _, technical_skills = _separate_skills(selected_skills)
                        if technical_skills:
                            # Generate new topics from skills
                            new_topics = await generate_topics_from_selected_skills(
                                technical_skills,
                                str(experience_min),
                                str(experience_max)
                            )
                            # Use the first generated topic as the new topic name
                            if new_topics and len(new_topics) > 0:
                                new_topic_name = sanitize_text_field(new_topics[0])
                                # Update the topic name in the assessment
                                topic_obj["topic"] = new_topic_name
                    except Exception as e:
                        logger.warning(f"Failed to generate new topic name: {e}. Keeping original topic name.")
                        # If generation fails, keep the old topic name
                        new_topic_name = old_topic_name
                
                # Clear questions for this topic
                topic_obj["questions"] = []
                topic_obj["numQuestions"] = 0
                
                # Get question type and coding support for the new topic
                # Uses get_question_type_for_topic which now properly returns MCQ/Subjective for appropriate topics
                question_type, coding_supported = await asyncio.gather(
                    get_question_type_for_topic(new_topic_name),
                    determine_topic_coding_support(new_topic_name),
                    return_exceptions=True
                )
                
                # Handle exceptions gracefully
                if isinstance(question_type, Exception):
                    logger.warning(f"Failed to determine question type for topic '{new_topic_name}': {question_type}")
                    question_type = "MCQ"  # Safe fallback
                if isinstance(coding_supported, Exception):
                    logger.warning(f"Failed to determine coding support for topic '{new_topic_name}': {coding_supported}")
                    coding_supported = False  # Safe fallback
                
                # Update topic with new question type and coding support
                topic_obj["questionTypes"] = [question_type]
                topic_obj["coding_supported"] = coding_supported
                
                # Save the assessment
                await _save_assessment(db, assessment)
        else:
            # If no assessmentId, just get question type and coding support for the topic
            # Uses get_question_type_for_topic which now properly returns MCQ/Subjective for appropriate topics
            question_type, coding_supported = await asyncio.gather(
                get_question_type_for_topic(new_topic_name),
                determine_topic_coding_support(new_topic_name),
                return_exceptions=True
            )
            
            # Handle exceptions gracefully
            if isinstance(question_type, Exception):
                logger.warning(f"Failed to determine question type for topic '{new_topic_name}': {question_type}")
                question_type = "MCQ"  # Safe fallback
            if isinstance(coding_supported, Exception):
                logger.warning(f"Failed to determine coding support for topic '{new_topic_name}': {coding_supported}")
                coding_supported = False  # Safe fallback
        
        # If question type is "coding" but topic doesn't support coding, change to a safe default
        # The improved get_question_type_for_topic should rarely return "coding" for non-coding topics,
        # but this is a safety check
        if question_type == "coding" and not coding_supported:
            logger.warning(f"Topic '{new_topic_name}' was assigned 'coding' but doesn't support coding. Changing to 'Subjective'.")
            question_type = "Subjective"  # Safe fallback for non-coding topics
        
        return success_response(
            "Topic regenerated successfully",
            {
                "topic": new_topic_name,
                "questionType": question_type,
                "coding_supported": coding_supported,
            }
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error regenerating single topic: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to regenerate topic: {str(exc)}") from exc


@router.post("/delete-topic-questions")
async def delete_topic_questions(
    payload: DeleteTopicQuestionsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Delete questions for a specific topic or all topics."""
    try:
        assessment = await _get_assessment(db, payload.assessmentId)
        _check_assessment_access(assessment, current_user)
        
        topics = assessment.get("topics", [])
        
        if payload.topic:
            # Delete questions for a specific topic only
            topic_obj = next((t for t in topics if t.get("topic") == payload.topic), None)
            if topic_obj:
                topic_obj["questions"] = []
                topic_obj["numQuestions"] = 0
            
            # Clear preview questions for this specific topic only (not all preview questions)
            preview_questions = assessment.get("previewQuestions", [])
            if preview_questions and isinstance(preview_questions, list):
                filtered_preview_questions = [
                    q for q in preview_questions 
                    if q.get("topic") != payload.topic
                ]
                assessment["previewQuestions"] = filtered_preview_questions
                logger.info(f"Deleted preview questions for topic '{payload.topic}'. Remaining preview questions: {len(filtered_preview_questions)}")
        else:
            # Delete questions for all topics
            for topic_obj in topics:
                topic_obj["questions"] = []
                topic_obj["numQuestions"] = 0
            
            # Clear all preview questions only when deleting all topics
            assessment["previewQuestions"] = []
        
        await _save_assessment(db, assessment)
        
        return success_response(
            "Questions deleted successfully",
            {"deleted": True}
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.error(f"Error deleting topic questions: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to delete questions: {str(exc)}") from exc


@router.post("/create-assessment-from-job-designation")
async def create_assessment_from_job_designation(
    payload: CreateAssessmentFromJobDesignationRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Create a new assessment with topics from job designation and selected skills, or update existing if assessmentId is provided."""
    try:
        # Check if we're updating an existing assessment
        existing_assessment = None
        if hasattr(payload, 'assessmentId') and payload.assessmentId:
            try:
                existing_assessment = await _get_assessment(db, payload.assessmentId)
                _check_assessment_access(existing_assessment, current_user)
                logger.info(f"Updating existing assessment {payload.assessmentId} with new topics")
            except HTTPException:
                # Assessment doesn't exist or access denied, create new one
                existing_assessment = None
            except Exception as exc:
                logger.warning(f"Error fetching existing assessment: {exc}. Creating new assessment.")
                existing_assessment = None
        # Sanitize user inputs to prevent XSS
        sanitized_job_designation = sanitize_text_field(payload.jobDesignation)
        sanitized_skills = [sanitize_text_field(skill) for skill in payload.selectedSkills]
        
        # Separate skills into aptitude and technical skills
        aptitude_skills, technical_skills = _separate_skills(sanitized_skills)
        
        # Check if aptitude is requested (from job designation or skills)
        is_aptitude = _is_aptitude_requested(sanitized_job_designation, sanitized_skills)
        
        # Build topics list
        topic_docs = []
        custom_topics = []
        assessment_types = []
        all_question_types = []
        has_technical_topics = False
        
        # Generate aptitude topics if requested
        if is_aptitude:
            aptitude_topics = APTITUDE_MAIN_TOPICS.copy()
            
            for main_topic in aptitude_topics:
                sanitized_main_topic = sanitize_text_field(main_topic)
                sub_topics = get_aptitude_subtopics(main_topic)
                
                topic_doc = {
                    "topic": sanitized_main_topic,
                    "numQuestions": 0,
                    "questionTypes": ["MCQ"],  # Aptitude topics use MCQ
                    "difficulty": "Medium",
                    "source": "Predefined",
                    "category": "aptitude",
                    "questions": [],
                    "questionConfigs": [],
                    "isAptitude": True,  # Flag to identify aptitude topics
                    "subTopics": sub_topics,  # List of available sub-topics
                    "aptitudeStructure": APTITUDE_TOPICS_STRUCTURE[main_topic],  # Full structure for frontend
                }
                topic_docs.append(topic_doc)
                custom_topics.append(sanitized_main_topic)
            
            assessment_types.append("aptitude")
            all_question_types.append("MCQ")
        
        # Generate technical topics if there are technical skills
        if technical_skills:
            # Generate topics from technical skills only
            technical_topics = await generate_topics_from_selected_skills(
                technical_skills, 
                payload.experienceMin, 
                payload.experienceMax
            )
            
            # Process topics in parallel to determine question types and coding support (optimized)
            topic_processing_tasks = []
            for topic in technical_topics:
                sanitized_topic = sanitize_text_field(topic)
                # Create tasks for parallel processing
                topic_processing_tasks.append({
                    "topic": sanitized_topic,
                    "question_type_task": get_question_type_for_topic(sanitized_topic),
                    "coding_support_task": determine_topic_coding_support(sanitized_topic),
                })
            
            # Execute all tasks in parallel for better performance
            for task_info in topic_processing_tasks:
                question_type, coding_supported = await asyncio.gather(
                    task_info["question_type_task"],
                    task_info["coding_support_task"],
                    return_exceptions=True
                )
                
                # Handle exceptions gracefully
                if isinstance(question_type, Exception):
                    logger.warning(f"Failed to determine question type for topic '{task_info['topic']}': {question_type}")
                    question_type = "MCQ"  # Safe fallback
                if isinstance(coding_supported, Exception):
                    logger.warning(f"Failed to determine coding support for topic '{task_info['topic']}': {coding_supported}")
                    coding_supported = False  # Safe fallback
                
                # If question type is "coding" but topic doesn't support coding, change to a safe default
                if question_type == "coding" and not coding_supported:
                    logger.warning(f"Topic '{task_info['topic']}' was assigned 'coding' but doesn't support coding. Changing to 'Subjective'.")
                    question_type = "Subjective"  # Safe fallback for non-coding topics
                
                topic_doc = {
                    "topic": task_info["topic"],
                    "numQuestions": 0,
                    "questionTypes": [question_type],  # Topic-specific question type
                    "difficulty": "Medium",  # Default difficulty
                    "source": "AI",
                    "category": "technical",
                    "questions": [],
                    "questionConfigs": [],
                    "isAptitude": False,  # Flag to identify technical topics
                    "coding_supported": coding_supported,
                }
                topic_docs.append(topic_doc)
                custom_topics.append(task_info["topic"])
                
                # Add question type to all_question_types (avoid duplicates)
                if question_type not in all_question_types:
                    all_question_types.append(question_type)
            
            assessment_types.append("technical")
            has_technical_topics = True
        
        # If no topics were generated, raise an error
        if not topic_docs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid skills selected. Please select at least one technical skill or aptitude."
            )
        
        # Build description
        if is_aptitude and has_technical_topics:
            technical_skills_str = ", ".join(technical_skills)
            description = f"Mixed Assessment (Aptitude + Technical) for {sanitized_job_designation} - Technical Skills: {technical_skills_str} (Experience: {payload.experienceMin}-{payload.experienceMax} years)"
        elif is_aptitude:
            description = f"Aptitude Assessment for {sanitized_job_designation} (Experience: {payload.experienceMin}-{payload.experienceMax} years)"
        else:
            technical_skills_str = ", ".join(technical_skills)
            description = f"Assessment for {sanitized_job_designation} - Skills: {technical_skills_str} (Experience: {payload.experienceMin}-{payload.experienceMax} years)"
        
        # Ensure we have at least one question type
        if not all_question_types:
            all_question_types = ["Subjective"]  # Fallback
        
        # Generate a default title if not provided
        default_title = f"Assessment for {sanitized_job_designation}"
        if is_aptitude and has_technical_topics:
            default_title = f"Mixed Assessment: {sanitized_job_designation}"
        elif is_aptitude:
            default_title = f"Aptitude Assessment: {sanitized_job_designation}"
        
        if existing_assessment:
            # UPDATE EXISTING ASSESSMENT: Replace all topics and clear questions
            existing_assessment["topics"] = topic_docs  # Replace all topics
            existing_assessment["customTopics"] = custom_topics
            existing_assessment["assessmentType"] = assessment_types if assessment_types else ["technical"]
            existing_assessment["updatedAt"] = _now_utc()
            existing_assessment["jobDesignation"] = sanitized_job_designation
            existing_assessment["selectedSkills"] = sanitized_skills
            existing_assessment["experienceMin"] = payload.experienceMin
            existing_assessment["experienceMax"] = payload.experienceMax
            existing_assessment["availableQuestionTypes"] = all_question_types
            existing_assessment["isAptitudeAssessment"] = is_aptitude
            
            # Clear all questions from all topics (regeneration means fresh start)
            for topic_doc in topic_docs:
                topic_doc["questions"] = []
                topic_doc["numQuestions"] = 0
                topic_doc["questionConfigs"] = []
            
            # Clear preview questions as well
            existing_assessment["previewQuestions"] = []
            
            # Update the assessment in database
            await _save_assessment(db, existing_assessment)
            assessment_doc = existing_assessment
            
            logger.info(f"Updated assessment {payload.assessmentId} with {len(topic_docs)} new topics. Cleared all questions.")
        else:
            # CREATE NEW ASSESSMENT
            assessment_doc: Dict[str, Any] = {
                "title": default_title,  # Set default title based on job designation
                "description": description,  # Use generated description
                "topics": topic_docs,
                "customTopics": custom_topics,
                "assessmentType": assessment_types if assessment_types else ["technical"],
                "status": "draft",
                "createdBy": to_object_id(current_user.get("id")),
                "organization": to_object_id(current_user.get("organization")) if current_user.get("organization") else None,
                "isGenerated": False,
                "createdAt": _now_utc(),
                "updatedAt": _now_utc(),
                "jobDesignation": sanitized_job_designation,
                "selectedSkills": sanitized_skills,
                "experienceMin": payload.experienceMin,
                "experienceMax": payload.experienceMax,
                "availableQuestionTypes": all_question_types,
                "isAptitudeAssessment": is_aptitude,  # Flag for frontend (true if aptitude is included)
            }
            
            result = await db.assessments.insert_one(assessment_doc)
            assessment_doc["_id"] = result.inserted_id
        
        return success_response(
            "Assessment created successfully" if not existing_assessment else "Assessment topics regenerated successfully",
            {
                "assessment": serialize_document(assessment_doc),
                "questionTypes": assessment_doc.get("availableQuestionTypes", ["MCQ"]),
            }
        )
    except Exception as exc:
        logger.error(f"Error creating assessment from job designation: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create assessment") from exc


@router.post("/create-assessment-from-skill")
async def create_assessment_from_skill(
    payload: GenerateTopicsFromSkillRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Create a new assessment with topics from skill input."""
    try:
        topics = await generate_topics_from_skill(payload.skill, payload.experienceMin, payload.experienceMax)
        question_types = await get_relevant_question_types(payload.skill)
        
        # Create assessment document
        # Sanitize user inputs to prevent XSS
        sanitized_skill = sanitize_text_field(payload.skill)
        sanitized_topics = [sanitize_text_field(topic) for topic in topics]
        
        assessment_doc: Dict[str, Any] = {
            "title": f"{sanitized_skill} Assessment",
            "description": f"Assessment for {sanitized_skill} (Experience: {payload.experienceMin}-{payload.experienceMax} years)",
            "topics": [
                {
                    "topic": topic,
                    "numQuestions": 0,
                    "questionTypes": [],
                    "difficulty": "Medium",
                    "source": "AI",
                    "category": "technical",
                    "questions": [],
                    "questionConfigs": [],
                }
                for topic in sanitized_topics
            ],
            "customTopics": sanitized_topics,
            "assessmentType": ["technical"],
            "status": "draft",
            "createdBy": to_object_id(current_user.get("id")),
            "organization": to_object_id(current_user.get("organization")) if current_user.get("organization") else None,
            "isGenerated": False,
            "createdAt": _now_utc(),
            "updatedAt": _now_utc(),
            "skill": sanitized_skill,
            "experienceMin": payload.experienceMin,
            "experienceMax": payload.experienceMax,
            "availableQuestionTypes": question_types,
        }
        
        result = await db.assessments.insert_one(assessment_doc)
        assessment_doc["_id"] = result.inserted_id
        
        return success_response(
            "Assessment created successfully",
            {
                "assessment": serialize_document(assessment_doc),
                "questionTypes": question_types,
            }
        )
    except Exception as exc:
        logger.error(f"Error creating assessment from skill: {exc}")
        raise HTTPException(status_code=500, detail="Failed to create assessment") from exc


@router.post("/suggest-time-score")
async def suggest_time_score(
    payload: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(require_editor),
):
    """Get AI suggestions for time and score for a question."""
    question = payload.get("question")
    if not question:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Question is required")
    
    try:
        suggestion = await suggest_time_and_score(question)
        return success_response("Time and score suggested successfully", suggestion)
    except Exception as exc:
        logger.error(f"Error suggesting time and score: {exc}")
        raise HTTPException(status_code=500, detail="Failed to suggest time and score") from exc


@router.post("/generate-questions-from-config")
async def generate_questions_from_config(
    payload: GenerateQuestionsFromConfigRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Generate questions based on topic configuration."""
    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)
    
    # Update topics with configuration
    topics_dict = {t.get("topic"): t for t in assessment.get("topics", [])}
    
    # Track question types and configs per topic (to handle multiple question types per topic)
    topic_question_types: Dict[str, List[str]] = {}
    topic_question_configs: Dict[str, List[Dict[str, Any]]] = {}
    
    for topic_config in payload.topics:
        topic_obj = topics_dict.get(topic_config.topic)
        if topic_obj:
            # Initialize lists if not exists
            if topic_config.topic not in topic_question_types:
                topic_question_types[topic_config.topic] = []
                topic_question_configs[topic_config.topic] = []
            
            # Accumulate question types (avoid duplicates)
            if topic_config.questionType not in topic_question_types[topic_config.topic]:
                topic_question_types[topic_config.topic].append(topic_config.questionType)
            
            # Build question configs for this question type
            for i in range(topic_config.numQuestions):
                q_config = {
                    "questionNumber": len(topic_question_configs[topic_config.topic]) + 1,
                    "type": topic_config.questionType,
                    "difficulty": topic_config.difficulty,
                }
                # Add coding-specific fields if question type is coding
                if topic_config.questionType == "coding":
                    # Always enable Judge0 for coding questions
                    q_config["judge0_enabled"] = True
                    # Set language if specified
                    if topic_config.language:
                        q_config["language"] = topic_config.language
                topic_question_configs[topic_config.topic].append(q_config)
    
    # Update topic objects with accumulated data
    for topic_name, topic_obj in topics_dict.items():
        if topic_name in topic_question_types:
            topic_obj["questionTypes"] = topic_question_types[topic_name]
            topic_obj["questionConfigs"] = topic_question_configs[topic_name]
            # Set numQuestions to total across all question types
            topic_obj["numQuestions"] = len(topic_question_configs[topic_name])
            # Keep difficulty as the first one (or could be a list, but keeping simple for now)
            if topic_question_configs[topic_name]:
                topic_obj["difficulty"] = topic_question_configs[topic_name][0].get("difficulty", "Medium")
    
    # Generate questions for each topic
    all_questions = []
    failed_topics = []
    
    for topic_config in payload.topics:
        topic_obj = topics_dict.get(topic_config.topic)
        if not topic_obj:
            continue
        
        # Validate: Reject coding questions for topics that don't support coding
        if topic_config.questionType == "coding":
            # Dynamically determine coding support (don't rely on stored value which might be outdated)
            coding_supported = await determine_topic_coding_support(topic_config.topic)
            if not coding_supported:
                # Skip this question instead of failing the entire generation
                logger.warning(f"Topic '{topic_config.topic}' does not support coding questions. Skipping this question.")
                failed_topics.append(f"{topic_config.topic} (coding not supported)")
                continue
            # Update the topic object with the correct coding_supported value
            topic_obj["coding_supported"] = coding_supported
            
        config = {
            "numQuestions": topic_config.numQuestions,
        }
        for i in range(1, topic_config.numQuestions + 1):
            config[f"Q{i}type"] = topic_config.questionType
            config[f"Q{i}difficulty"] = topic_config.difficulty
        # Add coding-specific fields if question type is coding
        if topic_config.questionType == "coding":
            # Always enable Judge0 for coding questions
            config["judge0_enabled"] = True
            # Set language if specified
            if topic_config.language:
                config["language"] = topic_config.language
        
        # For aptitude topics, build topic string with sub-topic and question type
        topic_for_generation = topic_config.topic
        if getattr(topic_config, 'isAptitude', False):
            sub_topic = getattr(topic_config, 'subTopic', None)
            question_type = topic_config.questionType
            if sub_topic:
                # Format: "Main Topic - Sub Topic: Question Type"
                # Example: "QUANTITATIVE APTITUDE (Maths) - Number Systems: Divisibility rules"
                topic_for_generation = f"{topic_config.topic} - {sub_topic}: {question_type}"
        
        try:
            questions = await generate_questions_for_topic_safe(topic_for_generation, config)
            if questions:
                # Auto-generate time and score for each question
                for q in questions:
                    q["topic"] = topic_config.topic
                    # Ensure coding-specific fields are set for coding questions
                    if topic_config.questionType == "coding":
                        # Always enable Judge0 for coding questions
                        q["judge0_enabled"] = True
                        # Set language if specified
                        if topic_config.language:
                            q["language"] = topic_config.language
                        # Preserve coding_data (testcases, starter_code, etc.) for Judge0 execution
                        # This data is essential for Judge0 stdin/stdout test case execution
                        if "coding_data" in q:
                            # Ensure testcases are in Judge0 format (stdin/stdout)
                            coding_data = q["coding_data"]
                            if "public_testcases" in coding_data:
                                q["public_testcases"] = coding_data["public_testcases"]
                            if "hidden_testcases" in coding_data:
                                q["hidden_testcases"] = coding_data["hidden_testcases"]
                            if "starter_code" in coding_data:
                                q["starter_code"] = coding_data["starter_code"]
                            if "function_signature" in coding_data:
                                q["function_signature"] = coding_data["function_signature"]
                    try:
                        time_score = await suggest_time_and_score(q)
                        q["time"] = time_score.get("time", 10)
                        q["score"] = time_score.get("score", 5)
                    except Exception as exc:
                        logger.warning(f"Failed to generate time/score for question, using defaults: {exc}")
                        q["time"] = 10
                        q["score"] = 5
                topic_obj["questions"] = questions
                all_questions.extend(questions)
            else:
                failed_topics.append(topic_config.topic)
        except Exception as exc:
            logger.error(f"Error generating questions for topic {topic_config.topic}: {exc}")
            failed_topics.append(topic_config.topic)
    
    assessment["topics"] = list(topics_dict.values())
    assessment["skill"] = payload.skill
    await _save_assessment(db, assessment)
    
    return success_response(
        "Questions generated successfully",
        {
            "totalQuestions": len(all_questions),
            "failedTopics": failed_topics,
            "topics": convert_object_ids(assessment["topics"]),
        }
    )


def _build_generation_config(topic_obj: Dict[str, Any]) -> Dict[str, Any]:
    config = {"numQuestions": topic_obj.get("numQuestions", 0)}
    question_configs = topic_obj.get("questionConfigs") or []
    
    # For aptitude topics, always use MCQ only
    if topic_obj.get("category") == "aptitude":
        num_questions = topic_obj.get("numQuestions", 0)
        difficulty = topic_obj.get("difficulty", "Medium")
        for index in range(num_questions):
            config[f"Q{index + 1}type"] = "MCQ"
            config[f"Q{index + 1}difficulty"] = difficulty
        return config
    
    if question_configs:
        for index, q_config in enumerate(question_configs):
            config[f"Q{index + 1}type"] = q_config.get("type", "Subjective")
            config[f"Q{index + 1}difficulty"] = q_config.get("difficulty", "Medium")
    else:
        question_types = topic_obj.get("questionTypes") or []
        # For technical topics, use only the first question type if multiple are selected
        q_type = question_types[0] if question_types else "Subjective"
        for index in range(topic_obj.get("numQuestions", 0)):
            config[f"Q{index + 1}type"] = q_type
            config[f"Q{index + 1}difficulty"] = topic_obj.get("difficulty", "Medium")
    return config


@router.post("/generate-questions")
async def generate_questions(
    payload: GenerateQuestionsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topics = [
        t
        for t in assessment.get("topics", [])
        if t.get("numQuestions", 0) > 0
        and (
            (t.get("questionTypes") and len(t["questionTypes"]) > 0)
            or (t.get("questionConfigs") and len(t["questionConfigs"]) > 0)
        )
    ]
    if not topics:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No valid topics for question generation")

    results = []
    failed_topics = []
    
    for topic in topics:
        topic = _ensure_topic_structure(topic)
        config = _build_generation_config(topic)
        expected_count = topic.get("numQuestions", 0)
        
        # Retry logic for each topic
        max_retries = 2
        generated_questions = []
        
        for retry in range(max_retries):
            try:
                generated_questions = await generate_questions_for_topic_safe(topic.get("topic"), config)
                # Check if we got enough questions
                if len(generated_questions) >= expected_count:
                    break
                elif retry < max_retries - 1:
                    logger.warning(f"Topic '{topic.get('topic')}' generated only {len(generated_questions)}/{expected_count} questions. Retrying...")
                    await asyncio.sleep(1)  # Brief delay before retry
                else:
                    logger.warning(f"Topic '{topic.get('topic')}' generated only {len(generated_questions)}/{expected_count} questions after retries.")
            except Exception as exc:
                logger.error(f"Error generating questions for topic '{topic.get('topic')}': {exc}")
                if retry < max_retries - 1:
                    await asyncio.sleep(1)
                else:
                    failed_topics.append(topic.get("topic"))
                    break
        
        # If we got some questions but not all, still use what we have
        if generated_questions:
            existing_questions = topic.get("questions", [])
            merged_questions: List[Dict[str, Any]] = []
            for index, new_question in enumerate(generated_questions):
                if index < len(existing_questions):
                    merged = existing_questions[index].copy()
                    merged.update(new_question)
                else:
                    merged = new_question
                
                # Auto-generate time and score if not already set
                if "time" not in merged or "score" not in merged:
                    try:
                        time_score = await suggest_time_and_score(merged)
                        merged["time"] = time_score.get("time", 10)
                        merged["score"] = time_score.get("score", 5)
                    except Exception as exc:
                        logger.warning(f"Failed to generate time/score for question, using defaults: {exc}")
                        merged["time"] = merged.get("time", 10)
                        merged["score"] = merged.get("score", 5)
                
                merged_questions.append(merged)
            topic["questions"] = merged_questions
            results.append({"topic": topic.get("topic"), "questions": merged_questions, "expected": expected_count, "generated": len(merged_questions)})
        else:
            failed_topics.append(topic.get("topic"))
    
    # Save assessment even if some topics failed
    assessment["isGenerated"] = True
    assessment["status"] = "draft"
    await _save_assessment(db, assessment)
    
    if failed_topics:
        logger.warning(f"Failed to generate questions for topics: {failed_topics}")
        if not results:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to generate questions for all topics: {', '.join(failed_topics)}"
            )
    
    return success_response(
        "Questions generated and saved successfully",
        {
            "results": results,
            "failedTopics": failed_topics if failed_topics else None,
            "summary": {
                "totalTopics": len(topics),
                "successfulTopics": len(results),
                "failedTopics": len(failed_topics),
                "totalQuestions": sum(len(r["questions"]) for r in results)
            }
        }
    )


@router.put("/update-questions")
async def update_questions(
    payload: UpdateQuestionsRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topic = next((t for t in assessment.get("topics", []) if t.get("topic") == payload.topic), None)
    if not topic:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found in assessment")

    # Update questions, preserving all properties including time and score
    topic["questions"] = [q.model_dump(exclude_unset=True) for q in payload.updatedQuestions]
    assessment["status"] = "draft"
    await _save_assessment(db, assessment)
    return success_response(
        "Updated questions saved successfully",
        {
            "topic": topic.get("topic"),
            "questions": topic["questions"],
            "totalQuestions": len(topic["questions"]),
        },
    )


@router.put("/update-single-question")
async def update_single_question(
    payload: UpdateSingleQuestionRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topic = next((t for t in assessment.get("topics", []) if t.get("topic") == payload.topic), None)
    if not topic:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found in assessment")

    questions = topic.get("questions", [])
    if payload.questionIndex >= len(questions):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")

    updated_question = questions[payload.questionIndex]
    updated_question.update(payload.updatedQuestion.model_dump(exclude_unset=True))
    updated_question["updatedAt"] = _now_utc()
    assessment["status"] = "draft"
    await _save_assessment(db, assessment)
    return success_response(
        "Question updated successfully",
        {
            "topic": topic.get("topic"),
            "questionIndex": payload.questionIndex,
            "question": updated_question,
        },
    )


@router.post("/add-question")
async def add_new_question(
    payload: AddNewQuestionRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topic = next((t for t in assessment.get("topics", []) if t.get("topic") == payload.topic), None)
    if not topic:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found in assessment")

    topic = _ensure_topic_structure(topic)
    question = payload.newQuestion.model_dump(exclude_unset=True)
    question["createdAt"] = _now_utc()
    question["updatedAt"] = _now_utc()
    topic["questions"].append(question)
    assessment["status"] = "draft"
    await _save_assessment(db, assessment)
    return success_response(
        "Question added successfully",
        {
            "topic": topic.get("topic"),
            "question": question,
            "questionIndex": len(topic["questions"]) - 1,
            "totalQuestions": len(topic["questions"]),
        },
    )


@router.delete("/delete-question")
async def delete_question(
    payload: DeleteQuestionRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)

    topic = next((t for t in assessment.get("topics", []) if t.get("topic") == payload.topic), None)
    if not topic:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found in assessment")

    questions = topic.get("questions", [])
    if payload.questionIndex >= len(questions):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Question not found")

    deleted_question = questions.pop(payload.questionIndex)
    assessment["status"] = "draft"
    await _save_assessment(db, assessment)
    return success_response(
        "Question deleted successfully",
        {
            "topic": topic.get("topic"),
            "deletedQuestion": deleted_question,
            "totalQuestions": len(questions),
        },
    )


@router.post("/finalize-assessment")
async def finalize_assessment(
    payload: FinalizeAssessmentRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        assessment = await _get_assessment(db, payload.assessmentId)
        _check_assessment_access(assessment, current_user)

        assessment["status"] = "ready"
        if payload.title:
            assessment["title"] = sanitize_text_field(payload.title)
        if payload.description:
            assessment["description"] = sanitize_text_field(payload.description)
        if payload.questionTypeTimes:
            assessment["questionTypeTimes"] = payload.questionTypeTimes
        if payload.enablePerSectionTimers is not None:
            assessment["enablePerSectionTimers"] = payload.enablePerSectionTimers
        if payload.passPercentage is not None:
            assessment["passPercentage"] = payload.passPercentage
        assessment["finalizedAt"] = _now_utc()
        
        # Generate assessment token if it doesn't exist
        if not assessment.get("assessmentToken"):
            assessment["assessmentToken"] = secrets.token_urlsafe(32)
        
        await _save_assessment(db, assessment)
        
        # Serialize the assessment document before returning
        serialized_assessment = serialize_document(assessment)
        if serialized_assessment is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to serialize assessment document",
            )
        
        return success_response("Assessment finalized successfully", serialized_assessment)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error finalizing assessment: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to finalize assessment: {str(exc)}",
        ) from exc


@router.get("/get-questions")
async def get_questions_by_topic(
    assessmentId: str = Query(..., alias="assessmentId"),
    topic: str = Query(...),
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, assessmentId)
    _check_assessment_access(assessment, current_user)

    topic_obj = next((t for t in assessment.get("topics", []) if t.get("topic") == topic), None)
    if not topic_obj:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Topic not found")
    return success_response("Questions fetched successfully", topic_obj.get("questions", []))


@router.get("/{assessment_id}/header")
async def get_assessment_header(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, assessment_id)
    _check_assessment_access(assessment, current_user)

    data = {
        "id": str(assessment.get("_id")),
        "title": assessment.get("title"),
        "status": assessment.get("status"),
        "hasSchedule": bool(assessment.get("schedule")),
    }
    return success_response("Assessment header fetched successfully", data)


@router.get("/{assessment_id}/schedule")
async def get_assessment_schedule(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, assessment_id)
    _check_assessment_access(assessment, current_user)

    data = {
        "assessmentId": str(assessment.get("_id")),
        "title": assessment.get("title"),
        "status": assessment.get("status"),
        "schedule": assessment.get("schedule"),
    }
    return success_response("Assessment schedule fetched successfully", data)


@router.put("/update-draft")
async def update_assessment_draft(
    payload: UpdateAssessmentDraftRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Update assessment draft data (preserves placeholder data)."""
    assessment = await _get_assessment(db, payload.assessmentId)
    _check_assessment_access(assessment, current_user)
    
    # Update title and description (even if empty/placeholder)
    if payload.title is not None:
        assessment["title"] = sanitize_text_field(payload.title) if payload.title else ""
    if payload.description is not None:
        assessment["description"] = sanitize_text_field(payload.description) if payload.description else ""
    
    # Update job designation and skills
    if payload.jobDesignation is not None:
        assessment["jobDesignation"] = sanitize_text_field(payload.jobDesignation) if payload.jobDesignation else ""
    if payload.selectedSkills is not None:
        assessment["selectedSkills"] = [sanitize_text_field(skill) for skill in payload.selectedSkills] if payload.selectedSkills else []
    if payload.experienceMin is not None:
        assessment["experienceMin"] = payload.experienceMin
    if payload.experienceMax is not None:
        assessment["experienceMax"] = payload.experienceMax
    
    # Update topics if provided
    if payload.topics is not None:
        # Convert topic configs to the format expected by the assessment
        updated_topics = []
        for topic_config in payload.topics:
            topic_name = sanitize_text_field(topic_config.get("topic", ""))
            if not topic_name:
                continue
                
            # Check if topic already exists
            existing_topic = next((t for t in assessment.get("topics", []) if t.get("topic") == topic_name), None)
            
            if existing_topic:
                # Update existing topic
                topic_obj = existing_topic
            else:
                # Create new topic
                topic_obj = {
                    "topic": topic_name,
                    "numQuestions": 0,
                    "questionTypes": [],
                    "difficulty": "Medium",
                    "source": "manual",
                    "category": "technical",
                    "questions": [],
                    "questionConfigs": [],
                }
            
            # Update topic with question type configs
            question_type_configs = topic_config.get("questionTypeConfigs", [])
            if question_type_configs:
                topic_obj["questionTypes"] = [qtc.get("questionType") for qtc in question_type_configs if qtc.get("questionType")]
                topic_obj["questionConfigs"] = []
                total_questions = 0
                
                for qtc in question_type_configs:
                    q_type = qtc.get("questionType", "MCQ")
                    difficulty = qtc.get("difficulty", "Medium")
                    num_questions = qtc.get("numQuestions", 1)
                    
                    for i in range(num_questions):
                        q_config = {
                            "questionNumber": total_questions + i + 1,
                            "type": q_type,
                            "difficulty": difficulty,
                        }
                        if q_type == "coding":
                            q_config["judge0_enabled"] = qtc.get("judge0_enabled", True)
                            if qtc.get("language"):
                                q_config["language"] = qtc.get("language")
                        topic_obj["questionConfigs"].append(q_config)
                    
                    total_questions += num_questions
                
                topic_obj["numQuestions"] = total_questions
                topic_obj["difficulty"] = question_type_configs[0].get("difficulty", "Medium")
            
            # Handle aptitude topic fields
            if topic_config.get("isAptitude"):
                topic_obj["isAptitude"] = True
                topic_obj["category"] = "aptitude"
                if topic_config.get("subTopic"):
                    topic_obj["subTopic"] = sanitize_text_field(topic_config.get("subTopic"))
                if topic_config.get("aptitudeStructure"):
                    topic_obj["aptitudeStructure"] = topic_config.get("aptitudeStructure")
                if topic_config.get("availableSubTopics"):
                    topic_obj["availableSubTopics"] = topic_config.get("availableSubTopics")
            else:
                # Handle technical topic fields
                topic_obj["isAptitude"] = False
                topic_obj["category"] = "technical"
                # Preserve coding_supported if provided
                if topic_config.get("coding_supported") is not None:
                    topic_obj["coding_supported"] = topic_config.get("coding_supported")
            
            updated_topics.append(topic_obj)
        
        # Update assessment topics
        assessment["topics"] = updated_topics
    
    # Update preview questions if provided
    if payload.previewQuestions is not None:
        assessment["previewQuestions"] = payload.previewQuestions
    
    # Ensure status remains draft
    assessment["status"] = "draft"
    assessment["updatedAt"] = _now_utc()
    
    await _save_assessment(db, assessment)
    return success_response("Draft updated successfully", serialize_document(assessment))


@router.post("/update-schedule-and-candidates")
async def update_schedule_and_candidates(
    payload: Dict[str, Any],
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Update assessment schedule and candidates."""
    assessment_id = payload.get("assessmentId")
    if not assessment_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assessment ID is required")
    
    assessment = await _get_assessment(db, assessment_id)
    _check_assessment_access(assessment, current_user)

    # Update schedule
    schedule = {
        "startTime": payload.get("startTime"),
        "endTime": payload.get("endTime"),
        "timezone": "Asia/Kolkata",  # IST
    }
    assessment["schedule"] = schedule

    # Update candidates - NORMALIZE EMAIL AND NAME
    candidates = payload.get("candidates", [])
    normalized_candidates = []
    for candidate in candidates:
        if isinstance(candidate, dict):
            # Normalize email (lowercase + strip) and name (strip)
            normalized_candidate = {
                "email": candidate.get("email", "").strip().lower(),
                "name": candidate.get("name", "").strip(),
            }
            # Preserve any other fields from the original candidate object
            for key, value in candidate.items():
                if key not in ["email", "name"]:
                    normalized_candidate[key] = value
            normalized_candidates.append(normalized_candidate)
        else:
            # If it's not a dict, keep it as-is (shouldn't happen, but defensive coding)
            normalized_candidates.append(candidate)
    
    assessment["candidates"] = normalized_candidates

    # Update assessment URL and token
    assessment["assessmentUrl"] = payload.get("assessmentUrl")
    assessment["assessmentToken"] = payload.get("token")

    await _save_assessment(db, assessment)
    return success_response("Schedule and candidates updated successfully", serialize_document(assessment))

@router.put("/{assessment_id}/update-schedule")
async def update_assessment_schedule(
    assessment_id: str,
    payload: ScheduleUpdateRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, assessment_id)
    _check_assessment_access(assessment, current_user)

    start_time = payload.startTime
    end_time = payload.endTime
    if start_time >= end_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start time must be before end time")

    schedule = {
        "startTime": start_time,
        "endTime": end_time,
        "duration": payload.duration,
        "durationUnit": payload.durationUnit or "hours",
        "attemptCount": payload.attemptCount or 1,
        "proctoringOptions": payload.proctoringOptions.model_dump(exclude_unset=True)
        if payload.proctoringOptions
        else {
            "enabled": False,
            "webcamRequired": False,
            "screenRecording": False,
            "browserLock": False,
            "fullScreenMode": False,
        },
        "vpnRequired": payload.vpnRequired or False,
        "linkSharingEnabled": payload.linkSharingEnabled or False,
        "mailFeedbackReport": payload.mailFeedbackReport or False,
        "candidateQuestions": payload.candidateQuestions.model_dump(exclude_unset=True)
        if payload.candidateQuestions
        else {
            "allowed": True,
            "maxQuestions": 3,
            "timeLimit": 5,
            "questions": [],
        },
        "instructions": payload.instructions,
        "timezone": payload.timezone or "UTC",
        "isActive": bool(payload.isActive),
    }

    assessment["schedule"] = schedule
    if assessment.get("status") in {"draft", "ready"}:
        assessment["status"] = "scheduled"
    await _save_assessment(db, assessment)
    return success_response(
        "Assessment schedule updated successfully",
        {"assessmentId": str(assessment.get("_id")), "schedule": schedule, "status": assessment.get("status")},
    )


@router.get("/{assessment_id}/topics")
async def get_topics(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, assessment_id)
    _check_assessment_access(assessment, current_user)
    return success_response("Topics fetched successfully", assessment.get("topics", []))


@router.get("/{assessment_id}/answer-logs")
async def get_answer_logs(
    assessment_id: str,
    candidateEmail: str = Query(...),
    candidateName: str = Query(...),
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get answer logs for a specific candidate."""
    try:
        assessment = await _get_assessment(db, assessment_id)
        _check_assessment_access(assessment, current_user)

        # Match the format used in log-answer endpoint: email_lowercase_name_stripped
        # Format: email.strip().lower() + "_" + name.strip()
        # CRITICAL: Must match EXACTLY the format in log-answer endpoint
        candidate_key = f"{candidateEmail.strip().lower()}_{candidateName.strip()}"
        logger.info(f"Fetching answer logs for candidate key: '{candidate_key}' (email='{candidateEmail}', name='{candidateName}')")
        
        answer_logs = assessment.get("answerLogs")
        if not answer_logs or not isinstance(answer_logs, dict):
            logger.info(f"No answerLogs found in assessment or answerLogs is not a dict. Type: {type(answer_logs)}")
            logger.info(f"Assessment ID: {assessment_id}, Full assessment keys: {list(assessment.keys())}")
            # Don't return early - continue to process questions from candidateResponses (especially MCQs)
            answer_logs = {}
        
        logger.info(f"Answer logs keys in database: {list(answer_logs.keys())}")
        logger.info(f"Looking for candidate key: '{candidate_key}'")
        
        # Try exact match first
        candidate_logs = answer_logs.get(candidate_key, {})
        
        # If not found, try to find a similar key (for debugging)
        if not candidate_logs or not isinstance(candidate_logs, dict):
            logger.warning(f"No logs found for candidate key '{candidate_key}'. Available keys: {list(answer_logs.keys())}")
            # Try to find a key that's close (for debugging)
            if answer_logs:
                for key in answer_logs.keys():
                    if candidate_key.lower() in key.lower() or key.lower() in candidate_key.lower():
                        logger.info(f"Found similar key: '{key}' (searching for '{candidate_key}')")
            # Don't return early - continue to process questions from candidateResponses (especially MCQs)
            candidate_logs = {}
        
        logger.info(f"Found candidate logs with question keys: {list(candidate_logs.keys())}")

        # Collect all questions to map question indices
        all_questions = []
        for topic in assessment.get("topics", []):
            if not topic or not isinstance(topic, dict):
                continue
            topic_questions = topic.get("questions", [])
            if topic_questions and isinstance(topic_questions, list):
                for question in topic_questions:
                    if question and isinstance(question, dict):
                        all_questions.append(question)

        # Get AI evaluation results and submitted answers from candidate responses
        candidate_responses = assessment.get("candidateResponses", {})
        ai_evaluation = {}
        submitted_answers = {}  # {questionIndex: answer}
        if isinstance(candidate_responses, dict):
            candidate_response = candidate_responses.get(candidate_key, {})
            if isinstance(candidate_response, dict):
                ai_evaluation = candidate_response.get("aiEvaluation", {})
                # Get submitted answers
                answers_list = candidate_response.get("answers", [])
                if isinstance(answers_list, list):
                    for ans in answers_list:
                        if isinstance(ans, dict):
                            q_idx = ans.get("questionIndex")
                            if q_idx is not None:
                                submitted_answers[q_idx] = ans.get("answer", "")

        # Format logs with question details
        # First, process questions that have logs
        questions_with_logs = set()
        formatted_logs = []
        for question_index_str, log_entries in candidate_logs.items():
            try:
                if not isinstance(log_entries, list):
                    logger.warning(f"Log entries for question {question_index_str} is not a list, skipping")
                    continue
                    
                question_index = int(question_index_str)
                if 0 <= question_index < len(all_questions):
                    question = all_questions[question_index]
                    # Serialize log entries to ensure they're JSON-serializable
                    # Use array index + 1 as version fallback to handle any race conditions during write
                    serialized_logs = []
                    for idx, log_entry in enumerate(log_entries):
                        if isinstance(log_entry, dict):
                            # Use stored version if available, otherwise use array index + 1
                            # This ensures versions are always correct even if there was a race condition
                            stored_version = log_entry.get("version", 0)
                            version = stored_version if stored_version > 0 else (idx + 1)
                            serialized_logs.append({
                                "answer": str(log_entry.get("answer", "")),
                                "questionType": str(log_entry.get("questionType", "")),
                                "timestamp": str(log_entry.get("timestamp", "")),
                                "version": int(version),
                            })
                    
                    # Get AI evaluation for this question
                    question_ai_eval = ai_evaluation.get(str(question_index)) or ai_evaluation.get(question_index)
                    ai_score = None
                    ai_feedback = None
                    if question_ai_eval and isinstance(question_ai_eval, dict):
                        ai_score = question_ai_eval.get("score")
                        ai_feedback = question_ai_eval.get("feedback")
                    
                    # For MCQ questions, check if answer is correct
                    is_mcq_correct = None
                    if question.get("type") == "MCQ":
                        correct_answer = question.get("correctAnswer", "")
                        # Get the last answer from logs
                        if serialized_logs and len(serialized_logs) > 0:
                            last_log = serialized_logs[-1]  # Last version
                            candidate_answer = last_log.get("answer", "").strip()
                            is_mcq_correct = (candidate_answer == correct_answer) if correct_answer else None
                    
                    formatted_logs.append({
                        "questionIndex": question_index,
                        "questionText": str(question.get("questionText", "")),
                        "questionType": str(question.get("type", "")),
                        "logs": serialized_logs,  # Already in order (version 1, 2, 3, etc.)
                        "aiScore": ai_score,  # AI evaluated score (for last version)
                        "aiFeedback": ai_feedback,
                        "maxScore": question.get("score", 5),
                        "isMcqCorrect": is_mcq_correct,  # For MCQ: True/False, for others: None
                        "correctAnswer": question.get("correctAnswer") if question.get("type") == "MCQ" else None,
                        "options": question.get("options", []) if question.get("type") == "MCQ" else None,  # MCQ options
                    })
                    questions_with_logs.add(question_index)
            except (ValueError, TypeError) as e:
                logger.warning(f"Invalid question index in logs: {question_index_str}, error: {e}")
                continue
            except Exception as e:
                logger.warning(f"Error processing log entry for question {question_index_str}: {e}")
                continue

        # Add questions that don't have logs but have submitted answers (especially MCQ)
        # Also include ALL MCQ questions even if they have no logs or submitted answers
        # Get submission time from candidate response
        submission_time = None
        if isinstance(candidate_responses, dict):
            candidate_response = candidate_responses.get(candidate_key, {})
            if isinstance(candidate_response, dict):
                submitted_at = candidate_response.get("submittedAt")
                if submitted_at:
                    submission_time = submitted_at
        if not submission_time:
            submission_time = datetime.now(timezone.utc).isoformat()
        
        for idx, question in enumerate(all_questions):
            if idx not in questions_with_logs and isinstance(question, dict):
                # Check if there's a submitted answer for this question
                submitted_answer = submitted_answers.get(idx)
                
                # For MCQ questions, ALWAYS include them (even if no logs and no submitted answer)
                # For other question types, only include if there's a submitted answer
                is_mcq = question.get("type") == "MCQ"
                should_include = submitted_answer is not None or is_mcq
                
                if should_include:
                    # Create a log entry from submitted answer (or empty for MCQ without answer)
                    serialized_logs = []
                    answer_to_use = str(submitted_answer) if submitted_answer is not None else ""
                    # Always create a log entry for MCQs, even if answer is empty
                    if answer_to_use or is_mcq:
                        # Create a single log entry for the submitted answer
                        serialized_logs.append({
                            "answer": answer_to_use,
                            "questionType": str(question.get("type", "")),
                            "timestamp": submission_time,
                            "version": 1,
                        })
                    
                    # Get AI evaluation for this question
                    question_ai_eval = ai_evaluation.get(str(idx)) or ai_evaluation.get(idx)
                    ai_score = None
                    ai_feedback = None
                    if question_ai_eval and isinstance(question_ai_eval, dict):
                        ai_score = question_ai_eval.get("score")
                        ai_feedback = question_ai_eval.get("feedback")
                    
                    # For MCQ questions, check if answer is correct
                    is_mcq_correct = None
                    if is_mcq:
                        correct_answer = question.get("correctAnswer", "")
                        if answer_to_use:
                            is_mcq_correct = (answer_to_use.strip() == correct_answer) if correct_answer else None
                        else:
                            is_mcq_correct = False  # No answer provided = incorrect
                    
                    formatted_logs.append({
                        "questionIndex": idx,
                        "questionText": str(question.get("questionText", "")),
                        "questionType": str(question.get("type", "")),
                        "logs": serialized_logs,
                        "aiScore": ai_score,
                        "aiFeedback": ai_feedback,
                        "maxScore": question.get("score", 5),
                        "isMcqCorrect": is_mcq_correct,
                        "correctAnswer": question.get("correctAnswer") if is_mcq else None,
                        "options": question.get("options", []) if is_mcq else None,
                    })

        # Sort by question index
        formatted_logs.sort(key=lambda x: x["questionIndex"])

        return success_response("Answer logs fetched successfully", formatted_logs)
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error fetching answer logs: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch answer logs: {str(exc)}",
        ) from exc


@router.get("/{assessment_id}/candidate-results")
async def get_candidate_results(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Get candidate results for an assessment."""
    assessment = await _get_assessment(db, assessment_id)
    _check_assessment_access(assessment, current_user)

    candidate_responses = assessment.get("candidateResponses", {})
    results = []
    
    for key, response in candidate_responses.items():
        results.append({
            "email": response.get("email"),
            "name": response.get("name"),
            "score": response.get("score", 0),
            "maxScore": response.get("maxScore", 0),
            "attempted": response.get("attempted", 0),
            "notAttempted": response.get("notAttempted", 0),
            "correctAnswers": response.get("correctAnswers", 0),
            "submittedAt": response.get("submittedAt"),
            "startedAt": response.get("startedAt"),  # Candidate's actual start time
            # AI evaluation data
            "aiScore": response.get("aiScore", 0),
            "percentageScored": response.get("percentageScored", 0),
            "passPercentage": response.get("passPercentage"),
            "passed": response.get("passed", False),
        })
    
    return success_response("Candidate results fetched successfully", results)


@router.get("/{assessment_id}/questions", response_model=None)
async def get_all_questions(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    logger.info(f"[get_all_questions] GET /api/assessments/{assessment_id}/questions - Request received")
    print(f"[get_all_questions] GET /api/assessments/{assessment_id}/questions - Request received")
    try:
        assessment = await _get_assessment(db, assessment_id)
    except HTTPException as e:
        logger.error(f"[get_all_questions] Error getting assessment {assessment_id}: {e.detail}")
        print(f"[get_all_questions] Error getting assessment {assessment_id}: {e.detail}")
        raise
    _check_assessment_access(assessment, current_user)

    # Generate assessment token if it doesn't exist and assessment is ready/active
    if assessment.get("status") != "draft" and not assessment.get("assessmentToken"):
        assessment["assessmentToken"] = secrets.token_urlsafe(32)
        await _save_assessment(db, assessment)

    questions_with_topics: List[Dict[str, Any]] = []
    for topic in assessment.get("topics", []):
        topic_questions = topic.get("questions") or []
        for index, question in enumerate(topic_questions):
            question_with_topic = question.copy()
            question_with_topic.update(
                {
                    "topic": topic.get("topic"),
                    "topicDifficulty": topic.get("difficulty"),
                    "topicSource": topic.get("source"),
                    "questionIndex": index,
                }
            )
            questions_with_topics.append(question_with_topic)

    # Serialize full assessment with all fields for draft loading
    # Convert topics to serializable format
    serialized_topics = convert_object_ids(assessment.get("topics", []))
    
    data = {
        "assessment": {
            "id": str(assessment.get("_id")),
            "title": assessment.get("title"),
            "description": assessment.get("description"),
            "status": assessment.get("status"),
            "totalQuestions": len(questions_with_topics),
            "schedule": assessment.get("schedule"),
            "assessmentToken": assessment.get("assessmentToken"),
            # Include all assessment fields needed for draft loading
            "jobDesignation": assessment.get("jobDesignation"),
            "selectedSkills": assessment.get("selectedSkills"),
            "experienceMin": assessment.get("experienceMin"),
            "experienceMax": assessment.get("experienceMax"),
            "availableQuestionTypes": assessment.get("availableQuestionTypes"),
            "isAptitudeAssessment": assessment.get("isAptitudeAssessment"),
            "topics": serialized_topics,  # Include full topic objects with all fields (questionConfigs, isAptitude, coding_supported, etc.)
            "previewQuestions": assessment.get("previewQuestions"),
            "passPercentage": assessment.get("passPercentage"),
            "questionTypeTimes": assessment.get("questionTypeTimes"),
            "enablePerSectionTimers": assessment.get("enablePerSectionTimers"),
            "candidates": assessment.get("candidates"),
            "assessmentUrl": assessment.get("assessmentUrl"),
        },
        "topics": [
            {
                "topic": topic.get("topic"),
                "numQuestions": topic.get("numQuestions"),
                "questionTypes": topic.get("questionTypes"),
                "difficulty": topic.get("difficulty"),
                "source": topic.get("source"),
                "questionCount": len(topic.get("questions") or []),
            }
            for topic in assessment.get("topics", [])
        ],
        "questions": questions_with_topics,
    }
    return success_response("All questions fetched successfully", data)


@router.get("")
async def get_all_assessments_with_schedule(
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    try:
        query: Dict[str, Any] = {}
        if current_user.get("role") != "super_admin":
            user_org = current_user.get("organization")
            user_id = current_user.get("id")
            
            # Build query based on user's organization
            if user_org:
                # User has organization - query by organization
                try:
                    query["organization"] = to_object_id(user_org)
                except ValueError:
                    # Invalid organization ID - fall back to createdBy
                    if user_id:
                        try:
                            query["createdBy"] = to_object_id(user_id)
                        except ValueError:
                            pass
            else:
                # User has no organization - query by createdBy
                if user_id:
                    try:
                        query["createdBy"] = to_object_id(user_id)
                    except ValueError:
                        pass

        # Fetch assessments with required fields - optimized query
        # Limit to prevent loading too many documents at once (safety limit)
        cursor = db.assessments.find(query, {"title": 1, "status": 1, "schedule": 1, "createdAt": 1, "updatedAt": 1, "organization": 1, "createdBy": 1}).limit(1000)
        all_docs = await cursor.to_list(length=1000)  # Fetch all at once with limit
        
        assessments = []
        
        # Process documents in batch
        for doc in all_docs:
            try:
                # Quick access check - skip if user doesn't have access
                # Only check if query didn't already filter by organization/createdBy
                if current_user.get("role") != "super_admin":
                    try:
                        _check_assessment_access(doc, current_user)
                    except HTTPException:
                        continue  # Skip this assessment
                
                schedule = doc.get("schedule")
                assessment_data = {
                    "id": str(doc.get("_id")),
                    "title": doc.get("title", ""),
                    "status": doc.get("status", "draft"),
                    "hasSchedule": bool(schedule),
                    "scheduleStatus": None,
                    "createdAt": doc.get("createdAt"),
                    "updatedAt": doc.get("updatedAt"),
                }
                
                if schedule:
                    assessment_data["scheduleStatus"] = {
                        "startTime": schedule.get("startTime"),
                        "endTime": schedule.get("endTime"),
                        "duration": schedule.get("duration"),
                        "isActive": schedule.get("isActive", False),
                    }
                
                # Serialize datetime and ObjectId fields recursively
                assessments.append(convert_object_ids(assessment_data))
            except HTTPException:
                # Access denied - skip this assessment
                continue
            except Exception as exc:
                logger.warning("Error processing assessment document: %s", exc)
                # Skip this assessment if there's an error processing it
                continue

        return success_response("Assessments with schedule status fetched successfully", assessments)
    except Exception as exc:
        logger.exception("Error fetching assessments: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to fetch assessments: {str(exc)}",
        ) from exc


@router.delete("/{assessment_id}")
async def delete_assessment(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Delete an assessment. Only users with access to the assessment can delete it."""
    try:
        assessment = await _get_assessment(db, assessment_id)
        _check_assessment_access(assessment, current_user)

        # Delete the assessment
        result = await db.assessments.delete_one({"_id": to_object_id(assessment_id)})
        
        if result.deleted_count == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assessment not found or already deleted",
            )

        return success_response("Assessment deleted successfully", {"assessmentId": assessment_id})
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("Error deleting assessment: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete assessment: {str(exc)}",
        ) from exc



