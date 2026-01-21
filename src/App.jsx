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
        // Make the call only after device is registered
        const conn = twilioDevice.connect({ params: { To: formattedNumber } });
        setConnection(conn);

        conn.on("accept", () => {
          setStatus("Call connected");
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
      });

      twilioDevice.on("error", (err) => {
        setStatus(`Device error: ${err.message}`);
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

  const redial = () => {
    hangup();
    setTimeout(() => startCall(), 500);
  };

  return (
    <div className="container">
      <h2 className="title">Twilio Web Dialer</h2>

      <div className="status">{status}</div>

      <div className="phone-number">{phoneNumber || "No number"}</div>

      <div className="buttons">
        <button className="redial-btn" onClick={redial} disabled={isConnected || !phoneNumber}>
          🔄 Redial
        </button>
        <button className="hangup-btn" onClick={hangup} disabled={!isConnected}>
          📴 Hang Up
        </button>
      </div>
    </div>
  );
}
