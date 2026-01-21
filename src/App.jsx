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

    const mic = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
    if (!mic) return setStatus("❌ Microphone denied");

    try {
      setStatus("Fetching token...");
      const res = await fetch(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const { token } = await res.json();

      const twilioDevice = new Device(token, { enableRingingState: true });
      setDevice(twilioDevice);

      twilioDevice.on("ready", () => {
        setStatus("Device ready. Calling...");
        try {
          const conn = twilioDevice.connect({ params: { To: phoneNumber } });
          if (!conn) return setStatus("Connection failed");
          connectionRef.current = conn;

          conn.on("accept", () => setStatus("Call connected"));
          conn.on("disconnect", () => setStatus("Call ended"));
          conn.on("error", (err) => setStatus("Call error: " + err.message));
        } catch (err) {
          console.error("Connect failed:", err);
          setStatus("Connect failed: " + err.message);
        }
      });

      twilioDevice.on("error", (err) => setStatus("Device error: " + err.message));
      twilioDevice.register();

    } catch (err) {
      console.error("Token fetch or device init failed:", err);
      setStatus("Error: " + err.message);
    }
  };

  const hangup = () => {
    const conn = connectionRef.current;
    if (conn) {
      conn.disconnect();
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
