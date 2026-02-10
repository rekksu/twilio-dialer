import React, { useEffect, useState, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const Softphone = ({ agentId }) => {
  const [device, setDevice] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const [incomingCall, setIncomingCall] = useState(null);
  const connectionRef = useRef(null);

  // 1️⃣ Fetch Twilio Voice Token
  const fetchToken = async () => {
    try {
      const res = await fetch(
        `https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken?identity=nzyw7V0euigyqjQaHj2Mn0PizUD2`
      );
      const data = await res.json();
      return data.token;
    } catch (err) {
      console.error("Error fetching token:", err);
      return null;
    }
  };

  // 2️⃣ Initialize Twilio Device
  useEffect(() => {
    const initDevice = async () => {
      const token = await fetchToken();
      if (!token) return;

      const dev = new Device(token, { codecPreferences: ["opus", "pcmu"], edge: "roaming" });
      setDevice(dev);

      dev.on("ready", () => setStatus("ready"));
      dev.on("error", (err) => {
        console.error("Twilio Device Error:", err);
        setStatus("error");
      });

      // Incoming call
      dev.on("incoming", (conn) => {
        console.log("Incoming call from:", conn.parameters.From);
        setIncomingCall(conn);
      });

      // Call connected / disconnected
      dev.on("connect", (conn) => {
        console.log("Call connected");
        connectionRef.current = conn;
        setStatus("in-call");
      });
      dev.on("disconnect", () => {
        console.log("Call ended");
        connectionRef.current = null;
        setStatus("ready");
      });
    };

    initDevice();

    return () => {
      if (device) device.destroy();
    };
  }, [agentId]);

  // 3️⃣ Answer incoming call
  const answerCall = () => {
    if (incomingCall) {
      incomingCall.accept();
      setIncomingCall(null);
    }
  };

  // 4️⃣ Hangup current call
  const hangupCall = () => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
    }
  };

  return (
    <div style={{ padding: 20, border: "1px solid #ccc", width: 300 }}>
      <h3>Agent Softphone</h3>
      <p>Status: {status}</p>

      {incomingCall && (
        <div>
          <p>Incoming call from {incomingCall.parameters.From}</p>
          <button onClick={answerCall}>Answer</button>
          <button onClick={() => incomingCall.reject()}>Reject</button>
        </div>
      )}

      {status === "in-call" && <button onClick={hangupCall}>Hang Up</button>}
    </div>
  );
};

export default Softphone;
