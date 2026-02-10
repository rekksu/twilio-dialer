import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function InboundPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // ✅ Read agentId from URL
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId"); // ?agentId=XXXX

  // ================= ENABLE AUDIO & INIT DEVICE =================
  const enableAudio = async () => {
    if (!agentId) {
      setStatus("❌ No agentId provided in URL");
      return;
    }

    setAudioEnabled(true);

    // Get microphone permission
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    // Fetch token for this agent
    const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
    const { token } = await res.json();

    // Initialize Twilio Device
    const device = new Device(token, { enableRingingState: true, closeProtection: true });
    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    // Listen for incoming calls
    device.on("incoming", (call) => {
      callRef.current = call;
      setIncoming(true);
      setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);

      // Listen for disconnect / error
      call.on("disconnect", () => {
        setIncoming(false);
        setInCall(false);
        setStatus("✅ Ready");
      });
      call.on("error", (err) => console.error(err));
    });

    await device.register();
    setStatus("✅ Ready (standby for incoming calls)");
  };

  // ================= CALL HANDLERS =================
  const accept = () => {
    callRef.current?.accept();
    setIncoming(false);
    setInCall(true);
    setStatus("✅ Connected");
  };

  const reject = () => {
    callRef.current?.reject();
    setIncoming(false);
    setInCall(false);
    setStatus("❌ Call rejected");
  };

  const hangup = () => {
    callRef.current?.disconnect();
  };

  // ================= UI =================
  return (
    <div style={ui.page}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h3>Enable Audio</h3>
            <p>Allow microphone access to receive calls.</p>
            <button style={ui.primary} onClick={enableAudio}>
              Enable
            </button>
          </div>
        </div>
      )}

      <div style={ui.phone}>
        <h2>📞 Orbit Virtual Phone</h2>
        <div style={ui.status}>{status}</div>

        {incoming && (
          <div style={ui.row}>
            <button style={ui.accept} onClick={accept}>
              Accept
            </button>
            <button style={ui.reject} onClick={reject}>
              Reject
            </button>
          </div>
        )}

        {inCall && (
          <div style={ui.row}>
            <button style={ui.reject} onClick={hangup}>
              Hang Up
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ================= STYLES ================= */
const ui = {
  page: {
    height: "100vh",
    width: "100vw",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#eef1f5",
  },
  phone: {
    minWidth: 360,
    maxWidth: "90%",
    background: "#fff",
    padding: 24,
    borderRadius: 18,
    boxShadow: "0 12px 32px rgba(0,0,0,.2)",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
  },
  status: { margin: "10px 0", fontWeight: "bold" },
  row: { display: "flex", gap: 12, justifyContent: "center", width: "100%" },
  modal: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  modalCard: { background: "#fff", padding: 30, borderRadius: 14, textAlign: "center" },
  primary: { padding: "10px 20px", background: "#1976d2", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  accept: { background: "#2e7d32", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
  reject: { background: "#d32f2f", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
};
