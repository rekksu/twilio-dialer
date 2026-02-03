import React from "react";
import OutboundDialer from "./OutboundDialer";
import InboundAgent from "./InboundAgent";

export default function App() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mode"); // inbound | outbound

  if (mode === "inbound") {
    return <InboundAgent />;
  }

  return <OutboundDialer />; // default
}
