import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken?identity=agent";

export default function App() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const [status, setStatus] = useState("Initializing...");

  useEffect(() => {
    const initDevice = async () => {
      try {
        console.log("Fetching token...");
        const res = await fetch(TOKEN_URL);
        const data = await res.json();

        if (!data.token) {
          throw new Error("No token returned");
        }

        console.log("Token received");

        const device = new Device(data.token, {
          codecPreferences: ["opus", "pcmu"],
          enableRingingState: true,
        });

        device.on("ready", () => {
          console.log("✅ Device Ready");
          setStatus("Ready");
        });

        device.on("error", (error) => {
          console.error("❌ Device error:", error);
          setStatus("Error: " + error.message);
        });

        // 🔴 INBOUND CALL
        device.on("incoming", (call) => {
          console.log("📞 Incoming call from:", call.parameters.From);
          setStatus("Incoming call");
          callRef.current = call;

          call.accept();

          call.on("disconnect", () => {
            console.log("📴 Call ended");
            setStatus("Call ended");
            callRef.current = null;
          });
        });

        deviceRef.current = device;
      } catch (err) {
        console.error("Initialization failed:", err);
        setStatus("Init failed");
      }
    };

    initDevice();

    return () => {
      if (deviceRef.current) {
        deviceRef.current.destroy();
      }
    };
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h2>Agent Phone</h2>
      <p>Status: {status}</p>
    </div>
  );
}
