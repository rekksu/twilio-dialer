import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  
  // Use refs to maintain references without triggering re-renders
  const deviceRef = useRef(null);
  const connectionRef = useRef(null);

  // Get number from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    if (urlNumber) {
      setPhoneNumber(urlNumber);
      setStatus("Ready to call…");
    } else {
      setStatus("❌ No phone number provided in URL (?to=+1234567890)");
    }
  }, []);

  // Start call immediately when phoneNumber is set
  useEffect(() => {
    if (phoneNumber) {
      startCall();
    }
    // Cleanup on unmount
    return () => {
      if (connectionRef.current) {
        connectionRef.current.disconnect();
      }
      if (deviceRef.current) {
        deviceRef.current.destroy();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

    try {
      setStatus("Fetching Twilio token…");
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const data = await res.json();
      const token = data.token;

      const twilioDevice = new Device(token, { enableRingingState: true });

      twilioDevice.on("registered", () => {
        setStatus(`Calling ${formattedNumber}…`);
        
        // Make the call
        const conn = twilioDevice.connect({ params: { To: formattedNumber } });
        connectionRef.current = conn;

        // Set up connection event listeners
        conn.on("accept", () => {
          setStatus("✅ Call connected");
          setIsConnected(true);
        });

        conn.on("disconnect", () => {
          setStatus("Call ended");
          setIsConnected(false);
          connectionRef.current = null;
        });

        conn.on("error", (err) => {
          console.error("Connection error:", err);
          setStatus(`❌ Call failed: ${err.message}`);
          setIsConnected(false);
          connectionRef.current = null;
        });

        conn.on("reject", () => {
          setStatus("❌ Call rejected");
          setIsConnected(false);
          connectionRef.current = null;
        });
      });

      twilioDevice.on("error", (err) => {
        console.error("Device error:", err);
        setStatus(`❌ Device error: ${err.message}`);
      });

      twilioDevice.on("unregistered", () => {
        console.log("Device unregistered");
      });

      twilioDevice.register();
      deviceRef.current = twilioDevice;

    } catch (err) {
      console.error("Start call error:", err);
      setStatus(`❌ Error: ${err.message}`);
    }
  };

  const hangup = () => {
    try {
      // Disconnect the active connection first
      if (connectionRef.current) {
        connectionRef.current.disconnect();
        connectionRef.current = null;
      }
      
      // Then destroy the device
      if (deviceRef.current) {
        deviceRef.current.unregister();
        deviceRef.current.destroy();
        deviceRef.current = null;
      }
      
      setIsConnected(false);
      setStatus("Call ended");
    } catch (err) {
      console.error("Hangup error:", err);
      setStatus("Call ended (with errors)");
      setIsConnected(false);
    }
  };

  const redial = () => {
    hangup();
    setTimeout(() => {
      if (phoneNumber) {
        startCall();
      }
    }, 1000);
  };

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
        backgroundColor: isConnected ? '#d4edda' : '#fff3cd',
        border: `1px solid ${isConnected ? '#c3e6cb' : '#ffeeba'}`,
        borderRadius: '8px',
        marginBottom: '20px',
        textAlign: 'center',
        fontWeight: '500',
        color: '#333'
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
        display: 'flex',
        gap: '10px',
        justifyContent: 'center'
      }}>
        <button
          onClick={redial}
          disabled={isConnected || !phoneNumber}
          style={{
            flex: 1,
            padding: '12px 20px',
            fontSize: '16px',
            fontWeight: '600',
            border: 'none',
            borderRadius: '8px',
            cursor: isConnected || !phoneNumber ? 'not-allowed' : 'pointer',
            backgroundColor: isConnected || !phoneNumber ? '#ccc' : '#28a745',
            color: '#fff',
            transition: 'all 0.2s',
            opacity: isConnected || !phoneNumber ? 0.6 : 1
          }}
        >
          🔄 Redial
        </button>
        
        <button
          onClick={hangup}
          disabled={!isConnected}
          style={{
            flex: 1,
            padding: '12px 20px',
            fontSize: '16px',
            fontWeight: '600',
            border: 'none',
            borderRadius: '8px',
            cursor: !isConnected ? 'not-allowed' : 'pointer',
            backgroundColor: !isConnected ? '#ccc' : '#dc3545',
            color: '#fff',
            transition: 'all 0.2s',
            opacity: !isConnected ? 0.6 : 1
          }}
        >
          📴 Hang Up
        </button>
      </div>
    </div>
  );
}