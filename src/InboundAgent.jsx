import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const CALL_LOG_FUNCTION_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/createCallLog";
const VERIFY_ACCESS_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";

export default function InboundAgent() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);
  const startedAtRef = useRef(null);
  const savedRef = useRef(false);
  const orgIdRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  // 🔐 auth states
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  /* ---------------- VERIFY ACCESS ---------------- */
  useEffect(() => {
    const verifyAccess = async () => {
      const params = new URLSearchParams(window.location.search);
      const accessKey = params.get("accessKey");

      orgIdRef.current = params.get("orgid");

      if (!accessKey) {
        setStatus("🚫 Unauthorized access");
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

    verifyAccess();
  }, []);

  /* ---------------- ENABLE AUDIO & INIT DEVICE ---------------- */
  const enableAudio = () => {
    setAudioEnabled(true);
    if (authChecked && authorized) initDevice();
  };

  const initDevice = async () => {
    try {
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

      device.on("incoming", (call) => {
        savedRef.current = false;
        callRef.current = call;
        setIncoming(true);
        setStatus("📞 Incoming call");

        call.on("disconnect", () => {
          saveCall(
            "ended",
            null,
            call.parameters.From,
            startedAtRef.current,
            Date.now()
          );
          startedAtRef.current = null;
          setInCall(false);
          setIncoming(false);
          setMicMuted(false);
          setStatus("✅ Ready for inbound calls");
        });

        call.on("error", (err) => {
          saveCall(
            "failed",
            err.message,
            call.parameters.From,
            startedAtRef.current,
            Date.now()
          );
          setInCall(false);
          setIncoming(false);
          setMicMuted(false);
          setStatus("✅ Ready for inbound calls");
        });
      });

      await device.register();
      setStatus("✅ Ready for inbound calls");
    } catch (err) {
      console.error(err);
      setStatus("❌ Init failed");
    }
  };

  /* ---------------- TIMER ---------------- */
  useEffect(() => {
    let timer;
    if (inCall && startedAtRef.current) {
      timer = setInterval(() => {
        setDuration(Math.floor((Date.now() - startedAtRef.current) / 1000));
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [inCall]);

  /* ---------------- SAVE CALL ---------------- */
  const saveCall = async (status, reason, from, start, end) => {
    if (savedRef.current) return;
    savedRef.current = true;

    await fetch(CALL_LOG_FUNCTION_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: from,
        status,
        reason,
        direction: "inbound",
        startedAt: start ? new Date(start).toISOString() : null,
        endedAt: end ? new Date(end).toISOString() : null,
        durationSeconds: start && end ? Math.floor((end - start) / 1000) : 0,
        orgId: orgIdRef.current,
      }),
    });
  };

  /* ---------------- ACTIONS ---------------- */
  const acceptCall = () => {
    if (!callRef.current) return;
    startedAtRef.current = Date.now();
    callRef.current.accept();
    setIncoming(false);
    setInCall(true);
    setStatus("✅ Connected");
  };

  const rejectCall = () => {
    if (!callRef.current) return;
    saveCall(
      "rejected",
      "Agent rejected",
      callRef.current.parameters.From,
      null,
      Date.now()
    );
    callRef.current.reject();
    setIncoming(false);
    setStatus("✅ Ready for inbound calls");
  };

  const hangupCall = () => {
    if (!callRef.current) return;
    callRef.current.disconnect();
    setInCall(false);
    setStatus("✅ Ready for inbound calls");
  };

  const toggleMic = () => {
    if (!callRef.current) return;
    const next = !micMuted;
    callRef.current.mute(next);
    setMicMuted(next);
  };

  /* ---------------- UI ---------------- */
  if (!authChecked) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>🔐 Verifying access…</div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div style={styles.container}>
        <div style={styles.card}>🚫 Unauthorized</div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {!audioEnabled && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <p>🎧 Please enable audio to receive calls</p>
            <button style={styles.enableButton} onClick={enableAudio}>
              Enable Audio
            </button>
          </div>
        </div>
      )}

      <div style={styles.card}>
        <h2 style={styles.title}>📞 Inbound Agent</h2>

        <div style={styles.status}>{status}</div>

        {incoming && (
          <div style={styles.actions}>
            <button style={styles.accept} onClick={acceptCall}>
              Accept
            </button>
            <button style={styles.reject} onClick={rejectCall}>
              Reject
            </button>
          </div>
        )}

        {inCall && (
          <>
            <div style={styles.actions}>
              <button
                style={micMuted ? styles.micOff : styles.micOn}
                onClick={toggleMic}
              >
                {micMuted ? "Mic Off" : "Mic On"}
              </button>

              <button style={styles.reject} onClick={hangupCall}>
                Hang Up
              </button>
            </div>

            <p style={styles.timer}>⏱ {duration}s</p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- STYLES (UNCHANGED) ---------------- */
const styles = {
  container: {
    position: "fixed",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#f0f2f5",
  },
  card: {
    width: 360,
    padding: 30,
    borderRadius: 14,
    background: "#fff",
    boxShadow: "0 8px 24px rgba(0,0,0,.15)",
    textAlign: "center",
    zIndex: 1,
  },
  title: { marginBottom: 12 },
  status: {
    padding: 12,
    borderRadius: 8,
    background: "#e0e0e0",
    fontWeight: "bold",
    marginBottom: 15,
  },
  actions: {
    display: "flex",
    justifyContent: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  accept: {
    background: "#2e7d32",
    color: "#fff",
    padding: "10px 16px",
    border: "none",
    borderRadius: 8,
    fontWeight: "bold",
    cursor: "pointer",
  },
  reject: {
    background: "#d32f2f",
    color: "#fff",
    padding: "10px 16px",
    border: "none",
    borderRadius: 8,
    fontWeight: "bold",
    cursor: "pointer",
  },
  micOn: {
    background: "#2e7d32",
    color: "#fff",
    padding: "10px 16px",
    border: "none",
    borderRadius: 8,
    fontWeight: "bold",
    cursor: "pointer",
  },
  micOff: {
    background: "#d32f2f",
    color: "#fff",
    padding: "10px 16px",
    border: "none",
    borderRadius: 8,
    fontWeight: "bold",
    cursor: "pointer",
  },
  timer: {
    marginTop: 12,
    fontWeight: "bold",
  },
  modal: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  modalContent: {
    background: "#fff",
    padding: 30,
    borderRadius: 14,
    textAlign: "center",
  },
  enableButton: {
    marginTop: 15,
    padding: "10px 20px",
    borderRadius: 8,
    border: "none",
    fontWeight: "bold",
    background: "#1976d2",
    color: "#fff",
    cursor: "pointer",
  },
};
