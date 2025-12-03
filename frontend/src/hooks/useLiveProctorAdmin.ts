/**
 * useLiveProctorAdmin Hook
 * 
 * Handles WebRTC viewing from admin side for human proctoring.
 * Connects to candidate's webcam + screen streams.
 */

import { useCallback, useRef, useState } from "react";

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

interface UseLiveProctorAdminOptions {
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: string) => void;
  debugMode?: boolean;
}

export function useLiveProctorAdmin({
  onConnected,
  onDisconnected,
  onError,
  debugMode = false,
}: UseLiveProctorAdminOptions = {}) {
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<string>("disconnected");
  const [webcamStream, setWebcamStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (debugMode) {
        console.log(`[LiveProctorAdmin] ${message}`, data || "");
      }
    },
    [debugMode]
  );

  // Create a new session and wait for candidate to connect
  const createSession = useCallback(
    async (assessmentId: string, candidateId: string, adminId: string) => {
      try {
        setIsConnecting(true);
        log("Creating session...");
        
        const res = await fetch(`${API_URL}/api/proctor/live/create-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assessmentId, candidateId, adminId }),
        });
        
        const data = await res.json();
        
        if (!data.success) {
          throw new Error(data.message || "Failed to create session");
        }
        
        const sessId = data.data.sessionId;
        setSessionId(sessId);
        log("Session created", sessId);
        
        // Start polling for candidate's offer
        startPollingForOffer(sessId, assessmentId, candidateId);
        
        return sessId;
      } catch (err) {
        log("Error creating session", err);
        onError?.(err instanceof Error ? err.message : "Failed to create session");
        setIsConnecting(false);
        return null;
      }
    },
    [log, onError]
  );

  // Poll for offer from candidate
  const startPollingForOffer = useCallback(
    (sessId: string, assessmentId: string, candidateId: string) => {
      let lastCandidateICEIndex = 0;
      
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/proctor/live/session/${sessId}`);
          const data = await res.json();
          
          if (!data.success) return;
          
          const session = data.data as LiveProctorSession;
          
          // If we have an offer and no peer connection yet, create one
          if (session.offer && !peerConnectionRef.current) {
            log("Received offer from candidate, creating peer connection...");
            await setupPeerConnection(sessId, session);
          }
          
          // Process new ICE candidates from candidate
          if (peerConnectionRef.current && session.candidateICE.length > lastCandidateICEIndex) {
            const newCandidates = session.candidateICE.slice(lastCandidateICEIndex);
            for (const ice of newCandidates) {
              log("Adding candidate ICE");
              try {
                await peerConnectionRef.current.addIceCandidate(
                  new RTCIceCandidate({
                    candidate: ice.candidate,
                    sdpMid: ice.sdpMid,
                    sdpMLineIndex: ice.sdpMLineIndex,
                  })
                );
              } catch (iceErr) {
                log("Error adding ICE candidate", iceErr);
              }
            }
            lastCandidateICEIndex = session.candidateICE.length;
          }
          
          // Check if session ended
          if (session.status === "ended") {
            log("Session ended");
            disconnect();
          }
        } catch (err) {
          log("Error polling for offer", err);
        }
      }, 1000);
    },
    [log]
  );

  // Setup peer connection when we receive offer
  const setupPeerConnection = useCallback(
    async (sessId: string, session: LiveProctorSession) => {
      if (!session.offer) return;
      
      try {
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
          ],
        });
        peerConnectionRef.current = pc;
        
        // Track streams - first video is webcam, second is screen
        const streams: MediaStream[] = [];
        let trackCount = 0;
        
        pc.ontrack = (event) => {
          log("Received track", { kind: event.track.kind, streams: event.streams.length });
          
          if (event.streams[0]) {
            // Add to our streams array if not already there
            const existingIndex = streams.findIndex(s => s.id === event.streams[0].id);
            if (existingIndex === -1) {
              streams.push(event.streams[0]);
            }
          }
          
          trackCount++;
          
          // We expect 3 tracks: webcam video, webcam audio, screen video
          // First stream is webcam, second is screen
          if (trackCount >= 2) {
            if (streams.length >= 1) {
              setWebcamStream(streams[0]);
            }
            if (streams.length >= 2) {
              setScreenStream(streams[1]);
            }
          }
        };
        
        // Handle ICE candidates
        pc.onicecandidate = async (event) => {
          if (event.candidate) {
            log("Sending admin ICE candidate");
            await fetch(`${API_URL}/api/proctor/live/ice`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: sessId,
                candidate: event.candidate.candidate,
                sdpMid: event.candidate.sdpMid,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sender: "admin",
              }),
            });
          }
        };
        
        // Handle connection state
        pc.onconnectionstatechange = () => {
          log("Connection state:", pc.connectionState);
          setConnectionState(pc.connectionState);
          
          if (pc.connectionState === "connected") {
            setIsConnecting(false);
            setIsConnected(true);
            onConnected?.();
            // Log viewing event
            recordViewingEvent(sessId);
          } else if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
            disconnect();
          }
        };
        
        // Set remote description (offer)
        await pc.setRemoteDescription(
          new RTCSessionDescription({
            type: session.offer.type as RTCSdpType,
            sdp: session.offer.sdp,
          })
        );
        
        // Create answer
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        
        // Send answer
        await fetch(`${API_URL}/api/proctor/live/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId: sessId,
            sdp: answer.sdp,
            sdpType: "answer",
            sender: "admin",
          }),
        });
        
        log("Answer sent");
        
      } catch (err) {
        log("Error setting up peer connection", err);
        onError?.(err instanceof Error ? err.message : "Failed to connect");
        disconnect();
      }
    },
    [log, onConnected, onError]
  );

  // Record viewing event
  const recordViewingEvent = async (sessId: string) => {
    try {
      // Get session info to log event
      const res = await fetch(`${API_URL}/api/proctor/live/session/${sessId}`);
      const data = await res.json();
      
      if (data.success) {
        const session = data.data as LiveProctorSession;
        await fetch(`${API_URL}/api/proctor/record`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "PROCTOR_SESSION_VIEWING",
            assessmentId: session.assessmentId,
            userId: session.candidateId,
            timestamp: new Date().toISOString(),
            metadata: { sessionId: sessId, adminId: session.adminId },
          }),
        });
      }
    } catch (err) {
      log("Error recording viewing event", err);
    }
  };

  // Disconnect and cleanup
  const disconnect = useCallback(() => {
    log("Disconnecting...");
    
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    // End session on backend
    if (sessionId) {
      fetch(`${API_URL}/api/proctor/live/end-session/${sessionId}`, {
        method: "POST",
      }).catch(() => {});
    }
    
    setWebcamStream(null);
    setScreenStream(null);
    setIsConnecting(false);
    setIsConnected(false);
    setSessionId(null);
    setConnectionState("disconnected");
    
    onDisconnected?.();
  }, [sessionId, log, onDisconnected]);

  // Refresh connection
  const refresh = useCallback(async (assessmentId: string, candidateId: string, adminId: string) => {
    disconnect();
    // Small delay before reconnecting
    await new Promise(resolve => setTimeout(resolve, 500));
    return createSession(assessmentId, candidateId, adminId);
  }, [disconnect, createSession]);

  return {
    isConnecting,
    isConnected,
    sessionId,
    connectionState,
    webcamStream,
    screenStream,
    createSession,
    disconnect,
    refresh,
  };
}

