import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const CALL_LOG_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isHangupEnabled, setIsHangupEnabled] = useState(false);
  const [callDuration, setCallDuration] = useState(0);

  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const timerRef = useRef(null);
  const startedAtRef = useRef(null);

  // ✅ IMPORTANT: refs (not state)
  const customerIdRef = useRef(null);
  const orgIdRef = useRef(null);
  const hasSavedRef = useRef(false);

  const saveCallLog = async (statusStr, reason, duration, start, end, to) => {
    if (!to || !statusStr || hasSavedRef.current) return;
    hasSavedRef.current = true;

    await fetch(CALL_LOG_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
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

  const formatPhoneNumber = (num) => {
    let cleaned = num.replace(/[\s\-\(\)]/g, "");
    if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
    return cleaned;
  };

  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 1000);
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    const to = params.get("to");
    customerIdRef.current = params.get("customerId");
    orgIdRef.current = params.get("orgId");

    setPhoneNumber(to || "");

    if (!to) {
      setStatus("❌ Missing phone number");
      return;
    }

    const initCall = async () => {
      const tokenRes = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const { token } = await tokenRes.json();

      const device = new Device(token, { enableRingingState: true });
      deviceRef.current = device;

      const call = await device.connect({
        params: { To: formatPhoneNumber(to) },
      });

      callRef.current = call;
      setIsHangupEnabled(true);
      setStatus("📞 Ringing...");

      call.on("accept", () => {
        startedAtRef.current = Date.now();
        startTimer();
        setStatus("✅ Connected");
      });

      call.on("disconnect", () => {
        stopTimer();
        const end = Date.now();
        const dur = startedAtRef.current
          ? Math.floor((end - startedAtRef.current) / 1000)
          : 0;

        saveCallLog("ended", null, dur, startedAtRef.current, end, to);
        setStatus("📴 Call ended");
        setIsHangupEnabled(false);
      });

      call.on("error", (err) => {
        stopTimer();
        const end = Date.now();
        const dur = startedAtRef.current
          ? Math.floor((end - startedAtRef.current) / 1000)
          : 0;

        saveCallLog("failed", err.message, dur, startedAtRef.current, end, to);
        setStatus("❌ Call failed");
        setIsHangupEnabled(false);
      });
    };

    initCall();
  }, []);

  const hangup = () => {
    callRef.current?.disconnect();
  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      background: "#f0f2f5"
    }}>
      <div style={{
        width: 400,
        padding: 30,
        borderRadius: 12,
        background: "#fff",
        textAlign: "center",
        boxShadow: "0 6px 20px rgba(0,0,0,.15)"
      }}>
        <h2>📞 CRM Orbit Dialer</h2>
        <p><strong>Status:</strong> {status}</p>
        <p><strong>To:</strong> {phoneNumber}</p>
        {isHangupEnabled && <p>⏱ {callDuration}s</p>}
        <button
          onClick={hangup}
          disabled={!isHangupEnabled}
          style={{
            padding: "12px 25px",
            background: "#d32f2f",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            cursor: "pointer"
          }}
        >
          Hang Up
        </button>
      </div>
    </div>
  );
}
