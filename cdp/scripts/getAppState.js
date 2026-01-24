/**
 * Get App State (Mode & Model)
 * This script runs in the browser context via CDP
 */

export const getAppStateScript = async function () {
  try {
    const state = { mode: "Unknown", model: "Unknown" };

    const allEls = Array.from(document.querySelectorAll("*"));

    // Get Mode (Fast/Planning)
    for (const el of allEls) {
      if (el.children.length > 0) continue;
      const text = (el.innerText || "").trim();
      if (text !== "Fast" && text !== "Planning") continue;

      let current = el;
      for (let i = 0; i < 5; i++) {
        if (!current) break;
        const style = window.getComputedStyle(current);
        if (style.cursor === "pointer" || current.tagName === "BUTTON") {
          state.mode = text;
          break;
        }
        current = current.parentElement;
      }
      if (state.mode !== "Unknown") break;
    }

    // Fallback for mode
    if (state.mode === "Unknown") {
      const textNodes = allEls.filter(
        (el) => el.children.length === 0 && el.innerText,
      );
      if (textNodes.some((el) => el.innerText.trim() === "Planning"))
        state.mode = "Planning";
      else if (textNodes.some((el) => el.innerText.trim() === "Fast"))
        state.mode = "Fast";
    }

    // Get Model
    const KNOWN_MODELS = ["Gemini", "Claude", "GPT"];
    const textNodes = allEls.filter(
      (el) => el.children.length === 0 && el.innerText,
    );

    const modelEl = textNodes.find((el) => {
      const txt = el.innerText;
      if (!KNOWN_MODELS.some((k) => txt.includes(k))) return false;

      let curr = el;
      for (let i = 0; i < 4; i++) {
        if (!curr) break;
        if (
          curr.tagName === "BUTTON" ||
          curr.getAttribute("role") === "button"
        ) {
          if (
            curr.querySelector("svg.lucide-chevron-down, svg.lucide-chevron-up")
          )
            return true;
        }
        curr = curr.parentElement;
      }
      return false;
    });

    if (modelEl) {
      state.model = modelEl.innerText.trim();
    }

    return state;
  } catch (e) {
    return { error: e.toString() };
  }
};
