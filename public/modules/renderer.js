/**
 * Renderer - Snapshot loading and CSS injection
 */

import { state, CONSTANTS } from "./state.js";
import { UI } from "./ui.js";
import { ICON_MAPPING } from "../config/constants.js";

/**
 * Scope CSS rules to a container selector
 */
export function scopeCssToContainer(css, containerSelector) {
  if (!css) return "";
  return css.replace(/([^{}]+)\{/g, (match, selector) => {
    if (selector.trim().startsWith("@")) return match;

    const scopedSelectors = selector
      .split(",")
      .map((s) => {
        const trimmed = s.trim();
        if (!trimmed) return "";
        if (/^(html|body|:root)$/i.test(trimmed)) return containerSelector;
        if (/^(html|body|:root)\s+/i.test(trimmed)) {
          return trimmed.replace(
            /^(html|body|:root)\s+/i,
            `${containerSelector} `,
          );
        }
        if (trimmed.startsWith(containerSelector)) return trimmed;
        return `${containerSelector} ${trimmed}`;
      })
      .filter((s) => s !== "")
      .join(", ");

    return scopedSelectors ? `${scopedSelectors} {` : match;
  });
}

/**
 * Extract and load fonts from CSS
 */
export function extractAndLoadFonts(css) {
  if (!css) return;
  const fontFaceRegex = /@font-face\s*\{[^}]+\}/g;
  const fontFaces = css.match(fontFaceRegex) || [];

  if (fontFaces.length > 0) {
    let existingFontStyle = document.getElementById("ide-fonts");
    if (!existingFontStyle) {
      existingFontStyle = document.createElement("style");
      existingFontStyle.id = "ide-fonts";
      document.head.appendChild(existingFontStyle);
    }

    const newFontContent = fontFaces.join("\n");
    if (existingFontStyle.textContent !== newFontContent) {
      existingFontStyle.textContent = newFontContent;
    }
  }
}

/**
 * Apply icons from snapshot to UI buttons
 */
export function applyIcons(icons) {
  if (!icons) return;

  for (const [btnId, candidateNames] of Object.entries(ICON_MAPPING)) {
    const btn = document.getElementById(btnId);
    if (!btn) continue;

    let foundIconHtml = null;
    for (const name of candidateNames) {
      if (icons[name]) {
        foundIconHtml = icons[name];
        break;
      }
    }

    if (foundIconHtml && btn.dataset.appliedIcon !== foundIconHtml) {
      const existingSvg = btn.querySelector("svg");
      if (existingSvg) existingSvg.remove();

      const temp = document.createElement("div");
      temp.innerHTML = foundIconHtml;
      const newSvg = temp.querySelector("svg");

      if (newSvg) {
        btn.appendChild(newSvg);
        btn.dataset.appliedIcon = foundIconHtml;
      }
    }
  }
}

/**
 * Render snapshot data to the UI
 */
