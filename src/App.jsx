import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

// URLs for your backend Cloud Functions
const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";
const CONFERENCE_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/conferenceCall";
const ADD_PARTICIPANT_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/addParticipant";
const AGENT_JOIN_CONFERENCE_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/agentJoinConference"; 

export default function OrbitPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  
  // Conference-related state
  const [isConference, setIsConference] = useState(false);
  const [conferenceName, setConferenceName] = useState("");
  const [participants, setParticipants] = useState([]);
  const [showAddParticipant, setShowAddParticipant] = useState(false);
  const [newParticipantNumber, setNewParticipantNumber] = useState("");
  const [callSid, setCallSid] = useState("");
  const [isTransitioningToConference, setIsTransitioningToConference] = useState(false);

  // --- URL params
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const accessKey = params.get("accessKey");
  const fromNumber = params.get("from");
  const toNumber = params.get("to");

  const isOutbound = !!(fromNumber && toNumber);

  // Call duration timer
  useEffect(() => {
    let interval;
    if (inCall) {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [inCall]);

  // Format call duration
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // Debug: Track conference state changes
  useEffect(() => {
    console.log("🔄 Conference state changed:");
    console.log("- isConference:", isConference);
    console.log("- conferenceName:", conferenceName);
    console.log("- showAddParticipant:", showAddParticipant);
  }, [isConference, conferenceName, showAddParticipant]);

  // --- Verify access
  useEffect(() => {
    const verify = async () => {
      if (!accessKey) {
        setAuthorized(false);
        setAuthChecked(true);
        return;
      }
      try {
        const res = await fetch(VERIFY_ACCESS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: accessKey }),
        });
        if (!res.ok) throw new Error("Unauthorized");
        setAuthorized(true);
      } catch {
        setAuthorized(false);
      } finally {
        setAuthChecked(true);
      }
    };
    verify();
  }, [accessKey]);

  // --- Initialize Device
  useEffect(() => {
    const initDevice = async () => {
      if (!agentId) {
        setStatus("No agent ID provided");
        return;
      }

      try {
        // Get microphone permission
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());

        // Get Twilio token
        const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
        const { token } = await res.json();

        // Initialize Twilio Device with enableRingingState
        const device = new Device(token, {
          enableRingingState: true,
          closeProtection: true,
        });
        deviceRef.current = device;

        // Incoming calls
        device.on("incoming", (call) => {
          console.log("📞 Incoming call received:", call.parameters);
          callRef.current = call;
          setCallSid(call.parameters.CallSid);
          setIncoming(true);
          setPhoneNumber(call.parameters.From || "Unknown");
          setStatus("Incoming call...");

          // Check if this is a conference call
          if (call.customParameters?.get('conferenceMode') === 'true') {
            setIsConference(true);
            setConferenceName(call.customParameters.get('conferenceName') || '');
          }

          // When call is accepted
          call.on("accept", () => {
            console.log("✅ Call accepted");
            setIncoming(false);
            setInCall(true);
            setStatus("Connected");
          });

          // When caller hangs up
          call.on("disconnect", () => {
            console.log("📴 Call disconnected");
            resetCallState();
          });

          // When caller cancels
          call.on("cancel", () => {
            console.log("❌ Call cancelled by caller");
            setStatus("Missed call");
            resetCallState();
          });

          // When you reject the call
          call.on("reject", () => {
            console.log("🚫 Call rejected");
            setStatus("Call rejected");
            resetCallState();
          });

          // Error handling
          call.on("error", (err) => {
            console.error("⚠️ Call error:", err);
            setStatus(`Error: ${err.message}`);
            resetCallState();
          });
        });

        // Register device
        await device.register();
        setStatus("Ready");

        // Auto outbound call or wait for inbound
        if (isOutbound) {
          setAudioEnabled(true);
          setPhoneNumber(toNumber);
          setTimeout(() => makeOutbound(toNumber), 200);
        }
      } catch (err) {
        setStatus(`Setup failed: ${err.message}`);
      }
    };

    initDevice();
  }, [agentId, isOutbound]);

  // Reset call state helper
  const resetCallState = () => {
    // If transitioning to conference, keep conference settings
    const keepConference = isTransitioningToConference;
    
    console.log("resetCallState called, keepConference:", keepConference);
    
    setIncoming(false);
    setInCall(false);
    setMicMuted(false);
    
    if (!keepConference) {
      setIsConference(false);
      setConferenceName("");
      setParticipants([]);
      setShowAddParticipant(false);
    }
    
    setCallSid("");
    callRef.current = null;
    
    if (!keepConference) {
      setPhoneNumber("");
      setTimeout(() => setStatus("Ready"), 2000);
    }
  };

  // --- Outbound call (regular or conference)
  const makeOutbound = async (number = phoneNumber, asConference = false) => {
    if (!deviceRef.current) {
      setStatus("Device not ready");
      return;
    }

    if (!number) {
      setStatus("Enter a number");
      return;
    }

    setStatus(`Calling ${number}...`);
    setPhoneNumber(number);

    try {
      const params = {
        To: number,
        From: fromNumber || "+1234567890"
      };

      // Use existing conference name if converting, otherwise create new
      let confName = conferenceName;
      
      // If starting as conference, pass conference parameters
      if (asConference || isConference) {
        if (!confName) {
          confName = `conf_${agentId}_${Date.now()}`;
          setConferenceName(confName);
        }
        params.conferenceMode = "true";
        params.conferenceName = confName;
        setIsConference(true);
        
        console.log("🎙️ Starting call in CONFERENCE mode:", confName);
      } else {
        console.log("📞 Starting regular call");
      }

      const call = await deviceRef.current.connect({ params });
      callRef.current = call;
      setInCall(true);

      // Store call SID from call parameters when available
      call.on("accept", () => {
        console.log("✅ Call connected");
        setStatus("Connected");
        if (call.parameters?.CallSid) {
          setCallSid(call.parameters.CallSid);
        }
      });

      call.on("ringing", () => {
        console.log("📞 Ringing...");
        setStatus("Ringing...");
      });

      call.on("disconnect", () => {
        console.log("📴 Call ended");
        resetCallState();
        if (isOutbound) setTimeout(() => window.close(), 1000);
      });

      call.on("error", (err) => {
        console.error("⚠️ Call error:", err);
        setStatus(`Call failed: ${err.message}`);
        setInCall(false);
      });
    } catch (err) {
      setStatus(`Connection failed: ${err.message}`);
      setInCall(false);
    }
  };

  // --- Start conference from active call
 const startConference = async () => {
  console.log("=== startConference called ===");
  console.log("callRef.current:", callRef.current);
  console.log("phoneNumber:", phoneNumber);
  
  if (!callRef.current || !phoneNumber) {
    console.log("Cannot start conference - missing call or phone number");
    return;
  }
  
  try {
    // Generate unique conference name
    const confName = `conf_${agentId}_${Date.now()}`;
    
    console.log("💫 Converting to conference call");
    console.log("- Current number:", phoneNumber);
    console.log("- Conference name:", confName);
    
    // Save the current phone number
    const currentNumber = phoneNumber;
    
    // Set transitioning flag to prevent clearing conference state
    setIsTransitioningToConference(true);
    
    // Set conference state FIRST
    setIsConference(true);
    setConferenceName(confName);
    setStatus("Converting to conference...");
    
    // Disconnect current call
    console.log("Disconnecting current call...");
    callRef.current.disconnect();
    
    // Wait for disconnect to complete
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log("🎙️ Joining conference room");
    setInCall(false);
    
    // Create a call that uses the agentJoinConference endpoint
    // This endpoint will return TwiML that puts you in the conference
    const params = {
      // Use the special conference join URL as the TwiML URL
      url: `${AGENT_JOIN_CONFERENCE_URL}?conferenceName=${encodeURIComponent(confName)}`,
    };

    const call = await deviceRef.current.connect({ params });
    callRef.current = call;
    setInCall(true);

    call.on("accept", async () => {
      console.log("✅ You joined the conference");
      setStatus("In conference");
      setIsTransitioningToConference(false);
      
      // Wait a moment for you to be fully in the conference
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Now add the original participant
      console.log("📞 Adding original participant:", currentNumber);
      setStatus("Adding participant...");
      
      try {
        const response = await fetch(ADD_PARTICIPANT_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conferenceName: confName,
            participantNumber: currentNumber,
            fromNumber: fromNumber || "+1234567890",
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to add original participant");
        }

        const data = await response.json();
        
        setParticipants([{
          number: currentNumber,
          sid: data.callSid,
          status: "connected"
        }]);
        
        setStatus("Conference active");
        console.log("✅ Conference ready");
      } catch (err) {
        console.error("Failed to add original participant:", err);
        setStatus("Failed to add participant");
      }
    });

    call.on("disconnect", () => {
      console.log("📴 Conference ended");
      resetCallState();
    });

    call.on("error", (err) => {
      console.error("⚠️ Conference error:", err);
      setStatus(`Conference failed: ${err.message}`);
      setInCall(false);
      setIsTransitioningToConference(false);
    });
    
  } catch (err) {
    console.error("Failed to start conference:", err);
    setStatus("Failed to start conference");
    setIsConference(false);
    setConferenceName("");
    setIsTransitioningToConference(false);
  }
};

  // --- Add participant to conference
  const addParticipant = async () => {
    if (!newParticipantNumber || !conferenceName) {
      alert("Please enter a phone number");
      return;
    }

    try {
      setStatus("Adding participant...");
      
      const response = await fetch(ADD_PARTICIPANT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conferenceName: conferenceName,
          participantNumber: newParticipantNumber,
          fromNumber: fromNumber || "+1234567890",
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to add participant");
      }

      const data = await response.json();
      
      setParticipants([...participants, {
        number: newParticipantNumber,
        sid: data.callSid,
        status: "calling"
      }]);
      
      setNewParticipantNumber("");
      setShowAddParticipant(false);
      setStatus("Participant added");
      
      setTimeout(() => setStatus("Connected"), 2000);
    } catch (err) {
      console.error("Failed to add participant:", err);
      alert("Failed to add participant: " + err.message);
      setStatus("Connected");
    }
  };

  // --- Call controls
  const accept = () => {
    if (!callRef.current) return;
    callRef.current.accept();
    setIncoming(false);
    setInCall(true);
    setStatus("Connected");
  };

  const reject = () => {
    if (!callRef.current) return;
    callRef.current.reject();
    resetCallState();
    setStatus("Call rejected");
  };

  const hangup = () => {
    if (!callRef.current) return;
    callRef.current.disconnect();
    resetCallState();
  };

  const toggleMic = () => {
    if (!callRef.current) return;
    callRef.current.mute(!micMuted);
    setMicMuted(!micMuted);
  };

  // Format phone number for display
  const formatPhoneNumber = (num) => {
    if (!num) return "";
    const cleaned = num.replace(/\D/g, "");
    if (cleaned.length === 11 && cleaned.startsWith("1")) {
      return `+1 (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
    }
    if (cleaned.length === 10) {
      return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
    }
    return num;
  };

  if (!authChecked)
    return (
      <Screen>
        <div style={styles.centerContent}>
          <div style={styles.loader}></div>
          <p style={styles.statusText}>Verifying access...</p>
        </div>
      </Screen>
    );

  if (!authorized)
    return (
      <Screen>
        <div style={styles.centerContent}>
          <div style={styles.errorIcon}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
          </div>
          <p style={styles.errorTitle}>Unauthorized Access</p>
          <p style={styles.errorText}>You don't have permission to access this phone.</p>
        </div>
      </Screen>
    );

  return (
    <div style={styles.page}>
      {/* Audio Enable Modal */}
      {!audioEnabled && !isOutbound && (
        <div style={styles.modal}>
          <div style={styles.modalCard}>
            <div style={styles.modalIcon}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#667eea" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" y1="19" x2="12" y2="23"></line>
                <line x1="8" y1="23" x2="16" y2="23"></line>
              </svg>
            </div>
            <h3 style={styles.modalTitle}>Enable Audio</h3>
            <p style={styles.modalText}>
              Allow audio access to hear incoming calls and communicate clearly.
            </p>
            <button style={styles.primaryBtn} onClick={() => setAudioEnabled(true)}>
              Enable Audio
            </button>
          </div>
        </div>
      )}

      {/* Add Participant Modal */}
      {showAddParticipant && (
        <div style={styles.modal}>
          <div style={styles.modalCard}>
            <div style={styles.modalIcon}>
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#667eea" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="8.5" cy="7" r="4"></circle>
                <line x1="20" y1="8" x2="20" y2="14"></line>
                <line x1="23" y1="11" x2="17" y2="11"></line>
              </svg>
            </div>
            <h3 style={styles.modalTitle}>Add Participant</h3>
            <input
              type="tel"
              placeholder="+1 (555) 000-0000"
              value={newParticipantNumber}
              onChange={(e) => setNewParticipantNumber(e.target.value)}
              style={styles.input}
            />
            <div style={styles.modalActions}>
              <button
                style={styles.secondaryBtn}
                onClick={() => {
                  setShowAddParticipant(false);
                  setNewParticipantNumber("");
                }}
              >
                Cancel
              </button>
              <button style={styles.primaryBtn} onClick={addParticipant}>
                Add to Call
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={styles.phone}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.headerContent}>
            <div style={styles.brandContainer}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
              <span style={styles.brandText}>Orbit Phone</span>
            </div>
            <div style={styles.statusBadge}>
              <div style={styles.statusDot}></div>
              <span style={styles.statusLabel}>
                {isConference ? "Conference" : "Online"}
              </span>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div style={styles.content}>
          {/* Incoming Call */}
          {incoming && (
            <div style={styles.incomingContainer}>
              <div style={styles.callerInfo}>
                <div style={styles.avatarRing}>
                  <div style={styles.avatar}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                  </div>
                </div>
                <div style={styles.callerDetails}>
                  <div style={styles.callerLabel}>
                    {isConference ? "Conference Call" : "Incoming Call"}
                  </div>
                  <div style={styles.callerNumber}>{formatPhoneNumber(phoneNumber)}</div>
                </div>
              </div>

              <div style={styles.incomingActions}>
                <button style={styles.rejectBtn} onClick={reject}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                  Decline
                </button>
                <button style={styles.acceptBtn} onClick={accept}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                  Accept
                </button>
              </div>
            </div>
          )}

          {/* Active Call */}
          {inCall && !incoming && (
            <div style={styles.activeCallContainer}>
              <div style={styles.activeCallInfo}>
                <div style={styles.activeAvatar}>
                  {isConference ? (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <path d="M17 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M9 21v-2a4 4 0 0 1 3-3.87"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <circle cx="17" cy="7" r="4"></circle>
                    </svg>
                  ) : (
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                      <circle cx="12" cy="7" r="4"></circle>
                    </svg>
                  )}
                </div>
                <div style={styles.activeCallDetails}>
                  <div style={styles.activeNumber}>
                    {isConference
                      ? `Conference (${participants.length + 1} participants)`
                      : formatPhoneNumber(phoneNumber)}
                  </div>
                  <div style={styles.activeStatus}>{status}</div>
                  <div style={styles.activeDuration}>{formatDuration(callDuration)}</div>
                </div>

                {/* Participants List */}
                {isConference && participants.length > 0 && (
                  <div style={styles.participantsList}>
                    {participants.map((participant, index) => (
                      <div key={index} style={styles.participantItem}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2">
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                          <circle cx="12" cy="7" r="4"></circle>
                        </svg>
                        <span style={styles.participantNumber}>
                          {formatPhoneNumber(participant.number)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div style={styles.callControls}>
                <button
                  style={{
                    ...styles.controlBtn,
                    ...(micMuted ? styles.controlBtnActive : {}),
                  }}
                  onClick={toggleMic}
                >
                  <div style={styles.controlIconContainer}>
                    {micMuted ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="1" y1="1" x2="23" y2="23"></line>
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path>
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="23"></line>
                        <line x1="8" y1="23" x2="16" y2="23"></line>
                      </svg>
                    )}
                  </div>
                  <span style={styles.controlLabel}>{micMuted ? "Unmute" : "Mute"}</span>
                </button>

                <button style={styles.hangupBtn} onClick={hangup}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                </button>

                <button
                  style={styles.controlBtn}
                  onClick={() => {
                    console.log("Conference button clicked");
                    console.log("isConference:", isConference);
                    console.log("conferenceName:", conferenceName);
                    
                    if (isConference) {
                      console.log("Opening add participant modal");
                      setShowAddParticipant(true);
                    } else {
                      console.log("Starting conference");
                      startConference();
                    }
                  }}
                >
                  <div style={styles.controlIconContainer}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                      <circle cx="8.5" cy="7" r="4"></circle>
                      <line x1="20" y1="8" x2="20" y2="14"></line>
                      <line x1="23" y1="11" x2="17" y2="11"></line>
                    </svg>
                  </div>
                  <span style={styles.controlLabel}>
                    {isConference ? "Add" : "Conf"}
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* Idle State */}
          {!inCall && !incoming && (
            <div style={styles.idleContainer}>
              <div style={styles.idleIcon}>
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <div style={styles.idleTitle}>Ready for Calls</div>
              <div style={styles.idleText}>{status}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Screen component
const Screen = ({ children }) => (
  <div style={styles.page}>
    <div style={styles.phone}>{children}</div>
  </div>
);

const styles = {
  page: {
    minHeight: "100vh",
    width: "100vw",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
    padding: "20px",
  },
  phone: {
    width: 420,
    maxWidth: "100%",
    background: "#ffffff",
    borderRadius: 32,
    boxShadow: "0 25px 80px rgba(0,0,0,0.25), 0 10px 40px rgba(0,0,0,0.15)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    padding: "20px 24px",
  },
  headerContent: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandContainer: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  brandText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: 600,
    letterSpacing: "-0.2px",
  },
  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "rgba(255,255,255,0.2)",
    padding: "6px 12px",
    borderRadius: 20,
    backdropFilter: "blur(10px)",
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#4ade80",
    boxShadow: "0 0 8px #4ade80",
  },
  statusLabel: {
    color: "#fff",
    fontSize: 12,
    fontWeight: 500,
  },
  content: {
    minHeight: 500,
    display: "flex",
    flexDirection: "column",
  },
  centerContent: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 60,
  },
  incomingContainer: {
    padding: "60px 32px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  callerInfo: {
    textAlign: "center",
    marginBottom: 48,
  },
  avatarRing: {
    width: 120,
    height: 120,
    borderRadius: "50%",
    background: "linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 24px",
    animation: "pulse 2s ease-in-out infinite",
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  callerDetails: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  callerLabel: {
    fontSize: 14,
    fontWeight: 500,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
  },
  callerNumber: {
    fontSize: 28,
    fontWeight: 600,
    color: "#1e293b",
    letterSpacing: "-0.5px",
  },
  incomingActions: {
    display: "flex",
    gap: 20,
    width: "100%",
    maxWidth: 340,
  },
  acceptBtn: {
    flex: 1,
    padding: "18px 24px",
    background: "#10b981",
    color: "#fff",
    border: "none",
    borderRadius: 16,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    boxShadow: "0 8px 20px rgba(16, 185, 129, 0.3)",
    transition: "all 0.2s ease",
  },
  rejectBtn: {
    flex: 1,
    padding: "18px 24px",
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: 16,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    boxShadow: "0 8px 20px rgba(239, 68, 68, 0.3)",
    transition: "all 0.2s ease",
  },
  activeCallContainer: {
    padding: "48px 32px",
    display: "flex",
    flexDirection: "column",
    flex: 1,
    justifyContent: "space-between",
  },
  activeCallInfo: {
    textAlign: "center",
    marginBottom: 40,
  },
  activeAvatar: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 20px",
    boxShadow: "0 10px 30px rgba(102, 126, 234, 0.3)",
  },
  activeCallDetails: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  activeNumber: {
    fontSize: 24,
    fontWeight: 600,
    color: "#1e293b",
    letterSpacing: "-0.3px",
  },
  activeStatus: {
    fontSize: 14,
    color: "#64748b",
    fontWeight: 500,
  },
  activeDuration: {
    fontSize: 18,
    fontWeight: 600,
    color: "#667eea",
    marginTop: 4,
  },
  participantsList: {
    marginTop: 24,
    padding: "16px",
    background: "#f8fafc",
    borderRadius: 12,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    maxHeight: 120,
    overflowY: "auto",
  },
  participantItem: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 14,
    color: "#475569",
  },
  participantNumber: {
    fontWeight: 500,
  },
  callControls: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
  },
  controlBtn: {
    width: 80,
    padding: "20px 12px",
    background: "#f1f5f9",
    border: "none",
    borderRadius: 20,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 10,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  controlBtnActive: {
    background: "#667eea",
    color: "#fff",
  },
  controlIconContainer: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "rgba(255,255,255,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  controlLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: "#475569",
  },
  hangupBtn: {
    width: 80,
    height: 80,
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: "50%",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 10px 25px rgba(239, 68, 68, 0.4)",
    transition: "all 0.2s ease",
  },
  idleContainer: {
    padding: "80px 32px",
    textAlign: "center",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  idleIcon: {
    marginBottom: 24,
    opacity: 0.6,
  },
  idleTitle: {
    fontSize: 24,
    fontWeight: 600,
    color: "#1e293b",
    marginBottom: 12,
    letterSpacing: "-0.3px",
  },
  idleText: {
    fontSize: 15,
    color: "#64748b",
    fontWeight: 500,
  },
  loader: {
    width: 56,
    height: 56,
    border: "4px solid #e2e8f0",
    borderTop: "4px solid #667eea",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    marginBottom: 24,
  },
  statusText: {
    fontSize: 16,
    color: "#64748b",
    fontWeight: 500,
  },
  errorIcon: {
    marginBottom: 24,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: "#1e293b",
    marginBottom: 8,
  },
  errorText: {
    fontSize: 15,
    color: "#64748b",
  },
  modal: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(8px)",
  },
  modalCard: {
    background: "#fff",
    padding: "48px 40px",
    borderRadius: 24,
    textAlign: "center",
    maxWidth: 360,
    margin: "0 20px",
    boxShadow: "0 25px 80px rgba(0,0,0,0.3)",
  },
  modalIcon: {
    marginBottom: 24,
    display: "flex",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 600,
    marginBottom: 12,
    color: "#1e293b",
    letterSpacing: "-0.3px",
  },
  modalText: {
    fontSize: 15,
    color: "#64748b",
    marginBottom: 32,
    lineHeight: 1.6,
  },
  input: {
    width: "100%",
    padding: "14px 16px",
    border: "2px solid #e2e8f0",
    borderRadius: 12,
    fontSize: 16,
    marginBottom: 24,
    outline: "none",
    transition: "border-color 0.2s ease",
  },
  modalActions: {
    display: "flex",
    gap: 12,
  },
  primaryBtn: {
    flex: 1,
    padding: "16px 24px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 16,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
    boxShadow: "0 8px 20px rgba(102, 126, 234, 0.3)",
  },
  secondaryBtn: {
    flex: 1,
    padding: "16px 24px",
    background: "#f1f5f9",
    color: "#475569",
    border: "none",
    borderRadius: 16,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
};

// Add CSS animations
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  
  @keyframes pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.05); opacity: 0.8; }
  }
  
  button:hover {
    transform: translateY(-2px);
    filter: brightness(1.05);
  }
  
  button:active {
    transform: translateY(0);
  }
  
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  input:focus {
    border-color: #667eea;
  }
`;
document.head.appendChild(styleSheet);