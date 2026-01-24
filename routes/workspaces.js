/**
 * Workspace Routes
 */

import express from "express";
import { getAllWorkspaces, discoverCDP } from "../services/workspaces.js";

export function createWorkspaceRoutes(state, connectFn) {
  const router = express.Router();

  router.get("/workspaces", async (req, res) => {
    try {
      const workspaces = await getAllWorkspaces();
      res.json({
        success: true,
        workspaces,
        currentWorkspaceId: state.currentWorkspaceId,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post("/workspace/switch", async (req, res) => {
    try {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: "Missing workspace ID" });

      const cdpInfo = await discoverCDP(id, state);

      if (state.cdpConnection?.ws) {
        try {
          state.cdpConnection.ws.close();
        } catch (e) {}
        state.cdpConnection = null;
      }

      state.cdpConnection = await connectFn(cdpInfo.url, state, {});
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  return router;
}
