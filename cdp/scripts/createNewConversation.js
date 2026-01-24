/**
 * Create New Conversation
 * This script runs in the browser context via CDP
 */

export const createNewConversationScript = async function () {
  try {
    // Find the button with the specific tooltip ID
    const btn = document.querySelector(
      'a[data-tooltip-id="new-conversation-tooltip"]',
    );

    if (btn) {
      btn.click();

      // Ensure the agent panel's parent is visible
      const agentPanel = document.getElementById("antigravity.agentPanel");
      if (agentPanel && agentPanel.parentElement) {
        agentPanel.parentElement.style.display = "block";
      }

      return { success: true };
    }

    // Fallback: Look for plus icon button
    const candidates = Array.from(document.querySelectorAll("a, button"));
    const plusBtn = candidates.find((el) => {
      const svg = el.querySelector("svg");
      const hasPlusIcon =
        svg &&
        (svg.classList.contains("lucide-plus") ||
          svg.innerHTML.includes("M12 5"));

      return hasPlusIcon && el.offsetParent !== null;
    });

    if (plusBtn) {
      plusBtn.click();

      const agentPanel = document.getElementById("antigravity.agentPanel");
      if (agentPanel && agentPanel.parentElement) {
        agentPanel.parentElement.style.display = "block";
      }

      return { success: true, method: "fallback_plus" };
    }

    return { error: "New conversation button not found" };
  } catch (e) {
    return { error: e.toString() };
  }
};
