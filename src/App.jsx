import React, { useState, useEffect } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isConnected, setIsConnected] = useState(false);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phoneNumber]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (connection) {
        connection.disconnect();
      }
      if (device) {
        device.unregister();
        device.destroy();
      }
    };
  }, [connection, device]);

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
        const conn = twilioDevice.connect({ params: { To: formattedNumber } });
        setConnection(conn);

        conn.on("accept", () => {
          setStatus("✅ Call connected");
          setIsConnected(true);
        });

        conn.on("disconnect", () => {
          setStatus("Call ended");
          setIsConnected(false);
          setConnection(null);
        });

        conn.on("error", (err) => {
          setStatus(`❌ Call failed: ${err.message}`);
          setIsConnected(false);
          setConnection(null);
        });
      });

      twilioDevice.on("error", (err) => {
        setStatus(`❌ Device error: ${err.message}`);
      });

      twilioDevice.register();
      setDevice(twilioDevice);

    } catch (err) {
      setStatus(`❌ Error: ${err.message}`);
    }
  };

  const hangup = () => {
    setStatus("Ending call...");
    
    if (connection) {
      try {
        connection.disconnect();
      } catch (err) {
        console.error("Error disconnecting:", err);
      }
    }
    
    if (device) {
      try {
        device.unregister();
        device.destroy();
      } catch (err) {
        console.error("Error destroying device:", err);
      }
    }
    
    setConnection(null);
    setDevice(null);
    setIsConnected(false);
    setStatus("Call ended");
  };

  const redial = () => {
    hangup();
    setTimeout(() => startCall(), 1000);
  };

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>📞 Twilio Web Dialer</h2>

      <div style={styles.status}>{status}</div>

      <div style={styles.phoneNumber}>{phoneNumber || "No number"}</div>

      <div style={styles.buttons}>
        <button 
          style={{...styles.button, ...styles.redialBtn}} 
          onClick={redial} 
          disabled={isConnected || !phoneNumber}
        >
          🔄 Redial
        </button>
        <button 
          style={{
            ...styles.button, 
            ...styles.hangupBtn,
            ...(isConnected ? {} : styles.disabled)
          }} 
          onClick={hangup} 
          disabled={!isConnected}
        >
          📴 Hang Up
        </button>
      </div>
    </div>
  );
}

const styles = {
  container: {
    maxWidth: "500px",
    margin: "50px auto",
    padding: "30px",
    backgroundColor: "#fff",
    borderRadius: "12px",
    boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
    fontFamily: "system-ui, -apple-system, sans-serif"
  },
  title: {
    textAlign: "center",
    color: "#333",
    marginBottom: "30px"
  },
  status: {
    padding: "15px",
    backgroundColor: "#f5f5f5",
    borderRadius: "8px",
    textAlign: "center",
    marginBottom: "20px",
    fontSize: "16px",
    color: "#555"
  },
  phoneNumber: {
    textAlign: "center",
    fontSize: "24px",
    fontWeight: "bold",
    color: "#007bff",
    marginBottom: "30px"
  },
  buttons: {
    display: "flex",
    gap: "15px",
    justifyContent: "center"
  },
  button: {
    padding: "12px 24px",
    fontSize: "16px",
    fontWeight: "600",
    border: "none",
    borderRadius: "8px",
    cursor: "pointer",
    transition: "all 0.2s",
    flex: 1
  },
  redialBtn: {
    backgroundColor: "#007bff",
    color: "white"
  },
  hangupBtn: {
    backgroundColor: "#dc3545",
    color: "white"
  },
  disabled: {
    opacity: 0.5,
    cursor: "not-allowed"
  }
}