import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function InboundPhone({ agentId }) {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [status, setStatus] = useState("Initializing…");

  useEffect(() => {
    const initDevice = async () => {
      const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
      const { token } = await res.json();

      const device = new Device(token, { enableRingingState: true });
      deviceRef.current = device;

      audioRef.current = new Audio();
      audioRef.current.autoplay = true;
      device.audio.incoming(audioRef.current);

      device.on("incoming", (call) => {
        callRef.current = call;
        setIncoming(true);
        setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);

        call.on("disconnect", () => {
          setIncoming(false);
          setInCall(false);
          setStatus("✅ Ready");
        });
        call.on("error", (err) => console.error(err));
      });

      await device.register();
      setStatus("✅ Ready");
    };
    initDevice();
  }, [agentId]);

  const accept = () => {
    callRef.current?.accept();
    setIncoming(false);
    setInCall(true);
    setStatus("✅ Connected");
  };

  const reject = () => {
    callRef.current?.reject();
    setIncoming(false);
    setInCall(false);
    setStatus("✅ Ready");
  };

  const hangup = () => {
    callRef.current?.disconnect();
    setInCall(false);
    setIncoming(false);
    setStatus("✅ Ready");
  };

  if (!agentId) return <p>No agentId provided</p>;

  return (
    <div>
      <h3>{status}</h3>
      {incoming && (
        <>
          <button onClick={accept}>Accept</button>
          <button onClick={reject}>Reject</button>
        </>
      )}
      {inCall && <button onClick={hangup}>Hang Up</button>}
    </div>
  );
}
