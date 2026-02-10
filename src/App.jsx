import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL =
  "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";

export default function App() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);
  const [status, setStatus] = useState("Initializing…");
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [micMuted, setMicMuted] = useState(false);

  // --- URL params
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const fromNumber = params.get("from");
  const toNumber = params.get("to");

  // 🔥 Auto-detect mode
  const isOutbound = !!(fromNumber && toNumber);

  // Remove body margins for proper centering
  useEffect(() => {
    document.body.style.margin = "0";
    document.body.style.padding = "0";
  }, []);

  // Cleanup
  useEffect(() => {
    return () => {
      if (callRef.current) {
        console.log("Cleaning up call...");
        callRef.current.disconnect();
      }
      if (deviceRef.current) {
        console.log("Destroying device...");
        deviceRef.current.destroy();
      }
    };
  }, []);

  // --- Enable mic + init device
  const enableAudio = async () => {
    if (!agentId) {
      setStatus("❌ Missing agentId");
      return;
    }

    setAudioEnabled(true);

    // Ask mic permission
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());

    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    // Get token
    const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
    const { token } = await res.json();

    const device = new Device(token, {
      closeProtection: true,
      enableRingingState: true,
    });

    device.audio.incoming(audioRef.current);
    deviceRef.current = device;

    // --- INBOUND HANDLER
    device.on("incoming", (call) => {
      if (isOutbound) return; // ❌ outbound never uses incoming

      callRef.current = call;
      setIncoming(true);
      setStatus(`📞 Incoming call from ${call.parameters.From}`);

      call.on("accept", () => {
        console.log("Inbound call accepted");
        setIncoming(false);
        setInCall(true);
        setStatus("✅ Connected");
      });

      call.on("disconnect", () => {
        console.log("Inbound call disconnected");
        resetCall("✅ Ready");
      });
    });

    device.on("registered", () => {
      console.log("Device registered");
      setStatus("✅ Ready");

      // 🔥 Auto-start outbound
      if (isOutbound) {
        console.log("Starting outbound call...");
        startOutbound();
      }
    });

    device.on("error", (err) => {
      console.error("Device error:", err);
      setStatus(`❌ Device error: ${err.message}`);
    });

    await device.register();
  };

  // --- OUTBOUND
  const startOutbound = () => {
    console.log(`Initiating outbound call to ${toNumber} from ${fromNumber}`);
    setStatus(`📞 Calling ${toNumber}…`);

    const call = deviceRef.current.connect({
      params: {
        To: toNumber,
        From: fromNumber,
      },
    });

    callRef.current = call;
    setInCall(true);

    console.log("Call object created:", call);

    call.on("accept", () => {
      console.log("Outbound call accepted/connected");
      setStatus("✅ Connected");
    });

    call.on("disconnect", () => {
      console.log("Outbound call disconnected");
      resetCall("✅ Call ended");
      setTimeout(() => {
        try {
          window.close();
        } catch (e) {
          console.log("Could not close window");
        }
      }, 1000);
    });

    call.on("error", (err) => {
      console.error("Call error:", err);
      setStatus(`❌ Call error: ${err.message}`);
    });

    // Listen for mute events
    call.on("mute", (isMuted) => {
      console.log("Mute event fired, isMuted:", isMuted);
      setMicMuted(isMuted);
    });
  };

  // --- Controls
  const accept = () => {
    console.log("Accepting incoming call");
    callRef.current?.accept();
  };

  const reject = () => {
    console.log("Rejecting incoming call");
    callRef.current?.reject();
  };

  const hangup = () => {
    console.log("Hangup button clicked");
    console.log("Current call ref:", callRef.current);
    if (callRef.current) {
      console.log("Disconnecting call...");
      callRef.current.disconnect();
    } else {
      console.log("No active call to disconnect");
    }
  };

  const toggleMic = () => {
    console.log("Toggle mic clicked");
    console.log("Current call ref:", callRef.current);
    
    if (!callRef.current) {
      console.log("No active call");
      return;
    }

    const currentMuteState = callRef.current.isMuted();
    console.log("Current mute state:", currentMuteState);
    
    const newMuteState = !currentMuteState;
    console.log("Setting mute to:", newMuteState);
    
    callRef.current.mute(newMuteState);
    setMicMuted(newMuteState);
    
    console.log("Mute state after toggle:", callRef.current.isMuted());
  };

  const resetCall = (msg) => {
    console.log("Resetting call state:", msg);
    setIncoming(false);
    setInCall(false);
    setMicMuted(false);
    callRef.current = null;
    setStatus(msg);
  };

  return (
    <div style={ui.page}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h2>Enable Audio</h2>
            <p>
              Allow microphone access to{" "}
              {isOutbound ? "start the call" : "receive calls"}
            </p>
            <button style={ui.primary} onClick={enableAudio}>
              Enable
            </button>
          </div>
        </div>
      )}

      <div style={ui.phone}>
        <h1>📞 Orbit Phone</h1>
        <div style={ui.badge}>
          {isOutbound ? "🔵 Outbound Mode" : "🟢 Inbound Mode"}
        </div>
        <div style={ui.status}>{status}</div>

        {incoming && (
          <div style={ui.row}>
            <button style={ui.accept} onClick={accept}>
              Accept
            </button>
            <button style={ui.reject} onClick={reject}>
              Reject
            </button>
          </div>
        )}

        {inCall && (
          <div style={ui.row}>
            <button 
              style={{
                ...ui.primary,
                background: micMuted ? "#d32f2f" : "#1976d2"
              }} 
              onClick={toggleMic}
            >
              {micMuted ? "🔇 Mic Off" : "🎤 Mic On"}
            </button>
            <button style={ui.reject} onClick={hangup}>
              Hang Up
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- UI styles
const ui = {
  page: {
    height: "100vh",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    background: "#eef1f5",
    margin: 0,
    padding: 0,
  },
  phone: {
    minWidth: 360,
    background: "#fff",
    padding: 24,
    borderRadius: 18,
    boxShadow: "0 12px 32px rgba(0,0,0,.2)",
    textAlign: "center",
  },
  badge: {
    fontSize: 12,
    fontWeight: "bold",
    marginBottom: 8,
  },
  status: {
    margin: "12px 0",
    fontWeight: "bold",
  },
  row: {
    display: "flex",
    gap: 12,
    justifyContent: "center",
  },
  modal: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  modalCard: {
    background: "#fff",
    padding: 30,
    borderRadius: 14,
    textAlign: "center",
  },
  primary: {
    padding: "10px 20px",
    background: "#1976d2",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    cursor: "pointer",
  },
  accept: {
    background: "#2e7d32",
    color: "#fff",
    padding: 12,
    borderRadius: 10,
    border: "none",
    minWidth: 100,
    cursor: "pointer",
  },
  reject: {
    background: "#d32f2f",
    color: "#fff",
    padding: 12,
    borderRadius: 10,
    border: "none",
    minWidth: 100,
    cursor: "pointer",
  },
};