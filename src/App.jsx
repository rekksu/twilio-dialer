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
  const [customerId, setCustomerId] = useState(null); // ✅ add
  const [orgId, setOrgId] = useState(null);           // ✅ add
  const [isHangupEnabled, setIsHangupEnabled] = useState(false);
  const [isRedialEnabled, setIsRedialEnabled] = useState(true);
  
  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const hasAutoStartedRef = useRef(false);

  // Helper to save call logs
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
          customerId: customerIdVal,
          orgId: orgIdVal,
        }),
      });
    } catch (err) {
      console.error("Failed to save call log", err);
    }
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
        
        const callParams = { 
          params: { To: formattedNumber } 
        };
        
        const conn = twilioDevice.connect(callParams);
        connectionRef.current = conn;
        setIsHangupEnabled(true);

        setTimeout(() => {
          if (!conn || !conn.on) {
            console.error("Connection object not ready");
            return;
          }

          conn.on("ringing", () => {
            console.log("📞 Ringing...");
            setStatus(`📞 Ringing ${formattedNumber}...`);
          });

          conn.on("accept", () => {
            console.log("✓ Call connected!");
            setStatus("✅ Call connected!");
            setIsHangupEnabled(true);
          });

          conn.on("disconnect", () => {
            console.log("Call ended");
            setStatus("📴 Call ended");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;

            saveCallResult("ended"); // ✅ log with customerId/orgId
          });

          conn.on("error", (err) => {
            console.error("Call error:", err);
            setStatus(`❌ Call failed: ${err.message}`);
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;

            saveCallResult("failed", err.message);
          });

          conn.on("reject", () => {
            console.log("Call rejected");
            setStatus("❌ Call rejected");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;

            saveCallResult("rejected");
          });

          conn.on("cancel", () => {
            console.log("Call cancelled");
            setStatus("Call cancelled");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            connectionRef.current = null;
          });
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
    console.log("🔴 HANGUP CLICKED!");
    console.log("Connection exists:", !!connectionRef.current);
    console.log("Device exists:", !!deviceRef.current);
    
    setStatus("Hanging up...");
    
    if (connectionRef.current) {
      try {
        connectionRef.current.disconnect();
        connectionRef.current = null;
      } catch (err) {
        console.error("Error disconnecting:", err);
      }
    }
    
    if (deviceRef.current) {
      try {
        deviceRef.current.destroy();
        deviceRef.current = null;
      } catch (err) {
        console.error("Error destroying device:", err);
      }
    }
    
    setIsHangupEnabled(false);
    setIsRedialEnabled(true);
    setStatus("📴 Call ended");

    saveCallResult("ended", "manual hangup"); // ✅ log with customerId/orgId
  };

  const redial = () => {
    console.log("🔄 Redial clicked");
    
    if (connectionRef.current) {
      try {
        connectionRef.current.disconnect();
      } catch (e) {}
      connectionRef.current = null;
    }
    
    if (deviceRef.current) {
      try {
        deviceRef.current.destroy();
      } catch (e) {}
      deviceRef.current = null;
    }
    
    setIsHangupEnabled(false);
    setIsRedialEnabled(false);
    
    setTimeout(() => {
      startCall();
    }, 500);
  };

  return (
    <div style={{
  maxWidth: '500px',
  margin: '40px auto',
  padding: '30px 35px',
  backgroundColor: '#fefefe',
  borderRadius: '16px',
  boxShadow: '0 10px 25px rgba(0,0,0,0.12)',
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif'
}}>
  <h2 style={{
    textAlign: 'center',
    color: '#1f2937',
    marginBottom: '30px',
    fontSize: '28px',
    fontWeight: '700',
    letterSpacing: '0.5px'
  }}>
    📞 CRM Twilio Dialer
  </h2>

  <div style={{
    padding: '20px',
    backgroundColor: isHangupEnabled ? '#e6f4ea' : '#f3f4f6',
    border: `2px solid ${isHangupEnabled ? '#34d399' : '#d1d5db'}`,
    borderRadius: '12px',
    marginBottom: '25px',
    textAlign: 'center',
    fontWeight: '600',
    color: '#111827',
    minHeight: '70px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '16px',
    transition: 'all 0.2s'
  }}>
    {status}
  </div>

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

  <div style={{
    display: 'flex',
    gap: '15px',
    marginBottom: '25px'
  }}>
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
        boxShadow: (isRedialEnabled && phoneNumber) ? '0 4px 12px rgba(16, 185, 129, 0.25)' : 'none'
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
        boxShadow: isHangupEnabled ? '0 4px 12px rgba(239, 68, 68, 0.25)' : 'none'
      }}
    >
      📴 Hang Up
    </button>
  </div>

  <div style={{
    padding: '14px 18px',
    backgroundColor: '#fef3c7',
    borderRadius: '10px',
    fontSize: '13px',
    color: '#92400e',
    border: '1px solid #fde68a'
  }}>
    <div><strong>Debug Info:</strong></div>
    <div>• Hangup Enabled: <strong>{isHangupEnabled ? 'YES ✓' : 'NO ✗'}</strong></div>
    <div>• Redial Enabled: <strong>{isRedialEnabled ? 'YES ✓' : 'NO ✗'}</strong></div>
    <div>• Connection: <strong>{connectionRef.current ? 'EXISTS ✓' : 'NULL ✗'}</strong></div>
    <div>• Device: <strong>{deviceRef.current ? 'EXISTS ✓' : 'NULL ✗'}</strong></div>
    {customerId && <div>• Customer ID: <strong>{customerId}</strong></div>}
    {orgId && <div>• Org ID: <strong>{orgId}</strong></div>}
  </div>
</div>
  );
}
