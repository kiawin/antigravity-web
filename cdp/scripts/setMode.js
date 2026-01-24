/**
 * Set functionality mode (Fast vs Planning)
 * This script runs in the browser context via CDP
 */

export const setModeScript = async function (params) {
  const { mode } = params;

  if (!["Fast", "Planning"].includes(mode)) {
    return { error: "Invalid mode" };
  }

  try {
    // Find elements with text 'Fast' or 'Planning'
    const allEls = Array.from(document.querySelectorAll("*"));
    const candidates = allEls.filter((el) => {
      if (el.children.length > 0) return false;
      const txt = el.textContent.trim();
      return txt === "Fast" || txt === "Planning";
    });

    // Find clickable parent
    let modeBtn = null;

    for (const el of candidates) {
      let current = el;
      for (let i = 0; i < 4; i++) {
        if (!current) break;
        const style = window.getComputedStyle(current);
        if (
          style.cursor === "pointer" ||
          current.tagName === "BUTTON" ||
          current.getAttribute("role") === "button"
        ) {
          modeBtn = current;
          break;
        }
        current = current.parentElement;
      }

      if (modeBtn && modeBtn.tagName === "SPAN") {
        const btn = modeBtn.closest("button");
        if (btn) modeBtn = btn;
      }

      if (modeBtn) break;
    }

    if (!modeBtn) return { error: "Mode indicator/button not found" };

    // Check if already set
    if (modeBtn.innerText.includes(mode))
      return { success: true, alreadySet: true };

    // Click to open menu
    modeBtn.click();
    await new Promise((r) => setTimeout(r, 600));

    // Find the dialog
    let visibleDialog = Array.from(
      document.querySelectorAll('[role="dialog"]'),
    ).find((d) => d.offsetHeight > 0 && d.innerText.includes(mode));

    if (!visibleDialog) {
      visibleDialog = Array.from(document.querySelectorAll("div")).find((d) => {
        const style = window.getComputedStyle(d);
        return (
          d.offsetHeight > 0 &&
          (style.position === "absolute" || style.position === "fixed") &&
          d.innerText.includes(mode) &&
          !d.innerText.includes("Files With Changes")
        );
      });
    }

    if (!visibleDialog)
      return { error: "Dropdown not opened or options not visible" };

    // Click the option
    const allDialogEls = Array.from(visibleDialog.querySelectorAll("*"));
    const target = allDialogEls.find(
      (el) => el.children.length === 0 && el.textContent.trim() === mode,
    );

    if (target) {
      target.click();
      await new Promise((r) => setTimeout(r, 200));
      return { success: true };
    }

    return { error: "Mode option text not found in dialog" };
  } catch (err) {
    return { error: `JS Error: ${err.toString()}` };
  }
};
