import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

// URLs for your backend Cloud Functions
const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

export default function OrbitPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [callerNumber, setCallerNumber] = useState("");

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

        // Audio element for incoming audio
        audioRef.current = new Audio();
        audioRef.current.autoplay = true;

        // Get Twilio token
        const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
        const { token } = await res.json();

        // Initialize Twilio Device
        const device = new Device(token, {
          enableRingingState: true,
          closeProtection: true,
        });
        deviceRef.current = device;
        device.audio.incoming(audioRef.current);

        // Incoming calls
        device.on("incoming", (call) => {
          callRef.current = call;
          setIncoming(true);
          setCallerNumber(call.parameters.From || "Unknown");
          setStatus("Incoming call...");

          call.on("accept", () => {
            setIncoming(false);
            setInCall(true);
            setStatus("Connected");
          });

          call.on("disconnect", () => {
            setIncoming(false);
            setInCall(false);
            setMicMuted(false);
            callRef.current = null;
            setStatus("Ready");
            setCallerNumber("");
          });

          call.on("error", (err) => {
            setStatus(`Error: ${err.message}`);
          });
        });

        // Register device
        await device.register();
        setStatus("Ready");

        // Auto outbound call
        if (isOutbound) {
          setCallerNumber(toNumber);
          setTimeout(() => makeOutbound(), 200);
        } else {
          setAudioEnabled(false);
        }
      } catch (err) {
        setStatus(`Setup failed: ${err.message}`);
      }
    };

    initDevice();
  }, [agentId, isOutbound]);

  // --- Outbound call
  const makeOutbound = async () => {
    if (!deviceRef.current) {
      setStatus("Device not ready");
      return;
    }

    setStatus(`Calling ${toNumber}...`);

    try {
      const call = await deviceRef.current.connect({
        params: { To: toNumber, From: fromNumber },
      });

      callRef.current = call;
      setInCall(true);

      call.on("accept", () => {
        setStatus("Connected");
      });

      call.on("disconnect", () => {
        setInCall(false);
        setMicMuted(false);
        callRef.current = null;
        setStatus("Call ended");
        setCallerNumber("");
        if (isOutbound) setTimeout(() => window.close(), 1000);
      });

      call.on("error", (err) => {
        setStatus(`Call failed: ${err.message}`);
        setInCall(false);
      });
    } catch (err) {
      setStatus(`Connection failed: ${err.message}`);
      setInCall(false);
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
    setIncoming(false);
    setInCall(false);
    setStatus("Call rejected");
    setCallerNumber("");
  };

  const hangup = () => {
    if (!callRef.current) return;
    callRef.current.disconnect();
    setInCall(false);
    setMicMuted(false);
  };

  const toggleMic = () => {
    if (!callRef.current) return;
    callRef.current.mute(!micMuted);
    setMicMuted(!micMuted);
  };

  if (!authChecked)
    return (
      <Screen>
        <div style={styles.loader}></div>
        <p style={styles.statusText}>Verifying access...</p>
      </Screen>
    );

  if (!authorized)
    return (
      <Screen>
        <div style={styles.errorIcon}>🚫</div>
        <p style={styles.statusText}>Unauthorized Access</p>
      </Screen>
    );

  return (
    <div style={styles.page}>
      {!audioEnabled && !isOutbound && (
        <div style={styles.modal}>
          <div style={styles.modalCard}>
            <div style={styles.micIcon}>🎤</div>
            <h3 style={styles.modalTitle}>Enable Microphone</h3>
            <p style={styles.modalText}>
              Allow microphone access to make and receive calls.
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
          <div style={styles.statusDot}></div>
          <span style={styles.headerText}>Orbit Phone</span>
        </div>

        {/* Display Area */}
        <div style={styles.display}>
          <div style={styles.numberDisplay}>
            {callerNumber || (isOutbound ? toNumber : "Ready")}
          </div>
          <div style={styles.statusDisplay}>{status}</div>
          {inCall && <div style={styles.duration}>{formatDuration(callDuration)}</div>}
        </div>

        {/* Incoming Call */}
        {incoming && (
          <div style={styles.incomingContainer}>
            <div style={styles.callerInfo}>
              <div style={styles.avatar}>📞</div>
              <div style={styles.callerName}>Incoming Call</div>
              <div style={styles.callerNumber}>{callerNumber}</div>
            </div>
            <div style={styles.actionRow}>
              <button style={styles.rejectBtn} onClick={reject}>
                <span style={styles.btnIcon}>✕</span>
                <span>Decline</span>
              </button>
              <button style={styles.acceptBtn} onClick={accept}>
                <span style={styles.btnIcon}>✓</span>
                <span>Accept</span>
              </button>
            </div>
          </div>
        )}

        {/* In Call Controls */}
        {inCall && !incoming && (
          <div style={styles.callControls}>
            <div style={styles.controlsGrid}>
              <button
                style={{
                  ...styles.controlBtn,
                  ...(micMuted ? styles.controlBtnActive : {}),
                }}
                onClick={toggleMic}
              >
                <span style={styles.controlIcon}>{micMuted ? "🔇" : "🎤"}</span>
                <span style={styles.controlLabel}>
                  {micMuted ? "Unmute" : "Mute"}
                </span>
              </button>
              <button style={styles.controlBtn}>
                <span style={styles.controlIcon}>🔊</span>
                <span style={styles.controlLabel}>Speaker</span>
              </button>
              <button style={styles.controlBtn}>
                <span style={styles.controlIcon}>⏸</span>
                <span style={styles.controlLabel}>Hold</span>
              </button>
            </div>
            <button style={styles.hangupBtn} onClick={hangup}>
              <span style={styles.hangupIcon}>✕</span>
              <span style={styles.hangupText}>End Call</span>
            </button>
          </div>
        )}

        {/* Idle State (not in call, no incoming) */}
        {!inCall && !incoming && (
          <div style={styles.idleContainer}>
            <div style={styles.idleIcon}>📞</div>
            <div style={styles.idleText}>
              {isOutbound ? "Preparing call..." : "Waiting for calls..."}
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
    height: "100vh",
    width: "100vw",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  },
  phone: {
    width: 380,
    maxWidth: "95%",
    background: "#ffffff",
    borderRadius: 24,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    padding: "16px 20px",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: "#4ade80",
    boxShadow: "0 0 8px #4ade80",
  },
  headerText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: 600,
  },
  display: {
    padding: "32px 20px",
    background: "#f8fafc",
    textAlign: "center",
    minHeight: 120,
  },
  numberDisplay: {
    fontSize: 28,
    fontWeight: 500,
    color: "#1e293b",
    marginBottom: 8,
    minHeight: 36,
    letterSpacing: 0.5,
  },
  statusDisplay: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 4,
  },
  duration: {
    fontSize: 18,
    fontWeight: 600,
    color: "#667eea",
    marginTop: 12,
  },
  incomingContainer: {
    padding: "40px 20px",
    background: "#fff",
  },
  callerInfo: {
    textAlign: "center",
    marginBottom: 40,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: "50%",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 36,
    margin: "0 auto 16px",
    boxShadow: "0 8px 16px rgba(102, 126, 234, 0.3)",
  },
  callerName: {
    fontSize: 20,
    fontWeight: 600,
    color: "#1e293b",
    marginBottom: 8,
  },
  callerNumber: {
    fontSize: 16,
    color: "#64748b",
  },
  actionRow: {
    display: "flex",
    gap: 16,
    justifyContent: "center",
  },
  acceptBtn: {
    flex: 1,
    maxWidth: 140,
    padding: "16px 24px",
    background: "#10b981",
    color: "#fff",
    border: "none",
    borderRadius: 50,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.3)",
    transition: "all 0.2s",
  },
  rejectBtn: {
    flex: 1,
    maxWidth: 140,
    padding: "16px 24px",
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: 50,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)",
    transition: "all 0.2s",
  },
  btnIcon: {
    fontSize: 20,
  },
  callControls: {
    padding: "32px 20px 40px",
    background: "#fff",
  },
  controlsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: 12,
    marginBottom: 24,
  },
  controlBtn: {
    padding: "20px 8px",
    background: "#f1f5f9",
    border: "none",
    borderRadius: 16,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  controlBtnActive: {
    background: "#667eea",
  },
  controlIcon: {
    fontSize: 28,
  },
  controlLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: "#64748b",
  },
  hangupBtn: {
    width: "100%",
    padding: 18,
    background: "#ef4444",
    color: "#fff",
    border: "none",
    borderRadius: 50,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    boxShadow: "0 4px 12px rgba(239, 68, 68, 0.3)",
  },
  hangupIcon: {
    fontSize: 20,
  },
  hangupText: {
    fontSize: 16,
  },
  idleContainer: {
    padding: "60px 20px",
    textAlign: "center",
    background: "#fff",
  },
  idleIcon: {
    fontSize: 64,
    marginBottom: 16,
    opacity: 0.3,
  },
  idleText: {
    fontSize: 16,
    color: "#94a3b8",
    fontWeight: 500,
  },
  modal: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.6)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
    backdropFilter: "blur(4px)",
  },
  modalCard: {
    background: "#fff",
    padding: 40,
    borderRadius: 20,
    textAlign: "center",
    maxWidth: 320,
    boxShadow: "0 20px 60px rgba(0,0,0,0.3)",
  },
  micIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 600,
    marginBottom: 12,
    color: "#1e293b",
  },
  modalText: {
    fontSize: 14,
    color: "#64748b",
    marginBottom: 24,
    lineHeight: 1.5,
  },
  primaryBtn: {
    width: "100%",
    padding: "14px 24px",
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
    color: "#fff",
    border: "none",
    borderRadius: 12,
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  loader: {
    width: 48,
    height: 48,
    border: "4px solid #e2e8f0",
    borderTop: "4px solid #667eea",
    borderRadius: "50%",
    animation: "spin 1s linear infinite",
    marginBottom: 16,
  },
  statusText: {
    fontSize: 16,
    color: "#64748b",
    textAlign: "center",
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 16,
  },
};

// Add CSS animation
const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  button:hover {
    transform: translateY(-2px);
  }
  button:active {
    transform: translateY(0);
  }
`;
document.head.appendChild(styleSheet);
