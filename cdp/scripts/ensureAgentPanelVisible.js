/**
 * Ensure Agent Panel is Visible
 * This script runs in the browser context via CDP
 */

export const ensureAgentPanelVisibleScript = function () {
  const panel = document.getElementById("antigravity.agentPanel");
  if (!panel) return { success: false, error: "Panel not found" };
  const parent = panel.parentElement;
  const target = parent || panel;
  const prevDisplay = target.style.display;
  target.style.display = "block";
  return {
    success: true,
    previousDisplay: prevDisplay,
    newDisplay: "block",
  };
};
