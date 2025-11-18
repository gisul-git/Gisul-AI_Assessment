from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from motor.motor_asyncio import AsyncIOMotorDatabase

from ..core.dependencies import require_editor
from ..db.mongo import get_db
from ..schemas.assessment import (
    AddCustomTopicsRequest,
    AddNewQuestionRequest,
    CreateAssessmentFromJobDesignationRequest,
    DeleteQuestionRequest,
    FinalizeAssessmentRequest,
    GenerateQuestionsFromConfigRequest,
    GenerateQuestionsRequest,
    GenerateTopicCardsRequest,
    GenerateTopicsFromSkillRequest,
    GenerateTopicsRequest,
    RemoveCustomTopicsRequest,
    ScheduleUpdateRequest,
    TopicConfigRow,
    UpdateQuestionsRequest,
    UpdateSingleQuestionRequest,
    UpdateTopicSettingsRequest,
)
from ..services.ai import (
    generate_questions_for_topic_safe,
    generate_topics_from_input,
    generate_topics_from_skill,
    generate_topics_from_selected_skills,
    generate_topic_cards_from_job_designation,
    get_relevant_question_types,
    get_relevant_question_types_from_domain,
)
from ..utils.mongo import convert_object_ids, serialize_document, to_object_id
from ..utils.responses import success_response

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
                    }
                )
                custom_topics.append(category_name)
                title_parts.append(category_name)
                description_parts.append(f"{category_name} ({category_config.difficulty})")

    # Handle Technical topics
    if "technical" in assessment_types:
        topics = await generate_topics_from_input(payload.jobRole, payload.experience, payload.skills, payload.numTopics)
        technical_topic_docs = [
            {
                "topic": t,
                "numQuestions": 0,
                "questionTypes": [],
                "difficulty": "Medium",
                "source": "AI",
                "category": "technical",
                "questions": [],
                "questionConfigs": [],
            }
            for t in topics
        ]
        topic_docs.extend(technical_topic_docs)
        custom_topics.extend(topics)
        title_parts.append(payload.jobRole)
        description_parts.append(f"{payload.jobRole} test for {payload.experience} exp level")

    # Build title and description
    if len(title_parts) == 1:
        title = f"{title_parts[0]} Assessment"
    elif len(title_parts) == 2:
        title = f"{title_parts[0]} & {title_parts[1]} Assessment"
    else:
        title = "Assessment"

    description = ". ".join(description_parts) if description_parts else "Assessment"

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
        topic_obj = next((t for t in topics if t.get("topic") == update.topic), None)
        if not topic_obj:
            continue
        topic_obj = _ensure_topic_structure(topic_obj)

        if update.numQuestions is not None:
            topic_obj["numQuestions"] = update.numQuestions
        if update.questionTypes is not None:
            topic_obj["questionTypes"] = update.questionTypes
        if update.difficulty:
            topic_obj["difficulty"] = update.difficulty

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
            topic_name = topic_data
            exists = any(t.get("topic") == topic_name for t in topics)
            if not exists:
                topics.append(
                    {
                        "topic": topic_name,
                        "numQuestions": 0,
                        "questionTypes": [],
                        "difficulty": "Medium",
                        "source": "User",
                        "questions": [],
                        "questionConfigs": [],
                    }
                )
            custom_topics.add(topic_name)
        else:
            topic_dict = topic_data.model_dump(exclude_unset=True)
            topic_name = topic_dict.get("topic")
            exists = any(t.get("topic") == topic_name for t in topics)
            if not exists:
                topics.append(
                    {
                        "topic": topic_name,
                        "numQuestions": topic_dict.get("numQuestions", 0),
                        "questionTypes": topic_dict.get("questionTypes", []),
                        "difficulty": topic_dict.get("difficulty", "Medium"),
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
    assessment["topics"] = [t for t in assessment.get("topics", []) if t.get("topic") not in topics_to_remove]
    assessment["customTopics"] = [t for t in assessment.get("customTopics", []) if t not in topics_to_remove]

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
        cards = await generate_topic_cards_from_job_designation(payload.jobDesignation)
        
        return success_response(
            "Topic cards generated successfully",
            {
                "cards": cards,
            }
        )
    except Exception as exc:
        logger.error(f"Error generating topic cards: {exc}")
        raise HTTPException(status_code=500, detail="Failed to generate topic cards") from exc


@router.post("/generate-topics-from-skill")
async def generate_topics_from_skill_endpoint(
    payload: GenerateTopicsFromSkillRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Generate topics from a single skill/domain input."""
    try:
        topics = await generate_topics_from_skill(payload.skill, payload.experienceMin, payload.experienceMax)
        question_types = await get_relevant_question_types(payload.skill)
        
        return success_response(
            "Topics generated successfully",
            {
                "topics": topics,
                "questionTypes": question_types,
            }
        )
    except Exception as exc:
        logger.error(f"Error generating topics from skill: {exc}")
        raise HTTPException(status_code=500, detail="Failed to generate topics") from exc


@router.post("/create-assessment-from-job-designation")
async def create_assessment_from_job_designation(
    payload: CreateAssessmentFromJobDesignationRequest,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    """Create a new assessment with topics from job designation and selected skills."""
    try:
        # Generate topics from selected skills
        topics = await generate_topics_from_selected_skills(
            payload.selectedSkills, 
            payload.experienceMin, 
            payload.experienceMax
        )
        
        # Get question types based on the job designation/domain (AI-powered detection)
        question_types = await get_relevant_question_types_from_domain(payload.jobDesignation)
        
        # Create assessment document
        skills_str = ", ".join(payload.selectedSkills)
        assessment_doc: Dict[str, Any] = {
            "title": f"{payload.jobDesignation} Assessment",
            "description": f"Assessment for {payload.jobDesignation} - Skills: {skills_str} (Experience: {payload.experienceMin}-{payload.experienceMax} years)",
            "topics": [
                {
                    "topic": topic,
                    "numQuestions": 0,
                    "questionTypes": [question_types[0] if question_types else "Subjective"],  # Default question type
                    "difficulty": "Medium",  # Default difficulty
                    "source": "AI",
                    "category": "technical",
                    "questions": [],
                    "questionConfigs": [],
                }
                for topic in topics
            ],
            "customTopics": topics,
            "assessmentType": ["technical"],
            "status": "draft",
            "createdBy": to_object_id(current_user.get("id")),
            "organization": to_object_id(current_user.get("organization")) if current_user.get("organization") else None,
            "isGenerated": False,
            "createdAt": _now_utc(),
            "updatedAt": _now_utc(),
            "jobDesignation": payload.jobDesignation,
            "selectedSkills": payload.selectedSkills,
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
        assessment_doc: Dict[str, Any] = {
            "title": f"{payload.skill} Assessment",
            "description": f"Assessment for {payload.skill} (Experience: {payload.experienceMin}-{payload.experienceMax} years)",
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
                for topic in topics
            ],
            "customTopics": topics,
            "assessmentType": ["technical"],
            "status": "draft",
            "createdBy": to_object_id(current_user.get("id")),
            "organization": to_object_id(current_user.get("organization")) if current_user.get("organization") else None,
            "isGenerated": False,
            "createdAt": _now_utc(),
            "updatedAt": _now_utc(),
            "skill": payload.skill,
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
    
    for topic_config in payload.topics:
        topic_obj = topics_dict.get(topic_config.topic)
        if topic_obj:
            topic_obj["numQuestions"] = topic_config.numQuestions
            topic_obj["difficulty"] = topic_config.difficulty
            topic_obj["questionTypes"] = [topic_config.questionType]
            
            # Build question configs
            question_configs = []
            for i in range(topic_config.numQuestions):
                question_configs.append({
                    "questionNumber": i + 1,
                    "type": topic_config.questionType,
                    "difficulty": topic_config.difficulty,
                })
            topic_obj["questionConfigs"] = question_configs
    
    # Generate questions for each topic
    all_questions = []
    failed_topics = []
    
    for topic_config in payload.topics:
        topic_obj = topics_dict.get(topic_config.topic)
        if not topic_obj:
            continue
            
        config = {
            "numQuestions": topic_config.numQuestions,
        }
        for i in range(1, topic_config.numQuestions + 1):
            config[f"Q{i}type"] = topic_config.questionType
            config[f"Q{i}difficulty"] = topic_config.difficulty
        
        try:
            questions = await generate_questions_for_topic_safe(topic_config.topic, config)
            if questions:
                for q in questions:
                    q["topic"] = topic_config.topic
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
            assessment["title"] = payload.title
        if payload.description:
            assessment["description"] = payload.description
        assessment["finalizedAt"] = _now_utc()
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

    # Update candidates
    candidates = payload.get("candidates", [])
    assessment["candidates"] = candidates

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


@router.get("/{assessment_id}/questions")
async def get_all_questions(
    assessment_id: str,
    current_user: Dict[str, Any] = Depends(require_editor),
    db: AsyncIOMotorDatabase = Depends(get_db),
):
    assessment = await _get_assessment(db, assessment_id)
    _check_assessment_access(assessment, current_user)

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

    data = {
        "assessment": {
            "id": str(assessment.get("_id")),
            "title": assessment.get("title"),
            "description": assessment.get("description"),
            "status": assessment.get("status"),
            "totalQuestions": len(questions_with_topics),
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



