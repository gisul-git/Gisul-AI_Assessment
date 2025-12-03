"""
Code Wrapper Service - Hybrid Approach

Supports TWO modes:
1. AUTO MODE: For common languages, automatically wraps user code
2. CUSTOM MODE: For any other language, admin defines wrapper_template in question config

Also provides:
- Default boilerplate/starter code for all DSA languages
- Validation to detect if user incorrectly modifies boilerplate
- Warning messages for forbidden modifications

This ensures backward compatibility while supporting any Judge0 language.
"""

import re
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

logger = logging.getLogger("backend")


# ============================================================================
# DEFAULT BOILERPLATE/STARTER CODE FOR ALL LANGUAGES
# These are templates with {function_name}, {params}, {return_type} placeholders
# ============================================================================

BOILERPLATE_TEMPLATES = {
    # Python
    "python": '''def {function_name}({params}):
    """
    Write your solution here.
    DO NOT modify the function signature.
    DO NOT add print() or input() - the system handles I/O.
    """
    # Your code here
    pass
''',
    
    # Java
    "java": '''public static {return_type} {function_name}({params}) {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add main(), Scanner, or System.out - the system handles I/O.
    
    // Your code here
    return {default_return};
}}
''',
    
    # C++
    "cpp": '''{return_type} {function_name}({params}) {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add main(), cin, cout - the system handles I/O.
    
    // Your code here
    return {default_return};
}}
''',
    
    # C
    "c": '''{return_type} {function_name}({params}) {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add main(), scanf, printf - the system handles I/O.
    
    // Your code here
    return {default_return};
}}
''',
    
    # JavaScript
    "javascript": '''function {function_name}({params}) {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add console.log or readline - the system handles I/O.
    
    // Your code here
    return {default_return};
}}
''',
    
    # TypeScript
    "typescript": '''function {function_name}({params}): {return_type} {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add console.log or readline - the system handles I/O.
    
    // Your code here
    return {default_return};
}}
''',
    
    # Go
    "go": '''func {function_name}({params}) {return_type} {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add main() or fmt - the system handles I/O.
    
    // Your code here
    return {default_return}
}}
''',
    
    # Rust
    "rust": '''fn {function_name}({params}) -> {return_type} {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add main() or println! - the system handles I/O.
    
    // Your code here
    {default_return}
}}
''',
    
    # Kotlin
    "kotlin": '''fun {function_name}({params}): {return_type} {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add main() or println - the system handles I/O.
    
    // Your code here
    return {default_return}
}}
''',
    
    # C#
    "csharp": '''public static {return_type} {function_name}({params}) {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add Main() or Console - the system handles I/O.
    
    // Your code here
    return {default_return};
}}
''',
    
    # Ruby
    "ruby": '''def {function_name}({params})
  # Write your solution here.
  # DO NOT modify the function signature.
  # DO NOT add puts or gets - the system handles I/O.
  
  # Your code here
  {default_return}
end
''',
    
    # Swift
    "swift": '''func {function_name}({params}) -> {return_type} {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add print or readLine - the system handles I/O.
    
    // Your code here
    return {default_return}
}}
''',
    
    # PHP
    "php": '''function {function_name}({params}) {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add echo or fgets - the system handles I/O.
    
    // Your code here
    return {default_return};
}}
''',
    
    # Scala
    "scala": '''def {function_name}({params}): {return_type} = {{
    // Write your solution here.
    // DO NOT modify the function signature.
    // DO NOT add main() or println - the system handles I/O.
    
    // Your code here
    {default_return}
}}
''',
}

# Default return values by type
DEFAULT_RETURNS = {
    # Numeric
    "int": "0", "integer": "0", "long": "0L", "float": "0.0", "double": "0.0",
    "Int": "0", "Long": "0L", "Float": "0.0f", "Double": "0.0",
    "i32": "0", "i64": "0", "u32": "0", "u64": "0", "f32": "0.0", "f64": "0.0",
    "number": "0",
    
    # Boolean
    "bool": "false", "boolean": "false", "Boolean": "false", "Bool": "false",
    
    # String
    "string": '""', "String": '""', "str": '""',
    
    # Arrays/Lists
    "int[]": "new int[0]", "Integer[]": "new Integer[0]",
    "string[]": "new String[0]", "String[]": "new String[0]",
    "List<Integer>": "new ArrayList<>()", "List<String>": "new ArrayList<>()",
    "list": "[]", "List": "[]", "array": "[]",
    "vector<int>": "{}", "vector<string>": "{}",
    "[Int]": "[]", "[String]": "[]",
    "Vec<i32>": "vec![]", "Vec<String>": "vec![]",
    
    # Void/Unit
    "void": "", "Unit": "", "()": "()",
    
    # Default
    "": "null",
}


def get_default_return(return_type: str, language: str) -> str:
    """Get default return value for a type in a language."""
    # Direct match
    if return_type in DEFAULT_RETURNS:
        return DEFAULT_RETURNS[return_type]
    
    # Language-specific defaults
    if language.lower() in ['python', 'python3']:
        if 'list' in return_type.lower() or '[]' in return_type:
            return '[]'
        if 'bool' in return_type.lower():
            return 'False'
        if 'str' in return_type.lower():
            return '""'
        return 'None'
    
    if language.lower() in ['ruby']:
        return 'nil'
    
    if language.lower() in ['go', 'golang']:
        if 'int' in return_type.lower():
            return '0'
        if 'string' in return_type.lower():
            return '""'
        if 'bool' in return_type.lower():
            return 'false'
        return 'nil'
    
    if language.lower() in ['rust']:
        if 'i32' in return_type or 'i64' in return_type:
            return '0'
        if 'String' in return_type:
            return 'String::new()'
        if 'bool' in return_type:
            return 'false'
        if 'Vec' in return_type:
            return 'vec![]'
        return 'todo!()'
    
    # Default fallback
    return 'null'


def generate_boilerplate(
    language: str,
    function_name: str,
    parameters: List[Dict[str, str]],
    return_type: str,
) -> str:
    """
    Generate boilerplate/starter code for a given language and function signature.
    
    Args:
        language: Programming language
        function_name: Name of the function (e.g., "twoSum", "isPrime")
        parameters: List of {"name": "n", "type": "int"} dicts
        return_type: Return type of the function
    
    Returns:
        Boilerplate code string
    """
    lang_key = language.lower()
    
    # Get template
    template = BOILERPLATE_TEMPLATES.get(lang_key)
    if not template:
        # Check aliases
        aliases = {
            'python3': 'python', 'py': 'python',
            'c++': 'cpp',
            'js': 'javascript', 'node': 'javascript',
            'ts': 'typescript',
            'golang': 'go',
            'c#': 'csharp', 'cs': 'csharp',
            'rb': 'ruby',
        }
        lang_key = aliases.get(lang_key, lang_key)
        template = BOILERPLATE_TEMPLATES.get(lang_key)
    
    if not template:
        # Fallback: generic template
        template = '''// {function_name}({params}) -> {return_type}
// Write your solution here.
// DO NOT modify the function signature.
// DO NOT add I/O code - the system handles it.

'''
    
    # Format parameters based on language
    if lang_key in ['python', 'ruby']:
        params_str = ', '.join(p['name'] for p in parameters)
    elif lang_key in ['go', 'golang']:
        params_str = ', '.join(f"{p['name']} {p['type']}" for p in parameters)
    elif lang_key in ['rust']:
        params_str = ', '.join(f"{p['name']}: {p['type']}" for p in parameters)
    elif lang_key in ['kotlin', 'scala']:
        params_str = ', '.join(f"{p['name']}: {p['type']}" for p in parameters)
    elif lang_key in ['swift']:
        params_str = ', '.join(f"_ {p['name']}: {p['type']}" for p in parameters)
    elif lang_key in ['typescript']:
        params_str = ', '.join(f"{p['name']}: {p['type']}" for p in parameters)
    elif lang_key in ['php']:
        params_str = ', '.join(f"${p['name']}" for p in parameters)
    else:
        # C-style: type name
        params_str = ', '.join(f"{p['type']} {p['name']}" for p in parameters)
    
    # Get default return value
    default_return = get_default_return(return_type, language)
    
    # Fill template
    boilerplate = template.format(
        function_name=function_name,
        params=params_str,
        return_type=return_type,
        default_return=default_return,
    )
    
    return boilerplate


