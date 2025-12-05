/**
 * useMultiLiveProctorAdmin Hook
 * 
 * Handles multiple WebRTC connections for admin to view all candidates
 * in the multi-proctor dashboard (CCTV-style view).
 * 
 * Features:
 * - One RTCPeerConnection per candidate (strictly enforced)
 * - WebSocket-like event-based signaling (using efficient polling)
 * - Prevents reconnection storms
 * - HMR protection
 * - Proper cleanup and lifecycle management
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

// HMR Protection: Store connections outside React to survive hot reloads
const globalPeerConnections = new Map<string, RTCPeerConnection>();
const globalStreams = new Map<string, { webcamStream: MediaStream | null; screenStream: MediaStream | null }>();
const globalReconnectionAttempts = new Map<string, number>();
const globalIsConnecting = new Map<string, boolean>(); // Guard against duplicate connections
const MAX_RECONNECTION_ATTEMPTS = 3;

export function useMultiLiveProctorAdmin({
  assessmentId,
  adminId,
  onError,
  debugMode = false,
}: UseMultiLiveProctorAdminOptions) {
  const [candidateStreams, setCandidateStreams] = useState<Map<string, CandidateStream>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [activeCandidates, setActiveCandidates] = useState<CandidateSession[]>([]);
  
  // Use refs for stable references
  const activeCandidatesRef = useRef<CandidateSession[]>([]); // Track active candidates for closures
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const streamsRef = useRef<Map<string, { webcamStream: MediaStream | null; screenStream: MediaStream | null }>>(new Map());
  const signalingStateRef = useRef<Map<string, string>>(new Map());
  const offerReceivedRef = useRef<Map<string, boolean>>(new Map());
  const lastCandidateICEIndexRef = useRef<Map<string, number>>(new Map());
  const pollIntervalsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const mainPollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isMonitoringRef = useRef<boolean>(false);
  const reconnectTimeoutsRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
  const isHMRRef = useRef(false);
  const isConnectingRef = useRef<Map<string, boolean>>(new Map()); // Guard: prevent duplicate connections
  const processedOffersRef = useRef<Map<string, string>>(new Map()); // Track processed offer SDPs to prevent duplicates

  // HMR Detection and restoration
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const hmrKey = '__HMR_ACTIVE__';
      if ((window as any)[hmrKey]) {
        isHMRRef.current = true;
        log("HMR detected - preserving WebRTC connections");
      }
      
      // Restore connections from global storage after HMR
      if (globalPeerConnections.size > 0) {
        log(`Restoring ${globalPeerConnections.size} connections after HMR`);
        globalPeerConnections.forEach((pc, candidateId) => {
          if (pc.connectionState !== 'closed' && pc.signalingState !== 'closed') {
            peerConnectionsRef.current.set(candidateId, pc);
            log(`Restored connection for candidate: ${candidateId}`);
          } else {
            // Clean up closed connections
            globalPeerConnections.delete(candidateId);
          }
        });
        globalStreams.forEach((streams, candidateId) => {
          streamsRef.current.set(candidateId, streams);
        });
      }
    }
  }, []);

  const log = useCallback(
    (message: string, data?: unknown) => {
      if (debugMode) {
        console.log(`[MultiProctorAdmin] ${message}`, data || "");
      }
    },
    [debugMode]
  );

  // Update candidate stream state (only update if something actually changed)
  const updateCandidateStream = useCallback((candidateId: string, updates: Partial<CandidateStream>) => {
    setCandidateStreams(prev => {
      const existing = prev.get(candidateId);
      
      // Check if any updates actually changed values
      let hasChanges = false;
      if (existing) {
        for (const key in updates) {
          const typedKey = key as keyof CandidateStream;
          if (existing[typedKey] !== updates[typedKey]) {
            hasChanges = true;
            break;
          }
        }
      } else {
        hasChanges = true;
      }
      
      if (!hasChanges) {
        return prev;
      }
      
      const newMap = new Map(prev);
      const candidateData = existing || {
        sessionId: updates.sessionId || "",
        candidateId,
        candidateName: updates.candidateName || "",
        connectionState: "disconnected",
        webcamStream: null,
        screenStream: null,
      };
      const finalSessionId = updates.sessionId || candidateData.sessionId || "";
      newMap.set(candidateId, { ...candidateData, ...updates, sessionId: finalSessionId });
      return newMap;
    });
  }, []);

  // Cleanly close a peer connection with all handlers removed
  const closePeerConnection = useCallback((candidateId: string, reason: string) => {
    const pc = peerConnectionsRef.current.get(candidateId);
    if (pc) {
      log(`Closing PC for ${candidateId}: ${reason}`);
      try {
        // Remove all event handlers first
          pc.ontrack = null;
          pc.onicecandidate = null;
          pc.oniceconnectionstatechange = null;
          pc.onconnectionstatechange = null;
          pc.onsignalingstatechange = null;
        
        // Stop all tracks
        pc.getReceivers().forEach(receiver => {
          if (receiver.track) {
            receiver.track.stop();
          }
        });
        
        // Close the connection
        pc.close();
      } catch (err) {
        log(`Error closing PC for ${candidateId}:`, err);
      }
      
      // Remove from all maps
      peerConnectionsRef.current.delete(candidateId);
      globalPeerConnections.delete(candidateId);
    }
    
    // Clear streams
    const streams = streamsRef.current.get(candidateId);
    if (streams) {
      streams.webcamStream?.getTracks().forEach(t => t.stop());
      streams.screenStream?.getTracks().forEach(t => t.stop());
      streamsRef.current.delete(candidateId);
      globalStreams.delete(candidateId);
    }
    
    // Clear all tracking state
    signalingStateRef.current.delete(candidateId);
    offerReceivedRef.current.delete(candidateId);
    lastCandidateICEIndexRef.current.delete(candidateId);
    isConnectingRef.current.delete(candidateId);
    globalIsConnecting.delete(candidateId);
    processedOffersRef.current.delete(candidateId);
    
    // Clear reconnect timeout
    const reconnectTimeout = reconnectTimeoutsRef.current.get(candidateId);
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeoutsRef.current.delete(candidateId);
    }
    
    // Clear poll interval
    const pollInterval = pollIntervalsRef.current.get(candidateId);
    if (pollInterval) {
      clearInterval(pollInterval);
      pollIntervalsRef.current.delete(candidateId);
    }
  }, [log]);

  // Check if PC is healthy (should NOT be recreated)
  const isPCHealthy = useCallback((pc: RTCPeerConnection): boolean => {
    const state = pc.connectionState;
    const signalingState = pc.signalingState;
    const iceState = pc.iceConnectionState;
    
    // PC is healthy if:
    // - connectionState is "connected" or "connecting"
    // - signalingState is "stable"
    // - iceConnectionState is NOT "failed" or "disconnected"
    const isHealthy = 
      (state === "connected" || state === "connecting") &&
      signalingState === "stable" &&
      iceState !== "failed" &&
      iceState !== "disconnected";
    
    return isHealthy;
  }, []);

  // Check if PC needs cleanup (is in failed state)
  const shouldCleanupPC = useCallback((pc: RTCPeerConnection): boolean => {
    const state = pc.connectionState;
    const signalingState = pc.signalingState;
    const iceState = pc.iceConnectionState;
    
    // Need cleanup if:
    // - connectionState is "failed"
    // - connectionState is "disconnected" (will check duration separately)
    // - iceConnectionState is "failed"
    // - signalingState is "closed"
    return (
      state === "failed" ||
      iceState === "failed" ||
      signalingState === "closed"
    );
  }, []);

  // Track disconnected duration per candidate
  const disconnectedSinceRef = useRef<Map<string, number>>(new Map());

  // Setup peer connection event handlers (reusable function)
  const setupPeerConnectionHandlers = useCallback((
    pc: RTCPeerConnection,
    session: CandidateSession,
    key: string,
    candidateName: string
  ) => {
    const { sessionId, candidateId } = session;
    
    // Track received streams
    const receivedStreams: MediaStream[] = [];
    const receivedStreamIds = new Set<string>();

    // Handle incoming tracks
    pc.ontrack = (event) => {
      log(`Received track from ${candidateName}:`, {
        kind: event.track.kind,
        streamId: event.streams?.[0]?.id,
        trackId: event.track.id,
        trackState: event.track.readyState,
      });
      
      // Monitor track state
      event.track.onended = () => {
        log(`Track ended for ${candidateName}:`, event.track.id);
      };
      
      if (event.streams && event.streams.length > 0) {
        event.streams.forEach((stream) => {
        const streamId = stream.id;
        
        if (receivedStreamIds.has(streamId)) {
          return;
        }
          
        receivedStreamIds.add(streamId);
        receivedStreams.push(stream);
        
          const hasVideo = stream.getVideoTracks().length > 0;
          const hasAudio = stream.getAudioTracks().length > 0;
          
          // First stream with audio = webcam, second video-only = screen
          if (receivedStreams.length === 1 || (hasVideo && hasAudio)) {
            log(`Setting webcam stream for ${candidateName}`);
            const streams = streamsRef.current.get(key) || { webcamStream: null, screenStream: null };
            streams.webcamStream = stream;
            streamsRef.current.set(key, streams);
            globalStreams.set(key, streams);
            
            updateCandidateStream(key, { 
              webcamStream: stream,
              connectionState: "connecting",
            });
          } else if (receivedStreams.length === 2 || (hasVideo && !hasAudio)) {
            log(`Setting screen stream for ${candidateName}`);
            const streams = streamsRef.current.get(key) || { webcamStream: null, screenStream: null };
            streams.screenStream = stream;
            streamsRef.current.set(key, streams);
            globalStreams.set(key, streams);
            
            updateCandidateStream(key, { 
              screenStream: stream,
              connectionState: "connecting",
            });
          }
        });
      }
    };

    // Connection state handler
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      const iceState = pc.iceConnectionState;
      log(`Connection state for ${candidateName}: ${state}, ICE: ${iceState}`);
      
      updateCandidateStream(key, { connectionState: state });
      
      if (state === "connected") {
        log(`✅ Connection established with ${candidateName}!`);
        // Reset reconnection attempts and connecting flag on success
        globalReconnectionAttempts.delete(key);
        isConnectingRef.current.set(key, false);
        globalIsConnecting.set(key, false);
        disconnectedSinceRef.current.delete(key); // Clear disconnected timer
      }
      
      if (state === "disconnected") {
        log(`⚠️ Connection disconnected for ${candidateName} - may reconnect`);
        // Start timer for disconnected state
        if (!disconnectedSinceRef.current.has(key)) {
          disconnectedSinceRef.current.set(key, Date.now());
        }
      }
      
      if (state === "failed") {
        log(`❌ Connection failed for ${candidateName}`);
        
        // Check reconnection attempts
        const attempts = globalReconnectionAttempts.get(key) || 0;
        if (attempts >= MAX_RECONNECTION_ATTEMPTS) {
          log(`Max reconnection attempts reached for ${candidateName}, giving up`);
          closePeerConnection(key, "Max reconnection attempts reached");
          updateCandidateStream(key, { 
            connectionState: "failed",
            webcamStream: null,
            screenStream: null,
          });
          return;
        }
        
        // Try ICE restart first (up to 3 times) - but NOT if PC is closed
        if (pc.signalingState !== "closed" && pc.connectionState !== "closed") {
          try {
            log(`Attempting ICE restart for ${candidateName} (attempt ${attempts + 1}/${MAX_RECONNECTION_ATTEMPTS})`);
            pc.restartIce();
            globalReconnectionAttempts.set(key, attempts + 1);
          } catch (err) {
            log(`Failed to restart ICE for ${candidateName}:`, err);
            // If restart fails, schedule cleanup and allow reconnection
            const timeout = setTimeout(() => {
              reconnectTimeoutsRef.current.delete(key);
              if (pc.connectionState === "failed" && pc.iceConnectionState === "failed") {
                log(`ICE restart failed, allowing reconnection for ${candidateName}`);
                closePeerConnection(key, "ICE restart failed");
                isConnectingRef.current.set(key, false);
                globalIsConnecting.set(key, false);
              }
            }, 5000);
            reconnectTimeoutsRef.current.set(key, timeout);
          }
        } else {
          log(`Cannot restart ICE - PC is closed for ${candidateName}`);
        }
      }
    };

    // ICE connection state handler
    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      log(`ICE connection state for ${candidateName}: ${iceState}`);
      
      // Only try restartIce if PC is NOT closed
      if (iceState === "failed" && pc.signalingState !== "closed" && pc.connectionState !== "closed") {
        // Try restart
        try {
          pc.restartIce();
          log(`ICE restart initiated for ${candidateName}`);
        } catch (err) {
          log(`Failed to restart ICE:`, err);
        }
      } else if (iceState === "connected" || iceState === "completed") {
        log(`✅ ICE connected for ${candidateName}`);
        if (pc.connectionState === "connecting") {
          updateCandidateStream(key, { connectionState: "connected" });
        }
      } else if (iceState === "disconnected") {
        log(`⚠️ ICE disconnected for ${candidateName} - may reconnect`);
        // Start timer for disconnected state
        if (!disconnectedSinceRef.current.has(key)) {
          disconnectedSinceRef.current.set(key, Date.now());
        }
        // DO NOT recreate PC immediately - wait for restartIce to work
      }
    };

    // ICE candidate handler
    pc.onicecandidate = async (event) => {
      if (event.candidate) {
        try {
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
        } catch (err) {
          log(`Error sending ICE candidate for ${candidateName}:`, err);
        }
      }
    };

    // Signaling state handler
    pc.onsignalingstatechange = () => {
      const signalingState = pc.signalingState;
      signalingStateRef.current.set(key, signalingState);
      log(`Signaling state for ${candidateName}: ${signalingState}`);
    };
  }, [log, updateCandidateStream, closePeerConnection]);

  // Connect to a single candidate's stream (with strict guards)
  const connectToCandidate = useCallback(async (session: CandidateSession) => {
    const { sessionId, candidateId } = session;
    const candidateName = session.candidateName || candidateId || "Unknown";
    const key = candidateId; // Use candidateId as stable key
    
    // GUARD 1: Check if already connecting
    if (isConnectingRef.current.get(key) || globalIsConnecting.get(key)) {
      log(`Already connecting to ${candidateName}, skipping...`);
      return;
    }
    
    // GUARD 2: Check if valid connection already exists
    const existingPc = peerConnectionsRef.current.get(key);
    if (existingPc) {
      // Check if PC is healthy - if so, skip
      if (isPCHealthy(existingPc)) {
        log(`Healthy connection exists for ${candidateName} (${existingPc.connectionState}/${existingPc.signalingState}/${existingPc.iceConnectionState}), skipping...`);
        disconnectedSinceRef.current.delete(key); // Clear disconnected timer
        return;
      }
      
      // Check if PC needs cleanup
      if (shouldCleanupPC(existingPc)) {
        log(`PC is in failed state for ${candidateName} (${existingPc.connectionState}/${existingPc.signalingState}/${existingPc.iceConnectionState}), cleaning up...`);
        closePeerConnection(key, `PC is in failed state: ${existingPc.connectionState}/${existingPc.signalingState}/${existingPc.iceConnectionState}`);
      } else if (existingPc.connectionState === "disconnected") {
        // Track disconnected duration
        const disconnectedSince = disconnectedSinceRef.current.get(key);
        const now = Date.now();
        
        if (!disconnectedSince) {
          // First time seeing disconnected, start timer
          disconnectedSinceRef.current.set(key, now);
          log(`PC disconnected for ${candidateName}, starting timer...`);
          return; // Give it 3 seconds to reconnect
        } else if (now - disconnectedSince < 3000) {
          // Less than 3 seconds, wait
          log(`PC disconnected for ${candidateName}, waiting for reconnection (${Math.round((now - disconnectedSince) / 1000)}s)...`);
          return;
        } else {
          // More than 3 seconds, cleanup
          log(`PC disconnected for ${candidateName} for more than 3 seconds, cleaning up...`);
          disconnectedSinceRef.current.delete(key);
          closePeerConnection(key, "Disconnected for more than 3 seconds");
        }
      } else {
        // PC exists but is in some other state - log and skip for now
        log(`PC exists for ${candidateName} in state ${existingPc.connectionState}/${existingPc.signalingState}/${existingPc.iceConnectionState}, skipping...`);
        return;
      }
    }

    // Set connecting guard
    isConnectingRef.current.set(key, true);
    globalIsConnecting.set(key, true);

    log(`Connecting to ${candidateName} (${key})...`);

    // Initialize stream state
    updateCandidateStream(key, {
      sessionId,
      candidateId,
      candidateName,
      connectionState: "connecting",
      webcamStream: null,
      screenStream: null,
    });

    // Create peer connection
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
      ],
      iceCandidatePoolSize: 10,
    });
    
    // Store in both ref and global (for HMR)
    peerConnectionsRef.current.set(key, pc);
    globalPeerConnections.set(key, pc);
    
    // Initialize tracking
    signalingStateRef.current.set(key, pc.signalingState);
    offerReceivedRef.current.set(key, false);
    lastCandidateICEIndexRef.current.set(key, 0);
    
    // Setup all event handlers using the reusable function
    setupPeerConnectionHandlers(pc, session, key, candidateName);

    // Event-based signaling (WebSocket-like polling)
    const pollForSignaling = async () => {
      try {
        // Check if monitoring is still active
        if (!isMonitoringRef.current) {
          log(`Monitoring stopped, stopping polling for ${candidateName}`);
          const interval = pollIntervalsRef.current.get(key);
          if (interval) {
            clearInterval(interval);
            pollIntervalsRef.current.delete(key);
          }
          return;
        }
        
        // Check if this candidate is still in the active candidates list (use ref for latest value)
        const isStillActive = activeCandidatesRef.current.some(c => c.candidateId === key);
        if (!isStillActive) {
          log(`Candidate ${candidateName} no longer active, stopping polling`);
          const interval = pollIntervalsRef.current.get(key);
          if (interval) {
            clearInterval(interval);
            pollIntervalsRef.current.delete(key);
          }
          closePeerConnection(key, "Candidate no longer in active list");
          return;
        }
        
        // Get current PC (it might have been recreated)
        let currentPc = peerConnectionsRef.current.get(key);
        if (!currentPc) {
          log(`No PC found for ${candidateName}, stopping polling`);
          const interval = pollIntervalsRef.current.get(key);
          if (interval) {
            clearInterval(interval);
            pollIntervalsRef.current.delete(key);
          }
          return;
        }

        const res = await fetch(`${API_URL}/api/proctor/live/session/${sessionId}`);
        const data = await res.json();

        if (!data.success) {
          return;
        }

        const updatedSession = data.data as CandidateSession;
        
        // Check if session has ended
        if (updatedSession.status === "ended" || updatedSession.status === "completed") {
          log(`Session ended for ${candidateName}, stopping polling`);
          const interval = pollIntervalsRef.current.get(key);
          if (interval) {
            clearInterval(interval);
            pollIntervalsRef.current.delete(key);
          }
          closePeerConnection(key, "Session ended/completed");
          return;
        }

        // Get fresh PC reference (it might have been recreated during offer processing)
        // We need to check again after fetching session data
        currentPc = peerConnectionsRef.current.get(key);
        if (!currentPc) {
          return; // PC was removed, skip this iteration
        }
        
        // Process offer - handle closed PC by recreating it
        const currentSignalingState = currentPc.signalingState;
        if (!offerReceivedRef.current.get(key) && updatedSession.offer) {
          // GUARD: Prevent processing the same offer twice
          const offerSdp = updatedSession.offer.sdp;
          const processedOfferSdp = processedOffersRef.current.get(key);
          if (processedOfferSdp === offerSdp) {
            log(`Offer already processed for ${candidateName}, skipping`);
            return;
          }

          // CRITICAL: If PC is closed, recreate it and process the offer
          if (currentPc.signalingState === "closed" || currentPc.connectionState === "closed") {
            log(`⚠️ PC is closed for ${candidateName} - recreating peer connection and processing offer`);
            
            // Close and remove the old PC
            closePeerConnection(key, "PC is closed, recreating for new offer");
            
            // Clear connecting flag to allow new connection
            isConnectingRef.current.set(key, false);
            globalIsConnecting.set(key, false);
            
            // Create new peer connection
            const newPc = new RTCPeerConnection({
              iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                { urls: "stun:stun1.l.google.com:19302" },
                { urls: "stun:stun2.l.google.com:19302" },
              ],
              iceCandidatePoolSize: 10,
            });
            
            // Store the new PC
            peerConnectionsRef.current.set(key, newPc);
            globalPeerConnections.set(key, newPc);
            
            // Re-setup event handlers for the new PC (use updatedSession to get latest session data)
            setupPeerConnectionHandlers(newPc, updatedSession, key, candidateName);
            
            // Update tracking refs for the new PC
            signalingStateRef.current.set(key, newPc.signalingState);
            offerReceivedRef.current.set(key, false);
            lastCandidateICEIndexRef.current.set(key, 0);
            
            // Now process the offer on the new PC
            try {
              log(`Processing offer on new PC for ${candidateName}`);
              processedOffersRef.current.set(key, offerSdp);
              
              await newPc.setRemoteDescription(
                new RTCSessionDescription({
                  type: updatedSession.offer.type as RTCSdpType,
                  sdp: updatedSession.offer.sdp,
                })
              );

              const answer = await newPc.createAnswer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true,
              });
              await newPc.setLocalDescription(answer);

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

              log(`✅ Answer sent to ${candidateName} on new PC`);
              offerReceivedRef.current.set(key, true);
            } catch (err) {
              log(`Error processing offer on new PC for ${candidateName}:`, err);
              processedOffersRef.current.delete(key);
            }
            
            return; // Exit early after handling closed PC case
          }
          
          // Normal case: PC is stable, process offer normally
          if (currentSignalingState !== "stable") {
            log(`Skipping offer for ${candidateName} - signalingState is ${currentSignalingState}, not stable`);
            return;
          }

          log(`Processing offer from ${candidateName}`);
          processedOffersRef.current.set(key, offerSdp);
          
          try {
            // Get current PC again (might have changed)
            const pcForOffer = peerConnectionsRef.current.get(key);
            if (!pcForOffer) {
              log(`PC was removed during offer processing for ${candidateName}, aborting`);
              processedOffersRef.current.delete(key);
              return;
            }
            
            // Safe check: verify PC is still valid before setting remote description
            if (pcForOffer.signalingState !== "stable" || pcForOffer.connectionState === "closed") {
              log(`PC state changed during offer processing for ${candidateName}, aborting`);
              processedOffersRef.current.delete(key);
              return;
            }
            
            await pcForOffer.setRemoteDescription(
            new RTCSessionDescription({
              type: updatedSession.offer.type as RTCSdpType,
              sdp: updatedSession.offer.sdp,
            })
          );

            const answer = await pcForOffer.createAnswer({
              offerToReceiveAudio: true,
              offerToReceiveVideo: true,
            });
            await pcForOffer.setLocalDescription(answer);

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
            offerReceivedRef.current.set(key, true);
          } catch (err) {
            log(`Error processing offer for ${candidateName}:`, err);
            // Remove from processed offers so we can retry
            processedOffersRef.current.delete(key);
          }
        }

        // Process ICE candidates - only if PC is valid and offer was received
        const pcForICE = peerConnectionsRef.current.get(key);
        if (offerReceivedRef.current.get(key) && pcForICE && pcForICE.signalingState !== "closed" && pcForICE.connectionState !== "closed") {
          const lastIndex = lastCandidateICEIndexRef.current.get(key) || 0;
          if (updatedSession.candidateICE && updatedSession.candidateICE.length > lastIndex) {
            const newCandidates = updatedSession.candidateICE.slice(lastIndex);
          for (const ice of newCandidates) {
              try {
                // Get fresh PC reference in case it was recreated
                const currentPcForICE = peerConnectionsRef.current.get(key);
                if (!currentPcForICE || currentPcForICE.signalingState === "closed" || currentPcForICE.connectionState === "closed") {
                  log(`PC closed, skipping ICE candidate for ${candidateName}`);
                  break;
                }
                
                await currentPcForICE.addIceCandidate(
              new RTCIceCandidate({
                candidate: ice.candidate,
                sdpMid: ice.sdpMid,
                sdpMLineIndex: ice.sdpMLineIndex,
              })
            );
              } catch (err) {
                log(`Error adding ICE candidate for ${candidateName}:`, err);
              }
            }
            lastCandidateICEIndexRef.current.set(key, updatedSession.candidateICE.length);
          }
        }

        // Check if session ended or completed
        if (updatedSession.status === "ended" || updatedSession.status === "completed") {
          log(`Session ended for ${candidateName}, stopping polling`);
          const pollInterval = pollIntervalsRef.current.get(key);
          if (pollInterval) {
            clearInterval(pollInterval);
            pollIntervalsRef.current.delete(key);
          }
          log(`Session ended/completed for ${candidateName}, closing connection and removing from active list`);
          closePeerConnection(key, "Session ended/completed");
          updateCandidateStream(key, { 
            connectionState: "disconnected",
            webcamStream: null,
            screenStream: null,
          });
          
          // Remove from active candidates list
          setActiveCandidates(prev => {
            const filtered = prev.filter(c => c.candidateId !== candidateId);
            activeCandidatesRef.current = filtered; // Update ref
            return filtered;
          });
          
          // Stop polling for this candidate (already handled by closePeerConnection)
          return; // Exit polling function
        }
      } catch (err) {
        log(`Error polling for ${candidateName}:`, err);
      }
    };

    // Start polling (event-based signaling)
    pollForSignaling();
    const pollInterval = setInterval(pollForSignaling, 1000);
    pollIntervalsRef.current.set(key, pollInterval);
    
    // Clear connecting flag after a delay (in case connection fails immediately)
    setTimeout(() => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        isConnectingRef.current.set(key, false);
        globalIsConnecting.set(key, false);
      }
    }, 10000); // 10 second timeout
  }, [log, updateCandidateStream, closePeerConnection]);

  // Start monitoring all candidates
  const startMonitoring = useCallback(async () => {
    if (!assessmentId || !adminId) {
      log("Cannot start monitoring: missing assessmentId or adminId");
      return;
    }

    // Prevent multiple instances
    if (mainPollIntervalRef.current) {
      log("WARNING: Main poll interval already exists, clearing it first");
      clearInterval(mainPollIntervalRef.current);
      mainPollIntervalRef.current = null;
    }
    
    pollIntervalsRef.current.forEach((interval) => clearInterval(interval));
    pollIntervalsRef.current.clear();

    isMonitoringRef.current = true;
    setIsLoading(true);
    log("Starting multi-candidate monitoring...");

    try {
      // Fetch existing active sessions
      const res = await fetch(`${API_URL}/api/proctor/live/all-sessions/${assessmentId}`);
      const data = await res.json();

      if (!data.success) {
        throw new Error(data.message || "Failed to fetch sessions");
      }

      const sessions = (data.data.sessions || []) as CandidateSession[];
      log(`Found ${sessions.length} existing sessions`);

      // Filter out ended/completed sessions - only show active ones
      // Also check if candidates have submitted by checking assessment data
      let activeSessions = sessions.filter(session => 
        session.status !== "ended" && session.status !== "completed"
      );
      
      // Additional check: Verify candidates haven't submitted by checking assessment
      // This is a safety check in case session status wasn't updated properly
      try {
        const assessmentRes = await fetch(`${API_URL}/api/assessments/get-questions?assessmentId=${assessmentId}`);
        const assessmentData = await assessmentRes.json();
        
        if (assessmentData.success && assessmentData.data?.assessment?.candidateResponses) {
          const candidateResponses = assessmentData.data.assessment.candidateResponses;
          const submittedCandidates = new Set<string>();
          
          // Extract submitted candidate emails
          Object.values(candidateResponses).forEach((response: any) => {
            if (response.submittedAt) {
              submittedCandidates.add(response.email?.toLowerCase() || '');
            }
          });
          
          // Filter out sessions for candidates who have submitted
          activeSessions = activeSessions.filter(session => {
            const candidateEmail = session.candidateId?.toLowerCase() || '';
            const hasSubmitted = submittedCandidates.has(candidateEmail);
            if (hasSubmitted) {
              log(`Filtering out ${session.candidateName || session.candidateId} - candidate has submitted`);
            }
            return !hasSubmitted;
          });
        }
      } catch (err) {
        log("Error checking candidate submissions, using session status only:", err);
      }
      
      log(`Filtered to ${activeSessions.length} active sessions (excluded ${sessions.length - activeSessions.length} ended/completed/submitted sessions)`);

      const sessionsWithNames = activeSessions.map(session => ({
        ...session,
        candidateName: session.candidateName || session.candidateId || "Unknown",
      }));

      setActiveCandidates(sessionsWithNames);
      activeCandidatesRef.current = sessionsWithNames; // Update ref

      // Connect to each candidate (only if not already connected or if PC is unhealthy)
      for (const session of sessionsWithNames) {
        const candidateId = session.candidateId;
        const existingPc = peerConnectionsRef.current.get(candidateId);
        
        if (!existingPc) {
          // No PC exists - connect
          await connectToCandidate(session);
        } else if (isPCHealthy(existingPc)) {
          // PC is healthy - skip
          log(`Skipping ${session.candidateName} - healthy connection exists`);
          disconnectedSinceRef.current.delete(candidateId); // Clear disconnected timer
        } else if (shouldCleanupPC(existingPc)) {
          // PC is in failed state - cleanup and reconnect
          log(`PC is unhealthy for ${session.candidateName}, cleaning up and reconnecting...`);
          closePeerConnection(candidateId, "Unhealthy PC detected on start");
          await connectToCandidate(session);
        } else if (existingPc.connectionState === "disconnected") {
          // Check disconnected duration
          const disconnectedSince = disconnectedSinceRef.current.get(candidateId);
          const now = Date.now();
          
          if (!disconnectedSince) {
            disconnectedSinceRef.current.set(candidateId, now);
            log(`PC disconnected for ${session.candidateName}, will reconnect if still disconnected after 3s`);
          } else if (now - disconnectedSince >= 3000) {
            log(`PC disconnected for ${session.candidateName} for >3s, reconnecting...`);
            disconnectedSinceRef.current.delete(candidateId);
            closePeerConnection(candidateId, "Disconnected for more than 3 seconds");
            await connectToCandidate(session);
          } else {
            log(`PC disconnected for ${session.candidateName}, waiting...`);
          }
        } else {
          // Other state - try to connect (will be handled by connectToCandidate guards)
        await connectToCandidate(session);
        }
      }

      // Poll for new candidates (with strict guards)
      mainPollIntervalRef.current = setInterval(async () => {
        if (!isMonitoringRef.current) {
          if (mainPollIntervalRef.current) {
            clearInterval(mainPollIntervalRef.current);
            mainPollIntervalRef.current = null;
          }
          return;
        }
        
        try {
          const pollRes = await fetch(`${API_URL}/api/proctor/live/all-sessions/${assessmentId}`);
          const pollData = await pollRes.json();
          
          if (pollData.success && pollData.data.sessions) {
            const newSessions = pollData.data.sessions as CandidateSession[];
            
            // Filter out ended/completed sessions - only process active ones
            let activeNewSessions = newSessions.filter(session => 
              session.status !== "ended" && session.status !== "completed"
            );
            
            // Additional check: Filter out candidates who have submitted
            // This is a safety check in case session status wasn't updated properly
            try {
              const assessmentRes = await fetch(`${API_URL}/api/assessments/get-questions?assessmentId=${assessmentId}`);
              const assessmentData = await assessmentRes.json();
              
              if (assessmentData.success && assessmentData.data?.assessment?.candidateResponses) {
                const candidateResponses = assessmentData.data.assessment.candidateResponses;
                const submittedCandidates = new Set<string>();
                
                // Extract submitted candidate emails
                Object.values(candidateResponses).forEach((response: any) => {
                  if (response.submittedAt) {
                    submittedCandidates.add(response.email?.toLowerCase() || '');
                  }
                });
                
                // Filter out sessions for candidates who have submitted
                activeNewSessions = activeNewSessions.filter(session => {
                  const candidateEmail = session.candidateId?.toLowerCase() || '';
                  const hasSubmitted = submittedCandidates.has(candidateEmail);
                  if (hasSubmitted) {
                    log(`Filtering out ${session.candidateName || session.candidateId} - candidate has submitted`);
                  }
                  return !hasSubmitted;
                });
              }
            } catch (err) {
              log("Error checking candidate submissions in polling, using session status only:", err);
            }
            
            const newSessionsWithNames = activeNewSessions.map(session => ({
              ...session,
              candidateName: session.candidateName || session.candidateId || "Unknown",
            }));
            
            // Get current candidate IDs
            const currentCandidateIds = new Set(activeCandidates.map(s => s.candidateId));
            const newCandidateIds = new Set(newSessionsWithNames.map(s => s.candidateId));
            
            // Remove any candidates whose sessions have ended or who have submitted
            const endedSessions = newSessions.filter(s => 
              s.status === "ended" || s.status === "completed"
            );
            for (const endedSession of endedSessions) {
              const candidateId = endedSession.candidateId;
              if (currentCandidateIds.has(candidateId)) {
                log(`Removing ended session for ${endedSession.candidateName || candidateId}`);
                closePeerConnection(candidateId, "Session ended/completed");
                setCandidateStreams(prev => {
                  const updated = new Map(prev);
                  updated.delete(candidateId);
                  return updated;
                });
              }
            }
            
            // Connect to NEW candidates only (strict check)
            for (const session of newSessionsWithNames) {
        const candidateId = session.candidateId;
        
        // Only connect if not in current list (new candidate)
        if (!currentCandidateIds.has(candidateId)) {
          const existingPc = peerConnectionsRef.current.get(candidateId);
          const isConnecting = isConnectingRef.current.get(candidateId) || globalIsConnecting.get(candidateId);
          
          // GUARD: Don't create if already connecting
          if (isConnecting) {
            log(`Skipping ${session.candidateName} - already connecting`);
            continue;
          }
          
          // Check if existing PC is healthy
          if (existingPc) {
            if (isPCHealthy(existingPc)) {
              log(`Skipping ${session.candidateName} - healthy connection exists`);
              continue;
            }
            
            // PC exists but is not healthy - cleanup first
            if (shouldCleanupPC(existingPc)) {
              log(`Cleaning up unhealthy PC for ${session.candidateName} before connecting`);
              closePeerConnection(candidateId, "Unhealthy PC detected in polling");
            } else if (existingPc.connectionState === "disconnected") {
              // Check disconnected duration
              const disconnectedSince = disconnectedSinceRef.current.get(candidateId);
              const now = Date.now();
              
              if (!disconnectedSince || now - disconnectedSince < 3000) {
                log(`Skipping ${session.candidateName} - PC disconnected, waiting for reconnection`);
                continue;
              } else {
                log(`Cleaning up disconnected PC for ${session.candidateName} (>3s)`);
                disconnectedSinceRef.current.delete(candidateId);
                closePeerConnection(candidateId, "Disconnected for more than 3 seconds");
              }
            } else {
              // Other state - skip for now
              log(`Skipping ${session.candidateName} - PC in state ${existingPc.connectionState}`);
              continue;
            }
          }
          
          // No existing PC or PC was cleaned up - connect
          log(`New candidate detected: ${session.candidateName}, connecting...`);
                await connectToCandidate(session);
        }
      }
            
            // Remove disconnected candidates (those no longer in the sessions list)
            for (const candidateId of Array.from(currentCandidateIds)) {
              if (!newCandidateIds.has(candidateId)) {
                log(`Candidate disconnected: ${candidateId}, cleaning up...`);
                closePeerConnection(candidateId, "Candidate disconnected");
                setCandidateStreams(prev => {
                  const updated = new Map(prev);
                  updated.delete(candidateId);
                  return updated;
                });
              }
            }
            
            // Only update state if changed
            const sessionsChanged = 
              currentCandidateIds.size !== newCandidateIds.size ||
              Array.from(newCandidateIds).some(id => !currentCandidateIds.has(id)) ||
              Array.from(currentCandidateIds).some(id => !newCandidateIds.has(id));
            
            if (sessionsChanged) {
              setActiveCandidates(newSessionsWithNames);
              activeCandidatesRef.current = newSessionsWithNames; // Update ref
            }
          }
        } catch (err) {
          log("Error polling for sessions:", err);
        }
      }, 5000);
    } catch (err) {
      log("Error starting monitoring:", err);
      onError?.(err instanceof Error ? err.message : "Failed to start monitoring");
      if (mainPollIntervalRef.current) {
        clearInterval(mainPollIntervalRef.current);
        mainPollIntervalRef.current = null;
      }
      pollIntervalsRef.current.forEach((interval) => clearInterval(interval));
      pollIntervalsRef.current.clear();
    } finally {
      setIsLoading(false);
    }
  }, [assessmentId, adminId, log, connectToCandidate, onError, activeCandidates, closePeerConnection]);

  // Stop monitoring
  const stopMonitoring = useCallback(() => {
    log("Stopping monitoring...");
    isMonitoringRef.current = false;

    if (mainPollIntervalRef.current) {
      clearInterval(mainPollIntervalRef.current);
      mainPollIntervalRef.current = null;
    }

    pollIntervalsRef.current.forEach((interval) => clearInterval(interval));
    pollIntervalsRef.current.clear();

    reconnectTimeoutsRef.current.forEach((timeout) => clearTimeout(timeout));
    reconnectTimeoutsRef.current.clear();

    // Close all peer connections
    peerConnectionsRef.current.forEach((pc, candidateId) => {
      closePeerConnection(candidateId, "Monitoring stopped");
    });

    setCandidateStreams(new Map());
        setActiveCandidates([]);
        activeCandidatesRef.current = []; // Update ref
    
    log("Monitoring stopped");
  }, [log, closePeerConnection]);

  // Refresh a specific candidate's connection
  const refreshCandidate = useCallback(async (identifier: string) => {
    // Try to find by sessionId first, then by candidateId
    let session = activeCandidates.find(s => s.sessionId === identifier);
    if (!session) {
      session = activeCandidates.find(s => s.candidateId === identifier);
    }
    
    if (!session) {
      log(`Candidate not found: ${identifier}`);
      return;
    }
    
    const candidateId = session.candidateId;
    log(`Refreshing connection for ${candidateId}`);
    
    // Close existing connection
    closePeerConnection(candidateId, "Manual refresh");
    
    // Reset reconnection attempts
    globalReconnectionAttempts.delete(candidateId);
    
    // Reconnect
      await connectToCandidate(session);
  }, [activeCandidates, connectToCandidate, closePeerConnection, log]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (!isHMRRef.current) {
      stopMonitoring();
      }
    };
  }, [stopMonitoring]);

  // Memoize the candidateStreams array
  const candidateStreamsArray = useMemo(() => {
    return Array.from(candidateStreams.values());
  }, [candidateStreams]);

  return {
    candidateStreams: candidateStreamsArray,
    activeCandidates,
    isLoading,
    startMonitoring,
    stopMonitoring,
    refreshCandidate,
  };
}
