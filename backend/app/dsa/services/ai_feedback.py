"""
AI Feedback Service for Code Submissions
Provides automated feedback on code quality, efficiency, and correctness.

IMPORTANT: This is a LeetCode-style online judge where users ONLY write the function body.
The platform automatically injects the main() method and handles all I/O.
This service is LANGUAGE-AGNOSTIC - it works with any language Judge0 supports.

Evaluation Rules:
1. Completely ignore the user's main() method
2. Do NOT penalize missing input handling, missing output, empty main(), or lack of printing
3. The user is NEVER expected to handle input/output themselves
4. Evaluate ONLY the function implementation written by the user
5. Score based on: correctness, time complexity, space complexity, edge-case handling, code clarity
6. A missing or empty main() must NOT reduce the score
7. If the function logic is correct, score should reflect that regardless of main()
"""

import os
import re
import logging
from typing import Dict, Any, List, Optional
from openai import OpenAI

logger = logging.getLogger("backend")

# Initialize OpenAI client
client = None
try:
    api_key = os.getenv("OPENAI_API_KEY")
    if api_key:
        client = OpenAI(api_key=api_key)
        logger.info("OpenAI client initialized for AI feedback")
    else:
        logger.warning("OPENAI_API_KEY not set - using rule-based feedback")
except Exception as e:
    logger.error(f"Failed to initialize OpenAI client: {e}")


