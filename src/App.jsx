import React, { useState, useEffect } from "react";
import { Device } from "@twilio/voice-sdk";
import axios from "axios";

// Your Cloud Function that issues the Twilio token
const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

// Your TwiML Bin URL
const TWIML_BIN_URL = "https://handler.twilio.com/twiml/EH36ed64a3f2bb6c5d121d1ab114cc0d53";

export default function App() {
  const [status, setStatus] = useState("Initializing...");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);

  // Get dynamic number from URL
  const urlParams = new URLSearchParams(window.location.search);
  const toNumber = urlParams.get("to"); // ?to=+639215991234

  // Check microphone permission
  const checkMicPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
      console.log("Microphone access allowed ✅");
      return true;
    } catch (err) {
      console.error("Microphone access denied ❌", err);
      setStatus("Microphone access denied. Please allow microphone and refresh page.");
      return false;
    }
  };

  const startCall = async () => {
    if (!toNumber) {
      setStatus("No number provided in ?to=");
      return;
    }

    const micAllowed = await checkMicPermission();
    if (!micAllowed) return;

    try {
      setStatus("Fetching Twilio token…");

      const res = await axios.get(`${CLOUD_FUNCTION_URL}?identity=agent`);
      const token = res.data.token;
      console.log("Twilio token fetched:", token);

      setStatus("Initializing Twilio Device…");

      const twilioDevice = new Device(token, { enableRingingState: true });

      // Log events for debugging
      ["ready", "registered", "error", "offline", "connect", "disconnect"].forEach(evt => {
        twilioDevice.on(evt, (...args) => console.log(evt, args));
      });

      twilioDevice.register();

      // When device is ready, call TwiML Bin directly
      twilioDevice.on("registered", () => {
        console.log("Device registered ✅");
        setStatus(`Calling ${toNumber}…`);

        const conn = twilioDevice.connect({
          // Here we pass the TwiML Bin URL with ?To=
          twimlUrl: `${TWIML_BIN_URL}?To=${encodeURIComponent(toNumber)}`,
        });

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

  // Auto-start call on page load if ?to= exists
  useEffect(() => {
    startCall();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ textAlign: "center", padding: "20px" }}>
      <h2>Twilio Web Dialer (Direct TwiML Bin)</h2>
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