export function renderSnapshot(data) {
  if (!data) return;

  // Update title
  if (state.isNewConversation) {
    if (UI.conversationTitleText)
      UI.conversationTitleText.textContent = "New Conversation";
    if (UI.conversationHeader) UI.conversationHeader.style.display = "flex";
  } else if (data.conversationTitle) {
    if (UI.conversationTitleText)
      UI.conversationTitleText.textContent = data.conversationTitle;
    if (UI.conversationHeader) UI.conversationHeader.style.display = "flex";
  } else if (UI.conversationHeader)
    UI.conversationHeader.style.display = "none";

  if (data.html) {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = data.html;

    const h1 = tempDiv.querySelector("h1");
    UI.titleText.textContent =
      h1?.textContent?.trim() || CONSTANTS.APP_TITLE_DEFAULT;

    // Thinking indicator
    const thoughtBlock = tempDiv.querySelector(
      'details summary, [class*="thought"]',
    );
    if (thoughtBlock) {
      const txt = thoughtBlock.textContent.trim();
      UI.thinkingIndicator.textContent = txt.includes("Thought")
        ? txt.split("\n")[0]
        : CONSTANTS.DEFAULT_THINKING_TEXT;
      UI.thinkingIndicator.style.display = "flex";
    } else {
      UI.thinkingIndicator.style.display = "none";
    }

    // Stop button state
    if (data.buttonStates) {
      if (data.buttonStates.stopVisible) {
        UI.stopBtn.style.display = "block";
        UI.stopBtn.disabled = data.buttonStates.stopDisabled || false;
        UI.stopBtn.style.opacity = UI.stopBtn.disabled ? "0.5" : "1";
      } else {
        UI.stopBtn.style.display = "none";
      }
    }

    tempDiv.remove();
  }

  // Extract fonts
  extractAndLoadFonts(data.css);

  // Scope CSS
  const scopedCss = scopeCssToContainer(data.css, "#chatContent");
  const artifactScopedCss = scopeCssToContainer(data.css, "#artifactContent");

  // Apply icons
  if (data.icons) applyIcons(data.icons);

  // Theme vars
  if (data.themeVars) {
    let globalStyleEl = document.getElementById("ide-theme-vars");
    if (!globalStyleEl) {
      globalStyleEl = document.createElement("style");
      globalStyleEl.id = "ide-theme-vars";
      document.head.appendChild(globalStyleEl);
    }
    let rootVars = ":root {\n";
    for (const [prop, val] of Object.entries(data.themeVars)) {
      rootVars += `    ${prop}: ${val};\n`;
    }
    rootVars += "}\n";
    globalStyleEl.textContent = rootVars;
  }

  // File icon CSS
  if (data.fileIconCss) {
    let iconStyle = document.getElementById("ide-file-icons");
    if (!iconStyle) {
      iconStyle = document.createElement("style");
      iconStyle.id = "ide-file-icons";
      document.head.appendChild(iconStyle);
    }

    const safeIconCss = data.fileIconCss.replace(
      /url\(["']?(vscode-file:\/\/[^"')]+)["']?\)/g,
      (match, url) => `url("/proxy-asset?url=${encodeURIComponent(url)}")`,
    );

    const scopedFileIconsChat = scopeCssToContainer(
      safeIconCss,
      "#chatContent",
    ).replace(/#chatContent/g, "#chatContent#chatContent");
    const scopedFileIconsArtifact = scopeCssToContainer(
      safeIconCss,
      "#artifactContent",
    ).replace(/#artifactContent/g, "#artifactContent#artifactContent");

    const finalIconCss = `${scopedFileIconsChat}\n${scopedFileIconsArtifact}`;
    if (iconStyle.textContent !== finalIconCss) {
      iconStyle.textContent = finalIconCss;
    }
  }

  // Build final HTML
  const mobileLayoutFixes = `
        <style>
            ${scopedCss}
            ${artifactScopedCss}
            #cascade { position: relative !important; height: auto !important; width: 100% !important; background: transparent !important; }
            #cascade * { position: static !important; }
            #chatContent { font-size: 15px !important; line-height: 1.5 !important; color: ${data.color || "var(--text-main)"}; }
            #chatContent p, #chatContent li, #chatContent h1, #chatContent h2, #chatContent h3 { color: inherit !important; }
            #chatContent pre, #chatContent code { max-width: 100% !important; overflow-x: auto !important; white-space: pre-wrap !important; word-break: break-word !important; }
            #chatContent img { max-width: 100% !important; height: auto !important; }
            ::-webkit-scrollbar { width: 0 !important; }
            /* Terminal overflow fix - contain xterm inside its parent containers */
            #chatContent .component-shared-terminal { overflow: hidden !important; }
            #chatContent .terminal-wrapper { overflow: hidden !important; }
            #chatContent .xterm { overflow: hidden !important; }
            #chatContent .xterm-screen { position: relative !important; overflow: hidden !important; }
        </style>
    `;

  UI.chatContent.innerHTML = mobileLayoutFixes + data.html;

  // Hide Review/Proceed buttons
  UI.chatContent.querySelectorAll("button").forEach((btn) => {
    const text = btn.textContent.trim();
    if (text === "Review" || text === "Proceed" || text === "Review Changes") {
      btn.style.display = "none";
    }
  });
}

/**
 * Scroll to bottom of chat
 */
export function scrollToBottom() {
  UI.chatContainer.scrollTo({
    top: UI.chatContainer.scrollHeight,
    behavior: "smooth",
  });
}
