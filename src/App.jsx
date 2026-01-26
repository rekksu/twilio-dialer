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

  // ✅ ADDED (duration)
  const callStartTimeRef = useRef(null);
  const callDurationRef = useRef(0);

  // ✅ logging (safe for missing customer/org)
  const saveCallResult = async (
    status,
    reason = null,
    customerIdVal = customerId,
    orgIdVal = orgId
  ) => {
    try {
      await fetch(CALL_LOG_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phoneNumber,
          status,
          reason,
          customerId: customerIdVal ?? "unassigned",
          orgId: orgIdVal ?? "unassigned",
          duration: callDurationRef.current || 0,
        }),
      });
    } catch (err) {
      console.error("Failed to save call log", err);
    }
  };

  // URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const to = params.get("to");
    const cId = params.get("customerId");
    const oId = params.get("orgId");

    if (to) {
      setPhoneNumber(to);
      setStatus("Ready to call");
    } else {
      setStatus("❌ No phone number in URL");
    }

    if (cId) setCustomerId(cId);
    if (oId) setOrgId(oId);
  }, []);

  useEffect(() => {
    if (phoneNumber && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      setTimeout(startCall, 100);
    }
  }, [phoneNumber]);

  const checkMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      setStatus("❌ Microphone access denied");
      return false;
    }
  };

  const formatPhoneNumber = (num) => {
    let cleaned = num.replace(/[\s\-\(\)]/g, "");
    if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
    return cleaned;
  };

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

        const conn = device.connect({ params: { To: formatted } });
        connectionRef.current = conn;
        setIsHangupEnabled(true);

        conn.on("ringing", () => {
          setStatus(`📞 Ringing ${formatted}...`);
        });

        conn.on("accept", () => {
          setStatus("✅ Call connected!");
          callStartTimeRef.current = Date.now(); // ✅ start timer
        });

        conn.on("disconnect", () => {
          callDurationRef.current = callStartTimeRef.current
            ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
            : 0;

          setStatus("📴 Call ended");
          setIsHangupEnabled(false);
          setIsRedialEnabled(true);
          connectionRef.current = null;

          saveCallResult("ended");
        });

        conn.on("error", (err) => {
          callDurationRef.current = callStartTimeRef.current
            ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
            : 0;

          setStatus("❌ Call failed");
          setIsHangupEnabled(false);
          setIsRedialEnabled(true);

          saveCallResult("failed", err.message);
        });

        conn.on("reject", () => {
          saveCallResult("rejected");
        });
      });

      device.register();
    } catch (err) {
      setStatus("❌ Call error");
    }
  };

  const hangup = () => {
    callDurationRef.current = callStartTimeRef.current
      ? Math.floor((Date.now() - callStartTimeRef.current) / 1000)
      : 0;

    if (connectionRef.current) connectionRef.current.disconnect();
    if (deviceRef.current) deviceRef.current.destroy();

    setIsHangupEnabled(false);
    setIsRedialEnabled(true);
    setStatus("📴 Call ended");

    saveCallResult("ended", "manual hangup");
  };

  const redial = () => {
    if (connectionRef.current) connectionRef.current.disconnect();
    if (deviceRef.current) deviceRef.current.destroy();

    setIsHangupEnabled(false);
    setIsRedialEnabled(false);

    setTimeout(startCall, 500);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#f3f4f6",
        padding: 20,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 500,
          padding: "35px 40px",
          backgroundColor: "#fff",
          borderRadius: 16,
          boxShadow: "0 15px 35px rgba(0,0,0,.12)",
          fontFamily: "Inter, system-ui",
        }}
      >
        <h2 style={{ textAlign: "center", marginBottom: 30 }}>
          📞 Orbit Dialer
        </h2>

        <div
          style={{
            padding: 20,
            marginBottom: 25,
            borderRadius: 12,
            textAlign: "center",
            background: isHangupEnabled ? "#e6f4ea" : "#f3f4f6",
            border: `2px solid ${
              isHangupEnabled ? "#34d399" : "#d1d5db"
            }`,
          }}
        >
          {status}
        </div>

        <div
          style={{
            padding: 18,
            marginBottom: 30,
            borderRadius: 12,
            textAlign: "center",
            fontWeight: 700,
            fontSize: 22,
            background: "#eff6ff",
            border: "2px solid #3b82f6",
          }}
        >
          {phoneNumber || "No number"}
        </div>

        <div style={{ display: "flex", gap: 15 }}>
          <button
            onClick={redial}
            disabled={!isRedialEnabled || !phoneNumber}
            style={{
              flex: 1,
              padding: 16,
              borderRadius: 12,
              border: "none",
              fontWeight: 600,
              background: isRedialEnabled ? "#10b981" : "#d1d5db",
              color: "#fff",
            }}
          >
            🔄 Redial
          </button>

          <button
            onClick={hangup}
            disabled={!isHangupEnabled}
            style={{
              flex: 1,
              padding: 16,
              borderRadius: 12,
              border: "none",
              fontWeight: 600,
              background: isHangupEnabled ? "#ef4444" : "#d1d5db",
              color: "#fff",
            }}
          >
            📴 Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
