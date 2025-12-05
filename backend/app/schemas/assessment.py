from __future__ import annotations

from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


QUESTION_TYPES = {"MCQ", "Subjective", "Pseudo Code", "Descriptive", "Aptitude", "Reasoning", "coding"}
DIFFICULTY_LEVELS = {"Easy", "Medium", "Hard"}
STATUS_VALUES = {"draft", "ready", "scheduled", "active", "completed"}


class QuestionConfig(BaseModel):
    questionNumber: int = Field(..., ge=1)
    type: str = Field(...)
    difficulty: str = Field(default="Medium")

    def model_post_init(self, __context: dict[str, object]) -> None:
        if self.type not in QUESTION_TYPES:
            raise ValueError("Invalid question type")
        if self.difficulty not in DIFFICULTY_LEVELS:
            raise ValueError("Invalid difficulty level")


class Question(BaseModel):
    questionText: str
    type: str
    difficulty: str
    options: Optional[List[str]] = None
    correctAnswer: Optional[str] = None
    idealAnswer: Optional[str] = None
    expectedLogic: Optional[str] = None
    time: Optional[int] = None  # Time in minutes
    score: Optional[int] = None  # Score in points
    judge0_enabled: Optional[bool] = None  # For coding questions: whether Judge0 is enabled
    language: Optional[str] = None  # For coding questions: selected language ID (e.g., "50" for C)
    createdAt: Optional[datetime] = None
    updatedAt: Optional[datetime] = None


class TopicUpdate(BaseModel):
    topic: str
    numQuestions: Optional[int] = None
    questionTypes: Optional[List[str]] = None
    difficulty: Optional[str] = None
    questions: Optional[List[Question]] = None
    questionConfigs: Optional[List[QuestionConfig]] = None


class AptitudeCategoryConfig(BaseModel):
    enabled: bool = False
    difficulty: str = Field(default="Medium")
    numQuestions: int = Field(default=0, ge=0)

    def model_post_init(self, __context: dict[str, object]) -> None:
        if self.difficulty not in DIFFICULTY_LEVELS:
            raise ValueError("Invalid difficulty level")


class AptitudeConfig(BaseModel):
    quantitative: Optional[AptitudeCategoryConfig] = None
    logicalReasoning: Optional[AptitudeCategoryConfig] = None
    verbalAbility: Optional[AptitudeCategoryConfig] = None
    numericalReasoning: Optional[AptitudeCategoryConfig] = None


class GenerateTopicsRequest(BaseModel):
    assessmentType: List[str] = Field(..., min_length=1)  # ["aptitude"], ["technical"], or ["aptitude", "technical"]
    # Technical fields (required only if "technical" is in assessmentType)
    jobRole: Optional[str] = None
    experience: Optional[str] = None
    skills: Optional[List[str]] = None
    numTopics: Optional[int] = Field(default=None, gt=0)  # Number of topics to generate for technical assessment
    # Aptitude fields (required only if "aptitude" is in assessmentType)
    aptitudeConfig: Optional[AptitudeConfig] = None


class UpdateTopicSettingsRequest(BaseModel):
    assessmentId: str
    updatedTopics: List[TopicUpdate]


class AddCustomTopicsRequest(BaseModel):
    assessmentId: str
    newTopics: List[TopicUpdate | str]


class RemoveCustomTopicsRequest(BaseModel):
    assessmentId: str
    topicsToRemove: List[str]


class GenerateQuestionsRequest(BaseModel):
    assessmentId: str


class UpdateQuestionsRequest(BaseModel):
    assessmentId: str
    topic: str
    updatedQuestions: List[Question]


class UpdateSingleQuestionRequest(BaseModel):
    assessmentId: str
    topic: str
    questionIndex: int = Field(..., ge=0)
    updatedQuestion: Question


class AddNewQuestionRequest(BaseModel):
    assessmentId: str
    topic: str
    newQuestion: Question


class DeleteQuestionRequest(BaseModel):
    assessmentId: str
    topic: str
    questionIndex: int = Field(..., ge=0)


