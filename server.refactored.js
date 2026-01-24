#!/usr/bin/env node
/**
 * Antigravity Web Server - Fully Modular
 * Entry point that wires together all modules
 */

import express from "express";
import WebSocket, { WebSocketServer } from "ws";
import http from "http";
import https from "https";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Services
import { connectCDP, createReconnector } from "./services/connection.js";
import {
  getAllWorkspaces as _getAllWorkspaces,
  discoverCDP,
} from "./services/workspaces.js";
import { startPolling } from "./services/polling.js";

// Routes
import { createApiRoutes } from "./routes/api.js";
import { createHealthRoutes } from "./routes/health.js";
import { createWorkspaceRoutes } from "./routes/workspaces.js";
import { createProxyRoutes } from "./routes/proxy.js";

// Utils
import { getLocalIP } from "./utils/helpers.js";
import { inspectUI } from "./ui_inspector.js";

// CDP Scripts & Executor
import { executeInContexts } from "./cdp/executor.js";
import {
  captureSnapshotScript,
  injectMessageScript,
  setModeScript,
  setModelScript,
  stopGenerationScript,
  triggerAgqScript,
  clickElementScript,
  remoteScrollScript,
  getAppStateScript,
  checkAgentPanelScript,
  ensureAgentPanelVisibleScript,
  createNewConversationScript,
  triggerIdeActionScript,
  clickConversationsToggleScript,
  extractConversationsScript,
  selectConversationItemScript,
  clickArtifactOpenScript,
  captureArtifactScript,
  fetchAssetScript,
} from "./cdp/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================
// Application State
// ============================================================

const state = {
  cdpConnection: null,
  lastSnapshot: null,
  lastSnapshotHash: null,
  currentWorkspaceId: null,
  wss: null,
};

// ============================================================
// CDP Actions (thin wrappers around scripts)
// ============================================================

const actions = {
  async captureSnapshot(cdp) {
    return await executeInContexts(cdp, captureSnapshotScript.toString());
  },

  async injectMessage(cdp, message) {
    return await executeInContexts(cdp, injectMessageScript.toString(), {
      text: message,
    });
  },

  async setMode(cdp, mode) {
    if (!["Fast", "Planning"].includes(mode)) return { error: "Invalid mode" };
    return await executeInContexts(cdp, setModeScript.toString(), { mode });
  },

  async setModel(cdp, modelName) {
    return await executeInContexts(cdp, setModelScript.toString(), {
      modelName,
    });
  },

  async stopGeneration(cdp) {
    return await executeInContexts(cdp, stopGenerationScript.toString());
  },

  async triggerAgq(cdp) {
    return await executeInContexts(
      cdp,
      triggerAgqScript.toString(),
      {},
      { tryMainFrameFirst: true },
    );
  },

  async clickElement(cdp, params) {
    return await executeInContexts(cdp, clickElementScript.toString(), params);
  },

  async remoteScroll(cdp, params) {
    return await executeInContexts(cdp, remoteScrollScript.toString(), params);
  },

  async getAppState(cdp) {
    return await executeInContexts(cdp, getAppStateScript.toString());
  },

  async checkAgentPanelVisibility(cdp) {
    return await executeInContexts(
      cdp,
      checkAgentPanelScript.toString(),
      {},
      { awaitPromise: false },
    );
  },

  async ensureAgentPanelVisible(cdp) {
    return await executeInContexts(
      cdp,
      ensureAgentPanelVisibleScript.toString(),
      {},
      { awaitPromise: false },
    );
  },

  async createNewConversation(cdp) {
    return await executeInContexts(cdp, createNewConversationScript.toString());
  },

  async triggerIdeAction(cdp, action, index = 0) {
    return await executeInContexts(cdp, triggerIdeActionScript.toString(), {
      action,
      index,
    });
  },

  async getConversations(cdp) {
    // Phase 1: Click toggle
    let buttonClicked = false;
    for (const ctx of cdp.contexts) {
      try {
        const res = await cdp.call("Runtime.evaluate", {
          expression: `(${clickConversationsToggleScript.toString()})()`,
          returnByValue: true,
          awaitPromise: true,
          contextId: ctx.id,
        });
        if (res.result?.value) {
          buttonClicked = true;
          break;
        }
      } catch (e) {}
    }

    // Phase 2: Extract
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 150));
      for (const ctx of cdp.contexts) {
        try {
          const res = await cdp.call("Runtime.evaluate", {
            expression: `(${extractConversationsScript.toString()})()`,
            returnByValue: true,
            awaitPromise: true,
            contextId: ctx.id,
          });
          if (res.result?.value?.success) return res.result.value;
        } catch (e) {}
      }
    }
    return { error: buttonClicked ? "List not found" : "Button not found" };
  },

  async selectConversation(cdp, { index, title }) {
    // Phase 1: Click toggle
    for (const ctx of cdp.contexts) {
      try {
        const res = await cdp.call("Runtime.evaluate", {
          expression: `(${clickConversationsToggleScript.toString()})()`,
          returnByValue: true,
          awaitPromise: true,
          contextId: ctx.id,
        });
        if (res.result?.value) break;
      } catch (e) {}
    }

    // Phase 2: Select
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((r) => setTimeout(r, 150));
      const result = await executeInContexts(
        cdp,
        selectConversationItemScript.toString(),
        { index, title },
      );
      if (result?.success) return result;
    }
    return { error: "Conversation not found" };
  },

  async captureArtifactContent(cdp, { buttonText, artifactTitle, isFile }) {
    // Phase 1: Click Open
    let clickResult = null;
    for (const ctx of cdp.contexts) {
      try {
        const res = await cdp.call("Runtime.evaluate", {
          expression: `(${clickArtifactOpenScript.toString()})(${JSON.stringify({ buttonText, artifactTitle })})`,
          returnByValue: true,
          awaitPromise: true,
          contextId: ctx.id,
        });
        if (res.result?.value?.clicked) {
          clickResult = res.result.value;
          break;
        }
      } catch (e) {}
    }
    if (!clickResult) return { error: "Could not click Open button" };

    await new Promise((r) => setTimeout(r, 500));

    // Phase 2: Capture
    let captureResult = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      captureResult = await executeInContexts(
        cdp,
        captureArtifactScript.toString(),
        { isFile, artifactTitle },
      );
      if (captureResult?.success) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    if (!captureResult?.success) return { error: "Capture failed" };

    // Handle file content
    if (captureResult.isFile && captureResult.uri) {
      try {
        const filePath = captureResult.uri.startsWith("file://")
          ? fileURLToPath(captureResult.uri)
          : captureResult.uri;

        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, "utf8");
          const safe = content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
          const fileName = filePath.split("/").pop();
          return {
            success: true,
            html: `<div class="flex flex-col h-full bg-[#1e1e1e] text-[#d4d4d4]">
                            <div class="px-4 py-2 border-b border-[#2b2b2b] bg-[#252526] font-medium text-sm">${fileName}</div>
                            <div class="flex-1 overflow-auto p-4"><pre><code>${safe}</code></pre></div>
                        </div>`,
            className: "file-view-container",
          };
        }
      } catch (e) {
        return { error: `File read error: ${e.message}` };
      }
    }
    return captureResult;
  },

  async fetchAssetViaCDP(cdp, url) {
    return await executeInContexts(cdp, fetchAssetScript.toString(), { url });
  },
};

