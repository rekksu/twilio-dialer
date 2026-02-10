import React, { useEffect, useRef, useState } from "react";
import { Device } from "@twilio/voice-sdk";

// URLs for your backend Cloud Functions
const TOKEN_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";
const OUTBOUND_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/outboundCall";

export default function OrbitPhone() {
  const deviceRef = useRef(null);
  const callRef = useRef(null);
  const audioRef = useRef(null);

  const [status, setStatus] = useState("Initializing…");
  const [incoming, setIncoming] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [authorized, setAuthorized] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  // --- Detect route type from pathname
  const pathname = window.location.pathname;
  const isInboundRoute = pathname.includes("/twilio-dialer");
  const isOutboundRoute = pathname.includes("/twilio-dialer-outbound");

  // --- Read URL params
  const params = new URLSearchParams(window.location.search);
  const agentId = params.get("agentId");
  const accessKey = params.get("accessKey");
  const fromNumber = params.get("from");
  const toNumber = params.get("to");

  // --- Verify access
  useEffect(() => {
    const verify = async () => {
      if (!accessKey) {
        setAuthorized(false);
        setAuthChecked(true);
        return;
      }
      try {
        const res = await fetch(VERIFY_ACCESS_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: accessKey }),
        });
        if (!res.ok) throw new Error("Unauthorized");
        setAuthorized(true);
      } catch {
        setAuthorized(false);
      } finally {
        setAuthChecked(true);
      }
    };
    verify();
  }, [accessKey]);

  // --- Enable audio + init Twilio Device
  const enableAudio = async () => {
    if (!agentId) return setStatus("❌ No agentId provided");

    setAudioEnabled(true);
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    audioRef.current = new Audio();
    audioRef.current.autoplay = true;

    const res = await fetch(`${TOKEN_URL}?identity=${agentId}`);
    const { token } = await res.json();

    const device = new Device(token, { enableRingingState: true, closeProtection: true });
    deviceRef.current = device;
    device.audio.incoming(audioRef.current);

    device.on("incoming", (call) => {
      callRef.current = call;
      setIncoming(true);
      setStatus(`📞 Incoming call from ${call.parameters.From || "Unknown"}`);
      
      call.on("accept", () => {
        setIncoming(false);
        setInCall(true);
        setStatus("✅ Connected");
      });

      call.on("disconnect", () => {
        setIncoming(false);
        setInCall(false);
        setMicMuted(false);
        callRef.current = null;
        
        // 🔥 Auto-close tab after outbound call ends
        if (isOutboundRoute) {
          setStatus("✅ Call ended. Closing...");
          setTimeout(() => {
            window.close();
          }, 1000);
        } else {
          setStatus("✅ Ready");
        }
      });
    });

    await device.register();
    setStatus("✅ Ready");

    // --- If outbound route, auto-initiate call
    if (isOutboundRoute) {
      makeOutbound();
    }
  };

  // --- Auto outbound call
  const makeOutbound = async () => {
    if (!deviceRef.current) {
      setStatus("❌ Device not ready");
      return;
    }

    if (!fromNumber || !toNumber) {
      setStatus("❌ Missing from/to number for outbound call");
      return;
    }

    setStatus(`📞 Initiating outbound call to ${toNumber}…`);
    try {
      const res = await fetch(OUTBOUND_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromNumber, toNumber, agentId }),
      });
      const data = await res.json();
      if (!data.ok) {
        setStatus(`❌ Failed to make outbound call: ${data.error || "Unknown error"}`);
      }
      // Note: The call will come in via the "incoming" event handler above
    } catch (err) {
      setStatus(`❌ Error: ${err.message}`);
    }
  };

  // --- Call controls
  const accept = () => {
    if (callRef.current) {
      callRef.current.accept();
      setIncoming(false);
      setInCall(true);
      setStatus("✅ Connected");
    }
  };

  const reject = () => {
    if (callRef.current) {
      callRef.current.reject();
      setIncoming(false);
      setInCall(false);
      setStatus("❌ Call rejected");
      
      // 🔥 Auto-close tab after rejecting outbound call
      if (isOutboundRoute) {
        setTimeout(() => {
          window.close();
        }, 1000);
      }
    }
  };

  const hangup = () => {
    if (callRef.current) {
      callRef.current.disconnect();
      setInCall(false);
      setMicMuted(false);
      // Status will be set in the disconnect handler
    }
  };

  const toggleMic = () => {
    if (!callRef.current) return;
    callRef.current.mute(!micMuted);
    setMicMuted(!micMuted);
  };

  // --- Route validation
  if (!isInboundRoute && !isOutboundRoute) {
    return <Screen text="❌ Invalid route. Use /twilio-dialer or /twilio-dialer-outbound" />;
  }

  if (!authChecked) return <Screen text="🔐 Verifying access…" />;
  if (!authorized) return <Screen text="🚫 Unauthorized" />;

  // --- Outbound route validation
  if (isOutboundRoute && (!fromNumber || !toNumber)) {
    return <Screen text="❌ Outbound route requires 'from' and 'to' parameters" />;
  }

  return (
    <div style={ui.page}>
      {!audioEnabled && (
        <div style={ui.modal}>
          <div style={ui.modalCard}>
            <h3>Enable Audio</h3>
            <p>Allow microphone access to {isOutboundRoute ? "make" : "receive"} calls.</p>
            <button style={ui.primary} onClick={enableAudio}>Enable</button>
          </div>
        </div>
      )}
      
      <div style={ui.phone}>
        <h2>📞 Orbit Virtual Phone</h2>
        <div style={ui.badge}>
          {isOutboundRoute ? "🔵 Outbound Mode" : "🟢 Inbound Mode"}
        </div>
        <div style={ui.status}>{status}</div>

        {incoming && (
          <div style={ui.row}>
            <button style={ui.accept} onClick={accept}>Accept</button>
            <button style={ui.reject} onClick={reject}>Reject</button>
          </div>
        )}

        {inCall && (
          <div style={ui.row}>
            <button style={micMuted ? ui.reject : ui.accept} onClick={toggleMic}>
              {micMuted ? "Mic Off" : "Mic On"}
            </button>
            <button style={ui.reject} onClick={hangup}>Hang Up</button>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Reusable screen component
const Screen = ({ text }) => (
  <div style={{ ...ui.page, textAlign: "center" }}>
    <div style={ui.phone}>{text}</div>
  </div>
);

// --- UI Styles
const ui = {
  page: { 
    height: "100vh", 
    width: "100vw", 
    display: "flex", 
    justifyContent: "center", 
    alignItems: "center", 
    background: "#eef1f5" 
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
    gap: 12 
  },
  badge: {
    padding: "6px 12px",
    borderRadius: 20,
    fontSize: 12,
    fontWeight: "bold",
    background: "#e3f2fd",
    color: "#1976d2",
  },
  status: { 
    margin: "10px 0", 
    fontWeight: "bold" 
  },
  row: { 
    display: "flex", 
    gap: 12, 
    justifyContent: "center", 
    width: "100%" 
  },
  modal: { 
    position: "fixed", 
    inset: 0, 
    background: "rgba(0,0,0,.5)", 
    display: "flex", 
    alignItems: "center", 
    justifyContent: "center", 
    zIndex: 10 
  },
  modalCard: { 
    background: "#fff", 
    padding: 30, 
    borderRadius: 14, 
    textAlign: "center" 
  },
  primary: { 
    padding: "10px 20px", 
    background: "#1976d2", 
    color: "#fff", 
    border: "none", 
    borderRadius: 8, 
    cursor: "pointer" 
  },
  accept: { 
    background: "#2e7d32", 
    color: "#fff", 
    padding: 12, 
    borderRadius: 10, 
    border: "none", 
    minWidth: 100, 
    cursor: "pointer" 
  },
  reject: { 
    background: "#d32f2f", 
    color: "#fff", 
    padding: 12, 
    borderRadius: 10, 
    border: "none", 
    minWidth: 100, 
    cursor: "pointer" 
  },
};