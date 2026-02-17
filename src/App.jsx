import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

export default function OrbitPhone() {
  const deviceRef    = useRef(null);
  const callRef      = useRef(null);
  const holdMusicRef = useRef(null);

  const [status, setStatus]             = useState("Initializing…");
  const [incoming, setIncoming]         = useState(false);
  const [inCall, setInCall]             = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted]         = useState(false);
  const [onHold, setOnHold]             = useState(false);
  const [showKeypad, setShowKeypad]     = useState(false);
  const [authorized, setAuthorized]     = useState(false);
  const [authChecked, setAuthChecked]   = useState(false);
  const [phoneNumber, setPhoneNumber]   = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [isRecording, setIsRecording]   = useState(false);

  // --- URL params
  const params     = new URLSearchParams(window.location.search);
  const agentId    = params.get("agentId");
  const accessKey  = params.get("accessKey");
  const fromNumber = params.get("from");
  const toNumber   = params.get("to");

  const isOutbound = !!(fromNumber && toNumber);

  // Hold music
  useEffect(() => {
    holdMusicRef.current = new Audio(
      "https://www.twilio.com/docs/voice/twiml/play/hold-music.mp3"
    );
    holdMusicRef.current.loop   = true;
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
      interval = setInterval(() => setCallDuration((p) => p + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [inCall, onHold]);

  const formatDuration = (s) => {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  };

  const sendDTMF = (digit) => {
    if (callRef.current) {
      callRef.current.sendDigits(digit);
      console.log("📞 DTMF:", digit);
    }
  };

  const resetCallState = () => {
    setIncoming(false);
    setInCall(false);
    setMicMuted(false);
    setOnHold(false);
    setShowKeypad(false);
    setIsRecording(false);
    setCallDuration(0);
    callRef.current = null;
    if (holdMusicRef.current) {
      holdMusicRef.current.pause();
      holdMusicRef.current.currentTime = 0;
    }
  };

  // ✅ Single helper — reads recording from call.customParameters
  // Works for BOTH inbound (set by inboundCall function) and
  // outbound (set by outboundCall function via twiml.parameter)
  const checkRecording = (call) => {
    const rec = call.customParameters?.get("recording");
    if (rec === "true") {
      setIsRecording(true);
      console.log("🔴 Recording active");
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

  // --- Initialize Device
  useEffect(() => {
    const initDevice = async () => {
      if (!agentId) { setStatus("No agent ID provided"); return; }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());

        const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
        const { token } = await res.json();

        const device = new Device(token, {
          enableRingingState: true,
          closeProtection: true,
        });
        deviceRef.current = device;

        // --- Inbound
        device.on("incoming", (call) => {
          console.log("📞 Incoming:", call.parameters);
          callRef.current = call;
          setIncoming(true);
          setPhoneNumber(call.parameters.From || "Unknown");
          setStatus("Incoming call...");

          call.on("accept", () => {
            setIncoming(false);
            setInCall(true);
            setStatus("Connected");
            checkRecording(call); // ✅ reads from customParameters
          });

          call.on("disconnect", () => {
            resetCallState();
            setStatus("Call ended");
            setPhoneNumber("");
            setTimeout(() => setStatus("Ready"), 2000);
          });

          call.on("cancel", () => {
            resetCallState();
            setStatus("Missed call");
            setPhoneNumber("");
            setTimeout(() => setStatus("Ready"), 2000);
          });

          call.on("reject", () => {
            resetCallState();
            setStatus("Call rejected");
            setPhoneNumber("");
            setTimeout(() => setStatus("Ready"), 2000);
          });

          call.on("error", (err) => {
            console.error("⚠️ Call error:", err);
            setStatus(`Error: ${err.message}`);
            resetCallState();
            setPhoneNumber("");
            setTimeout(() => setStatus("Ready"), 2000);
          });
        });

        await device.register();
        setStatus("Ready");

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

  // --- Outbound call
  const makeOutbound = async (number = phoneNumber) => {
    if (!deviceRef.current) { setStatus("Device not ready"); return; }
    if (!number) { setStatus("Enter a number"); return; }

    setStatus(`Calling ${number}...`);

    try {
      const call = await deviceRef.current.connect({
        params: { To: number, From: fromNumber || "+1234567890" },
      });

      callRef.current = call;
      setInCall(true);

      call.on("ringing", () => setStatus("Ringing..."));

      call.on("accept", () => {
        setStatus("Connected");
        checkRecording(call); // ✅ reads from customParameters set by outboundCall function
      });

      call.on("disconnect", () => {
        resetCallState();
        setStatus("Call ended");
        setPhoneNumber("");
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

  // --- Controls
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
    setIncoming(false);
    setInCall(false);
    setStatus("Call rejected");
    setPhoneNumber("");
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
    const newHold = !onHold;
    setOnHold(newHold);
    if (newHold) {
      callRef.current.mute(true);
      setMicMuted(true);
      try { callRef.current.sendDigits("*"); } catch (e) {}
      holdMusicRef.current?.play().catch(() => {});
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

  const formatPhoneNumber = (num) => {
    if (!num) return "";
    const c = num.replace(/\D/g, "");
    if (c.length === 11 && c.startsWith("1"))
      return `+1 (${c.slice(1, 4)}) ${c.slice(4, 7)}-${c.slice(7)}`;
    if (c.length === 10)
      return `(${c.slice(0, 3)}) ${c.slice(3, 6)}-${c.slice(6)}`;
    return num;
  };

  if (!authChecked)
    return (
      <Screen>
        <div style={s.centerContent}>
          <div style={s.loader} />
          <p style={s.statusText}>Verifying access...</p>
        </div>
      </Screen>
    );

  if (!authorized)
    return (
      <Screen>
        <div style={s.centerContent}>
          <div style={s.errorIcon}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          </div>
          <p style={s.errorTitle}>Unauthorized Access</p>
          <p style={s.errorText}>You don't have permission to access this phone.</p>
        </div>
      </Screen>
    );

  return (
    <div style={s.page}>
      {/* Audio modal */}
      {!audioEnabled && !isOutbound && (
        <div style={s.modal}>
          <div style={s.modalCard}>
            <div style={s.modalIcon}>
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#667eea" strokeWidth="2">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </div>
            <h3 style={s.modalTitle}>Enable Audio</h3>
            <p style={s.modalText}>Allow audio access to hear incoming calls and communicate clearly.</p>
            <button style={s.primaryBtn} onClick={() => setAudioEnabled(true)}>Enable Audio</button>
          </div>
        </div>
      )}

      <div style={s.phone}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.headerContent}>
            <div style={s.brandContainer}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              <span style={s.brandText}>Orbit Phone</span>
            </div>
            <div style={s.statusBadge}>
              <div style={s.statusDot} />
              <span style={s.statusLabel}>Online</span>
            </div>
          </div>
        </div>

        <div style={s.content}>
          {/* Incoming */}
          {incoming && (
            <div style={s.incomingContainer}>
              <div style={s.callerInfo}>
                <div style={s.avatarRing}>
                  <div style={s.avatar}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                </div>
                <div style={s.callerDetails}>
                  <div style={s.callerLabel}>Incoming Call</div>
                  <div style={s.callerNumber}>{formatPhoneNumber(phoneNumber)}</div>
                </div>
              </div>
              <div style={s.incomingActions}>
                <button style={s.rejectBtn} onClick={reject}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  Decline
                </button>
                <button style={s.acceptBtn} onClick={accept}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                  Accept
                </button>
              </div>
            </div>
          )}

          {/* Active call */}
          {inCall && !incoming && (
            <div style={s.activeCallContainer}>
              <div style={s.activeCallInfo}>
                <div style={s.activeAvatar}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
                <div style={s.activeCallDetails}>
                  <div style={s.activeNumber}>{formatPhoneNumber(phoneNumber)}</div>
                  <div style={s.activeStatus}>{status}</div>
                  <div style={s.activeDuration}>{formatDuration(callDuration)}</div>
                  {isRecording && (
                    <div style={s.recordingIndicator}>
                      <div style={s.recordingDot} />
                      <span style={s.recordingText}>Recording</span>
                    </div>
                  )}
                </div>
              </div>

              <div style={s.callControls}>
                <button
                  style={{ ...s.controlBtn, ...(micMuted && !onHold ? s.controlBtnActive : {}) }}
                  onClick={toggleMic}
                  disabled={onHold}
                >
                  <div style={s.controlIconContainer}>
                    {micMuted ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="1" y1="1" x2="23" y2="23" />
                        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    )}
                  </div>
                  <span style={s.controlLabel}>{micMuted ? "Unmute" : "Mute"}</span>
                </button>

                <button style={s.hangupBtn} onClick={hangup}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </button>

                <button
                  style={{ ...s.controlBtn, ...(onHold ? s.controlBtnActive : {}) }}
                  onClick={toggleHold}
                >
                  <div style={s.controlIconContainer}>
                    {onHold ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="6" y="4" width="4" height="16" />
                        <rect x="14" y="4" width="4" height="16" />
                      </svg>
                    )}
                  </div>
                  <span style={s.controlLabel}>{onHold ? "Resume" : "Hold"}</span>
                </button>
              </div>

              <div style={s.secondaryControls}>
                <button
                  style={{ ...s.secondaryControlBtn, ...(showKeypad ? s.secondaryControlBtnActive : {}) }}
                  onClick={toggleKeypad}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                  <span style={s.secondaryControlLabel}>Keypad</span>
                </button>
              </div>
            </div>
          )}

          {/* Idle */}
          {!inCall && !incoming && (
            <div style={s.idleContainer}>
              <div style={s.idleIcon}>
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <div style={s.idleTitle}>Ready for Calls</div>
              <div style={s.idleText}>{status}</div>
            </div>
          )}
        </div>

        {/* DTMF Keypad */}
        {showKeypad && inCall && (
          <div style={s.keypadModal} onClick={() => setShowKeypad(false)}>
            <div style={s.keypadContainer} onClick={(e) => e.stopPropagation()}>
              <div style={s.keypadHeader}>
                <h3 style={s.keypadTitle}>Dialpad</h3>
                <button style={s.keypadCloseBtn} onClick={() => setShowKeypad(false)}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1e293b" strokeWidth="2.5">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div style={s.keypadGrid}>
                {[
                  { digit: "1", letters: "" },    { digit: "2", letters: "ABC" },
                  { digit: "3", letters: "DEF" },  { digit: "4", letters: "GHI" },
                  { digit: "5", letters: "JKL" },  { digit: "6", letters: "MNO" },
                  { digit: "7", letters: "PQRS" }, { digit: "8", letters: "TUV" },
                  { digit: "9", letters: "WXYZ" }, { digit: "*", letters: "" },
                  { digit: "0", letters: "+" },    { digit: "#", letters: "" },
                ].map(({ digit, letters }) => (
                  <button key={digit} style={s.keypadBtn} onClick={() => sendDTMF(digit)}>
                    <span style={s.keypadDigit}>{digit}</span>
                    {letters && <span style={s.keypadLetters}>{letters}</span>}
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

const Screen = ({ children }) => (
  <div style={s.page}><div style={s.phone}>{children}</div></div>
);

const s = {
  page: { minHeight: "100vh", width: "100vw", display: "flex", justifyContent: "center", alignItems: "center", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif", padding: "20px" },
  phone: { width: 420, maxWidth: "100%", background: "#ffffff", borderRadius: 32, boxShadow: "0 25px 80px rgba(0,0,0,0.25), 0 10px 40px rgba(0,0,0,0.15)", overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" },
  header: { background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", padding: "20px 24px" },
  headerContent: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  brandContainer: { display: "flex", alignItems: "center", gap: 12 },
  brandText: { color: "#fff", fontSize: 18, fontWeight: 600, letterSpacing: "-0.2px" },
  statusBadge: { display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.2)", padding: "6px 12px", borderRadius: 20, backdropFilter: "blur(10px)" },
  statusDot: { width: 6, height: 6, borderRadius: "50%", background: "#4ade80", boxShadow: "0 0 8px #4ade80" },
  statusLabel: { color: "#fff", fontSize: 12, fontWeight: 500 },
  content: { minHeight: 500, display: "flex", flexDirection: "column" },
  centerContent: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 60 },
  incomingContainer: { padding: "60px 32px", display: "flex", flexDirection: "column", alignItems: "center", flex: 1, justifyContent: "center" },
  callerInfo: { textAlign: "center", marginBottom: 48 },
  avatarRing: { width: 120, height: 120, borderRadius: "50%", background: "linear-gradient(135deg, rgba(102,126,234,0.1) 0%, rgba(118,75,162,0.1) 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 24px", animation: "pulse 2s ease-in-out infinite" },
  avatar: { width: 96, height: 96, borderRadius: "50%", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", display: "flex", alignItems: "center", justifyContent: "center" },
  callerDetails: { display: "flex", flexDirection: "column", gap: 8 },
  callerLabel: { fontSize: 14, fontWeight: 500, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" },
  callerNumber: { fontSize: 28, fontWeight: 600, color: "#1e293b", letterSpacing: "-0.5px" },
  incomingActions: { display: "flex", gap: 20, width: "100%", maxWidth: 340 },
  acceptBtn: { flex: 1, padding: "18px 24px", background: "#10b981", color: "#fff", border: "none", borderRadius: 16, fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 8px 20px rgba(16,185,129,0.3)", transition: "all 0.2s ease" },
  rejectBtn: { flex: 1, padding: "18px 24px", background: "#ef4444", color: "#fff", border: "none", borderRadius: 16, fontSize: 16, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, boxShadow: "0 8px 20px rgba(239,68,68,0.3)", transition: "all 0.2s ease" },
  activeCallContainer: { padding: "48px 32px 32px", display: "flex", flexDirection: "column", flex: 1, justifyContent: "space-between" },
  activeCallInfo: { textAlign: "center", marginBottom: 40 },
  activeAvatar: { width: 80, height: 80, borderRadius: "50%", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", boxShadow: "0 10px 30px rgba(102,126,234,0.3)" },
  activeCallDetails: { display: "flex", flexDirection: "column", alignItems: "center", gap: 8 },
  activeNumber: { fontSize: 24, fontWeight: 600, color: "#1e293b", letterSpacing: "-0.3px" },
  activeStatus: { fontSize: 14, color: "#64748b", fontWeight: 500 },
  activeDuration: { fontSize: 18, fontWeight: 600, color: "#667eea", marginTop: 4 },
  recordingIndicator: { display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, padding: "6px 16px", background: "rgba(239,68,68,0.1)", borderRadius: 20 },
  recordingDot: { width: 8, height: 8, flexShrink: 0, borderRadius: "50%", background: "#ef4444", animation: "recordingPulse 1.5s ease-in-out infinite" },
  recordingText: { fontSize: 13, fontWeight: 600, color: "#ef4444" },
  callControls: { display: "flex", alignItems: "center", justifyContent: "center", gap: 20, marginBottom: 20 },
  controlBtn: { width: 80, padding: "20px 12px", background: "#f1f5f9", border: "none", borderRadius: 20, display: "flex", flexDirection: "column", alignItems: "center", gap: 10, cursor: "pointer", transition: "all 0.2s ease" },
  controlBtnActive: { background: "#667eea", color: "#fff" },
  controlIconContainer: { width: 48, height: 48, borderRadius: "50%", background: "rgba(255,255,255,0.5)", display: "flex", alignItems: "center", justifyContent: "center" },
  controlLabel: { fontSize: 13, fontWeight: 600, color: "#475569" },
  hangupBtn: { width: 80, height: 80, background: "#ef4444", color: "#fff", border: "none", borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 10px 25px rgba(239,68,68,0.4)", transition: "all 0.2s ease" },
  secondaryControls: { display: "flex", justifyContent: "center", gap: 12 },
  secondaryControlBtn: { padding: "12px 20px", background: "#f1f5f9", border: "none", borderRadius: 12, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", transition: "all 0.2s ease" },
  secondaryControlBtnActive: { background: "#667eea", color: "#fff" },
  secondaryControlLabel: { fontSize: 14, fontWeight: 600, color: "#475569" },
  keypadModal: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, borderRadius: 32, backdropFilter: "blur(4px)" },
  keypadContainer: { background: "#fff", borderRadius: 24, padding: "24px", width: "90%", maxWidth: 340, boxShadow: "0 20px 60px rgba(0,0,0,0.3)" },
  keypadHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 },
  keypadTitle: { fontSize: 20, fontWeight: 600, color: "#1e293b", margin: 0 },
  keypadCloseBtn: { width: 36, height: 36, background: "#f1f5f9", border: "none", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s ease" },
  keypadGrid: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
  keypadBtn: { aspectRatio: "1", background: "#f1f5f9", border: "none", borderRadius: 16, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", transition: "all 0.2s ease", padding: "20px" },
  keypadDigit: { fontSize: 28, fontWeight: 600, color: "#1e293b" },
  keypadLetters: { fontSize: 11, fontWeight: 500, color: "#64748b", marginTop: 2, letterSpacing: "0.5px" },
  idleContainer: { padding: "80px 32px", textAlign: "center", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" },
  idleIcon: { marginBottom: 24, opacity: 0.6 },
  idleTitle: { fontSize: 24, fontWeight: 600, color: "#1e293b", marginBottom: 12, letterSpacing: "-0.3px" },
  idleText: { fontSize: 15, color: "#64748b", fontWeight: 500 },
  loader: { width: 56, height: 56, border: "4px solid #e2e8f0", borderTop: "4px solid #667eea", borderRadius: "50%", animation: "spin 1s linear infinite", marginBottom: 24 },
  statusText: { fontSize: 16, color: "#64748b", fontWeight: 500 },
  errorIcon: { marginBottom: 24 },
  errorTitle: { fontSize: 20, fontWeight: 600, color: "#1e293b", marginBottom: 8 },
  errorText: { fontSize: 15, color: "#64748b" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(8px)" },
  modalCard: { background: "#fff", padding: "48px 40px", borderRadius: 24, textAlign: "center", maxWidth: 360, margin: "0 20px", boxShadow: "0 25px 80px rgba(0,0,0,0.3)" },
  modalIcon: { marginBottom: 24, display: "flex", justifyContent: "center" },
  modalTitle: { fontSize: 24, fontWeight: 600, marginBottom: 12, color: "#1e293b", letterSpacing: "-0.3px" },
  modalText: { fontSize: 15, color: "#64748b", marginBottom: 32, lineHeight: 1.6 },
  primaryBtn: { width: "100%", padding: "16px 24px", background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)", color: "#fff", border: "none", borderRadius: 16, fontSize: 16, fontWeight: 600, cursor: "pointer", transition: "all 0.2s ease", boxShadow: "0 8px 20px rgba(102,126,234,0.3)" },
};

const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}
  @keyframes pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.05);opacity:0.8}}
  @keyframes recordingPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.4;transform:scale(1.3)}}
  button:hover{transform:translateY(-2px);filter:brightness(1.05)}
  button:active{transform:translateY(0)}
  button:disabled{opacity:0.5;cursor:not-allowed;transform:none}
`;
document.head.appendChild(styleSheet);