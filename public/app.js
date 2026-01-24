/**
 * Antigravity Web - Entry Point (Refactored)
 */

import { state, CONSTANTS } from "./modules/state.js";
import { UI } from "./modules/ui.js";
import { connectWebSocket } from "./modules/websocket.js";
import { openModal, closeModal, escapeHtml } from "./modules/modal.js";
import { showArtifactViewer } from "./modules/artifactViewer.js";
import { renderSnapshot, scrollToBottom } from "./modules/renderer.js";
import { MODELS } from "./config/constants.js";
import * as api from "./modules/api.js";

// ============================================================
// Main Functions
// ============================================================

async function loadSnapshot() {
  const now = Date.now();
  if (now - state.lastLoadTime < CONSTANTS.LOAD_DEBOUNCE_MS) return;
  state.lastLoadTime = now;

  try {
    const icon = UI.refreshBtn?.querySelector("svg");
    if (icon) {
      icon.classList.remove("spin-anim");
      void icon.offsetWidth;
      icon.classList.add("spin-anim");
    }

    const data = await api.loadSnapshot();
    if (!data) return;

    const scrollPos = UI.chatContainer.scrollTop;
    const isNearBottom =
      UI.chatContainer.scrollHeight -
        UI.chatContainer.scrollTop -
        UI.chatContainer.clientHeight <
      120;

    renderSnapshot(data);

    if (isNearBottom) {
      scrollToBottom();
    } else {
      UI.chatContainer.scrollTop = scrollPos;
    }
  } catch (err) {
    console.error("loadSnapshot error:", err);
  }
}

async function syncAppState() {
  try {
    const data = await api.fetchAppState();
    if (data.mode && data.mode !== "Unknown") {
      UI.modeText.textContent = data.mode;
      UI.modeBtn.classList.toggle("active", data.mode === "Planning");
      state.currentMode = data.mode;
    }
    if (data.model && data.model !== "Unknown") {
      UI.modelText.textContent = data.model;
    }
  } catch (e) {
    console.error("Sync state error:", e);
  }
}

async function handleSendMessage() {
  const message = UI.messageInput.value.trim();
  if (!message) return;

  UI.messageInput.value = "";
  UI.messageInput.style.height = "auto";
  UI.messageInput.blur();
  UI.sendBtn.disabled = true;
  UI.sendBtn.style.opacity = "0.5";
  state.isNewConversation = false;

  try {
    await api.sendMessage(message);
    setTimeout(loadSnapshot, 300);
    setTimeout(loadSnapshot, 800);
  } catch (e) {
    console.error("Send error:", e);
  } finally {
    UI.sendBtn.disabled = false;
    UI.sendBtn.style.opacity = "1";
  }
}

// ============================================================
// Event Handlers
// ============================================================

