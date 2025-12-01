import React from "react";
import type { NetworkMetrics } from "@/hooks/usePrecheck";

interface NetworkTestProps {
  metrics: NetworkMetrics | null;
  isRunning: boolean;
  maxLatencyMs: number;
  minDownloadMbps: number;
}

export function NetworkTest({
  metrics,
  isRunning,
  maxLatencyMs,
  minDownloadMbps,
}: NetworkTestProps) {
  if (!metrics && !isRunning) {
    return null;
  }

  const latencyStatus = metrics ? metrics.latencyMs <= maxLatencyMs : null;
  const downloadStatus = metrics ? metrics.downloadSpeedMbps >= minDownloadMbps : null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "0.75rem",
        marginTop: "0.5rem",
      }}
    >
      {/* Latency Metric */}
      <div
        style={{
          padding: "0.75rem",
          backgroundColor: isRunning 
            ? "#f8fafc" 
            : latencyStatus 
            ? "#ecfdf5" 
            : "#fef2f2",
          borderRadius: "0.5rem",
          border: `1px solid ${isRunning ? "#e2e8f0" : latencyStatus ? "#86efac" : "#fecaca"}`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.375rem",
            marginBottom: "0.375rem",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isRunning ? "#64748b" : latencyStatus ? "#10b981" : "#ef4444"}
            strokeWidth="2"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
          <span style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 500 }}>
            Latency
          </span>
        </div>
        
        {isRunning ? (
          <div
            style={{
              width: "20px",
              height: "20px",
              margin: "0 auto",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#64748b"
              strokeWidth="2"
              style={{ animation: "spin 1s linear infinite" }}
            >
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: latencyStatus ? "#10b981" : "#ef4444",
                lineHeight: 1,
              }}
            >
              {metrics?.latencyMs || "—"}
              <span style={{ fontSize: "0.875rem", fontWeight: 500 }}>ms</span>
            </div>
            <div
              style={{
                fontSize: "0.6875rem",
                color: "#94a3b8",
                marginTop: "0.25rem",
              }}
            >
              Target: &lt;{maxLatencyMs}ms
            </div>
          </>
        )}
      </div>

      {/* Download Speed Metric */}
      <div
        style={{
          padding: "0.75rem",
          backgroundColor: isRunning 
            ? "#f8fafc" 
            : downloadStatus 
            ? "#ecfdf5" 
            : "#fef2f2",
          borderRadius: "0.5rem",
          border: `1px solid ${isRunning ? "#e2e8f0" : downloadStatus ? "#86efac" : "#fecaca"}`,
          textAlign: "center",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.375rem",
            marginBottom: "0.375rem",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke={isRunning ? "#64748b" : downloadStatus ? "#10b981" : "#ef4444"}
            strokeWidth="2"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <span style={{ fontSize: "0.75rem", color: "#64748b", fontWeight: 500 }}>
            Download
          </span>
        </div>
        
        {isRunning ? (
          <div
            style={{
              width: "20px",
              height: "20px",
              margin: "0 auto",
            }}
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#64748b"
              strokeWidth="2"
              style={{ animation: "spin 1s linear infinite" }}
            >
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
          </div>
        ) : (
          <>
            <div
              style={{
                fontSize: "1.5rem",
                fontWeight: 700,
                color: downloadStatus ? "#10b981" : "#ef4444",
                lineHeight: 1,
              }}
            >
              {metrics?.downloadSpeedMbps?.toFixed(1) || "—"}
              <span style={{ fontSize: "0.75rem", fontWeight: 500 }}> Mbps</span>
            </div>
            <div
              style={{
                fontSize: "0.6875rem",
                color: "#94a3b8",
                marginTop: "0.25rem",
              }}
            >
              Min: {minDownloadMbps} Mbps
            </div>
          </>
        )}
      </div>

      {/* CSS for animation */}
      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

export default NetworkTest;

