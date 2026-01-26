import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

// Cloud Function to save call logs
const CALL_LOG_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [customerId, setCustomerId] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [isHangupEnabled, setIsHangupEnabled] = useState(false);
  const [isRedialEnabled, setIsRedialEnabled] = useState(true);
  const [callDuration, setCallDuration] = useState(0); // live duration

  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const hasAutoStartedRef = useRef(false);

  const callStartTimeRef = useRef(null);
  const durationIntervalRef = useRef(null);

  // Helper to save call logs
  const saveCallResult = async (
    status,
    reason = null,
    customerIdVal = customerId,
    orgIdVal = orgId,
    durationSeconds = 0,
    startedAt = null,
    endedAt = null
  ) => {
    try {
      await fetch(CALL_LOG_FUNCTION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: phoneNumber,
          status,
          reason,
          customerId: customerIdVal || null,
          orgId: orgIdVal || null,
          startedAt: startedAt ? new Date(startedAt).toISOString() : null,
          endedAt: endedAt ? new Date(endedAt).toISOString() : null,
          durationSeconds,
        }),
      });
    } catch (err) {
      console.error("Failed to save call log", err);
    }
  };

  const handleCallEnd = (status, reason = null) => {
    const endedAt = Date.now();
    const durationSeconds = callStartTimeRef.current
      ? Math.floor((endedAt - callStartTimeRef.current) / 1000)
      : 0;

    stopCallTimer();
    saveCallResult(
      status,
      reason,
      customerId,
      orgId,
      durationSeconds,
      callStartTimeRef.current,
      endedAt
    );

    callStartTimeRef.current = null;
    connectionRef.current = null;
    setIsHangupEnabled(false);
    setIsRedialEnabled(true);
    setCallDuration(0);
    setStatus("📴 Call ended");
  };

  const startCallTimer = () => {
    callStartTimeRef.current = Date.now();
    setCallDuration(0);
    durationIntervalRef.current = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    }, 1000);
  };

  const stopCallTimer = () => {
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    durationIntervalRef.current = null;
  };

  // Get number, customerId, orgId from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    const urlCustomerId = urlParams.get("customerId");
    const urlOrgId = urlParams.get("orgId");

    if (urlNumber) {
      setPhoneNumber(urlNumber);
      setStatus("Ready to call");
    } else {
      setStatus("❌ No phone number in URL (?to=+1234567890)");
    }

    if (urlCustomerId) setCustomerId(urlCustomerId);
    if (urlOrgId) setOrgId(urlOrgId);
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
        console.log("✓ Device registered");
        setStatus(`📞 Dialing ${formattedNumber}...`);

        const callParams = { params: { To: formattedNumber } };
        const conn = twilioDevice.connect(callParams);
        connectionRef.current = conn;
        setIsHangupEnabled(true);

        setTimeout(() => {
          if (!conn || !conn.on) {
            console.error("Connection object not ready");
            return;
          }

          conn.on("ringing", () => {
            setStatus(`📞 Ringing ${formattedNumber}...`);
          });

          conn.on("accept", () => {
            setStatus("✅ Call connected!");
            setIsHangupEnabled(true);
            startCallTimer(); // start live duration
          });

          conn.on("disconnect", () => handleCallEnd("ended"));
          conn.on("error", (err) => handleCallEnd("failed", err.message));
          conn.on("reject", () => handleCallEnd("rejected"));
          conn.on("cancel", () => handleCallEnd("cancelled"));
        }, 50);
      });

      twilioDevice.register();
    } catch (err) {
      console.error("Error starting call:", err);
      setStatus(`❌ Error: ${err.message}`);
      setIsHangupEnabled(false);
      setIsRedialEnabled(true);
    }
  };

  const hangup = () => {
    if (connectionRef.current) {
      try { connectionRef.current.disconnect(); } catch (err) {}
    }
    if (deviceRef.current) {
      try { deviceRef.current.destroy(); } catch (err) {}
    }
    handleCallEnd("ended", "manual hangup");
  };

  const redial = () => {
    if (connectionRef.current) try { connectionRef.current.disconnect(); } catch (err) {}
    if (deviceRef.current) try { deviceRef.current.destroy(); } catch (err) {}
    setIsHangupEnabled(false);
    setIsRedialEnabled(false);
    setTimeout(() => startCall(), 500);
  };

  // format duration hh:mm:ss
  const formatDuration = (sec) => {
    const h = Math.floor(sec / 3600).toString().padStart(2, "0");
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#f3f4f6',
      padding: '20px',
      boxSizing: 'border-box'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '500px',
        padding: '35px 40px',
        backgroundColor: '#ffffff',
        borderRadius: '16px',
        boxShadow: '0 15px 35px rgba(0,0,0,0.12)',
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
      }}>
        <h2 style={{
          textAlign: 'center',
          color: '#1f2937',
          marginBottom: '30px',
          fontSize: '28px',
          fontWeight: '700',
          letterSpacing: '0.5px'
        }}>📞 Orbit Dialer</h2>

        {/* Call Status */}
        <div style={{
          padding: '20px',
          backgroundColor: isHangupEnabled ? '#e6f4ea' : '#f3f4f6',
          border: `2px solid ${isHangupEnabled ? '#34d399' : '#d1d5db'}`,
          borderRadius: '12px',
          marginBottom: '15px',
          textAlign: 'center',
          fontWeight: '600',
          color: '#111827',
          minHeight: '70px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '16px',
          transition: 'all 0.2s'
        }}>
          {status}
          {isHangupEnabled && callDuration > 0 && (
            <span style={{ marginTop: '5px', fontSize: '14px', color: '#065f46' }}>
              ⏱ {formatDuration(callDuration)}
            </span>
          )}
        </div>

        {/* Phone Number */}
        <div style={{
          padding: '18px',
          backgroundColor: '#eff6ff',
          border: '2px solid #3b82f6',
          borderRadius: '12px',
          marginBottom: '30px',
          textAlign: 'center',
          fontSize: '22px',
          fontWeight: '700',
          color: '#1e40af',
          letterSpacing: '0.5px'
        }}>
          {phoneNumber || "No number"}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '15px' }}>
          <button
            onClick={redial}
            disabled={!isRedialEnabled || !phoneNumber}
            style={{
              flex: 1,
              padding: '16px 26px',
              fontSize: '16px',
              fontWeight: '600',
              border: 'none',
              borderRadius: '12px',
              cursor: (!isRedialEnabled || !phoneNumber) ? 'not-allowed' : 'pointer',
              backgroundColor: (!isRedialEnabled || !phoneNumber) ? '#d1d5db' : '#10b981',
              color: '#fff',
              transition: 'all 0.2s',
              opacity: (!isRedialEnabled || !phoneNumber) ? 0.6 : 1,
              boxShadow: (isRedialEnabled && phoneNumber)
                ? '0 4px 12px rgba(16, 185, 129, 0.25)'
                : 'none'
            }}
          >
            🔄 Redial
          </button>

          <button
            onClick={hangup}
            disabled={!isHangupEnabled}
            style={{
              flex: 1,
              padding: '16px 26px',
              fontSize: '16px',
              fontWeight: '600',
              border: 'none',
              borderRadius: '12px',
              cursor: !isHangupEnabled ? 'not-allowed' : 'pointer',
              backgroundColor: !isHangupEnabled ? '#d1d5db' : '#ef4444',
              color: '#fff',
              transition: 'all 0.2s',
              opacity: !isHangupEnabled ? 0.6 : 1,
              boxShadow: isHangupEnabled
                ? '0 4px 12px rgba(239, 68, 68, 0.25)'
                : 'none'
            }}
          >
            📴 Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
