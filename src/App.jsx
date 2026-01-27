import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://<your-cloud-fn>/getVoiceToken?identity=agent";

export default function App() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const [status, setStatus] = useState("Initializing...");

  useEffect(() => {
    fetch(TOKEN_URL)
      .then(res => res.json())
      .then(data => {
        const device = new Device(data.token);

        device.on("ready", () => setStatus("Ready"));
        device.on("error", err => setStatus(err.message));

        // 🔴 INBOUND CALL
        device.on("incoming", call => {
          setStatus("Incoming call...");
          callRef.current = call;

          call.accept();

          call.on("disconnect", () => {
            setStatus("Call ended");
            callRef.current = null;
          });
        });

        deviceRef.current = device;
      });
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Agent Phone</h2>
      <p>Status: {status}</p>
    </div>
  );
}
