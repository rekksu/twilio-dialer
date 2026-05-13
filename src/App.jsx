import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

// URLs for your backend Cloud Functions
const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

const ASSIGNED_NUMBERS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getAgentNumbers";

// How many ms before token expiry to refresh (5 minutes)
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
// Default token lifetime (1 hour) — override if your backend uses a different TTL
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;

export default function OrbitPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const holdMusicRef = useRef(null);
  const tokenRefreshTimerRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [onHold, setOnHold] = useState(false);
  const [showKeypad, setShowKeypad] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [calledToNumber, setCalledToNumber] = useState(""); // ← NEW: the "To" number
  const [callDuration, setCallDuration] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [assignedNumbers, setAssignedNumbers] = useState([]);

  // --- URL params
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const accessKey = params.get("accessKey");
  const fromNumber = params.get("from");
  const toNumber = params.get("to");
  const orgId = params.get("orgId");

  const isOutbound = !!(fromNumber && toNumber);

  // Initialize hold music audio element
  useEffect(() => {
    holdMusicRef.current = new Audio(
      "https://www.twilio.com/docs/voice/twiml/play/hold-music.mp3"
    );
    holdMusicRef.current.loop = true;
    holdMusicRef.current.volume = 0.3;

    return () => {
      if (holdMusicRef.current) {
        holdMusicRef.current.pause();
        holdMusicRef.current = null;
      }
    };
  }, []);

  // Call duration timer
  useEffect(() => {
    let interval;
    if (inCall && !onHold) {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [inCall, onHold]);

  // Format call duration
  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  // DTMF function to send digits
  const sendDTMF = (digit) => {
    if (callRef.current) {
      callRef.current.sendDigits(digit);
      console.log("📞 Sent DTMF:", digit);
    }
  };

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

  // fetch assigned phone numbers for this agent
  useEffect(() => {
    if (!agentId || !orgId) return;
    const fetchNumbers = async () => {
      try {
        const res = await fetch(
          `${ASSIGNED_NUMBERS_URL}?agentId=${encodeURIComponent(agentId)}&orgId=${encodeURIComponent(orgId)}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.numbers)) {
          setAssignedNumbers(data.numbers);
        }
      } catch (err) {
        console.warn("Could not fetch assigned numbers:", err);
      }
    };
    fetchNumbers();
  }, [agentId, orgId]);

  // token refresh helper
  const scheduleTokenRefresh = (ttlMs = DEFAULT_TOKEN_TTL_MS) => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
    }
    const delay = Math.max(ttlMs - REFRESH_BEFORE_EXPIRY_MS, 30_000);
    console.log(`🔄 Token refresh scheduled in ${Math.round(delay / 60000)} min`);
    tokenRefreshTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${TOKEN_URL}?identity=${agentId}&orgId=${orgId}`
        );
        const data = await res.json();
        if (data.token && deviceRef.current) {
          deviceRef.current.updateToken(data.token);
          console.log("✅ Twilio token refreshed — session extended");
          const nextTtl = data.ttl ? data.ttl * 1000 : DEFAULT_TOKEN_TTL_MS;
          scheduleTokenRefresh(nextTtl);
        }
      } catch (err) {
        console.error("❌ Token refresh failed:", err);
        scheduleTokenRefresh(60_000 + REFRESH_BEFORE_EXPIRY_MS);
      }
    }, delay);
  };

  // Helper to reset all call state
  const resetCallState = () => {
    setIncoming(false);
    setInCall(false);
    setMicMuted(false);
    setOnHold(false);
    setShowKeypad(false);
    setIsRecording(false);
    setPhoneNumber("");
    setCalledToNumber(""); // ← clear the "To" number too
    setCallDuration(0);
    callRef.current = null;
    if (holdMusicRef.current) {
      holdMusicRef.current.pause();
      holdMusicRef.current.currentTime = 0;
    }
  };

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
        const res = await fetch(
          `${TOKEN_URL}?identity=${agentId}&orgId=${orgId}`
        );
        const data = await res.json();

        if (!data.token) {
          throw new Error(data.error || "Failed to get token");
        }

        // Initialize Twilio Device
        const device = new Device(data.token, {
          enableRingingState: true,
          closeProtection: true,
        });
        deviceRef.current = device;

        // Incoming calls
        device.on("incoming", (call) => {
          console.log("📞 Incoming call received:", call.parameters);
          callRef.current = call;
          setIncoming(true);
          setPhoneNumber(call.parameters.From || "Unknown");

          // ── Resolve which number this call came in on ─────────────────
          // CalledNumber is passed as a custom <Parameter> from inboundCall.js
          // so it is always the real E.164 Twilio number (e.g. +18582983966).
          // We fall back to To/Called in case of older TwiML without the param.
          const calledParam = call.parameters.CalledNumber || "";
          const rawTo = call.parameters.To || "";
          const rawCalled = call.parameters.Called || "";
          const phoneRegex = /^\+?[1-9]\d{6,14}$/;

          let resolvedTo = "";
          if (phoneRegex.test(calledParam.replace(/\s/g, ""))) {
            resolvedTo = calledParam;
          } else if (phoneRegex.test(rawTo.replace(/\s/g, ""))) {
            resolvedTo = rawTo;
          } else if (phoneRegex.test(rawCalled.replace(/\s/g, ""))) {
            resolvedTo = rawCalled;
          }

          setCalledToNumber(resolvedTo);
          console.log("📞 Called number resolved:", resolvedTo || "unknown");
          // ──────────────────────────────────────────────────────────────

          setStatus("Incoming call...");

          call.on("accept", () => {
            console.log("✅ Call accepted");
            setIncoming(false);
            setInCall(true);
            setStatus("Connected");
          });

          call.on("disconnect", () => {
            console.log("📴 Call disconnected");
            resetCallState();
            setStatus("Call ended");
            setTimeout(() => setStatus("Ready"), 2000);
          });

          call.on("cancel", () => {
            console.log("❌ Call cancelled by caller");
            resetCallState();
            setStatus("Missed call");
            setTimeout(() => setStatus("Ready"), 2000);
          });

          call.on("reject", () => {
            console.log("🚫 Call rejected");
            resetCallState();
            setStatus("Call rejected");
            setTimeout(() => setStatus("Ready"), 2000);
          });

          call.on("error", (err) => {
            console.error("⚠️ Call error:", err);
            setStatus(`Error: ${err.message}`);
            resetCallState();
            setTimeout(() => setStatus("Ready"), 2000);
          });
        });

        // Register device
        await device.register();
        setStatus("Ready");

        // Start the token refresh cycle
        const initialTtl = data.ttl ? data.ttl * 1000 : DEFAULT_TOKEN_TTL_MS;
        scheduleTokenRefresh(initialTtl);

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

    return () => {
      if (tokenRefreshTimerRef.current) {
        clearTimeout(tokenRefreshTimerRef.current);
      }
    };
  }, [agentId, isOutbound]);

  // --- Outbound call
  const makeOutbound = async (number = phoneNumber) => {
    if (!deviceRef.current) {
      setStatus("Device not ready");
      return;
    }

    if (!number) {
      setStatus("Enter a number");
      return;
    }

    setStatus(`Calling ${number}...`);

    try {
      const call = await deviceRef.current.connect({
        params: { To: number, From: fromNumber || "+1234567890" },
      });

      callRef.current = call;
      setInCall(true);

      call.on("ringing", () => {
        console.log("📞 Ringing...");
        setStatus("Ringing...");
      });

      call.on("accept", () => {
        console.log("✅ Call connected");
        setStatus("Connected");
      });

      call.on("disconnect", () => {
        console.log("📴 Call ended");
        resetCallState();
        setStatus("Call ended");
        if (isOutbound) setTimeout(() => window.close(), 1000);
      });

      call.on("error", (err) => {
        console.error("⚠️ Call error:", err);
        setStatus(`Call failed: ${err.message}`);
        resetCallState();
      });
    } catch (err) {
      setStatus(`Connection failed: ${err.message}`);
      resetCallState();
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

  const toggleHold = () => {
    if (!callRef.current) return;
    const newHoldState = !onHold;
    setOnHold(newHoldState);

    if (newHoldState) {
      callRef.current.mute(true);
      setMicMuted(true);
      try {
        callRef.current.sendDigits("*");
      } catch (err) {
        console.log("Could not send hold signal:", err);
      }
      if (holdMusicRef.current) {
        holdMusicRef.current.play().catch((err) => {
          console.error("Could not play hold music:", err);
        });
      }
      setStatus("On Hold");
    } else {
      callRef.current.mute(false);
      setMicMuted(false);
      if (holdMusicRef.current) {
        holdMusicRef.current.pause();
        holdMusicRef.current.currentTime = 0;
      }
      setStatus("Connected");
    }
  };

  const toggleKeypad = () => setShowKeypad(!showKeypad);

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
      {/* Audio Enable Modal - Only for inbound mode */}
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
              <span style={styles.statusLabel}>Online</span>
            </div>
          </div>

          {/* Assigned Numbers Strip */}
          {assignedNumbers.length > 0 && (
            <div style={styles.assignedNumbersBar}>
              <span style={styles.assignedLabel}>Receiving calls on:</span>
              <div style={styles.numberPills}>
                {assignedNumbers.map((num) => (
                  <span key={num} style={styles.numberPill}>
                    {formatPhoneNumber(num)}
                  </span>
                ))}
              </div>
            </div>
          )}
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
                  <div style={styles.callerLabel}>Incoming Call</div>
                  <div style={styles.callerNumber}>
                    {formatPhoneNumber(phoneNumber)}
                  </div>

                  {/* ── Called-To Badge ──────────────────────────────────── */}
                  {calledToNumber && (
                    <div style={styles.calledToBadge}>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{ flexShrink: 0 }}
                      >
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                      <span style={styles.calledToLabel}>To:</span>
                      <span style={styles.calledToNumber}>
                        {formatPhoneNumber(calledToNumber)}
                      </span>
                    </div>
                  )}
                  {/* ──────────────────────────────────────────────────────── */}
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
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </div>
                <div style={styles.activeCallDetails}>
                  <div style={styles.activeNumber}>
                    {formatPhoneNumber(phoneNumber)}
                  </div>
                  <div style={styles.activeStatus}>{status}</div>
                  <div style={styles.activeDuration}>
                    {formatDuration(callDuration)}
                  </div>

                  {/* ── Called-To Badge (also shown during active call) ── */}
                  {calledToNumber && (
                    <div style={{ ...styles.calledToBadge, marginTop: 10, justifyContent: "center" }}>
                      <svg
                        width="13"
                        height="13"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        style={{ flexShrink: 0 }}
                      >
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                      <span style={styles.calledToLabel}>To:</span>
                      <span style={styles.calledToNumber}>
                        {formatPhoneNumber(calledToNumber)}
                      </span>
                    </div>
                  )}
                  {/* ──────────────────────────────────────────────────── */}

                  {isRecording && (
                    <div style={styles.recordingIndicator}>
                      <div style={styles.recordingDot}></div>
                      <span style={styles.recordingText}>Recording</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={styles.callControls}>
                <button
                  style={{
                    ...styles.controlBtn,
                    ...(micMuted && !onHold ? styles.controlBtnActive : {}),
                  }}
                  onClick={toggleMic}
                  disabled={onHold}
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
                  style={{
                    ...styles.controlBtn,
                    ...(onHold ? styles.controlBtnActive : {}),
                  }}
                  onClick={toggleHold}
                >
                  <div style={styles.controlIconContainer}>
                    {onHold ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3"></polygon>
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="6" y="4" width="4" height="16"></rect>
                        <rect x="14" y="4" width="4" height="16"></rect>
                      </svg>
                    )}
                  </div>
                  <span style={styles.controlLabel}>{onHold ? "Resume" : "Hold"}</span>
                </button>
              </div>

              {/* Secondary Controls Row with Keypad */}
              <div style={styles.secondaryControls}>
                <button
                  style={{
                    ...styles.secondaryControlBtn,
                    ...(showKeypad ? styles.secondaryControlBtnActive : {}),
                  }}
                  onClick={toggleKeypad}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"></rect>
                    <rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect>
                    <rect x="14" y="14" width="7" height="7"></rect>
                  </svg>
                  <span style={styles.secondaryControlLabel}>Keypad</span>
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

        {/* DTMF Keypad Modal */}
        {showKeypad && inCall && (
          <div style={styles.keypadModal} onClick={() => setShowKeypad(false)}>
            <div style={styles.keypadContainer} onClick={(e) => e.stopPropagation()}>
              <div style={styles.keypadHeader}>
                <h3 style={styles.keypadTitle}>Dialpad</h3>
                <button style={styles.keypadCloseBtn} onClick={() => setShowKeypad(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000000" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
              <div style={styles.keypadGrid}>
                {[
                  { digit: "1", letters: "" },
                  { digit: "2", letters: "ABC" },
                  { digit: "3", letters: "DEF" },
                  { digit: "4", letters: "GHI" },
                  { digit: "5", letters: "JKL" },
                  { digit: "6", letters: "MNO" },
                  { digit: "7", letters: "PQRS" },
                  { digit: "8", letters: "TUV" },
                  { digit: "9", letters: "WXYZ" },
                  { digit: "*", letters: "" },
                  { digit: "0", letters: "+" },
                  { digit: "#", letters: "" },
                ].map(({ digit, letters }) => (
                  <button key={digit} style={styles.keypadBtn} onClick={() => sendDTMF(digit)}>
                    <span style={styles.keypadDigit}>{digit}</span>
                    {letters && <span style={styles.keypadLetters}>{letters}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
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
    position: "relative",
  },
  header: {
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    padding: "20px 24px 16px",
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
  assignedNumbersBar: {
    marginTop: 12,
    paddingTop: 12,
    borderTop: "1px solid rgba(255,255,255,0.2)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  assignedLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 11,
    fontWeight: 500,
    textTransform: "uppercase",
    letterSpacing: "0.6px",
  },
  numberPills: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  numberPill: {
    background: "rgba(255,255,255,0.18)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    padding: "4px 12px",
    borderRadius: 20,
    letterSpacing: "0.3px",
    border: "1px solid rgba(255,255,255,0.3)",
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
    alignItems: "center",
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

  // ── Called-To badge ────────────────────────────────────────────────────────
  calledToBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    background: "rgba(102, 126, 234, 0.1)",
    border: "1px solid rgba(102, 126, 234, 0.25)",
    borderRadius: 20,
    padding: "5px 12px",
    marginTop: 4,
    color: "#667eea",
  },
  calledToLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: "#667eea",
    textTransform: "uppercase",
    letterSpacing: "0.4px",
  },
  calledToNumber: {
    fontSize: 13,
    fontWeight: 700,
    color: "#4f46e5",
  },
  // ──────────────────────────────────────────────────────────────────────────

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
    padding: "48px 32px 32px",
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
    alignItems: "center",
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
  recordingIndicator: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    padding: "8px 16px",
    background: "rgba(239, 68, 68, 0.1)",
    borderRadius: 20,
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#ef4444",
    animation: "recordingPulse 1.5s ease-in-out infinite",
  },
  recordingText: {
    fontSize: 13,
    fontWeight: 600,
    color: "#ef4444",
  },
  callControls: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 20,
    marginBottom: 20,
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
  secondaryControls: {
    display: "flex",
    justifyContent: "center",
    gap: 12,
  },
  secondaryControlBtn: {
    padding: "12px 20px",
    background: "#f1f5f9",
    border: "none",
    borderRadius: 12,
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  secondaryControlBtnActive: {
    background: "#667eea",
    color: "#fff",
  },
  secondaryControlLabel: {
    fontSize: 14,
    fontWeight: 600,
    color: "#475569",
  },
  keypadModal: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0, 0, 0, 0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    borderRadius: 32,
    backdropFilter: "blur(4px)",
  },
  keypadContainer: {
    background: "#fff",
    borderRadius: 24,
    padding: "24px",
    width: "90%",
    maxWidth: 340,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  keypadHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  keypadTitle: {
    fontSize: 20,
    fontWeight: 600,
    color: "#1e293b",
    margin: 0,
  },
  keypadCloseBtn: {
    width: 36,
    height: 36,
    background: "#f1f5f9",
    border: "none",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.2s ease",
  },
  keypadGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 16,
  },
  keypadBtn: {
    aspectRatio: "1",
    background: "#f1f5f9",
    border: "none",
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.2s ease",
    padding: "20px",
  },
  keypadDigit: {
    fontSize: 28,
    fontWeight: 600,
    color: "#1e293b",
  },
  keypadLetters: {
    fontSize: 11,
    fontWeight: 500,
    color: "#64748b",
    marginTop: 2,
    letterSpacing: "0.5px",
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
  primaryBtn: {
    width: "100%",
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
  
  @keyframes recordingPulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.4; transform: scale(1.2); }
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
`;
document.head.appendChild(styleSheet);