function initEventHandlers() {
  UI.sendBtn?.addEventListener("click", handleSendMessage);

  UI.messageInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  UI.messageInput?.addEventListener("input", function () {
    this.style.height = "auto";
    this.style.height = `${this.scrollHeight}px`;
  });

  UI.addBtn?.addEventListener("click", async () => {
    UI.addBtn.style.opacity = "0.5";
    UI.chatContent.innerHTML = "";
    state.isNewConversation = true;
    if (UI.conversationTitleText)
      UI.conversationTitleText.textContent = "New Conversation";
    if (UI.conversationHeader) UI.conversationHeader.style.display = "flex";

    try {
      const data = await api.newConversation();
      if (data.success) setTimeout(loadSnapshot, 500);
    } catch (e) {
      state.isNewConversation = false;
    } finally {
      UI.addBtn.style.opacity = "1";
    }
  });

  UI.historyBtn?.addEventListener("click", async () => {
    UI.historyBtn.style.opacity = "0.5";
    try {
      const data = await api.getConversations();
      if (data.error || !data.conversations?.length) {
        alert(data.error || "No conversations found");
        return;
      }

      const options = data.conversations.map((c) => ({
        value: c,
        html: `<div style="display:flex;flex-direction:column;gap:4px">
                    <span style="font-weight:500;font-size:14px;color:var(--text-main)">${escapeHtml(c.title)}</span>
                    <span style="font-size:12px;color:var(--text-muted)">${escapeHtml(c.workspace || "")} &bull; ${escapeHtml(c.time || "")}</span>
                </div>`,
      }));

      openModal("Switch Conversation", options, async (conv) => {
        state.isNewConversation = false;
        if (UI.conversationTitleText)
          UI.conversationTitleText.textContent = conv.title;
        await api.selectConversation(conv.title, conv.index);
        setTimeout(loadSnapshot, 1000);
      });
    } catch (e) {
      alert("Failed to fetch conversations");
    } finally {
      UI.historyBtn.style.opacity = "1";
    }
  });

  UI.refreshBtn?.addEventListener("click", () => {
    loadSnapshot();
    syncAppState();
  });

  UI.stopBtn?.addEventListener("click", async () => {
    UI.stopBtn.style.opacity = "0.5";
    try {
      await api.stopGeneration();
    } catch (e) {}
    setTimeout(() => (UI.stopBtn.style.opacity = "1"), 500);
  });

  UI.modeBtn?.addEventListener("click", () => {
    openModal("Select Mode", ["Fast", "Planning"], async (mode) => {
      UI.modeText.textContent = "Setting...";
      const data = await api.setMode(mode);
      if (data.success) {
        state.currentMode = mode;
        UI.modeText.textContent = mode;
        UI.modeBtn.classList.toggle("active", mode === "Planning");
      } else {
        alert(`Error: ${data.error || "Unknown"}`);
        UI.modeText.textContent = state.currentMode;
      }
    });
  });

  UI.modelBtn?.addEventListener("click", () => {
    openModal("Select Model", MODELS, async (model) => {
      const prev = UI.modelText.textContent;
      UI.modelText.textContent = "Setting...";
      const data = await api.setModel(model);
      UI.modelText.textContent = data.success ? model : prev;
    });
  });

  UI.agqBtn?.addEventListener("click", async () => {
    UI.agqBtn.style.opacity = "0.5";
    try {
      const data = await api.triggerAgq();
      if (data.success && data.models?.length) {
        const options = data.models.map((m) => ({
          value: m,
          html: `<div style="display:flex;flex-direction:column;gap:4px">
                        <div style="display:flex;justify-content:space-between"><span style="font-weight:500">${escapeHtml(m.name)}</span><span style="font-size:12px;color:var(--text-muted)">${m.usagePercent}%</span></div>
                        <div style="background:var(--bg-input);border-radius:4px;height:6px"><div style="width:${m.usagePercent}%;height:100%;background:var(--accent);border-radius:4px"></div></div>
                        <span style="font-size:11px;color:var(--text-muted)">⏱️ ${escapeHtml(String(m.resetTime || ""))}</span>
                    </div>`,
        }));
        openModal("Model Quotas", options, () => {});
      } else {
        alert(`Could not load quotas: ${data.error || "Unknown"}`);
      }
    } finally {
      UI.agqBtn.style.opacity = "1";
    }
  });

  UI.workspaceBtn?.addEventListener("click", async () => {
    const data = await api.getWorkspaces();
    if (!data.success) return;

    const options = data.workspaces.map((w) => ({
      value: w.id,
      html: `<div style="display:flex;align-items:center;width:100%">
                <div style="display:flex;flex-direction:column;gap:2px">
                    <span style="font-weight:500">${escapeHtml(w.title)}</span>
                    <span style="font-size:11px;color:var(--text-muted)">Port: ${w.port}</span>
                </div>
                ${w.id === data.currentWorkspaceId ? '<svg viewBox="0 0 24 24" style="width:16px;height:16px;margin-left:auto;color:var(--success)"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>' : ""}
            </div>`,
    }));

    openModal("Select Workspace", options, async (id) => {
      if (id !== data.currentWorkspaceId) {
        UI.chatContent.innerHTML =
          '<div class="loading-state"><div class="loading-spinner"></div><p>Switching...</p></div>';
        await api.switchWorkspace(id);
        setTimeout(() => window.location.reload(), 1000);
      }
    });
  });

  UI.modalOverlay?.addEventListener("click", (e) => {
    if (e.target === UI.modalOverlay) closeModal();
  });

  document
    .getElementById("modalCancelBtn")
    ?.addEventListener("click", closeModal);

  UI.scrollToBottomBtn?.addEventListener("click", () => {
    state.userIsScrolling = false;
    scrollToBottom();
  });

  // Scroll handling
  let scrollSyncTimeout = null;
  let lastScrollSync = 0;

  UI.chatContainer?.addEventListener("scroll", () => {
    state.userIsScrolling = true;
    clearTimeout(state.idleTimer);

    const isNearBottom =
      UI.chatContainer.scrollHeight -
        UI.chatContainer.scrollTop -
        UI.chatContainer.clientHeight <
      120;
    UI.scrollToBottomBtn?.classList.toggle("show", !isNearBottom);

    const now = Date.now();
    if (now - lastScrollSync > CONSTANTS.SCROLL_SYNC_DEBOUNCE) {
      lastScrollSync = now;
      clearTimeout(scrollSyncTimeout);
      scrollSyncTimeout = setTimeout(() => {
        const pct =
          UI.chatContainer.scrollTop /
          (UI.chatContainer.scrollHeight - UI.chatContainer.clientHeight);
        api.remoteScroll(pct);
        loadSnapshot();
      }, 100);
    }

    state.idleTimer = setTimeout(() => {
      state.userIsScrolling = false;
      state.autoRefreshEnabled = true;
    }, 5000);
  });

  // Chat click delegation
  UI.chatContainer?.addEventListener("click", async (e) => {
    const target = e.target.closest('button, [role="button"]');
    if (!target) return;

    const text = target.textContent.trim();
    let action = null;

    if (text.includes("Expand all")) action = "expand-all";
    else if (text.includes("Collapse all")) action = "collapse-all";
    else if (text.startsWith("Accept")) action = "accept";
    else if (text.startsWith("Reject")) action = "reject";

    if (action) {
      e.preventDefault();
      e.stopPropagation();
      target.style.opacity = "0.5";

      const allBtns = Array.from(
        UI.chatContainer.querySelectorAll('button, [role="button"]'),
      ).filter((el) => {
        const t = el.textContent.trim();
        if (action === "accept") return t.startsWith("Accept");
        if (action === "reject") return t.startsWith("Reject");
        return t.includes(text);
      });
      const idx = allBtns.indexOf(target);

      await api.triggerAction(action, idx !== -1 ? idx : 0);
      [100, 400, 800, 1500].forEach((ms) => setTimeout(loadSnapshot, ms));
      return;
    }

    // Open artifact button
    if (
      target.tagName === "BUTTON" &&
      target.textContent.trim() === "Open" &&
      target.classList.contains("bg-ide-button-secondary-background")
    ) {
      e.preventDefault();
      target.style.opacity = "0.5";

      let title = "Unknown";
      let isFile = false;
      const container = target.closest(".rounded-md");
      if (container) {
        const titleSpan = container.querySelector(".break-all");
        if (titleSpan) title = titleSpan.textContent.trim();
        isFile = !!container.querySelector(".file-icon");
      }

      const data = await api.getArtifact("Open", title, isFile);
      if (data.success && data.html) {
        showArtifactViewer(data.html, data.className);
      } else if (data.error) {
        alert(`Could not open: ${data.error}`);
      }
      target.style.opacity = "1";
    }
  });

  // Viewport handling
  if (window.visualViewport) {
    const handleResize = () => {
      document.body.style.height = `${window.visualViewport.height}px`;
      if (document.activeElement === UI.messageInput)
        setTimeout(scrollToBottom, 100);
    };
    window.visualViewport.addEventListener("resize", handleResize);
    window.visualViewport.addEventListener("scroll", handleResize);
    handleResize();
  } else {
    window.addEventListener(
      "resize",
      () => (document.body.style.height = `${window.innerHeight}px`),
    );
    document.body.style.height = `${window.innerHeight}px`;
  }
}

// ============================================================
// SSL Banner
// ============================================================

function checkSslStatus() {
  if (window.location.protocol === "https:") return;
  if (localStorage.getItem("sslBannerDismissed")) return;
  if (UI.sslBanner) UI.sslBanner.style.display = "flex";
}

// ============================================================
// Initialize
// ============================================================

checkSslStatus();
initEventHandlers();
connectWebSocket(loadSnapshot);
syncAppState();
setInterval(syncAppState, 5000);
