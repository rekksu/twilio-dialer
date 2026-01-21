import React, { useState } from "react";
import { Device } from "@twilio/voice-sdk";
import axios from "axios";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Click 'Start Call' to initialize");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);

  // Static number
  const toNumber = "+639215991234";

  const checkMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      console.log("Microphone access allowed ✅");
      return true;
    } catch (err) {
      console.error("Microphone access denied ❌", err);
      setStatus(
        "Microphone access denied. Please allow microphone and refresh page."
      );
      return false;
    }
  };

  const startCall = async () => {
    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    try {
      setStatus("Fetching Twilio token…");

      const res = await axios.get(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const token = res.data.token;

      console.log("Twilio token fetched:", token);

      setStatus("Initializing Twilio Device…");

      const twilioDevice = new Device(token, { enableRingingState: true });

      // Log all events
      ["ready", "error", "offline", "connect", "disconnect", "incoming", "cancel", "tokenExpired"]
        .forEach(evt => {
          twilioDevice.on(evt, (...args) => console.log(evt, args));
        });

      // When ready, make the call
      twilioDevice.on("ready", () => {
        console.log("Device ready ✅");
        setStatus(`Calling ${toNumber}…`);
        const conn = twilioDevice.connect({ To: toNumber });
        setConnection(conn);
      });

      twilioDevice.on("error", (err) => {
        console.error("Twilio Device Error:", err);
        setStatus("Twilio Device Error: " + err.message);
      });

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
      <h2>Twilio Web Dialer (TwiML Bin)</h2>
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
