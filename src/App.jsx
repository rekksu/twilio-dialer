import React, { useState } from "react";
import { Device } from "@twilio/voice-sdk";
import axios from "axios";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Click 'Start Call' to initialize");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);

  const toNumber = "+639215991234"; // Static number for testing

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
      [
        "ready",
        "registered",
        "error",
        "offline",
        "connect",
        "disconnect",
        "incoming",
        "cancel",
        "tokenExpired"
      ].forEach(evt => {
        twilioDevice.on(evt, (...args) => console.log(evt, args));
      });

      // Explicitly register the Device
      twilioDevice.register();

      twilioDevice.on("registered", () => {
        console.log("Device registered ✅");
        setStatus("Device registered, ready to call…");

        // Automatically make the call
        if (toNumber) {
          setStatus(`Calling ${toNumber}…`);
          const conn = twilioDevice.connect({ To: toNumber });
          setConnection(conn);
        }
      });

      twilioDevice.on("ready", () => {
        console.log("Device ready ✅");
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
