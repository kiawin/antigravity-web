/**
 * Workspace Discovery Service
 */

import http from "http";

const PORTS = [9000, 9001, 9002, 9003];

/**
 * HTTP GET JSON helper
 */
function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

/**
 * Get all available workspaces across debugging ports
 */
export async function getAllWorkspaces() {
  const workspaces = [];
  for (const port of PORTS) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      const targets = list.filter(
        (t) =>
          (t.url?.includes("workbench.html") ||
            (t.title && t.title.includes("workbench"))) &&
          !t.url?.includes("workbench-jetski-agent.html") &&
          t.type === "page",
      );

      targets.forEach((t) => {
        let title = t.title || "Untitled Workspace";
        title = title
          .replace(" — Implementation Plan", "")
          .replace(" — Task", "")
          .replace(" — Walkthrough", "");

        if (title === "Antigravity" || title.includes("workbench")) {
          title = "Main Window";
        }
        if (title === "Agent") {
          title = "New Conversation";
        }

        workspaces.push({
          id: t.id,
          title,
          originalTitle: t.title,
          wsUrl: t.webSocketDebuggerUrl,
          port,
        });
      });
    } catch (e) {}
  }
  return workspaces;
}

/**
 * Discover CDP endpoint for a specific target or first available
 */
export async function discoverCDP(targetId = null, state = {}) {
  const workspaces = await getAllWorkspaces();

  if (workspaces.length === 0) {
    throw new Error(
      "CDP not found. Is Antigravity started with --remote-debugging-port=9000?",
    );
  }

  if (targetId) {
    const target = workspaces.find((w) => w.id === targetId);
    if (target) {
      state.currentWorkspaceId = target.id;
      return { port: target.port, url: target.wsUrl };
    }
    console.warn(
      `Requested target ${targetId} not found, falling back to default.`,
    );
  }

  state.currentWorkspaceId = workspaces[0].id;
  return { port: workspaces[0].port, url: workspaces[0].wsUrl };
}
