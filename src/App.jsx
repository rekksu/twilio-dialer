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
  const [micMuted, setMicMuted] = useState(false);

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
    }
    return () => clearInterval(interval);
  }, [isConnected]);

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
          setMicMuted(false); // default mic on
        });

        conn.on("disconnect", () => {
          setStatus("Call ended");
          setIsConnected(false);
          setCallDuration(0);
          setConnection(null);
        });

        conn.on("error", (err) => {
          setStatus(`Call failed: ${err.message}`);
          setIsConnected(false);
          setCallDuration(0);
          setConnection(null);
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
    }
    if (device) {
      device.destroy();
    }
    setConnection(null);
    setDevice(null);
    setIsConnected(false);
    setCallDuration(0);
    setStatus("Call ended");
  };

  const redial = () => {
    hangup();
    setTimeout(() => {
      if (phoneNumber) {
        startCall();
      }
    }, 500);
  };

  const toggleMic = () => {
    if (connection) {
      connection.mute(!micMuted);
      setMicMuted(!micMuted);
    }
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

        {/* Call Duration */}
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
          {/* Redial */}
          <button 
            onClick={redial}
            style={{
              width: "70px",
              height: "70px",
              borderRadius: "50%",
              border: "none",
              background: "rgba(255,255,255,0.3)",
              color: "white",
              fontSize: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            🔄
          </button>

          {/* Mic Toggle */}
          <button
            onClick={toggleMic}
            style={{
              width: "70px",
              height: "70px",
              borderRadius: "50%",
              border: "none",
              background: micMuted ? "#f39c12" : "#3498db",
              color: "white",
              fontSize: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            {micMuted ? "🎤❌" : "🎤"}
          </button>

          {/* Hang Up */}
          <button 
            onClick={hangup}
            style={{
              width: "80px",
              height: "80px",
              borderRadius: "50%",
              border: "none",
              background: "#f44336",
              color: "white",
              fontSize: "40px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
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
