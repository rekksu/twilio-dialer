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
  const [isRedialEnabled, setIsRedialEnabled] = useState(true);
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
  }, []);

  const startCall = async () => {
    if (!phoneNumber) return;

    const micOk = await checkMic();
    if (!micOk) return;

    setIsRedialEnabled(false);
    setStatus("Fetching token...");

    const tokenRes = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
    const { token } = await tokenRes.json();

    const device = new Device(token, { enableRingingState: true });
    deviceRef.current = device;

    device.on("error", (err) => {
      console.error(err);
      setStatus("❌ Device error");
      setIsRedialEnabled(true);
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
      setIsRedialEnabled(true);
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
      setIsRedialEnabled(true);
      setStatus("❌ Call failed");
    });
  };

  const hangup = () => {
    if (callRef.current) callRef.current.disconnect();
    setIsHangupEnabled(false);
  };

  // --- UI STYLES ---
  const containerStyle = {
    maxWidth: "400px",
    margin: "50px auto",
    padding: "20px",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    textAlign: "center",
    fontFamily: "Segoe UI, sans-serif",
    background: "#f7f8fa",
  };

  const statusStyle = {
    padding: "10px",
    borderRadius: "8px",
    margin: "10px 0",
    background:
      status.includes("❌")
        ? "#ffcccc"
        : status.includes("✅")
        ? "#ccffcc"
        : "#e0e0e0",
  };

  const buttonStyle = {
    padding: "10px 20px",
    margin: "5px",
    borderRadius: "8px",
    border: "none",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: "16px",
  };

  const startButtonStyle = {
    ...buttonStyle,
    background: "#4caf50",
    color: "#fff",
  };

  const hangupButtonStyle = {
    ...buttonStyle,
    background: "#f44336",
    color: "#fff",
  };

  return (
    <div style={containerStyle}>
      <h1>📞 Orbit Dialer</h1>

      <div style={statusStyle}>{status}</div>

      <input
        type="text"
        placeholder="Enter phone number"
        value={phoneNumber}
        onChange={(e) => setPhoneNumber(e.target.value)}
        style={{ padding: "10px", width: "80%", borderRadius: "8px" }}
      />

      {isHangupEnabled && (
        <p>⏱ Duration: {Math.floor(callDuration)}s</p>
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
  );
}
