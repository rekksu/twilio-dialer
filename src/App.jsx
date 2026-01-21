import React, { useEffect, useState } from "react";
import { Device } from "@twilio/voice-sdk";
import axios from "axios";
import "./styles.css";

const CLOUD_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const [status, setStatus] = useState("Initializing…");
  const [device, setDevice] = useState(null);
  const [connection, setConnection] = useState(null);

  // Get phone number from query param ?to=...
  const getToNumber = () => {
    const params = new URLSearchParams(window.location.search);
    return params.get("to");
  };

  useEffect(() => {
    const toNumber = getToNumber();
    if (!toNumber) {
      setStatus("Missing phone number");
      return;
    }

    const startCall = async () => {
      try {
        setStatus("Fetching token…");
        const res = await axios.get(`${CLOUD_FUNCTION_URL}?identity=agent`);
        const token = res.data.token;

        const twilioDevice = new Device(token, { enableRingingState: true });

        twilioDevice.on("ready", () => {
          setStatus(`Calling ${toNumber}…`);
          const conn = twilioDevice.connect({ To: toNumber });
          setConnection(conn);
        });

        twilioDevice.on("connect", () => setStatus("Call connected"));
        twilioDevice.on("disconnect", () => setStatus("Call ended"));
        twilioDevice.on("error", (err) =>
          setStatus("Error: " + err.message)
        );

        setDevice(twilioDevice);
      } catch (err) {
        console.error(err);
        setStatus("Failed: " + err);
      }
    };

    startCall();

    // Cleanup on unmount
    return () => {
      if (connection) connection.disconnect();
      if (device) device.destroy();
    };
  }, []);

  const hangup = () => {
    if (connection) connection.disconnect();
    if (device) device.destroy();
    setStatus("Call ended");
  };

  return (
    <div className="App">
      <h2>Twilio Web Dialer</h2>
      <p>{status}</p>
      <button onClick={hangup}>Hang Up</button>
    </div>
  );
}
