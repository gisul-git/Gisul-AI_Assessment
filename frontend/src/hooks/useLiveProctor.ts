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
  screenStream?: MediaStream | null; // Pre-captured screen stream
  webcamStream?: MediaStream | null; // Pre-captured webcam stream
  onSessionStart?: () => void;
  onSessionEnd?: () => void;
  onError?: (error: string) => void;
  debugMode?: boolean;
}

export function useLiveProctor({
  assessmentId,
  candidateId,
  screenStream: preScreenStream,
  webcamStream: preWebcamStream,
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
  const isStreamingRef = useRef(false); // Use ref to avoid stale closure

  const log = useCallback(
    (message: string, data?: unknown) => {
      // Always log for debugging
      console.log(`[LiveProctor] ${message}`, data || "");
    },
    []
  );

  // Record proctoring event
  const recordProctorEvent = useCallback(async (eventType: string, sessId: string) => {
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
  }, [assessmentId, candidateId, log]);

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
            cleanupStreaming(sessId);
          }
        } catch (err) {
          log("Error polling for answer", err);
        }
      }, 1000);
    },
    [log]
  );

  // Cleanup streaming
  const cleanupStreaming = useCallback((sessId?: string) => {
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
    if (sessId) {
      recordProctorEvent("PROCTOR_SESSION_ENDED", sessId);
      fetch(`${API_URL}/api/proctor/live/end-session/${sessId}`, {
        method: "POST",
      }).catch(() => {});
    }
    
    setIsStreaming(false);
    isStreamingRef.current = false;
    setSessionId(null);
    setConnectionState("disconnected");
    pendingSessionRef.current = null;
    
    onSessionEnd?.();
  }, [log, onSessionEnd, recordProctorEvent]);

  // Start streaming with a session - MUST be defined before checkForPendingSession
  const startStreamingWithSession = useCallback(async (session: LiveProctorSession) => {
    if (isStreamingRef.current) {
      log("Already streaming, skipping...");
      return;
    }
    
    try {
      log("Starting streams...");
      isStreamingRef.current = true;
      setIsStreaming(true);
      
      // Check for pre-captured screen stream from instructions page
      let screenStream: MediaStream | null = null;
      if (typeof window !== "undefined" && (window as any).__screenStream) {
        screenStream = (window as any).__screenStream as MediaStream;
        // Check if stream is still active
        if (screenStream.active && screenStream.getVideoTracks().length > 0) {
          log("Using pre-captured screen stream from instructions page");
        } else {
          log("Pre-captured screen stream is no longer active, requesting new one...");
          screenStream = null;
        }
      }
      
      // Use pre-captured webcam if available, otherwise request new
      let webcamStream: MediaStream;
      if (preWebcamStream && preWebcamStream.active) {
        log("Using pre-captured webcam stream");
        webcamStream = preWebcamStream;
      } else {
        log("Requesting webcam...");
        webcamStream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480 },
          audio: true,
        });
        log("Webcam stream acquired");
      }
      webcamStreamRef.current = webcamStream;
      
      // If no pre-captured screen stream, request new one
      if (!screenStream) {
        log("Requesting screen share...");
        screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { 
            displaySurface: "monitor",
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        log("Screen stream acquired");
      }
      screenStreamRef.current = screenStream;
      
      // Handle screen share stop
      screenStream.getVideoTracks()[0].onended = () => {
        log("Screen share stopped by user");
        cleanupStreaming(session.sessionId);
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
          recordProctorEvent("PROCTOR_SESSION_STARTED", session.sessionId);
        } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          cleanupStreaming(session.sessionId);
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
      setConnectionState("connecting");
      
      // Poll for answer and ICE candidates from admin
      startPollingForAnswer(session.sessionId, pc);
      
    } catch (err) {
      log("Error starting stream", err);
      onError?.(err instanceof Error ? err.message : "Failed to start streaming");
      isStreamingRef.current = false;
      setIsStreaming(false);
      cleanupStreaming();
    }
  }, [log, onError, onSessionStart, cleanupStreaming, startPollingForAnswer, recordProctorEvent]);

  // Poll for pending sessions from admin - now startStreamingWithSession is defined
  const checkForPendingSession = useCallback(async () => {
    if (isStreamingRef.current || !assessmentId || !candidateId) {
      return;
    }
    
    try {
      log(`Checking for pending session: ${assessmentId} / ${candidateId}`);
      const res = await fetch(
        `${API_URL}/api/proctor/live/pending/${assessmentId}/${encodeURIComponent(candidateId)}`
      );
      const data = await res.json();
      
      log("Pending session response:", data);
      
      if (data.success && data.data.hasSession) {
        const session = data.data.session as LiveProctorSession;
        log("Pending session found!", session);
        
        if (session.status === "pending") {
          pendingSessionRef.current = session;
          // Auto-start streaming immediately without asking - mandatory feature
          log("Auto-starting streaming for human proctoring...");
          startStreamingWithSession(session);
        }
      }
    } catch (err) {
      log("Error checking for pending session", err);
    }
  }, [assessmentId, candidateId, log, startStreamingWithSession]);

  // Start polling for admin sessions
  useEffect(() => {
    if (!assessmentId || !candidateId) {
      log("Not polling - missing assessmentId or candidateId", { assessmentId, candidateId });
      return;
    }
    
    log("Starting to poll for human proctor sessions...", { assessmentId, candidateId });
    
    // Poll every 3 seconds
    pollIntervalRef.current = setInterval(checkForPendingSession, 3000);
    checkForPendingSession(); // Initial check
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [assessmentId, candidateId, checkForPendingSession]);

  // Public stop function
  const stopStreaming = useCallback(() => {
    cleanupStreaming(sessionId || undefined);
  }, [cleanupStreaming, sessionId]);

  // Public start function (if needed)
  const startStreaming = useCallback(async () => {
    const session = pendingSessionRef.current;
    if (!session) {
      onError?.("No pending session found");
      return;
    }
    await startStreamingWithSession(session);
  }, [startStreamingWithSession, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
      cleanupStreaming();
    };
  }, [cleanupStreaming]);

  return {
    isStreaming,
    sessionId,
    connectionState,
    startStreaming,
    stopStreaming,
  };
}
