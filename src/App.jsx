import React, { useState, useEffect, useRef } from "react";
import { Device } from "@twilio/voice-sdk";

const Softphone = ({ agentId }) => {
  const [device, setDevice] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const [incomingCall, setIncomingCall] = useState(null);
  const connectionRef = useRef(null);

  // ✅ Get Twilio Voice Token
  const fetchToken = async () => {
    try {
      const res = await fetch(
        `https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken?identity=${encodeURIComponent(agentId)}`
      );
      const data = await res.json();
      return data.token;
    } catch (err) {
      console.error("Error fetching token:", err);
      return null;
    }
  };

  // ✅ Initialize Twilio Device
  useEffect(() => {
    const initDevice = async () => {
      const token = await fetchToken();
      if (!token) return;

      const dev = new Device(token, { edge: "roaming", codecPreferences: ["opus", "pcmu"] });
      setDevice(dev);

      dev.on("ready", () => setStatus("ready"));
      dev.on("error", (err) => {
        console.error("Twilio Device Error:", err);
        setStatus("error");
      });

      // Incoming call event
      dev.on("incoming", (conn) => {
        console.log("Incoming call:", conn.parameters.From);
        setIncomingCall(conn);
      });

      // Call connected/disconnected
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

  // ✅ Answer incoming call
  const answerCall = () => {
    if (incomingCall) {
      incomingCall.accept();
      setIncomingCall(null);
    }
  };

  // ✅ Hangup current call
  const hangupCall = () => {
    if (connectionRef.current) {
      connectionRef.current.disconnect();
    }
  };

  // ✅ Make outbound call
  const makeCall = (toNumber) => {
    if (device) {
      device.connect({ To: toNumber });
    }
  };

  return (
    <div style={{ padding: 20, border: "1px solid #ccc", width: 300 }}>
      <h3>Softphone</h3>
      <p>Status: {status}</p>

      {incomingCall && (
        <div>
          <p>Incoming call from {incomingCall.parameters.From}</p>
          <button onClick={answerCall}>Answer</button>
          <button onClick={() => incomingCall.reject()}>Reject</button>
        </div>
      )}

      {status === "ready" && (
        <div>
          <input id="outboundNumber" placeholder="Enter number" />
          <button
            onClick={() => {
              const number = document.getElementById("outboundNumber").value;
              makeCall(number);
            }}
          >
            Call
          </button>
        </div>
      )}

      {status === "in-call" && <button onClick={hangupCall}>Hang Up</button>}
    </div>
  );
};

export default Softphone;
