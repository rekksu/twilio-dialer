import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

const firebaseConfig = { /* your config */ };
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TOKEN_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

export default function OrbitOutbound() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // URL params
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const accessKey = params.get("accessKey");
  const fromNumber = params.get("from");
  const toNumber = params.get("to");

  // ✅ Verify access
  useEffect(() => {
    const verify = async () => {
      if (!accessKey) return setAuthChecked(true);
      try {
        const res = await fetch(VERIFY_ACCESS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: accessKey }),
        });
        if (!res.ok) throw new Error("Unauthorized");
        setAuthorized(true);
      } catch (err) {
        console.error(err);
        setAuthorized(false);
      } finally {
        setAuthChecked(true);
      }
    };
    verify();
  }, []);

  // ✅ Enable Audio & Init Device
  useEffect(() => {
    const initDevice = async () => {
      if (!authorized || !agentId) return;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());

        audioRef.current = new Audio();
        audioRef.current.autoplay = true;

        const tokenRes = await fetch(`${TOKEN_URL}?identity=${agentId}`);
        const { token } = await tokenRes.json();

        const device = new Device(token, { enableRingingState: true, closeProtection: true });
        deviceRef.current = device;
        device.audio.incoming(audioRef.current);

        await device.register();
        setAudioEnabled(true);
        setStatus("✅ Ready, placing call...");

        // Automatically start outbound call if from/to exist
        if (fromNumber && toNumber) placeOutboundCall(fromNumber, toNumber, agentId);

      } catch (err) {
        console.error(err);
        setStatus("❌ Failed to initialize device");
      }
    };
    initDevice();
  }, [authorized]);

  // ✅ Place Outbound Call
  const placeOutboundCall = (from, to, agentId) => {
    const device = deviceRef.current;
    if (!device) return;

    const call = device.connect({ To: to });
    callRef.current = call;
    setStatus(`📞 Calling ${to}…`);

    // Save callSid to Firestore as document ID
    call.on("accept", async () => {
      try {
        const callSid = call.parameters.CallSid;
        await setDoc(doc(db, "call_logs", callSid), {
          from,
          to,
          agentId,
          direction: "outbound",
          status: "in-progress",
          startedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        });
      } catch (err) {
        console.error("Error saving call log:", err);
      }
    });

    call.on("disconnect", () => {
      setStatus("✅ Call ended");
      window.close(); // Auto close tab
    });

    call.on("error", (err) => {
      console.error(err);
      setStatus("❌ Call error");
      window.close();
    });
  };

  if (!authChecked) return <Screen text="🔐 Verifying access…" />;
  if (!authorized) return <Screen text="🚫 Unauthorized" />;

  return (
    <div style={ui.page}>
      <h2>📞 Orbit Outbound Call</h2>
      <div style={ui.status}>{status}</div>
    </div>
  );
}

const Screen = ({ text }) => (
  <div style={{ ...ui.page, textAlign: "center" }}>
    <div style={ui.phone}>{text}</div>
  </div>
);

const ui = {
  page: { height: "100vh", width: "100vw", display: "flex", justifyContent: "center", alignItems: "center", background: "#eef1f5", flexDirection: "column" },
  phone: { minWidth: 360, maxWidth: "90%", background: "#fff", padding: 24, borderRadius: 18, boxShadow: "0 12px 32px rgba(0,0,0,.2)", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12 },
  status: { margin: "10px 0", fontWeight: "bold" },
};
