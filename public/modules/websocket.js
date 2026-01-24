/**
 * WebSocket Connection
 */

import { state } from "./state.js";
import { UI } from "./ui.js";

export function connectWebSocket(onSnapshotUpdate) {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  state.ws = new WebSocket(`${protocol}//${window.location.host}`);

  state.ws.onopen = () => {
    console.log("WS Connected");
    updateStatus(true);
    onSnapshotUpdate();
  };

  state.ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (
      data.type === "snapshot_update" &&
      state.autoRefreshEnabled &&
      !state.userIsScrolling
    ) {
      onSnapshotUpdate();
    }
  };

  state.ws.onclose = () => {
    console.log("WS Disconnected");
    updateStatus(false);
    setTimeout(() => connectWebSocket(onSnapshotUpdate), 2000);
  };
}

export function updateStatus(connected) {
  if (!UI.statusDot) return;
  if (connected) {
    UI.statusDot.classList.remove("disconnected");
    UI.statusDot.classList.add("connected");
    UI.statusText.textContent = "Live";
  } else {
    UI.statusDot.classList.remove("connected");
    UI.statusDot.classList.add("disconnected");
    UI.statusText.textContent = "Reconnecting";
  }
}