def analyze_complexity_generic(source_code: str) -> Dict[str, str]:
    """
    Analyze time and space complexity based on generic code patterns.
    Works with any programming language by detecting common patterns.
    """
    code_lower = source_code.lower()
    
    # Time Complexity Analysis - Generic patterns that work across languages
    time_complexity = "O(n)"
    time_reason = "Linear iteration detected"
    
    # Count loops (generic keywords/patterns)
    loop_patterns = ['for', 'while', 'foreach', 'loop', 'repeat', 'until']
    loop_count = sum(code_lower.count(kw) for kw in loop_patterns)
    
    # Check for nested loops (any language)
    lines = source_code.split('\n')
    indent_levels = []
    in_loop = False
    max_loop_depth = 0
    current_depth = 0
    
    for line in lines:
        stripped = line.strip().lower()
        if any(kw in stripped for kw in loop_patterns):
            current_depth += 1
            max_loop_depth = max(max_loop_depth, current_depth)
        # Simple heuristic: closing braces or dedent might end a loop
        if stripped in ['}', 'end', 'done', 'endif', 'endfor', 'endwhile']:
            current_depth = max(0, current_depth - 1)
    
    # Check for nested loops - but be more precise
    # Two nested loops = O(n²), three = O(n³)
    if max_loop_depth >= 3:
        time_complexity = "O(n³)"
        time_reason = "Triple nested loops detected"
    elif max_loop_depth >= 2:
        time_complexity = "O(n²)"
        time_reason = "Nested loops detected"
    elif loop_count >= 2 and max_loop_depth >= 1:
        # Multiple sequential loops (not nested) = still O(n)
        # But if they're nested, it's O(n²)
        time_complexity = "O(n²)"
        time_reason = "Multiple nested loops detected"
    
    # Check for square root iteration patterns (O(√n))
    # Common patterns: i * i <= n, i <= sqrt(n), i <= Math.sqrt(n), etc.
    # This is common in prime checking, factorization, etc.
    sqrt_patterns = [
        r'\w+\s*\*\s*\w+\s*<=\s*\w+',  # i * i <= n, x * x <= num, etc.
        r'<=\s*Math\.sqrt\(',  # <= Math.sqrt(
        r'<=\s*math\.sqrt\(',  # <= math.sqrt(
        r'<=\s*sqrt\(',  # <= sqrt(
        r'<=\s*int\([^)]*sqrt',  # <= int(...sqrt
        r'<=\s*\(\s*int\s*\)\s*Math\.sqrt',  # <= (int)Math.sqrt
        r'<=\s*\(\s*int\s*\)\s*math\.sqrt',  # <= (int)math.sqrt
    ]
    sqrt_loop_indicators = ['* * <=', '*<=', 'sqrt', 'Math.sqrt', 'math.sqrt']
    
    # Check if there's a loop with square root condition
    has_sqrt_condition = any(re.search(pattern, source_code) for pattern in sqrt_patterns)
    has_sqrt_indicators = any(indicator in source_code for indicator in sqrt_loop_indicators)
    
    # Check for loop that has sqrt condition - verify it's actually in a loop context
    if (has_sqrt_condition or has_sqrt_indicators) and max_loop_depth <= 1 and loop_count > 0:
        # Verify it's actually a loop (not just a condition outside loop)
        loop_with_sqrt = False
        for i, line in enumerate(lines):
            stripped = line.strip().lower()
            # Check if line has loop keyword
            if any(kw in stripped for kw in loop_patterns):
                # Check this line and next few lines for sqrt pattern
                for j in range(i, min(i + 8, len(lines))):
                    line_content = lines[j]
                    if any(re.search(pattern, line_content) for pattern in sqrt_patterns) or \
                       any(ind in line_content for ind in sqrt_loop_indicators):
                        loop_with_sqrt = True
                        break
                if loop_with_sqrt:
                    break
        
        # Also check if sqrt pattern appears in same line as loop
        for line in lines:
            stripped_lower = line.strip().lower()
            if any(kw in stripped_lower for kw in loop_patterns):
                if any(re.search(pattern, line) for pattern in sqrt_patterns) or \
                   any(ind in line for ind in sqrt_loop_indicators):
                    loop_with_sqrt = True
                    break
        
        if loop_with_sqrt or (has_sqrt_condition and loop_count > 0):
            time_complexity = "O(√n)"
            time_reason = "Loop iterates up to square root of n"
    
    # Check for binary search patterns (generic)
    binary_patterns = ['mid', 'binary', 'bisect', 'lo', 'hi', 'left', 'right']
    division_patterns = ['/ 2', '/2', '// 2', '//2', '>> 1', '>>=']
    if any(p in code_lower for p in binary_patterns) and any(p in source_code for p in division_patterns):
        if max_loop_depth <= 1 and time_complexity != "O(√n)":
            time_complexity = "O(log n)"
            time_reason = "Binary search pattern detected"
    
    # Check for recursion (generic - function calling itself)
    # IMPORTANT: Only detect if a function calls ITSELF, not if helper functions are called
    # Look for function definitions and check if they call themselves
    func_def_patterns = [
        r'def\s+(\w+)',           # Python
        r'function\s+(\w+)',       # JS, PHP, etc.
        r'fn\s+(\w+)',             # Rust
        r'func\s+(\w+)',           # Go, Swift
        r'sub\s+(\w+)',            # Perl, VB
        r'proc\s+(\w+)',           # Pascal
        r'(?:public|private|static|final)?\s*(?:static\s+)?\w+\s+(\w+)\s*\([^)]*\)\s*\{',  # Java/C#/C++ style
        r'\w+\s+(\w+)\s*\([^)]*\)\s*\{',  # C-style (simplified)
    ]
    
    # Check for recursion - but be more careful
    # Only mark as recursion if we see actual recursive calls (function calling itself)
    # Helper functions (like isPalindrome) should NOT be detected as recursion
    has_recursion = False
    for pattern in func_def_patterns:
        matches = re.findall(pattern, source_code)
        for func_name in matches:
            if func_name and len(func_name) > 1:
                # Find the function definition
                func_def_pattern = rf'(?:def|function|fn|func|sub|proc|public|private|static|final)?\s*(?:static\s+)?\w+\s+{func_name}\s*\('
                func_def_match = re.search(func_def_pattern, source_code, re.IGNORECASE)
                if func_def_match:
                    # Find the function body (from opening brace to closing brace)
                    # For now, just check if the function name appears AFTER its definition
                    # This is a simplified check - a more sophisticated parser would be better
                    func_start = func_def_match.end()
                    func_body = source_code[func_start:]
                    
                    # Check if function calls itself within its body
                    # Look for function name followed by ( but not as part of definition
                    recursive_call_pattern = rf'(?<!def\s)(?<!function\s)(?<!fn\s)(?<!func\s)(?<!sub\s)(?<!proc\s)(?<!public\s)(?<!private\s)(?<!static\s)(?<!final\s)\b{func_name}\s*\('
                    recursive_calls = re.findall(recursive_call_pattern, func_body, re.IGNORECASE)
                    
                    if len(recursive_calls) > 0:
                        # Check for memoization
                        memo_patterns = ['memo', 'cache', 'dp', 'visited', 'seen']
                        if any(p in code_lower for p in memo_patterns):
                            if max_loop_depth < 2:  # Only if no nested loops
                                time_complexity = "O(n)"
                                time_reason = "Memoized recursion (dynamic programming)"
                                has_recursion = True
                        else:
                            # Only mark as O(2^n) if we're sure it's recursion, not just nested loops
                            # Nested loops take precedence over recursion detection
                            if max_loop_depth < 2:
                                time_complexity = "O(2^n)"
                                time_reason = "Recursive calls detected"
                                has_recursion = True
                    break
        if has_recursion:
            break
    
    # Check for sorting (generic)
    sort_patterns = ['sort', 'sorted', 'qsort', 'mergesort', 'quicksort', 'heapsort']
    if any(p in code_lower for p in sort_patterns):
        if time_complexity == "O(n)":
            time_complexity = "O(n log n)"
            time_reason = "Sorting operation detected"
    
    # Space Complexity Analysis - Generic patterns
    space_complexity = "O(1)"
    space_reason = "Constant extra space"
    
    # Check for data structure creation (generic patterns)
    # Be more careful - StringBuilder/StringBuffer in Java is O(n) space
    ds_patterns = [
        # Arrays/Lists
        (r'\[\s*\]|\[\s*\d', "O(n)", "Array/list created"),
        (r'new\s+\w*\[', "O(n)", "Array allocation"),
        (r'list|array|vector|slice', "O(n)", "Dynamic array"),
        # Hash structures
        (r'\{\s*\}|dict|map|hash|set', "O(n)", "Hash structure created"),
        # String builders (Java, C#)
        (r'StringBuilder|StringBuffer', "O(n)", "String builder created"),
        # 2D structures
        (r'\[\s*\[|\[\]\s*\[', "O(n²)", "2D array created"),
        (r'matrix|grid|table', "O(n²)", "Matrix/grid structure"),
    ]
    
    for pattern, complexity, reason in ds_patterns:
        if re.search(pattern, code_lower):
            space_complexity = complexity
            space_reason = reason
            if complexity == "O(n²)":
                break  # Don't override 2D with 1D
    
    # Recursive space
    if "recursive" in time_reason.lower() and space_complexity == "O(1)":
        space_complexity = "O(n)"
        space_reason = "Recursive call stack"
    
    return {
        "time_complexity": time_complexity,
        "time_reason": time_reason,
        "space_complexity": space_complexity,
        "space_reason": space_reason,
    }


