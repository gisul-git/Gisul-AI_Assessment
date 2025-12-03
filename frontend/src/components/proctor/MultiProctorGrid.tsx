/**
 * MultiProctorGrid Component
 * 
 * Displays multiple candidate streams in a CCTV-style grid layout.
 * Shows webcam + screen for each candidate with status indicators.
 */

import React, { useRef, useEffect, useState } from "react";

interface CandidateStream {
  sessionId: string;
  candidateId: string;
  candidateName: string;
  connectionState: string;
  webcamStream: MediaStream | null;
  screenStream: MediaStream | null;
}

interface MultiProctorGridProps {
  candidateStreams: CandidateStream[];
  onRefreshCandidate?: (sessionId: string) => void;
  isLoading?: boolean;
}

// Single candidate card component
function CandidateCard({
  stream,
  onRefresh,
}: {
  stream: CandidateStream;
  onRefresh?: () => void;
}) {
  const webcamRef = useRef<HTMLVideoElement>(null);
  const screenRef = useRef<HTMLVideoElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Attach webcam stream
  useEffect(() => {
    if (webcamRef.current && stream.webcamStream) {
      webcamRef.current.srcObject = stream.webcamStream;
    }
  }, [stream.webcamStream]);

  // Attach screen stream
  useEffect(() => {
    if (screenRef.current && stream.screenStream) {
      screenRef.current.srcObject = stream.screenStream;
    }
  }, [stream.screenStream]);

  const getStatusColor = (state: string) => {
    switch (state) {
      case "connected":
        return "#10b981";
      case "connecting":
        return "#f59e0b";
      case "disconnected":
      case "failed":
        return "#ef4444";
      default:
        return "#6b7280";
    }
  };

  const getStatusText = (state: string) => {
    switch (state) {
      case "connected":
        return "Live";
      case "connecting":
        return "Connecting...";
      case "disconnected":
        return "Disconnected";
      case "failed":
        return "Failed";
      default:
        return "Waiting";
    }
  };

  return (
    <>
      {/* Card */}
      <div
        style={{
          backgroundColor: "#1e293b",
          borderRadius: "0.75rem",
          overflow: "hidden",
          border: `2px solid ${stream.connectionState === "connected" ? "#10b981" : "#334155"}`,
          transition: "all 0.2s ease",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "0.75rem",
            backgroundColor: "#0f172a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div
              style={{
                width: "8px",
                height: "8px",
                borderRadius: "50%",
                backgroundColor: getStatusColor(stream.connectionState),
                animation: stream.connectionState === "connected" ? "pulse 2s infinite" : "none",
              }}
            />
            <span style={{ color: "#f1f5f9", fontSize: "0.875rem", fontWeight: 600 }}>
              {stream.candidateName}
            </span>
          </div>
          <span
            style={{
              fontSize: "0.75rem",
              color: getStatusColor(stream.connectionState),
              fontWeight: 500,
            }}
          >
            {getStatusText(stream.connectionState)}
          </span>
        </div>

        {/* Video Container */}
        <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
          {/* Webcam */}
          <div style={{ position: "relative", aspectRatio: "16/9", backgroundColor: "#0f172a" }}>
            {stream.webcamStream ? (
              <video
                ref={webcamRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span style={{ fontSize: "0.6875rem", marginTop: "0.5rem" }}>Webcam</span>
              </div>
            )}
            <div
              style={{
                position: "absolute",
                top: "0.375rem",
                left: "0.375rem",
                backgroundColor: "rgba(0,0,0,0.7)",
                color: "#fff",
                padding: "0.125rem 0.375rem",
                borderRadius: "0.25rem",
                fontSize: "0.625rem",
                fontWeight: 600,
              }}
            >
              📷 CAM
            </div>
          </div>

          {/* Screen */}
          <div style={{ position: "relative", aspectRatio: "16/9", backgroundColor: "#0f172a" }}>
            {stream.screenStream ? (
              <video
                ref={screenRef}
                autoPlay
                playsInline
                muted
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                }}
              />
            ) : (
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#64748b",
                }}
              >
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
                <span style={{ fontSize: "0.6875rem", marginTop: "0.5rem" }}>Screen</span>
              </div>
            )}
            <div
              style={{
                position: "absolute",
                top: "0.375rem",
                left: "0.375rem",
                backgroundColor: "rgba(0,0,0,0.7)",
                color: "#fff",
                padding: "0.125rem 0.375rem",
                borderRadius: "0.25rem",
                fontSize: "0.625rem",
                fontWeight: 600,
              }}
            >
              🖥️ SCREEN
            </div>
          </div>
        </div>

        {/* Footer with controls */}
        <div
          style={{
            padding: "0.5rem 0.75rem",
            backgroundColor: "#0f172a",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span style={{ color: "#94a3b8", fontSize: "0.6875rem" }}>
            {stream.candidateId}
          </span>
          <div style={{ display: "flex", gap: "0.375rem" }}>
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              style={{
                padding: "0.25rem 0.5rem",
                backgroundColor: "#334155",
                color: "#f1f5f9",
                border: "none",
                borderRadius: "0.25rem",
                fontSize: "0.625rem",
                cursor: "pointer",
              }}
            >
              Expand
            </button>
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                style={{
                  padding: "0.25rem 0.5rem",
                  backgroundColor: "#334155",
                  color: "#f1f5f9",
                  border: "none",
                  borderRadius: "0.25rem",
                  fontSize: "0.625rem",
                  cursor: "pointer",
                }}
              >
                ↻
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded Modal */}
      {isExpanded && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.9)",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            padding: "1rem",
          }}
          onClick={() => setIsExpanded(false)}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <div
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: getStatusColor(stream.connectionState),
                }}
              />
              <span style={{ color: "#fff", fontSize: "1.25rem", fontWeight: 600 }}>
                {stream.candidateName}
              </span>
              <span style={{ color: "#94a3b8", fontSize: "0.875rem" }}>
                ({stream.candidateId})
              </span>
            </div>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              style={{
                padding: "0.5rem 1rem",
                backgroundColor: "#ef4444",
                color: "#fff",
                border: "none",
                borderRadius: "0.375rem",
                fontSize: "0.875rem",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              ✕ Close
            </button>
          </div>
          
          <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {/* Large Webcam */}
            <div style={{ backgroundColor: "#1e293b", borderRadius: "0.5rem", overflow: "hidden", position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: "0.75rem",
                  left: "0.75rem",
                  backgroundColor: "rgba(0,0,0,0.7)",
                  color: "#fff",
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.375rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  zIndex: 1,
                }}
              >
                📷 Webcam
              </div>
              {stream.webcamStream ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(el) => { if (el) el.srcObject = stream.webcamStream; }}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                  Waiting for webcam...
                </div>
              )}
            </div>
            
            {/* Large Screen */}
            <div style={{ backgroundColor: "#1e293b", borderRadius: "0.5rem", overflow: "hidden", position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: "0.75rem",
                  left: "0.75rem",
                  backgroundColor: "rgba(0,0,0,0.7)",
                  color: "#fff",
                  padding: "0.375rem 0.75rem",
                  borderRadius: "0.375rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  zIndex: 1,
                }}
              >
                🖥️ Screen Share
              </div>
              {stream.screenStream ? (
                <video
                  autoPlay
                  playsInline
                  muted
                  ref={(el) => { if (el) el.srcObject = stream.screenStream; }}
                  style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#64748b" }}>
                  Waiting for screen share...
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </>
  );
}

export function MultiProctorGrid({
  candidateStreams,
  onRefreshCandidate,
  isLoading,
}: MultiProctorGridProps) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        overflowY: "auto",
        padding: "1rem",
        backgroundColor: "#0f172a",
      }}
    >
      {isLoading ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#94a3b8",
          }}
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            style={{ animation: "spin 1s linear infinite" }}
          >
            <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
          </svg>
          <p style={{ marginTop: "1rem" }}>Connecting to candidates...</p>
        </div>
      ) : candidateStreams.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: "#94a3b8",
          }}
        >
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <p style={{ marginTop: "1rem", fontSize: "1.125rem" }}>No active candidates</p>
          <p style={{ color: "#64748b", fontSize: "0.875rem" }}>
            Candidates will appear here when they start the assessment
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
            gap: "1rem",
          }}
        >
          {candidateStreams.map((stream) => (
            <CandidateCard
              key={stream.sessionId}
              stream={stream}
              onRefresh={() => onRefreshCandidate?.(stream.sessionId)}
            />
          ))}
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default MultiProctorGrid;

