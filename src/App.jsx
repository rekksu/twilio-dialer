import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

export default function OrbitPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);

  const [status, setStatus] = useState("Initializing...");
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // URL params
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

  // --- Initialize Twilio Device
  const enableAudio = async () => {
    if (!agentId) return setStatus("❌ No agentId provided");

    setAudioEnabled(true);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
    const { token } = await res.json();

    const device = new Device(token, { enableRingingState: true });
    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    device.on("incoming", (call) => {
      callRef.current = call;
      setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);
      call.on("accept", () => {
        setInCall(true);
        setStatus("✅ Connected");
      });
      call.on("disconnect", () => {
        setInCall(false);
        setMicMuted(false);
        callRef.current = null;
        setStatus("✅ Ready");
      });
    });

    await device.register();
    setStatus("✅ Ready");

    // --- If outbound, make the call immediately
    if (isOutbound) {
      startOutboundCall();
    }
  };

  const startOutboundCall = () => {
    if (!deviceRef.current || !toNumber) {
      setStatus("❌ Device not ready or missing number");
      return;
    }

    setStatus(`📞 Calling ${toNumber}…`);
    const call = deviceRef.current.connect({
      params: {
        To: toNumber,
        From: fromNumber,
      },
    });

    callRef.current = call;
    setInCall(true);

    call.on("accept", () => setStatus("✅ Connected"));
    call.on("disconnect", () => {
      setInCall(false);
      setMicMuted(false);
      setStatus("📴 Call ended");

      // Close tab after call ends
      setTimeout(() => window.close(), 500);
    });
    call.on("error", (err) => {
      setInCall(false);
      setMicMuted(false);
      setStatus(`❌ Call error: ${err.message}`);
      setTimeout(() => window.close(), 500);
    });
  };

  // --- Controls
  const hangup = () => {
    if (callRef.current) callRef.current.disconnect();
    setInCall(false);
    setMicMuted(false);
  };

  const toggleMic = () => {
    if (!callRef.current) return;
    const next = !micMuted;
    callRef.current.mute(next);
    setMicMuted(next);
  };

  if (!authChecked) return <Screen text="🔐 Verifying access…" />;
  if (!authorized) return <Screen text="🚫 Unauthorized" />;

  return (
    <div style={ui.page}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h3>Enable Audio</h3>
            <p>Allow microphone access to {isOutbound ? "make" : "receive"} calls.</p>
            <button style={ui.primary} onClick={enableAudio}>
              Enable
            </button>
          </div>
        </div>
      )}

      <div style={ui.phone}>
        <h2>📞 Orbit Virtual Phone</h2>
        <div style={ui.badge}>{isOutbound ? "🔵 Outbound" : "🟢 Inbound"}</div>
        <div style={ui.status}>{status}</div>

        {inCall && (
          <div style={ui.row}>
            <button style={micMuted ? ui.reject : ui.accept} onClick={toggleMic}>
              {micMuted ? "Mic Off" : "Mic On"}
            </button>
            <button style={ui.reject} onClick={hangup}>
              Hang Up
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

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
