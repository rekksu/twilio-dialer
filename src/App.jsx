import React, { useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken?identity=agent";

export default function App() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const [status, setStatus] = useState("Click Start Phone");

  const startPhone = async () => {
    try {
      console.log("🔵 Start clicked");
      setStatus("Fetching token...");

      // 🔓 Required user gesture for audio
      const audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
      await audioContext.resume();

      // 1️⃣ Fetch token
      const res = await fetch(TOKEN_URL);
      const data = await res.json();

      if (!data.token) {
        throw new Error("No token returned");
      }

      console.log("🔵 Token received");
      setStatus("Initializing device...");

      // 2️⃣ Create device
      const device = new Device(data.token, {
        codecPreferences: ["opus", "pcmu"],
        enableRingingState: true,
      });

      // 3️⃣ Register device (🔥 REQUIRED IN SDK v2)
      await device.register();

      // 4️⃣ Events
      device.on("ready", () => {
        console.log("✅ Device Ready");
        setStatus("Ready");
      });

      device.on("error", (error) => {
        console.error("❌ Device error:", error);
        setStatus("Error: " + error.message);
      });

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
      console.error("❌ Start failed:", err);
      setStatus("Failed: " + err.message);
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Agent Phone</h2>

      <button onClick={startPhone} disabled={status === "Ready"}>
        Start Phone
      </button>

      <p>Status: {status}</p>
    </div>
  );
}
