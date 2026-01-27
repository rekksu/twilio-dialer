import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function InboundAgent() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const [status, setStatus] = useState("Click Start Phone to initialize");
  const [incoming, setIncoming] = useState(false);

  const startDevice = async () => {
    try {
      setStatus("Initializing...");
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      await audioContext.resume();

      const res = await fetch(`${TOKEN_URL}?identity=agent`);
      const { token } = await res.json();

      const device = new Device(token, { enableRingingState: true, closeProtection: true });
      deviceRef.current = device;

      device.on("error", (err) => {
        console.error("Device error:", err);
        setStatus("❌ Device error: " + err.message);
      });

      setStatus("Registering device...");
      await device.register();
      setStatus("✅ Device ready");

      device.on("incoming", (call) => {
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

  const acceptCall = () => {
    if (callRef.current) {
      callRef.current.accept();
      setIncoming(false);
      setStatus("✅ Call connected");
    }
  };

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

        <button style={styles.startButton} onClick={startDevice}>
          Start Phone
        </button>

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
    width: "100vw",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#f0f2f5",
  },
  card: {
    width: 350,
    minHeight: 250,
    padding: 30,
    borderRadius: 12,
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center", // ⚡ Vertically center all content
    alignItems: "center",     // ⚡ Horizontally center all content
    background: "#fff",
    textAlign: "center",
  },
  title: {
    marginBottom: 15,
  },
  status: {
    padding: 10,
    borderRadius: 8,
    background: "#e0e0e0",
    fontWeight: "bold",
    textAlign: "center",
    width: "100%",
    marginBottom: 15,
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
    gap: "15px",
    marginTop: 10,
    flexWrap: "wrap",
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
