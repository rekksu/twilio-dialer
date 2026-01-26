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

  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const hasAutoStartedRef = useRef(false);
  const callStartTimeRef = useRef(null);

  /* ---------------- SAVE CALL LOG ---------------- */
  const saveCallResult = async (status, reason = null) => {
    if (!callStartTimeRef.current) {
      console.warn("No call start time, skipping duration");
      return;
    }

    const endedAt = Date.now();
    const durationSeconds = Math.max(
      0,
      Math.floor((endedAt - callStartTimeRef.current) / 1000)
    );

    try {
      await fetch(CALL_LOG_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phoneNumber,
          status,
          reason,
          customerId,
          orgId,
          startedAt: new Date(callStartTimeRef.current).toISOString(),
          endedAt: new Date(endedAt).toISOString(),
          durationSeconds,
        }),
      });
    } catch (err) {
      console.error("Failed to save call log", err);
    }
  };

  /* ---------------- URL PARAMS ---------------- */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");
    const cid = params.get("customerId");
    const oid = params.get("orgId");

    if (to) {
      setPhoneNumber(to);
      setStatus("Ready to call");
    } else {
      setStatus("❌ No phone number provided");
    }

    if (cid) setCustomerId(cid);
    if (oid) setOrgId(oid);
  }, []);

  /* ---------------- AUTO START ---------------- */
  useEffect(() => {
    if (phoneNumber && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      setTimeout(startCall, 100);
    }
  }, [phoneNumber]);

  /* ---------------- HELPERS ---------------- */
  const checkMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      setStatus("❌ Microphone denied");
      return false;
    }
  };

  const formatPhoneNumber = (num) => {
    let cleaned = num.replace(/[\s\-\(\)]/g, "");
    if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
    return cleaned;
  };

  /* ---------------- START CALL ---------------- */
  const startCall = async () => {
    const formatted = formatPhoneNumber(phoneNumber);
    if (!formatted) return;

    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    setIsRedialEnabled(false);
    setIsHangupEnabled(false);

    try {
      setStatus("🔄 Fetching token...");
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const { token } = await res.json();

      const device = new Device(token, {
        enableRingingState: true,
        codecPreferences: ["opus", "pcmu"],
      });

      deviceRef.current = device;

      device.on("registered", () => {
        setStatus(`📞 Dialing ${formatted}...`);

        const conn = device.connect({
          params: { To: formatted },
        });

        connectionRef.current = conn;
        setIsHangupEnabled(true);

        conn.on("ringing", () => {
          if (!callStartTimeRef.current) {
            callStartTimeRef.current = Date.now(); // fallback start
          }
          setStatus(`📞 Ringing ${formatted}...`);
        });

        conn.on("accept", () => {
          callStartTimeRef.current = Date.now(); // real start
          setStatus("✅ Call connected");
        });

        conn.on("disconnect", () => {
          saveCallResult("ended");

          callStartTimeRef.current = null;
          connectionRef.current = null;

          setStatus("📴 Call ended");
          setIsHangupEnabled(false);
          setIsRedialEnabled(true);

          device.destroy();
          deviceRef.current = null;
        });

        conn.on("reject", () => {
          setStatus("❌ Call rejected");
          callStartTimeRef.current = null;
          setIsRedialEnabled(true);
          setIsHangupEnabled(false);
        });

        conn.on("error", (err) => {
          setStatus(`❌ Call error: ${err.message}`);
          callStartTimeRef.current = null;
          setIsRedialEnabled(true);
          setIsHangupEnabled(false);
        });
      });

      device.register();
    } catch (err) {
      setStatus(`❌ Error: ${err.message}`);
      setIsRedialEnabled(true);
      setIsHangupEnabled(false);
    }
  };

  /* ---------------- HANGUP ---------------- */
  const hangup = () => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
    }
  };

  /* ---------------- REDIAL ---------------- */
  const redial = () => {
    if (deviceRef.current) {
      deviceRef.current.destroy();
      deviceRef.current = null;
    }
    setIsRedialEnabled(false);
    setTimeout(startCall, 500);
  };

  /* ---------------- UI ---------------- */
  return (
    <div style={{
      height: "100vh",
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      background: "#f3f4f6",
    }}>
      <div style={{
        background: "#fff",
        padding: 30,
        borderRadius: 14,
        width: 420,
        boxShadow: "0 15px 35px rgba(0,0,0,0.12)",
      }}>
        <h2 style={{ textAlign: "center" }}>📞 Orbit Dialer</h2>

        <div style={{
          padding: 15,
          background: "#e5e7eb",
          borderRadius: 10,
          textAlign: "center",
          marginBottom: 20,
          fontWeight: 600,
        }}>
          {status}
        </div>

        <div style={{
          padding: 15,
          background: "#eff6ff",
          borderRadius: 10,
          textAlign: "center",
          marginBottom: 25,
          fontWeight: 700,
          fontSize: 20,
        }}>
          {phoneNumber || "No number"}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={redial}
            disabled={!isRedialEnabled}
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 10,
              background: "#10b981",
              color: "#fff",
              border: "none",
              opacity: isRedialEnabled ? 1 : 0.5,
            }}
          >
            🔄 Redial
          </button>

          <button
            onClick={hangup}
            disabled={!isHangupEnabled}
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 10,
              background: "#ef4444",
              color: "#fff",
              border: "none",
              opacity: isHangupEnabled ? 1 : 0.5,
            }}
          >
            📴 Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
