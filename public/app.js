// --- Constants ---
const SCROLL_SYNC_DEBOUNCE = 50;
const DEFAULT_THINKING_TEXT = 'Thinking..';
const APP_TITLE_DEFAULT = 'Antigravity Web';

// --- UI Elements ---
const UI = {
    chatContainer: document.getElementById('chatContainer'),
    chatContent: document.getElementById('chatContent'),
    addBtn: document.getElementById('addBtn'),
    historyBtn: document.getElementById('historyBtn'),
    messageInput: document.getElementById('messageInput'),
    sendBtn: document.getElementById('sendBtn'),
    scrollToBottomBtn: document.getElementById('scrollToBottom'),
    statusDot: document.getElementById('statusDot'),
    statusText: document.getElementById('statusText'),
    titleText: document.getElementById('titleText'),
    conversationHeader: document.getElementById('conversationHeader'),
    conversationTitleText: document.getElementById('conversationTitleText'),
    refreshBtn: document.getElementById('moreBtn'),
    stopBtn: document.getElementById('stopBtn'),
    thinkingIndicator: document.getElementById('thinkingIndicator'),
    modeBtn: document.getElementById('modeBtn'),
    modelBtn: document.getElementById('modelBtn'),
    modalOverlay: document.getElementById('modalOverlay'),
    modalList: document.getElementById('modalList'),
    modalTitle: document.getElementById('modalTitle'),
    modeText: document.getElementById('modeText'),
    modelText: document.getElementById('modelText'),
    agqBtn: document.getElementById('agqBtn'),
    workspaceBtn: document.getElementById('workspaceBtn'),
    workspaceIndicator: document.getElementById('workspaceIndicator')
};

// --- State ---
let autoRefreshEnabled = true;
let userIsScrolling = false;
let lastScrollPosition = 0;
let ws = null;
let idleTimer = null;
let lastHash = '';
let currentMode = 'Fast';
let lastLoadTime = 0;
const LOAD_DEBOUNCE_MS = 300; // Phase 3: Performance
let isNewConversation = false; // Flag to persist title

// --- Sync State (Desktop is Always Priority) ---
async function fetchAppState() {
    try {
        const res = await fetch('/app-state');
        const data = await res.json();

        // Mode Sync (Fast/Planning) - Desktop is source of truth
        if (data.mode && data.mode !== 'Unknown') {
            UI.modeText.textContent = data.mode;
            UI.modeBtn.classList.toggle('active', data.mode === 'Planning');
            currentMode = data.mode;
        }

        // Model Sync - Desktop is source of truth
        if (data.model && data.model !== 'Unknown') {
            UI.modelText.textContent = data.model;
        }

        console.log('[SYNC] State refreshed from Desktop:', data);
    } catch (e) {
        console.error('[SYNC] Failed to sync state', e);
    }
}

// --- SSL Banner ---
const sslBanner = document.getElementById('sslBanner');

async function checkSslStatus() {
    // Only show banner if currently on HTTP
    if (window.location.protocol === 'https:') return;

    // Check if user dismissed the banner before
    if (localStorage.getItem('sslBannerDismissed')) return;

    sslBanner.style.display = 'flex';
}

async function enableHttps() {
    const btn = document.getElementById('enableHttpsBtn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const res = await fetch('/generate-ssl', { method: 'POST' });
        const data = await res.json();

        if (data.success) {
            sslBanner.innerHTML = `
                <span>✅ ${data.message}</span>
                <button onclick="location.reload()">Reload After Restart</button>
            `;
            sslBanner.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
        } else {
            btn.textContent = 'Failed - Retry';
            btn.disabled = false;
        }
    } catch (e) {
        btn.textContent = 'Error - Retry';
        btn.disabled = false;
    }
}

function dismissSslBanner() {
    sslBanner.style.display = 'none';
    localStorage.setItem('sslBannerDismissed', 'true');
}

// Check SSL on load
checkSslStatus();
// Initialize Workspaces
loadWorkspaces();

// --- Models ---
const MODELS = [
    "Gemini 3 Pro (High)",
    "Gemini 3 Pro (Low)",
    "Gemini 3 Flash",
    "Claude Sonnet 4.5",
    "Claude Sonnet 4.5 (Thinking)",
    "Claude Opus 4.5 (Thinking)",
    "GPT-OSS 120B (Medium)"
];

