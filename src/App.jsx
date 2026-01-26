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
  const [debugLog, setDebugLog] = useState([]);
  
  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const hasAutoStartedRef = useRef(false);
  const callStartTimeRef = useRef(null);

  const addDebugLog = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${message}`);
    setDebugLog(prev => [...prev, `${timestamp}: ${message}`].slice(-10));
  };

  // Helper to save call logs
  const saveCallResult = async (status, reason = null) => {
    try {
      const endedAt = Date.now();
      
      let durationSeconds = 0;
      if (callStartTimeRef.current) {
        durationSeconds = Math.floor((endedAt - callStartTimeRef.current) / 1000);
      }

      const payload = {
        to: phoneNumber,
        status,
        reason,
        customerId: customerId || null,
        orgId: orgId || null,
        startedAt: callStartTimeRef.current
          ? new Date(callStartTimeRef.current).toISOString()
          : null,
        endedAt: new Date(endedAt).toISOString(),
        durationSeconds
      };

      addDebugLog(`📤 Sending to ${CALL_LOG_FUNCTION_URL}`);
      addDebugLog(`📊 Payload: ${JSON.stringify(payload, null, 2)}`);

      const response = await fetch(CALL_LOG_FUNCTION_URL, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      addDebugLog(`📨 Response status: ${response.status}`);
      
      const responseText = await response.text();
      addDebugLog(`📨 Response body: ${responseText}`);

      let result;
      try {
        result = JSON.parse(responseText);
        addDebugLog(`✅ Parsed response: ${JSON.stringify(result)}`);
      } catch (e) {
        addDebugLog(`⚠️ Could not parse response as JSON`);
      }

      if (!response.ok) {
        addDebugLog(`❌ HTTP Error: ${response.status}`);
        throw new Error(`HTTP ${response.status}: ${responseText}`);
      }

      addDebugLog(`✅ Call log saved successfully!`);
      
      callStartTimeRef.current = null;
      
    } catch (err) {
      addDebugLog(`❌ Error saving call log: ${err.message}`);
      console.error("Full error:", err);
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
      addDebugLog(`📞 Phone number from URL: ${urlNumber}`);
    } else {
      setStatus("❌ No phone number in URL (?to=+1234567890)");
      addDebugLog("❌ No phone number in URL");
    }

    if (urlCustomerId) {
      setCustomerId(urlCustomerId);
      addDebugLog(`👤 Customer ID: ${urlCustomerId}`);
    }
    if (urlOrgId) {
      setOrgId(urlOrgId);
      addDebugLog(`🏢 Org ID: ${urlOrgId}`);
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
        addDebugLog("✓ Device registered");
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
            addDebugLog("📞 Ringing...");
            setStatus(`📞 Ringing ${formattedNumber}...`);
          });

          conn.on("accept", () => {
            callStartTimeRef.current = Date.now();
            addDebugLog(`✅ Call connected at ${new Date(callStartTimeRef.current).toISOString()}`);
            setStatus("✅ Call connected!");
            setIsHangupEnabled(true);
          });

          conn.on("disconnect", () => {
            addDebugLog("📴 Call disconnected - saving log...");
            setStatus("📴 Call ended");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            
            saveCallResult("ended");
            
            connectionRef.current = null;
          });

          conn.on("error", (err) => {
            addDebugLog(`❌ Call error: ${err.message}`);
            setStatus(`❌ Call failed: ${err.message}`);
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            
            saveCallResult("failed", err.message);
            
            connectionRef.current = null;
          });

          conn.on("reject", () => {
            addDebugLog("❌ Call rejected");
            setStatus("❌ Call rejected");
            setIsHangupEnabled(false);
            setIsRedialEnabled(true);
            
            saveCallResult("rejected");
            
            connectionRef.current = null;
          });

          conn.on("cancel", () => {
            addDebugLog("📴 Call cancelled");
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
    addDebugLog("🔴 Hangup clicked");
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
  };

  const redial = () => {
    addDebugLog("🔄 Redial clicked");
    
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
      boxSizing: 'border-box',
      overflow: 'auto'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '600px',
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
        }}>
          📞 Orbit Dialer
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
          marginBottom: '30px'
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

        {/* Debug Log */}
        <div style={{
          padding: '15px',
          backgroundColor: '#1f2937',
          borderRadius: '8px',
          maxHeight: '300px',
          overflowY: 'auto',
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#10b981'
        }}>
          <div style={{ color: '#9ca3af', marginBottom: '10px', fontWeight: 'bold' }}>
            🔍 Debug Log (check browser console for details):
          </div>
          {debugLog.length === 0 ? (
            <div style={{ color: '#6b7280' }}>Waiting for events...</div>
          ) : (
            debugLog.map((log, idx) => (
              <div key={idx} style={{ marginBottom: '5px' }}>
                {log}
              </div>
            ))
          )}
        </div>

      </div>
    </div>
  );
}