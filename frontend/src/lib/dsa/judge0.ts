// Judge0 Language ID mapping for DSA (Data Structures & Algorithms) languages
// These are commonly used languages for competitive programming and DSA
// Language IDs match backend/app/dsa/utils/judge0.py
export const LANGUAGE_IDS = {
  python: 71,      // Python 3 - most popular for DSA
  javascript: 63,  // Node.js - web-based DSA
  cpp: 54,         // C++ (GCC) - standard for competitive programming
  java: 62,        // Java - widely used for DSA
  c: 50,           // C - fundamental language for DSA
  go: 60,          // Go - growing in popularity for DSA
  rust: 73,        // Rust - modern systems language, good for DSA
  csharp: 51,      // C# - used in some DSA contexts
  kotlin: 78,      // Kotlin - Android development, DSA
  typescript: 74,  // TypeScript - JavaScript with types, good for DSA
} as const

export type Language = keyof typeof LANGUAGE_IDS

export function getLanguageId(language: string): number | null {
  return LANGUAGE_IDS[language.toLowerCase() as Language] || null
}

export function getLanguageName(languageId: number): string | null {
  const entries = Object.entries(LANGUAGE_IDS)
  const found = entries.find(([_, id]) => id === languageId)
  return found ? found[0] : null
}

// Monaco Editor language mapping
export const MONACO_LANGUAGES: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  cpp: 'cpp',
  java: 'java',
  c: 'c',
  go: 'go',
  rust: 'rust',
  csharp: 'csharp',
  kotlin: 'kotlin',
  typescript: 'typescript',
}

