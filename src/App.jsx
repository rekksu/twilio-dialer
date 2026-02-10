import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

/* ================= CONFIG ================= */
const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

/* ================= DEV PHONE COMPONENT ================= */
export default function DevPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [duration, setDuration] = useState(0);

  const startedAtRef = useRef(null);
  const answeredRef = useRef(false);

  const callDirectionRef = useRef("inbound");

  /* ================= GET AGENT ID FROM URL ================= */
  const agentId = new URLSearchParams(window.location.search).get("agentId");

  /* ================= ENABLE AUDIO & INIT DEVICE ================= */
  const enableAudio = async () => {
    setAudioEnabled(true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    // Fetch Twilio token for dynamic agent
    const tokenRes = await fetch(`${TOKEN_URL}?identity=${encodeURIComponent(agentId)}`);
    const { token } = await tokenRes.json();

    const device = new Device(token, { enableRingingState: true, closeProtection: true });
    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    device.on("incoming", (call) => {
      callRef.current = call;
      answeredRef.current = false;
      setIncoming(true);
      setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);

      call.on("disconnect", cleanup);
      call.on("error", cleanup);
    });

    await device.register();
    setStatus("✅ Ready for incoming calls");
  };

  /* ================= CALL HANDLERS ================= */
  const onConnected = () => {
    startedAtRef.current = Date.now();
    answeredRef.current = true;
    setIncoming(false);
    setInCall(true);
    setStatus("✅ Connected");
  };

  const cleanup = () => {
    startedAtRef.current = null;
    setIncoming(false);
    setInCall(false);
    setMicMuted(false);
    setStatus("✅ Ready for incoming calls");
  };

  const accept = () => { callRef.current?.accept(); onConnected(); };
  const reject = () => { callRef.current?.reject(); answeredRef.current = false; cleanup(); };
  const hangup = () => callRef.current?.disconnect();
  const toggleMic = () => { const next = !micMuted; callRef.current?.mute(next); setMicMuted(next); };

  /* ================= TIMER ================= */
  useEffect(() => {
    let t;
    if (inCall && startedAtRef.current) {
      t = setInterval(() => setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    }
    return () => clearInterval(t);
  }, [inCall]);

  /* ================= UI ================= */
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
        <h2>📞 Orbit Softphone</h2>
        <div style={ui.status}>{status}</div>

        {incoming && (
          <div style={ui.row}>
            <button style={ui.accept} onClick={accept}>Accept</button>
            <button style={ui.reject} onClick={reject}>Reject</button>
          </div>
        )}

        {inCall && (
          <>
            <p>⏱ {duration}s</p>
            <div style={ui.row}>
              <button style={micMuted ? ui.reject : ui.accept} onClick={toggleMic}>
                {micMuted ? "Mic Off" : "Mic On"}
              </button>
              <button style={ui.reject} onClick={hangup}>Hang Up</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================= UI STYLES ================= */
const ui = {
  page: { height:"100vh", width:"100vw", display:"flex", justifyContent:"center", alignItems:"center", background:"#eef1f5" },
  phone: { minWidth:360, maxWidth:"90%", background:"#fff", padding:24, borderRadius:18, boxShadow:"0 12px 32px rgba(0,0,0,.2)", textAlign:"center", display:"flex", flexDirection:"column", alignItems:"center", gap:12 },
  status: { margin:"10px 0", fontWeight:"bold" },
  accept: { background:"#2e7d32", color:"#fff", padding:12, borderRadius:10, border:"none", minWidth:100, cursor:"pointer" },
  reject: { background:"#d32f2f", color:"#fff", padding:12, borderRadius:10, border:"none", minWidth:100, cursor:"pointer" },
  row: { display:"flex", gap:12, justifyContent:"center", width:"100%" },
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:10 },
  modalCard: { background:"#fff", padding:30, borderRadius:14, textAlign:"center" },
  primary: { padding:"10px 20px", background:"#1976d2", color:"#fff", border:"none", borderRadius:8, cursor:"pointer" },
};
