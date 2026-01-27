import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

// Your Firebase Cloud Function URL to fetch Twilio token
const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function InboundAgent() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const [status, setStatus] = useState("Click Start Phone to initialize");
  const [incoming, setIncoming] = useState(false);

  // ✅ Start device on user gesture (fixes AudioContext issue)
  const startDevice = async () => {
    try {
      setStatus("Initializing...");

      // 🔑 Resume AudioContext on user gesture
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();

      // 1️⃣ Fetch Twilio token
      const res = await fetch(`${TOKEN_URL}?identity=agent`);
      const { token } = await res.json();

      // 2️⃣ Create Device
      const device = new Device(token, { enableRingingState: true, closeProtection: true });
      deviceRef.current = device;

      device.on("error", (err) => {
        console.error("Device error:", err);
        setStatus("❌ Device error: " + err.message);
      });

      // 🔴 3️⃣ Register device (mandatory for inbound calls)
      setStatus("Registering device...");
      await device.register();
      setStatus("✅ Device ready");

      // 🔔 4️⃣ Handle incoming calls
      device.on("incoming", (call) => {
        console.log("📞 Incoming call:", call.parameters.From);
        callRef.current = call;
        setIncoming(true);
        setStatus("📞 Incoming call...");

        call.on("disconnect", () => {
          setIncoming(false);
          setStatus("📴 Call ended");
        });

        call.on("error", (err) => {
          setIncoming(false);
          console.error("Call error:", err);
          setStatus("❌ Call error");
        });
      });
    } catch (err) {
      console.error(err);
      setStatus("❌ Failed to initialize device");
    }
  };

  // Accept inbound call
  const acceptCall = () => {
    if (callRef.current) {
      callRef.current.accept();
      setIncoming(false);
      setStatus("✅ Call connected");
    }
  };

  // Reject inbound call
  const rejectCall = () => {
    if (callRef.current) {
      callRef.current.reject();
      setIncoming(false);
      setStatus("❌ Call rejected");
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2 style={styles.title}>📞 Inbound Agent</h2>

        <div style={styles.status}>{status}</div>

        {/* Button to start device */}
        <button style={styles.startButton} onClick={startDevice}>
          Start Phone
        </button>

        {/* Incoming call UI */}
        {incoming && (
          <div style={styles.incomingContainer}>
            <button style={styles.acceptButton} onClick={acceptCall}>
              Accept
            </button>
            <button style={styles.rejectButton} onClick={rejectCall}>
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---- Styles ----
const styles = {
  container: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#f0f2f5",
  },
  card: {
    background: "#fff",
    padding: 30,
    borderRadius: 12,
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center", // center all content horizontally
  },
  title: {
    marginBottom: 20,
  },
  status: {
    margin: "15px 0",
    padding: 10,
    borderRadius: 8,
    background: "#e0e0e0",
    fontWeight: "bold",
    width: "100%",
    textAlign: "center",
  },
  startButton: {
    background: "#1976d2",
    color: "#fff",
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: "bold",
    marginBottom: 15,
  },
  incomingContainer: {
    display: "flex",
    justifyContent: "center",
    gap: "15px", // space between Accept and Reject buttons
    marginTop: 15,
    flexWrap: "wrap", // mobile-friendly: stack buttons if narrow
  },
  acceptButton: {
    background: "#2e7d32",
    color: "#fff",
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: "bold",
  },
  rejectButton: {
    background: "#d32f2f",
    color: "#fff",
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
    fontWeight: "bold",
  },
};
