// Softphone.jsx
import React, { useEffect, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const Softphone = ({ agentId }) => {
  const [device, setDevice] = useState(null);
  const [status, setStatus] = useState("disconnected");
  const [incomingCall, setIncomingCall] = useState(null);

  useEffect(() => {
    if (!agentId) return;

    console.log("[Softphone] Fetching token for agentId:", agentId);

    fetch(
      `https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken?identity=nzyw7V0euigyqjQaHj2Mn0PizUD2`
    )
      .then((res) => res.json())
      .then((data) => {
        console.log("[Softphone] Token response:", data);

        if (!data.token) {
          console.error("[Softphone] No token returned from server");
          setStatus("error: no token");
          return;
        }

        const twilioDevice = new Device(data.token, {
          codecPreferences: ["opus", "pcmu"],
          edge: "roaming",
          debug: true, // enables SDK logging
        });

        // Logging Twilio device events
        twilioDevice.on("ready", () => {
          console.log("[Twilio Device] Ready");
          setStatus("ready");
        });

        twilioDevice.on("error", (err) => {
          console.error("[Twilio Device] Error:", err);
          setStatus(`error: ${err.message}`);
        });

        twilioDevice.on("incoming", (connection) => {
          console.log("[Twilio Device] Incoming call:", connection.parameters);
          setIncomingCall(connection);

          // Auto accept after prompt
          if (window.confirm(`Incoming call from ${connection.parameters.From}. Accept?`)) {
            connection.accept();
          } else {
            connection.reject();
          }
        });

        twilioDevice.on("connect", (conn) => {
          console.log("[Twilio Device] Connected:", conn.parameters);
          setStatus("in call");
        });

        twilioDevice.on("disconnect", (conn) => {
          console.log("[Twilio Device] Disconnected:", conn.parameters);
          setStatus("ready");
          setIncomingCall(null);
        });

        setDevice(twilioDevice);
      })
      .catch((err) => {
        console.error("[Softphone] Failed to fetch token:", err);
        setStatus("error: fetch failed");
      });
  }, [agentId]);

  const hangUp = () => {
    if (device && device.activeConnection()) {
      device.activeConnection().disconnect();
    }
  };

  return (
    <div style={{ border: "1px solid #ccc", padding: 20, maxWidth: 400 }}>
      <h3>Softphone (Agent ID: {agentId})</h3>
      <p>Status: {status}</p>
      {incomingCall && (
        <div>
          <p>Incoming call from: {incomingCall.parameters.From}</p>
          <button onClick={() => incomingCall.accept()}>Accept</button>
          <button onClick={() => incomingCall.reject()}>Reject</button>
        </div>
      )}
      {status === "in call" && <button onClick={hangUp}>Hang Up</button>}
    </div>
  );
};

export default Softphone;
