import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

/* ✅ ADD: Call log Cloud Function */
const CALL_LOG_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isHangupEnabled, setIsHangupEnabled] = useState(false);
  const [isRedialEnabled, setIsRedialEnabled] = useState(true);

  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const hasAutoStartedRef = useRef(false);

  /* ✅ ADD: helper to save call result */
  const saveCallResult = async (
    status,
    reason = null,
    customerId = null,
    orgId = null
  ) => {
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
        }),
      });
    } catch (err) {
      console.error("Failed to save call log", err);
    }
  };

  // Get number from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    if (urlNumber) {
      setPhoneNumber(urlNumber);
      setStatus("Ready to call");
    } else {
      setStatus("❌ No phone number in URL (?to=+1234567890)");
    }
  }, []);

  // Auto-start call when phone number is available
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
    } catch (err) {
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
    if (!formattedNumber) {
      setStatus("❌ Invalid phone number");
      return;
    }

    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    setIsRedialEnabled(false);
    setIsHangupEnabled(false);

    try {
      setStatus("🔄 Fetching token...");
      
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const data = await res.json();
      const token = data.token;

      setStatus("🔄 Setting up device...");
      
      const twilioDevice = new Device(token, { 
        enableRingingState: true,
        codecPreferences: ["opus", "pcmu"]
      });

      deviceRef.current = twilioDevice;

      twilioDevice.on("error", (err) => {
        console.error("Device error:", err);
        setStatus(`❌ Device error: ${err.message}`);
        setIsHangupEnabled(false);
        setIsRedialEnabled(true);
      });

      twilioDevice.on("registered", () => {
        setStatus(`📞 Dialing ${formattedNumber}...`);

        const conn = twilioDevice.connect({
          params: { To: formattedNumber }
        });

        connectionRef.current = conn;
        setIsHangupEnabled(true);

        setTimeout(() => {
          if (!conn || !conn.on) return;

          conn.on("ringing", () => {
            setStatus(`📞 Ringing ${formattedNumber}...`);
          });

          conn.on("accept", () => {
            setStatus("✅ Call connected!");
            setIsHangupEnabled(true);
          });

          conn.on("disconnect", () => {
            setStatus("📴 Call ended");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;

            /* ✅ ADD */
            saveCallResult("ended");
          });

          conn.on("error", (err) => {
            setStatus(`❌ Call failed: ${err.message}`);
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;

            /* ✅ ADD */
            saveCallResult("failed", err.message);
          });

          conn.on("reject", () => {
            setStatus("❌ Call rejected");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;

            /* ✅ ADD */
            saveCallResult("rejected");
          });

          conn.on("cancel", () => {
            setStatus("Call cancelled");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;

            /* ✅ ADD */
            saveCallResult("cancelled");
          });
        }, 50);
      });

      twilioDevice.register();

    } catch (err) {
      setStatus(`❌ Error: ${err.message}`);
      setIsHangupEnabled(false);
      setIsRedialEnabled(true);
    }
  };

  const hangup = () => {
    setStatus("Hanging up...");

    if (connectionRef.current) {
      connectionRef.current.disconnect();
      connectionRef.current = null;
    }

    if (deviceRef.current) {
      deviceRef.current.destroy();
      deviceRef.current = null;
    }

    setIsHangupEnabled(false);
    setIsRedialEnabled(true);
    setStatus("📴 Call ended");

    /* ✅ ADD */
    saveCallResult("ended", "manual hangup");
  };

  const redial = () => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
      connectionRef.current = null;
    }

    if (deviceRef.current) {
      deviceRef.current.destroy();
      deviceRef.current = null;
    }

    setIsHangupEnabled(false);
    setIsRedialEnabled(false);

    setTimeout(startCall, 500);
  };

  return (
    <div style={{ maxWidth: 450, margin: "50px auto", padding: 30 }}>
      <h2>📞 Twilio Dialer</h2>
      <div>{status}</div>
      <div>{phoneNumber}</div>

      <button onClick={redial} disabled={!isRedialEnabled}>🔄 Redial</button>
      <button onClick={hangup} disabled={!isHangupEnabled}>📴 Hang Up</button>
    </div>
  );
}
