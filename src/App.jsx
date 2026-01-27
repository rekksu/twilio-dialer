import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);

  const [status, setStatus] = useState("Initializing...");
  const [incoming, setIncoming] = useState(false);

  useEffect(() => {
    const initDevice = async () => {
      try {
        setStatus("Fetching token...");

        const res = await fetch(`${TOKEN_URL}?identity=agent`);
        const { token } = await res.json();

        const device = new Device(token, {
          enableRingingState: true,
          closeProtection: true,
        });

        deviceRef.current = device;

        device.on("error", (err) => {
          console.error(err);
          setStatus("❌ Device error");
        });

        // 🔴 REQUIRED FOR INBOUND
        await device.register();
        setStatus("✅ Device ready (inbound)");

        // 🔔 INBOUND CALL
        device.on("incoming", (call) => {
          console.log("Incoming call");
          callRef.current = call;
          setIncoming(true);
          setStatus("📞 Incoming call");

          call.on("disconnect", () => {
            setIncoming(false);
            setStatus("📴 Call ended");
          });

          call.on("error", () => {
            setIncoming(false);
            setStatus("❌ Call error");
          });
        });

      } catch (err) {
        console.error(err);
        setStatus("❌ Init failed");
      }
    };

    initDevice();
  }, []);

  const acceptCall = () => {
    callRef.current?.accept();
    setIncoming(false);
    setStatus("✅ Connected");
  };

  const rejectCall = () => {
    callRef.current?.reject();
    setIncoming(false);
    setStatus("❌ Rejected");
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h2>📞 Inbound Agent</h2>

        <div style={styles.status}>{status}</div>

        {incoming && (
          <div>
            <button style={styles.accept} onClick={acceptCall}>
              Accept
            </button>
            <button style={styles.reject} onClick={rejectCall}>
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    height: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f2f5",
  },
  card: {
    background: "#fff",
    padding: 30,
    borderRadius: 12,
    boxShadow: "0 6px 20px rgba(0,0,0,0.15)",
    textAlign: "center",
  },
  status: {
    margin: "15px 0",
    padding: 10,
    borderRadius: 8,
    background: "#e0e0e0",
    fontWeight: "bold",
  },
  accept: {
    background: "#2e7d32",
    color: "#fff",
    padding: "10px 20px",
    marginRight: 10,
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  reject: {
    background: "#d32f2f",
    color: "#fff",
    padding: "10px 20px",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
};
