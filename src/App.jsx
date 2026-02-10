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

  // --- URL params
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const accessKey = params.get("accessKey");
  const fromNumber = params.get("from");
  const toNumber = params.get("to");

  const isOutbound = !!(fromNumber && toNumber);

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
        setStatus("❌ No agentId provided");
        return;
      }

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
      const device = new Device(token, { enableRingingState: true, closeProtection: true });
      deviceRef.current = device;
      device.audio.incoming(audioRef.current);

      // Incoming calls
      device.on("incoming", (call) => {
        callRef.current = call; // inbound call is ready immediately
        setIncoming(true);
        setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);

        call.on("accept", () => {
          setIncoming(false);
          setInCall(true);
          setStatus("✅ Connected");
        });

        call.on("disconnect", () => {
          setIncoming(false);
          setInCall(false);
          setMicMuted(false);
          callRef.current = null;
          setStatus("✅ Ready");
        });

        call.on("error", (err) => {
          setStatus(`❌ Call error: ${err.message}`);
        });
      });

      // Register device
      await device.register();
      setStatus("✅ Ready");

      // Auto outbound call
      if (isOutbound) {
        setTimeout(() => makeOutbound(), 200);
      } else {
        setAudioEnabled(false); // only show enable audio for inbound
      }
    };

    initDevice();
  }, [agentId, isOutbound]);

  // --- Outbound call
  const makeOutbound = () => {
    if (!deviceRef.current) {
      setStatus("❌ Device not ready");
      return;
    }

    setStatus(`📞 Calling ${toNumber}…`);

    const call = deviceRef.current.connect({ params: { To: toNumber, From: fromNumber } });

    // 🔹 Only set callRef.current after call is accepted/connected
    call.on("accept", () => {
      callRef.current = call; // now mic & hangup will work
      setInCall(true);
      setStatus("✅ Connected");
    });

    call.on("disconnect", () => {
      setInCall(false);
      setMicMuted(false);
      callRef.current = null;
      setStatus("✅ Call ended");
      if (isOutbound) setTimeout(() => window.close(), 1000);
    });

    call.on("error", (err) => {
      setStatus(`❌ Call error: ${err.message}`);
    });
  };

  // --- Call controls
  const accept = () => {
    if (!callRef.current) return;
    callRef.current.accept();
    setIncoming(false);
    setInCall(true);
    setStatus("✅ Connected");
  };

  const reject = () => {
    if (!callRef.current) return;
    callRef.current.reject();
    setIncoming(false);
    setInCall(false);
    setStatus("❌ Call rejected");
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

  if (!authChecked) return <Screen text="🔐 Verifying access…" />;
  if (!authorized) return <Screen text="🚫 Unauthorized" />;

  return (
    <div style={ui.page}>
      {!audioEnabled && !isOutbound && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h3>Enable Audio</h3>
            <p>Allow microphone access to receive calls.</p>
            <button style={ui.primary} onClick={() => setAudioEnabled(true)}>
              Enable
            </button>
          </div>
        </div>
      )}

      <div style={ui.phone}>
        <h2>📞 Orbit Virtual Phone</h2>
        <div style={ui.badge}>{isOutbound ? "🔵 Outbound Mode" : "🟢 Inbound Mode"}</div>
        <div style={ui.status}>{status}</div>

        {incoming && (
          <div style={ui.row}>
            <button style={ui.accept} onClick={accept}>Accept</button>
            <button style={ui.reject} onClick={reject}>Reject</button>
          </div>
        )}

        {inCall && (
          <div style={ui.row}>
            <button style={micMuted ? ui.reject : ui.accept} onClick={toggleMic}>
              {micMuted ? "Mic Off" : "Mic On"}
            </button>
            <button style={ui.reject} onClick={hangup}>Hang Up</button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Screen component
const Screen = ({ text }) => (
  <div style={{ ...ui.page, textAlign: "center" }}>
    <div style={ui.phone}>{text}</div>
  </div>
);

const ui = {
  page: { height: "100vh", width: "100vw", display: "flex", justifyContent: "center", alignItems: "center", background: "#eef1f5" },
  phone: { minWidth: 360, maxWidth: "90%", background: "#fff", padding: 24, borderRadius: 18, boxShadow: "0 12px 32px rgba(0,0,0,.2)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  badge: { padding: "6px 12px", borderRadius: 20, fontSize: 12, fontWeight: "bold", background: "#e3f2fd", color: "#1976d2" },
  status: { margin: "10px 0", fontWeight: "bold" },
  row: { display: "flex", gap: 12, justifyContent: "center", width: "100%" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 },
  modalCard: { background: "#fff", padding: 30, borderRadius: 14, textAlign: "center" },
  primary: { padding: "10px 20px", background: "#1976d2", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  accept: { background: "#2e7d32", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
  reject: { background: "#d32f2f", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
};
