import React, { useState, useEffect } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  // Get number from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    if (urlNumber) {
      setPhoneNumber(urlNumber);
    } else {
      setStatus("❌ No phone number provided in URL (?to=+1234567890)");
    }
  }, []);

  // Timer for call duration
  useEffect(() => {
    let interval;
    if (isConnected) {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  // Auto-call when phone number is available
  useEffect(() => {
    if (phoneNumber && !device) {
      startCall();
    }
  }, [phoneNumber]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
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
    if (!cleaned.startsWith("+")) {
      cleaned = "+" + cleaned;
    }
    return cleaned;
  };

  const startCall = async () => {
    const formattedNumber = formatPhoneNumber(phoneNumber);
    
    if (!formattedNumber || formattedNumber.length < 10) {
      setStatus("❌ Invalid phone number");
      return;
    }

    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    try {
      setStatus("Connecting...");

      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const data = await res.json();
      const token = data.token;

      const twilioDevice = new Device(token, { 
        enableRingingState: true,
        codecPreferences: ["opus", "pcmu"],
        logLevel: 1
      });

      twilioDevice.on("registered", () => {
        setStatus("Calling...");

        const conn = twilioDevice.connect({
          params: { To: formattedNumber }
        });

        conn.on("accept", () => {
          setStatus("Connected");
          setIsConnected(true);
        });

        conn.on("disconnect", () => {
          setStatus("Call ended");
          setIsConnected(false);
        });

        conn.on("error", (err) => {
          setStatus(`Call failed: ${err.message}`);
          setIsConnected(false);
        });

        setConnection(conn);
      });

      twilioDevice.on("error", (err) => {
        setStatus(`Error: ${err.message}`);
      });

      twilioDevice.register();
      setDevice(twilioDevice);

    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const hangup = () => {
    console.log("Hangup clicked");
    if (connection) {
      console.log("Disconnecting connection");
      connection.disconnect();
      setConnection(null);
    }
    if (device) {
      console.log("Destroying device");
      device.destroy();
      setDevice(null);
    }
    setIsConnected(false);
    setCallDuration(0);
    setStatus("Call ended");
  };

  const redial = () => {
    console.log("Redial clicked");
    hangup();
    setTimeout(() => {
      if (phoneNumber) {
        startCall();
      }
    }, 1000);
  };

  return (
    <div style={{ 
      width: "100%",
      height: "100vh",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    }}>
      {/* Status Bar */}
      <div style={{
        padding: "20px",
        background: "rgba(255,255,255,0.1)",
        backdropFilter: "blur(10px)",
        color: "white",
        textAlign: "center",
        fontSize: "14px",
        fontWeight: "500"
      }}>
        {status}
      </div>

      {/* Main Content */}
      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px"
      }}>
        {/* Status Indicator */}
        <div style={{
          width: "100px",
          height: "100px",
          margin: "0 auto 30px",
          background: isConnected ? "#4CAF50" : "rgba(255,255,255,0.2)",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "48px",
          animation: isConnected ? "pulse 2s infinite" : "none",
          boxShadow: "0 10px 30px rgba(0,0,0,0.2)"
        }}>
          {isConnected ? "📞" : "📴"}
        </div>

        {/* Phone Number Display */}
        <div style={{
          fontSize: "32px",
          fontWeight: "300",
          color: "white",
          marginBottom: "15px",
          wordBreak: "break-all",
          textAlign: "center",
          maxWidth: "90%"
        }}>
          {phoneNumber || "No number"}
        </div>

        {/* Call Duration - Always visible */}
        <div style={{
          fontSize: "48px",
          fontWeight: "200",
          color: "white",
          marginBottom: "60px",
          fontVariantNumeric: "tabular-nums",
          minHeight: "60px"
        }}>
          {formatTime(callDuration)}
        </div>

        {/* Action Buttons */}
        <div style={{
          display: "flex",
          gap: "40px",
          alignItems: "center",
          justifyContent: "center"
        }}>
          {/* Redial Button */}
          <button 
            onClick={redial}
            disabled={isConnected || !phoneNumber}
            style={{
              width: "70px",
              height: "70px",
              borderRadius: "50%",
              border: "none",
              background: (!isConnected && phoneNumber) ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.1)",
              color: "white",
              fontSize: "32px",
              cursor: (!isConnected && phoneNumber) ? "pointer" : "not-allowed",
              boxShadow: (!isConnected && phoneNumber) ? "0 4px 15px rgba(255,255,255,0.2)" : "none",
              transition: "all 0.3s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: (!isConnected && phoneNumber) ? "auto" : "none"
            }}
            onMouseDown={(e) => {
              if (!isConnected && phoneNumber) {
                e.currentTarget.style.transform = "scale(0.95)";
              }
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            🔄
          </button>

          {/* Hang Up Button */}
          <button 
            onClick={hangup}
            disabled={!isConnected}
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              border: "none",
              background: isConnected ? "#f44336" : "rgba(255,255,255,0.1)",
              color: "white",
              fontSize: "40px",
              cursor: isConnected ? "pointer" : "not-allowed",
              boxShadow: isConnected ? "0 6px 20px rgba(244, 67, 54, 0.5)" : "none",
              transition: "all 0.3s ease",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: isConnected ? "auto" : "none"
            }}
            onMouseDown={(e) => {
              if (isConnected) {
                e.currentTarget.style.transform = "scale(0.95)";
              }
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "scale(1)";
            }}
          >
            ✖️
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}