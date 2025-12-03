from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime
from bson import ObjectId
from .question import PyObjectId

class Test(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    title: str
    description: str
    question_ids: List[str]
    duration_minutes: int
    start_time: datetime
    end_time: datetime
    created_by: str  # Admin user ID
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True
    is_published: bool = False  # Whether test is published and available to invited users
    invited_users: List[str] = []  # List of user emails who are invited to take the test
    test_token: Optional[str] = None  # Single shared token for all candidates in this test

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "json_encoders": {ObjectId: str},
    }

class TestCreate(BaseModel):
    title: str
    description: str
    question_ids: List[str]
    duration_minutes: int
    start_time: datetime
    end_time: datetime
    invited_users: List[str] = []  # List of user emails to invite

class TestInviteRequest(BaseModel):
    test_id: str
    user_emails: List[str]  # List of emails to invite

class AddCandidateRequest(BaseModel):
    test_id: str
    name: str
    email: str

class CandidateLinkResponse(BaseModel):
    candidate_id: str
    test_link: str
    name: str
    email: str

class TestSubmission(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    test_id: str
    user_id: str
    submissions: List[str]  # List of submission IDs
    score: int
    started_at: datetime
    submitted_at: Optional[datetime] = None
    is_completed: bool = False

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "json_encoders": {ObjectId: str},
    }

