/**
 * Stop generation in Antigravity
 * This script runs in the browser context via CDP
 */

export const stopGenerationScript = async function () {
  // Look for the cancel button
  const cancel = document.querySelector(
    '[data-tooltip-id="input-send-button-cancel-tooltip"]',
  );
  if (cancel && cancel.offsetParent !== null) {
    cancel.click();
    return { success: true };
  }

  // Fallback: Look for a square icon in the send button area
  const stopBtn = document
    .querySelector("button svg.lucide-square")
    ?.closest("button");
  if (stopBtn && stopBtn.offsetParent !== null) {
    stopBtn.click();
    return { success: true, method: "fallback_square" };
  }

  // New Conversation View Stop Button
  const newViewStop = Array.from(document.querySelectorAll("button")).find(
    (b) => {
      const svg = b.querySelector("svg");
      const hasStopIcon =
        svg &&
        (svg.classList.contains("lucide-square") ||
          svg.innerHTML.includes("rect") ||
          svg.innerHTML.includes("square"));
      if (!hasStopIcon) return false;

      return b.classList.contains("rounded-full") && b.offsetParent !== null;
    },
  );

  if (newViewStop) {
    newViewStop.click();
    return { success: true, method: "new_view_stop" };
  }

  return { error: "No active generation found to stop" };
};
