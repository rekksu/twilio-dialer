import React, { useEffect, useRef, useState, useCallback } from "react";
import { Device } from "@twilio/voice-sdk";

const TOKEN_URL         = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getVoiceToken";
const VERIFY_ACCESS_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/verifyDialerAccess";
const ASSIGNED_NUMBERS_URL = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getAgentNumbers";
const TRANSFER_URL      = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/transferCall";
const CONFERENCE_URL    = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/conferenceCall";
const EXTENSIONS_URL    = "https://us-central1-vertexifycx-orbit.cloudfunctions.net/getExtensions";

const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_TTL_MS     = 60 * 60 * 1000;

export default function OrbitPhone() {
  const deviceRef            = useRef(null);
  const callRef              = useRef(null);
  const holdMusicRef         = useRef(null);
  const tokenRefreshTimerRef = useRef(null);

  const [status, setStatus]           = useState("Initializing…");
  const [incoming, setIncoming]       = useState(false);
  const [inCall, setInCall]           = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [micMuted, setMicMuted]       = useState(false);
  const [onHold, setOnHold]           = useState(false);
  const [showKeypad, setShowKeypad]   = useState(false);
  const [authorized, setAuthorized]   = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [calledToNumber, setCalledToNumber] = useState("");
  const [callDuration, setCallDuration]     = useState(0);
  const [isRecording, setIsRecording]       = useState(false);
  const [assignedNumbers, setAssignedNumbers] = useState([]);

  // ── Transfer state ──
  const [showTransferPanel, setShowTransferPanel] = useState(false);
  const [transferMode, setTransferMode]           = useState(null); // "transfer" | "conference"
  const [transferStatus, setTransferStatus]       = useState(null); // null | "consulting" | "completed" | "conference"
  const [transferTarget, setTransferTarget]       = useState(null); // { name, extension }
  const [consultCallSid, setConsultCallSid]       = useState(null);
  const [conferenceName, setConferenceName]       = useState(null);
  const [extensions, setExtensions]               = useState({ employees: [], departments: [] });
  const [loadingExtensions, setLoadingExtensions] = useState(false);
  const [manualNumber, setManualNumber]           = useState("");
  const [transferring, setTransferring]           = useState(false);

  const params       = new URLSearchParams(window.location.search);
  const agentId      = params.get("agentId");
  const accessKey    = params.get("accessKey");
  const fromNumber   = params.get("from");
  const toNumber     = params.get("to");
  const orgId        = params.get("orgId");
  const phoneDocId   = params.get("phoneDocId") || fromNumber; // phoneNumberDocId for extensions

  const isOutbound = !!(fromNumber && toNumber);

  // ── Active callSid ref (needed for transfer/conference API calls) ──
  const callSidRef = useRef(null);

  useEffect(() => {
    holdMusicRef.current = new Audio("https://www.twilio.com/docs/voice/twiml/play/hold-music.mp3");
    holdMusicRef.current.loop   = true;
    holdMusicRef.current.volume = 0.3;
    return () => { if (holdMusicRef.current) { holdMusicRef.current.pause(); holdMusicRef.current = null; } };
  }, []);

  useEffect(() => {
    let interval;
    if (inCall && !onHold) {
      interval = setInterval(() => setCallDuration(p => p + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [inCall, onHold]);

  const formatDuration = (s) => `${Math.floor(s/60).toString().padStart(2,"0")}:${(s%60).toString().padStart(2,"0")}`;

  const sendDTMF = (digit) => { if (callRef.current) callRef.current.sendDigits(digit); };

  // ── Verify access ──
  useEffect(() => {
    const verify = async () => {
      if (!accessKey) { setAuthorized(false); setAuthChecked(true); return; }
      try {
        const res = await fetch(VERIFY_ACCESS_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({key:accessKey}) });
        if (!res.ok) throw new Error("Unauthorized");
        setAuthorized(true);
      } catch { setAuthorized(false); }
      finally { setAuthChecked(true); }
    };
    verify();
  }, [accessKey]);

  // ── Fetch assigned numbers ──
  useEffect(() => {
    if (!agentId || !orgId) return;
    const fetchNums = async () => {
      try {
        const res = await fetch(`${ASSIGNED_NUMBERS_URL}?agentId=${encodeURIComponent(agentId)}&orgId=${encodeURIComponent(orgId)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.numbers)) setAssignedNumbers(data.numbers);
      } catch (err) { console.warn("Could not fetch assigned numbers:", err); }
    };
    fetchNums();
  }, [agentId, orgId]);

  // ── Token refresh ──
  const scheduleTokenRefresh = (ttlMs = DEFAULT_TOKEN_TTL_MS) => {
    if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current);
    const delay = Math.max(ttlMs - REFRESH_BEFORE_EXPIRY_MS, 30_000);
    tokenRefreshTimerRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`${TOKEN_URL}?identity=${agentId}&orgId=${orgId}`);
        const data = await res.json();
        if (data.token && deviceRef.current) {
          deviceRef.current.updateToken(data.token);
          scheduleTokenRefresh(data.ttl ? data.ttl * 1000 : DEFAULT_TOKEN_TTL_MS);
        }
      } catch (err) {
        console.error("Token refresh failed:", err);
        scheduleTokenRefresh(60_000 + REFRESH_BEFORE_EXPIRY_MS);
      }
    }, delay);
  };

  const resetCallState = () => {
    setIncoming(false); setInCall(false); setMicMuted(false); setOnHold(false);
    setShowKeypad(false); setIsRecording(false); setPhoneNumber(""); setCalledToNumber("");
    setCallDuration(0); callRef.current = null; callSidRef.current = null;
    setShowTransferPanel(false); setTransferStatus(null); setTransferTarget(null);
    setTransferMode(null); setConsultCallSid(null); setConferenceName(null);
    if (holdMusicRef.current) { holdMusicRef.current.pause(); holdMusicRef.current.currentTime = 0; }
  };

  // ── Init device ──
  useEffect(() => {
    const initDevice = async () => {
      if (!agentId) { setStatus("No agent ID provided"); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach(t => t.stop());
        const res  = await fetch(`${TOKEN_URL}?identity=${agentId}&orgId=${orgId}`);
        const data = await res.json();
        if (!data.token) throw new Error(data.error || "Failed to get token");

        const device = new Device(data.token, { enableRingingState: true, closeProtection: true });
        deviceRef.current = device;

        device.on("incoming", (call) => {
          callRef.current = call;
          callSidRef.current = call.parameters.CallSid;
          setIncoming(true);
          setPhoneNumber(call.parameters.From || "Unknown");

          const rawParams   = call.parameters.Params || "";
          const parsed      = Object.fromEntries(new URLSearchParams(rawParams));
          const calledParam = parsed.CalledNumber || call.parameters.CalledNumber || "";
          const rawTo       = call.parameters.To   || "";
          const rawCalled   = call.parameters.Called || "";
          const phoneReg    = /^\+?[1-9]\d{6,14}$/;
          let resolved = "";
          if (phoneReg.test(calledParam.replace(/\s/g, "")))  resolved = calledParam;
          else if (phoneReg.test(rawTo.replace(/\s/g, "")))   resolved = rawTo;
          else if (phoneReg.test(rawCalled.replace(/\s/g,""))) resolved = rawCalled;
          setCalledToNumber(resolved);
          setStatus("Incoming call...");

          call.on("accept",     () => { setIncoming(false); setInCall(true); setStatus("Connected"); });
          call.on("disconnect", () => { resetCallState(); setStatus("Call ended"); setTimeout(() => setStatus("Ready"), 2000); });
          call.on("cancel",     () => { resetCallState(); setStatus("Missed call");    setTimeout(() => setStatus("Ready"), 2000); });
          call.on("reject",     () => { resetCallState(); setStatus("Call rejected");  setTimeout(() => setStatus("Ready"), 2000); });
          call.on("error",  (err) => { setStatus(`Error: ${err.message}`); resetCallState(); setTimeout(() => setStatus("Ready"), 2000); });
        });

        await device.register();
        setStatus("Ready");
        scheduleTokenRefresh(data.ttl ? data.ttl * 1000 : DEFAULT_TOKEN_TTL_MS);
        if (isOutbound) { setAudioEnabled(true); setPhoneNumber(toNumber); setTimeout(() => makeOutbound(toNumber), 200); }
      } catch (err) { setStatus(`Setup failed: ${err.message}`); }
    };
    initDevice();
    return () => { if (tokenRefreshTimerRef.current) clearTimeout(tokenRefreshTimerRef.current); };
  }, [agentId, isOutbound]);

  // ── Outbound ──
  const makeOutbound = async (number = phoneNumber) => {
    if (!deviceRef.current || !number) return;
    setStatus(`Calling ${number}...`);
    try {
      const call = await deviceRef.current.connect({ params: { To: number, From: fromNumber || "+1234567890" } });
      callRef.current    = call;
      callSidRef.current = call.parameters?.CallSid;
      setInCall(true);
      call.on("ringing",    () => setStatus("Ringing..."));
      call.on("accept",     () => { setStatus("Connected"); callSidRef.current = call.parameters?.CallSid; });
      call.on("disconnect", () => { resetCallState(); setStatus("Call ended"); if (isOutbound) setTimeout(() => window.close(), 1000); });
      call.on("error",  (err) => { setStatus(`Call failed: ${err.message}`); resetCallState(); });
    } catch (err) { setStatus(`Connection failed: ${err.message}`); resetCallState(); }
  };

  // ── Call controls ──
  const accept    = () => { if (!callRef.current) return; callRef.current.accept(); setIncoming(false); setInCall(true); setStatus("Connected"); };
  const reject    = () => { if (!callRef.current) return; callRef.current.reject(); resetCallState(); setStatus("Call rejected"); };
  const hangup    = () => { if (!callRef.current) return; callRef.current.disconnect(); resetCallState(); };
  const toggleMic = () => { if (!callRef.current) return; callRef.current.mute(!micMuted); setMicMuted(!micMuted); };

  const toggleHold = () => {
    if (!callRef.current) return;
    const newHold = !onHold;
    setOnHold(newHold);
    if (newHold) {
      callRef.current.mute(true); setMicMuted(true);
      try { callRef.current.sendDigits("*"); } catch {}
      holdMusicRef.current?.play().catch(() => {});
      setStatus("On Hold");
    } else {
      callRef.current.mute(false); setMicMuted(false);
      if (holdMusicRef.current) { holdMusicRef.current.pause(); holdMusicRef.current.currentTime = 0; }
      setStatus("Connected");
    }
  };

  // ── Load extensions for picker ──
  const loadExtensions = async () => {
    if (!orgId || !phoneDocId) return;
    setLoadingExtensions(true);
    try {
      const res  = await fetch(`${EXTENSIONS_URL}?orgId=${encodeURIComponent(orgId)}&phoneNumberDocId=${encodeURIComponent(phoneDocId)}`);
      const data = await res.json();
      if (data.success) setExtensions({ employees: data.employees || [], departments: data.departments || [] });
    } catch (err) { console.error("Failed to load extensions:", err); }
    setLoadingExtensions(false);
  };

  // ── Open transfer/conference panel ──
  const openPanel = (mode) => {
    setTransferMode(mode);
    setShowTransferPanel(true);
    setManualNumber("");
    loadExtensions();
  };

  // ── Initiate transfer ──
  const initiateTransfer = async (ext, name, manualNum) => {
    if (transferring) return;
    setTransferring(true);
    try {
      const body = {
        action:          "initiate",
        callSid:         callSidRef.current,
        orgId,
        phoneNumberDocId: phoneDocId,
      };
      if (ext)       body.targetExtension = ext;
      if (manualNum) body.targetNumber    = manualNum;

      const res  = await fetch(TRANSFER_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const data = await res.json();

      if (data.success) {
        setTransferTarget({ name: data.targetName, extension: ext });
        setConsultCallSid(data.consultCallSid);
        setConferenceName(data.conferenceName);
        setTransferStatus("consulting");
        setStatus("Consulting...");
        setShowTransferPanel(false);
      } else {
        alert(`Transfer failed: ${data.error}`);
      }
    } catch (err) { alert(`Transfer error: ${err.message}`); }
    setTransferring(false);
  };

  // ── Complete warm transfer ──
  const completeTransfer = async () => {
    setTransferring(true);
    try {
      const res  = await fetch(TRANSFER_URL, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"complete", callSid: callSidRef.current, orgId }),
      });
      const data = await res.json();
      if (data.success) { setTransferStatus("completed"); setTimeout(() => resetCallState(), 1000); }
      else alert(`Complete failed: ${data.error}`);
    } catch (err) { alert(`Error: ${err.message}`); }
    setTransferring(false);
  };

  // ── Cancel transfer ──
  const cancelTransfer = async () => {
    try {
      await fetch(TRANSFER_URL, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"cancel", callSid: callSidRef.current, orgId }),
      });
      setTransferStatus(null); setTransferTarget(null); setStatus("Connected");
    } catch (err) { alert(`Error: ${err.message}`); }
  };

  // ── Start conference ──
  const startConference = async (ext, name, manualNum) => {
    if (transferring) return;
    setTransferring(true);
    try {
      const body = {
        action: "start",
        callSid: callSidRef.current,
        orgId,
        phoneNumberDocId: phoneDocId,
      };
      if (ext)       body.targetExtension = ext;
      if (manualNum) body.targetNumber    = manualNum;

      const res  = await fetch(CONFERENCE_URL, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body) });
      const data = await res.json();

      if (data.success) {
        setTransferTarget({ name: data.targetName, extension: ext });
        setConferenceName(data.conferenceName);
        setTransferStatus("conference");
        setStatus(`Conference: ${data.targetName}`);
        setShowTransferPanel(false);
      } else {
        alert(`Conference failed: ${data.error}`);
      }
    } catch (err) { alert(`Conference error: ${err.message}`); }
    setTransferring(false);
  };

  // ── Leave conference ──
  const leaveConference = async () => {
    try {
      await fetch(CONFERENCE_URL, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"leave", callSid: callSidRef.current, orgId }),
      });
      resetCallState();
    } catch (err) { alert(`Error: ${err.message}`); }
  };

  // ── End conference ──
  const endConference = async () => {
    try {
      await fetch(CONFERENCE_URL, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ action:"end", callSid: callSidRef.current, orgId }),
      });
      resetCallState();
    } catch (err) { alert(`Error: ${err.message}`); }
  };

  const formatPhoneNumber = (num) => {
    if (!num) return "";
    const c = num.replace(/\D/g, "");
    if (c.length === 11 && c.startsWith("1")) return `+1 (${c.slice(1,4)}) ${c.slice(4,7)}-${c.slice(7)}`;
    if (c.length === 10) return `(${c.slice(0,3)}) ${c.slice(3,6)}-${c.slice(6)}`;
    return num;
  };

  const statusColor = (s) => s === "available" ? "#10b981" : s === "busy" ? "#f59e0b" : "#94a3b8";

  if (!authChecked) return <Screen><div style={s.centerContent}><div style={s.loader}></div><p style={s.statusText}>Verifying access...</p></div></Screen>;
  if (!authorized)  return <Screen><div style={s.centerContent}><p style={s.errorTitle}>Unauthorized Access</p><p style={s.errorText}>You don't have permission to access this phone.</p></div></Screen>;

  return (
    <div style={s.page}>
      {!audioEnabled && !isOutbound && (
        <div style={s.modal}>
          <div style={s.modalCard}>
            <h3 style={s.modalTitle}>Enable Audio</h3>
            <p style={s.modalText}>Allow audio access to hear incoming calls.</p>
            <button style={s.primaryBtn} onClick={() => setAudioEnabled(true)}>Enable Audio</button>
          </div>
        </div>
      )}

      <div style={s.phone}>
        {/* Header */}
        <div style={s.header}>
          <div style={s.headerContent}>
            <div style={s.brandContainer}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
              </svg>
              <span style={s.brandText}>Orbit Phone</span>
            </div>
            <div style={s.statusBadge}><div style={s.statusDot}></div><span style={s.statusLabel}>Online</span></div>
          </div>
          {assignedNumbers.length > 0 && (
            <div style={s.assignedBar}>
              <span style={s.assignedLabel}>Receiving calls on:</span>
              <div style={s.numberPills}>{assignedNumbers.map(n => <span key={n} style={s.numberPill}>{formatPhoneNumber(n)}</span>)}</div>
            </div>
          )}
        </div>

        {/* Content */}
        <div style={s.content}>
          {/* Incoming */}
          {incoming && (
            <div style={s.incomingContainer}>
              <div style={s.callerInfo}>
                <div style={s.avatarRing}><div style={s.avatar}><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div></div>
                <div style={s.callerDetails}>
                  <div style={s.callerLabel}>Incoming Call</div>
                  <div style={s.callerNumber}>{formatPhoneNumber(phoneNumber)}</div>
                  {calledToNumber && (
                    <div style={s.calledToBadge}>
                      <span style={s.calledToLabel}>To:</span>
                      <span style={s.calledToNumber}>{formatPhoneNumber(calledToNumber)}</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={s.incomingActions}>
                <button style={s.rejectBtn} onClick={reject}>Decline</button>
                <button style={s.acceptBtn} onClick={accept}>Accept</button>
              </div>
            </div>
          )}

          {/* Active Call */}
          {inCall && !incoming && (
            <div style={s.activeCallContainer}>
              <div style={s.activeCallInfo}>
                <div style={s.activeAvatar}><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg></div>
                <div style={s.activeCallDetails}>
                  <div style={s.activeNumber}>{formatPhoneNumber(phoneNumber)}</div>
                  <div style={s.activeStatus}>{status}</div>
                  <div style={s.activeDuration}>{formatDuration(callDuration)}</div>
                  {calledToNumber && (
                    <div style={{...s.calledToBadge, marginTop:10, justifyContent:"center"}}>
                      <span style={s.calledToLabel}>To:</span>
                      <span style={s.calledToNumber}>{formatPhoneNumber(calledToNumber)}</span>
                    </div>
                  )}
                  {/* Transfer consulting banner */}
                  {transferStatus === "consulting" && transferTarget && (
                    <div style={s.consultingBanner}>
                      <div style={s.consultingText}>🔄 Consulting with {transferTarget.name}</div>
                      <div style={s.consultingText}>Customer is on hold</div>
                      <div style={s.consultingBtns}>
                        <button style={s.completeTxBtn} onClick={completeTransfer} disabled={transferring}>
                          {transferring ? "..." : "✓ Complete Transfer"}
                        </button>
                        <button style={s.cancelTxBtn} onClick={cancelTransfer}>✕ Cancel</button>
                      </div>
                    </div>
                  )}
                  {/* Conference banner */}
                  {transferStatus === "conference" && transferTarget && (
                    <div style={s.conferenceBanner}>
                      <div style={s.consultingText}>👥 Conference with {transferTarget.name}</div>
                      <div style={s.consultingBtns}>
                        <button style={s.completeTxBtn} onClick={leaveConference}>Leave Call</button>
                        <button style={s.cancelTxBtn}   onClick={endConference}>End All</button>
                      </div>
                    </div>
                  )}
                  {isRecording && <div style={s.recordingIndicator}><div style={s.recordingDot}></div><span style={s.recordingText}>Recording</span></div>}
                </div>
              </div>

              {/* Main call controls */}
              <div style={s.callControls}>
                <button style={{...s.controlBtn,...(micMuted&&!onHold?s.controlBtnActive:{})}} onClick={toggleMic} disabled={onHold}>
                  <div style={s.controlIconContainer}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {micMuted
                        ? <><line x1="1" y1="1" x2="23" y2="23"></line><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"></path><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"></path></>
                        : <><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></>}
                    </svg>
                  </div>
                  <span style={s.controlLabel}>{micMuted ? "Unmute" : "Mute"}</span>
                </button>

                <button style={s.hangupBtn} onClick={hangup}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                  </svg>
                </button>

                <button style={{...s.controlBtn,...(onHold?s.controlBtnActive:{})}} onClick={toggleHold}>
                  <div style={s.controlIconContainer}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      {onHold ? <polygon points="5 3 19 12 5 21 5 3"></polygon> : <><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></>}
                    </svg>
                  </div>
                  <span style={s.controlLabel}>{onHold ? "Resume" : "Hold"}</span>
                </button>
              </div>

              {/* Secondary controls — Keypad + Transfer + Conference */}
              <div style={s.secondaryControls}>
                <button style={{...s.secondaryControlBtn,...(showKeypad?s.secondaryControlBtnActive:{})}} onClick={() => setShowKeypad(!showKeypad)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect>
                    <rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect>
                  </svg>
                  <span style={s.secondaryControlLabel}>Keypad</span>
                </button>

                {/* ✅ Transfer button */}
                <button
                  style={{...s.secondaryControlBtn,...(transferStatus==="consulting"?s.transferBtnActive:{})}}
                  onClick={() => openPanel("transfer")}
                  disabled={!!transferStatus}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="17 1 21 5 17 9"></polyline>
                    <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
                    <polyline points="7 23 3 19 7 15"></polyline>
                    <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
                  </svg>
                  <span style={s.secondaryControlLabel}>Transfer</span>
                </button>

                {/* ✅ Conference button */}
                <button
                  style={{...s.secondaryControlBtn,...(transferStatus==="conference"?s.conferenceBtnActive:{})}}
                  onClick={() => openPanel("conference")}
                  disabled={transferStatus === "consulting"}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                    <circle cx="9" cy="7" r="4"></circle>
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                  </svg>
                  <span style={s.secondaryControlLabel}>Conference</span>
                </button>
              </div>
            </div>
          )}

          {/* Idle */}
          {!inCall && !incoming && (
            <div style={s.idleContainer}>
              <div style={s.idleIcon}>
                <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="#cbd5e1" strokeWidth="1.5">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path>
                </svg>
              </div>
              <div style={s.idleTitle}>Ready for Calls</div>
              <div style={s.idleText}>{status}</div>
            </div>
          )}
        </div>

        {/* DTMF Keypad */}
        {showKeypad && inCall && (
          <div style={s.keypadModal} onClick={() => setShowKeypad(false)}>
            <div style={s.keypadContainer} onClick={e => e.stopPropagation()}>
              <div style={s.keypadHeader}>
                <h3 style={s.keypadTitle}>Dialpad</h3>
                <button style={s.keypadCloseBtn} onClick={() => setShowKeypad(false)}>✕</button>
              </div>
              <div style={s.keypadGrid}>
                {[{d:"1",l:""},{d:"2",l:"ABC"},{d:"3",l:"DEF"},{d:"4",l:"GHI"},{d:"5",l:"JKL"},{d:"6",l:"MNO"},{d:"7",l:"PQRS"},{d:"8",l:"TUV"},{d:"9",l:"WXYZ"},{d:"*",l:""},{d:"0",l:"+"},{d:"#",l:""}].map(({d,l}) => (
                  <button key={d} style={s.keypadBtn} onClick={() => sendDTMF(d)}>
                    <span style={s.keypadDigit}>{d}</span>
                    {l && <span style={s.keypadLetters}>{l}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ✅ Transfer/Conference Extension Picker Panel */}
        {showTransferPanel && (
          <div style={s.panelOverlay} onClick={() => setShowTransferPanel(false)}>
            <div style={s.panel} onClick={e => e.stopPropagation()}>
              <div style={s.panelHeader}>
                <h3 style={s.panelTitle}>{transferMode === "transfer" ? "Transfer Call" : "Add to Conference"}</h3>
                <button style={s.keypadCloseBtn} onClick={() => setShowTransferPanel(false)}>✕</button>
              </div>

              {loadingExtensions ? (
                <div style={s.panelLoading}><div style={s.loader}></div></div>
              ) : (
                <div style={s.panelContent}>
                  {/* Departments */}
                  {extensions.departments.length > 0 && (
                    <>
                      <div style={s.sectionLabel}>DEPARTMENTS</div>
                      {extensions.departments.map(dept => (
                        <button key={dept.docId} style={s.extRow}
                          onClick={() => transferMode === "transfer"
                            ? initiateTransfer(dept.extension, dept.name, null)
                            : startConference(dept.extension, dept.name, null)}
                          disabled={transferring}>
                          <div style={s.extBadge}>{dept.extension}</div>
                          <div style={s.extInfo}>
                            <div style={s.extName}>{dept.name}</div>
                            <div style={s.extSub}>{dept.members} member{dept.members !== 1 ? "s" : ""}</div>
                          </div>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                          </svg>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Employees */}
                  {extensions.employees.length > 0 && (
                    <>
                      <div style={{...s.sectionLabel, marginTop: extensions.departments.length > 0 ? 16 : 0}}>EMPLOYEES</div>
                      {extensions.employees.map(emp => (
                        <button key={emp.docId} style={s.extRow}
                          onClick={() => transferMode === "transfer"
                            ? initiateTransfer(emp.extension, emp.name, null)
                            : startConference(emp.extension, emp.name, null)}
                          disabled={transferring}>
                          <div style={{...s.extBadge, background: "rgba(59,130,246,0.15)", borderColor: "rgba(59,130,246,0.4)", color: "#3b82f6"}}>{emp.extension}</div>
                          <div style={s.extInfo}>
                            <div style={s.extName}>{emp.name}</div>
                            <div style={{...s.extSub, color: statusColor(emp.availabilityStatus)}}>
                              ● {emp.availabilityStatus}
                            </div>
                          </div>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2">
                            <polyline points="9 18 15 12 9 6"></polyline>
                          </svg>
                        </button>
                      ))}
                    </>
                  )}

                  {/* Manual number entry */}
                  <div style={s.sectionLabel}>OR ENTER NUMBER</div>
                  <div style={s.manualRow}>
                    <input
                      style={s.manualInput}
                      type="tel"
                      placeholder="+1 (619) 555-0000"
                      value={manualNumber}
                      onChange={e => setManualNumber(e.target.value)}
                    />
                    <button style={s.manualBtn}
                      onClick={() => transferMode === "transfer"
                        ? initiateTransfer(null, manualNumber, manualNumber)
                        : startConference(null, manualNumber, manualNumber)}
                      disabled={!manualNumber || transferring}>
                      {transferring ? "..." : "→"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const Screen = ({ children }) => <div style={s.page}><div style={s.phone}>{children}</div></div>;

const s = {
  page: { minHeight:"100vh", width:"100vw", display:"flex", justifyContent:"center", alignItems:"center", background:"linear-gradient(135deg,#667eea 0%,#764ba2 100%)", fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif", padding:20 },
  phone: { width:420, maxWidth:"100%", background:"#ffffff", borderRadius:32, boxShadow:"0 25px 80px rgba(0,0,0,.25)", overflow:"hidden", display:"flex", flexDirection:"column", position:"relative" },
  header: { background:"linear-gradient(135deg,#667eea 0%,#764ba2 100%)", padding:"20px 24px 16px" },
  headerContent: { display:"flex", alignItems:"center", justifyContent:"space-between" },
  brandContainer: { display:"flex", alignItems:"center", gap:12 },
  brandText: { color:"#fff", fontSize:18, fontWeight:600 },
  statusBadge: { display:"flex", alignItems:"center", gap:6, background:"rgba(255,255,255,.2)", padding:"6px 12px", borderRadius:20 },
  statusDot: { width:6, height:6, borderRadius:"50%", background:"#4ade80", boxShadow:"0 0 8px #4ade80" },
  statusLabel: { color:"#fff", fontSize:12, fontWeight:500 },
  assignedBar: { marginTop:12, paddingTop:12, borderTop:"1px solid rgba(255,255,255,.2)", display:"flex", flexDirection:"column", gap:6 },
  assignedLabel: { color:"rgba(255,255,255,.7)", fontSize:11, fontWeight:500, textTransform:"uppercase", letterSpacing:".6px" },
  numberPills: { display:"flex", flexWrap:"wrap", gap:6 },
  numberPill: { background:"rgba(255,255,255,.18)", color:"#fff", fontSize:13, fontWeight:600, padding:"4px 12px", borderRadius:20, border:"1px solid rgba(255,255,255,.3)" },
  content: { minHeight:500, display:"flex", flexDirection:"column" },
  centerContent: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:60 },
  incomingContainer: { padding:"60px 32px", display:"flex", flexDirection:"column", alignItems:"center", flex:1, justifyContent:"center" },
  callerInfo: { textAlign:"center", marginBottom:48 },
  avatarRing: { width:120, height:120, borderRadius:"50%", background:"rgba(102,126,234,.1)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 24px" },
  avatar: { width:96, height:96, borderRadius:"50%", background:"linear-gradient(135deg,#667eea 0%,#764ba2 100%)", display:"flex", alignItems:"center", justifyContent:"center" },
  callerDetails: { display:"flex", flexDirection:"column", gap:8, alignItems:"center" },
  callerLabel: { fontSize:14, fontWeight:500, color:"#64748b", textTransform:"uppercase", letterSpacing:".5px" },
  callerNumber: { fontSize:28, fontWeight:600, color:"#1e293b" },
  calledToBadge: { display:"inline-flex", alignItems:"center", gap:5, background:"rgba(102,126,234,.1)", border:"1px solid rgba(102,126,234,.25)", borderRadius:20, padding:"5px 12px", marginTop:4, color:"#667eea" },
  calledToLabel: { fontSize:12, fontWeight:600, color:"#667eea", textTransform:"uppercase", letterSpacing:".4px" },
  calledToNumber: { fontSize:13, fontWeight:700, color:"#4f46e5" },
  incomingActions: { display:"flex", gap:20, width:"100%", maxWidth:340 },
  acceptBtn: { flex:1, padding:"18px 24px", background:"#10b981", color:"#fff", border:"none", borderRadius:16, fontSize:16, fontWeight:600, cursor:"pointer" },
  rejectBtn: { flex:1, padding:"18px 24px", background:"#ef4444", color:"#fff", border:"none", borderRadius:16, fontSize:16, fontWeight:600, cursor:"pointer" },
  activeCallContainer: { padding:"48px 32px 32px", display:"flex", flexDirection:"column", flex:1, justifyContent:"space-between" },
  activeCallInfo: { textAlign:"center", marginBottom:32 },
  activeAvatar: { width:80, height:80, borderRadius:"50%", background:"linear-gradient(135deg,#667eea 0%,#764ba2 100%)", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px", boxShadow:"0 10px 30px rgba(102,126,234,.3)" },
  activeCallDetails: { display:"flex", flexDirection:"column", alignItems:"center", gap:8 },
  activeNumber: { fontSize:24, fontWeight:600, color:"#1e293b" },
  activeStatus: { fontSize:14, color:"#64748b", fontWeight:500 },
  activeDuration: { fontSize:18, fontWeight:600, color:"#667eea" },
  recordingIndicator: { display:"flex", alignItems:"center", justifyContent:"center", gap:8, marginTop:12, padding:"8px 16px", background:"rgba(239,68,68,.1)", borderRadius:20 },
  recordingDot: { width:8, height:8, borderRadius:"50%", background:"#ef4444" },
  recordingText: { fontSize:13, fontWeight:600, color:"#ef4444" },
  // Consulting/conference banners
  consultingBanner: { marginTop:12, padding:"12px 16px", background:"rgba(245,158,11,.1)", border:"1px solid rgba(245,158,11,.3)", borderRadius:12 },
  conferenceBanner: { marginTop:12, padding:"12px 16px", background:"rgba(102,126,234,.1)", border:"1px solid rgba(102,126,234,.3)", borderRadius:12 },
  consultingText: { fontSize:13, color:"#92400e", fontWeight:500, marginBottom:8, textAlign:"center" },
  consultingBtns: { display:"flex", gap:8 },
  completeTxBtn: { flex:1, padding:"8px 12px", background:"#10b981", color:"#fff", border:"none", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" },
  cancelTxBtn: { flex:1, padding:"8px 12px", background:"#ef4444", color:"#fff", border:"none", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer" },
  callControls: { display:"flex", alignItems:"center", justifyContent:"center", gap:20, marginBottom:20 },
  controlBtn: { width:80, padding:"20px 12px", background:"#f1f5f9", border:"none", borderRadius:20, display:"flex", flexDirection:"column", alignItems:"center", gap:10, cursor:"pointer" },
  controlBtnActive: { background:"#667eea", color:"#fff" },
  controlIconContainer: { width:48, height:48, borderRadius:"50%", background:"rgba(255,255,255,.5)", display:"flex", alignItems:"center", justifyContent:"center" },
  controlLabel: { fontSize:13, fontWeight:600, color:"#475569" },
  hangupBtn: { width:80, height:80, background:"#ef4444", color:"#fff", border:"none", borderRadius:"50%", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 10px 25px rgba(239,68,68,.4)" },
  secondaryControls: { display:"flex", justifyContent:"center", gap:8 },
  secondaryControlBtn: { padding:"10px 14px", background:"#f1f5f9", border:"none", borderRadius:12, display:"flex", alignItems:"center", gap:6, cursor:"pointer" },
  secondaryControlBtnActive: { background:"#667eea", color:"#fff" },
  transferBtnActive: { background:"#f59e0b", color:"#fff" },
  conferenceBtnActive: { background:"#667eea", color:"#fff" },
  secondaryControlLabel: { fontSize:13, fontWeight:600, color:"#475569" },
  // Keypad
  keypadModal: { position:"absolute", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,.7)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, borderRadius:32 },
  keypadContainer: { background:"#fff", borderRadius:24, padding:24, width:"90%", maxWidth:340 },
  keypadHeader: { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 },
  keypadTitle: { fontSize:20, fontWeight:600, color:"#1e293b", margin:0 },
  keypadCloseBtn: { width:36, height:36, background:"#f1f5f9", border:"none", borderRadius:"50%", cursor:"pointer", fontSize:16, display:"flex", alignItems:"center", justifyContent:"center" },
  keypadGrid: { display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 },
  keypadBtn: { aspectRatio:"1", background:"#f1f5f9", border:"none", borderRadius:16, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", cursor:"pointer", padding:20 },
  keypadDigit: { fontSize:28, fontWeight:600, color:"#1e293b" },
  keypadLetters: { fontSize:11, fontWeight:500, color:"#64748b", marginTop:2, letterSpacing:".5px" },
  // Extension picker panel
  panelOverlay: { position:"absolute", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,.6)", display:"flex", alignItems:"flex-end", zIndex:1000, borderRadius:32 },
  panel: { background:"#fff", borderRadius:"20px 20px 32px 32px", width:"100%", maxHeight:"85%", display:"flex", flexDirection:"column" },
  panelHeader: { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"20px 24px 16px", borderBottom:"1px solid #e2e8f0" },
  panelTitle: { fontSize:18, fontWeight:600, color:"#1e293b", margin:0 },
  panelLoading: { display:"flex", justifyContent:"center", padding:40 },
  panelContent: { overflowY:"auto", padding:"16px 20px 24px", flex:1 },
  sectionLabel: { fontSize:11, fontWeight:700, color:"#94a3b8", letterSpacing:"1px", textTransform:"uppercase", marginBottom:8 },
  extRow: { width:"100%", display:"flex", alignItems:"center", gap:12, padding:"12px 14px", background:"#f8fafc", border:"1px solid #e2e8f0", borderRadius:12, cursor:"pointer", marginBottom:8, textAlign:"left" },
  extBadge: { width:44, height:44, borderRadius:10, background:"rgba(245,158,11,.15)", border:"1px solid rgba(245,158,11,.4)", color:"#d97706", fontSize:14, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 },
  extInfo: { flex:1 },
  extName: { fontSize:14, fontWeight:600, color:"#1e293b" },
  extSub: { fontSize:12, color:"#64748b", marginTop:2 },
  manualRow: { display:"flex", gap:8, marginTop:8 },
  manualInput: { flex:1, padding:"12px 14px", border:"1px solid #e2e8f0", borderRadius:10, fontSize:14, color:"#1e293b", outline:"none" },
  manualBtn: { width:48, height:48, background:"#667eea", color:"#fff", border:"none", borderRadius:10, fontSize:20, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 },
  // Idle
  idleContainer: { padding:"80px 32px", textAlign:"center", flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center" },
  idleIcon: { marginBottom:24, opacity:.6 },
  idleTitle: { fontSize:24, fontWeight:600, color:"#1e293b", marginBottom:12 },
  idleText: { fontSize:15, color:"#64748b", fontWeight:500 },
  // Loading
  loader: { width:48, height:48, border:"4px solid #e2e8f0", borderTop:"4px solid #667eea", borderRadius:"50%", animation:"spin 1s linear infinite", marginBottom:16 },
  statusText: { fontSize:16, color:"#64748b", fontWeight:500 },
  errorTitle: { fontSize:20, fontWeight:600, color:"#1e293b", marginBottom:8 },
  errorText: { fontSize:15, color:"#64748b" },
  // Modal
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,.5)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 },
  modalCard: { background:"#fff", padding:"48px 40px", borderRadius:24, textAlign:"center", maxWidth:360, margin:"0 20px" },
  modalTitle: { fontSize:24, fontWeight:600, marginBottom:12, color:"#1e293b" },
  modalText: { fontSize:15, color:"#64748b", marginBottom:32, lineHeight:1.6 },
  primaryBtn: { width:"100%", padding:"16px 24px", background:"linear-gradient(135deg,#667eea 0%,#764ba2 100%)", color:"#fff", border:"none", borderRadius:16, fontSize:16, fontWeight:600, cursor:"pointer" },
};

const styleSheet = document.createElement("style");
styleSheet.textContent = `
  @keyframes spin { 0%{transform:rotate(0deg)} 100%{transform:rotate(360deg)} }
  @keyframes pulse { 0%,100%{transform:scale(1);opacity:1} 50%{transform:scale(1.05);opacity:.8} }
  button:hover{transform:translateY(-1px);filter:brightness(1.05)}
  button:active{transform:translateY(0)}
  button:disabled{opacity:.5;cursor:not-allowed;transform:none}
`;
document.head.appendChild(styleSheet);