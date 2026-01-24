/**
 * Trigger IDE Action (Expand All, Collapse All, Accept, Reject)
 * This script runs in the browser context via CDP
 */

export const triggerIdeActionScript = async function (params) {
  const { action, index = 0 } = params;

  try {
    let targetText = "";
    if (action === "expand-all") targetText = "Expand all";
    else if (action === "collapse-all") targetText = "Collapse all";
    else if (action === "accept") targetText = "Accept";
    else if (action === "reject") targetText = "Reject";
    else return { error: "Unknown action" };

    // Find all elements containing the text
    const allEls = Array.from(document.querySelectorAll("*"));
    const candidates = allEls.filter((el) =>
      el.textContent.includes(targetText),
    );

    // Filter for clickable elements
    const validTargets = candidates.filter((el) => {
      const isButton =
        el.tagName === "BUTTON" || el.getAttribute("role") === "button";
      const text = el.textContent.trim();

      if (isButton && text.startsWith(targetText)) {
        return true;
      }

      if (
        text.startsWith(targetText) &&
        el.tagName !== "SCRIPT" &&
        el.tagName !== "STYLE"
      ) {
        if (el.closest('button, [role="button"]')) return true;
      }
      return false;
    });

    // De-duplicate
    const uniqueButtons = [];
    validTargets.forEach((el) => {
      const btn =
        el.tagName === "BUTTON" || el.getAttribute("role") === "button"
          ? el
          : el.closest('button, [role="button"]');
      if (btn && !uniqueButtons.includes(btn)) {
        uniqueButtons.push(btn);
      }
    });

    const target = uniqueButtons[index];

    if (target) {
      // Simulate full click sequence
      const events = ["mousedown", "mouseup", "click"];
      events.forEach((eventType) => {
        const event = new MouseEvent(eventType, {
          view: window,
          bubbles: true,
          cancelable: true,
          buttons: 1,
        });
        target.dispatchEvent(event);
      });
      return { success: true };
    }

    return { error: "Action target not found" };
  } catch (e) {
    return { error: e.toString() };
  }
};
