#!/usr/bin/env node
import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import https from 'https';
import fs from 'fs';
import os from 'os';
import WebSocket from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { inspectUI } from './ui_inspector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORTS = [9000, 9001, 9002, 9003];
const POLL_INTERVAL = 1000; // 1 second

// Shared CDP connection
let cdpConnection = null;
let lastSnapshot = null;
let lastSnapshotHash = null;
let currentWorkspaceId = null;

// Get local IP address for mobile access
// Prefers real network IPs (192.168.x.x, 10.x.x.x) over virtual adapters (172.x.x.x from WSL/Docker)
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Skip internal and non-IPv4 addresses
            if (iface.family === 'IPv4' && !iface.internal) {
                candidates.push({
                    address: iface.address,
                    name: name,
                    // Prioritize common home/office network ranges
                    priority: iface.address.startsWith('192.168.') ? 1 :
                        iface.address.startsWith('10.') ? 2 :
                            iface.address.startsWith('172.') ? 3 : 4
                });
            }
        }
    }

    // Sort by priority and return the best one
    candidates.sort((a, b) => a.priority - b.priority);
    return candidates.length > 0 ? candidates[0].address : 'localhost';
}

// Helper: HTTP GET JSON
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

// Get all available workspaces across ports
async function getAllWorkspaces() {
    const workspaces = [];
    for (const port of PORTS) {
        try {
            const list = await getJson(`http://127.0.0.1:${port}/json/list`);
            // Filter for valid workbench targets (exclude Launchpad/jetski-agent)
            const targets = list.filter(t =>
                (t.url?.includes('workbench.html') || (t.title && t.title.includes('workbench'))) &&
                !t.url?.includes('workbench-jetski-agent.html') &&
                t.type === 'page'
            );

            targets.forEach(t => {
                // Clean up title
                let title = t.title || 'Untitled Workspace';
                // Remove common suffixes to keep it clean
                title = title.replace(' — Implementation Plan', '')
                    .replace(' — Task', '')
                    .replace(' — Walkthrough', '');

                if (title === 'Antigravity' || title.includes('workbench')) {
                    title = 'Main Window';
                }
                if (title === 'Agent') {
                    title = 'New Conversation';
                }

                workspaces.push({
                    id: t.id,
                    title: title,
                    originalTitle: t.title,
                    wsUrl: t.webSocketDebuggerUrl,
                    port: port
                });
            });
        } catch (e) { }
    }
    return workspaces;
}

// Find Antigravity CDP endpoint (or specific target)
async function discoverCDP(targetId = null) {
    const workspaces = await getAllWorkspaces();

    if (workspaces.length === 0) {
        throw new Error('CDP not found. Is Antigravity started with --remote-debugging-port=9000?');
    }

    if (targetId) {
        const target = workspaces.find(w => w.id === targetId);
        if (target) {
            currentWorkspaceId = target.id;
            return { port: target.port, url: target.wsUrl };
        }
        // If target not found, fall back to first one or error? 
        // Let's fall back to first but log warning
        console.warn(`Requested target ${targetId} not found, falling back to default.`);
    }

    // Default: Return first one
    currentWorkspaceId = workspaces[0].id;
    return { port: workspaces[0].port, url: workspaces[0].wsUrl };
}

// Connect to CDP
async function connectCDP(url) {
    const ws = new WebSocket(url);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });

    let idCounter = 1;
    const pendingCalls = new Map(); // Track pending calls by ID
    const contexts = [];
    const CDP_CALL_TIMEOUT = 30000; // 30 seconds timeout

    // Single centralized message handler (fixes MaxListenersExceeded warning)
    ws.on('message', (msg) => {
        try {
            const data = JSON.parse(msg);

            // Handle CDP method responses
            if (data.id !== undefined && pendingCalls.has(data.id)) {
                const { resolve, reject, timeoutId } = pendingCalls.get(data.id);
                clearTimeout(timeoutId);
                pendingCalls.delete(data.id);

                if (data.error) reject(data.error);
                else resolve(data.result);
            }

            // Handle execution context events
            if (data.method === 'Runtime.executionContextCreated') {
                contexts.push(data.params.context);
            }
        } catch (e) { }
    });

    const call = (method, params) => new Promise((resolve, reject) => {
        const id = idCounter++;

        // Setup timeout to prevent memory leaks from never-resolved calls
        const timeoutId = setTimeout(() => {
            if (pendingCalls.has(id)) {
                pendingCalls.delete(id);
                reject(new Error(`CDP call ${method} timed out after ${CDP_CALL_TIMEOUT}ms`));
            }
        }, CDP_CALL_TIMEOUT);

        pendingCalls.set(id, { resolve, reject, timeoutId });
        ws.send(JSON.stringify({ id, method, params }));
    });

    await call("Runtime.enable", {});
    await new Promise(r => setTimeout(r, 1000));

    return { ws, call, contexts };
}

