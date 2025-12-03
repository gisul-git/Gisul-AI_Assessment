/**
 * useLiveProctor Hook
 * 
 * Handles WebRTC streaming from candidate to admin for human proctoring.
 * Manages webcam + screen capture and signalling via backend API.
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface LiveProctorSession {
  sessionId: string;
  assessmentId: string;
  candidateId: string;
  adminId: string;
  status: string;
  offer?: { sdp: string; type: string };
  answer?: { sdp: string; type: string };
  candidateICE: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>;
  adminICE: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>;
}

interface UseLiveProctorOptions {
  assessmentId: string;
  candidateId: string;
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  onError?: (error: string) => void;
  debugMode?: boolean;
}

export function useLiveProctor({
  assessmentId,
  candidateId,
  onSessionStart,
  onSessionEnd,
  onError,
  debugMode = false,
}: UseLiveProctorOptions) {
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>("disconnected");
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const icePollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSessionRef = useRef<LiveProctorSession | null>(null);

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (debugMode) {
        console.log(`[LiveProctor] ${message}`, data || "");
      }
    },
    [debugMode]
  );

  // Poll for pending sessions from admin
  const checkForPendingSession = useCallback(async () => {
    if (isStreaming || !assessmentId || !candidateId) return;
    
    try {
      const res = await fetch(
        `${API_URL}/api/proctor/live/pending/${assessmentId}/${encodeURIComponent(candidateId)}`
      );
      const data = await res.json();
      
      if (data.success && data.data.hasSession) {
        const session = data.data.session as LiveProctorSession;
        log("Pending session found", session);
        
        if (session.status === "pending") {
          pendingSessionRef.current = session;
          // Auto-start streaming immediately without asking - mandatory feature
          // Browser will still show native prompts for screen share (unavoidable)
          log("Auto-starting streaming for human proctoring...");
          startStreamingInternal(session);
        }
      }
    } catch (err) {
      log("Error checking for pending session", err);
    }
  }, [assessmentId, candidateId, isStreaming, log]);

  // Start polling for admin sessions
  useEffect(() => {
    if (!assessmentId || !candidateId) return;
    
    // Poll every 3 seconds
    pollIntervalRef.current = setInterval(checkForPendingSession, 3000);
    checkForPendingSession(); // Initial check
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [assessmentId, candidateId, checkForPendingSession]);

  // Internal function to start streaming with a session
  const startStreamingInternal = useCallback(async (session: LiveProctorSession) => {
    try {
      log("Starting streams...");
      
      // Get webcam stream
      const webcamStream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: true,
      });
      webcamStreamRef.current = webcamStream;
      log("Webcam stream acquired");
      
      // Get screen share stream
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: 1280, height: 720 },
        audio: false,
      });
      screenStreamRef.current = screenStream;
      log("Screen stream acquired");
      
      // Handle screen share stop
      screenStream.getVideoTracks()[0].onended = () => {
        log("Screen share stopped by user");
        stopStreaming();
      };
      
      // Create peer connection
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
        ],
      });
      peerConnectionRef.current = pc;
      
      // Add tracks to peer connection
      webcamStream.getTracks().forEach((track) => {
        pc.addTrack(track, webcamStream);
        log(`Added webcam track: ${track.kind}`);
      });
      
      screenStream.getTracks().forEach((track) => {
        pc.addTrack(track, screenStream);
        log(`Added screen track: ${track.kind}`);
      });
      
      // Handle ICE candidates
      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          log("Sending ICE candidate");
          await fetch(`${API_URL}/api/proctor/live/ice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: session.sessionId,
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              sender: "candidate",
            }),
          });
        }
      };
      
      // Handle connection state changes
      pc.onconnectionstatechange = () => {
        log("Connection state:", pc.connectionState);
        setConnectionState(pc.connectionState);
        
        if (pc.connectionState === "connected") {
          onSessionStart?.();
          // Log event
          recordProctorEvent("PROCTOR_SESSION_STARTED", session.sessionId);
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          stopStreaming();
        }
      };
      
      // Create and send offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      
      await fetch(`${API_URL}/api/proctor/live/offer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          sdp: offer.sdp,
          sdpType: "offer",
          sender: "candidate",
        }),
      });
      
      log("Offer sent, waiting for answer...");
      setSessionId(session.sessionId);
      setIsStreaming(true);
      setConnectionState("connecting");
      
      // Poll for answer and ICE candidates from admin
      startPollingForAnswer(session.sessionId, pc);
      
    } catch (err) {
      log("Error starting stream", err);
      onError?.(err instanceof Error ? err.message : "Failed to start streaming");
      stopStreaming();
    }
  }, [log, onError, onSessionStart]);

  // Public function to manually start streaming (if needed)
  const startStreaming = useCallback(async () => {
    const session = pendingSessionRef.current;
    if (!session) {
      onError?.("No pending session found");
      return;
    }
    await startStreamingInternal(session);
  }, [startStreamingInternal, onError]);

  // Poll for answer from admin
  const startPollingForAnswer = useCallback(
    async (sessId: string, pc: RTCPeerConnection) => {
      let answerReceived = false;
      let lastAdminICEIndex = 0;
      
      icePollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/proctor/live/session/${sessId}`);
          const data = await res.json();
          
          if (!data.success) return;
          
          const session = data.data as LiveProctorSession;
          
          // Process answer if not yet received
          if (!answerReceived && session.answer) {
            log("Received answer from admin");
            await pc.setRemoteDescription(
              new RTCSessionDescription({
                type: session.answer.type as RTCSdpType,
                sdp: session.answer.sdp,
              })
            );
            answerReceived = true;
          }
          
          // Process new ICE candidates from admin
          if (session.adminICE.length > lastAdminICEIndex) {
            const newCandidates = session.adminICE.slice(lastAdminICEIndex);
            for (const ice of newCandidates) {
              log("Adding admin ICE candidate");
              await pc.addIceCandidate(
                new RTCIceCandidate({
                  candidate: ice.candidate,
                  sdpMid: ice.sdpMid,
                  sdpMLineIndex: ice.sdpMLineIndex,
                })
              );
            }
            lastAdminICEIndex = session.adminICE.length;
          }
          
          // Check if session ended
          if (session.status === "ended") {
            log("Session ended by admin");
            stopStreaming();
          }
        } catch (err) {
          log("Error polling for answer", err);
        }
      }, 1000);
    },
    [log]
  );

  // Stop streaming and cleanup
  const stopStreaming = useCallback(() => {
    log("Stopping stream...");
    
    if (icePollIntervalRef.current) {
      clearInterval(icePollIntervalRef.current);
      icePollIntervalRef.current = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((track) => track.stop());
      webcamStreamRef.current = null;
    }
    
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    
    // Log session ended event
    if (sessionId) {
      recordProctorEvent("PROCTOR_SESSION_ENDED", sessionId);
      fetch(`${API_URL}/api/proctor/live/end-session/${sessionId}`, {
        method: "POST",
      }).catch(() => {});
    }
    
    setIsStreaming(false);
    setSessionId(null);
    setConnectionState("disconnected");
    pendingSessionRef.current = null;
    
    onSessionEnd?.();
  }, [sessionId, log, onSessionEnd]);

  // Record proctoring event
  const recordProctorEvent = async (eventType: string, sessId: string) => {
    try {
      await fetch(`${API_URL}/api/proctor/record`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType,
          assessmentId,
          userId: candidateId,
          timestamp: new Date().toISOString(),
          metadata: { sessionId: sessId },
        }),
      });
    } catch (err) {
      log("Error recording proctor event", err);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopStreaming();
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [stopStreaming]);

  return {
    isStreaming,
    sessionId,
    connectionState,
    startStreaming,
    stopStreaming,
  };
}

