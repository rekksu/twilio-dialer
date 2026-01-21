import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [device, setDevice] = useState(null);
  const connectionRef = useRef(null);
  const [phoneNumber, setPhoneNumber] = useState("");

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const urlNumber = urlParams.get("to");
    if (urlNumber) setPhoneNumber(urlNumber);
  }, []);

  useEffect(() => {
    if (phoneNumber) startCall();
  }, [phoneNumber]);

  const startCall = async () => {
    if (!phoneNumber) {
      setStatus("❌ No number provided in ?to=");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (!stream) return setStatus("❌ Microphone denied");

    const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
    const { token } = await res.json();
    setStatus("Initializing Twilio Device…");

    const twilioDevice = new Device(token, { enableRingingState: true });
    setDevice(twilioDevice);

    twilioDevice.on("ready", () => setStatus("Device ready. Calling…"));
    twilioDevice.on("error", (err) => setStatus(`Device error: ${err.message}`));

    twilioDevice.register();

    // Create and store connection immediately
    const conn = twilioDevice.connect({ params: { To: phoneNumber } });
    connectionRef.current = conn;

    conn.on("accept", () => setStatus("Call connected"));
    conn.on("disconnect", () => setStatus("Call ended"));
    conn.on("error", (err) => setStatus(`Call failed: ${err.message}`));
  };

  const hangup = () => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
      connectionRef.current = null;
      setStatus("Call ended (hung up)");
    }
    if (device) {
      device.destroy();
      setDevice(null);
    }
  };

  return (
    <div style={{ textAlign: "center", padding: 50 }}>
      <h2>Twilio Web Dialer</h2>
      <p>Status: {status}</p>
      <button onClick={hangup}>Hang Up</button>
    </div>
  );
}
