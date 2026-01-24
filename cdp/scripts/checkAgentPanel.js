/**
 * Check Agent Panel Visibility
 * This script runs in the browser context via CDP
 */

export const checkAgentPanelScript = function () {
  const panel = document.getElementById("antigravity.agentPanel");
  if (!panel) return { found: false, error: "Panel not found" };
  const parent = panel.parentElement;
  const target = parent || panel;
  const style = window.getComputedStyle(target);
  return {
    found: true,
    visible: style.display !== "none",
    display: style.display,
  };
};