def generate_simple_feedback(
    source_code: str,
    language: str,
    total_passed: int,
    total_tests: int,
    time_spent_seconds: Optional[int] = None,
    total_execution_time: Optional[float] = None,
) -> Dict[str, Any]:
    """
    Generate rule-based feedback for LeetCode-style submissions.
    LANGUAGE-AGNOSTIC - works with any language Judge0 supports.
    
    IMPORTANT: This evaluates ONLY the function implementation.
    - Ignores main() method completely
    - Does NOT penalize missing I/O handling
    - Scores based on correctness, complexity, and code quality
    """
    pass_rate = (total_passed / total_tests * 100) if total_tests > 0 else 0
    
    # Count meaningful lines (generic - exclude empty lines and common patterns)
    lines = [l.strip() for l in source_code.split('\n') if l.strip()]
    # Filter out imports, includes, using statements generically
    meaningful_lines = [l for l in lines if not any([
        l.startswith('#') and ('include' in l or 'define' in l or 'pragma' in l),
        l.startswith('import '),
        l.startswith('from ') and ' import ' in l,
        l.startswith('using '),
        l.startswith('package '),
        l.startswith('//'),
        l.startswith('/*'),
        l.startswith('*'),
        l.startswith('--'),  # SQL/Haskell comments
        l.startswith("'") and len(l) > 1 and l[1] != "'",  # VB comments
    ])]
    lines_of_code = len(meaningful_lines)
    
    # Analyze complexity (language-agnostic)
    complexity = analyze_complexity_generic(source_code)
    time_complexity = complexity["time_complexity"]
    space_complexity = complexity["space_complexity"]
    
    # SCORING: Based purely on correctness and implementation quality
    # Calculate correctness score (exact pass rate percentage)
    correctness_score = int(pass_rate)
    
    # Calculate overall score based on pass rate with adjustments for code quality and efficiency
    # Base score from correctness (tiered system for overall score)
    if pass_rate == 100:
        base_score = 100
        correctness_comment = "All test cases passed. Function implementation is correct."
    elif pass_rate >= 80:
        # For 80-99% range, use a base of 85 but can adjust up to 99 based on exact pass rate
        # This way overall_score can be higher than correctness_score if efficiency is good
        base_score = 85
        correctness_comment = f"Most test cases passed ({total_passed}/{total_tests}). Minor edge cases may need attention."
    elif pass_rate >= 60:
        base_score = 70
        correctness_comment = f"Good progress ({total_passed}/{total_tests}). Review edge cases and boundary conditions."
    elif pass_rate >= 40:
        base_score = 55
        correctness_comment = f"Partially correct ({total_passed}/{total_tests}). Core logic needs review."
    else:
        base_score = 35
        correctness_comment = f"Only {total_passed}/{total_tests} tests passed. Algorithm needs revision."
    
    # Adjust overall score based on efficiency (time/space complexity)
    # This allows overall_score to reflect both correctness AND efficiency
    efficiency_bonus = 0
    if time_complexity in ["O(1)", "O(log n)", "O(√n)"]:
        efficiency_bonus = 5
    elif time_complexity == "O(n)":
        efficiency_bonus = 2
    elif time_complexity in ["O(n²)", "O(n³)", "O(2^n)"]:
        efficiency_bonus = -5
    
    if space_complexity == "O(1)":
        efficiency_bonus += 3
    
    # Code quality assessment
    code_quality_score = 85
    quality_comments = []
    code_quality_adjustment = 0
    
    if lines_of_code <= 15:
        code_quality_score = 95
        quality_comments.append("Concise implementation")
        code_quality_adjustment = 2
    elif lines_of_code <= 30:
        code_quality_score = 90
        quality_comments.append("Clean and readable")
        code_quality_adjustment = 0
    elif lines_of_code > 50:
        code_quality_score = 75
        quality_comments.append("Consider simplifying if possible")
        code_quality_adjustment = -3
    
    # Calculate final overall score (don't exceed 100 or go below 0)
    # Note: overall_score can be different from correctness_score because it includes efficiency adjustments
    overall_score = min(100, max(0, base_score + efficiency_bonus + code_quality_adjustment))
    
    # Generate deduction reasons if score < 100
    deduction_reasons = []
    improvement_suggestions = []
    
    if overall_score < 100:
        # Calculate what caused the deduction
        points_deducted = 100 - overall_score
        
        # Reason 1: Test case failures
        if pass_rate < 100:
            failed_count = total_tests - total_passed
            deduction_reasons.append(
                f"Failed {failed_count}/{total_tests} test cases ({100 - int(pass_rate)}% failure rate)"
            )
            improvement_suggestions.append(
                f"Fix the logic to pass all {total_tests} test cases. Review failing test cases to identify edge cases or boundary conditions that need handling."
            )
        
        # Reason 2: Efficiency issues
        if efficiency_bonus < 0:
            if time_complexity in ["O(n²)", "O(n³)", "O(2^n)"]:
                deduction_reasons.append(
                    f"Suboptimal time complexity: {time_complexity} (optimal solution likely has better complexity)"
                )
                improvement_suggestions.append(
                    f"Optimize the algorithm to achieve better time complexity. Consider using more efficient data structures or algorithms."
                )
            if space_complexity != "O(1)":
                deduction_reasons.append(
                    f"Space complexity could be optimized: {space_complexity} (O(1) space is often achievable)"
                )
                improvement_suggestions.append(
                    f"Consider reducing space usage to O(1) if possible by using in-place operations or avoiding extra data structures."
                )
        elif efficiency_bonus == 0 and time_complexity not in ["O(1)", "O(log n)", "O(√n)", "O(n)"]:
            deduction_reasons.append(
                f"Time complexity {time_complexity} may not be optimal for this problem"
            )
            improvement_suggestions.append(
                f"Research if a more efficient algorithm exists for this problem type."
            )
        
        # Reason 3: Code quality issues
        if code_quality_adjustment < 0:
            deduction_reasons.append(
                f"Code quality could be improved (longer implementation with {lines_of_code} lines)"
            )
            improvement_suggestions.append(
                "Simplify the code structure, extract helper functions if needed, and improve readability."
            )
        
        # Reason 4: Base score deduction explanation
        if base_score < 100:
            if pass_rate >= 80 and pass_rate < 100:
                deduction_reasons.append(
                    f"Minor test case failures: {total_passed}/{total_tests} passed (base score: {base_score}/100)"
                )
            elif pass_rate >= 60 and pass_rate < 80:
                deduction_reasons.append(
                    f"Significant test case failures: {total_passed}/{total_tests} passed (base score: {base_score}/100)"
                )
            elif pass_rate < 60:
                deduction_reasons.append(
                    f"Major test case failures: {total_passed}/{total_tests} passed (base score: {base_score}/100)"
                )
        
        # Add scoring basis explanation
        if not deduction_reasons:
            # If no specific reasons but score < 100, explain the scoring basis
            deduction_reasons.append(
                f"Overall score of {overall_score}/100 based on: correctness ({correctness_score}%), efficiency ({'+' if efficiency_bonus >= 0 else ''}{efficiency_bonus} points), and code quality ({code_quality_score}/100)"
            )
    
    # Build comprehensive feedback summary (2-3 sentences with more context)
    if pass_rate == 100:
        feedback_summary = (
            f"This solution demonstrates a {'correct' if pass_rate == 100 else 'partially correct'} implementation "
            f"with {time_complexity} time complexity and {space_complexity} space complexity. "
            f"The algorithm efficiently handles all test cases, including edge cases, and demonstrates "
            f"good understanding of the problem requirements. "
            f"{'The code structure is clean and maintainable, making it easy to understand and follow.' if lines_of_code <= 30 else 'Consider reviewing the code structure for potential simplifications.'}"
        )
    else:
        feedback_summary = (
            f"This solution provides a {'partially correct' if pass_rate >= 60 else 'needs improvement'} implementation "
            f"with {time_complexity} time complexity and {space_complexity} space complexity. "
            f"{correctness_comment} "
            f"The algorithm shows understanding of the core problem but may need refinement in handling "
            f"certain edge cases or boundary conditions to achieve full correctness."
        )
    
    one_liner = (
        f"{'✓ All tests passed' if pass_rate == 100 else f'{total_passed}/{total_tests} tests passed'} | "
        f"Time: {time_complexity} | Space: {space_complexity}"
    )
    
    # Determine strengths
    strengths = []
    if pass_rate == 100:
        strengths.append("Correct implementation passing all test cases")
    if time_complexity in ["O(1)", "O(log n)", "O(n)"]:
        strengths.append(f"Efficient {time_complexity} time complexity")
    if space_complexity == "O(1)":
        strengths.append("Optimal O(1) space usage")
    if lines_of_code <= 20:
        strengths.append("Clean and concise code")
    if not strengths:
        strengths.append(f"Handles {total_passed} test cases correctly")
    
    # Determine areas for improvement
    areas_for_improvement = []
    if pass_rate < 100:
        areas_for_improvement.append("Review failing test cases for edge cases")
    if time_complexity in ["O(n²)", "O(n³)", "O(2^n)"]:
        areas_for_improvement.append(f"Consider optimizing from {time_complexity} if possible")
    if not areas_for_improvement:
        areas_for_improvement.append("Solution is well-implemented")
    
    # Suggestions
    suggestions = []
    if pass_rate < 100:
        suggestions.append("Test with edge cases: empty input, single element, large values")
        suggestions.append("Verify boundary conditions in your logic")
    if not suggestions:
        suggestions.append("Well done! Consider exploring alternative approaches")
    
    return {
        "overall_score": overall_score,
        "feedback_summary": feedback_summary,
        "one_liner": one_liner,
        "code_quality": {
            "score": code_quality_score,
            "comments": (
                f"{'. '.join(quality_comments) if quality_comments else 'The code demonstrates'} "
                f"{'good' if code_quality_score >= 85 else 'adequate' if code_quality_score >= 70 else 'needs improvement in'} "
                f"code organization and readability. "
                f"{'The implementation is well-structured and follows best practices.' if code_quality_score >= 85 else 'Consider improving code structure, adding meaningful variable names, and ensuring proper formatting for better maintainability.'}"
            )
        },
        "efficiency": {
            "time_complexity": time_complexity,
            "space_complexity": space_complexity,
            "comments": (
                f"The solution achieves {time_complexity} time complexity because {complexity['time_reason'].lower()}. "
                f"{'For O(√n), this means the loop iterates up to the square root of n, which is more efficient than O(n) for problems like prime checking or factorization.' if time_complexity == 'O(√n)' else ''}"
                f"This {'is optimal' if time_complexity in ['O(1)', 'O(log n)', 'O(√n)', 'O(n)'] else 'could potentially be optimized'} "
                f"for this problem type. "
                f"The space complexity is {space_complexity} due to {complexity['space_reason'].lower()}. "
                f"{'This represents an efficient use of memory.' if space_complexity == 'O(1)' else 'Consider if the space usage can be reduced while maintaining correctness.'}"
            )
        },
        "correctness": {
            "score": correctness_score,
            "comments": (
                f"{correctness_comment} "
                f"{'The implementation correctly handles all test scenarios including edge cases.' if pass_rate == 100 else 'Review the failing test cases to identify patterns and address the underlying logic issues.'} "
                f"{'The algorithm logic is sound and produces the expected results consistently.' if pass_rate >= 80 else 'Focus on understanding why certain test cases fail and adjust the algorithm accordingly.'}"
            )
        },
        "suggestions": suggestions,
        "strengths": strengths,
        "areas_for_improvement": areas_for_improvement,
        "deduction_reasons": deduction_reasons if overall_score < 100 else [],
        "improvement_suggestions": improvement_suggestions if overall_score < 100 else [],
        "ai_generated": False,
        "evaluation_note": "Evaluated function implementation only (language-agnostic)",
        "scoring_basis": {
            "base_score": base_score,
            "correctness_score": correctness_score,
            "pass_rate": f"{total_passed}/{total_tests} ({int(pass_rate)}%)",
            "efficiency_bonus": efficiency_bonus,
            "code_quality_score": code_quality_score,
            "code_quality_adjustment": code_quality_adjustment,
            "time_complexity": time_complexity,
            "space_complexity": space_complexity,
            "final_score": overall_score,
            "points_deducted": 100 - overall_score if overall_score < 100 else 0,
            "explanation": f"Score calculated as: Base ({base_score}) + Efficiency ({efficiency_bonus:+d}) + Code Quality ({code_quality_adjustment:+d}) = {overall_score}/100"
        }
    }


