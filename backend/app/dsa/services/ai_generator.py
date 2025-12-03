"""
AI Question Generator - LANGUAGE AGNOSTIC

Generates coding questions using OpenAI.
Creates LeetCode-style questions with 3 parts:
1. Description - Problem statement
2. Examples - Input/Output examples with explanations
3. Constraints - Input limits and requirements

The admin specifies which languages to generate starter code for.
"""

import os
import json
from dotenv import load_dotenv
from typing import Dict, Any, List, Optional

from openai import OpenAI

load_dotenv()


async def generate_question(
    difficulty: str = "medium", 
    topic: Optional[str] = None,
    concepts: Optional[str] = None,
    languages: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Generate a complete coding question using OpenAI.
    
    Creates LeetCode-style question with:
    - description: Problem statement
    - examples: Input/Output examples with explanations
    - constraints: Input limits
    
    Args:
        difficulty: easy, medium, or hard
        topic: Main topic (e.g., "arrays", "dynamic programming")
        concepts: Specific concepts to cover (e.g., "two pointers, sliding window")
        languages: List of languages to generate starter code for (optional)
    
    Returns:
        Complete question JSON with all fields populated
    """
    # Default to all supported DSA languages if none specified
    if not languages:
        languages = ["python", "javascript", "typescript", "cpp", "java", "c", "go", "rust", "kotlin", "csharp"]
    
    languages_str = json.dumps(languages)
    
    # Build topic/concept prompt
    topic_prompt = ""
    if topic:
        topic_prompt += f"Topic: {topic}. "
    if concepts:
        topic_prompt += f"Concepts to cover: {concepts}. "
    
    prompt = f"""You are an expert coding problem generator. Generate a LeetCode-style coding question in JSON format.

{topic_prompt}Difficulty: {difficulty}
Languages to support: {languages_str}

Generate a JSON object with this EXACT structure (like LeetCode):
{{
    "title": "Problem Title",
    
    "description": "Clear problem statement explaining what needs to be done. NO examples here, NO constraints here. Just the problem description in 2-3 paragraphs.",
    
    "examples": [
        {{
            "input": "nums = [2,7,11,15], target = 9",
            "output": "[0,1]",
            "explanation": "Because nums[0] + nums[1] == 9, we return [0, 1]."
        }},
        {{
            "input": "nums = [3,2,4], target = 6",
            "output": "[1,2]",
            "explanation": "Because nums[1] + nums[2] == 6, we return [1, 2]."
        }},
        {{
            "input": "nums = [3,3], target = 6",
            "output": "[0,1]",
            "explanation": null
        }}
    ],
    
    "constraints": [
        "2 <= nums.length <= 10^4",
        "-10^9 <= nums[i] <= 10^9",
        "-10^9 <= target <= 10^9",
        "Only one valid answer exists."
    ],
    
    "difficulty": "{difficulty}",
    "languages": {languages_str},
    
    "function_signature": {{
        "name": "functionName",
        "parameters": [
            {{"name": "param1", "type": "int"}},
            {{"name": "param2", "type": "string"}}
        ],
        "return_type": "int"
    }},
    
    "public_testcases": [
        {{"input": "exact stdin input", "expected_output": "exact expected output", "is_hidden": false}},
        {{"input": "exact stdin input", "expected_output": "exact expected output", "is_hidden": false}},
        {{"input": "exact stdin input", "expected_output": "exact expected output", "is_hidden": false}}
    ],
    
    "hidden_testcases": [
        {{"input": "exact stdin input", "expected_output": "exact expected output", "is_hidden": true}},
        {{"input": "exact stdin input", "expected_output": "exact expected output", "is_hidden": true}},
        {{"input": "exact stdin input", "expected_output": "exact expected output", "is_hidden": true}}
    ],
    
    "starter_code": {{
        "<language>": "function signature with placeholder - generate for ALL languages in the languages array"
    }}
}}

CRITICAL REQUIREMENTS:
1. "description" should be ONLY the problem statement (no examples, no constraints)
2. "examples" should have at least 2-3 examples with input, output, and optional explanation
3. "constraints" should list all input constraints like LeetCode
4. Generate at least 3 public testcases and 3 hidden testcases
5. Testcases must have exact stdin input and expected stdout output
6. "function_signature" MUST be included with:
   - "name": appropriate function name (e.g., "twoSum", "isPrime", "reverseString")
   - "parameters": array of {{"name": "paramName", "type": "int|string|boolean|int[]|string[]"}}
   - "return_type": appropriate return type (e.g., "int", "string", "boolean", "int[]", "string[]")
7. Starter code MUST be generated for ALL languages in the languages list
8. Starter code should use the function name, parameters, and return type from function_signature
9. Hidden testcases should cover edge cases

IMPORTANT: Return ONLY valid JSON. No markdown code blocks, no explanations, just the JSON object."""

    try:
        client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        response = client.chat.completions.create(
            model="gpt-4",
            messages=[
                {
                    "role": "system", 
                    "content": "You are an expert coding problem generator. Generate LeetCode-style coding questions with separate description, examples, and constraints sections. Always return valid JSON only."
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.8,
        )
        
        content = response.choices[0].message.content.strip()
        
        # Remove markdown code blocks if present
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()
        
        question_data = json.loads(content)
        
        # Validate required fields
        required_fields = ["title", "description", "difficulty", "languages", "public_testcases", "hidden_testcases", "starter_code", "function_signature"]
        for field in required_fields:
            if field not in question_data:
                raise ValueError(f"Generated question missing required field: {field}")
        
        # Validate function_signature structure
        if "function_signature" in question_data:
            func_sig = question_data["function_signature"]
            if not isinstance(func_sig, dict):
                raise ValueError("function_signature must be an object")
            if "name" not in func_sig or "parameters" not in func_sig or "return_type" not in func_sig:
                raise ValueError("function_signature must have 'name', 'parameters', and 'return_type'")
            if not isinstance(func_sig["parameters"], list):
                raise ValueError("function_signature.parameters must be an array")
        
        # Ensure examples exist
        if "examples" not in question_data:
            question_data["examples"] = []
        
        # Ensure constraints exist
        if "constraints" not in question_data:
            question_data["constraints"] = []
        
        # Ensure testcases have correct structure
        for testcase in question_data.get("public_testcases", []):
            if "is_hidden" not in testcase:
                testcase["is_hidden"] = False
        
        for testcase in question_data.get("hidden_testcases", []):
            if "is_hidden" not in testcase:
                testcase["is_hidden"] = True
        
        # Ensure starter_code has all requested languages
        if "starter_code" not in question_data:
            question_data["starter_code"] = {}
        
        for lang in languages:
            if lang not in question_data["starter_code"]:
                question_data["starter_code"][lang] = f"// TODO: Write your solution for {lang}"
        
        return question_data
        
    except json.JSONDecodeError as e:
        raise ValueError(f"Failed to parse AI response as JSON: {e}")
    except Exception as e:
        raise Exception(f"OpenAI API error: {e}")