// --- WebSocket ---
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${window.location.host}`);

    ws.onopen = () => {
        console.log('WS Connected');
        updateStatus(true);
        loadSnapshot();
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'snapshot_update' && autoRefreshEnabled && !userIsScrolling) {
            loadSnapshot();
        }
    };

    ws.onclose = () => {
        console.log('WS Disconnected');
        updateStatus(false);
        setTimeout(connectWebSocket, 2000);
    };
}

function updateStatus(connected) {
    if (!UI.statusDot) return;
    if (connected) {
        UI.statusDot.classList.remove('disconnected');
        UI.statusDot.classList.add('connected');
        UI.statusText.textContent = 'Live';
    } else {
        UI.statusDot.classList.remove('connected');
        UI.statusDot.classList.add('disconnected');
        UI.statusText.textContent = 'Reconnecting';
    }
}

// --- Rendering Helpers ---

// Scope all IDE CSS rules to only apply inside #chatContent
function scopeCssToContainer(css, containerSelector) {
    if (!css) return '';
    // This regex looks for CSS selectors and prepends the container selector
    // It's a bit simplified but effective for most common IDE CSS
    return css.replace(/([^{}]+)\{/g, (match, selector) => {
        // Skip @-rules like @keyframes, @media, @font-face
        if (selector.trim().startsWith('@')) return match;

        // Scope each selector in a comma-separated list
        const scopedSelectors = selector.split(',')
            .map(s => {
                const trimmed = s.trim();
                if (!trimmed) return '';

                // Handle global selectors that should apply to the container itself
                const isGlobal = /^(html|body|:root)$/i.test(trimmed);
                if (isGlobal) return containerSelector;

                // Handle selectors starting with global elements (e.g., "body .class")
                const startsWithGlobal = /^(html|body|:root)\s+/i.test(trimmed);
                if (startsWithGlobal) {
                    return trimmed.replace(/^(html|body|:root)\s+/i, `${containerSelector} `);
                }

                // Don't double scope if already scoped
                if (trimmed.startsWith(containerSelector)) return trimmed;
                return `${containerSelector} ${trimmed}`;
            })
            .filter(s => s !== '')
            .join(', ');

        return scopedSelectors ? `${scopedSelectors} {` : match;
    });
}

// Extract and pre-load @font-face declarations from IDE CSS
function extractAndLoadFonts(css) {
    if (!css) return;
    const fontFaceRegex = /@font-face\s*\{[^}]+\}/g;
    const fontFaces = css.match(fontFaceRegex) || [];

    if (fontFaces.length > 0) {
        let existingFontStyle = document.getElementById('ide-fonts');
        if (!existingFontStyle) {
            existingFontStyle = document.createElement('style');
            existingFontStyle.id = 'ide-fonts';
            document.head.appendChild(existingFontStyle);
        }

        // Only update if changed
        const newFontContent = fontFaces.join('\n');
        if (existingFontStyle.textContent !== newFontContent) {
            existingFontStyle.textContent = newFontContent;
        }
    }
}

// Map of UI button IDs to potential IDE icon names (Lucide class name suffixes)
// e.g., "lucide-history" -> we store "history"
const ICON_MAPPING = {
    'addBtn': ['plus', 'plus-circle'],
    'historyBtn': ['history'],
    'moreBtn': ['more-horizontal', 'ellipsis'],
    'closeBtn': ['x'],
    'sendBtn': ['arrow-right', 'send'],
    'stopBtn': ['square'],
    'scrollToBottom': ['arrow-down', 'chevron-down'],
    'plusBtn': ['plus', 'plus-circle'],
    'modeBtn': ['zap', 'bolt', 'brain'] // Planning/Fast mode icons
};

function applyIcons(icons) {
    if (!icons) return;

    for (const [btnId, candidateNames] of Object.entries(ICON_MAPPING)) {
        const btn = document.getElementById(btnId);
        if (!btn) continue;

        // Find the first matching icon from the candidates
        let foundIconHtml = null;
        for (const name of candidateNames) {
            if (icons[name]) {
                foundIconHtml = icons[name];
                break;
            }
        }

        // If we found an icon, replace the button's SVG content
        if (foundIconHtml) {
            // Check if we already applied this icon to avoid unnecessary DOM thrashing
            if (btn.dataset.appliedIcon !== foundIconHtml) {
                // If it's a wrapper button, find the svg inside, otherwise set innerHTML
                // Mobile buttons usually just have the SVG inside.
                // We want to preserve classes on the button, but replace the SVG.
                // The extracted icon is the full <svg> string.

                // Remove existing SVG
                const existingSvg = btn.querySelector('svg');
                if (existingSvg) existingSvg.remove();

                // Create a temp container to parse the new SVG
                const temp = document.createElement('div');
                temp.innerHTML = foundIconHtml;
                const newSvg = temp.querySelector('svg');

                if (newSvg) {
                    // Copy classes from the old SVG if needed, or better, keep the new one's styling
                    // but ensure it fits. The mobile app CSS targets .header-btn svg.
                    // Let's just append it.
                    btn.appendChild(newSvg);
                    btn.dataset.appliedIcon = foundIconHtml;
                }
            }
        }
    }
}

// --- Rendering ---
async function loadSnapshot() {
    // Phase 3: Performance Debounce
    const now = Date.now();
    if (now - lastLoadTime < LOAD_DEBOUNCE_MS) return;
    lastLoadTime = now;

    try {
        // Add spin animation to refresh button
        const icon = UI.refreshBtn.querySelector('svg');
        icon.classList.remove('spin-anim');
        void icon.offsetWidth; // trigger reflow
        icon.classList.add('spin-anim');

        const response = await fetch('/snapshot');
        if (!response.ok) {
            if (response.status === 503) return;
            throw new Error('Failed to load');
        }

        const data = await response.json();

        // --- UPDATE TITLE FROM SNAPSHOT ---
        if (isNewConversation) {
            // Keep the "New Conversation" title until user sends a message
            if (UI.conversationTitleText) UI.conversationTitleText.textContent = "New Conversation";
            if (UI.conversationHeader) UI.conversationHeader.style.display = 'flex';
        } else if (data.conversationTitle) {
            if (UI.conversationTitleText) UI.conversationTitleText.textContent = data.conversationTitle;
            if (UI.conversationHeader) UI.conversationHeader.style.display = 'flex';
        } else {
            if (UI.conversationHeader) UI.conversationHeader.style.display = 'none';
        }

        if (data.html) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = data.html;
            const h1 = tempDiv.querySelector('h1');
            if (h1 && h1.textContent.trim()) {
                UI.titleText.textContent = h1.textContent.trim();
            } else {
                UI.titleText.textContent = APP_TITLE_DEFAULT;
            }

            // Check for "Thought" blocks to toggle thinking indicator
            const thoughtBlock = tempDiv.querySelector('details summary, [class*="thought"]');
            if (thoughtBlock) {
                const txt = thoughtBlock.textContent.trim();
                UI.thinkingIndicator.textContent = txt.includes('Thought') ? txt.split('\n')[0] : DEFAULT_THINKING_TEXT;
                UI.thinkingIndicator.style.display = 'flex';
            } else {
                UI.thinkingIndicator.style.display = 'none';
            }

            // Sync Button States (Stop button only - Send is not synced since mobile input is independent)
            if (data.buttonStates) {
                // Stop Button
                if (data.buttonStates.stopVisible) {
                    UI.stopBtn.style.display = 'block';
                    UI.stopBtn.disabled = data.buttonStates.stopDisabled || false;
                    UI.stopBtn.style.opacity = UI.stopBtn.disabled ? '0.5' : '1';
                } else {
                    UI.stopBtn.style.display = 'none';
                }
            } else {
                // Fallback (legacy support)
                const isGenerating = data.html.includes('input-send-button-cancel-tooltip') || data.html.includes('lucide-square');
                UI.stopBtn.style.display = isGenerating ? 'block' : 'none';
            }

            // Cleanup: Remove temporary element
            tempDiv.remove();
        }

        const scrollPos = UI.chatContainer.scrollTop;
        const isNearBottom = UI.chatContainer.scrollHeight - UI.chatContainer.scrollTop - UI.chatContainer.clientHeight < 120;

        // --- IDE CSS INJECTION (Honoring IDE Theme) ---
        // Extract fonts first so they are global
        extractAndLoadFonts(data.css);

        // Scope the IDE's native CSS to our content container
        const scopedCss = scopeCssToContainer(data.css, '#chatContent');
        const artifactScopedCss = scopeCssToContainer(data.css, '#artifactContent');

        // Apply extracted IDE icons
        if (data.icons) {
            applyIcons(data.icons);
        }

        // Convert themeVars to a CSS block for :root
        if (data.themeVars) {
            let globalStyleEl = document.getElementById('ide-theme-vars');
            if (!globalStyleEl) {
                globalStyleEl = document.createElement('style');
                globalStyleEl.id = 'ide-theme-vars';
                document.head.appendChild(globalStyleEl);
            }
            let rootVars = ':root {\n';
            for (const [prop, val] of Object.entries(data.themeVars)) {
                rootVars += `    ${prop}: ${val};\n`;
            }
            rootVars += '}\n';
            globalStyleEl.textContent = rootVars;
        }

        // Inject File Icon CSS and Fonts
        if (data.fileIconCss) {
            let iconStyle = document.getElementById('ide-file-icons');
            if (!iconStyle) {
                iconStyle = document.createElement('style');
                iconStyle.id = 'ide-file-icons';
                document.head.appendChild(iconStyle);
            }

            // 1. Rewrite vscode-file:// URLs to our server proxy
            // Matches url("vscode-file://...") or url(vscode-file://...)
            // and rewrites to url("/proxy-asset?url=...")
            const safeIconCss = data.fileIconCss.replace(
                /url\(["']?(vscode-file:\/\/[^"')]+)["']?\)/g,
                (match, url) => `url("/proxy-asset?url=${encodeURIComponent(url)}")`
            );

            // Scope to container AND boost specificity to override the generic scoped CSS (for Chat)
            // Using #chatContent#chatContent gives (2,0,0) specificity vs (1,0,0) of the body styles.
            const scopedFileIconsChat = scopeCssToContainer(safeIconCss, '#chatContent')
                .replace(/#chatContent/g, '#chatContent#chatContent');

            // Also scope to Artifact Viewer
            const scopedFileIconsArtifact = scopeCssToContainer(safeIconCss, '#artifactContent')
                .replace(/#artifactContent/g, '#artifactContent#artifactContent');

            const finalIconCss = scopedFileIconsChat + '\n' + scopedFileIconsArtifact;

            if (iconStyle.textContent !== finalIconCss) {
                iconStyle.textContent = finalIconCss;
            }
        }

        const mobileLayoutFixes = `
            <style>
                ${scopedCss}
                ${artifactScopedCss}

                /* --- Minimal structural fixes for mobile --- */
                #cascade {
                    position: relative !important;
                    height: auto !important;
                    width: 100% !important;
                    background: transparent !important;
                }

                #cascade * {
                    position: static !important;
                }

                /* Enhanced mobile layout fixes */
                #chatContent {
                    font-size: 15px !important;
                    line-height: 1.5 !important;
                    color: ${data.color || 'var(--text-main)'};
                }

                /* Force text color on common block elements to ensure readability */
                #chatContent p, 
                #chatContent li,
                #chatContent h1, #chatContent h2, #chatContent h3, #chatContent h4, #chatContent h5, #chatContent h6 {
                     color: inherit !important;
                }

                /* Ensure code blocks are scrollable, not overflowing */
                #chatContent pre, #chatContent code {
                    max-width: 100% !important;
                    overflow-x: auto !important;
                    white-space: pre-wrap !important;
                    word-break: break-word !important;
                    font-family: 'JetBrains Mono', 'Menlo', monospace !important;
                }

                /* Improve image handling */
                #chatContent img {
                    max-width: 100% !important;
                    height: auto !important;
                }

                /* Ensure links are tappable but don't break layout */
                #chatContent a {
                    word-break: break-all;
                }

                ::-webkit-scrollbar {
                    width: 0 !important;
                }
            </style>
        `;

        UI.chatContent.innerHTML = mobileLayoutFixes + data.html;

        // User Request: Remove Review/Proceed buttons
        try {
            const buttons = UI.chatContent.querySelectorAll('button');
            buttons.forEach(btn => {
                const text = btn.textContent.trim();
                if (text === 'Review' || text === 'Proceed' || text === 'Review Changes') {
                    btn.style.display = 'none';
                }
            });
        } catch (e) {
            console.log('Error hiding buttons:', e);
        }

        if (isNearBottom) {
            scrollToBottom();
        } else {
            UI.chatContainer.scrollTop = scrollPos;
        }

    } catch (err) {
        console.error(err);
    }
}

function scrollToBottom() {
    UI.chatContainer.scrollTo({
        top: UI.chatContainer.scrollHeight,
        behavior: 'smooth'
    });
}

// --- Click Handlers (Delegated) ---
UI.chatContainer.addEventListener('click', async (e) => {
    // Check for "Expand all" or "Collapse all" buttons
    const target = e.target.closest('[role="button"]');
    if (target) {
        const text = target.textContent.trim();
        let action = null;

        if (text.includes('Expand all')) {
            action = 'expand-all';
        } else if (text.includes('Collapse all')) {
            action = 'collapse-all';
        }

        if (action) {
            e.preventDefault();
            e.stopPropagation(); // Stop immediate propagation to prevent double firing if nested

            // Visual feedback
            target.style.opacity = '0.5';

            // Calculate index among all similar buttons to target the correct one
            // We need to find all buttons with the exact same text to determine our index
            const allButtons = Array.from(UI.chatContainer.querySelectorAll('[role="button"]'))
                .filter(el => el.textContent.trim().includes(text)); // loose match to handle icon text issues if any

            const index = allButtons.indexOf(target);

            try {
                // Send action and index to server to trigger IDE click
                await fetch('/trigger-action', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action, index: index !== -1 ? index : 0 })
                });

                // Force a snapshot reload sequence to catch the update
                setTimeout(loadSnapshot, 100);
                setTimeout(loadSnapshot, 400);
                setTimeout(loadSnapshot, 800);
                setTimeout(loadSnapshot, 1500);
            } catch (err) {
                console.error('Failed to trigger action:', err);
                target.style.opacity = ''; // Restore on error
            }
            return;
        }
    }
});

if (UI.workspaceBtn) {
    UI.workspaceBtn.addEventListener('click', showWorkspaceSelector);
}


// --- Inputs ---
async function sendMessage() {
    const message = UI.messageInput.value.trim();
    if (!message) return;

    // Optimistic UI updates
    const previousValue = UI.messageInput.value;
    UI.messageInput.value = ''; // Clear immediately
    UI.messageInput.style.height = 'auto'; // Reset height
    UI.messageInput.blur(); // Close keyboard on mobile immediately

    UI.sendBtn.disabled = true;
    UI.sendBtn.style.opacity = '0.5';

    // Clear new conversation flag on send
    isNewConversation = false;

    try {
        const res = await fetch('/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message })
        });

        // Always reload snapshot
        setTimeout(loadSnapshot, 300);
        setTimeout(loadSnapshot, 800);

        if (!res.ok) {
            console.warn('Send response not ok:', await res.json().catch(() => ({})));
        }
    } catch (e) {
        console.error('Send error:', e);
        setTimeout(loadSnapshot, 500);
    } finally {
        UI.sendBtn.disabled = false;
        UI.sendBtn.style.opacity = '1';
    }
}

// --- Scroll Sync to Desktop ---
let scrollSyncTimeout = null;
let lastScrollSync = 0;
let snapshotReloadPending = false;

async function syncScrollToDesktop() {
    const scrollPercent = UI.chatContainer.scrollTop / (UI.chatContainer.scrollHeight - UI.chatContainer.clientHeight);
    try {
        await fetch('/remote-scroll', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scrollPercent })
        });

        if (!snapshotReloadPending) {
            snapshotReloadPending = true;
            setTimeout(() => {
                loadSnapshot();
                snapshotReloadPending = false;
            }, 300);
        }
    } catch (e) {
        console.log('Scroll sync failed:', e.message);
    }
}

// --- Workspace Selector ---
async function loadWorkspaces() {
    try {
        const res = await fetch('/api/workspaces');
        const data = await res.json();

        if (data.success) {
            // Update Indicator
            const current = data.workspaces.find(w => w.id === data.currentWorkspaceId);
            if (current && UI.workspaceIndicator) {
                UI.workspaceIndicator.textContent = `• ${current.title}`;
                UI.workspaceIndicator.style.display = 'inline';
            }
            return data;
        }
    } catch (e) { console.error('Failed to load workspaces', e); }
    return null;
}

async function showWorkspaceSelector() {
    const data = await loadWorkspaces();
    if (!data || !data.workspaces) return;

    const options = data.workspaces.map(w => {
        const isCurrent = w.id === data.currentWorkspaceId;
        const checkMark = isCurrent ? '<svg viewBox="0 0 24 24" style="width:16px;height:16px;margin-left:auto;color:var(--success)"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>' : '';

        return {
            value: w.id,
            html: `<div style="display:flex; align-items:center; width:100%">
                    <div style="display:flex; flex-direction:column; gap:2px;">
                        <span style="font-weight:500">${escapeHtml(w.title)}</span>
                        <span style="font-size:11px; color:var(--text-muted)">Port: ${w.port}</span>
                    </div>
                    ${checkMark}
                   </div>`
        };
    });

    openModal('Select Workspace', options, (id) => {
        if (id !== data.currentWorkspaceId) {
            switchWorkspace(id);
        }
    });
}

async function switchWorkspace(id) {
    try {
        // Show loading state
        if (UI.chatContent) {
            UI.chatContent.innerHTML = `
                <div class="loading-state">
                    <div class="loading-spinner"></div>
                    <p>Switching workspace...</p>
                </div>
            `;
        }

        await fetch('/api/workspace/switch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id })
        });

        // Wait a bit for connection to stabilize then reload
        setTimeout(() => {
            window.location.reload();
        }, 1000);

    } catch (e) {
        alert('Failed to switch workspace');
        window.location.reload();
    }
}

// --- Settings Logic ---
function openModal(title, options, onSelect) {
    UI.modalTitle.textContent = title;
    UI.modalList.innerHTML = '';
    options.forEach(opt => {
        const div = document.createElement('div');
        div.className = 'modal-option';

        if (typeof opt === 'object' && opt !== null && opt.html) {
            div.innerHTML = opt.html;
            div.onclick = () => {
                onSelect(opt.value);
                closeModal();
            };
        } else {
            div.textContent = opt;
            div.onclick = () => {
                onSelect(opt);
                closeModal();
            };
        }
        UI.modalList.appendChild(div);
    });
    UI.modalOverlay.classList.add('show');
}

function closeModal() {
    UI.modalOverlay.classList.remove('show');
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Open Conversation History Modal
async function openConversationModal() {
    UI.historyBtn.style.opacity = '0.5';

    try {
        const res = await fetch('/conversations');
        const data = await res.json();

        if (data.error) {
            alert('Could not load conversations: ' + data.error);
            return;
        }

        const conversations = data.conversations || [];
        if (conversations.length === 0) {
            alert('No conversations found');
            return;
        }

        // Open modal with conversation list
        const options = conversations.map(c => ({
            value: c,
            html: `
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <span style="font-weight:500; font-size:14px; color:var(--text-main); line-height:1.4;">${escapeHtml(c.title)}</span>
                    <span style="font-size:12px; color:var(--text-muted);">${escapeHtml(c.workspace || 'No Workspace')} &bull; ${escapeHtml(c.time || '')}</span>
                </div>
            `
        }));

        openModal('Switch Conversation', options, async (conv) => {
            try {
                await fetch('/select-conversation', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: conv.title, index: conv.index })
                });

                // Clear new conversation flag
                isNewConversation = false;

                // Optimistic UI update
                if (UI.conversationTitleText) {
                    UI.conversationTitleText.textContent = conv.title;
                    if (UI.conversationHeader) UI.conversationHeader.style.display = 'flex';
                }

                // Force a snapshot refresh
                setTimeout(loadSnapshot, 1000);

            } catch (e) {
                alert('Failed to switch conversation');
            }
        });

    } catch (e) {
        alert('Failed to fetch conversations');
    } finally {
        UI.historyBtn.style.opacity = '1';
    }
}

// --- Quick Actions ---
function quickAction(text) {
    UI.messageInput.value = text;
    UI.messageInput.style.height = 'auto';
    UI.messageInput.style.height = UI.messageInput.scrollHeight + 'px';
    UI.messageInput.focus();
}

// --- Artifact Viewer ---
function showArtifactViewer(html, className) {
    // Remove existing viewer if present
    const existing = document.getElementById('artifactViewer');
    if (existing) existing.remove();

    // Create viewer overlay
    const viewer = document.createElement('div');
    viewer.id = 'artifactViewer';
    viewer.className = 'artifact-viewer-overlay';

    // Create the content container structure
    viewer.innerHTML = `
        <div class="artifact-viewer-content" id="artifactContent"></div>
    `;

    // Process the artifact HTML to inject controls
    const innerContainer = document.createElement('div'); // The "original" container
    innerContainer.className = className;
    innerContainer.style.height = '100%'; // Ensure full height
    innerContainer.innerHTML = html;

    // FIND COMPONENT HEADER
    // Strategy: Look for the first row that looks like a header (flex container)
    // usually the first child or grand-child
    let header = innerContainer.querySelector('[class*="flex"][class*="items-center"]');

    // Fallback: just use first child if it's a div
    if (!header && innerContainer.firstElementChild?.tagName === 'DIV') {
        header = innerContainer.firstElementChild;
    }

    if (header) {
        // 1. Create Left Group for Nav + Title
        const leftGroup = document.createElement('div');
        leftGroup.style.display = 'flex';
        leftGroup.style.alignItems = 'center';
        leftGroup.style.gap = '0'; // No gap

        const nav = document.createElement('div');
        nav.className = 'artifact-viewer-nav-injected';
        nav.style.marginRight = '0';
        nav.innerHTML = `
            <button class="artifact-viewer-btn" id="backArtifactViewer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 18l-6-6 6-6"/>
                </svg>
            </button>
            <button class="artifact-viewer-btn" disabled>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentcolor" stroke-width="2">
                    <path d="M9 18l6-6-6-6"/>
                </svg>
            </button>
        `;

        leftGroup.appendChild(nav);

        // Move existing first child (Title?) into leftGroup
        if (header.firstChild) {
            leftGroup.appendChild(header.firstChild);
        }

        // Insert leftGroup at start
        header.prepend(leftGroup);

        // 2. Inject Close (X) at the end
        const closeDiv = document.createElement('div');
        closeDiv.innerHTML = `
            <button class="artifact-viewer-btn" id="closeArtifactViewer">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;

        header.appendChild(closeDiv);
    } else {
        // Fallback if no header found: add a floating close button
        const fab = document.createElement('button');
        fab.className = 'artifact-viewer-fab-close';
        fab.id = 'closeArtifactViewer';
        fab.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>`;
        viewer.appendChild(fab);

        // And a floating back button
        const backFab = document.createElement('button');
        backFab.className = 'artifact-viewer-fab-back';
        backFab.id = 'backArtifactViewer';
        backFab.innerHTML = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>`;
        viewer.appendChild(backFab);
    }

    document.body.appendChild(viewer);

    // Append the processed content
    const contentArea = viewer.querySelector('#artifactContent');
    contentArea.appendChild(innerContainer);

    // User Request: Remove Review/Proceed buttons from Artifact Viewer too
    try {
        const buttons = innerContainer.querySelectorAll('button');
        buttons.forEach(btn => {
            const text = btn.textContent.trim();
            if (text === 'Review' || text === 'Proceed' || text === 'Review Changes') {
                btn.style.display = 'none';
            }
        });
    } catch (e) {
        console.log('Error hiding artifact buttons:', e);
    }

    // Event Handlers
    const backBtn = document.getElementById('backArtifactViewer');
    if (backBtn) backBtn.addEventListener('click', () => viewer.remove());

    const closeBtn = document.getElementById('closeArtifactViewer');
    if (closeBtn) closeBtn.addEventListener('click', () => viewer.remove());

    // Close on backdrop click
    viewer.addEventListener('click', (e) => {
        if (e.target === viewer) viewer.remove();
    });
}

