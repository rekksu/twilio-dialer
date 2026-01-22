import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callState, setCallState] = useState("idle"); // idle, connecting, ringing, connected
  
  const deviceRef = useRef(null);
  const connectionRef = useRef(null);
  const isInitializedRef = useRef(false);

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

  // Auto-start call
  useEffect(() => {
    if (phoneNumber && !isInitializedRef.current) {
      isInitializedRef.current = true;
      startCall();
    }
    
    return () => {
      cleanup();
    };
  }, [phoneNumber]);

  const cleanup = () => {
    if (connectionRef.current) {
      try {
        connectionRef.current.disconnect();
      } catch (e) {
        console.log("Error disconnecting:", e);
      }
      connectionRef.current = null;
    }
    
    if (deviceRef.current) {
      try {
        deviceRef.current.destroy();
      } catch (e) {
        console.log("Error destroying device:", e);
      }
      deviceRef.current = null;
    }
  };

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

    try {
      setStatus("🔄 Fetching token...");
      setCallState("connecting");
      
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const data = await res.json();
      const token = data.token;

      setStatus("🔄 Initializing device...");
      const twilioDevice = new Device(token, { 
        enableRingingState: true,
        codecPreferences: ["opus", "pcmu"]
      });

      // Device error handler
      twilioDevice.on("error", (err) => {
        console.error("Device error:", err);
        setStatus(`❌ Device error: ${err.message}`);
        setCallState("idle");
      });

      // Device registered
      twilioDevice.on("registered", () => {
        console.log("Device registered, making call...");
        setStatus(`📞 Calling ${formattedNumber}...`);
        setCallState("ringing");
        
        try {
          const conn = twilioDevice.connect({ 
            params: { To: formattedNumber } 
          });
          
          connectionRef.current = conn;
          
          // Connection ringing
          conn.on("ringing", () => {
            console.log("Call is ringing");
            setStatus(`📞 Ringing ${formattedNumber}...`);
            setCallState("ringing");
          });

          // Connection accepted
          conn.on("accept", () => {
            console.log("Call connected");
            setStatus("✅ Call connected");
            setCallState("connected");
          });

          // Connection disconnected
          conn.on("disconnect", () => {
            console.log("Call disconnected");
            setStatus("Call ended");
            setCallState("idle");
            connectionRef.current = null;
          });

          // Connection error
          conn.on("error", (err) => {
            console.error("Connection error:", err);
            setStatus(`❌ Call failed: ${err.message}`);
            setCallState("idle");
            connectionRef.current = null;
          });

          // Connection rejected
          conn.on("reject", () => {
            console.log("Call rejected");
            setStatus("❌ Call was rejected");
            setCallState("idle");
            connectionRef.current = null;
          });

          // Connection cancel
          conn.on("cancel", () => {
            console.log("Call cancelled");
            setStatus("Call cancelled");
            setCallState("idle");
            connectionRef.current = null;
          });

        } catch (err) {
          console.error("Error making call:", err);
          setStatus(`❌ Failed to connect: ${err.message}`);
          setCallState("idle");
        }
      });

      twilioDevice.register();
      deviceRef.current = twilioDevice;

    } catch (err) {
      console.error("Start call error:", err);
      setStatus(`❌ Error: ${err.message}`);
      setCallState("idle");
    }
  };

  const hangup = () => {
    console.log("Hangup clicked, callState:", callState);
    
    if (connectionRef.current) {
      console.log("Disconnecting connection...");
      try {
        connectionRef.current.disconnect();
      } catch (err) {
        console.error("Error disconnecting:", err);
      }
      connectionRef.current = null;
    }
    
    if (deviceRef.current) {
      console.log("Destroying device...");
      try {
        deviceRef.current.destroy();
      } catch (err) {
        console.error("Error destroying device:", err);
      }
      deviceRef.current = null;
    }
    
    setCallState("idle");
    setStatus("📴 Call ended");
  };

  const redial = () => {
    console.log("Redial clicked");
    hangup();
    setTimeout(() => {
      if (phoneNumber) {
        startCall();
      }
    }, 500);
  };

  const isCallActive = callState === "connecting" || callState === "ringing" || callState === "connected";

  return (
    <div style={{
      maxWidth: '400px',
      margin: '50px auto',
      padding: '30px',
      backgroundColor: '#f5f5f5',
      borderRadius: '12px',
      boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h2 style={{
        textAlign: 'center',
        color: '#333',
        marginBottom: '20px',
        fontSize: '24px'
      }}>
        📞 Twilio Web Dialer
      </h2>

      <div style={{
        padding: '15px',
        backgroundColor: callState === 'connected' ? '#d4edda' : callState === 'idle' ? '#f8f9fa' : '#fff3cd',
        border: `1px solid ${callState === 'connected' ? '#c3e6cb' : callState === 'idle' ? '#dee2e6' : '#ffeeba'}`,
        borderRadius: '8px',
        marginBottom: '20px',
        textAlign: 'center',
        fontWeight: '500',
        color: '#333',
        minHeight: '50px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        {status}
      </div>

      <div style={{
        padding: '12px',
        backgroundColor: '#fff',
        border: '1px solid #ddd',
        borderRadius: '8px',
        marginBottom: '20px',
        textAlign: 'center',
        fontSize: '18px',
        fontWeight: 'bold',
        color: phoneNumber ? '#007bff' : '#999'
      }}>
        {phoneNumber || "No number"}
      </div>

      <div style={{
        marginBottom: '15px',
        textAlign: 'center',
        fontSize: '12px',
        color: '#666'
      }}>
        Call State: <strong>{callState}</strong>
      </div>

      <div style={{
        display: 'flex',
        gap: '10px',
        justifyContent: 'center'
      }}>
        <button
          onClick={redial}
          disabled={isCallActive || !phoneNumber}
          style={{
            flex: 1,
            padding: '12px 20px',
            fontSize: '16px',
            fontWeight: '600',
            border: 'none',
            borderRadius: '8px',
            cursor: (isCallActive || !phoneNumber) ? 'not-allowed' : 'pointer',
            backgroundColor: (isCallActive || !phoneNumber) ? '#ccc' : '#28a745',
            color: '#fff',
            transition: 'all 0.2s',
            opacity: (isCallActive || !phoneNumber) ? 0.6 : 1
          }}
          onMouseOver={(e) => {
            if (!isCallActive && phoneNumber) {
              e.target.style.backgroundColor = '#218838';
            }
          }}
          onMouseOut={(e) => {
            if (!isCallActive && phoneNumber) {
              e.target.style.backgroundColor = '#28a745';
            }
          }}
        >
          🔄 Redial
        </button>
        
        <button
          onClick={hangup}
          disabled={!isCallActive}
          style={{
            flex: 1,
            padding: '12px 20px',
            fontSize: '16px',
            fontWeight: '600',
            border: 'none',
            borderRadius: '8px',
            cursor: !isCallActive ? 'not-allowed' : 'pointer',
            backgroundColor: !isCallActive ? '#ccc' : '#dc3545',
            color: '#fff',
            transition: 'all 0.2s',
            opacity: !isCallActive ? 0.6 : 1
          }}
          onMouseOver={(e) => {
            if (isCallActive) {
              e.target.style.backgroundColor = '#c82333';
            }
          }}
          onMouseOut={(e) => {
            if (isCallActive) {
              e.target.style.backgroundColor = '#dc3545';
            }
          }}
        >
          📴 Hang Up
        </button>
      </div>

      <div style={{
        marginTop: '20px',
        padding: '10px',
        backgroundColor: '#e9ecef',
        borderRadius: '6px',
        fontSize: '11px',
        color: '#666'
      }}>
        Debug: Hangup button is {isCallActive ? 'ENABLED' : 'DISABLED'}
        <br />
        Connection exists: {connectionRef.current ? 'YES' : 'NO'}
      </div>
    </div>
  );
}