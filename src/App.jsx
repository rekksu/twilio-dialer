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

  const saveCallLog = async (statusStr, reason, duration, start, end) => {
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
      const now = Date.now();
      setCallDuration(Math.floor((now - startedAtRef.current) / 1000));
    }, 1000);
  };

  const stopLiveTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    setPhoneNumber(urlParams.get("to") || "");
    setCustomerId(urlParams.get("customerId"));
    setOrgId(urlParams.get("orgId"));
    setStatus("Ready to call");

    // Ensure HTML and body take full height
    document.documentElement.style.height = "100%";
    document.body.style.height = "100%";
    document.body.style.margin = "0";
  }, []);

  const startCall = async () => {
    if (!phoneNumber) return;

    const micOk = await checkMic();
    if (!micOk) return;

    setStatus("Fetching token...");

    const tokenRes = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
    const { token } = await tokenRes.json();

    const device = new Device(token, { enableRingingState: true });
    deviceRef.current = device;

    device.on("error", (err) => {
      console.error(err);
      setStatus("❌ Device error");
    });

    setStatus("Dialing...");
    const call = await device.connect({
      params: { To: formatPhoneNumber(phoneNumber) },
    });

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
      const dur = startedAtRef.current
        ? Math.floor((end - startedAtRef.current) / 1000)
        : 0;

      saveCallLog("ended", null, dur, startedAtRef.current, end);
      setIsHangupEnabled(false);
      setStatus("📴 Call ended");
    });

    call.on("error", (err) => {
      stopLiveTimer();
      const end = Date.now();
      const dur = startedAtRef.current
        ? Math.floor((end - startedAtRef.current) / 1000)
        : 0;

      saveCallLog("failed", err.message, dur, startedAtRef.current, end);
      setIsHangupEnabled(false);
      setStatus("❌ Call failed");
    });
  };

  const hangup = () => {
    if (callRef.current) callRef.current.disconnect();
    setIsHangupEnabled(false);
  };

  // --- UI STYLES ---
  const containerStyle = {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    height: "100vh", 
    background: "#f0f2f5",
  };

  const cardStyle = {
    width: "400px",
    padding: "30px",
    borderRadius: "12px",
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
    background: "#fff",
    textAlign: "center",
    fontFamily: "Segoe UI, sans-serif",
  };

  const statusStyle = {
    padding: "12px",
    borderRadius: "8px",
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
    fontSize: "16px",
    transition: "all 0.2s",
  };

  const startButtonStyle = {
    ...buttonStyle,
    background: "#1976d2",
    color: "#fff",
  };

  const hangupButtonStyle = {
    ...buttonStyle,
    background: "#d32f2f",
    color: "#fff",
  };

  const inputStyle = {
    padding: "12px",
    width: "90%",
    borderRadius: "8px",
    border: "1px solid #ccc",
    fontSize: "16px",
    marginBottom: "15px",
    backgroundColor: "#f0f0f0",
    color: "#555",
  };

  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h2>📞 CRM Orbit Dialer</h2>

        <div style={statusStyle}>{status}</div>

        <label style={{ fontWeight: "bold", display: "block", marginBottom: "8px" }}>
          Phone Number:
        </label>
        <input type="text" value={phoneNumber} readOnly style={inputStyle} />

        {isHangupEnabled && (
          <p style={{ fontWeight: "bold" }}>⏱ Duration: {Math.floor(callDuration)}s</p>
        )}

        <div>
          <button
            style={startButtonStyle}
            onClick={startCall}
            disabled={!phoneNumber || isHangupEnabled}
          >
            Start Call
          </button>
          <button
            style={hangupButtonStyle}
            onClick={hangup}
            disabled={!isHangupEnabled}
          >
            Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
