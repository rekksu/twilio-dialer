import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const CALL_LOG_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [customerId, setCustomerId] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [isHangupEnabled, setIsHangupEnabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);

  // Save call log to Firebase
  const saveCallLog = async (statusStr, reason, duration, start, end) => {
    if (!phoneNumber || !statusStr) return; // prevent 400
    try {
      await fetch(CALL_LOG_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phoneNumber,
          status: statusStr,
          reason,
          customerId,
          orgId,
          startedAt: start ? new Date(start).toISOString() : null,
          endedAt: end ? new Date(end).toISOString() : null,
          durationSeconds: duration,
        }),
      });
    } catch (err) {
      console.error("Save call log failed:", err);
    }
  };

  const formatPhoneNumber = (num) => {
    let cleaned = num.replace(/[\s\-\(\)]/g, "");
    if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
    return cleaned;
  };

  const checkMic = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      setStatus("❌ Microphone access denied");
      return false;
    }
  };

  const startLiveTimer = () => {
    timerRef.current = setInterval(() => {
      if (startedAtRef.current) {
        setCallDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
  };

  const stopLiveTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  const hangup = () => {
    if (callRef.current) callRef.current.disconnect();
    setIsHangupEnabled(false);
  };

  useEffect(() => {
    // Read URL params immediately
    const urlParams = new URLSearchParams(window.location.search);
    const toNumber = urlParams.get("to") || "";
    const custId = urlParams.get("customerId");
    const orgIdParam = urlParams.get("orgId");

    setPhoneNumber(toNumber);
    setCustomerId(custId);
    setOrgId(orgIdParam);

    // Ensure HTML/body take full height
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.margin = "0";

    // Auto-dial function
    const autoDial = async () => {
      if (!toNumber) {
        setStatus("❌ No phone number provided");
        return;
      }

      const micOk = await checkMic();
      if (!micOk) return;

      setStatus("Fetching token...");
      const tokenRes = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const { token } = await tokenRes.json();

      const device = new Device(token, { enableRingingState: true });
      deviceRef.current = device;

      // Audio element for ringing & call audio
      const audioEl = new Audio();
      audioEl.autoplay = true;
      device.audio.incoming(audioEl);

      device.on("error", (err) => {
        console.error(err);
        setStatus("❌ Device error: " + err.message);
      });

      setStatus("✅ Device ready, dialing...");
      const call = await device.connect({ params: { To: formatPhoneNumber(toNumber) } });
      callRef.current = call;
      setIsHangupEnabled(true);

      call.on("ringing", () => setStatus("📞 Ringing..."));

      call.on("accept", () => {
        startedAtRef.current = Date.now();
        startLiveTimer();
        setStatus("✅ Connected!");
      });

      call.on("disconnect", () => {
        stopLiveTimer();
        const end = Date.now();
        const dur = startedAtRef.current ? Math.floor((end - startedAtRef.current) / 1000) : 0;
        saveCallLog("ended", null, dur, startedAtRef.current, end);
        setIsHangupEnabled(false);
        setStatus("📴 Call ended");
      });

      call.on("error", (err) => {
        stopLiveTimer();
        const end = Date.now();
        const dur = startedAtRef.current ? Math.floor((end - startedAtRef.current) / 1000) : 0;
        saveCallLog("failed", err.message, dur, startedAtRef.current, end);
        setIsHangupEnabled(false);
        setStatus("❌ Call failed");
      });
    };

    autoDial();
  }, []);

  // --- STYLES ---
  const containerStyle = {
    height: "100vh",
    width: "100vw",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#f0f2f5",
  };

  const cardStyle = {
    width: 400,
    padding: 30,
    borderRadius: 12,
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
    background: "#fff",
    textAlign: "center",
    fontFamily: "Segoe UI, sans-serif",
  };

  const statusStyle = {
    padding: 12,
    borderRadius: 8,
    margin: "15px 0",
    fontWeight: "bold",
    background:
      status.includes("❌")
        ? "#ffe5e5"
        : status.includes("✅")
        ? "#e5ffe5"
        : "#e0e0e0",
    color:
      status.includes("❌") ? "#d32f2f" : status.includes("✅") ? "#2e7d32" : "#000",
  };

  const buttonStyle = {
    padding: "12px 25px",
    margin: "8px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: 16,
  };

  const hangupButtonStyle = {
    ...buttonStyle,
    background: "#d32f2f",
    color: "#fff",
  };

  const inputStyle = {
    padding: 12,
    width: "90%",
    borderRadius: 8,
    border: "1px solid #ccc",
    fontSize: 16,
    marginBottom: 15,
    backgroundColor: "#f0f0f0",
    color: "#555",
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h2>📞 CRM Orbit Dialer</h2>

        <div style={statusStyle}>{status}</div>

        <label style={{ fontWeight: "bold", display: "block", marginBottom: 8 }}>
          Phone Number:
        </label>
        <input type="text" value={phoneNumber} readOnly style={inputStyle} />

        {isHangupEnabled && <p style={{ fontWeight: "bold" }}>⏱ Duration: {callDuration}s</p>}

        <div>
          <button style={hangupButtonStyle} onClick={hangup} disabled={!isHangupEnabled}>
            Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
