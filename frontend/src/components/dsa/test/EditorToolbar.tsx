'use client'

import { Button } from '../ui/button'
import { Select } from '../ui/select'
import { Play, Send, RotateCcw } from 'lucide-react'

interface EditorToolbarProps {
  language: string
  languages: string[]
  onLanguageChange: (lang: string) => void
  onRun: () => void
  onSubmit: () => void
  onReset: () => void
  running?: boolean
  submitting?: boolean
}

// Language display names mapping
const LANGUAGE_DISPLAY_NAMES: Record<string, string> = {
  python: 'Python',
  javascript: 'JavaScript',
  cpp: 'C++',
  java: 'Java',
  c: 'C',
  go: 'Go',
  rust: 'Rust',
  csharp: 'C#',
  kotlin: 'Kotlin',
  typescript: 'TypeScript',
}

function getLanguageDisplayName(lang: string): string {
  return LANGUAGE_DISPLAY_NAMES[lang.toLowerCase()] || lang.charAt(0).toUpperCase() + lang.slice(1)
}

export function EditorToolbar({
  language,
  languages,
  onLanguageChange,
  onRun,
  onSubmit,
  onReset,
  running = false,
  submitting = false
}: EditorToolbarProps) {
  return (
    <div className="px-4 py-3 border-b border-slate-700 bg-slate-900 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-300">Language:</label>
        <Select
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="w-40 bg-slate-800 border-slate-700 text-white focus:ring-2 focus:ring-blue-500"
        >
          {languages.map((lang) => (
            <option key={lang} value={lang}>
              {getLanguageDisplayName(lang)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={onRun}
          disabled={running || submitting}
          className="bg-green-600 hover:bg-green-700 text-white border-0 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
        >
          <Play className="h-4 w-4 mr-2" />
          {running ? 'Running...' : 'Run'}
        </Button>
        <Button
          size="sm"
          onClick={onSubmit}
          disabled={running || submitting}
          className="bg-blue-600 hover:bg-blue-700 text-white border-0 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
        >
          <Send className="h-4 w-4 mr-2" />
          {submitting ? 'Submitting...' : 'Submit'}
        </Button>
        <Button
          size="sm"
          onClick={onReset}
          disabled={running || submitting}
          variant="outline"
          className="bg-yellow-600/20 hover:bg-yellow-600/30 text-yellow-400 border-yellow-600/50 shadow-md hover:shadow-lg transition-all disabled:opacity-50"
        >
          <RotateCcw className="h-4 w-4 mr-2" />
          Reset
        </Button>
      </div>
    </div>
  )
}












