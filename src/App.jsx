import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isHangupEnabled, setIsHangupEnabled] = useState(false);
  const [isRedialEnabled, setIsRedialEnabled] = useState(true);
  
  const deviceRef = useRef(null);
  const activeCallRef = useRef(null);
  const hasAutoStartedRef = useRef(false);

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

  const setupConnectionHandlers = (call) => {
    console.log("Setting up call handlers, call object type:", typeof call);
    
    call.on("ringing", () => {
      console.log("📞 Call is ringing");
      setStatus(`📞 Ringing...`);
    });

    call.on("accept", () => {
      console.log("✅ Call accepted/connected");
      setStatus("✅ Call connected!");
      setIsHangupEnabled(true);
    });

    call.on("disconnect", () => {
      console.log("📴 Call disconnected");
      setStatus("📴 Call ended");
      setIsHangupEnabled(false);
      setIsRedialEnabled(true);
      activeCallRef.current = null;
    });

    call.on("error", (err) => {
      console.error("❌ Call error:", err);
      setStatus(`❌ Call failed: ${err.message}`);
      setIsHangupEnabled(false);
      setIsRedialEnabled(true);
      activeCallRef.current = null;
    });

    call.on("reject", () => {
      console.log("❌ Call rejected");
      setStatus("❌ Call rejected");
      setIsHangupEnabled(false);
      setIsRedialEnabled(true);
      activeCallRef.current = null;
    });

    call.on("cancel", () => {
      console.log("⚠️ Call cancelled");
      setStatus("Call cancelled");
      setIsHangupEnabled(false);
      setIsRedialEnabled(true);
      activeCallRef.current = null;
    });
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
        console.log("✓ Device registered successfully");
        setStatus(`📞 Calling ${formattedNumber}...`);
        
        try {
          // Make the call
          const call = twilioDevice.connect({ 
            params: { To: formattedNumber } 
          });
          
          console.log("Call object created:", !!call);
          console.log("Call has disconnect method:", typeof call?.disconnect);
          
          // Store the call object
          activeCallRef.current = call;
          
          // Enable hangup immediately
          setIsHangupEnabled(true);
          
          // Set up handlers immediately (no delay)
          setupConnectionHandlers(call);
          
        } catch (err) {
          console.error("Error creating call:", err);
          setStatus(`❌ Failed to connect: ${err.message}`);
          setIsHangupEnabled(false);
          setIsRedialEnabled(true);
        }
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
    console.log("Active call exists:", !!activeCallRef.current);
    console.log("Active call type:", typeof activeCallRef.current);
    console.log("Has disconnect method:", typeof activeCallRef.current?.disconnect);
    
    setStatus("Hanging up...");
    
    // Disconnect the active call
    if (activeCallRef.current) {
      try {
        console.log("Attempting to disconnect...");
        
        // Check if disconnect method exists
        if (typeof activeCallRef.current.disconnect === 'function') {
          activeCallRef.current.disconnect();
          console.log("✓ Call disconnected successfully");
        } else {
          console.error("disconnect is not a function on call object");
          // Try alternative methods
          if (typeof activeCallRef.current.reject === 'function') {
            activeCallRef.current.reject();
          }
        }
        
        activeCallRef.current = null;
      } catch (err) {
        console.error("Error disconnecting call:", err);
        activeCallRef.current = null;
      }
    }
    
    // Destroy the device
    if (deviceRef.current) {
      try {
        console.log("Destroying device...");
        deviceRef.current.destroy();
        console.log("✓ Device destroyed");
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
    console.log("🔄 Redial clicked");
    
    // Clean up first
    if (activeCallRef.current) {
      try {
        if (typeof activeCallRef.current.disconnect === 'function') {
          activeCallRef.current.disconnect();
        }
      } catch (e) {
        console.log("Error during redial cleanup:", e);
      }
      activeCallRef.current = null;
    }
    
    if (deviceRef.current) {
      try {
        deviceRef.current.destroy();
      } catch (e) {
        console.log("Error destroying device during redial:", e);
      }
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
      maxWidth: '450px',
      margin: '50px auto',
      padding: '30px',
      backgroundColor: '#ffffff',
      borderRadius: '16px',
      boxShadow: '0 8px 16px rgba(0,0,0,0.12)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h2 style={{
        textAlign: 'center',
        color: '#1a1a1a',
        marginBottom: '25px',
        fontSize: '26px',
        fontWeight: '700'
      }}>
        📞 Twilio Dialer
      </h2>

      <div style={{
        padding: '18px',
        backgroundColor: isHangupEnabled ? '#d4edda' : '#f8f9fa',
        border: `2px solid ${isHangupEnabled ? '#28a745' : '#dee2e6'}`,
        borderRadius: '10px',
        marginBottom: '20px',
        textAlign: 'center',
        fontWeight: '600',
        color: '#1a1a1a',
        minHeight: '60px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '15px'
      }}>
        {status}
      </div>

      <div style={{
        padding: '15px',
        backgroundColor: '#f0f7ff',
        border: '2px solid #007bff',
        borderRadius: '10px',
        marginBottom: '20px',
        textAlign: 'center',
        fontSize: '20px',
        fontWeight: 'bold',
        color: '#007bff',
        letterSpacing: '0.5px'
      }}>
        {phoneNumber || "No number"}
      </div>

      <div style={{
        display: 'flex',
        gap: '12px',
        marginBottom: '20px'
      }}>
        <button
          onClick={redial}
          disabled={!isRedialEnabled || !phoneNumber}
          style={{
            flex: 1,
            padding: '14px 24px',
            fontSize: '16px',
            fontWeight: '700',
            border: 'none',
            borderRadius: '10px',
            cursor: (!isRedialEnabled || !phoneNumber) ? 'not-allowed' : 'pointer',
            backgroundColor: (!isRedialEnabled || !phoneNumber) ? '#e0e0e0' : '#28a745',
            color: '#fff',
            transition: 'all 0.2s',
            opacity: (!isRedialEnabled || !phoneNumber) ? 0.5 : 1,
            boxShadow: (isRedialEnabled && phoneNumber) ? '0 4px 8px rgba(40, 167, 69, 0.3)' : 'none'
          }}
        >
          🔄 Redial
        </button>
        
        <button
          onClick={hangup}
          disabled={!isHangupEnabled}
          style={{
            flex: 1,
            padding: '14px 24px',
            fontSize: '16px',
            fontWeight: '700',
            border: 'none',
            borderRadius: '10px',
            cursor: !isHangupEnabled ? 'not-allowed' : 'pointer',
            backgroundColor: !isHangupEnabled ? '#e0e0e0' : '#dc3545',
            color: '#fff',
            transition: 'all 0.2s',
            opacity: !isHangupEnabled ? 0.5 : 1,
            boxShadow: isHangupEnabled ? '0 4px 8px rgba(220, 53, 69, 0.3)' : 'none'
          }}
        >
          📴 Hang Up
        </button>
      </div>

      <div style={{
        padding: '12px',
        backgroundColor: '#fff3cd',
        borderRadius: '8px',
        fontSize: '12px',
        color: '#856404',
        border: '1px solid #ffeaa7'
      }}>
        <div><strong>Debug Info:</strong></div>
        <div>• Hangup Enabled: <strong>{isHangupEnabled ? 'YES ✓' : 'NO ✗'}</strong></div>
        <div>• Redial Enabled: <strong>{isRedialEnabled ? 'YES ✓' : 'NO ✗'}</strong></div>
        <div>• Active Call: <strong>{activeCallRef.current ? 'EXISTS ✓' : 'NULL ✗'}</strong></div>
        <div>• Device: <strong>{deviceRef.current ? 'EXISTS ✓' : 'NULL ✗'}</strong></div>
        <div>• Disconnect Available: <strong>{typeof activeCallRef.current?.disconnect === 'function' ? 'YES ✓' : 'NO ✗'}</strong></div>
      </div>
    </div>
  );
}