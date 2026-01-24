/**
 * Trigger AGQ - Get model quotas from AGQ extension
 * This script runs in the browser context via CDP
 */

export const triggerAgqScript = async function () {
  try {
    // Find the AGQ element in the status bar
    let agqElement = document.getElementById("henrikdev.ag-quota");

    if (!agqElement) {
      agqElement = document.querySelector('[aria-label*="AGQ"]');
    }

    if (!agqElement) {
      agqElement = document.querySelector('[id*="ag-quota"]');
    }

    if (!agqElement) {
      const statusItems = Array.from(
        document.querySelectorAll(".statusbar-item"),
      ).map((el) => ({
        id: el.id,
        ariaLabel: el.getAttribute("aria-label")?.substring(0, 50),
      }));
      return {
        error: "AGQ element not found in status bar",
        debug: {
          statusItemCount: statusItems.length,
          items: statusItems.slice(0, 10),
        },
      };
    }

    // Click the AGQ element
    const clickable =
      agqElement.querySelector("a.statusbar-item-label") || agqElement;
    clickable.click();

    await new Promise((r) => setTimeout(r, 500));

    // Find the quick input widget
    const quickInput = document.querySelector(".quick-input-widget");
    if (!quickInput) {
      return { error: "Quick input widget not found after clicking AGQ" };
    }

    // Extract model quota data
    const listRows = quickInput.querySelectorAll(".monaco-list-row");
    if (!listRows || listRows.length === 0) {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      return { error: "No model data found in quick input" };
    }

    const models = [];
    listRows.forEach((row) => {
      const ariaLabel = row.getAttribute("aria-label") || "";
      const parts = ariaLabel.split(",").map((p) => p.trim());

      if (parts.length >= 3) {
        let namePart = parts[0].trim();
        const iconPrefixes = [
          "circle-outline",
          "circle",
          "warning",
          "check",
          "error",
          "info",
          "pass",
          "fail",
          "codicon",
        ];
        let changed = true;
        while (changed) {
          changed = false;
          for (const prefix of iconPrefixes) {
            if (namePart.toLowerCase().startsWith(prefix)) {
              namePart = namePart.substring(prefix.length).trim();
              changed = true;
              break;
            }
          }
        }

        const usagePart = parts[1] || "";
        let usagePercent = 0;
        const percentIdx = usagePart.indexOf("%");
        if (percentIdx > 0) {
          let numStr = "";
          for (let i = percentIdx - 1; i >= 0; i--) {
            const ch = usagePart[i];
            if ((ch >= "0" && ch <= "9") || ch === ".") {
              numStr = ch + numStr;
            } else if (numStr) break;
          }
          if (numStr) usagePercent = parseFloat(numStr);
        }

        const resetPart = parts[2] || "";
        const resetIdx = resetPart.indexOf("Resets in:");
        const resetTime =
          resetIdx >= 0 ? resetPart.substring(resetIdx + 10).trim() : resetPart;

        models.push({
          name: namePart,
          usagePercent,
          resetTime,
        });
      }
    });

    // Close the widget
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await new Promise((r) => setTimeout(r, 100));

    return {
      success: true,
      models,
    };
  } catch (err) {
    try {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    } catch {}
    return { error: `JS Error: ${err.toString()}` };
  }
};
