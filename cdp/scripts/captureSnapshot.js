/**
 * Capture chat snapshot from Antigravity IDE
 * This script runs in the browser context via CDP
 */

export const captureSnapshotScript = async function () {
  try {
    const cascade = document.getElementById("cascade");
    if (!cascade) return { error: "cascade not found" };

    const cascadeStyles = window.getComputedStyle(cascade);

    // Find the main scrollable container
    const scrollContainer =
      cascade.querySelector(".overflow-y-auto, [data-scroll-area]") || cascade;
    const scrollInfo = {
      scrollTop: scrollContainer.scrollTop,
      scrollHeight: scrollContainer.scrollHeight,
      clientHeight: scrollContainer.clientHeight,
      scrollPercent:
        scrollContainer.scrollTop /
          (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0,
    };

    // Clone cascade to modify it without affecting the original
    const clone = cascade.cloneNode(true);

    // Snapshot Canvases (Fix for Terminal/xterm.js visibility)
    try {
      const originalCanvases = Array.from(cascade.querySelectorAll("canvas"));
      const clonedCanvases = Array.from(clone.querySelectorAll("canvas"));

      if (originalCanvases.length === clonedCanvases.length) {
        for (let i = 0; i < originalCanvases.length; i++) {
          const original = originalCanvases[i];
          const cloned = clonedCanvases[i];

          if (original.width === 0 || original.height === 0) continue;

          try {
            let dataUrl;

            const isXterm = original.closest(".xterm");
            const isLinkLayer =
              original.classList.contains("xterm-link-layer") ||
              original.classList.contains("xterm-cursor-layer");

            if (isXterm && !isLinkLayer) {
              const tempCanvas = document.createElement("canvas");
              tempCanvas.width = original.width;
              tempCanvas.height = original.height;
              const ctx = tempCanvas.getContext("2d");

              let bg = "transparent";
              let cur = original.parentElement;
              while (cur && cur.id !== "cascade") {
                const style = window.getComputedStyle(cur);
                if (
                  style.backgroundColor &&
                  style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
                  style.backgroundColor !== "transparent"
                ) {
                  bg = style.backgroundColor;
                  break;
                }
                cur = cur.parentElement;
                if (!cur) break;
              }

              ctx.fillStyle = bg;
              ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
              ctx.drawImage(original, 0, 0);
              dataUrl = tempCanvas.toDataURL();
            } else {
              dataUrl = original.toDataURL();
            }

            const img = document.createElement("img");
            img.src = dataUrl;
            img.className = cloned.className;
            img.setAttribute("style", cloned.getAttribute("style"));

            const computed = window.getComputedStyle(original);
            img.style.width = computed.width;
            img.style.height = computed.height;

            // Fix z-index layering for xterm terminal
            // The main text layer should be above link/cursor layers
            // IMPORTANT: Use setProperty with 'important' to override any CSS
            if (isXterm) {
              // Ensure parent .xterm-screen has position:relative for absolute children
              const xtermScreen = cloned.closest(".xterm-screen");
              if (xtermScreen) {
                xtermScreen.style.setProperty(
                  "position",
                  "relative",
                  "important",
                );
              }

              img.style.setProperty("position", "absolute", "important");
              img.style.setProperty("top", "0", "important");
              img.style.setProperty("left", "0", "important");
              if (isLinkLayer) {
                // Link/cursor layers should be behind or at same level
                img.style.setProperty("z-index", "2", "important");
              } else {
                // Main text layer should be on top
                img.style.setProperty("z-index", "3", "important");
              }
            }

            cloned.parentNode.replaceChild(img, cloned);
          } catch (e) {
            // Ignore tainted canvases
          }
        }
      }

      // Clean up xterm helper elements that are not needed in the snapshot
      // These cause misalignment and visual noise
      clone
        .querySelectorAll(".xterm-helpers, .xterm-decoration-container")
        .forEach((el) => el.remove());
    } catch (e) {
      console.error("Canvas snapshot error:", e);
    }

    // Remove the input box
    const inputContainer = clone
      .querySelector('[contenteditable="true"]')
      ?.closest('div[id^="cascade"] > div');
    if (inputContainer) {
      inputContainer.remove();
    }

    const html = clone.outerHTML;

    // Collect all CSS
    let allCSS = "";
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          allCSS += `${rule.cssText}\n`;
        }
      } catch (e) {}
    }

    // Extract theme variables from body
    const themeVars = {};
    const bodyComputed = window.getComputedStyle(document.body);
    for (let i = 0; i < bodyComputed.length; i++) {
      const prop = bodyComputed[i];
      if (prop.startsWith("--")) {
        themeVars[prop] = bodyComputed.getPropertyValue(prop);
      }
    }

    // Extract SVG icons
    const icons = {};
    const svgElements = document.querySelectorAll("svg.lucide, svg[data-icon]");
    svgElements.forEach((svg) => {
      const classes = svg.className.baseVal || svg.className || "";
      const lucideMatch = classes.match(/lucide-([a-z-]+)/);
      if (lucideMatch) {
        const name = lucideMatch[1];
        if (!icons[name]) {
          icons[name] = svg.outerHTML;
        }
      }
      const dataIcon = svg.getAttribute("data-icon");
      if (dataIcon && !icons[dataIcon]) {
        icons[dataIcon] = svg.outerHTML;
      }
    });

    // Special handling for Stop icon
    const stopBtnDiv = document.querySelector(
      '[data-tooltip-id="input-send-button-cancel-tooltip"]',
    );
    if (stopBtnDiv) {
      icons.square =
        '<svg viewBox="0 0 24 24" fill="currentColor" class="lucide lucide-square"><rect x="8" y="8" width="8" height="8" rx="1" fill="#ef4444" /></svg>';
    }

    // Extract File Icon CSS
    let fileIconCss = "";
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (
            rule.type === 5 ||
            /file-icon|codicon|monaco-icon-label/.test(rule.selectorText)
          ) {
            fileIconCss += `${rule.cssText}\n`;
          }
        }
      } catch (e) {}
    }

    // Extract Conversation Title
    const titleEl = document.querySelector("p.text-ide-sidebar-title-color");
    let conversationTitle = titleEl ? titleEl.textContent.trim() : null;
    if (conversationTitle === "Agent") {
      conversationTitle = "New Conversation";
    }

    // Capture Button States
    const buttonStates = {
      sendDisabled: true,
      stopDisabled: true,
      stopVisible: false,
    };

    const sendBtn = document
      .querySelector("button svg.lucide-arrow-right")
      ?.closest("button");
    if (sendBtn) {
      buttonStates.sendDisabled = sendBtn.disabled;
    }

    const stopBtn =
      document.querySelector(
        '[data-tooltip-id="input-send-button-cancel-tooltip"]',
      ) ||
      document.querySelector("button svg.lucide-square")?.closest("button");

    if (stopBtn) {
      buttonStates.stopVisible = true;
      buttonStates.stopDisabled =
        stopBtn.tagName === "BUTTON" ? stopBtn.disabled : false;
    } else {
      buttonStates.stopVisible = false;
    }

    return {
      html,
      css: allCSS,
      themeVars,
      icons,
      buttonStates,
      conversationTitle,
      fileIconCss,
      backgroundColor: cascadeStyles.backgroundColor,
      color: cascadeStyles.color,
      fontFamily: cascadeStyles.fontFamily,
      scrollInfo,
      stats: {
        nodes: clone.getElementsByTagName("*").length,
        htmlSize: html.length,
        cssSize: allCSS.length,
      },
    };
  } catch (err) {
    return { error: err.toString() };
  }
};
