import React, { useState, useEffect } from "react";
import { Device } from "@twilio/voice-sdk";
import "./style.css"

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [callDuration, setCallDuration] = useState(0);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    if (urlNumber) setPhoneNumber(urlNumber);
    else setStatus("❌ No phone number provided in URL (?to=+1234567890)");
  }, []);

  useEffect(() => {
    let interval;
    if (isConnected) {
      interval = setInterval(() => setCallDuration(prev => prev + 1), 1000);
    } else {
      setCallDuration(0);
    }
    return () => clearInterval(interval);
  }, [isConnected]);

  useEffect(() => {
    if (phoneNumber && !device) startCall();
  }, [phoneNumber]);

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
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
    if (!formattedNumber || formattedNumber.length < 10) {
      setStatus("❌ Invalid phone number");
      return;
    }

    if (!(await checkMicPermission())) return;

    try {
      setStatus("Connecting...");
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const data = await res.json();
      const token = data.token;

      const twilioDevice = new Device(token, { enableRingingState: true, codecPreferences: ["opus","pcmu"], logLevel: 1 });

      twilioDevice.on("registered", () => {
        setStatus("Calling...");
        const conn = twilioDevice.connect({ params: { To: formattedNumber } });

        conn.on("accept", () => { setStatus("Connected"); setIsConnected(true); });
        conn.on("disconnect", () => { setStatus("Call ended"); setIsConnected(false); });
        conn.on("error", (err) => { setStatus(`Call failed: ${err.message}`); setIsConnected(false); });

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
    setConnection(null);
    setDevice(null);
    setIsConnected(false);
    setStatus("Call ended");
  };

  return (
    <div className="container">
      <div className="title">Twilio Call</div>
      <div className="status">{status}</div>
      <div className="phone-number">{phoneNumber || "No number"}</div>
      {isConnected && (
        <div style={{ fontSize: "28px", color: "#fff", marginBottom: "20px", fontVariantNumeric: "tabular-nums" }}>
          {formatTime(callDuration)}
        </div>
      )}
      <div className="buttons">
        <button className="redial-btn" onClick={startCall} disabled={isConnected || !phoneNumber}>
          🔄 Redial
        </button>
        <button className="hangup-btn" onClick={hangup} disabled={!connection}>
          ✖️ Hang Up
        </button>
      </div>
    </div>
  );
}
