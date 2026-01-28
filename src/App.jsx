import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const CALL_LOG_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";

export default function AutoOutboundDialer() {
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
  const savedRef = useRef(false); // ✅ IMPORTANT

  /* ---------------- SAVE CALL ---------------- */
  const saveCallLog = async (statusStr, reason, start, end) => {
    if (savedRef.current) return;
    savedRef.current = true;

    await fetch(CALL_LOG_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: phoneNumber,
        status: statusStr,
        reason,
        direction: "outbound", // ✅ GUARANTEED
        customerId,
        orgId,
        startedAt: start ? new Date(start).toISOString() : null,
        endedAt: end ? new Date(end).toISOString() : null,
        durationSeconds:
          start && end ? Math.floor((end - start) / 1000) : 0,
      }),
    });
  };

  /* ---------------- TIMER ---------------- */
  const startTimer = () => {
    timerRef.current = setInterval(() => {
      setCallDuration(
        Math.floor((Date.now() - startedAtRef.current) / 1000)
      );
    }, 1000);
  };

  const stopTimer = () => {
    clearInterval(timerRef.current);
    timerRef.current = null;
  };

  /* ---------------- INIT ---------------- */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setPhoneNumber(params.get("to") || "");
    setCustomerId(params.get("customerId"));
    setOrgId(params.get("orgId"));

    const init = async () => {
      try {
        // 🎤 Mic permission
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());

        const audioEl = new Audio();
        audioEl.autoplay = true;

        const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
        const { token } = await res.json();

        const device = new Device(token, { enableRingingState: true });
        device.audio.incoming(audioEl);
        deviceRef.current = device;

        device.on("error", (err) => {
          console.error(err);
          setStatus("❌ Device error");
        });

        await device.register(); // ✅ REQUIRED
        setStatus("✅ Dialing...");

        savedRef.current = false;

        const call = await device.connect({
          params: { To: phoneNumber.startsWith("+") ? phoneNumber : `+${phoneNumber}` },
        });

        callRef.current = call;
        setIsHangupEnabled(true);

        call.on("accept", () => {
          startedAtRef.current = Date.now();
          startTimer();
          setStatus("✅ Connected");
        });

        call.on("disconnect", () => {
          stopTimer();
          saveCallLog("ended", null, startedAtRef.current, Date.now());
          setIsHangupEnabled(false);
          setStatus("📴 Call ended");
        });

        call.on("error", (err) => {
          stopTimer();
          saveCallLog("failed", err.message, startedAtRef.current, Date.now());
          setIsHangupEnabled(false);
          setStatus("❌ Call failed");
        });
      } catch (err) {
        console.error(err);
        setStatus("❌ Init failed");
      }
    };

    init();
  }, []);

  const hangup = () => {
    if (callRef.current) callRef.current.disconnect();
  };

  /* ---------------- UI ---------------- */
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2>📞 CRM Orbit Dialer</h2>
        <div style={styles.status}>{status}</div>

        <input value={phoneNumber} readOnly style={styles.input} />

        {isHangupEnabled && <p>⏱ {callDuration}s</p>}

        <button style={styles.hangup} onClick={hangup} disabled={!isHangupEnabled}>
          Hang Up
        </button>
      </div>
    </div>
  );
}

/* ---------------- STYLES ---------------- */
const styles = {
  container: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f2f5",
  },
  card: {
    width: 400,
    padding: 30,
    borderRadius: 12,
    background: "#fff",
    boxShadow: "0 6px 20px rgba(0,0,0,.15)",
    textAlign: "center",
  },
  status: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    background: "#e0e0e0",
    fontWeight: "bold",
  },
  input: {
    width: "100%",
    padding: 10,
    borderRadius: 8,
    marginBottom: 12,
    background: "#f0f0f0",
    border: "1px solid #ccc",
  },
  hangup: {
    background: "#d32f2f",
    color: "#fff",
    padding: "12px 25px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontWeight: "bold",
  },
};
