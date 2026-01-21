import React, { useState, useEffect } from "react";
import { Device } from "@twilio/voice-sdk";
import "./style.css";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    if (urlNumber) setPhoneNumber(urlNumber);
    else setStatus("❌ No phone number provided in URL (?to=+1234567890)");
  }, []);

  useEffect(() => {
    if (phoneNumber && !device) startCall();
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

      const twilioDevice = new Device(token, { enableRingingState: true });
      twilioDevice.on("registered", () => {
        setStatus("Calling...");
        const conn = twilioDevice.connect({ params: { To: formattedNumber } });

        conn.on("accept", () => {
          setStatus("Connected");
          setIsConnected(true);
        });

        conn.on("disconnect", () => {
          setStatus("Call ended");
          setIsConnected(false);
          setConnection(null);
        });

        conn.on("error", (err) => {
          setStatus(`Call failed: ${err.message}`);
          setIsConnected(false);
          setConnection(null);
        });

        setConnection(conn);
      });

      twilioDevice.on("error", (err) => setStatus(`Error: ${err.message}`));

      twilioDevice.register();
      setDevice(twilioDevice);

    } catch (err) {
      setStatus(`Error: ${err.message}`);
    }
  };

  const hangup = () => {
    if (connection) connection.disconnect();
    if (device) device.destroy();
    setIsConnected(false);
    setConnection(null);
    setDevice(null);
    setStatus("Call ended");
  };

  const redial = () => {
    hangup();
    setTimeout(() => {
      if (phoneNumber) startCall();
    }, 1000);
  };

  return (
    <div className="main-content">
      <div className="status-bar">{status}</div>

      <div className={`status-indicator ${isConnected ? "connected" : "disconnected"}`}>
        {isConnected ? "📞" : "📴"}
      </div>

      <div className="phone-number">{phoneNumber || "No number"}</div>

      <div className="buttons-container">
        <button className="button-circle button-redial" onClick={redial}>🔄</button>
        <button className="button-circle button-hangup" onClick={hangup}>✖️</button>
      </div>
    </div>
  );
}