# ============================================================================
# BOILERPLATE VALIDATION - Detect forbidden modifications
# ============================================================================

# Forbidden patterns that indicate user modified boilerplate incorrectly
FORBIDDEN_MODIFICATIONS = {
    "python": [
        (r'\bprint\s*\(', "❌ Do not add print(). The system handles output automatically."),
        (r'\binput\s*\(', "❌ Do not add input(). The system handles input automatically."),
        (r'sys\.stdin', "❌ Do not use sys.stdin. The system handles input automatically."),
        (r'sys\.stdout', "❌ Do not use sys.stdout. The system handles output automatically."),
        (r'if\s+__name__\s*==', "❌ Do not add if __name__ block. The system handles execution."),
    ],
    "java": [
        (r'public\s+static\s+void\s+main\s*\(', "❌ Do not add main() method. The system handles execution."),
        (r'System\.out\.print', "❌ Do not use System.out. The system handles output automatically."),
        (r'System\.in', "❌ Do not use System.in. The system handles input automatically."),
        (r'\bScanner\b', "❌ Do not use Scanner. The system handles input automatically."),
        (r'BufferedReader', "❌ Do not use BufferedReader. The system handles input automatically."),
    ],
    "cpp": [
        (r'int\s+main\s*\(', "❌ Do not add main() function. The system handles execution."),
        (r'void\s+main\s*\(', "❌ Do not add main() function. The system handles execution."),
        (r'\bcout\s*<<', "❌ Do not use cout. The system handles output automatically."),
        (r'\bcin\s*>>', "❌ Do not use cin. The system handles input automatically."),
        (r'\bprintf\s*\(', "❌ Do not use printf. The system handles output automatically."),
        (r'\bscanf\s*\(', "❌ Do not use scanf. The system handles input automatically."),
    ],
    "c": [
        (r'int\s+main\s*\(', "❌ Do not add main() function. The system handles execution."),
        (r'\bprintf\s*\(', "❌ Do not use printf. The system handles output automatically."),
        (r'\bscanf\s*\(', "❌ Do not use scanf. The system handles input automatically."),
        (r'\bgets\s*\(', "❌ Do not use gets. The system handles input automatically."),
    ],
    "javascript": [
        (r'console\.log\s*\(', "❌ Do not use console.log. The system handles output automatically."),
        (r'console\.error\s*\(', "❌ Do not use console.error. The system handles output automatically."),
        (r'\breadline\s*\(', "❌ Do not use readline. The system handles input automatically."),
        (r'process\.stdin', "❌ Do not use process.stdin. The system handles input automatically."),
        (r'\bprompt\s*\(', "❌ Do not use prompt. The system handles input automatically."),
    ],
    "typescript": [
        (r'console\.log\s*\(', "❌ Do not use console.log. The system handles output automatically."),
        (r'\breadline\s*\(', "❌ Do not use readline. The system handles input automatically."),
        (r'process\.stdin', "❌ Do not use process.stdin. The system handles input automatically."),
    ],
    "go": [
        (r'func\s+main\s*\(\s*\)', "❌ Do not add main() function. The system handles execution."),
        (r'fmt\.Print', "❌ Do not use fmt.Print. The system handles output automatically."),
        (r'fmt\.Scan', "❌ Do not use fmt.Scan. The system handles input automatically."),
    ],
    "rust": [
        (r'fn\s+main\s*\(\s*\)', "❌ Do not add main() function. The system handles execution."),
        (r'println!\s*\(', "❌ Do not use println!. The system handles output automatically."),
        (r'print!\s*\(', "❌ Do not use print!. The system handles output automatically."),
        (r'io::stdin', "❌ Do not use io::stdin. The system handles input automatically."),
    ],
    "kotlin": [
        (r'fun\s+main\s*\(', "❌ Do not add main() function. The system handles execution."),
        (r'\bprintln\s*\(', "❌ Do not use println. The system handles output automatically."),
        (r'\bprint\s*\(', "❌ Do not use print. The system handles output automatically."),
        (r'\breadLine\s*\(', "❌ Do not use readLine. The system handles input automatically."),
    ],
    "csharp": [
        (r'static\s+void\s+Main\s*\(', "❌ Do not add Main() method. The system handles execution."),
        (r'Console\.Write', "❌ Do not use Console.Write. The system handles output automatically."),
        (r'Console\.Read', "❌ Do not use Console.Read. The system handles input automatically."),
    ],
    "ruby": [
        (r'\bputs\s+', "❌ Do not use puts. The system handles output automatically."),
        (r'\bprint\s+', "❌ Do not use print. The system handles output automatically."),
        (r'\bgets\b', "❌ Do not use gets. The system handles input automatically."),
    ],
    "swift": [
        (r'\bprint\s*\(', "❌ Do not use print. The system handles output automatically."),
        (r'\breadLine\s*\(', "❌ Do not use readLine. The system handles input automatically."),
    ],
    "php": [
        (r'\becho\b', "❌ Do not use echo. The system handles output automatically."),
        (r'\bprint\s*\(', "❌ Do not use print. The system handles output automatically."),
        (r'fgets\s*\(\s*STDIN', "❌ Do not use fgets(STDIN). The system handles input automatically."),
    ],
    "scala": [
        (r'def\s+main\s*\(', "❌ Do not add main() method. The system handles execution."),
        (r'\bprintln\s*\(', "❌ Do not use println. The system handles output automatically."),
        (r'StdIn\.read', "❌ Do not use StdIn. The system handles input automatically."),
    ],
}


def validate_boilerplate_not_modified(
    user_code: str,
    language: str,
    original_function_name: Optional[str] = None,
) -> Tuple[bool, List[str]]:
    """
    Validate that user hasn't modified the boilerplate in forbidden ways.
    
    Returns:
        (is_valid, list_of_warning_messages)
    """
    warnings = []
    lang_key = language.lower()
    
    # Check aliases
    aliases = {
        'python3': 'python', 'py': 'python',
        'c++': 'cpp',
        'js': 'javascript', 'node': 'javascript',
        'ts': 'typescript',
        'golang': 'go',
        'c#': 'csharp', 'cs': 'csharp',
        'rb': 'ruby',
    }
    lang_key = aliases.get(lang_key, lang_key)
    
    # Get forbidden patterns for this language
    patterns = FORBIDDEN_MODIFICATIONS.get(lang_key, [])
    
    for pattern, message in patterns:
        if re.search(pattern, user_code, re.IGNORECASE):
            warnings.append(message)
    
    # Check if function signature was deleted/modified
    if original_function_name:
        # Check if function still exists
        func_patterns = {
            'python': rf'def\s+{original_function_name}\s*\(',
            'java': rf'{original_function_name}\s*\(',
            'cpp': rf'{original_function_name}\s*\(',
            'c': rf'{original_function_name}\s*\(',
            'javascript': rf'function\s+{original_function_name}\s*\(|{original_function_name}\s*=\s*\(',
            'typescript': rf'function\s+{original_function_name}\s*\(|{original_function_name}\s*=\s*\(',
            'go': rf'func\s+{original_function_name}\s*\(',
            'rust': rf'fn\s+{original_function_name}\s*\(',
            'kotlin': rf'fun\s+{original_function_name}\s*\(',
            'csharp': rf'{original_function_name}\s*\(',
            'ruby': rf'def\s+{original_function_name}\s*[\(\n]',
            'swift': rf'func\s+{original_function_name}\s*\(',
            'php': rf'function\s+{original_function_name}\s*\(',
            'scala': rf'def\s+{original_function_name}\s*[\(\[]',
        }
        
        func_pattern = func_patterns.get(lang_key)
        if func_pattern and not re.search(func_pattern, user_code):
            warnings.append(f"❌ Do not modify the function name '{original_function_name}'. Keep the original signature.")
    
    is_valid = len(warnings) == 0
    return is_valid, warnings


