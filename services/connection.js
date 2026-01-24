/**
 * CDP Connection Service
 */

import WebSocket from "ws";

const CDP_CALL_TIMEOUT = 30000;

const RECONNECT_CONFIG = {
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  multiplier: 1.5,
};

/**
 * Connect to CDP WebSocket
 */
export async function connectCDP(url, state, callbacks = {}) {
  const ws = new WebSocket(url);

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  let idCounter = 1;
  const pendingCalls = new Map();
  const contexts = [];

  ws.on("close", (code) => {
    console.log(`⚠️ CDP connection closed (code: ${code})`);
    state.cdpConnection = null;

    for (const [_id, { reject, timeoutId }] of pendingCalls) {
      clearTimeout(timeoutId);
      reject(new Error("WebSocket closed"));
    }
    pendingCalls.clear();

    if (callbacks.onClose) callbacks.onClose();
  });

  ws.on("error", (err) => {
    console.error("⚠️ CDP WebSocket error:", err.message);
  });

  ws.on("message", (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.id !== undefined && pendingCalls.has(data.id)) {
        const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
        clearTimeout(timeoutId);
        pendingCalls.delete(data.id);

        if (data.error) reject(data.error);
        else resolve(data.result);
      }

      if (data.method === "Runtime.executionContextCreated") {
        contexts.push(data.params.context);
      }
    } catch (e) {}
  });

  const call = (method, params) =>
    new Promise((resolve, reject) => {
      const id = idCounter++;

      const timeoutId = setTimeout(() => {
        if (pendingCalls.has(id)) {
          pendingCalls.delete(id);
          reject(
            new Error(
              `CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms`,
            ),
          );
        }
      }, CDP_CALL_TIMEOUT);

      pendingCalls.set(id, { resolve, reject, timeoutId });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await call("Runtime.enable", {});
  await new Promise((r) => setTimeout(r, 1000));

  return { ws, call, contexts };
}

/**
 * Create reconnection manager
 */
export function createReconnector(
  state,
  discoverFn,
  connectFn,
  callbacks = {},
) {
  const reconnectState = {
    isReconnecting: false,
    currentDelayMs: RECONNECT_CONFIG.initialDelayMs,
  };

  async function attemptReconnect() {
    try {
      console.log("🔌 Attempting to reconnect to IDE...");

      const cdpInfo = await discoverFn(state.currentWorkspaceId, state);
      state.cdpConnection = await connectFn(cdpInfo.url, state, {
        onClose: () => scheduleReconnect(),
      });

      reconnectState.isReconnecting = false;
      reconnectState.currentDelayMs = RECONNECT_CONFIG.initialDelayMs;

      console.log(`✅ Reconnected to IDE!`);

      if (callbacks.onReconnect) callbacks.onReconnect();
    } catch (err) {
      console.log(`❌ Reconnection failed: ${err.message}`);

      reconnectState.currentDelayMs = Math.min(
        reconnectState.currentDelayMs * RECONNECT_CONFIG.multiplier,
        RECONNECT_CONFIG.maxDelayMs,
      );
      reconnectState.isReconnecting = false;
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (reconnectState.isReconnecting) return;

    reconnectState.isReconnecting = true;
    const delay = reconnectState.currentDelayMs;

    console.log(`🔄 Scheduling reconnection in ${delay}ms...`);

    if (callbacks.onDisconnect) {
      callbacks.onDisconnect(delay);
    }

    setTimeout(attemptReconnect, delay);
  }

  return { scheduleReconnect, attemptReconnect };
}
