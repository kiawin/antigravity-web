/**
 * Set AI Model
 * This script runs in the browser context via CDP
 */

export const setModelScript = async function (params) {
  const { modelName } = params;

  try {
    // Find the model selector button
    const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model"];

    const allEls = Array.from(document.querySelectorAll("*"));
    const candidates = allEls.filter((el) => {
      if (el.children.length > 0) return false;
      const txt = el.textContent;
      return KNOWN_KEYWORDS.some((k) => txt.includes(k));
    });

    // Find clickable parent
    let modelBtn = null;
    for (const el of candidates) {
      let current = el;

      // High-confidence check for Headless UI
      const headlessBtn = current.closest(
        'button[id*="headlessui-popover-button"]',
      );
      if (headlessBtn) {
        modelBtn = headlessBtn;
        break;
      }

      for (let i = 0; i < 5; i++) {
        if (!current) break;

        if (
          current.tagName === "P" &&
          current.parentElement?.tagName === "BUTTON"
        ) {
          modelBtn = current.parentElement;
          break;
        }

        if (
          current.tagName === "BUTTON" ||
          window.getComputedStyle(current).cursor === "pointer"
        ) {
          if (
            current.querySelector("svg.lucide-chevron-down") ||
            current.querySelector("svg.lucide-chevron-up") ||
            current.innerText.includes("Model")
          ) {
            modelBtn = current;
            break;
          }
        }
        current = current.parentElement;
      }
      if (modelBtn) break;
    }

    if (!modelBtn) return { error: "Model selector button not found" };

    // Click to open
    modelBtn.click();
    await new Promise((r) => setTimeout(r, 600));

    // Find the dialog/dropdown
    const visibleDialog = Array.from(
      document.querySelectorAll('[role="dialog"], div'),
    ).find((d) => {
      const style = window.getComputedStyle(d);
      return (
        d.offsetHeight > 0 &&
        (style.position === "absolute" || style.position === "fixed") &&
        d.innerText.includes(modelName) &&
        !d.innerText.includes("Files With Changes")
      );
    });

    if (!visibleDialog) return { error: "Model list not opened" };

    // Select specific model
    const allDialogEls = Array.from(visibleDialog.querySelectorAll("*"));

    // Try exact match first
    let target = allDialogEls.find(
      (el) => el.children.length === 0 && el.textContent.trim() === modelName,
    );

    // Try partial match
    if (!target) {
      target = allDialogEls.find(
        (el) => el.children.length === 0 && el.textContent.includes(modelName),
      );
    }

    if (target) {
      target.click();
      await new Promise((r) => setTimeout(r, 200));
      return { success: true };
    }

    return { error: "Model not found in list" };
  } catch (err) {
    return { error: `JS Error: ${err.toString()}` };
  }
};