// Capture chat snapshot
async function captureSnapshot(cdp) {
    const CAPTURE_SCRIPT = `(async () => {
        try {
            const cascade = document.getElementById('cascade');
            if (!cascade) return { error: 'cascade not found' };
            
            const cascadeStyles = window.getComputedStyle(cascade);
            
            // Find the main scrollable container
            const scrollContainer = cascade.querySelector('.overflow-y-auto, [data-scroll-area]') || cascade;
            const scrollInfo = {
                scrollTop: scrollContainer.scrollTop,
                scrollHeight: scrollContainer.scrollHeight,
                clientHeight: scrollContainer.clientHeight,
                scrollPercent: scrollContainer.scrollTop / (scrollContainer.scrollHeight - scrollContainer.clientHeight) || 0
            };
            
            // Clone cascade to modify it without affecting the original
            const clone = cascade.cloneNode(true);
            
            // Snapshot Canvases (Fix for Terminal/xterm.js visibility)
            // We must do this immediately after cloning while we can still reference the original canvases
            try {
                const originalCanvases = Array.from(cascade.querySelectorAll('canvas'));
                const clonedCanvases = Array.from(clone.querySelectorAll('canvas'));

                if (originalCanvases.length === clonedCanvases.length) {
                    for (let i = 0; i < originalCanvases.length; i++) {
                        const original = originalCanvases[i];
                        const cloned = clonedCanvases[i];
                        
                        // Skip if hidden or 0 size
                        if (original.width === 0 || original.height === 0) continue;

                        try {
                            let dataUrl;
                            
                            // Check if this is an xterm text layer (no class or specific class, and inside xterm)
                            const isXterm = original.closest('.xterm');
                            const isLinkLayer = original.classList.contains('xterm-link-layer') || original.classList.contains('xterm-cursor-layer');
                            
                            if (isXterm && !isLinkLayer) {
                                // Try to composite background
                                const tempCanvas = document.createElement('canvas');
                                tempCanvas.width = original.width;
                                tempCanvas.height = original.height;
                                const ctx = tempCanvas.getContext('2d');
                                
                                // Find background color
                                let bg = 'transparent';
                                let cur = original.parentElement;
                                while (cur && cur.id !== 'cascade') {
                                    const style = window.getComputedStyle(cur);
                                    if (style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
                                        bg = style.backgroundColor;
                                        break;
                                    }
                                    cur = cur.parentElement;
                                    if (!cur) break;
                                }
                                
                                // Fill background
                                ctx.fillStyle = bg;
                                ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
                                // Draw original
                                ctx.drawImage(original, 0, 0);
                                dataUrl = tempCanvas.toDataURL();
                            } else {
                                dataUrl = original.toDataURL();
                            }

                            const img = document.createElement('img');
                            img.src = dataUrl;
                            
                            // Copy essential attributes and styles
                            img.className = cloned.className;
                            img.setAttribute('style', cloned.getAttribute('style'));
                            
                            // Ensure dimensions match the visual display
                            const computed = window.getComputedStyle(original);
                            img.style.width = computed.width;
                            img.style.height = computed.height;
                            
                            cloned.parentNode.replaceChild(img, cloned);
                        } catch (e) {
                            // Ignore tainted canvases or errors
                        }
                    }
                }
            } catch (e) {
                console.error('Canvas snapshot error:', e);
            }
            
            // Remove the input box / chat window (last direct child div containing contenteditable)
            const inputContainer = clone.querySelector('[contenteditable="true"]')?.closest('div[id^="cascade"] > div');
            if (inputContainer) {
                inputContainer.remove();
            }
            
            const html = clone.outerHTML;
            
            let allCSS = '';
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        allCSS += rule.cssText + '\\n';
                    }
                } catch (e) { }
            }

            // Extract ALL computed theme variables from body to ensure we don't miss anything
            const themeVars = {};
            const bodyComputed = window.getComputedStyle(document.body);
            for (let i = 0; i < bodyComputed.length; i++) {
                const prop = bodyComputed[i];
                if (prop.startsWith('--')) {
                    themeVars[prop] = bodyComputed.getPropertyValue(prop);
                }
            }

            // Extract SVG icons by their Lucide class names
            const icons = {};
            const svgElements = document.querySelectorAll('svg.lucide, svg[data-icon]');
            svgElements.forEach(svg => {
                // Try to get name from lucide class (e.g., "lucide-history" -> "history")
                const classes = svg.className.baseVal || svg.className || '';
                const lucideMatch = classes.match(/lucide-([a-z-]+)/);
                if (lucideMatch) {
                    const name = lucideMatch[1]; // e.g., "history", "arrow-right"
                    if (!icons[name]) {
                        icons[name] = svg.outerHTML;
                    }
                }
                // Also try data-icon attribute
                const dataIcon = svg.getAttribute('data-icon');
                if (dataIcon && !icons[dataIcon]) {
                    icons[dataIcon] = svg.outerHTML;
                }
            });

            // Special handling for the "Stop" icon which might be a DIV (red square)
            const stopBtnDiv = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
            if (stopBtnDiv) {
                // Return a reconstructed SVG for the mobile app to use, mimicking the red square
                // The mobile app expects an SVG in icons.square
                icons['square'] = '<svg viewBox="0 0 24 24" fill="currentColor" class="lucide lucide-square"><rect x="8" y="8" width="8" height="8" rx="1" fill="#ef4444" /></svg>';
            }

            // Extract File Icon CSS and Fonts (without inlining to keep server responsive)
            let fileIconCss = '';
            for (const sheet of document.styleSheets) {
                try {
                    for (const rule of sheet.cssRules) {
                        // Use numeric 5 for FONT_FACE_RULE to be safe
                        if (rule.type === 5 || 
                           /file-icon|codicon|monaco-icon-label/.test(rule.selectorText)) {
                            fileIconCss += rule.cssText + '\\n';
                        }
                    }
                } catch (e) { }
            }
            
            // Extract Conversation Title
            const titleEl = document.querySelector('p.text-ide-sidebar-title-color');
            let conversationTitle = titleEl ? titleEl.textContent.trim() : null;
            if (conversationTitle === 'Agent') {
                conversationTitle = 'New Conversation';
            }

            // Capture Button States
            const buttonStates = {
                sendDisabled: true,
                stopDisabled: true,
                stopVisible: false
            };

            // Check Send Button
            const sendBtn = document.querySelector('button svg.lucide-arrow-right')?.closest('button');
            if (sendBtn) {
                buttonStates.sendDisabled = sendBtn.disabled;
            }

            // Check Stop Button
            const stopBtn = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]') || 
                           document.querySelector('button svg.lucide-square')?.closest('button');
            
            if (stopBtn) {
                buttonStates.stopVisible = true;
                // Divs might not have 'disabled' property, check class or attribute if needed, 
                // but usually if it exists it's active. For buttons, check disabled.
                buttonStates.stopDisabled = stopBtn.tagName === 'BUTTON' ? stopBtn.disabled : false;
            } else {
                buttonStates.stopVisible = false;
            }

            return {
                html: html,
                css: allCSS,
                themeVars: themeVars,
                icons: icons,
                buttonStates: buttonStates,
                conversationTitle: conversationTitle,
                fileIconCss: fileIconCss,
                backgroundColor: cascadeStyles.backgroundColor,
                color: cascadeStyles.color,
                fontFamily: cascadeStyles.fontFamily,
                scrollInfo: scrollInfo,
                stats: {
                    nodes: clone.getElementsByTagName('*').length,
                    htmlSize: html.length,
                    cssSize: allCSS.length
                }
            };
        } catch (err) {
            return { error: err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: CAPTURE_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.result && result.result.value) {
                return result.result.value;
            }
        } catch (e) { }
    }

    return null;
}

// Capture artifact content (e.g., implementation plan)
// Strategy: Click the "Open" button in the IDE, wait for artifact to load, then capture
async function captureArtifactContent(cdp, { buttonText, artifactTitle, isFile }) {
    // Step 1: Click the "Open" button for the SPECIFIC artifact
    const CLICK_SCRIPT = `(async () => {
        try {
            const targetTitle = '${artifactTitle || ''}';
            
            // Find all artifact containers (rounded-md with Open buttons)
            const containers = Array.from(document.querySelectorAll('.rounded-md'));
            
            for (const container of containers) {
                // Check if this container has the matching title
                const titleSpan = container.querySelector('.break-all');
                const title = titleSpan ? titleSpan.textContent.trim() : '';
                
                if (targetTitle && title !== targetTitle) {
                    continue; // Skip if title doesn't match
                }
                
                // Find the Open button in this container
                const openBtn = Array.from(container.querySelectorAll('button'))
                    .find(btn => btn.textContent.trim() === '${buttonText}');
                
                if (openBtn) {
                    openBtn.click();
                    return { clicked: true, title: title };
                }
            }
            
            return { error: 'No matching Open button found for: ' + targetTitle };
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    // Step 2: Capture artifact content (after click)
    // For files, we extract the URI to read from disk. For artifacts, we capture DOM.
    const CAPTURE_SCRIPT = `(async () => {
        try {
            const debug = { strategy: '' };
            const isFile = ${!!isFile};
            const targetTitle = "${artifactTitle || ''}";

            if (isFile) {
                const editors = Array.from(document.querySelectorAll('.editor-instance'));
                const targetEditor = editors.find(el => {
                     const label = el.getAttribute('aria-label') || '';
                     const uri = el.getAttribute('data-uri') || '';
                     return label === targetTitle || uri.endsWith('/' + targetTitle);
                });

                if (targetEditor) {
                     debug.strategy = 'file-editor-uri';
                     const uri = targetEditor.getAttribute('data-uri');
                     return {
                        success: true,
                        isFile: true,
                        uri: uri,
                        debug: debug
                     };
                }
            }
            
            // Look for artifact-view containers (should now be visible after click)
            const artifactContainers = Array.from(document.querySelectorAll('[class*="artifact-view"]'))
                .filter(el => el.offsetParent !== null);
            
            debug.artifactViewsFound = artifactContainers.length;
            
            if (artifactContainers.length > 0) {
                const artifactContainer = artifactContainers[0];
                debug.strategy = 'direct-artifact-view';
                
                const classMatch = artifactContainer.className.match(/editor-pane-parent-class-([\\w-]+)/);
                const artifactId = classMatch ? classMatch[1] : null;
                
                const clone = artifactContainer.cloneNode(true);
                
                return {
                    success: true,
                    artifactId: artifactId,
                    html: clone.innerHTML,
                    className: artifactContainer.className,
                    dimensions: {
                        width: artifactContainer.offsetWidth,
                        height: artifactContainer.offsetHeight
                    },
                    debug: debug
                };
            }
            
            return { error: 'No artifact view found after click', debug: debug };
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    // Execute click in each context until one succeeds
    let clickResult = null;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: CLICK_SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.clicked) {
                clickResult = res.result.value;
                break;
            }
        } catch (e) { }
    }

    if (!clickResult) {
        return { error: 'Could not click Open button in any context' };
    }

    // Wait for artifact/file to render
    await new Promise(resolve => setTimeout(resolve, 500));

    // Execute capture
    let captureResult = null;
    let captureErrors = [];

    // Retry logic for capture (wait for render)
    for (let attempt = 0; attempt < 3; attempt++) {
        for (const ctx of cdp.contexts) {
            try {
                const res = await cdp.call("Runtime.evaluate", {
                    expression: CAPTURE_SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });
                if (res.result?.value?.success) {
                    captureResult = res.result.value;
                    break;
                }
                if (res.result?.value?.error) {
                    captureErrors.push(res.result.value.error);
                }
            } catch (e) {
                captureErrors.push(e.message);
            }
        }
        if (captureResult) break;
        await new Promise(r => setTimeout(r, 500));
    }

    if (!captureResult) {
        // Debug info
        return {
            error: 'Capture failed. Errors: ' + captureErrors.join(', '),
            clickResult: clickResult
        };
    }

    // Step 3: Post-process result
    if (captureResult.isFile && captureResult.uri) {
        try {
            // Read file content from disk
            const fileUrl = captureResult.uri;
            let filePath;
            if (fileUrl.startsWith('file://')) {
                filePath = fileURLToPath(fileUrl);
            } else {
                filePath = fileUrl; // Fallback
            }

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf8');
                // Construct HTML with header for correct UI rendering
                // Escape HTML content
                const safeContent = content
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;")
                    .replace(/"/g, "&quot;")
                    .replace(/'/g, "&#039;");

                const fileName = filePath.split('/').pop();

                // Determine icon class based on extension (simple mapping)
                const ext = fileName.includes('.') ? fileName.split('.').pop().toLowerCase() : '';
                const iconClass = `file-icon ${ext}-ext-file-icon ext-file-icon`;

                const html = `
                    <div class="flex flex-col h-full bg-[#1e1e1e] text-[#d4d4d4]">
                        <div class="flex items-center justify-between px-4 py-2 border-b border-[#2b2b2b] bg-[#252526]">
                            <span class="font-medium text-sm flex items-center gap-2">
                                <span class="${iconClass}" aria-hidden="true" style="width:16px; height:16px; display:inline-block"></span>
                                ${fileName}
                            </span>
                            <!-- Close buttons will be injected here by app.js -->
                        </div>
                        <div class="flex-1 overflow-auto p-4">
                            <pre><code class="font-mono text-sm leading-relaxed">${safeContent}</code></pre>
                        </div>
                    </div>
                 `;

                return {
                    success: true,
                    html: html,
                    className: 'file-view-container'
                };
            } else {
                return { error: 'File read failed: Path not found ' + filePath };
            }
        } catch (e) {
            return { error: 'File read error: ' + e.message };
        }
    }

    return captureResult;
}

// Fetch Asset via CDP (for proxying vscode-file://)
async function fetchAssetViaCDP(cdp, url) {
    // The script must return the base64 data and verify content type
    const SCRIPT = `(async () => {
        try {
            const response = await fetch("${url}");
            if (!response.ok) return { error: 'Fetch failed: ' + response.status };
            const blob = await response.blob();
            
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve({
                    success: true,
                    data: reader.result.split(',')[1], // Base64 data without prefix
                    type: response.headers.get('content-type') || blob.type || 'application/octet-stream'
                });
                reader.onerror = () => resolve({ error: 'Reader failed' });
                reader.readAsDataURL(blob);
            });
        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: SCRIPT,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Asset fetch failed in all contexts' };
}

// Inject message into Antigravity
async function injectMessage(cdp, text) {
    // Use JSON.stringify for robust escaping (handles ", \, newlines, backticks, unicode, etc.)
    const safeText = JSON.stringify(text);

    const EXPRESSION = `(async () => {
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) return { ok:false, reason:"busy" };

        const editors = [...document.querySelectorAll('#cascade [data-lexical-editor="true"][contenteditable="true"][role="textbox"]')]
            .filter(el => el.offsetParent !== null);
        const editor = editors.at(-1);
        if (!editor) return { ok:false, error:"editor_not_found" };

        const textToInsert = ${safeText};

        editor.focus();
        document.execCommand?.("selectAll", false, null);
        document.execCommand?.("delete", false, null);

        let inserted = false;
        try { inserted = !!document.execCommand?.("insertText", false, textToInsert); } catch {}
        if (!inserted) {
            editor.textContent = textToInsert;
            editor.dispatchEvent(new InputEvent("beforeinput", { bubbles:true, inputType:"insertText", data: textToInsert }));
            editor.dispatchEvent(new InputEvent("input", { bubbles:true, inputType:"insertText", data: textToInsert }));
        }

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const submit = document.querySelector("svg.lucide-arrow-right")?.closest("button");
        if (submit && !submit.disabled) {
            submit.click();
            return { ok:true, method:"click_submit" };
        }
        
        // Check for New Conversation view submit button (might have 'Submit' text hidden or 'rounded-full')
        const allButtons = Array.from(document.querySelectorAll('button'));
        const newViewSubmit = allButtons.find(b => {
             // Must have arrow-right icon
             if (!b.querySelector('svg.lucide-arrow-right')) return false;
             // Must NOT be disabled
             if (b.disabled) return false;
             // Specific class check for high confidence
             if (b.classList.contains('rounded-full')) return true;
             return false;
        });

        if (newViewSubmit) {
            newViewSubmit.click();
            return { ok:true, method:"click_new_view_submit" };
        }

        // Submit button not found, but text is inserted - trigger Enter key
        editor.dispatchEvent(new KeyboardEvent("keydown", { bubbles:true, key:"Enter", code:"Enter" }));
        editor.dispatchEvent(new KeyboardEvent("keyup", { bubbles:true, key:"Enter", code:"Enter" }));
        
        return { ok:true, method:"enter_keypress" };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });

            if (result.result && result.result.value) {
                return result.result.value;
            }
        } catch (e) { }
    }

    return { ok: false, reason: "no_context" };
}

// Set functionality mode (Fast vs Planning)
async function setMode(cdp, mode) {
    if (!['Fast', 'Planning'].includes(mode)) return { error: 'Invalid mode' };

    const EXP = `(async () => {
        try {
            // STRATEGY: Find the element that IS the current mode indicator.
            // It will have text 'Fast' or 'Planning'.
            // It might not be a <button>, could be a <div> with cursor-pointer.
            
            // 1. Get all elements with text 'Fast' or 'Planning'
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                // Must have single text node child to avoid parents
                if (el.children.length > 0) return false;
                const txt = el.textContent.trim();
                return txt === 'Fast' || txt === 'Planning';
            });

            // 2. Find the one that looks interactive (cursor-pointer)
            // Traverse up from text node to find clickable container
            let modeBtn = null;
            
            for (const el of candidates) {
                let current = el;
                // Go up max 4 levels
                for (let i = 0; i < 4; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    if (style.cursor === 'pointer' || current.tagName === 'BUTTON' || current.getAttribute('role') === 'button') {
                        modeBtn = current;
                        break;
                    }
                    current = current.parentElement;
                }
                
                // Specific check for New Conversation view (span inside button)
                if (modeBtn && modeBtn.tagName === 'SPAN') {
                     const btn = modeBtn.closest('button');
                     if (btn) modeBtn = btn;
                }
                
                if (modeBtn) break;
            }

            if (!modeBtn) return { error: 'Mode indicator/button not found' };

            // Check if already set
            if (modeBtn.innerText.includes('${mode}')) return { success: true, alreadySet: true };

            // 3. Click to open menu
            modeBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // 4. Find the dialog
            let visibleDialog = Array.from(document.querySelectorAll('[role="dialog"]'))
                                    .find(d => d.offsetHeight > 0 && d.innerText.includes('${mode}'));
            
            // Fallback: Just look for any new visible container if role=dialog is missing
            if (!visibleDialog) {
                // Maybe it's not role=dialog? Look for a popover-like div
                 visibleDialog = Array.from(document.querySelectorAll('div'))
                    .find(d => {
                        const style = window.getComputedStyle(d);
                        return d.offsetHeight > 0 && 
                               (style.position === 'absolute' || style.position === 'fixed') && 
                               d.innerText.includes('${mode}') &&
                               !d.innerText.includes('Files With Changes'); // Anti-context menu
                    });
            }

            if (!visibleDialog) return { error: 'Dropdown not opened or options not visible' };

            // 5. Click the option
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            const target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.trim() === '${mode}'
            );

            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }
            
            return { error: 'Mode option text not found in dialog. Dialog text: ' + visibleDialog.innerText.substring(0, 50) };

        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Stop Generation
async function stopGeneration(cdp) {
    const EXP = `(async () => {
        // Look for the cancel button
        const cancel = document.querySelector('[data-tooltip-id="input-send-button-cancel-tooltip"]');
        if (cancel && cancel.offsetParent !== null) {
            cancel.click();
            return { success: true };
        }
        
        // Fallback: Look for a square icon in the send button area
        const stopBtn = document.querySelector('button svg.lucide-square')?.closest('button');
        if (stopBtn && stopBtn.offsetParent !== null) {
            stopBtn.click();
            return { success: true, method: 'fallback_square' };
        }
        
        // New Conversation View Stop Button (assuming similar structure to Submit but with square icon)
        const newViewStop = Array.from(document.querySelectorAll('button')).find(b => {
             const svg = b.querySelector('svg');
             // Must have square icon or "Stop" text
             const hasStopIcon = svg && (svg.classList.contains('lucide-square') || svg.innerHTML.includes('rect') || svg.innerHTML.includes('square'));
             if (!hasStopIcon) return false;
             
             return b.classList.contains('rounded-full') && b.offsetParent !== null;
        });
        
        if (newViewStop) {
            newViewStop.click();
            return { success: true, method: 'new_view_stop' };
        }

        return { error: 'No active generation found to stop' };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Trigger AGQ - Click the AGQ button in IDE and extract model quota data
async function triggerAgq(cdp) {
    const EXP = `(async () => {
        try {
            // Step 1: Find the AGQ element in the status bar
            // Use getElementById to avoid escaping issues with period in ID
            let agqElement = document.getElementById('henrikdev.ag-quota');
            
            // Fallback: Try finding by aria-label containing AGQ
            if (!agqElement) {
                agqElement = document.querySelector('[aria-label*="AGQ"]');
            }
            
            // Fallback: Find any statusbar item with "ag-quota" in ID
            if (!agqElement) {
                agqElement = document.querySelector('[id*="ag-quota"]');
            }
            
            if (!agqElement) {
                // Debug: Get all status bar items for diagnosis
                const statusItems = Array.from(document.querySelectorAll('.statusbar-item')).map(el => ({
                    id: el.id,
                    ariaLabel: el.getAttribute('aria-label')?.substring(0, 50)
                }));
                return { 
                    error: 'AGQ element not found in status bar',
                    debug: { statusItemCount: statusItems.length, items: statusItems.slice(0, 10) }
                };
            }
            
            // Step 2: Click the AGQ element to open the quick input widget
            const clickable = agqElement.querySelector('a.statusbar-item-label') || agqElement;
            clickable.click();
            
            // Step 3: Wait for quick input widget to appear
            await new Promise(r => setTimeout(r, 500));
            
            // Step 4: Find the quick input widget
            const quickInput = document.querySelector('.quick-input-widget');
            if (!quickInput) {
                return { error: 'Quick input widget not found after clicking AGQ' };
            }
            
            // Step 5: Extract model quota data from monaco list rows
            const listRows = quickInput.querySelectorAll('.monaco-list-row');
            if (!listRows || listRows.length === 0) {
                // Close the widget
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                return { error: 'No model data found in quick input' };
            }
            
            const models = [];
            listRows.forEach(row => {
                const ariaLabel = row.getAttribute('aria-label') || '';
                // Parse aria-label: "circle-outline  Gemini 3 Pro (High), ▓▓░░░░░░░░ 20.0%, Resets in: 1h 31m (01/19/2026 03:21), Model Quotas"
                // Format: "icon  Name, usageBar percentage%, Resets in: time (date), optional section"
                
                // Split by comma
                const parts = ariaLabel.split(',').map(p => p.trim());
                if (parts.length >= 3) {
                    // First part: "circle-outline  Model Name" or "circle-outline warning Gemini 3 Pro (High)"
                    // Repeatedly strip known icon prefixes from the start
                    let namePart = parts[0].trim();
                    const iconPrefixes = ['circle-outline', 'circle', 'warning', 'check', 'error', 'info', 'pass', 'fail', 'codicon'];
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
                    
                    // Second part: "▓▓░░░░░░░░ 20.0%"
                    const usagePart = parts[1] || '';
                    // Extract percentage - find the number before %
                    let usagePercent = 0;
                    const percentIdx = usagePart.indexOf('%');
                    if (percentIdx > 0) {
                        // Extract number before %
                        let numStr = '';
                        for (let i = percentIdx - 1; i >= 0; i--) {
                            const ch = usagePart[i];
                            if ((ch >= '0' && ch <= '9') || ch === '.') {
                                numStr = ch + numStr;
                            } else if (numStr) break;
                        }
                        if (numStr) usagePercent = parseFloat(numStr);
                    }
                    
                    // Third part: "Resets in: 1h 31m (01/19/2026 03:21)"
                    const resetPart = parts[2] || '';
                    const resetIdx = resetPart.indexOf('Resets in:');
                    const resetTime = resetIdx >= 0 ? resetPart.substring(resetIdx + 10).trim() : resetPart;
                    
                    models.push({
                        name: namePart,
                        usagePercent: usagePercent,
                        resetTime: resetTime
                    });
                }
            });
            
            // Step 6: Close the quick input widget (press Escape)
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await new Promise(r => setTimeout(r, 100));
            
            return {
                success: true,
                models: models
            };
        } catch (err) {
            // Try to close widget on error
            try {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            } catch {}
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    // First try main frame (without contextId) - status bar is in main workbench
    console.log('[AGQ] Trying main frame...');
    try {
        const res = await cdp.call("Runtime.evaluate", {
            expression: EXP,
            returnByValue: true,
            awaitPromise: true
        });
        console.log('[AGQ] Main frame result:', JSON.stringify(res.result?.value || res.result));
        if (res.result?.value?.success) return res.result.value;
        // If we got an error but not a context error, return it for debugging
        if (res.result?.value?.error && res.result?.value?.debug) {
            console.log('[AGQ] Got debug info, trying contexts...');
            // Continue to try contexts
        } else if (res.result?.value) {
            return res.result.value;
        }
    } catch (e) {
        console.log('[AGQ] Main frame error:', e.message);
    }

    // Fall back to trying specific contexts
    console.log('[AGQ] Trying', cdp.contexts.length, 'contexts...');
    for (const ctx of cdp.contexts) {
        try {
            console.log('[AGQ] Trying context:', ctx.id);
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            console.log('[AGQ] Context', ctx.id, 'result:', JSON.stringify(res.result?.value || res.result));
            if (res.result?.value?.success) return res.result.value;
        } catch (e) {
            console.log('[AGQ] Context', ctx.id, 'error:', e.message);
        }
    }
    return { error: 'Context failed - status bar not accessible' };
}

// Click Element (Remote)
async function clickElement(cdp, { selector, index, textContent }) {
    const EXP = `(async () => {
        try {
            // Strategy: Find all elements matching the selector
            // If textContent is provided, filter by that too for safety
            let elements = Array.from(document.querySelectorAll('${selector}'));
            
            if ('${textContent}') {
                elements = elements.filter(el => el.textContent.includes('${textContent}'));
            }

            const target = elements[${index}];

            if (target) {
                target.click();
                // Also try clicking the parent if the target is just a label
                // target.parentElement?.click(); 
                return { success: true };
            }
            
            return { error: 'Element not found at index ${index}' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Click failed in all contexts' };
}

// Remote scroll - sync phone scroll to desktop
async function remoteScroll(cdp, { scrollTop, scrollPercent }) {
    // Try to scroll the chat container in Antigravity
    const EXPRESSION = `(async () => {
        try {
            // Find the main scrollable chat container
            const scrollables = [...document.querySelectorAll('#cascade [class*="scroll"], #cascade [style*="overflow"]')]
                .filter(el => el.scrollHeight > el.clientHeight);
            
            // Also check for the main chat area
            const chatArea = document.querySelector('#cascade .overflow-y-auto, #cascade [data-scroll-area]');
            if (chatArea) scrollables.unshift(chatArea);
            
            if (scrollables.length === 0) {
                // Fallback: scroll the main cascade element
                const cascade = document.querySelector('#cascade');
                if (cascade && cascade.scrollHeight > cascade.clientHeight) {
                    scrollables.push(cascade);
                }
            }
            
            if (scrollables.length === 0) return { error: 'No scrollable element found' };
            
            const target = scrollables[0];
            
            // Use percentage-based scrolling for better sync
            if (${scrollPercent} !== undefined) {
                const maxScroll = target.scrollHeight - target.clientHeight;
                target.scrollTop = maxScroll * ${scrollPercent};
            } else {
                target.scrollTop = ${scrollTop || 0};
            }
            
            return { success: true, scrolled: target.scrollTop };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXPRESSION,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value?.success) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Scroll failed in all contexts' };
}

// Set AI Model
async function setModel(cdp, modelName) {
    const EXP = `(async () => {
        try {
            // STRATEGY: Find the element that IS the specific model we want to click.
            // But first we must find the Open Menu button.
            
            // 1. Find the model selector button (currently displaying some model)
            // It will usually contain a model name like "Gemini" or "Claude" and have a chevron.
            const KNOWN_KEYWORDS = ["Gemini", "Claude", "GPT", "Model"];
            
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                if (el.children.length > 0) return false; // Text nodes only
                const txt = el.textContent;
                return KNOWN_KEYWORDS.some(k => txt.includes(k));
            });

            // Find clickable parent
            let modelBtn = null;
            for (const el of candidates) {
                let current = el;
                
                // 1. High-confidence check for Headless UI (New View)
                // Text might be in a <p> or <span> inside the button
                const headlessBtn = current.closest('button[id*="headlessui-popover-button"]');
                if (headlessBtn) {
                     modelBtn = headlessBtn;
                     break;
                }

                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    
                    // Check for the specific structure in New View: button > p
                    if (current.tagName === 'P' && current.parentElement?.tagName === 'BUTTON') {
                        modelBtn = current.parentElement;
                        break;
                    }

                    if (current.tagName === 'BUTTON' || window.getComputedStyle(current).cursor === 'pointer') {
                        // Must also likely contain the chevron to be the selector, not just a label
                        if (current.querySelector('svg.lucide-chevron-down') || current.querySelector('svg.lucide-chevron-up') || current.innerText.includes('Model')) {
                            modelBtn = current;
                            break;
                        }
                    }
                    current = current.parentElement;
                }
                if (modelBtn) break;
            }

            if (!modelBtn) return { error: 'Model selector button not found' };

            // 2. Click to open
            modelBtn.click();
            await new Promise(r => setTimeout(r, 600));

            // 3. Find the dialog/dropdown
            const visibleDialog = Array.from(document.querySelectorAll('[role="dialog"], div'))
                .find(d => {
                    const style = window.getComputedStyle(d);
                    return d.offsetHeight > 0 && 
                           (style.position === 'absolute' || style.position === 'fixed') && 
                           d.innerText.includes('${modelName}') && 
                           !d.innerText.includes('Files With Changes');
                });

            if (!visibleDialog) return { error: 'Model list not opened' };

            // 4. Select specific model inside the dialog
            // Search deep for the specific text
            const allDialogEls = Array.from(visibleDialog.querySelectorAll('*'));
            
            // Try exact match first
            let target = allDialogEls.find(el => 
                el.children.length === 0 && el.textContent.trim() === '${modelName}'
            );
            
            // Try partial/inclusive match
            if (!target) {
                 target = allDialogEls.find(el => 
                    el.children.length === 0 && el.textContent.includes('${modelName}')
                );
            }

            if (target) {
                target.click();
                await new Promise(r => setTimeout(r, 200));
                return { success: true };
            }

            return { error: 'Model "${modelName}" not found in list. Visible: ' + visibleDialog.innerText.substring(0, 100) };
        } catch(err) {
            return { error: 'JS Error: ' + err.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Get App State (Mode & Model)
async function getAppState(cdp) {
    const EXP = `(async () => {
        try {
            const state = { mode: 'Unknown', model: 'Unknown' };
            
            // 1. Get Mode (Fast/Planning)
            // Strategy: Find the clickable mode button which contains either "Fast" or "Planning"
            // It's usually a button or div with cursor:pointer containing the mode text
            const allEls = Array.from(document.querySelectorAll('*'));
            
            // Find elements that are likely mode buttons
            for (const el of allEls) {
                if (el.children.length > 0) continue;
                const text = (el.innerText || '').trim();
                if (text !== 'Fast' && text !== 'Planning') continue;
                
                // Check if this or a parent is clickable (the actual mode selector)
                let current = el;
                for (let i = 0; i < 5; i++) {
                    if (!current) break;
                    const style = window.getComputedStyle(current);
                    if (style.cursor === 'pointer' || current.tagName === 'BUTTON') {
                        state.mode = text;
                        break;
                    }
                    current = current.parentElement;
                }
                if (state.mode !== 'Unknown') break;
            }
            
            // Fallback: Just look for visible text
            if (state.mode === 'Unknown') {
                const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
                if (textNodes.some(el => el.innerText.trim() === 'Planning')) state.mode = 'Planning';
                else if (textNodes.some(el => el.innerText.trim() === 'Fast')) state.mode = 'Fast';
            }

            // 2. Get Model
            // Strategy: Look for button containing a known model keyword
            const KNOWN_MODELS = ["Gemini", "Claude", "GPT"];
            const textNodes = allEls.filter(el => el.children.length === 0 && el.innerText);
            
            const modelEl = textNodes.find(el => {
                const txt = el.innerText;
                if (!KNOWN_MODELS.some(k => txt.includes(k))) return false;
                
                // Check ancestors for button with chevron
                let curr = el;
                for(let i=0; i<4; i++) {
                    if (!curr) break;
                    if (curr.tagName === 'BUTTON' || curr.getAttribute('role') === 'button') {
                         if (curr.querySelector('svg.lucide-chevron-down, svg.lucide-chevron-up')) return true;
                    }
                    curr = curr.parentElement;
                }
                return false;
            });
            
            if (modelEl) {
                state.model = modelEl.innerText.trim();
            }
            
            return state;
        } catch(e) { return { error: e.toString() }; }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

async function checkAgentPanelVisibility(cdp) {
    const SCRIPT = `(() => {
        const panel = document.getElementById('antigravity.agentPanel');
        if (!panel) return { found: false, error: 'Panel not found' };
        const parent = panel.parentElement;
        const target = parent || panel;
        const style = window.getComputedStyle(target);
        return { 
            found: true,
            visible: style.display !== 'none',
            display: style.display
        };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Ensure Agent Panel is Visible
async function ensureAgentPanelVisible(cdp) {
    const SCRIPT = `(() => {
        const panel = document.getElementById('antigravity.agentPanel');
        if (!panel) return { success: false, error: 'Panel not found' };
        const parent = panel.parentElement;
        const target = parent || panel;
        const prevDisplay = target.style.display;
        target.style.display = 'block';
        return { 
            success: true, 
            previousDisplay: prevDisplay,
            newDisplay: 'block'
        };
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const result = await cdp.call("Runtime.evaluate", {
                expression: SCRIPT,
                returnByValue: true,
                contextId: ctx.id
            });
            if (result.result?.value) return result.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Create New Conversation
async function createNewConversation(cdp) {
    const EXP = `(async () => {
        try {
            // Find the button with the specific tooltip ID
            const btn = document.querySelector('a[data-tooltip-id="new-conversation-tooltip"]');
            
            if (btn) {
                btn.click();
                
                // Ensure the agent panel's parent is visible
                const agentPanel = document.getElementById('antigravity.agentPanel');
                if (agentPanel && agentPanel.parentElement) {
                    agentPanel.parentElement.style.display = 'block';
                }
                
                return { success: true };
            }
            
            // Fallback: Look for any element acting as a "new chat" button
            // Often has a plus icon and is in the header
            const candidates = Array.from(document.querySelectorAll('a, button'));
            const plusBtn = candidates.find(el => {
                const svg = el.querySelector('svg');
                // Check if it has a plus icon (path d often contains 'M12 5v14' or similar, or class 'lucide-plus')
                const hasPlusIcon = svg && (
                    svg.classList.contains('lucide-plus') || 
                    svg.innerHTML.includes('M12 5') 
                );
                
                // Usually near the conversation history or top of sidebar
                return hasPlusIcon && el.offsetParent !== null;
            });

            if (plusBtn) {
                plusBtn.click();
                
                // Ensure the agent panel's parent is visible
                const agentPanel = document.getElementById('antigravity.agentPanel');
                if (agentPanel && agentPanel.parentElement) {
                    agentPanel.parentElement.style.display = 'block';
                }
                
                return { success: true, method: 'fallback_plus' };
            }

            return { error: 'New conversation button not found' };
        } catch(e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Trigger Generic IDE Action
async function triggerIdeAction(cdp, action, index = 0) {
    const EXP = `(async () => {
        try {
            let targetText = '';
            if ('${action}' === 'expand-all') targetText = 'Expand all';
            else if ('${action}' === 'collapse-all') targetText = 'Collapse all';
            else if ('${action}' === 'accept') targetText = 'Accept';
            else if ('${action}' === 'reject') targetText = 'Reject';
            else return { error: 'Unknown action' };
            
            const targetIndex = ${index};

            // Find all elements containing the text
            const allEls = Array.from(document.querySelectorAll('*'));
            const candidates = allEls.filter(el => {
                // Must have the text directly or be a container for it
                return el.textContent.includes(targetText);
            });

            // Filter for clickable elements (role=button or cursor pointer)
            // or elements that contain the text and look like the target structure
            // We want to find ALL valid targets first, then pick the one at targetIndex
            const validTargets = candidates.filter(el => {
                const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
                const text = el.textContent.trim();

                if (isButton && text.startsWith(targetText)) {
                    return true;
                }
                
                // Also check close parents of the text node if exact element not hit
                if (text.startsWith(targetText) && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE') {
                    // It's the text node wrapper, look up for button role
                    if (el.closest('button, [role="button"]')) return true;
                }
                return false;
            });
            
            // De-duplicate: sometimes we might catch both the inner text span AND the outer button
            // If we have nested matches, usually the outer button is what we want.
            // But if our filter logic is good, validTargets might just be the buttons.
            // Let's refine: map to the closest button
            const uniqueButtons = [];
            validTargets.forEach(el => {
                const btn = (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') ? el : el.closest('button, [role="button"]');
                if (btn && !uniqueButtons.includes(btn)) {
                    uniqueButtons.push(btn);
                }
            });

            const target = uniqueButtons[targetIndex];
            
            if (target) {
                // Simulate full click sequence for better compatibility
                const events = ['mousedown', 'mouseup', 'click'];
                events.forEach(eventType => {
                    const event = new MouseEvent(eventType, {
                        view: window,
                        bubbles: true,
                        cancelable: true,
                        buttons: 1
                    });
                    target.dispatchEvent(event);
                });
                return { success: true };
            }

            return { error: 'Action target not found' };

        } catch (e) {
            return { error: e.toString() };
        }
    })()`;

    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: EXP,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) return res.result.value;
        } catch (e) { }
    }
    return { error: 'Context failed' };
}

// Get Conversation History
async function getConversations(cdp) {
    // Phase 1: Click the button (in whatever context it exists)
    let buttonClicked = false;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: `(async () => {
                    const btn = document.querySelector('[data-past-conversations-toggle="true"]');
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                })()`,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) {
                buttonClicked = true;
                break;
            }
        } catch (e) { }
    }

    if (!buttonClicked) {
        // It might be that the list is ALREADY open, so we shouldn't fail just yet.
        // But if we couldn't even find the button to toggle it, that's notable.
        // We'll proceed to Phase 2 just in case.
    }

    // Phase 2: Find the overlay (in whatever context it exists)
    // Retry logic allowing for cross-context search
    for (let attempt = 0; attempt < 20; attempt++) {
        // Wait a bit between attempts (and initial wait)
        await new Promise(r => setTimeout(r, 150));

        for (const ctx of cdp.contexts) {
            try {
                const EXTRACT_SCRIPT = `(async () => {
                    const overlay = document.querySelector('.jetski-fast-pick');
                    if (!overlay || overlay.offsetHeight === 0) return null;

                    // Click "Show more" buttons iteratively until none remain
                    // We loop to catch nested or multiple "Show more" triggers
                    for(let i=0; i<5; i++) { // Limit to 5 expansions to prevent infinite loops
                        const showButtons = Array.from(overlay.querySelectorAll('div.text-quickinput-foreground.text-sm.cursor-pointer'))
                            .filter(el => el.textContent.includes('Show') && el.textContent.includes('more'));
                            
                        if (showButtons.length === 0) break;
                        
                        for (const btn of showButtons) {
                            btn.click();
                            // Small wait between clicks to allow DOM update
                            await new Promise(r => setTimeout(r, 200));
                        }
                        // Wait for expansion
                         await new Promise(r => setTimeout(r, 300));
                    }

                    // Extract conversations with context-aware workspace tracking
                    // We select both headers and items to process them in order
                    const allElements = overlay.querySelectorAll('div.text-quickinput-foreground.text-xs, div.px-2\\\\.5.cursor-pointer');
                    const conversations = [];
                    
                    let currentSectionWorkspace = '';
                    
                    let itemIndex = 0;
                    allElements.forEach(el => {
                        // Check if Header
                        if (el.classList.contains('text-quickinput-foreground') && el.classList.contains('text-xs')) {
                            const text = el.textContent || '';
                            
                            // Check for "Current"
                            if (text.includes('Current')) {
                                currentSectionWorkspace = 'Current';
                                return;
                            }

                            // Matches "Running in X", "Recent in X"
                            const match = text.match(/(?:Running|Recent) in (.+)/i);
                            if (match) {
                                currentSectionWorkspace = match[1].trim();
                            }
                            return;
                        }

                        // Must be an Item
                        // Double check class just in case selector leakage
                        if (!el.classList.contains('cursor-pointer')) return;

                        const titleSpan = el.querySelector('span.text-sm span');
                        const timeSpan = el.querySelector('span.text-xs.opacity-50.ml-4');
                        const wsSpan = el.querySelector('span.text-xs.opacity-50.truncate');
                        
                        // Use explicit workspace if present, otherwise fall back to section workspace
                        const workspace = wsSpan?.textContent?.trim() || currentSectionWorkspace;

                        conversations.push({
                            index: itemIndex++, // Re-index locally
                            title: titleSpan?.textContent?.trim() || 'Untitled',
                            time: timeSpan?.textContent?.trim() || '',
                            workspace: workspace
                        });
                    });

                    // Close (Escape)
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

                    return { success: true, conversations, defaultWorkspace: currentSectionWorkspace };
                })()`;

                const res = await cdp.call("Runtime.evaluate", {
                    expression: EXTRACT_SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });

                if (res.result?.value?.success) {
                    return res.result.value;
                }
            } catch (e) { }
        }
    }

    return { error: buttonClicked ? 'Button clicked but list not found (timeout)' : 'History button not found' };
}

// Select a Conversation
async function selectConversation(cdp, { index, title }) {
    const safeTitle = JSON.stringify(title);

    // Phase 1: Open List
    let buttonClicked = false;
    for (const ctx of cdp.contexts) {
        try {
            const res = await cdp.call("Runtime.evaluate", {
                expression: `(async () => {
                    const btn = document.querySelector('[data-past-conversations-toggle="true"]');
                    if (btn) {
                        btn.click();
                        return true;
                    }
                    return false;
                })()`,
                returnByValue: true,
                awaitPromise: true,
                contextId: ctx.id
            });
            if (res.result?.value) {
                buttonClicked = true;
                break;
            }
        } catch (e) { }
    }

    // Phase 2: Find & Click Item
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise(r => setTimeout(r, 150));

        for (const ctx of cdp.contexts) {
            try {
                const SELECT_SCRIPT = `(async () => {
                    const overlay = document.querySelector('.jetski-fast-pick');
                    if (!overlay || overlay.offsetHeight === 0) return null;

                    // Click "Show more" iteratively
                    for(let i=0; i<5; i++) {
                        const showButtons = Array.from(overlay.querySelectorAll('div.text-quickinput-foreground.text-sm.cursor-pointer'))
                            .filter(el => el.textContent.includes('Show') && el.textContent.includes('more'));
                            
                        if (showButtons.length === 0) break;
                        
                        for (const btn of showButtons) {
                            btn.click();
                            await new Promise(r => setTimeout(r, 200));
                        }
                        await new Promise(r => setTimeout(r, 300));
                    }

                    // Find target
                    const items = overlay.querySelectorAll('div.px-2\\\\.5.cursor-pointer');
                    let target = null;
                    
                    const searchTitle = ${safeTitle};
                    if (searchTitle) {
                        items.forEach(item => {
                            const titleEl = item.querySelector('span.text-sm span');
                            if (titleEl?.textContent?.trim() === searchTitle) {
                                target = item;
                            }
                        });
                    }
                    
                    if (!target && ${index} !== undefined) {
                        target = items[${index}];
                    }
                    
                    if (target) {
                        target.click();
                        
                        // Ensure the agent panel's parent is visible
                        const agentPanel = document.getElementById('antigravity.agentPanel');
                        if (agentPanel && agentPanel.parentElement) {
                            agentPanel.parentElement.style.display = 'block';
                        }
                        
                        return { success: true };
                    }
                    return { error: 'Item not found in list' };
                })()`;

                const res = await cdp.call("Runtime.evaluate", {
                    expression: SELECT_SCRIPT,
                    returnByValue: true,
                    awaitPromise: true,
                    contextId: ctx.id
                });

                if (res.result?.value?.success) return res.result.value;
                // If we found the list but not the item, that's a specific error we might generally encounter
                // But we'll keep retrying in case the list is still rendering items
            } catch (e) { }
        }
    }

    return { error: buttonClicked ? 'List opened but conversation not found' : 'History button not found' };
}

// Simple hash function
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return hash.toString(36);
}

// Initialize CDP connection
async function initCDP() {
    console.log('🔍 Discovering VS Code CDP endpoint...');
    const cdpInfo = await discoverCDP();
    console.log(`✅ Found VS Code on port ${cdpInfo.port}`);

    console.log('🔌 Connecting to CDP...');
    cdpConnection = await connectCDP(cdpInfo.url);
    console.log(`✅ Connected! Found ${cdpConnection.contexts.length} execution contexts\n`);

    // Check and ensure agent panel is visible
    const panelStatus = await checkAgentPanelVisibility(cdpConnection);
    if (panelStatus.found && !panelStatus.visible) {
        console.log('⚠️ Agent panel hidden, making visible...');
        await ensureAgentPanelVisible(cdpConnection);
        console.log('✅ Agent panel now visible');
    } else if (!panelStatus.found) {
        console.log('ℹ️ Agent panel not found in current context');
    }
}

// Background polling
async function startPolling(wss) {
    setInterval(async () => {
        if (!cdpConnection) return;

        try {
            const snapshot = await captureSnapshot(cdpConnection);
            if (snapshot && !snapshot.error) {
                const hash = hashString(snapshot.html);

                // Only update if content changed
                if (hash !== lastSnapshotHash) {
                    lastSnapshot = snapshot;
                    lastSnapshotHash = hash;

                    // Broadcast to all connected clients
                    wss.clients.forEach(client => {
                        if (client.readyState === WebSocket.OPEN) {
                            client.send(JSON.stringify({
                                type: 'snapshot_update',
                                timestamp: new Date().toISOString()
                            }));
                        }
                    });

                    console.log(`📸 Snapshot updated (hash: ${hash})`);
                }
            }
        } catch (err) {
            console.error('Poll error:', err.message);
        }
    }, POLL_INTERVAL);
}

// Create Express app
async function createServer() {
    const app = express();

    // Check for SSL certificates
    const keyPath = join(__dirname, 'certs', 'server.key');
    const certPath = join(__dirname, 'certs', 'server.cert');
    const hasSSL = fs.existsSync(keyPath) && fs.existsSync(certPath);

    let server;
    let httpsServer = null;

    if (hasSSL) {
        const sslOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath)
        };
        httpsServer = https.createServer(sslOptions, app);
        server = httpsServer;
    } else {
        server = http.createServer(app);
    }

    const wss = new WebSocketServer({ server });

    app.use(express.json());
    app.use(express.static(join(__dirname, 'public')));

    // Get current snapshot
    app.get('/snapshot', (req, res) => {
        if (!lastSnapshot) {
            return res.status(503).json({ error: 'No snapshot available yet' });
        }
        res.json(lastSnapshot);
    });

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({
            status: 'ok',
            cdpConnected: cdpConnection?.ws?.readyState === 1, // WebSocket.OPEN = 1
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            https: hasSSL
        });
    });

    // SSL status endpoint
    app.get('/ssl-status', (req, res) => {
        const keyPath = join(__dirname, 'certs', 'server.key');
        const certPath = join(__dirname, 'certs', 'server.cert');
        const certsExist = fs.existsSync(keyPath) && fs.existsSync(certPath);
        res.json({
            enabled: hasSSL,
            certsExist: certsExist,
            message: hasSSL ? 'HTTPS is active' :
                certsExist ? 'Certificates exist, restart server to enable HTTPS' :
                    'No certificates found'
        });
    });

    // Generate SSL certificates endpoint
    app.post('/generate-ssl', async (req, res) => {
        try {
            const { execSync } = await import('child_process');
            execSync('node generate_ssl.js', { cwd: __dirname, stdio: 'pipe' });
            res.json({
                success: true,
                message: 'SSL certificates generated! Restart the server to enable HTTPS.'
            });
        } catch (e) {
            res.status(500).json({
                success: false,
                error: e.message
            });
        }
    });

    // Debug UI Endpoint
    app.get('/debug-ui', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP not connected' });
        const uiTree = await inspectUI(cdpConnection);
        console.log('--- UI TREE ---');
        console.log(uiTree);
        console.log('---------------');
        res.type('json').send(uiTree);
    });

    // Set Mode
    app.post('/set-mode', async (req, res) => {
        const { mode } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setMode(cdpConnection, mode);
        res.json(result);
    });

    // Set Model
    app.post('/set-model', async (req, res) => {
        const { model } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await setModel(cdpConnection, model);
        res.json(result);
    });

    // List Workspaces
    app.get('/api/workspaces', async (req, res) => {
        try {
            const workspaces = await getAllWorkspaces();
            res.json({
                success: true,
                workspaces,
                currentWorkspaceId: currentWorkspaceId
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Switch Workspace
    app.post('/api/workspace/switch', async (req, res) => {
        try {
            const { id } = req.body;
            if (!id) return res.status(400).json({ error: 'Missing workspace ID' });

            console.log(`Switching to workspace ${id}...`);

            // Discover with specific ID will return the correct URL
            const cdpInfo = await discoverCDP(id);

            // Close existing connection
            if (cdpConnection && cdpConnection.ws) {
                try { cdpConnection.ws.close(); } catch (e) { }
                cdpConnection = null;
            }

            // Connect to new workspace
            cdpConnection = await connectCDP(cdpInfo.url);

            console.log(`Switched workspace to ${id}`);
            res.json({ success: true });

        } catch (error) {
            console.error('Switch failed:', error);
            res.status(500).json({ success: false, error: error.message });
        }
    });

    // Stop Generation
    app.post('/stop', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await stopGeneration(cdpConnection);
        res.json(result);
    });

    // Trigger AGQ - Get Model Quotas
    app.post('/trigger-agq', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        try {
            const result = await triggerAgq(cdpConnection);
            res.json(result);
        } catch (e) {
            console.error('[AGQ] Error:', e);
            res.status(500).json({ error: 'Server error: ' + e.message });
        }
    });

    // Get conversation history
    app.get('/conversations', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await getConversations(cdpConnection);
        res.json(result);
    });

    // Select/switch conversation
    app.post('/select-conversation', async (req, res) => {
        const { index, title } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await selectConversation(cdpConnection, { index, title });
        res.json(result);
    });

    // Create New Conversation
    app.post('/new-conversation', async (req, res) => {
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await createNewConversation(cdpConnection);
        res.json(result);
    });

    // Get artifact content
    app.post('/get-artifact', async (req, res) => {
        const { buttonText = 'Open', artifactTitle, isFile } = req.body;
        if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
        const result = await captureArtifactContent(cdpConnection, { buttonText, artifactTitle, isFile });
        res.json(result);
    });

    // Proxy Asset (vscode-file://)
    app.get('/proxy-asset', async (req, res) => {
        const { url } = req.query;
        if (!url) return res.status(400).send('Missing url parameter');
        if (!cdpConnection) return res.status(503).send('CDP not connected');

        // Decode the URL before passing to CDP
        const targetUrl = decodeURIComponent(url);

        // Log the request to help debug
        console.log(`🖼️ Proxying asset: ${targetUrl.split('/').pop()}`);

        // Basic security check: ensure it's a vscode-file or file scheme (or whatever internal scheme used)
        if (!targetUrl.startsWith('vscode-file://')) {
            // Optional: Allow other schemes if needed, but start restrictive
            // console.log('Proxy request for non-vscode URL:', targetUrl);
        }

        const result = await fetchAssetViaCDP(cdpConnection, targetUrl);

        if (result.error || !result.success) {
            console.error(`❌ Asset fetch failed: ${targetUrl.split('/').pop()} - ${result.error}`);
            return res.status(404).send(result.error || 'Asset not found');
        }

        res.set('Content-Type', result.type);
        res.set('Cache-Control', 'public, max-age=86400'); // Cache for 24 hours
        res.send(Buffer.from(result.data, 'base64'));
    });

    // Send message
    app.post('/send', async (req, res) => {
        const { message } = req.body;

        if (!message) {
            return res.status(400).json({ error: 'Message required' });
        }

        if (!cdpConnection) {
            return res.status(503).json({ error: 'CDP not connected' });
        }

        const result = await injectMessage(cdpConnection, message);

        // Always return 200 - the message usually goes through even if CDP reports issues
        // The client will refresh and see if the message appeared
        res.json({
            success: result.ok !== false,
            method: result.method || 'attempted',
            details: result
        });
    });

    // WebSocket connection
    wss.on('connection', (ws) => {
        console.log('📱 Client connected');

        ws.on('close', () => {
            console.log('📱 Client disconnected');
        });
    });

    return { server, wss, app, hasSSL };
}

// Main
async function main() {
    try {
        await initCDP();

        const { server, wss, app, hasSSL } = await createServer();

        // Start background polling
        startPolling(wss);

        // Remote Click
        app.post('/remote-click', async (req, res) => {
            const { selector, index, textContent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await clickElement(cdpConnection, { selector, index, textContent });
            res.json(result);
        });

        // Remote Scroll - sync phone scroll to desktop
        app.post('/remote-scroll', async (req, res) => {
            const { scrollTop, scrollPercent } = req.body;
            if (!cdpConnection) return res.status(503).json({ error: 'CDP disconnected' });
            const result = await remoteScroll(cdpConnection, { scrollTop, scrollPercent });
            res.json(result);
        });

        // Get App State
        app.get('/app-state', async (req, res) => {
            if (!cdpConnection) return res.json({ mode: 'Unknown', model: 'Unknown' });
            const result = await getAppState(cdpConnection);
            res.json(result);
        });

        // Agent Panel Visibility Check
        app.get('/agent-panel-status', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP not connected' });
            const status = await checkAgentPanelVisibility(cdpConnection);
            res.json(status);
        });

        // Force Agent Panel Visible
        app.post('/agent-panel-show', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'CDP not connected' });
            const result = await ensureAgentPanelVisible(cdpConnection);
            res.json(result);
        });

        // Trigger generic action
        app.post('/trigger-action', async (req, res) => {
            if (!cdpConnection) return res.status(503).json({ error: 'No CDP connection' });
            const { action, index } = req.body;

            try {
                const result = await triggerIdeAction(cdpConnection, action, index);
                if (result && result.success) {
                    res.json({ success: true });
                } else {
                    res.status(500).json({ error: result?.error || 'Action failed' });
                }
            } catch (e) {
                res.status(500).json({ error: e.toString() });
            }
        });

        // Start server
        const PORT = process.env.PORT || 3000;
        const localIP = getLocalIP();
        const protocol = hasSSL ? 'https' : 'http';
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Server running on ${protocol}://${localIP}:${PORT}`);
            if (hasSSL) {
                console.log(`💡 First time on phone? Accept the security warning to proceed.`);
            }
        });

        // Graceful shutdown handlers
        const gracefulShutdown = (signal) => {
            console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
            wss.close(() => {
                console.log('   WebSocket server closed');
            });
            server.close(() => {
                console.log('   HTTP server closed');
            });
            if (cdpConnection?.ws) {
                cdpConnection.ws.close();
                console.log('   CDP connection closed');
            }
            setTimeout(() => process.exit(0), 1000);
        };

        process.on('SIGINT', () => gracefulShutdown('SIGINT'));
        process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    } catch (err) {
        console.error('❌ Fatal error:', err.message);
        process.exit(1);
    }
}

main();
