import React, { useState } from "react";
import { Device } from "@twilio/voice-sdk";
import axios from "axios";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Click 'Start Call' to initialize");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);

  const toNumber = new URLSearchParams(window.location.search).get("to");

  const startCall = async () => {
    try {
      setStatus("Fetching Twilio token…");

      const res = await axios.get(`${CLOUD_FUNCTION_URL}?identity=agent`, {
        timeout: 5000,
      });
      const token = res.data.token;

      setStatus("Initializing Twilio Device…");

      const twilioDevice = new Device(token, { enableRingingState: true });

      twilioDevice.on("ready", () => {
        console.log("Device ready");
        setStatus(`Calling ${toNumber}…`);
        const conn = twilioDevice.connect({ To: toNumber });
        setConnection(conn);
      });

      twilioDevice.on("error", (err) => {
        console.error("Twilio Device Error:", err);
        setStatus("Twilio Device Error: " + err.message);
      });

      twilioDevice.on("connect", () => setStatus("Call connected"));
      twilioDevice.on("disconnect", () => setStatus("Call ended"));

      setDevice(twilioDevice);
    } catch (err) {
      console.error("Failed to start call:", err);
      setStatus("Error: " + err.message);
    }
  };

  const hangup = () => {
    if (connection) connection.disconnect();
    if (device) device.destroy();
    setStatus("Call ended");
  };

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h2>Twilio Web Dialer</h2>
      <p>{status}</p>
      <button onClick={startCall} style={{ padding: "10px 16px", marginRight: 10 }}>
        Start Call
      </button>
      <button onClick={hangup} style={{ padding: "10px 16px" }}>
        Hang Up
      </button>
    </div>
  );
}