@dataclass
class FunctionSignature:
    """Defines the expected function signature (set by admin per question)"""
    name: str                          # e.g., "isPrime", "twoSum"
    parameters: List[Dict[str, str]]   # [{"name": "n", "type": "int"}, ...]
    return_type: str                   # e.g., "boolean", "int[]", "string"


# ============================================================================
# AUTO-WRAPPERS FOR COMMON LANGUAGES
# These provide backward compatibility for Java, Python, C++, JavaScript
# ============================================================================

def _auto_wrap_java(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """
    Auto-wrap Java code if user submits only a function.
    Detects if code needs wrapping and applies appropriate template.
    """
    # Check if already has a public class
    if re.search(r'public\s+class\s+\w+', user_code):
        # Has a class - check if it's named Main
        if not re.search(r'public\s+class\s+Main\b', user_code):
            # Rename first public class to Main
            user_code = re.sub(r'public\s+class\s+(\w+)', 'public class Main', user_code, count=1)
        
        # Check if main method exists and is empty
        main_match = re.search(
            r'public\s+static\s+void\s+main\s*\([^)]*\)\s*\{([^}]*)\}',
            user_code,
            re.DOTALL
        )
        
        if main_match:
            main_body = main_match.group(1).strip()
            # Check if main body is empty or only has whitespace/comments
            main_body_clean = re.sub(r'//.*?$|/\*.*?\*/', '', main_body, flags=re.MULTILINE | re.DOTALL).strip()
            
            if not main_body_clean or main_body_clean == '':
                # Main method is empty - try to detect ALL functions and use the first non-main one
                # This regex is more robust and handles:
                # - public static, static, or no modifiers
                # - Complex return types (String, int[], List<Integer>, etc.)
                # - Multiple functions (we'll pick the first non-main one)
                func_matches = re.finditer(
                    r'(?:public\s+)?(?:static\s+)?([\w\[\]<>,\s]+?)\s+(\w+)\s*\(([^)]*)\)',
                    user_code
                )
                
                func_match = None
                for match in func_matches:
                    func_name = match.group(2)
                    if func_name != 'main':
                        func_match = match
                        break
                
                if func_match:
                    return_type = func_match.group(1).strip()
                    func_name = func_match.group(2)
                    params_str = func_match.group(3)
                    
                    # Parse parameters dynamically - handle complex types
                    param_names = []
                    param_reads = []
                    if params_str.strip():
                        # Split by comma, but be careful with generics like List<Integer>
                        params = []
                        current_param = ""
                        depth = 0
                        for char in params_str:
                            if char == '<':
                                depth += 1
                            elif char == '>':
                                depth -= 1
                            elif char == ',' and depth == 0:
                                if current_param.strip():
                                    params.append(current_param.strip())
                                current_param = ""
                                continue
                            current_param += char
                        if current_param.strip():
                            params.append(current_param.strip())
                        
                        for param in params:
                            param = param.strip()
                            if not param:
                                continue
                            
                            # Extract parameter name and type
                            # Handle: "int n", "String s", "List<Integer> list", "int[] arr"
                            # Find the last word (parameter name) and everything before it is the type
                            parts = param.rsplit(' ', 1)
                            if len(parts) == 2:
                                ptype, pname = parts[0].strip(), parts[1].strip()
                                param_names.append(pname)
                                
                                # Generate input reading based on type - handle more types dynamically
                                ptype_lower = ptype.lower()
                                
                                # Array types
                                if '[]' in ptype or 'array' in ptype_lower:
                                    if 'int' in ptype_lower:
                                        param_reads.append(f'        String[] {pname}Parts = sc.nextLine().replaceAll("[\\\\[\\\\]]", "").split(",\\\\s*");')
                                        param_reads.append(f'        int[] {pname} = new int[{pname}Parts.length];')
                                        param_reads.append(f'        for(int i=0; i<{pname}Parts.length; i++) {pname}[i] = Integer.parseInt({pname}Parts[i].trim());')
                                    elif 'string' in ptype_lower:
                                        param_reads.append(f'        String[] {pname} = sc.nextLine().replaceAll("[\\\\[\\\\]]", "").split(",\\\\s*");')
                                    else:
                                        # Generic array - treat as string array
                                        param_reads.append(f'        String[] {pname} = sc.nextLine().replaceAll("[\\\\[\\\\]]", "").split(",\\\\s*");')
                                # List types (e.g., List<Integer>, List<String>)
                                elif 'list<' in ptype_lower or ptype.startswith('List'):
                                    if 'integer' in ptype_lower or 'int' in ptype_lower:
                                        param_reads.append(f'        String[] {pname}Parts = sc.nextLine().replaceAll("[\\\\[\\\\]]", "").split(",\\\\s*");')
                                        param_reads.append(f'        List<Integer> {pname} = new ArrayList<>();')
                                        param_reads.append(f'        for(String part : {pname}Parts) {pname}.add(Integer.parseInt(part.trim()));')
                                    else:
                                        param_reads.append(f'        String[] {pname}Parts = sc.nextLine().replaceAll("[\\\\[\\\\]]", "").split(",\\\\s*");')
                                        param_reads.append(f'        List<String> {pname} = Arrays.asList({pname}Parts);')
                                # Primitive and wrapper types
                                elif ptype in ['int', 'Integer']:
                                    param_reads.append(f'        int {pname} = Integer.parseInt(sc.nextLine().trim());')
                                elif ptype in ['long', 'Long']:
                                    param_reads.append(f'        long {pname} = Long.parseLong(sc.nextLine().trim());')
                                elif ptype in ['double', 'Double']:
                                    param_reads.append(f'        double {pname} = Double.parseDouble(sc.nextLine().trim());')
                                elif ptype in ['float', 'Float']:
                                    param_reads.append(f'        float {pname} = Float.parseFloat(sc.nextLine().trim());')
                                elif ptype == 'String':
                                    param_reads.append(f'        String {pname} = sc.nextLine();')
                                elif ptype in ['boolean', 'Boolean']:
                                    param_reads.append(f'        boolean {pname} = Boolean.parseBoolean(sc.nextLine().trim());')
                                elif ptype == 'char' or ptype == 'Character':
                                    param_reads.append(f'        char {pname} = sc.nextLine().trim().charAt(0);')
                                else:
                                    # Unknown type - default to String
                                    param_reads.append(f'        String {pname} = sc.nextLine().trim();')
                    
                    # Generate output formatting dynamically based on return type
                    return_type_lower = return_type.lower().replace(' ', '')
                    
                    if return_type == 'void' or 'void' in return_type_lower:
                        output_code = f'        {func_name}({", ".join(param_names)});'
                    elif '[]' in return_type or 'array' in return_type_lower:
                        # Array return type - format as [1, 2, 3]
                        output_code = f'''        {return_type} result = {func_name}({", ".join(param_names)});
        StringBuilder sb = new StringBuilder("[");
        for(int i=0; i<result.length; i++) {{
            sb.append(result[i]);
            if(i < result.length - 1) sb.append(", ");
        }}
        sb.append("]");
        System.out.println(sb.toString());'''
                    elif 'list<' in return_type_lower or return_type.startswith('List'):
                        # List return type - format as [1, 2, 3]
                        output_code = f'''        {return_type} result = {func_name}({", ".join(param_names)});
        StringBuilder sb = new StringBuilder("[");
        for(int i=0; i<result.size(); i++) {{
            sb.append(result.get(i));
            if(i < result.size() - 1) sb.append(", ");
        }}
        sb.append("]");
        System.out.println(sb.toString());'''
                    elif return_type in ['boolean', 'Boolean']:
                        # Boolean - capitalize first letter
                        output_code = f'''        {return_type} result = {func_name}({", ".join(param_names)});
        System.out.println(result ? "True" : "False");'''
                    else:
                        # Default: print directly (works for String, int, long, double, etc.)
                        output_code = f'        System.out.println({func_name}({", ".join(param_names)}));'
                    
                    # Check what imports are needed based on parameters and return type
                    needs_scanner = any(param_reads)  # Need Scanner if we have parameters
                    
                    # Check parameter types for List/Array usage
                    param_types = []
                    if params_str.strip():
                        # Use the same parsing logic as above
                        current_param = ""
                        depth = 0
                        for char in params_str:
                            if char == '<':
                                depth += 1
                            elif char == '>':
                                depth -= 1
                            elif char == ',' and depth == 0:
                                if current_param.strip():
                                    parts = current_param.strip().rsplit(' ', 1)
                                    if len(parts) == 2:
                                        param_types.append(parts[0].strip())
                                current_param = ""
                                continue
                            current_param += char
                        if current_param.strip():
                            parts = current_param.strip().rsplit(' ', 1)
                            if len(parts) == 2:
                                param_types.append(parts[0].strip())
                    
                    needs_list = any('List<' in ptype or ptype.startswith('List') for ptype in param_types)
                    needs_list = needs_list or 'List<' in return_type or return_type.startswith('List')
                    needs_arrays = any('[]' in ptype for ptype in param_types)
                    
                    # Build import statement
                    imports_needed = []
                    if needs_scanner and 'import java.util' not in user_code:
                        imports_needed.append('import java.util.*;')
                    elif needs_list and 'import java.util' not in user_code:
                        imports_needed.append('import java.util.*;')
                    elif needs_arrays and 'import java.util' not in user_code:
                        imports_needed.append('import java.util.*;')
                    
                    import_line = '\n'.join(imports_needed) + '\n\n' if imports_needed else ''
                    
                    # Replace empty main method with populated one
                    main_replacement = f'''    public static void main(String[] args) {{
        Scanner sc = new Scanner(System.in);
{chr(10).join(param_reads) if param_reads else '        // No parameters'}
{output_code}
        sc.close();
    }}'''
                    
                    # Replace the empty main method
                    user_code = re.sub(
                        r'public\s+static\s+void\s+main\s*\([^)]*\)\s*\{[^}]*\}',
                        main_replacement,
                        user_code,
                        flags=re.DOTALL
                    )
                    
                    # Add imports if needed
                    if import_line and 'import java.util' not in user_code:
                        # Insert after package declaration or at the beginning
                        if re.search(r'^package\s+', user_code, re.MULTILINE):
                            user_code = re.sub(r'(^package\s+[^;]+;)', r'\1\n' + import_line.strip(), user_code, flags=re.MULTILINE)
                        else:
                            user_code = import_line + user_code
        
        return user_code
    
    # No class - wrap in Main class
    # Try to detect function signature from code
    func_match = re.search(
        r'(?:public\s+)?(?:static\s+)?(\w+(?:\[\])?)\s+(\w+)\s*\(([^)]*)\)',
        user_code
    )
    
    if func_match and func_match.group(2) != 'main':
        return_type = func_match.group(1)
        func_name = func_match.group(2)
        params_str = func_match.group(3)
        
        # Parse parameters
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                parts = param.rsplit(' ', 1)
                if len(parts) == 2:
                    ptype, pname = parts[0].strip(), parts[1].strip()
                    param_names.append(pname)
                    # Generate input reading based on type
                    if 'int[]' in ptype or 'Integer[]' in ptype:
                        param_reads.append(f'        String[] {pname}Parts = sc.nextLine().replaceAll("[\\\\[\\\\]]", "").split(",\\\\s*");')
                        param_reads.append(f'        int[] {pname} = new int[{pname}Parts.length];')
                        param_reads.append(f'        for(int i=0; i<{pname}Parts.length; i++) {pname}[i] = Integer.parseInt({pname}Parts[i].trim());')
                    elif ptype in ['int', 'Integer']:
                        param_reads.append(f'        int {pname} = Integer.parseInt(sc.nextLine().trim());')
                    elif ptype in ['long', 'Long']:
                        param_reads.append(f'        long {pname} = Long.parseLong(sc.nextLine().trim());')
                    elif ptype in ['double', 'Double']:
                        param_reads.append(f'        double {pname} = Double.parseDouble(sc.nextLine().trim());')
                    elif ptype in ['String']:
                        param_reads.append(f'        String {pname} = sc.nextLine();')
                    elif ptype in ['boolean', 'Boolean']:
                        param_reads.append(f'        boolean {pname} = Boolean.parseBoolean(sc.nextLine().trim());')
                    else:
                        param_reads.append(f'        String {pname} = sc.nextLine().trim();')
        
        # Generate output formatting
        if return_type == 'void':
            output_code = f'        {func_name}({", ".join(param_names)});'
        elif 'int[]' in return_type:
            output_code = f'''        {return_type} result = {func_name}({", ".join(param_names)});
        StringBuilder sb = new StringBuilder("[");
        for(int i=0; i<result.length; i++) {{ sb.append(result[i]); if(i<result.length-1) sb.append(", "); }}
        sb.append("]");
        System.out.println(sb.toString());'''
        else:
            output_code = f'        System.out.println({func_name}({", ".join(param_names)}));'
        
        wrapped = f'''import java.util.*;

public class Main {{
{user_code}

    public static void main(String[] args) {{
        Scanner sc = new Scanner(System.in);
{chr(10).join(param_reads)}
{output_code}
        sc.close();
    }}
}}'''
        return wrapped
    
    # Fallback: wrap as-is with basic main
    return f'''import java.util.*;

public class Main {{
{user_code}

    public static void main(String[] args) {{
        Scanner sc = new Scanner(System.in);
        // Auto-generated main - modify as needed
        sc.close();
    }}
}}'''


def _auto_wrap_python(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap Python code if needed."""
    # Check if already has main block
    if '__main__' in user_code or 'input(' in user_code:
        return user_code
    
    # Try to detect function
    func_match = re.search(r'def\s+(\w+)\s*\(([^)]*)\)', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        
        # Count parameters
        params = [p.strip().split(':')[0].strip() for p in params_str.split(',') if p.strip()]
        
        # Generate input reading
        input_lines = []
        param_vars = []
        for i, param in enumerate(params):
            # Try to infer type from name or annotation
            if 'arr' in param.lower() or 'list' in param.lower() or 'nums' in param.lower():
                input_lines.append(f'{param} = list(map(int, input().strip().replace("[","").replace("]","").split(",")))')
            elif 'str' in param.lower() or 's' == param.lower():
                input_lines.append(f'{param} = input().strip()')
            else:
                input_lines.append(f'{param} = int(input().strip())')
            param_vars.append(param)
        
        # Build input lines with proper indentation
        input_code = "\n    ".join(input_lines) if input_lines else "pass"
        
        main_block = f'''

if __name__ == "__main__":
    {input_code}
    result = {func_name}({", ".join(param_vars)})
    print(result)
'''
        return user_code + main_block
    
    return user_code


def _auto_wrap_cpp(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap C++ code if needed."""
    # Check if already has main
    if re.search(r'int\s+main\s*\(', user_code):
        return user_code
    
    # Check for includes
    has_iostream = '#include' in user_code and 'iostream' in user_code
    has_vector = 'vector' in user_code
    
    includes = []
    if not has_iostream:
        includes.append('#include <iostream>')
    if has_vector and '#include <vector>' not in user_code:
        includes.append('#include <vector>')
    
    # Try to detect function
    func_match = re.search(r'(\w+(?:\s*<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)', user_code)
    if func_match and func_match.group(2) not in ['if', 'while', 'for', 'switch']:
        return_type = func_match.group(1)
        func_name = func_match.group(2)
        params_str = func_match.group(3)
        
        # Parse parameters
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                # Handle references and pointers
                param = param.replace('&', '').replace('*', '')
                parts = param.rsplit(' ', 1)
                if len(parts) == 2:
                    ptype, pname = parts[0].strip(), parts[1].strip()
                    param_names.append(pname)
                    if 'vector<int>' in ptype:
                        param_reads.append(f'    int n; std::cin >> n;')
                        param_reads.append(f'    std::vector<int> {pname}(n);')
                        param_reads.append(f'    for(int i=0; i<n; i++) std::cin >> {pname}[i];')
                    elif ptype in ['int']:
                        param_reads.append(f'    int {pname}; std::cin >> {pname};')
                    elif ptype in ['long', 'long long']:
                        param_reads.append(f'    long long {pname}; std::cin >> {pname};')
                    elif ptype in ['double', 'float']:
                        param_reads.append(f'    double {pname}; std::cin >> {pname};')
                    elif 'string' in ptype:
                        param_reads.append(f'    std::string {pname}; std::cin >> {pname};')
                    else:
                        param_reads.append(f'    {ptype} {pname}; std::cin >> {pname};')
        
        includes_str = '\n'.join(includes) + '\n' if includes else ''
        
        wrapped = f'''{includes_str}using namespace std;

{user_code}

int main() {{
{chr(10).join(param_reads)}
    auto result = {func_name}({", ".join(param_names)});
    cout << result << endl;
    return 0;
}}'''
        return wrapped
    
    # Fallback
    includes_str = '\n'.join(includes) + '\n' if includes else ''
    return f'''{includes_str}using namespace std;

{user_code}

int main() {{
    // Auto-generated main
    return 0;
}}'''


def _auto_wrap_javascript(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap JavaScript/TypeScript code if needed."""
    # Check if already has readline setup
    if 'readline' in user_code or 'process.stdin' in user_code:
        return user_code
    
    # Try to detect function - handle both JavaScript and TypeScript syntax
    # Pattern 1: function name(params) or function name(params): returnType (TypeScript)
    func_match = re.search(r'function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*\{', user_code)
    
    if not func_match:
        # Pattern 2: const/let/var name = (params) => or (params): returnType => (TypeScript)
        func_match = re.search(r'(?:const|let|var)\s+(\w+)\s*=\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*=>', user_code)
    
    if not func_match:
        # Pattern 3: Arrow function without const/let/var (standalone)
        func_match = re.search(r'(\w+)\s*=\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*=>', user_code)
    
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        
        # Parse parameters - handle TypeScript type annotations
        # Remove type annotations like "n: number" -> "n"
        params = []
        for param in params_str.split(','):
            param = param.strip()
            if not param:
                continue
            # Remove TypeScript type annotations (e.g., "n: number" -> "n")
            if ':' in param:
                param = param.split(':')[0].strip()
            params.append(param)
        
        # Generate input parsing based on parameter names and types
        param_parsing = []
        for i, param in enumerate(params):
            param_lower = param.lower()
            # Try to infer type from parameter name
            if 'arr' in param_lower or 'nums' in param_lower or 'list' in param_lower or 'array' in param_lower:
                param_parsing.append(f'    const {param} = lines[{i}].replace(/[\\[\\]]/g, "").split(",").map(Number);')
            elif 'str' in param_lower or param_lower == 's' or param_lower == 'text':
                param_parsing.append(f'    const {param} = lines[{i}];')
            elif 'bool' in param_lower:
                param_parsing.append(f'    const {param} = lines[{i}].toLowerCase() === "true";')
            else:
                # Default to number
                param_parsing.append(f'    const {param} = parseInt(lines[{i}]) || parseFloat(lines[{i}]);')
        
        wrapped = f'''{user_code}

const readline = require('readline');
const rl = readline.createInterface({{ input: process.stdin }});
const lines = [];
rl.on('line', (line) => lines.push(line.trim()));
rl.on('close', () => {{
{chr(10).join(param_parsing) if param_parsing else '    // No parameters'}
    const result = {func_name}({", ".join(params) if params else ""});
    console.log(result);
}});'''
        return wrapped
    
    return user_code


def _auto_wrap_c(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap C code if needed."""
    if re.search(r'int\s+main\s*\(', user_code):
        return user_code
    
    has_stdio = '#include' in user_code and 'stdio' in user_code
    
    includes = []
    if not has_stdio:
        includes.append('#include <stdio.h>')
    if 'stdlib' not in user_code:
        includes.append('#include <stdlib.h>')
    if 'string' not in user_code and 'char' in user_code:
        includes.append('#include <string.h>')
    
    # Detect function
    func_match = re.search(r'(\w+)\s+(\w+)\s*\(([^)]*)\)', user_code)
    if func_match and func_match.group(2) not in ['if', 'while', 'for', 'switch']:
        return_type = func_match.group(1)
        func_name = func_match.group(2)
        params_str = func_match.group(3)
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip().replace('*', '')
                parts = param.rsplit(' ', 1)
                if len(parts) == 2:
                    ptype, pname = parts[0].strip(), parts[1].strip()
                    param_names.append(pname)
                    if ptype == 'int':
                        param_reads.append(f'    int {pname}; scanf("%d", &{pname});')
                    elif ptype == 'long':
                        param_reads.append(f'    long {pname}; scanf("%ld", &{pname});')
                    elif ptype == 'double':
                        param_reads.append(f'    double {pname}; scanf("%lf", &{pname});')
                    elif ptype == 'char':
                        param_reads.append(f'    char {pname}; scanf(" %c", &{pname});')
                    else:
                        param_reads.append(f'    int {pname}; scanf("%d", &{pname});')
        
        includes_str = '\n'.join(includes) + '\n\n' if includes else ''
        
        if return_type == 'void':
            output = f'    {func_name}({", ".join(param_names)});'
        elif return_type == 'int':
            output = f'    printf("%d\\n", {func_name}({", ".join(param_names)}));'
        elif return_type == 'long':
            output = f'    printf("%ld\\n", {func_name}({", ".join(param_names)}));'
        elif return_type == 'double':
            output = f'    printf("%f\\n", {func_name}({", ".join(param_names)}));'
        elif return_type == 'char':
            output = f'    printf("%c\\n", {func_name}({", ".join(param_names)}));'
        else:
            output = f'    printf("%d\\n", {func_name}({", ".join(param_names)}));'
        
        return f'''{includes_str}{user_code}

int main() {{
{chr(10).join(param_reads)}
{output}
    return 0;
}}'''
    
    includes_str = '\n'.join(includes) + '\n\n' if includes else ''
    return f'''{includes_str}{user_code}

int main() {{
    return 0;
}}'''


def _auto_wrap_go(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap Go code if needed."""
    if 'func main()' in user_code:
        return user_code
    
    has_package = 'package main' in user_code
    has_fmt = '"fmt"' in user_code
    
    # Detect function
    func_match = re.search(r'func\s+(\w+)\s*\(([^)]*)\)\s*(\w+)?', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        return_type = func_match.group(3) or ''
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                parts = param.split()
                if len(parts) >= 2:
                    pname = parts[0]
                    ptype = parts[-1]
                    param_names.append(pname)
                    if ptype == 'int':
                        param_reads.append(f'\tvar {pname} int\n\tfmt.Scan(&{pname})')
                    elif ptype == 'int64':
                        param_reads.append(f'\tvar {pname} int64\n\tfmt.Scan(&{pname})')
                    elif ptype == 'float64':
                        param_reads.append(f'\tvar {pname} float64\n\tfmt.Scan(&{pname})')
                    elif ptype == 'string':
                        param_reads.append(f'\tvar {pname} string\n\tfmt.Scan(&{pname})')
                    elif ptype == 'bool':
                        param_reads.append(f'\tvar {pname} bool\n\tfmt.Scan(&{pname})')
                    else:
                        param_reads.append(f'\tvar {pname} int\n\tfmt.Scan(&{pname})')
        
        package_line = '' if has_package else 'package main\n\n'
        import_line = '' if has_fmt else 'import "fmt"\n\n'
        
        return f'''{package_line}{import_line}{user_code}

func main() {{
{chr(10).join(param_reads)}
\tresult := {func_name}({", ".join(param_names)})
\tfmt.Println(result)
}}'''
    
    package_line = '' if has_package else 'package main\n\n'
    import_line = '' if has_fmt else 'import "fmt"\n\n'
    return f'''{package_line}{import_line}{user_code}

func main() {{
}}'''


def _auto_wrap_rust(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap Rust code if needed."""
    if 'fn main()' in user_code:
        return user_code
    
    has_io = 'use std::io' in user_code
    
    # Detect function
    func_match = re.search(r'fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+))?', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        return_type = func_match.group(3) or ''
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                if ':' in param:
                    pname, ptype = param.split(':')
                    pname = pname.strip()
                    ptype = ptype.strip()
                    param_names.append(pname)
                    param_reads.append(f'    let mut {pname}_input = String::new();')
                    param_reads.append(f'    io::stdin().read_line(&mut {pname}_input).unwrap();')
                    if ptype in ['i32', 'i64', 'u32', 'u64', 'isize', 'usize']:
                        param_reads.append(f'    let {pname}: {ptype} = {pname}_input.trim().parse().unwrap();')
                    elif ptype == 'f64' or ptype == 'f32':
                        param_reads.append(f'    let {pname}: {ptype} = {pname}_input.trim().parse().unwrap();')
                    elif ptype == 'String':
                        param_reads.append(f'    let {pname} = {pname}_input.trim().to_string();')
                    elif ptype == 'bool':
                        param_reads.append(f'    let {pname}: bool = {pname}_input.trim().parse().unwrap();')
                    else:
                        param_reads.append(f'    let {pname}: i32 = {pname}_input.trim().parse().unwrap();')
        
        io_import = '' if has_io else 'use std::io;\n\n'
        
        return f'''{io_import}{user_code}

fn main() {{
{chr(10).join(param_reads)}
    let result = {func_name}({", ".join(param_names)});
    println!("{{:?}}", result);
}}'''
    
    io_import = '' if has_io else 'use std::io;\n\n'
    return f'''{io_import}{user_code}

fn main() {{
}}'''


def _auto_wrap_kotlin(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap Kotlin code if needed."""
    if 'fun main(' in user_code:
        return user_code
    
    # Detect function
    func_match = re.search(r'fun\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*(\w+))?', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        return_type = func_match.group(3) or ''
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                if ':' in param:
                    pname, ptype = param.split(':')
                    pname = pname.strip()
                    ptype = ptype.strip()
                    param_names.append(pname)
                    if ptype in ['Int']:
                        param_reads.append(f'    val {pname} = readLine()!!.trim().toInt()')
                    elif ptype in ['Long']:
                        param_reads.append(f'    val {pname} = readLine()!!.trim().toLong()')
                    elif ptype in ['Double']:
                        param_reads.append(f'    val {pname} = readLine()!!.trim().toDouble()')
                    elif ptype in ['String']:
                        param_reads.append(f'    val {pname} = readLine()!!.trim()')
                    elif ptype in ['Boolean']:
                        param_reads.append(f'    val {pname} = readLine()!!.trim().toBoolean()')
                    elif 'IntArray' in ptype or 'List<Int>' in ptype:
                        param_reads.append(f'    val {pname} = readLine()!!.trim().removeSurrounding("[", "]").split(",").map {{ it.trim().toInt() }}')
                    else:
                        param_reads.append(f'    val {pname} = readLine()!!.trim().toInt()')
        
        return f'''{user_code}

fun main() {{
{chr(10).join(param_reads)}
    val result = {func_name}({", ".join(param_names)})
    println(result)
}}'''
    
    return f'''{user_code}

fun main() {{
}}'''


def _auto_wrap_csharp(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap C# code if needed."""
    if 'static void Main(' in user_code or 'static void main(' in user_code:
        return user_code
    
    has_using = 'using System;' in user_code
    
    # Detect function
    func_match = re.search(r'(?:public\s+)?(?:static\s+)?(\w+)\s+(\w+)\s*\(([^)]*)\)', user_code)
    if func_match and func_match.group(2) not in ['if', 'while', 'for']:
        return_type = func_match.group(1)
        func_name = func_match.group(2)
        params_str = func_match.group(3)
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                parts = param.rsplit(' ', 1)
                if len(parts) == 2:
                    ptype, pname = parts[0].strip(), parts[1].strip()
                    param_names.append(pname)
                    if ptype in ['int']:
                        param_reads.append(f'        int {pname} = int.Parse(Console.ReadLine().Trim());')
                    elif ptype in ['long']:
                        param_reads.append(f'        long {pname} = long.Parse(Console.ReadLine().Trim());')
                    elif ptype in ['double']:
                        param_reads.append(f'        double {pname} = double.Parse(Console.ReadLine().Trim());')
                    elif ptype in ['string']:
                        param_reads.append(f'        string {pname} = Console.ReadLine().Trim();')
                    elif ptype in ['bool']:
                        param_reads.append(f'        bool {pname} = bool.Parse(Console.ReadLine().Trim());')
                    elif 'int[]' in ptype:
                        param_reads.append(f'        int[] {pname} = Console.ReadLine().Trim().Replace("[","").Replace("]","").Split(\',\').Select(int.Parse).ToArray();')
                    else:
                        param_reads.append(f'        int {pname} = int.Parse(Console.ReadLine().Trim());')
        
        using_line = '' if has_using else 'using System;\nusing System.Linq;\n\n'
        
        return f'''{using_line}class Solution {{
{user_code}

    static void Main(string[] args) {{
{chr(10).join(param_reads)}
        var result = {func_name}({", ".join(param_names)});
        Console.WriteLine(result);
    }}
}}'''
    
    using_line = '' if has_using else 'using System;\n\n'
    return f'''{using_line}class Solution {{
{user_code}

    static void Main(string[] args) {{
    }}
}}'''


def _auto_wrap_typescript(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap TypeScript code if needed.
    
    TypeScript is handled similarly to JavaScript, but we need to be careful
    with type annotations. Judge0 TypeScript (ID 74) supports TypeScript syntax.
    """
    # Check if already has readline setup
    if 'readline' in user_code or 'process.stdin' in user_code:
        return user_code
    
    # Try to detect function - handle TypeScript syntax with type annotations
    # Pattern 1: function name(param: type): returnType { ... }
    func_match = re.search(r'function\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*\{', user_code)
    
    if not func_match:
        # Pattern 2: const/let/var name = (param: type): returnType => { ... }
        func_match = re.search(r'(?:const|let|var)\s+(\w+)\s*=\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*=>', user_code)
    
    if not func_match:
        # Pattern 3: Arrow function without const/let/var
        func_match = re.search(r'(\w+)\s*=\s*\(([^)]*)\)\s*(?::\s*[^{]+)?\s*=>', user_code)
    
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        
        # Parse parameters - handle TypeScript type annotations
        # Remove type annotations like "n: number" -> "n"
        params = []
        for param in params_str.split(','):
            param = param.strip()
            if not param:
                continue
            # Remove TypeScript type annotations (e.g., "n: number" -> "n")
            if ':' in param:
                param = param.split(':')[0].strip()
            params.append(param)
        
        # Generate input parsing based on parameter names and types
        param_parsing = []
        for i, param in enumerate(params):
            param_lower = param.lower()
            # Try to infer type from parameter name
            if 'arr' in param_lower or 'nums' in param_lower or 'list' in param_lower or 'array' in param_lower:
                param_parsing.append(f'    const {param} = lines[{i}].replace(/[\\[\\]]/g, "").split(",").map(Number);')
            elif 'str' in param_lower or param_lower == 's' or param_lower == 'text':
                param_parsing.append(f'    const {param} = lines[{i}];')
            elif 'bool' in param_lower:
                param_parsing.append(f'    const {param} = lines[{i}].toLowerCase() === "true";')
            else:
                # Default to number
                param_parsing.append(f'    const {param} = parseInt(lines[{i}]) || parseFloat(lines[{i}]);')
        
        wrapped = f'''// TypeScript type declarations for Node.js (Judge0 environment)
declare const require: (module: string) => any;
declare const process: {{
    stdin: any;
}};

{user_code}

// @ts-ignore - Node.js globals available in Judge0 runtime
const readline = require('readline');
// @ts-ignore
const rl = readline.createInterface({{ input: process.stdin }});
const lines: string[] = [];
rl.on('line', (line: string) => lines.push(line.trim()));
rl.on('close', () => {{
{chr(10).join(param_parsing) if param_parsing else '    // No parameters'}
    const result = {func_name}({", ".join(params) if params else ""});
    console.log(result);
}});'''
        return wrapped
    
    return user_code


def _auto_wrap_ruby(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap Ruby code if needed."""
    # Check if already has input reading
    if 'gets' in user_code or 'ARGV' in user_code:
        return user_code
    
    # Detect function
    func_match = re.search(r'def\s+(\w+)\s*\(([^)]*)\)', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                param_names.append(param)
                if 'arr' in param.lower() or 'nums' in param.lower():
                    param_reads.append(f'{param} = gets.chomp.gsub(/[\\[\\]]/, "").split(",").map(&:to_i)')
                elif 'str' in param.lower() or 's' == param.lower():
                    param_reads.append(f'{param} = gets.chomp')
                else:
                    param_reads.append(f'{param} = gets.chomp.to_i')
        
        return f'''{user_code}

{chr(10).join(param_reads)}
result = {func_name}({", ".join(param_names)})
puts result'''
    
    return user_code


def _auto_wrap_swift(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap Swift code if needed."""
    # Check if already has input reading or main
    if 'readLine()' in user_code:
        return user_code
    
    # Detect function
    func_match = re.search(r'func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*(\w+))?', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        return_type = func_match.group(3) or ''
        
        param_names = []
        param_reads = []
        if params_str.strip():
            # Swift params can have external and internal names: "_ nums: [Int]"
            for param in params_str.split(','):
                param = param.strip()
                if ':' in param:
                    name_part, type_part = param.rsplit(':', 1)
                    # Get the internal name (last word before :)
                    pname = name_part.split()[-1].strip()
                    ptype = type_part.strip()
                    param_names.append(pname)
                    if ptype == 'Int':
                        param_reads.append(f'let {pname} = Int(readLine()!.trimmingCharacters(in: .whitespaces))!')
                    elif ptype == 'Double':
                        param_reads.append(f'let {pname} = Double(readLine()!.trimmingCharacters(in: .whitespaces))!')
                    elif ptype == 'String':
                        param_reads.append(f'let {pname} = readLine()!.trimmingCharacters(in: .whitespaces)')
                    elif ptype == 'Bool':
                        param_reads.append(f'let {pname} = Bool(readLine()!.trimmingCharacters(in: .whitespaces))!')
                    elif '[Int]' in ptype:
                        param_reads.append(f'let {pname} = readLine()!.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "").split(separator: ",").map {{ Int($0.trimmingCharacters(in: .whitespaces))! }}')
                    else:
                        param_reads.append(f'let {pname} = Int(readLine()!.trimmingCharacters(in: .whitespaces))!')
        
        return f'''{user_code}

{chr(10).join(param_reads)}
let result = {func_name}({", ".join(param_names)})
print(result)'''
    
    return user_code


def _auto_wrap_php(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap PHP code if needed."""
    # Check if already has input reading
    if 'fgets' in user_code or 'readline' in user_code or 'STDIN' in user_code:
        return user_code
    
    # Add PHP opening tag if missing
    has_php_tag = '<?php' in user_code
    
    # Detect function
    func_match = re.search(r'function\s+(\w+)\s*\(([^)]*)\)', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                # PHP params start with $
                if param.startswith('$'):
                    pname = param
                else:
                    pname = '$' + param
                # Remove type hints
                if ' ' in pname:
                    pname = pname.split()[-1]
                param_names.append(pname)
                if 'arr' in pname.lower() or 'nums' in pname.lower():
                    param_reads.append(f'{pname} = array_map("intval", explode(",", trim(str_replace(["[", "]"], "", fgets(STDIN)))));')
                else:
                    param_reads.append(f'{pname} = intval(trim(fgets(STDIN)));')
        
        php_tag = '' if has_php_tag else '<?php\n'
        
        return f'''{php_tag}{user_code}

{chr(10).join(param_reads)}
$result = {func_name}({", ".join(param_names)});
echo $result . "\\n";
?>'''
    
    php_tag = '' if has_php_tag else '<?php\n'
    return f'''{php_tag}{user_code}
?>'''


def _auto_wrap_scala(user_code: str, func_sig: Optional[FunctionSignature] = None) -> str:
    """Auto-wrap Scala code if needed."""
    if 'def main(' in user_code or 'object Main' in user_code:
        return user_code
    
    # Detect function
    func_match = re.search(r'def\s+(\w+)\s*\(([^)]*)\)\s*(?::\s*(\w+))?', user_code)
    if func_match:
        func_name = func_match.group(1)
        params_str = func_match.group(2)
        return_type = func_match.group(3) or ''
        
        param_names = []
        param_reads = []
        if params_str.strip():
            for param in params_str.split(','):
                param = param.strip()
                if ':' in param:
                    pname, ptype = param.split(':')
                    pname = pname.strip()
                    ptype = ptype.strip()
                    param_names.append(pname)
                    if ptype in ['Int']:
                        param_reads.append(f'    val {pname} = scala.io.StdIn.readLine().trim.toInt')
                    elif ptype in ['Long']:
                        param_reads.append(f'    val {pname} = scala.io.StdIn.readLine().trim.toLong')
                    elif ptype in ['Double']:
                        param_reads.append(f'    val {pname} = scala.io.StdIn.readLine().trim.toDouble')
                    elif ptype in ['String']:
                        param_reads.append(f'    val {pname} = scala.io.StdIn.readLine().trim')
                    elif ptype in ['Boolean']:
                        param_reads.append(f'    val {pname} = scala.io.StdIn.readLine().trim.toBoolean')
                    else:
                        param_reads.append(f'    val {pname} = scala.io.StdIn.readLine().trim.toInt')
        
        return f'''object Main {{
{user_code}

  def main(args: Array[String]): Unit = {{
{chr(10).join(param_reads)}
    val result = {func_name}({", ".join(param_names)})
    println(result)
  }}
}}'''
    
    return f'''object Main {{
{user_code}

  def main(args: Array[String]): Unit = {{
  }}
}}'''


# Map of auto-wrappers for DSA languages
AUTO_WRAPPERS = {
    # Tier 1: Most common DSA languages
    'java': _auto_wrap_java,
    'python': _auto_wrap_python,
    'python3': _auto_wrap_python,
    'cpp': _auto_wrap_cpp,
    'c++': _auto_wrap_cpp,
    'c': _auto_wrap_c,
    'javascript': _auto_wrap_javascript,
    'js': _auto_wrap_javascript,
    'node': _auto_wrap_javascript,
    
    # Tier 2: Popular alternatives
    'go': _auto_wrap_go,
    'golang': _auto_wrap_go,
    'rust': _auto_wrap_rust,
    'kotlin': _auto_wrap_kotlin,
    'csharp': _auto_wrap_csharp,
    'c#': _auto_wrap_csharp,
    'cs': _auto_wrap_csharp,
    
    # Tier 3: Other DSA languages
    'typescript': _auto_wrap_typescript,
    'ts': _auto_wrap_typescript,
    'ruby': _auto_wrap_ruby,
    'rb': _auto_wrap_ruby,
    'swift': _auto_wrap_swift,
    'php': _auto_wrap_php,
    'scala': _auto_wrap_scala,
}


# ============================================================================
# VALIDATION
# ============================================================================

def validate_user_code(code: str, language: str) -> Tuple[bool, Optional[str]]:
    """
    Validate user code for security issues.
    Basic checks that apply to any language.
    """
    if not code or not code.strip():
        return False, "Code cannot be empty"
    
    # Check for dangerous patterns (any language)
    dangerous_patterns = [
        (r'rm\s+-rf', "Dangerous shell command detected"),
        (r'format\s+c:', "Dangerous operation detected"),
        (r'del\s+/[sS]', "Dangerous operation detected"),
        (r':(){ :|:& };:', "Fork bomb detected"),
    ]
    
    for pattern, message in dangerous_patterns:
        if re.search(pattern, code, re.IGNORECASE):
            return False, message
    
    return True, None


def detect_hardcoding(code: str, expected_outputs: List[str]) -> Tuple[bool, Optional[str]]:
    """
    Detect if user is trying to hardcode test case outputs.
    Works for any language.
    """
    if not expected_outputs:
        return False, None
    
    for output in expected_outputs:
        output_clean = output.strip()
        # Only flag long, specific outputs
        if len(output_clean) > 5 and output_clean in code:
            return_patterns = [
                rf'return\s+.*{re.escape(output_clean)}',
                rf'=\s*{re.escape(output_clean)}\s*;?\s*$',
            ]
            for pattern in return_patterns:
                if re.search(pattern, code, re.MULTILINE):
                    return True, f"Potential hardcoded output detected"
    
    return False, None


# ============================================================================
# MAIN WRAPPER FUNCTION
# ============================================================================

def wrap_user_code(
    user_code: str,
    language: str,
    function_signature: Optional[FunctionSignature] = None,
    wrapper_template: Optional[str] = None,
) -> Tuple[str, Optional[str]]:
    """
    Wrap user code with I/O handling.
    
    Priority:
    1. If wrapper_template is provided (admin-defined) → use it
    2. If language has auto-wrapper → use auto-wrapper
    3. Otherwise → return code as-is
    
    Returns:
        (wrapped_code, error_message)
    """
    # Priority 1: Admin-defined wrapper template
    if wrapper_template:
        if "{user_code}" in wrapper_template:
            wrapped = wrapper_template.replace("{user_code}", user_code)
            logger.info(f"Used admin-defined wrapper template for {language}")
            return wrapped, None
        else:
            logger.warning("Wrapper template missing {user_code} placeholder")
            return wrapper_template + "\n" + user_code, None
    
    # Priority 2: Auto-wrapper for known languages
    lang_key = language.lower().strip()
    if lang_key in AUTO_WRAPPERS:
        try:
            wrapped = AUTO_WRAPPERS[lang_key](user_code, function_signature)
            logger.info(f"Auto-wrapped code for {language}")
            return wrapped, None
        except Exception as e:
            logger.error(f"Auto-wrap failed for {language}: {e}")
            # Fall through to return code as-is
    
    # Priority 3: Return code as-is
    logger.info(f"No wrapper available for {language}, using code as-is")
    return user_code, None


def prepare_code_for_execution(
    user_code: str,
    language: str,
    question_config: Optional[Dict] = None,
) -> Tuple[str, Optional[str]]:
    """
    Prepare user code for execution in Judge0.
    
    Args:
        user_code: The user's submitted code
        language: The programming language
        question_config: Optional question configuration containing:
            - wrapper_template: Custom wrapper for this language
            - function_signature: Expected function signature
            - expected_outputs: For hardcoding detection
    
    Returns:
        (prepared_code, error_message)
    """
    # Basic validation
    is_valid, error = validate_user_code(user_code, language)
    if not is_valid:
        return user_code, error
    
    # If no question config, try auto-wrap
    if not question_config:
        return wrap_user_code(user_code, language)
    
    # Check for hardcoding
    if question_config.get("expected_outputs"):
        is_hardcoded, warning = detect_hardcoding(
            user_code, 
            question_config["expected_outputs"]
        )
        if is_hardcoded:
            logger.warning(f"Hardcoding detected: {warning}")
    
    # Get wrapper template and function signature
    wrapper_template = question_config.get("wrapper_template")
    
    func_sig = None
    if question_config.get("function_signature"):
        sig_data = question_config["function_signature"]
        func_sig = FunctionSignature(
            name=sig_data.get("name", "solution"),
            parameters=sig_data.get("parameters", []),
            return_type=sig_data.get("return_type", "void"),
        )
    
    # Wrap the code
    return wrap_user_code(
        user_code=user_code,
        language=language,
        function_signature=func_sig,
        wrapper_template=wrapper_template,
    )
