/**
 * Modal Dialog
 */

import { UI } from "./ui.js";

export function openModal(title, options, onSelect) {
  UI.modalTitle.textContent = title;
  UI.modalList.innerHTML = "";

  options.forEach((opt) => {
    const div = document.createElement("div");
    div.className = "modal-option";

    if (typeof opt === "object" && opt !== null && opt.html) {
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
  UI.modalOverlay.classList.add("show");
}

export function closeModal() {
  UI.modalOverlay.classList.remove("show");
}

export function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
