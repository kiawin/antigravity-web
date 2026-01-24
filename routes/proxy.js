/**
 * Asset Proxy Routes
 */

import express from "express";

export function createProxyRoutes(state, fetchAssetFn) {
  const router = express.Router();

  router.get("/proxy-asset", async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send("Missing url parameter");
    if (!state.cdpConnection) return res.status(503).send("CDP not connected");

    const targetUrl = decodeURIComponent(url);
    console.log(`🖼️ Proxying asset: ${targetUrl.split("/").pop()}`);

    const result = await fetchAssetFn(state.cdpConnection, targetUrl);

    if (result.error || !result.success) {
      return res.status(404).send(result.error || "Asset not found");
    }

    res.set("Content-Type", result.type);
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(result.data, "base64"));
  });

  return router;
}