// --- Event Listeners ---
function initEventHandlers() {
    UI.sendBtn.addEventListener('click', sendMessage);

    UI.addBtn?.addEventListener('click', async () => {
        UI.addBtn.style.opacity = '0.5';

        // Clear chat content immediately for a fresh start
        UI.chatContent.innerHTML = '';

        try {
            // Set flag and optimistic title update
            isNewConversation = true;
            if (UI.conversationTitleText) UI.conversationTitleText.textContent = "New Conversation";
            if (UI.conversationHeader) UI.conversationHeader.style.display = 'flex';

            const res = await fetch('/new-conversation', { method: 'POST' });
            const data = await res.json();
            if (data.success) {
                // Force a reload of the snapshot to reflect new state
                setTimeout(loadSnapshot, 500);
            } else {
                console.warn('Failed to create conversation', data.error);
                // Revert if failed
                isNewConversation = false;
            }
        } catch (e) {
            console.error('Network error creating conversation', e);
            // Revert if failed
            isNewConversation = false;
        } finally {
            UI.addBtn.style.opacity = '1';
        }
    });

    UI.historyBtn?.addEventListener('click', openConversationModal);

    // AGQ Button - Model Quotas
    UI.agqBtn?.addEventListener('click', async () => {
        UI.agqBtn.style.opacity = '0.5';
        try {
            const res = await fetch('/trigger-agq', { method: 'POST' });
            const data = await res.json();

            if (data.success && data.models && data.models.length > 0) {
                const options = data.models.map(model => ({
                    value: model,
                    html: `
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span style="font-weight:500; font-size:14px; color:var(--text-main);">${escapeHtml(model.name || '')}</span>
                                <span style="font-size:12px; color:var(--text-muted);">${model.usagePercent}%</span>
                            </div>
                            <div style="display:flex; align-items:center; gap:8px;">
                                <div style="flex:1; background:var(--bg-input); border-radius:4px; height:6px; overflow:hidden;">
                                    <div style="width:${model.usagePercent}%; height:100%; background:var(--accent); border-radius:4px;"></div>
                                </div>
                            </div>
                            <span style="font-size:11px; color:var(--text-muted);">⏱️ ${escapeHtml(String(model.resetTime || ''))}</span>
                        </div>
                    `
                }));

                openModal('Model Quotas', options, (selected) => {
                    console.log('Selected model:', selected.name);
                });
            } else {
                const debugInfo = data.debug ? JSON.stringify(data.debug, null, 2) : '';
                console.log('AGQ debug info:', data);
                alert('Could not load model quotas: ' + (data.error || 'Unknown error') + (debugInfo ? '\n\nDebug: ' + debugInfo : ''));
            }
        } catch (e) {
            console.error('Failed to fetch model quotas:', e);
            alert('Failed to fetch model quotas');
        } finally {
            UI.agqBtn.style.opacity = '1';
        }
    });

    UI.refreshBtn?.addEventListener('click', () => {
        loadSnapshot();
        fetchAppState();
    });

    UI.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    UI.messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    UI.chatContainer.addEventListener('scroll', () => {
        userIsScrolling = true;
        clearTimeout(idleTimer);

        const isNearBottom = UI.chatContainer.scrollHeight - UI.chatContainer.scrollTop - UI.chatContainer.clientHeight < 120;
        if (isNearBottom) {
            UI.scrollToBottomBtn.classList.remove('show');
        } else {
            UI.scrollToBottomBtn.classList.add('show');
        }

        // Debounced scroll sync to desktop
        const now = Date.now();
        if (now - lastScrollSync > SCROLL_SYNC_DEBOUNCE) {
            lastScrollSync = now;
            clearTimeout(scrollSyncTimeout);
            scrollSyncTimeout = setTimeout(syncScrollToDesktop, 100);
        }

        idleTimer = setTimeout(() => {
            userIsScrolling = false;
            autoRefreshEnabled = true;
        }, 5000);
    });

    UI.scrollToBottomBtn.addEventListener('click', () => {
        userIsScrolling = false;
        scrollToBottom();
    });

    UI.stopBtn.addEventListener('click', async () => {
        UI.stopBtn.style.opacity = '0.5';
        try {
            await fetch('/stop', { method: 'POST' });
        } catch (e) { }
        setTimeout(() => UI.stopBtn.style.opacity = '1', 500);
    });

    UI.modalOverlay.onclick = (e) => {
        if (e.target === UI.modalOverlay) closeModal();
    };

    UI.modeBtn.addEventListener('click', () => {
        openModal('Select Mode', ['Fast', 'Planning'], async (mode) => {
            UI.modeText.textContent = 'Setting...';
            try {
                const res = await fetch('/set-mode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode })
                });
                const data = await res.json();
                if (data.success) {
                    currentMode = mode;
                    UI.modeText.textContent = mode;
                    UI.modeBtn.classList.toggle('active', mode === 'Planning');
                } else {
                    alert('Error: ' + (data.error || 'Unknown'));
                    UI.modeText.textContent = currentMode;
                }
            } catch (e) {
                UI.modeText.textContent = currentMode;
            }
        });
    });

    UI.modelBtn.addEventListener('click', () => {
        openModal('Select Model', MODELS, async (model) => {
            const prev = UI.modelText.textContent;
            UI.modelText.textContent = 'Setting...';
            try {
                const res = await fetch('/set-model', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model })
                });
                const data = await res.json();
                if (data.success) {
                    UI.modelText.textContent = model;
                } else {
                    alert('Error: ' + (data.error || 'Unknown'));
                    UI.modelText.textContent = prev;
                }
            } catch (e) {
                UI.modelText.textContent = prev;
            }
        });
    });

    // Remote click logic
    UI.chatContainer.addEventListener('click', async (e) => {
        const target = e.target.closest('div, span, p, summary, button, details');
        if (!target) return;

        const text = target.innerText || '';
        const isThoughtToggle = /Thought|Thinking/i.test(text) && text.length < 500;

        // Handle "Open" button clicks for artifacts
        const isOpenButton = target.tagName === 'BUTTON' &&
            target.textContent.trim() === 'Open' &&
            target.classList.contains('bg-ide-button-secondary-background');

        if (isOpenButton) {
            e.preventDefault();
            e.stopPropagation();
            target.style.opacity = '0.5';

            // Extract artifact title from the container
            // Structure: the title is in a <span class="inline-flex break-all"> near the button
            let artifactTitle = 'Unknown';
            let isFile = false;
            const container = target.closest('.rounded-md');
            if (container) {
                const titleSpan = container.querySelector('.break-all');
                if (titleSpan) {
                    artifactTitle = titleSpan.textContent.trim();
                }
                if (container.querySelector('.file-icon')) {
                    isFile = true;
                }
            }

            try {
                const res = await fetch('/get-artifact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        buttonText: 'Open',
                        artifactTitle: artifactTitle,
                        isFile: isFile
                    })
                });
                const data = await res.json();

                if (data.success && data.html) {
                    showArtifactViewer(data.html, data.className);
                } else {
                    console.error('Artifact fetch failed:', data.error);
                    // Provide visual feedback if failed
                    if (data.error) alert('Could not open artifact: ' + data.error);
                }
            } catch (err) {
                console.error('Failed to fetch artifact:', err);
            } finally {
                target.style.opacity = '1';
            }
            return;
        }

        if (isThoughtToggle) {
            target.style.opacity = '0.5';
            setTimeout(() => target.style.opacity = '1', 300);
            const firstLine = text.split('\n')[0].trim();

            try {
                await fetch('/remote-click', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        selector: target.tagName.toLowerCase(),
                        index: 0,
                        textContent: firstLine
                    })
                });
                setTimeout(loadSnapshot, 400);
                setTimeout(loadSnapshot, 800);
                setTimeout(loadSnapshot, 1500);
            } catch (e) {
                console.error('Remote click failed:', e);
            }
        }
    });

    // Viewport / Keyboard Handling
    if (window.visualViewport) {
        const handleResize = () => {
            document.body.style.height = window.visualViewport.height + 'px';
            if (document.activeElement === UI.messageInput) {
                setTimeout(scrollToBottom, 100);
            }
        };
        window.visualViewport.addEventListener('resize', handleResize);
        window.visualViewport.addEventListener('scroll', handleResize);
        handleResize();
    } else {
        window.addEventListener('resize', () => {
            document.body.style.height = window.innerHeight + 'px';
        });
        document.body.style.height = window.innerHeight + 'px';
    }
}

// --- Init ---
initEventHandlers();
connectWebSocket();
fetchAppState();
setInterval(fetchAppState, 5000);
