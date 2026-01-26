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
  const connectionRef = useRef(null);
  const callStartTimeRef = useRef(null);
  const durationIntervalRef = useRef(null);

  // -------------------------------
  // Save call log helper
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
      console.log("Call log saved:", status, durationSeconds);
    } catch (err) {
      console.error("Failed to save call log", err);
    }
  };

  // -------------------------------
  // Start/stop live call timer
  const startCallTimer = () => {
    if (!callStartTimeRef.current) callStartTimeRef.current = Date.now();
    setCallDuration(0);
    durationIntervalRef.current = setInterval(() => {
      setCallDuration(Math.floor((Date.now() - callStartTimeRef.current) / 1000));
    }, 1000);
  };

  const stopCallTimer = () => {
    if (durationIntervalRef.current) clearInterval(durationIntervalRef.current);
    durationIntervalRef.current = null;
  };

  // -------------------------------
  // Unified call end handler
  const handleCallEnd = (status, reason = null) => {
    if (!connectionRef.current && !callStartTimeRef.current) return;

    stopCallTimer();

    const endedAt = Date.now();
    const durationSeconds = callStartTimeRef.current
      ? Math.floor((endedAt - callStartTimeRef.current) / 1000)
      : 0;

    saveCallResult(
      status,
      reason,
      customerId,
      orgId,
      durationSeconds,
      callStartTimeRef.current,
      endedAt
    );

    connectionRef.current = null;
    callStartTimeRef.current = null;
    setIsHangupEnabled(false);
    setIsRedialEnabled(true);
    setCallDuration(0);
    setStatus("📴 Call ended");
  };

  // -------------------------------
  // Get number, customerId, orgId from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    const urlCustomerId = urlParams.get("customerId");
    const urlOrgId = urlParams.get("orgId");

    if (urlNumber) setPhoneNumber(urlNumber);
    if (urlCustomerId) setCustomerId(urlCustomerId);
    if (urlOrgId) setOrgId(urlOrgId);

    setStatus(urlNumber ? "Ready to call" : "❌ No phone number in URL (?to=+1234567890)");
  }, []);

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

  // -------------------------------
  // Start call manually
  const startCall = async () => {
    if (!phoneNumber) return;
    const formattedNumber = formatPhoneNumber(phoneNumber);

    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    setIsRedialEnabled(false);
    setIsHangupEnabled(false);
    setStatus("🔄 Fetching token...");

    try {
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const data = await res.json();
      const token = data.token;

      setStatus("🔄 Setting up device...");
      const twilioDevice = new Device(token, { enableRingingState: true, codecPreferences: ["opus", "pcmu"] });
      deviceRef.current = twilioDevice;

      twilioDevice.on("error", (err) => {
        console.error("Device error:", err);
        setStatus(`❌ Device error: ${err.message}`);
        setIsHangupEnabled(false);
        setIsRedialEnabled(true);
      });

      twilioDevice.on("registered", () => {
        setStatus(`📞 Dialing ${formattedNumber}...`);
        const conn = twilioDevice.connect({ params: { To: formattedNumber } });
        connectionRef.current = conn;
        setIsHangupEnabled(true);

        // ✅ Attach events to ensure logging always works
        conn.on("ringing", () => {
          setStatus(`📞 Ringing ${formattedNumber}...`);
          if (!callStartTimeRef.current) callStartTimeRef.current = Date.now();
        });

        conn.on("accept", () => {
          setStatus("✅ Call connected!");
          setIsHangupEnabled(true);
          startCallTimer();
        });

        conn.on("disconnect", () => handleCallEnd("ended"));
        conn.on("reject", () => handleCallEnd("rejected"));
        conn.on("cancel", () => handleCallEnd("cancelled"));
        conn.on("error", (err) => handleCallEnd("failed", err.message));
      });

      twilioDevice.register();
    } catch (err) {
      console.error("Error starting call:", err);
      setStatus(`❌ Error: ${err.message}`);
      setIsHangupEnabled(false);
      setIsRedialEnabled(true);
    }
  };

  // -------------------------------
  const hangup = () => {
    if (connectionRef.current) try { connectionRef.current.disconnect(); } catch {}
    if (deviceRef.current) try { deviceRef.current.destroy(); } catch {}
    handleCallEnd("ended", "manual hangup");
  };

  const redial = () => {
    if (connectionRef.current) try { connectionRef.current.disconnect(); } catch {}
    if (deviceRef.current) try { deviceRef.current.destroy(); } catch {}
    setIsHangupEnabled(false);
    setIsRedialEnabled(false);
    setTimeout(() => startCall(), 500);
  };

  const formatDuration = (sec) => {
    const h = Math.floor(sec / 3600).toString().padStart(2, "0");
    const m = Math.floor((sec % 3600) / 60).toString().padStart(2, "0");
    const s = (sec % 60).toString().padStart(2, "0");
    return `${h}:${m}:${s}`;
  };

  // -------------------------------
  return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100vh', background:'#f3f4f6', padding:'20px' }}>
      <div style={{ width:'100%', maxWidth:'500px', padding:'35px 40px', background:'#fff', borderRadius:'16px', boxShadow:'0 15px 35px rgba(0,0,0,0.12)', fontFamily:'Inter, sans-serif' }}>
        <h2 style={{ textAlign:'center', marginBottom:'30px' }}>📞 Orbit Dialer</h2>

        <div style={{ padding:'20px', background: isHangupEnabled ? '#e6f4ea' : '#f3f4f6', border:`2px solid ${isHangupEnabled ? '#34d399' : '#d1d5db'}`, borderRadius:'12px', marginBottom:'15px', textAlign:'center', minHeight:'70px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
          {status}
          {isHangupEnabled && callDuration > 0 && <span style={{ marginTop:'5px', fontSize:'14px', color:'#065f46' }}>⏱ {formatDuration(callDuration)}</span>}
        </div>

        <div style={{ padding:'18px', background:'#eff6ff', border:'2px solid #3b82f6', borderRadius:'12px', marginBottom:'30px', textAlign:'center', fontSize:'22px', fontWeight:'700' }}>
          {phoneNumber || "No number"}
        </div>

        <div style={{ display:'flex', gap:'15px' }}>
          <button onClick={startCall} disabled={!phoneNumber || isHangupEnabled} style={{ flex:1, padding:'16px', background:'#3b82f6', color:'#fff', borderRadius:'12px', cursor:'pointer' }}>
            ▶️ Start Call
          </button>
          <button onClick={redial} disabled={!isRedialEnabled || !phoneNumber} style={{ flex:1, padding:'16px', background:'#10b981', color:'#fff', borderRadius:'12px', cursor:'pointer', opacity:(!isRedialEnabled || !phoneNumber)?0.6:1 }}>
            🔄 Redial
          </button>
          <button onClick={hangup} disabled={!isHangupEnabled} style={{ flex:1, padding:'16px', background:'#ef4444', color:'#fff', borderRadius:'12px', cursor:'pointer', opacity:!isHangupEnabled?0.6:1 }}>
            📴 Hang Up
          </button>
        </div>
      </div>
    </div>
  );
}
