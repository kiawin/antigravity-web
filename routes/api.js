/**
 * API Routes
 */

import express from "express";

export function createApiRoutes(state, actions) {
  const router = express.Router();

  // Middleware to check CDP connection
  const requireCDP = (req, res, next) => {
    if (!state.cdpConnection) {
      return res.status(503).json({ error: "CDP disconnected" });
    }
    next();
  };

  // --- Snapshot ---
  router.get("/snapshot", (req, res) => {
    if (!state.lastSnapshot) {
      return res.status(503).json({ error: "No snapshot available yet" });
    }
    res.json(state.lastSnapshot);
  });

  // --- Messages ---
  router.post("/send", requireCDP, async (req, res) => {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message required" });

    const result = await actions.injectMessage(state.cdpConnection, message);
    res.json({ success: result.ok !== false, details: result });
  });

  router.post("/stop", requireCDP, async (req, res) => {
    res.json(await actions.stopGeneration(state.cdpConnection));
  });

  // --- Mode & Model ---
  router.post("/set-mode", requireCDP, async (req, res) => {
    res.json(await actions.setMode(state.cdpConnection, req.body.mode));
  });

  router.post("/set-model", requireCDP, async (req, res) => {
    res.json(await actions.setModel(state.cdpConnection, req.body.model));
  });

  router.get("/app-state", async (req, res) => {
    if (!state.cdpConnection) {
      return res.json({ mode: "Unknown", model: "Unknown" });
    }
    res.json(await actions.getAppState(state.cdpConnection));
  });

  // --- Conversations ---
  router.get("/conversations", requireCDP, async (req, res) => {
    res.json(await actions.getConversations(state.cdpConnection));
  });

  router.post("/select-conversation", requireCDP, async (req, res) => {
    res.json(await actions.selectConversation(state.cdpConnection, req.body));
  });

  router.post("/new-conversation", requireCDP, async (req, res) => {
    res.json(await actions.createNewConversation(state.cdpConnection));
  });

  // --- Artifacts ---
  router.post("/get-artifact", requireCDP, async (req, res) => {
    res.json(
      await actions.captureArtifactContent(state.cdpConnection, req.body),
    );
  });

  // --- Remote Control ---
  router.post("/remote-click", requireCDP, async (req, res) => {
    res.json(await actions.clickElement(state.cdpConnection, req.body));
  });

  router.post("/remote-scroll", requireCDP, async (req, res) => {
    res.json(await actions.remoteScroll(state.cdpConnection, req.body));
  });

  router.post("/trigger-action", requireCDP, async (req, res) => {
    const { action, index } = req.body;
    try {
      const result = await actions.triggerIdeAction(
        state.cdpConnection,
        action,
        index,
      );
      if (result?.success) {
        res.json({ success: true });
      } else {
        res.status(500).json({ error: result?.error || "Action failed" });
      }
    } catch (e) {
      res.status(500).json({ error: e.toString() });
    }
  });

  router.post("/trigger-agq", requireCDP, async (req, res) => {
    res.json(await actions.triggerAgq(state.cdpConnection));
  });

  // --- Agent Panel ---
  router.get("/agent-panel-status", requireCDP, async (req, res) => {
    res.json(await actions.checkAgentPanelVisibility(state.cdpConnection));
  });

  router.post("/agent-panel-show", requireCDP, async (req, res) => {
    res.json(await actions.ensureAgentPanelVisible(state.cdpConnection));
  });

  return router;
}
