/**
 * HumanProctorPanel Component
 * 
 * Admin panel for viewing candidate's live webcam and screen streams.
 * Shows two video players side by side with connection controls.
 */

import React, { useEffect, useRef, useState } from "react";
import { useLiveProctorAdmin } from "@/hooks/useLiveProctorAdmin";

interface HumanProctorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  assessmentId: string;
  candidateId: string;
  candidateName?: string;
  adminId: string;
}

export function HumanProctorPanel({
  isOpen,
  onClose,
  assessmentId,
  candidateId,
  candidateName,
  adminId,
}: HumanProctorPanelProps) {
  const webcamVideoRef = useRef<HTMLVideoElement>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    isConnecting,
    isConnected,
    connectionState,
    webcamStream,
    screenStream,
    createSession,
    disconnect,
    refresh,
  } = useLiveProctorAdmin({
    onConnected: () => setError(null),
    onDisconnected: () => {},
    onError: (err) => setError(err),
    debugMode: true,
  });

  // Start session when panel opens
  useEffect(() => {
    if (isOpen && !isConnecting && !isConnected) {
      createSession(assessmentId, candidateId, adminId);
    }
  }, [isOpen, assessmentId, candidateId, adminId, createSession, isConnecting, isConnected]);

  // Attach streams to video elements
  useEffect(() => {
    if (webcamVideoRef.current && webcamStream) {
      webcamVideoRef.current.srcObject = webcamStream;
    }
  }, [webcamStream]);

  useEffect(() => {
    if (screenVideoRef.current && screenStream) {
      screenVideoRef.current.srcObject = screenStream;
    }
  }, [screenStream]);

  // Handle close
  const handleClose = () => {
    disconnect();
    onClose();
  };

  // Handle refresh
  const handleRefresh = () => {
    setError(null);
    refresh(assessmentId, candidateId, adminId);
  };

  if (!isOpen) return null;

  // Connection status badge
  const getStatusBadge = () => {
    const states: Record<string, { color: string; text: string }> = {
      disconnected: { color: "bg-slate-500", text: "Disconnected" },
      connecting: { color: "bg-amber-500 animate-pulse", text: "Connecting..." },
      connected: { color: "bg-green-500", text: "Connected" },
      failed: { color: "bg-red-500", text: "Connection Failed" },
      new: { color: "bg-blue-500", text: "Initializing..." },
    };
    const status = states[connectionState] || states.disconnected;
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white ${status.color}`}>
        <span className="w-2 h-2 rounded-full bg-current"></span>
        {status.text}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-6xl rounded-2xl bg-gradient-to-b from-slate-800 to-slate-900 shadow-2xl border border-slate-700 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-amber-500/20 p-2">
                <svg className="h-5 w-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">Human Proctoring</h2>
                <p className="text-xs text-slate-400">
                  {candidateName || candidateId}
                </p>
              </div>
            </div>
            {getStatusBadge()}
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isConnecting}
              className="rounded-lg bg-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-slate-600 disabled:opacity-50 flex items-center gap-2"
            >
              <svg className={`h-4 w-4 ${isConnecting ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
            <button
              onClick={handleClose}
              className="rounded-lg bg-red-500/20 px-3 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 flex items-center gap-2"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              End Session
            </button>
          </div>
        </div>

        {/* Video Panels */}
        <div className="p-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 p-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}
          
          {isConnecting && !isConnected && (
            <div className="mb-4 rounded-lg bg-amber-500/10 border border-amber-500/30 p-4">
              <p className="text-sm text-amber-400 flex items-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Waiting for candidate to accept proctoring request...
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Webcam Video */}
            <div className="rounded-xl bg-slate-800 overflow-hidden border border-slate-700">
              <div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-medium text-slate-200">Webcam</span>
                </div>
                {webcamStream && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                    Live
                  </span>
                )}
              </div>
              <div className="aspect-video bg-slate-900 relative">
                {webcamStream ? (
                  <video
                    ref={webcamVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                    <svg className="h-16 w-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm">Waiting for webcam...</span>
                  </div>
                )}
              </div>
            </div>

            {/* Screen Share Video */}
            <div className="rounded-xl bg-slate-800 overflow-hidden border border-slate-700">
              <div className="px-4 py-2 border-b border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="h-4 w-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  <span className="text-sm font-medium text-slate-200">Screen</span>
                </div>
                {screenStream && (
                  <span className="text-xs text-green-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                    Live
                  </span>
                )}
              </div>
              <div className="aspect-video bg-slate-900 relative">
                {screenStream ? (
                  <video
                    ref={screenVideoRef}
                    autoPlay
                    playsInline
                    muted
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500">
                    <svg className="h-16 w-16 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm">Waiting for screen share...</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Instructions */}
          {!isConnected && (
            <div className="mt-4 rounded-xl bg-slate-800/50 p-4">
              <h3 className="text-sm font-semibold text-slate-200 mb-2">How it works:</h3>
              <ol className="text-xs text-slate-400 space-y-1 list-decimal list-inside">
                <li>A request has been sent to the candidate</li>
                <li>The candidate will see a consent popup</li>
                <li>Once they accept, you&apos;ll see their webcam and screen</li>
                <li>The session will auto-refresh if connection is lost</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