// ============================================================
// Server Setup
// ============================================================

async function createServer() {
  const app = express();

  const keyPath = join(__dirname, "certs", "server.key");
  const certPath = join(__dirname, "certs", "server.cert");
  const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

  let server;
  if (hasSSL) {
    server = https.createServer(
      {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      },
      app,
    );
  } else {
    server = http.createServer(app);
  }

  const wss = new WebSocketServer({ server });
  state.wss = wss;

  app.use(express.json());
  app.use(express.static(join(__dirname, "public")));

  // Mount routes
  app.use(createApiRoutes(state, actions));
  app.use(createHealthRoutes(state, { __dirname, hasSSL, inspectUI }));
  app.use("/api", createWorkspaceRoutes(state, connectCDP));
  app.use(createProxyRoutes(state, actions.fetchAssetViaCDP));

  // WebSocket
  wss.on("connection", (ws) => {
    console.log("📱 Client connected");
    ws.on("close", () => console.log("📱 Client disconnected"));
  });

  return { server, wss, app, hasSSL };
}

// ============================================================
// Main
// ============================================================

async function main() {
  try {
    console.log("🔍 Discovering VS Code CDP endpoint...");
    const cdpInfo = await discoverCDP(null, state);
    console.log(`✅ Found VS Code on port ${cdpInfo.port}`);

    console.log("🔌 Connecting to CDP...");

    // Create reconnector
    const reconnector = createReconnector(state, discoverCDP, connectCDP, {
      onDisconnect: (delay) => {
        state.wss?.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(
              JSON.stringify({
                type: "cdp_disconnected",
                reconnectingIn: delay,
              }),
            );
          }
        });
      },
      onReconnect: async () => {
        state.wss?.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: "cdp_reconnected" }));
          }
        });
        const status = await actions.checkAgentPanelVisibility(
          state.cdpConnection,
        );
        if (status.found && !status.visible) {
          await actions.ensureAgentPanelVisible(state.cdpConnection);
        }
      },
    });

    state.cdpConnection = await connectCDP(cdpInfo.url, state, {
      onClose: () => reconnector.scheduleReconnect(),
    });

    console.log(
      `✅ Connected! Found ${state.cdpConnection.contexts.length} contexts\n`,
    );

    // Check agent panel
    const panelStatus = await actions.checkAgentPanelVisibility(
      state.cdpConnection,
    );
    if (panelStatus.found && !panelStatus.visible) {
      await actions.ensureAgentPanelVisible(state.cdpConnection);
    }

    const { server, wss, hasSSL } = await createServer();

    // Start polling
    startPolling(state, actions.captureSnapshot, wss);

    const PORT = process.env.PORT || 3000;
    const localIP = getLocalIP();
    const protocol = hasSSL ? "https" : "http";

    server.listen(PORT, "0.0.0.0", () => {
      console.log(`🚀 Server running on ${protocol}://${localIP}:${PORT}`);
    });

    // Graceful shutdown
    const shutdown = (signal) => {
      console.log(`\n🛑 ${signal}. Shutting down...`);
      if (state.cdpConnection?.ws) state.cdpConnection.ws.close();
      server.close(() => process.exit(0));
    };

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    process.exit(1);
  }
}

main();
