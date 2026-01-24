/**
 * Select a Conversation from History
 * Contains scripts for opening list and selecting item
 */

// Script to click the conversations toggle button (same as getConversations)
export const clickConversationsToggleScript = async function () {
  const btn = document.querySelector('[data-past-conversations-toggle="true"]');
  if (btn) {
    btn.click();
    return true;
  }
  return false;
};

// Script to select a specific conversation
export const selectConversationItemScript = async function (params) {
  const { index, title } = params;

  const overlay = document.querySelector(".jetski-fast-pick");
  if (!overlay || overlay.offsetHeight === 0) return null;

  // Click "Show more" iteratively
  for (let i = 0; i < 5; i++) {
    const showButtons = Array.from(
      overlay.querySelectorAll(
        "div.text-quickinput-foreground.text-sm.cursor-pointer",
      ),
    ).filter(
      (el) =>
        el.textContent.includes("Show") && el.textContent.includes("more"),
    );

    if (showButtons.length === 0) break;

    for (const btn of showButtons) {
      btn.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  // Find target
  const items = overlay.querySelectorAll("div.px-2\\.5.cursor-pointer");
  let target = null;

  if (title) {
    items.forEach((item) => {
      const titleEl = item.querySelector("span.text-sm span");
      if (titleEl?.textContent?.trim() === title) {
        target = item;
      }
    });
  }

  if (!target && index !== undefined) {
    target = items[index];
  }

  if (target) {
    target.click();

    // Ensure the agent panel's parent is visible
    const agentPanel = document.getElementById("antigravity.agentPanel");
    if (agentPanel && agentPanel.parentElement) {
      agentPanel.parentElement.style.display = "block";
    }

    return { success: true };
  }
  return { error: "Item not found in list" };
};
