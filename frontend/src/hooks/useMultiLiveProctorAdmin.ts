/**
 * useMultiLiveProctorAdmin Hook
 * 
 * Handles multiple WebRTC connections for admin to view all candidates
 * in the multi-proctor dashboard (CCTV-style view).
 */

import { useCallback, useEffect, useRef, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface CandidateSession {
  sessionId: string;
  candidateId: string;
  candidateName: string;
  status: string;
  offer?: { sdp: string; type: string };
  answer?: { sdp: string; type: string };
  candidateICE: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>;
  adminICE: Array<{ candidate: string; sdpMid?: string; sdpMLineIndex?: number }>;
}

interface CandidateStream {
  sessionId: string;
  candidateId: string;
  candidateName: string;
  connectionState: string;
  webcamStream: MediaStream | null;
  screenStream: MediaStream | null;
}

interface UseMultiLiveProctorAdminOptions {
  assessmentId: string;
  adminId: string;
  onError?: (error: string) => void;
  debugMode?: boolean;
}

export function useMultiLiveProctorAdmin({
  assessmentId,
  adminId,
  onError,
  debugMode = false,
}: UseMultiLiveProctorAdminOptions) {
  const [candidateStreams, setCandidateStreams] = useState<Map<string, CandidateStream>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [activeCandidates, setActiveCandidates] = useState<CandidateSession[]>([]);
  
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const pollIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const mainPollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (debugMode) {
        console.log(`[MultiProctorAdmin] ${message}`, data || "");
      }
    },
    [debugMode]
  );

  // Update candidate stream state
  const updateCandidateStream = useCallback((sessionId: string, updates: Partial<CandidateStream>) => {
    setCandidateStreams(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(sessionId) || {
        sessionId,
        candidateId: "",
        candidateName: "",
        connectionState: "disconnected",
        webcamStream: null,
        screenStream: null,
      };
      newMap.set(sessionId, { ...existing, ...updates });
      return newMap;
    });
  }, []);

  // Connect to a single candidate's stream
  const connectToCandidate = useCallback(async (session: CandidateSession) => {
    const { sessionId, candidateId, candidateName } = session;
    
    // Skip if already connected
    if (peerConnectionsRef.current.has(sessionId)) {
      log(`Already connected to ${candidateName}`);
      return;
    }

    log(`Connecting to ${candidateName}...`, session);

    // Initialize stream state
    updateCandidateStream(sessionId, {
      sessionId,
      candidateId,
      candidateName,
      connectionState: "connecting",
    });

    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    peerConnectionsRef.current.set(sessionId, pc);

    // Track received streams - use order-based identification
    // First video stream = webcam, second video stream = screen (matching how candidate adds them)
    let receivedStreamCount = 0;
    const receivedStreamIds = new Set<string>();

    pc.ontrack = (event) => {
      log(`Received track from ${candidateName}: ${event.track.kind}, streamId: ${event.streams?.[0]?.id}`);
      
      if (event.streams && event.streams[0]) {
        const stream = event.streams[0];
        const streamId = stream.id;
        
        // Skip if we already processed this stream
        if (receivedStreamIds.has(streamId)) {
          return;
        }
        receivedStreamIds.add(streamId);
        receivedStreamCount++;
        
        // First stream = webcam, second stream = screen
        // (This matches the order candidate adds tracks in useLiveProctor)
        if (receivedStreamCount === 1) {
          log(`Webcam stream received from ${candidateName} (first stream)`);
          updateCandidateStream(sessionId, { webcamStream: stream });
        } else if (receivedStreamCount === 2) {
          log(`Screen stream received from ${candidateName} (second stream)`);
          updateCandidateStream(sessionId, { screenStream: stream });
        }
      }
    };

    pc.onconnectionstatechange = () => {
      log(`Connection state for ${candidateName}:`, pc.connectionState);
      updateCandidateStream(sessionId, { connectionState: pc.connectionState });
      
      if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
        // Cleanup on disconnect
        peerConnectionsRef.current.delete(sessionId);
        const interval = pollIntervalsRef.current.get(sessionId);
        if (interval) {
          clearInterval(interval);
          pollIntervalsRef.current.delete(sessionId);
        }
      }
    };

    // Handle ICE candidates
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        log(`Sending ICE candidate for ${candidateName}`);
        await fetch(`${API_URL}/api/proctor/live/ice`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
            sender: "admin",
          }),
        });
      }
    };

    // Start polling for offer from candidate
    let offerReceived = false;
    let lastCandidateICEIndex = 0;

    const pollForOffer = async () => {
      try {
        const res = await fetch(`${API_URL}/api/proctor/live/session/${sessionId}`);
        const data = await res.json();

        if (!data.success) return;

        const updatedSession = data.data as CandidateSession;

        // Process offer
        if (!offerReceived && updatedSession.offer) {
          log(`Received offer from ${candidateName}`);
          
          await pc.setRemoteDescription(
            new RTCSessionDescription({
              type: updatedSession.offer.type as RTCSdpType,
              sdp: updatedSession.offer.sdp,
            })
          );

          // Create and send answer
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);

          await fetch(`${API_URL}/api/proctor/live/answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              sdp: answer.sdp,
              sdpType: "answer",
              sender: "admin",
            }),
          });

          log(`Answer sent to ${candidateName}`);
          offerReceived = true;
        }

        // Process ICE candidates
        if (updatedSession.candidateICE.length > lastCandidateICEIndex) {
          const newCandidates = updatedSession.candidateICE.slice(lastCandidateICEIndex);
          for (const ice of newCandidates) {
            log(`Adding ICE candidate from ${candidateName}`);
            await pc.addIceCandidate(
              new RTCIceCandidate({
                candidate: ice.candidate,
                sdpMid: ice.sdpMid,
                sdpMLineIndex: ice.sdpMLineIndex,
              })
            );
          }
          lastCandidateICEIndex = updatedSession.candidateICE.length;
        }

        // Check if session ended
        if (updatedSession.status === "ended") {
          log(`Session ended for ${candidateName}`);
          pc.close();
          peerConnectionsRef.current.delete(sessionId);
          const interval = pollIntervalsRef.current.get(sessionId);
          if (interval) {
            clearInterval(interval);
            pollIntervalsRef.current.delete(sessionId);
          }
          updateCandidateStream(sessionId, { connectionState: "disconnected" });
        }
      } catch (err) {
        log(`Error polling for ${candidateName}:`, err);
      }
    };

    // Start polling
    const pollInterval = setInterval(pollForOffer, 1000);
    pollIntervalsRef.current.set(sessionId, pollInterval);
    pollForOffer(); // Initial check
  }, [log, updateCandidateStream]);

  // Start monitoring all candidates
  const startMonitoring = useCallback(async () => {
    if (!assessmentId || !adminId) return;

    setIsLoading(true);
    log("Starting multi-candidate monitoring...");

    try {
      // Create sessions for all active candidates
      const createRes = await fetch(`${API_URL}/api/proctor/live/create-multi-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assessmentId,
          adminId,
        }),
      });
      const createData = await createRes.json();

      if (!createData.success) {
        throw new Error(createData.message || "Failed to create sessions");
      }

      log(`Created ${createData.data.count} sessions`);
      setActiveCandidates(createData.data.sessions);

      // Connect to each candidate
      for (const session of createData.data.sessions) {
        await connectToCandidate(session);
      }

      // Start polling for new candidates
      mainPollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`${API_URL}/api/proctor/live/all-sessions/${assessmentId}`);
          const data = await res.json();
          
          if (data.success && data.data.sessions) {
            const sessions = data.data.sessions as CandidateSession[];
            setActiveCandidates(sessions);
            
            // Connect to any new candidates
            for (const session of sessions) {
              if (!peerConnectionsRef.current.has(session.sessionId)) {
                await connectToCandidate(session);
              }
            }
          }
        } catch (err) {
          log("Error polling for sessions:", err);
        }
      }, 5000);

    } catch (err) {
      log("Error starting monitoring:", err);
      onError?.(err instanceof Error ? err.message : "Failed to start monitoring");
    } finally {
      setIsLoading(false);
    }
  }, [assessmentId, adminId, log, connectToCandidate, onError]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    log("Stopping monitoring...");

    // Clear main poll interval
    if (mainPollIntervalRef.current) {
      clearInterval(mainPollIntervalRef.current);
      mainPollIntervalRef.current = null;
    }

    // Clear all candidate poll intervals
    pollIntervalsRef.current.forEach((interval) => clearInterval(interval));
    pollIntervalsRef.current.clear();

    // Close all peer connections
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    // Clear streams
    setCandidateStreams(new Map());
    setActiveCandidates([]);
  }, [log]);

  // Refresh a specific candidate's connection
  const refreshCandidate = useCallback(async (sessionId: string) => {
    const pc = peerConnectionsRef.current.get(sessionId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(sessionId);
    }

    const interval = pollIntervalsRef.current.get(sessionId);
    if (interval) {
      clearInterval(interval);
      pollIntervalsRef.current.delete(sessionId);
    }

    // Find the session and reconnect
    const session = activeCandidates.find(s => s.sessionId === sessionId);
    if (session) {
      await connectToCandidate(session);
    }
  }, [activeCandidates, connectToCandidate]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopMonitoring();
    };
  }, [stopMonitoring]);

  return {
    candidateStreams: Array.from(candidateStreams.values()),
    activeCandidates,
    isLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
  };
}

