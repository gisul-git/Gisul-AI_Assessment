from pydantic import BaseModel, Field, GetJsonSchemaHandler
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import core_schema
from typing import List, Dict, Optional, Any
from datetime import datetime
from bson import ObjectId

class PyObjectId(ObjectId):
    @classmethod
    def __get_pydantic_core_schema__(
        cls, source_type: Any, handler: Any
    ) -> core_schema.CoreSchema:
        return core_schema.json_or_python_schema(
            json_schema=core_schema.str_schema(),
            python_schema=core_schema.union_schema([
                core_schema.is_instance_schema(ObjectId),
                core_schema.chain_schema([
                    core_schema.str_schema(),
                    core_schema.no_info_plain_validator_function(cls.validate),
                ])
            ]),
            serialization=core_schema.plain_serializer_function_ser_schema(
                lambda x: str(x)
            ),
        )

    @classmethod
    def validate(cls, v):
        if isinstance(v, ObjectId):
            return v
        if isinstance(v, str):
            if ObjectId.is_valid(v):
                return ObjectId(v)
            raise ValueError("Invalid ObjectId")
        raise ValueError("Invalid ObjectId")

    @classmethod
    def __get_pydantic_json_schema__(
        cls, _core_schema: core_schema.CoreSchema, handler: GetJsonSchemaHandler
    ) -> JsonSchemaValue:
        return {"type": "string"}

class TestCase(BaseModel):
    input: str
    expected_output: str
    is_hidden: bool = False

class StarterCode(BaseModel):
    language: str
    code: str

class FunctionParameter(BaseModel):
    """Defines a function parameter"""
    name: str           # e.g., "nums", "target"
    type: str           # e.g., "int[]", "int", "string"

class FunctionSignature(BaseModel):
    """Defines the expected function signature for code wrapping"""
    name: str                           # e.g., "twoSum", "isPrime"
    parameters: List[FunctionParameter] # Function parameters
    return_type: str                    # e.g., "int[]", "boolean", "string"

class Example(BaseModel):
    """A single example with input, output, and optional explanation"""
    input: str              # e.g., "nums = [2,7,11,15], target = 9"
    output: str             # e.g., "[0,1]"
    explanation: Optional[str] = None  # e.g., "Because nums[0] + nums[1] == 9"

class Question(BaseModel):
    id: Optional[PyObjectId] = Field(default_factory=PyObjectId, alias="_id")
    title: str
    
    # LeetCode-style 3-part description
    description: str                    # Problem statement (Markdown)
    examples: List[Example] = []        # Input/Output examples
    constraints: List[str] = []         # e.g., ["2 <= nums.length <= 10^4", "-10^9 <= nums[i] <= 10^9"]
    
    difficulty: str  # easy, medium, hard
    languages: List[str]  # Any language Judge0 supports
    public_testcases: List[TestCase]
    hidden_testcases: List[TestCase]
    starter_code: Dict[str, str]  # {language: code}
    # Function signature for code wrapping (optional)
    function_signature: Optional[FunctionSignature] = None
    # If True, user code will be validated and wrapped
    secure_mode: bool = False
    # Admin-defined wrapper template for code execution
    wrapper_template: Optional[str] = None
    is_published: bool = False  # Whether question is visible to users
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    model_config = {
        "populate_by_name": True,
        "arbitrary_types_allowed": True,
        "json_encoders": {ObjectId: str},
    }

class QuestionCreate(BaseModel):
    title: str
    # LeetCode-style 3-part description
    description: str                    # Problem statement
    examples: List[Example] = []        # Input/Output examples  
    constraints: List[str] = []         # Constraints like "1 <= n <= 10^5"
    
    difficulty: str
    languages: List[str]  # Any language Judge0 supports
    public_testcases: List[TestCase]
    hidden_testcases: List[TestCase]
    starter_code: Dict[str, str]
    function_signature: Optional[FunctionSignature] = None
    secure_mode: bool = False
    wrapper_template: Optional[str] = None
    is_published: bool = False

class QuestionUpdate(BaseModel):
    title: Optional[str] = None
    # LeetCode-style 3-part description
    description: Optional[str] = None
    examples: Optional[List[Example]] = None
    constraints: Optional[List[str]] = None
    
    difficulty: Optional[str] = None
    languages: Optional[List[str]] = None
    public_testcases: Optional[List[TestCase]] = None
    hidden_testcases: Optional[List[TestCase]] = None
    starter_code: Optional[Dict[str, str]] = None
    function_signature: Optional[FunctionSignature] = None
    secure_mode: Optional[bool] = None
    wrapper_template: Optional[str] = None
    is_published: Optional[bool] = None

