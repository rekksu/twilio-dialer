import React, { useState } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Enter a phone number and click 'Start Call'");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  // Get number from URL or use manual input
  const urlParams = new URLSearchParams(window.location.search);
  const urlNumber = urlParams.get("to");

  React.useEffect(() => {
    if (urlNumber) {
      setPhoneNumber(urlNumber);
    }
  }, [urlNumber]);

  const checkMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      console.log("✅ Microphone access granted");
      return true;
    } catch (err) {
      console.error("❌ Microphone access denied", err);
      setStatus("❌ Microphone access denied. Please allow microphone and refresh.");
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
      setStatus("❌ Please enter a valid phone number (e.g., +639215991234)");
      return;
    }

    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    try {
      setStatus("🔄 Fetching Twilio token…");

      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const data = await res.json();
      const token = data.token;

      console.log("✅ Token received");
      setStatus("🔄 Initializing device…");

      const twilioDevice = new Device(token, { 
        enableRingingState: true,
        codecPreferences: ["opus", "pcmu"],
        logLevel: 1
      });

      twilioDevice.on("registered", () => {
        console.log("✅ Device registered");
        setStatus(`📞 Calling ${formattedNumber}…`);

        const conn = twilioDevice.connect({
          params: { To: formattedNumber }
        });

        conn.on("accept", () => {
          console.log("✅ Call connected!");
          setStatus(`✅ Connected to ${formattedNumber}`);
        });

        conn.on("disconnect", () => {
          console.log("📴 Call disconnected");
          setStatus("Call ended");
        });

        conn.on("error", (err) => {
          console.error("❌ Call error:", err);
          setStatus(`❌ Call failed: ${err.message}`);
          
          if (err.code === 31005) {
            setStatus("❌ Connection failed. Check: 1) TwiML Bin config, 2) Phone number is verified (trial accounts), 3) Number format is +[country][number]");
          }
        });

        setConnection(conn);
      });

      twilioDevice.on("error", (err) => {
        console.error("❌ Device error:", err);
        setStatus(`❌ Device error: ${err.message}`);
      });

      twilioDevice.register();
      setDevice(twilioDevice);

    } catch (err) {
      console.error("❌ Failed to start call:", err);
      setStatus(`❌ Error: ${err.message}`);
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
    setStatus("Call ended");
  };

  return (
    <div style={{ 
      maxWidth: "500px", 
      margin: "50px auto", 
      padding: "30px", 
      fontFamily: "system-ui, -apple-system, sans-serif",
      border: "1px solid #ddd",
      borderRadius: "8px",
      boxShadow: "0 2px 8px rgba(0,0,0,0.1)"
    }}>
      <h2 style={{ marginTop: 0 }}>🌐 Twilio Web Dialer</h2>
      
      <div style={{ marginBottom: "20px" }}>
        <label style={{ display: "block", marginBottom: "8px", fontWeight: "500" }}>
          Phone Number:
        </label>
        <input
          type="text"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(e.target.value)}
          placeholder="+639215991234"
          style={{
            width: "100%",
            padding: "10px",
            fontSize: "16px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            boxSizing: "border-box"
          }}
        />
        <small style={{ color: "#666", display: "block", marginTop: "5px" }}>
          Format: +[country code][number] (e.g., +639215991234)
        </small>
      </div>

      <div style={{ 
        padding: "15px", 
        background: "#f5f5f5", 
        borderRadius: "4px",
        marginBottom: "20px",
        minHeight: "50px",
        fontSize: "14px"
      }}>
        {status}
      </div>

      <div style={{ display: "flex", gap: "10px" }}>
        <button 
          onClick={startCall}
          disabled={!phoneNumber || connection}
          style={{
            flex: 1,
            padding: "12px",
            fontSize: "16px",
            fontWeight: "500",
            background: connection ? "#ccc" : "#4CAF50",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: connection ? "not-allowed" : "pointer"
          }}
        >
          📞 Start Call
        </button>
        <button 
          onClick={hangup}
          disabled={!connection}
          style={{
            flex: 1,
            padding: "12px",
            fontSize: "16px",
            fontWeight: "500",
            background: !connection ? "#ccc" : "#f44336",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: !connection ? "not-allowed" : "pointer"
          }}
        >
          📴 Hang Up
        </button>
      </div>

      <div style={{ marginTop: "20px", fontSize: "13px", color: "#666" }}>
        <strong>Troubleshooting 31005 Error:</strong>
        <ul style={{ marginTop: "10px", paddingLeft: "20px" }}>
          <li>Verify TwiML Bin uses correct callerId</li>
          <li>Check phone number format (+country code)</li>
          <li>For trial accounts: verify destination number</li>
          <li>Check browser console for detailed logs</li>
        </ul>
      </div>
    </div>
  );
}