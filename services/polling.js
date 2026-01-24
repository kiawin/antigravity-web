/**
 * Background Polling Service
 */

import WebSocket from "ws";
import { hashString } from "../utils/helpers.js";

/**
 * Start background polling for snapshot changes
 */
export function startPolling(state, captureSnapshotFn, wss, options = {}) {
  const { interval = 1000 } = options;

  setInterval(async () => {
    if (!state.cdpConnection) return;

    try {
      const snapshot = await captureSnapshotFn(state.cdpConnection);

      if (snapshot?.error) {
        console.log("⚠️ Snapshot error:", snapshot.error);
        return;
      }

      if (snapshot && !snapshot.error) {
        const hash = hashString(snapshot.html);

        if (hash !== state.lastSnapshotHash) {
          state.lastSnapshot = snapshot;
          state.lastSnapshotHash = hash;

          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(
                JSON.stringify({
                  type: "snapshot_update",
                  timestamp: new Date().toISOString(),
                }),
              );
            }
          });

          console.log(`📸 Snapshot updated (hash: ${hash})`);
        }
      }
    } catch (err) {
      console.error("Poll error:", err.message);
    }
  }, interval);
}
