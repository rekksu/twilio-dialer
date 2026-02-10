import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";
const OUTBOUND_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/outboundCall";

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

  // Read URL params
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const accessKey = params.get("accessKey");
  const fromNumber = params.get("from");
  const toNumber = params.get("to");

  // ---------------- Access verification ----------------
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

  // ---------------- Enable Audio & Twilio Device ----------------
  const enableAudio = async () => {
    if (!agentId) return setStatus("❌ No agentId provided");

    setAudioEnabled(true);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
    const { token } = await res.json();

    const device = new Device(token, { enableRingingState: true, closeProtection: true });
    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    device.on("incoming", (call) => {
      callRef.current = call;
      setIncoming(true);
      setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);

      call.on("disconnect", () => {
        setIncoming(false);
        setInCall(false);
        setMicMuted(false);
        setStatus("✅ Ready");
      });

      call.on("error", console.error);
    });

    await device.register();
    setStatus("✅ Ready (standby for calls)");
  };

  // ---------------- Call Handlers ----------------
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
  const toggleMic = () => {
    if (!callRef.current) return;
    callRef.current.mute(!micMuted);
    setMicMuted(!micMuted);
  };

  // ---------------- Outbound Call (auto if URL has from/to) ----------------
  useEffect(() => {
    const makeOutbound = async () => {
      if (!fromNumber || !toNumber) return;
      if (inCall) return; // prevent retrigger

      try {
        const res = await fetch(OUTBOUND_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fromNumber, toNumber, agentId }),
        });
        const data = await res.json();
        if (data.ok) {
          setStatus(`📞 Outbound call to ${toNumber} initiated`);
          setInCall(true);

          // Poll Twilio call status to auto-close tab when finished
          const pollCall = async () => {
            try {
              const callRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${data.accountSid}/Calls/${data.callSid}.json`, {
                headers: {
                  Authorization: "Basic " + btoa(`${data.accountSid}:${data.authToken}`)
                }
              });
              const callData = await callRes.json();
              if (["completed", "busy", "canceled", "failed", "no-answer"].includes(callData.status)) {
                window.close();
              } else {
                setTimeout(pollCall, 3000);
              }
            } catch (err) {
              console.error("Polling call error:", err);
              setTimeout(pollCall, 5000);
            }
          };
          pollCall();
        } else {
          setStatus("❌ Failed to make outbound call");
        }
      } catch (err) {
        console.error(err);
        setStatus("❌ Failed to make outbound call");
      }
    };

    makeOutbound();
  }, [fromNumber, toNumber, agentId, inCall]);

  if (!authChecked) return <Screen text="🔐 Verifying access…" />;
  if (!authorized) return <Screen text="🚫 Unauthorized" />;

  return (
    <div style={ui.page}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h3>Enable Audio</h3>
            <p>Allow microphone access to receive calls.</p>
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

const ui = {
  page: { height: "100vh", width: "100vw", display: "flex", justifyContent: "center", alignItems: "center", background: "#eef1f5" },
  phone: { minWidth: 360, maxWidth: "90%", background: "#fff", padding: 24, borderRadius: 18, boxShadow: "0 12px 32px rgba(0,0,0,.2)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  status: { margin: "10px 0", fontWeight: "bold" },
  row: { display: "flex", gap: 12, justifyContent: "center", width: "100%" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 },
  modalCard: { background: "#fff", padding: 30, borderRadius: 14, textAlign: "center" },
  primary: { padding: "10px 20px", background: "#1976d2", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
  accept: { background: "#2e7d32", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
  reject: { background: "#d32f2f", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
};
