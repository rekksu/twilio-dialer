import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

/* ================= CONFIG ================= */
const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";
const CALL_LOG_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";

/* ================= HELPER ================= */
const formatOutboundNumber = (num) => {
  if (!num) return "";
  let cleaned = num.replace(/[^\d]/g, "");
  if (!cleaned.startsWith("+")) cleaned = "+" + cleaned;
  return cleaned;
};

/* ================= DEV PHONE COMPONENT ================= */
export default function DevPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);
  const startedAtRef = useRef(null);
  const savedRef = useRef(false);
  const orgIdRef = useRef(null);

  const [number, setNumber] = useState("");
  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  const callDirectionRef = useRef("outbound");
  const customerIdRef = useRef(null);
  const answeredRef = useRef(false); // inbound answered
  const outboundAnsweredRef = useRef(false); // remote party picked up
  const outboundHungUpRef = useRef(false); // agent hung up before answer

  /* ================= VERIFY ACCESS & GET URL NUMBER ================= */
  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const accessKey = params.get("accessKey");
      const toNumber = params.get("to");
      const customerId = params.get("customerId");

      if (toNumber) setNumber(toNumber);
      if (customerId) customerIdRef.current = customerId;

      if (!accessKey) {
        setStatus("🚫 Unauthorized");
        setAuthChecked(true);
        return;
      }

      try {
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
      } catch (err) {
        console.error(err);
        setStatus("🚫 Verification failed");
        setAuthChecked(true);
      }
    };
    run();
  }, []);

  /* ================= ENABLE AUDIO & INIT DEVICE ================= */
  const enableAudio = async () => {
    setAudioEnabled(true);

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    const res = await fetch(`${TOKEN_URL}?identity=agent`);
    const { token } = await res.json();

    const device = new Device(token, { enableRingingState: true, closeProtection: true });
    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    device.on("incoming", (call) => {
      callRef.current = call;
      savedRef.current = false;
      answeredRef.current = false;
      callDirectionRef.current = "inbound";
      setIncoming(true);
      setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);

      call.on("disconnect", cleanup);
      call.on("error", cleanup);
    });

    await device.register();
    setStatus("✅ Ready");
  };

  /* ================= OUTBOUND CALL ================= */
  const dial = async () => {
    if (!deviceRef.current || !number) return;

    savedRef.current = false;
    callDirectionRef.current = "outbound";
    outboundAnsweredRef.current = false;
    outboundHungUpRef.current = false;
    setStatus("📞 Dialing…");

    const formattedNumber = formatOutboundNumber(number);

    const call = await deviceRef.current.connect({ params: { To: formattedNumber } });
    callRef.current = call;

    // remote party picked up
    call.on("accept", () => {
      outboundAnsweredRef.current = true;
      onConnected();
    });

    // call ended/disconnected
    call.on("disconnect", () => {
      if (!outboundAnsweredRef.current && !outboundHungUpRef.current) {
        // Twilio ended without answer
        outboundHungUpRef.current = false;
      }
      cleanup();
    });

    call.on("error", cleanup);
  };

  /* ================= CALL HANDLERS ================= */
  const onConnected = () => {
    startedAtRef.current = Date.now();
    answeredRef.current = true; // mark inbound as answered
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

  /* ================= TIMER ================= */
  useEffect(() => {
    let t;
    if (inCall && startedAtRef.current) {
      t = setInterval(() => setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000)), 1000);
    }
    return () => clearInterval(t);
  }, [inCall]);

  /* ================= SAVE CALL LOG ================= */
  const saveCall = async () => {
    if (savedRef.current) return;
    savedRef.current = true;

    const startedAt = startedAtRef.current ? new Date(startedAtRef.current).toISOString() : null;
    const endedAt = new Date().toISOString();
    const dur = startedAtRef.current ? Math.floor((Date.now() - startedAtRef.current) / 1000) : 0;

    let callStatus = "ended";

    if (callDirectionRef.current === "inbound") {
      if (!answeredRef.current && !inCall && !incoming) callStatus = "rejected";
      if (!answeredRef.current && !inCall && incoming === false) callStatus = "no_answer";
      if (answeredRef.current) callStatus = "answered";
    } else {
      // OUTBOUND: track local hangup vs remote answer
      if (outboundAnsweredRef.current) callStatus = "answered";
      else if (outboundHungUpRef.current) callStatus = "rejected"; // agent hung up
      else callStatus = "no_answer"; // remote didn't pick up
    }

    const data = {
      orgId: orgIdRef.current,
      status: callStatus,
      startedAt,
      endedAt,
      durationSeconds: dur,
      direction: callDirectionRef.current,
    };

    if (callDirectionRef.current === "outbound") {
      const formattedNumber = formatOutboundNumber(number);
      data.to = formattedNumber;
      data.from = "agent";
      if (customerIdRef.current) data.customerId = customerIdRef.current;
    } else {
      const fromNumber = callRef.current?.parameters?.From || number;
      data.to = fromNumber;
      data.from = fromNumber;
    }

    try {
      await fetch(CALL_LOG_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      console.log("✅ Call log saved", data);
    } catch (err) {
      console.error("❌ Failed to save call log", err);
    }
  };

  /* ================= ACTIONS ================= */
  const accept = () => { callRef.current?.accept(); onConnected(); };
  const reject = () => { callRef.current?.reject(); answeredRef.current = false; cleanup(); };
  const hangup = () => { 
    if (callDirectionRef.current === "outbound" && !outboundAnsweredRef.current) {
      outboundHungUpRef.current = true; // mark as rejected
    }
    callRef.current?.disconnect(); 
  };
  const toggleMic = () => { const next = !micMuted; callRef.current?.mute(next); setMicMuted(next); };

  const press = (v) => setNumber((n) => n + v);
  const backspace = () => setNumber((n) => n.slice(0, -1));

  /* ================= UI ================= */
  if (!authChecked) return <Screen text="🔐 Verifying access…" />;
  if (!authorized) return <Screen text="🚫 Unauthorized" />;

  return (
    <div style={ui.page}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h3>Enable Audio</h3>
            <button style={ui.primary} onClick={enableAudio}>Enable</button>
          </div>
        </div>
      )}

      <div style={ui.phone}>
        <h2>📞 Dev Phone</h2>
        <div style={ui.status}>{status}</div>

        {!inCall && !incoming && (
          <>
            <input style={ui.input} value={number} readOnly />
            <DialPad onPress={press} onBack={backspace} />
            <button style={ui.call} onClick={dial}>Call</button>
          </>
        )}

        {incoming && (
          <div style={ui.row}>
            <button style={ui.accept} onClick={accept}>Accept</button>
            <button style={ui.reject} onClick={reject}>Reject</button>
          </div>
        )}

        {inCall && (
          <>
            <p>⏱ {duration}s</p>
            <div style={ui.row}>
              <button style={micMuted ? ui.reject : ui.accept} onClick={toggleMic}>
                {micMuted ? "Mic Off" : "Mic On"}
              </button>
              <button style={ui.reject} onClick={hangup}>Hang Up</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================= DIAL PAD ================= */
function DialPad({ onPress, onBack }) {
  const keys = ["1","2","3","4","5","6","7","8","9","*","0","#"];
  return (
    <div style={ui.pad}>
      {keys.map((k) => <button key={k} style={ui.key} onClick={() => onPress(k)}>{k}</button>)}
      <button style={ui.key} onClick={onBack}>⌫</button>
    </div>
  );
}

const Screen = ({ text }) => (
  <div style={{...ui.page, textAlign:"center"}}><div style={ui.phone}>{text}</div></div>
);

/* ================= STYLES ================= */
const ui = {
  page: {
    height: "100vh",
    width: "100vw",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#eef1f5",
  },
  phone: {
    minWidth: 360,
    maxWidth: "90%",
    background: "#fff",
    padding: 24,
    borderRadius: 18,
    boxShadow: "0 12px 32px rgba(0,0,0,.2)",
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 12,
  },
  status: { margin: "10px 0", fontWeight: "bold" },
  input: { width: "auto", minWidth: 200, fontSize: 22, padding: 10, textAlign: "center", marginBottom: 10, borderRadius: 10, border: "1px solid #ccc" },
  pad: { display: "grid", gridTemplateColumns: "repeat(3, 60px)", gap: 10, justifyContent: "center", marginBottom: 10 },
  key: { padding: 16, fontSize: 18, borderRadius: 12, border: "1px solid #ccc", cursor: "pointer" },
  call: { background: "#2e7d32", color: "#fff", padding: 14, borderRadius: 12, border: "none", fontWeight: "bold", minWidth: 120, cursor: "pointer" },
  accept: { background: "#2e7d32", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
  reject: { background: "#d32f2f", color: "#fff", padding: 12, borderRadius: 10, border: "none", minWidth: 100, cursor: "pointer" },
  row: { display: "flex", gap: 12, justifyContent: "center", width: "100%" },
  modal: { position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10 },
  modalCard: { background: "#fff", padding: 30, borderRadius: 14, textAlign: "center" },
  primary: { padding: "10px 20px", background: "#1976d2", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" },
};
