/**
 * LiveProctorConsent Component
 * 
 * Shows consent popup when admin wants to watch candidate live.
 * Candidate must accept to start streaming webcam + screen.
 */

import React from "react";

interface LiveProctorConsentProps {
  isVisible: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export function LiveProctorConsent({
  isVisible,
  onAccept,
  onDecline,
}: LiveProctorConsentProps) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 max-w-md rounded-2xl bg-gradient-to-b from-slate-800 to-slate-900 p-6 shadow-2xl border border-slate-700">
        {/* Icon */}
        <div className="mb-4 flex justify-center">
          <div className="rounded-full bg-amber-500/20 p-4">
            <svg
              className="h-12 w-12 text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          </div>
        </div>

        {/* Title */}
        <h2 className="mb-2 text-center text-xl font-bold text-white">
          Human Proctor Request
        </h2>

        {/* Description */}
        <p className="mb-4 text-center text-slate-300 text-sm leading-relaxed">
          A proctor has requested to monitor your exam session. Your{" "}
          <span className="font-semibold text-amber-400">screen</span> and{" "}
          <span className="font-semibold text-amber-400">camera</span> will be
          streamed in real-time.
        </p>

        {/* What will be shared */}
        <div className="mb-6 rounded-xl bg-slate-800/50 p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-200">
            What will be shared:
          </h3>
          <ul className="space-y-2 text-sm text-slate-400">
            <li className="flex items-center gap-2">
              <svg className="h-4 w-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Your webcam video feed</span>
            </li>
            <li className="flex items-center gap-2">
              <svg className="h-4 w-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Your entire screen content</span>
            </li>
            <li className="flex items-center gap-2">
              <svg className="h-4 w-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span>Audio from your microphone</span>
            </li>
          </ul>
        </div>

        {/* Notice */}
        <p className="mb-6 text-center text-xs text-slate-500">
          This is required for exam integrity. Declining may affect your assessment.
        </p>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onDecline}
            className="flex-1 rounded-xl border border-slate-600 bg-slate-700/50 py-3 text-sm font-medium text-slate-300 transition-all hover:bg-slate-700 hover:border-slate-500"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            className="flex-1 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 py-3 text-sm font-bold text-white shadow-lg transition-all hover:from-amber-400 hover:to-orange-500 hover:shadow-amber-500/25"
          >
            Accept & Share
          </button>
        </div>
      </div>
    </div>
  );
}