class DeleteTopicQuestionsRequest(BaseModel):
    assessmentId: str
    topic: Optional[str] = None  # If None, deletes questions for all topics


class UpdateAssessmentDraftRequest(BaseModel):
    assessmentId: str
    title: Optional[str] = None
    description: Optional[str] = None


class FinalizeAssessmentRequest(BaseModel):
    assessmentId: str
    title: Optional[str] = None
    description: Optional[str] = None
    questionTypeTimes: Optional[Dict[str, int]] = None  # Time in minutes per question type
    enablePerSectionTimers: Optional[bool] = True  # Whether to enable per-section timers
    passPercentage: Optional[float] = Field(default=None, ge=0, le=100)  # Pass percentage (0-100)


class LogAnswerRequest(BaseModel):
    assessmentId: str = Field(..., min_length=1, max_length=100)
    token: str = Field(..., min_length=1, max_length=200)
    email: str = Field(..., min_length=1, max_length=255)
    name: str = Field(..., min_length=1, max_length=200)
    questionIndex: int = Field(..., ge=0)
    answer: str = Field(..., max_length=50000)  # Max 50KB answer text
    questionType: str = Field(..., max_length=50)


# New flow schemas
class GenerateTopicsFromSkillRequest(BaseModel):
    skill: str = Field(..., min_length=1)
    experienceMin: str = Field(default="0")
    experienceMax: str = Field(default="10")


class RegenerateSingleTopicRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    assessmentId: Optional[str] = None  # If provided, regenerates topic based on assessment skills


class GenerateTopicCardsRequest(BaseModel):
    jobDesignation: str = Field(..., min_length=1)
    experienceMin: Optional[int] = Field(default=0, ge=0, le=20)
    experienceMax: Optional[int] = Field(default=10, ge=0, le=20)


class CreateAssessmentFromJobDesignationRequest(BaseModel):
    assessmentId: Optional[str] = Field(default=None, description="Optional: If provided, updates existing assessment instead of creating new one")
    jobDesignation: str = Field(..., min_length=1)
    selectedSkills: List[str] = Field(..., min_length=1)
    experienceMin: str = Field(default="0")
    experienceMax: str = Field(default="10")


class TopicConfigRow(BaseModel):
    topic: str
    questionType: str
    difficulty: str = Field(default="Medium")
    numQuestions: int = Field(default=1, ge=1)
    # Aptitude topic fields
    isAptitude: Optional[bool] = False
    subTopic: Optional[str] = None
    # Coding question fields
    judge0_enabled: Optional[bool] = None  # For coding questions: whether Judge0 is enabled
    language: Optional[str] = None  # For coding questions: selected language ID


class GenerateQuestionsFromConfigRequest(BaseModel):
    assessmentId: str
    skill: str
    topics: List[TopicConfigRow]


class ScheduleCandidateQuestions(BaseModel):
    allowed: bool = True
    maxQuestions: int = 3
    timeLimit: int = 5
    questions: List[dict] = Field(default_factory=list)


class ProctoringOptions(BaseModel):
    enabled: bool = False
    webcamRequired: bool = False
    screenRecording: bool = False
    browserLock: bool = False
    fullScreenMode: bool = False


class ScheduleUpdateRequest(BaseModel):
    startTime: datetime
    endTime: datetime
    duration: int = Field(..., gt=0)
    durationUnit: Optional[str] = Field(default="hours")
    attemptCount: Optional[int] = Field(default=1, ge=1)
    proctoringOptions: Optional[ProctoringOptions] = None
    vpnRequired: Optional[bool] = False
    linkSharingEnabled: Optional[bool] = False
    mailFeedbackReport: Optional[bool] = False
    candidateQuestions: Optional[ScheduleCandidateQuestions] = None
    instructions: Optional[str] = None
    timezone: Optional[str] = Field(default="UTC")
    isActive: Optional[bool] = False


class AssessmentScheduleUpdateRequest(BaseModel):
    assessmentId: str
    schedule: ScheduleUpdateRequest


class ValidateQuestionTypeRequest(BaseModel):
    topic: str = Field(..., min_length=1)
    questionType: str = Field(..., min_length=1)
