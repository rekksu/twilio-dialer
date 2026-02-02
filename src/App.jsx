import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const CALL_LOG_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isHangupEnabled, setIsHangupEnabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [micMuted, setMicMuted] = useState(false);

  // 🔐 auth states
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);

  // ✅ refs
  const customerIdRef = useRef(null);
  const orgIdRef = useRef(null);
  const hasSavedRef = useRef(false);

  const formatPhoneNumber = (num) => {
    let cleaned = num.replace(/[\s\-\(\)]/g, "");
    if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
    return cleaned;
  };

  const saveCallLog = async (statusStr, reason, duration, start, end, to) => {
    if (!to || !statusStr || hasSavedRef.current) return;
    hasSavedRef.current = true;

    await fetch(CALL_LOG_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: formatPhoneNumber(to),
        status: statusStr,
        reason,
        customerId: customerIdRef.current,
        orgId: orgIdRef.current,
        startedAt: start ? new Date(start).toISOString() : null,
        endedAt: end ? new Date(end).toISOString() : null,
        durationSeconds: duration,
      }),
    });
  };

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setCallDuration(
        Math.floor((Date.now() - startedAtRef.current) / 1000)
      );
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  /* =========================
     🔐 VERIFY ACCESS FIRST
     ========================= */
  useEffect(() => {
    const verifyAccess = async () => {
      const params = new URLSearchParams(window.location.search);
      const accessKey = params.get("accessKey");

      const to = params.get("to");
      customerIdRef.current = params.get("customerId");

      setPhoneNumber(to || "");

      if (!accessKey) {
        setStatus("🚫 Unauthorized access");
        setAuthChecked(true);
        return;
      }

      try {
        const res = await fetch(VERIFY_ACCESS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: accessKey }),
        });

        if (!res.ok) {
          setStatus("🚫 Access denied");
          setAuthChecked(true);
          return;
        }

        const data = await res.json();
        orgIdRef.current = data.orgId;

        setAuthorized(true);
        setAuthChecked(true);
      } catch (err) {
        console.error(err);
        setStatus("🚫 Verification failed");
        setAuthChecked(true);
      }
    };

    verifyAccess();
  }, []);

  /* =========================
     📞 INIT CALL (ONLY IF AUTH)
     ========================= */
  useEffect(() => {
    if (!authChecked || !authorized) return;

    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");

    if (!to) {
      setStatus("❌ Missing phone number");
      return;
    }

    const initCall = async () => {
      setStatus("Fetching token...");

      const tokenRes = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const { token } = await tokenRes.json();

      const device = new Device(token, { enableRingingState: true });
      deviceRef.current = device;

      setStatus("Dialing...");

      const call = await device.connect({
        params: { To: formatPhoneNumber(to) },
      });

      callRef.current = call;
      setIsHangupEnabled(true);

      call.on("ringing", () => setStatus("📞 Ringing..."));

      call.on("accept", () => {
        startedAtRef.current = Date.now();
        startTimer();
        setStatus("✅ Connected!");
      });

      call.on("disconnect", () => {
        stopTimer();
        const end = Date.now();
        const dur = startedAtRef.current
          ? Math.floor((end - startedAtRef.current) / 1000)
          : 0;

        saveCallLog("ended", null, dur, startedAtRef.current, end, to);
        setIsHangupEnabled(false);
        setMicMuted(false);
        setStatus("📴 Call ended");
      });

      call.on("error", (err) => {
        stopTimer();
        const end = Date.now();
        const dur = startedAtRef.current
          ? Math.floor((end - startedAtRef.current) / 1000)
          : 0;

        saveCallLog("failed", err.message, dur, startedAtRef.current, end, to);
        setIsHangupEnabled(false);
        setMicMuted(false);
        setStatus("❌ Call failed");
      });
    };

    initCall();
  }, [authChecked, authorized]);

  const hangup = () => {
    callRef.current?.disconnect();
    setIsHangupEnabled(false);
  };

  const toggleMic = () => {
    if (!callRef.current) return;
    const next = !micMuted;
    callRef.current.mute(next);
    setMicMuted(next);
  };

  /* ---------- UI STYLES (UNCHANGED) ---------- */
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
      status.includes("❌") || status.includes("🚫")
        ? "#ffe5e5"
        : status.includes("✅")
        ? "#e5ffe5"
        : "#e0e0e0",
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

  const hangupButtonStyle = {
    padding: "12px 25px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: "bold",
    fontSize: 16,
    background: "#d32f2f",
    color: "#fff",
  };

  const micOnStyle = {
    padding: "12px 20px",
    borderRadius: 8,
    border: "none",
    fontWeight: "bold",
    background: "#2e7d32",
    color: "#fff",
    cursor: "pointer",
    marginRight: 10,
  };

  const micOffStyle = {
    ...micOnStyle,
    background: "#d32f2f",
  };

  /* ---------- UI (UNCHANGED) ---------- */
  return (
    <div style={containerStyle}>
      <div style={cardStyle}>
        <h2>📞 CRM Orbit Dialer</h2>

        <div style={statusStyle}>{status}</div>

        <label style={{ fontWeight: "bold", marginBottom: 8, display: "block" }}>
          Phone Number:
        </label>

        <input type="text" value={phoneNumber} readOnly style={inputStyle} />

        {isHangupEnabled && (
          <p style={{ fontWeight: "bold" }}>
            ⏱ Duration: {callDuration}s
          </p>
        )}

        {isHangupEnabled && (
          <button
            style={micMuted ? micOffStyle : micOnStyle}
            onClick={toggleMic}
          >
            {micMuted ? "Mic Off" : "Mic On"}
          </button>
        )}

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
