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
    if (connection) {
      connection.disconnect();
      setConnection(null);
    }
    if (device) {
      device.destroy();
      setDevice(null);
    }
    setIsConnected(false);
    setStatus("Call ended");
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "100vh",
      background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
      fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      padding: "20px"
    }}>
      <div style={{
        width: "400px",
        background: "#fff",
        borderRadius: "30px",
        padding: "50px 30px 40px",
        boxShadow: "0 25px 60px rgba(0,0,0,0.25)",
        textAlign: "center",
        transition: "all 0.3s ease"
      }}>
        {/* Status Indicator */}
        <div style={{
          position: "relative",
          width: "90px",
          height: "90px",
          margin: "0 auto 25px",
          background: isConnected ? "#4CAF50" : "#ccc",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "38px",
          color: "#fff",
          boxShadow: "0 0 15px rgba(0,0,0,0.2)",
        }}>
          {isConnected ? "📞" : "📴"}
          {isConnected && (
            <span style={{
              content: '""',
              position: "absolute",
              top: "-10px",
              left: "-10px",
              width: "110px",
              height: "110px",
              borderRadius: "50%",
              border: "3px solid rgba(76, 175, 80, 0.5)",
              animation: "pulse-ring 1.5s infinite"
            }} />
          )}
        </div>

        {/* Phone Number Display */}
        <div style={{
          fontSize: "24px",
          fontWeight: "600",
          color: "#333",
          marginBottom: "10px",
          wordBreak: "break-all"
        }}>
          {phoneNumber || "No number"}
        </div>

        {/* Status Text */}
        <div style={{
          fontSize: "16px",
          color: "#666",
          marginBottom: "20px",
          minHeight: "24px"
        }}>
          {status}
        </div>

        {/* Call Duration */}
        {isConnected && (
          <div style={{
            fontSize: "32px",
            fontWeight: "500",
            color: "#4CAF50",
            marginBottom: "30px",
            fontVariantNumeric: "tabular-nums"
          }}>
            {formatTime(callDuration)}
          </div>
        )}

        {/* Hang Up Button */}
        <button 
          onClick={hangup}
          disabled={!connection}
          style={{
            width: "90px",
            height: "90px",
            borderRadius: "50%",
            border: "none",
            background: connection ? "#f44336" : "#ccc",
            color: "white",
            fontSize: "38px",
            cursor: connection ? "pointer" : "not-allowed",
            boxShadow: connection ? "0 6px 20px rgba(244, 67, 54, 0.5)" : "none",
            transition: "all 0.3s ease",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto"
          }}
          onMouseDown={(e) => {
            if (connection) e.currentTarget.style.transform = "scale(0.95)";
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

        {/* Keyframes */}
        <style>{`
          @keyframes pulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
          }
          @keyframes pulse-ring {
            0% {
              transform: scale(0.9);
              opacity: 0.6;
            }
            70% {
              transform: scale(1.2);
              opacity: 0;
            }
            100% {
              transform: scale(0.9);
              opacity: 0;
            }
          }
        `}</style>
      </div>
    </div>
  );
}
