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

  // ✅ NEW
  const callStartTimeRef = useRef(null);
  const callDurationRef = useRef(0);

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
          duration: callDurationRef.current || 0
        }),
      });
    } catch (err) {
      console.error("Failed to save call log", err);
    }
  };

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    const urlCustomerId = urlParams.get("customerId");
    const urlOrgId = urlParams.get("orgId");

    if (urlNumber) {
      setPhoneNumber(urlNumber);
      setStatus("Ready to call");
    } else {
      setStatus("❌ No phone number in URL");
    }

    if (urlCustomerId) setCustomerId(urlCustomerId);
    if (urlOrgId) setOrgId(urlOrgId);
  }, []);

  useEffect(() => {
    if (phoneNumber && !hasAutoStartedRef.current) {
      hasAutoStartedRef.current = true;
      setTimeout(() => startCall(), 100);
    }
  }, [phoneNumber]);

  const checkMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
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
    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) return;

    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    setIsRedialEnabled(false);
    setIsHangupEnabled(false);

    try {
      setStatus("🔄 Fetching token...");
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const { token } = await res.json();

      const twilioDevice = new Device(token);
      deviceRef.current = twilioDevice;

      twilioDevice.on("registered", () => {
        setStatus(`📞 Dialing ${formattedNumber}...`);
        const conn = twilioDevice.connect({ params: { To: formattedNumber } });
        connectionRef.current = conn;
        setIsHangupEnabled(true);

        conn.on("accept", () => {
          setStatus("✅ Call connected!");
          callStartTimeRef.current = Date.now(); // ⏱ start
        });

        conn.on("disconnect", () => {
          if (callStartTimeRef.current) {
            callDurationRef.current = Math.floor(
              (Date.now() - callStartTimeRef.current) / 1000
            );
          }

          setStatus("📴 Call ended");
          setIsHangupEnabled(false);
          setIsRedialEnabled(true);
          connectionRef.current = null;

          saveCallResult("ended");
        });

        conn.on("error", (err) => {
          if (callStartTimeRef.current) {
            callDurationRef.current = Math.floor(
              (Date.now() - callStartTimeRef.current) / 1000
            );
          }

          setStatus("❌ Call failed");
          setIsHangupEnabled(false);
          setIsRedialEnabled(true);

          saveCallResult("failed", err.message);
        });

        conn.on("reject", () => {
          saveCallResult("rejected");
        });
      });

      twilioDevice.register();
    } catch (err) {
      setStatus("❌ Call error");
    }
  };

  const hangup = () => {
    if (callStartTimeRef.current) {
      callDurationRef.current = Math.floor(
        (Date.now() - callStartTimeRef.current) / 1000
      );
    }

    if (connectionRef.current) connectionRef.current.disconnect();
    if (deviceRef.current) deviceRef.current.destroy();

    setIsHangupEnabled(false);
    setIsRedialEnabled(true);
    setStatus("📴 Call ended");

    saveCallResult("ended", "manual hangup");
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: "#f3f4f6"
    }}>
      <div style={{
        width: "100%",
        maxWidth: "500px",
        background: "#fff",
        padding: "40px",
        borderRadius: "16px",
        boxShadow: "0 15px 35px rgba(0,0,0,.12)"
      }}>
        <h2 style={{ textAlign: "center" }}>📞 Orbit Dialer</h2>
        <div>{status}</div>
        <div>{phoneNumber}</div>

        <button onClick={hangup} disabled={!isHangupEnabled}>Hang Up</button>
      </div>
    </div>
  );
}
