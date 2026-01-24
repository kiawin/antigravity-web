/**
 * Get Conversation History
 * Contains scripts for opening list and extracting data
 */

// Script to click the conversations toggle button
export const clickConversationsToggleScript = async function () {
  const btn = document.querySelector('[data-past-conversations-toggle="true"]');
  if (btn) {
    btn.click();
    return true;
  }
  return false;
};

// Script to extract conversations from the overlay
export const extractConversationsScript = async function () {
  const overlay = document.querySelector(".jetski-fast-pick");
  if (!overlay || overlay.offsetHeight === 0) return null;

  // Click "Show more" buttons iteratively
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

  // Extract conversations
  const allElements = overlay.querySelectorAll(
    "div.text-quickinput-foreground.text-xs, div.px-2\\.5.cursor-pointer",
  );
  const conversations = [];

  let currentSectionWorkspace = "";
  let itemIndex = 0;

  allElements.forEach((el) => {
    // Check if Header
    if (
      el.classList.contains("text-quickinput-foreground") &&
      el.classList.contains("text-xs")
    ) {
      const text = el.textContent || "";

      if (text.includes("Current")) {
        currentSectionWorkspace = "Current";
        return;
      }

      const match = text.match(/(?:Running|Recent) in (.+)/i);
      if (match) {
        currentSectionWorkspace = match[1].trim();
      }
      return;
    }

    if (!el.classList.contains("cursor-pointer")) return;

    const titleSpan = el.querySelector("span.text-sm span");
    const timeSpan = el.querySelector("span.text-xs.opacity-50.ml-4");
    const wsSpan = el.querySelector("span.text-xs.opacity-50.truncate");

    const workspace = wsSpan?.textContent?.trim() || currentSectionWorkspace;

    conversations.push({
      index: itemIndex++,
      title: titleSpan?.textContent?.trim() || "Untitled",
      time: timeSpan?.textContent?.trim() || "",
      workspace,
    });
  });

  // Close (Escape)
  document.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );

  return {
    success: true,
    conversations,
    defaultWorkspace: currentSectionWorkspace,
  };
};
