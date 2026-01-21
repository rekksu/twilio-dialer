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

  // Check microphone permission
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

    const res = await axios.get(`${CLOUD_FUNCTION_URL}?identity=agent`, {
      timeout: 5000,
    });
    const token = res.data.token;

    // ✅ Log token in console
    console.log("Twilio token fetched:", token);

    // Optional: display token in the UI (for debugging only)
    setStatus("Token fetched! Check console.\nInitializing Twilio Device…");

    const twilioDevice = new Device(token, { enableRingingState: true });

    // Log all events
    const events = [
      "ready",
      "error",
      "offline",
      "connect",
      "disconnect",
      "incoming",
      "cancel",
      "tokenExpired",
      "deviceDidReceiveIncoming",
      "incomingCall"
    ];

    events.forEach(evt => {
      twilioDevice.on(evt, (...args) => console.log(evt, args));
    });

    // When ready, automatically call the number
    twilioDevice.on("ready", () => {
      console.log("Device ready ✅");
      setStatus(`Calling ${toNumber}…`);
      if (toNumber) {
        const conn = twilioDevice.connect({ To: toNumber });
        setConnection(conn);
      } else {
        setStatus("Device ready, but no number provided in ?to=");
      }
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
      <h2>Twilio Web Dialer</h2>
      <p>{status}</p>
      <button
        onClick={startCall}
        style={{ padding: "10px 16px", marginRight: 10 }}
      >
        Start Call
      </button>
      <button onClick={hangup} style={{ padding: "10px 16px" }}>
        Hang Up
      </button>
    </div>
  );
}
