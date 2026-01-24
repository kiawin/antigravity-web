/**
 * API Client
 */

export async function sendMessage(message) {
  const res = await fetch("/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });
  return res.json();
}

export async function fetchAppState() {
  const res = await fetch("/app-state");
  return res.json();
}

export async function stopGeneration() {
  return fetch("/stop", { method: "POST" });
}

export async function setMode(mode) {
  const res = await fetch("/set-mode", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  return res.json();
}

export async function setModel(model) {
  const res = await fetch("/set-model", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  return res.json();
}

export async function getWorkspaces() {
  const res = await fetch("/api/workspaces");
  return res.json();
}

export async function switchWorkspace(id) {
  return fetch("/api/workspace/switch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function getConversations() {
  const res = await fetch("/conversations");
  return res.json();
}

export async function selectConversation(title, index) {
  return fetch("/select-conversation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, index }),
  });
}

export async function newConversation() {
  const res = await fetch("/new-conversation", { method: "POST" });
  return res.json();
}

export async function triggerAction(action, index) {
  return fetch("/trigger-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, index }),
  });
}

export async function getArtifact(buttonText, artifactTitle, isFile) {
  const res = await fetch("/get-artifact", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ buttonText, artifactTitle, isFile }),
  });
  return res.json();
}

export async function remoteClick(selector, index, textContent) {
  return fetch("/remote-click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selector, index, textContent }),
  });
}

export async function remoteScroll(scrollPercent) {
  return fetch("/remote-scroll", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scrollPercent }),
  });
}

export async function triggerAgq() {
  const res = await fetch("/trigger-agq", { method: "POST" });
  return res.json();
}

export async function loadSnapshot() {
  const res = await fetch("/snapshot");
  if (!res.ok) return null;
  return res.json();
}
