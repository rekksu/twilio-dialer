import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

/* ================= CONFIG ================= */

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

/* ================= APP ================= */

export default function App() {
  const params = new URLSearchParams(window.location.search);

  const to = params.get("to"); // if present → outbound
  const accessKey = params.get("accessKey");

  const isOutbound = !!to;

  const deviceRef = useRef(null);
  const callRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  /* ============ VERIFY ACCESS ============ */

  useEffect(() => {
    if (!accessKey) {
      setAuthorized(false);
      setAuthChecked(true);
      return;
    }

    fetch(VERIFY_ACCESS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: accessKey }),
    })
      .then((r) => {
        if (!r.ok) throw new Error("Unauthorized");
        setAuthorized(true);
      })
      .catch(() => setAuthorized(false))
      .finally(() => setAuthChecked(true));
  }, []);

  /* ============ INIT TWILIO DEVICE ============ */

  useEffect(() => {
    if (!authorized) return;

    async function init() {
      setStatus("Fetching token…");

      const res = await fetch(CLOUD_FUNCTION_URL);
      const { token } = await res.json();

      const device = new Device(token, {
        codecPreferences: ["opus", "pcmu"],
        enableRingingState: true,
      });

      deviceRef.current = device;

      device.on("ready", () => {
        setStatus(isOutbound ? "Ready to call" : "Waiting for call…");
        if (isOutbound) startOutbound();
      });

      device.on("error", (err) => {
        console.error(err);
        setStatus("❌ Device error");
      });

      device.on("incoming", handleIncoming);

      await device.register();
    }

    init();
  }, [authorized]);

  /* ============ INBOUND ============ */

  const handleIncoming = (call) => {
    if (callRef.current) {
      call.reject();
      return;
    }

    callRef.current = call;
    setStatus("📞 Incoming call…");

    call.on("accept", () => {
      setInCall(true);
      setStatus("✅ Connected");
    });

    call.on("disconnect", () => {
      resetCall("📴 Call ended");
    });

    call.accept();
  };

  /* ============ OUTBOUND ============ */

  const startOutbound = () => {
    if (!deviceRef.current || callRef.current) return;

    setStatus("📞 Calling…");

    const call = deviceRef.current.connect({
      params: { To: to },
    });

    callRef.current = call;

    call.on("accept", () => {
      setInCall(true); // 🔑 IMPORTANT FIX
      setStatus("✅ Connected");
    });

    call.on("disconnect", () => {
      resetCall("📴 Call ended");
      setTimeout(() => window.close(), 1000);
    });

    call.on("error", (err) => {
      console.error(err);
      resetCall("❌ Call failed");
    });
  };

  /* ============ CONTROLS ============ */

  const toggleMic = () => {
    if (!callRef.current || !inCall) return;

    const newMuted = !callRef.current.isMuted();
    callRef.current.mute(newMuted);
    setMicMuted(newMuted);
  };

  const hangup = () => {
    if (!callRef.current) return;
    callRef.current.disconnect();
  };

  const resetCall = (msg) => {
    callRef.current = null;
    setInCall(false);
    setMicMuted(false);
    setStatus(msg);
  };

  /* ============ ACCESS GATE ============ */

  if (!authChecked) {
    return <div style={ui.page}>🔐 Verifying access…</div>;
  }

  if (!authorized) {
    return <div style={ui.page}>🚫 Unauthorized</div>;
  }

  /* ============ UI ============ */

  return (
    <div style={ui.page}>
      <div style={ui.card}>
        <h2>Orbit Dialer</h2>
        <p>{status}</p>

        {inCall && (
          <div style={ui.controls}>
            <button onClick={toggleMic} style={ui.btn}>
              {micMuted ? "🎙️ Mic Off" : "🎤 Mic On"}
            </button>

            <button onClick={hangup} style={{ ...ui.btn, background: "#e74c3c" }}>
              ❌ Hang Up
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
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#0f172a",
    color: "#fff",
    fontFamily: "Arial",
  },
  card: {
    width: 320,
    padding: 20,
    borderRadius: 12,
    background: "#020617",
    textAlign: "center",
  },
  controls: {
    marginTop: 20,
    display: "flex",
    justifyContent: "center",
    gap: 12,
  },
  btn: {
    padding: "10px 14px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    background: "#2563eb",
    color: "#fff",
    fontSize: 14,
  },
};
