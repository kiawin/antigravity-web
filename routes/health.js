/**
 * Health & System Routes
 */

import express from "express";
import fs from "fs";
import { join } from "path";

export function createHealthRoutes(state, options = {}) {
  const router = express.Router();
  const { __dirname, hasSSL, inspectUI } = options;

  router.get("/health", (req, res) => {
    res.json({
      status: "ok",
      cdpConnected: state.cdpConnection?.ws?.readyState === 1,
      uptime: process.uptime(),
      https: hasSSL,
    });
  });

  router.get("/ssl-status", (req, res) => {
    const keyPath = join(__dirname, "certs", "server.key");
    const certPath = join(__dirname, "certs", "server.cert");
    res.json({
      enabled: hasSSL,
      certsExist: fs.existsSync(keyPath) && fs.existsSync(certPath),
    });
  });

  router.post("/generate-ssl", async (req, res) => {
    try {
      const { execSync } = await import("child_process");
      execSync("node generate_ssl.js", { cwd: __dirname, stdio: "pipe" });
      res.json({ success: true, message: "SSL certificates generated!" });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  router.get("/debug-ui", async (req, res) => {
    if (!state.cdpConnection) {
      return res.status(503).json({ error: "CDP not connected" });
    }
    const uiTree = await inspectUI(state.cdpConnection);
    res.type("json").send(uiTree);
  });

  return router;
}
