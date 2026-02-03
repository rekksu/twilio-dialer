import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const CALL_LOG_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

export default function App()  {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);
  const startedAtRef = useRef(null);
  const savedRef = useRef(false);
  const orgIdRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [duration, setDuration] = useState(0);
  const [micMuted, setMicMuted] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  /* ---------- VERIFY ACCESS ---------- */
  useEffect(() => {
    const verify = async () => {
      const params = new URLSearchParams(window.location.search);
      const accessKey = params.get("accessKey");
      const to = params.get("to");

      if (to) setPhoneNumber(to);

      if (!accessKey) {
        setStatus("🚫 Unauthorized");
        setAuthChecked(true);
        return;
      }

      const res = await fetch(VERIFY_ACCESS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: accessKey }),
      });

      if (!res.ok) {
        setStatus("🚫 Access denied");
        setAuthChecked(true);
        return;
      }

      const data = await res.json();
      orgIdRef.current = data.orgId;

      setAuthorized(true);
      setAuthChecked(true);
    };

    verify();
  }, []);

  /* ---------- ENABLE AUDIO + INIT DEVICE ---------- */
  const enableAudio = async () => {
    setAudioEnabled(true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    const res = await fetch(`${TOKEN_URL}?identity=agent`);
    const { token } = await res.json();

    const device = new Device(token, {
      enableRingingState: true,
      closeProtection: true,
    });

    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    /* ----- INCOMING CALL ----- */
    device.on("incoming", (call) => {
      callRef.current = call;
      savedRef.current = false;
      setIncoming(true);
      setStatus("📞 Incoming call");

      call.on("disconnect", cleanup);
      call.on("error", cleanup);
    });

    await device.register();
    setStatus("✅ Ready");
  };

  /* ---------- OUTBOUND CALL ---------- */
  const dial = async () => {
    if (!deviceRef.current || !phoneNumber) return;

    savedRef.current = false;
    setStatus("📞 Dialing…");

    const call = await deviceRef.current.connect({
      params: { To: phoneNumber },
    });

    callRef.current = call;

    call.on("accept", onConnected);
    call.on("disconnect", cleanup);
    call.on("error", cleanup);
  };

  /* ---------- CALL HANDLERS ---------- */
  const onConnected = () => {
    startedAtRef.current = Date.now();
    setIncoming(false);
    setInCall(true);
    setStatus("✅ Connected");
  };

  const cleanup = () => {
    saveCall();
    startedAtRef.current = null;
    setIncoming(false);
    setInCall(false);
    setMicMuted(false);
    setStatus("✅ Ready");
  };

  /* ---------- TIMER ---------- */
  useEffect(() => {
    let t;
    if (inCall && startedAtRef.current) {
      t = setInterval(() => {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(t);
  }, [inCall]);

  /* ---------- SAVE CALL ---------- */
  const saveCall = async () => {
    if (savedRef.current || !startedAtRef.current) return;
    savedRef.current = true;

    await fetch(CALL_LOG_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        orgId: orgIdRef.current,
        status: "ended",
        durationSeconds:
          Math.floor((Date.now() - startedAtRef.current) / 1000),
      }),
    });
  };

  /* ---------- ACTIONS ---------- */
  const accept = () => {
    callRef.current?.accept();
    onConnected();
  };

  const reject = () => {
    callRef.current?.reject();
    cleanup();
  };

  const hangup = () => {
    callRef.current?.disconnect();
  };

  const toggleMic = () => {
    const next = !micMuted;
    callRef.current?.mute(next);
    setMicMuted(next);
  };

  /* ---------- UI ---------- */
  if (!authChecked)
    return <div style={ui.card}>🔐 Verifying access…</div>;

  if (!authorized)
    return <div style={ui.card}>🚫 Unauthorized</div>;

  return (
    <div style={ui.container}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <button onClick={enableAudio}>Enable Audio</button>
        </div>
      )}

      <div style={ui.card}>
        <h2>📞 Dev Phone</h2>
        <div>{status}</div>

        {!inCall && !incoming && (
          <>
            <input
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1855..."
            />
            <button onClick={dial}>Call</button>
          </>
        )}

        {incoming && (
          <>
            <button onClick={accept}>Accept</button>
            <button onClick={reject}>Reject</button>
          </>
        )}

        {inCall && (
          <>
            <p>⏱ {duration}s</p>
            <button onClick={toggleMic}>
              {micMuted ? "Mic Off" : "Mic On"}
            </button>
            <button onClick={hangup}>Hang Up</button>
          </>
        )}
      </div>
    </div>
  );
}

/* minimal UI */
const ui = {
  container: { display: "flex", height: "100vh", alignItems: "center", justifyContent: "center" },
  card: { padding: 30, background: "#fff", borderRadius: 12 },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)" },
};