def generate_code_feedback(
    source_code: str,
    language: str,
    question_title: str,
    question_description: str,
    test_results: List[Dict[str, Any]],
    total_passed: int,
    total_tests: int,
    time_spent_seconds: Optional[int] = None,
    public_passed: Optional[int] = None,
    public_total: Optional[int] = None,
    hidden_passed: Optional[int] = None,
    hidden_total: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Generate AI feedback for a code submission.
    Falls back to rule-based analysis if AI is not available.
    
    LANGUAGE-AGNOSTIC - works with any language Judge0 supports.
    
    IMPORTANT: This is a LeetCode-style judge where users ONLY write function bodies.
    - main() method is completely ignored
    - No penalty for missing I/O handling
    - Score based purely on function implementation quality
    """
    # Calculate public/hidden breakdown if not provided
    if public_passed is None or public_total is None or hidden_passed is None or hidden_total is None:
        # Try to infer from test_results
        public_results = [r for r in test_results if not r.get("is_hidden", False)]
        hidden_results = [r for r in test_results if r.get("is_hidden", False)]
        public_passed = sum(1 for r in public_results if r.get("passed", False))
        public_total = len(public_results) if public_total is None else public_total
        hidden_passed = sum(1 for r in hidden_results if r.get("passed", False))
        hidden_total = len(hidden_results) if hidden_total is None else hidden_total
    
    if not client:
        # Use rule-based fallback
        logger.info("Using rule-based feedback (OpenAI not configured)")
        feedback = generate_simple_feedback(
            source_code=source_code,
            language=language,
            total_passed=total_passed,
            total_tests=total_tests,
            time_spent_seconds=time_spent_seconds,
        )
        # Add public/hidden breakdown to feedback
        feedback["test_breakdown"] = {
            "public_passed": public_passed,
            "public_total": public_total,
            "hidden_passed": hidden_passed,
            "hidden_total": hidden_total,
        }
        return feedback
    
    try:
        # Prepare test results summary with public/hidden breakdown
        passed_tests = [r for r in test_results if r.get("passed")]
        failed_tests = [r for r in test_results if not r.get("passed")]
        
        # Separate public and hidden test results
        public_test_results = [r for r in test_results if not r.get("is_hidden", False)]
        hidden_test_results = [r for r in test_results if r.get("is_hidden", False)]
        public_passed_count = sum(1 for r in public_test_results if r.get("passed", False))
        hidden_passed_count = sum(1 for r in hidden_test_results if r.get("passed", False))
        
        test_summary = (
            f"Total: {total_passed}/{total_tests} tests passed\n"
            f"Public test cases: {public_passed_count}/{public_total} passed\n"
            f"Hidden test cases: {hidden_passed_count}/{hidden_total} passed"
        )
        
        failed_details = ""
        if failed_tests:
            failed_details = "\n\nFailed test cases:\n"
            # Show both public and hidden failures (but hide hidden test case details)
            public_failed = [r for r in failed_tests if not r.get("is_hidden", False)]
            hidden_failed = [r for r in failed_tests if r.get("is_hidden", False)]
            
            for i, test in enumerate(public_failed[:3], 1):
                failed_details += f"- Public Test {i}: Expected '{test.get('expected_output', 'N/A')}', Got '{test.get('user_output', 'N/A')}'\n"
            
            if hidden_failed:
                failed_details += f"- Hidden tests: {len(hidden_failed)} hidden test case(s) failed (details not shown to user)\n"
        
        prompt = f"""You are evaluating code for an online coding judge platform (like LeetCode/HackerRank).
This platform supports ANY programming language that Judge0 supports.

CRITICAL EVALUATION RULES:
1. Users ONLY write the function implementation - they do NOT handle input/output
2. The platform automatically wraps the user's function with I/O handling
3. COMPLETELY IGNORE any main() method, input reading, output printing code
4. Do NOT penalize for missing I/O handling - users are NOT supposed to write it
5. Evaluate ONLY the function/algorithm implementation
6. If the function logic is correct and all tests pass, the score should be 100/100
7. Empty or missing main() must NOT reduce the score
8. Be LANGUAGE-AGNOSTIC - the same rules apply regardless of programming language
9. ANALYZE THE ACTUAL CODE to determine time and space complexity - do not guess, analyze the loops, data structures, and algorithm logic

**Question:** {question_title}

**Description:** {question_description[:500]}...

**Language:** {language}

**User's Code (function implementation only - ignore any I/O code):**
```
{source_code}
```

**Test Results:** {test_summary}{failed_details}

**Test Case Breakdown:**
- Public test cases: {public_passed}/{public_total} passed
- Hidden test cases: {hidden_passed}/{hidden_total} passed
- Total: {total_passed}/{total_tests} passed

IMPORTANT: Analyze the actual code structure to determine time and space complexity:
- Count loops and their nesting levels
- Identify the actual iteration bounds (e.g., if loop goes up to √n, it's O(√n), not O(n))
- Check what data structures are created
- Analyze the algorithm logic carefully
- For prime checking: if loop iterates up to √n (e.g., i * i <= n), complexity is O(√n), not O(n)

Evaluate ONLY the function implementation and provide comprehensive, detailed feedback in this JSON format:

SCORING GUIDELINES:
- If ALL tests pass (100%): overall_score = 100 (perfect solution)
- If 80-99% tests pass: overall_score = 85-99 (excellent, minor issues)
- If 60-79% tests pass: overall_score = 70-84 (good, needs some fixes)
- If 40-59% tests pass: overall_score = 55-69 (fair, significant issues)
- If <40% tests pass: overall_score = 35-54 (poor, major revision needed)

Within each range, adjust based on:
- Code quality (clarity, structure, readability): ±5 points
- Algorithm efficiency (optimal time/space complexity): ±5 points
- Edge case handling: ±5 points

{{
    "overall_score": <0-100 calculated as: base score from test pass rate (see guidelines above) ± adjustments for code quality, efficiency, and edge cases. Must be 100 if all tests pass>,
    "feedback_summary": "<2-3 sentences providing a comprehensive overview. Include: (1) Overall assessment of the solution's correctness and efficiency, (2) Time and space complexity analysis with context, (3) Code quality and structure evaluation, (4) Brief mention of strengths and any areas that could be improved. Make it informative and educational.>",
    "one_liner": "<Brief summary: '✓ All tests passed | Time: O(n) | Space: O(1)' format>",
    "code_quality": {{
        "score": <0-100>,
        "comments": "<Detailed 2-3 sentence analysis of code clarity, structure, readability, naming conventions, and maintainability. Discuss how well-organized the code is and whether it follows best practices. Ignore main/I/O code completely.>"
    }},
    "efficiency": {{
        "time_complexity": "<Big O notation - e.g., O(1), O(log n), O(√n), O(n), O(n log n), O(n²), etc. For prime checking with loop up to √n, use O(√n)>",
        "space_complexity": "<Big O notation>",
        "comments": "<Comprehensive 3-4 sentence analysis: (1) Explain why this time/space complexity is achieved (e.g., for O(√n), explain that the loop iterates up to √n, making it more efficient than O(n)), (2) Discuss whether this is optimal for the problem, (3) Compare with alternative approaches if relevant, (4) Mention any trade-offs or optimizations that could be made. Be educational and detailed.>"
    }},
    "correctness": {{
        "score": <0-100 based on test pass rate>,
        "comments": "<Detailed 2-3 sentence analysis: (1) Explain which test cases passed/failed and why, (2) Discuss edge case handling, (3) Evaluate the algorithm's logic and correctness, (4) Mention any potential issues or bugs if tests failed.>"
    }},
    "suggestions": ["<Detailed improvement suggestions for the FUNCTION only - be specific and actionable>", "<Additional suggestions>"],
    "strengths": ["<Detailed strengths - explain what was done well and why it's good>", "<Additional strengths>"],
    "areas_for_improvement": ["<Specific areas to improve with explanations>", "<Additional improvement areas>"],
    "deduction_reasons": ["<ONLY include if overall_score < 100. List specific reasons why points were deducted, e.g., 'Failed 2/6 test cases (33% failure rate)', 'Time complexity is O(n²) but optimal is O(n log n)', 'Missing edge case handling for empty input', etc.>"],
    "improvement_suggestions": ["<ONLY include if overall_score < 100. Provide specific, actionable suggestions to improve the score, e.g., 'Fix the logic for edge case X to pass all test cases', 'Optimize the algorithm to achieve O(n log n) time complexity', 'Add null/empty input validation', etc.>"]
}}

IMPORTANT: 
- Make the feedback_summary 2-3 sentences with substantial detail and context
- Make all comment fields detailed and educational (2-4 sentences each)
- Provide specific, actionable feedback
- Be comprehensive but clear
- Score 100 if the function implementation is correct and passes all tests."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {
                    "role": "system",
                    "content": "You are an expert code reviewer and algorithm analyst for a LeetCode-style platform. Users only write function implementations - never I/O. Your task is to: 1) Analyze the ACTUAL CODE STRUCTURE to determine precise time and space complexity (e.g., if a loop iterates up to √n, report O(√n), not O(n)), 2) Evaluate only the function logic, 3) Be language-agnostic, 4) Always respond with valid JSON, 5) Provide comprehensive, detailed feedback with educational context. Carefully examine loops, their bounds, data structures used, and algorithm logic to give accurate complexity analysis."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.3,
            max_tokens=2000,
        )
        
        # Parse the response
        content = response.choices[0].message.content
        
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            import json
            feedback = json.loads(json_match.group())
            feedback["ai_generated"] = True
            feedback["evaluation_note"] = "Evaluated function implementation only (language-agnostic)"
            # Add test breakdown information
            feedback["test_breakdown"] = {
                "public_passed": public_passed,
                "public_total": public_total,
                "hidden_passed": hidden_passed,
                "hidden_total": hidden_total,
            }
            logger.info("Successfully generated AI feedback")
            return feedback
        else:
            logger.warning("Could not parse AI feedback, using fallback")
            feedback = generate_simple_feedback(
                source_code=source_code,
                language=language,
                total_passed=total_passed,
                total_tests=total_tests,
                time_spent_seconds=time_spent_seconds,
            )
            feedback["test_breakdown"] = {
                "public_passed": public_passed,
                "public_total": public_total,
                "hidden_passed": hidden_passed,
                "hidden_total": hidden_total,
            }
            return feedback
            
    except Exception as e:
        logger.error(f"Error generating AI feedback: {e}")
        feedback = generate_simple_feedback(
            source_code=source_code,
            language=language,
            total_passed=total_passed,
            total_tests=total_tests,
            time_spent_seconds=time_spent_seconds,
        )
        feedback["test_breakdown"] = {
            "public_passed": public_passed,
            "public_total": public_total,
            "hidden_passed": hidden_passed,
            "hidden_total": hidden_total,
        }
        return feedback


def generate_quick_feedback(
    source_code: str,
    language: str,
    passed: bool,
    error_message: Optional[str] = None,
) -> str:
    """
    Generate quick feedback for run code (not full submission).
    Returns a brief string feedback. Language-agnostic.
    """
    if not client:
        if passed:
            return "All test cases passed! Your function implementation is correct."
        else:
            return "Some test cases failed. Review your function logic and edge cases."
    
    try:
        status = "passed all tests" if passed else "failed some tests"
        error_context = f"\nError: {error_message}" if error_message else ""
        
        prompt = f"""Provide brief (1-2 sentences) feedback for this function that {status}.
This is a LeetCode-style platform - users only write functions, not I/O.{error_context}

Code:
```
{source_code[:1000]}
```

Focus only on the function logic."""

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a helpful coding assistant. Be brief and constructive. Focus on function logic only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,
            max_tokens=150,
        )
        
        return response.choices[0].message.content.strip()
        
    except Exception as e:
        logger.error(f"Error generating quick feedback: {e}")
        if passed:
            return "Function implementation is correct!"
        return "Review your function logic for edge cases."
