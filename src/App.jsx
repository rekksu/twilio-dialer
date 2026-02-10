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

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // 🔗 URL PARAMS
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const accessKey = params.get("accessKey");
  const toNumber = params.get("to");       // outbound target
  const fromNumber = params.get("from");   // selected Twilio number

  // ================= VERIFY ACCESS =================
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
  }, []);

  // ================= INIT DEVICE =================
  const enableAudio = async () => {
    if (!agentId) return setStatus("❌ No agentId provided");

    setAudioEnabled(true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
    const { token } = await res.json();

    const device = new Device(token, {
      enableRingingState: true,
      closeProtection: true,
    });

    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    // 📞 INBOUND
    device.on("incoming", (call) => {
      callRef.current = call;
      setIncoming(true);
      setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);

      call.on("disconnect", () => reset("✅ Ready"));
      call.on("error", console.error);
    });

    await device.register();
    setStatus("✅ Ready");

    // 🚀 AUTO OUTBOUND
    if (toNumber && fromNumber) {
      setTimeout(startOutbound, 500);
    }
  };

  // ================= OUTBOUND =================
  const startOutbound = async () => {
    if (!deviceRef.current || !toNumber || !fromNumber) return;

    setStatus(`📲 Calling ${toNumber}…`);

    const call = await deviceRef.current.connect({
      params: { To: toNumber, From: fromNumber },
    });

    callRef.current = call;
    setInCall(true);

    call.on("accept", () => setStatus("✅ Connected"));
    call.on("disconnect", () => window.close());
    call.on("error", () => window.close());
  };

  // ================= CONTROLS =================
  const accept = () => {
    callRef.current?.accept();
    setIncoming(false);
    setInCall(true);
    setStatus("✅ Connected");
  };

  const reject = () => {
    callRef.current?.reject();
    reset("❌ Call rejected");
  };

  const hangup = () => callRef.current?.disconnect();

  const toggleMic = () => {
    const next = !micMuted;
    callRef.current?.mute(next);
    setMicMuted(next);
  };

  const reset = (msg) => {
    setIncoming(false);
    setInCall(false);
    setMicMuted(false);
    setStatus(msg);
  };

  if (!authChecked) return <Screen text="🔐 Verifying access…" />;
  if (!authorized) return <Screen text="🚫 Unauthorized" />;

  return (
    <div style={ui.page}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h3>Enable Audio</h3>
            <button style={ui.primary} onClick={enableAudio}>Enable</button>
          </div>
        </div>
      )}

      <div style={ui.phone}>
        <h2>📞 Orbit Virtual Phone</h2>
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

const Screen = ({ text }) => (
  <div style={{ ...ui.page, textAlign: "center" }}>
    <div style={ui.phone}>{text}</div>
  </div>
);

// ================= STYLES =================
const ui = {
  page: { height: "100vh", display: "flex", justifyContent: "center", alignItems: "center", background: "#eef1f5" },
  phone: { minWidth: 360, background: "#fff", padding: 24, borderRadius: 18, boxShadow: "0 12px 32px rgba(0,0,0,.2)", textAlign: "center" },
  status: { margin: "10px 0", fontWeight: "bold" },
  row: { display: "flex", gap: 12, justifyContent: "center" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", justifyContent: "center", alignItems: "center" },
  modalCard: { background: "#fff", padding: 30, borderRadius: 14 },
  primary: { padding: "10px 20px", background: "#1976d2", color: "#fff", borderRadius: 8 },
  accept: { background: "#2e7d32", color: "#fff", padding: 12, borderRadius: 10 },
  reject: { background: "#d32f2f", color: "#fff", padding: 12, borderRadius: 10 },
};
