'use client'

import { Clock } from 'lucide-react'

interface TimerBarProps {
  timeRemaining: number
  totalTime: number
}

export function TimerBar({ timeRemaining, totalTime }: TimerBarProps) {
  const percentage = totalTime > 0 ? (timeRemaining / totalTime) * 100 : 0
  const hours = Math.floor(timeRemaining / 3600)
  const minutes = Math.floor((timeRemaining % 3600) / 60)
  const seconds = timeRemaining % 60
  const formattedTime = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`

  // Color based on remaining time
  const getColor = () => {
    if (percentage > 50) return 'bg-green-500'
    if (percentage > 25) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  return (
    <div className="sticky top-0 z-50 bg-slate-900 border-b border-slate-700 shadow-lg">
      <div className="px-4 py-3">
        {/* Overall Test Timer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className={`h-5 w-5 ${percentage > 25 ? 'text-green-400' : 'text-red-400'} animate-pulse`} />
            <span className="font-bold text-lg text-white">Test Time: {formattedTime}</span>
          </div>
          <div className="flex-1 mx-4">
            <div className="w-full bg-slate-800 rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all duration-1000 ${getColor()}`}
                style={{ width: `${Math.max(0, Math.min(100, percentage))}%` }}
              />
            </div>
          </div>
          <div className="text-sm font-medium text-slate-300">
            {Math.round(percentage)}% remaining
          </div>
        </div>
      </div>
    </div>
  )
}












