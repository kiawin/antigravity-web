/**
 * Inject message into Antigravity chat
 * This script runs in the browser context via CDP
 */

export const injectMessageScript = async function (params) {
  const { text } = params;

  const cancel = document.querySelector(
    '[data-tooltip-id="input-send-button-cancel-tooltip"]',
  );
  if (cancel && cancel.offsetParent !== null)
    return { ok: false, reason: "busy" };

  const editors = [
    ...document.querySelectorAll(
      '#cascade [data-lexical-editor="true"][contenteditable="true"][role="textbox"]',
    ),
  ].filter((el) => el.offsetParent !== null);
  const editor = editors.at(-1);
  if (!editor) return { ok: false, error: "editor_not_found" };

  editor.focus();
  document.execCommand?.("selectAll", false, null);
  document.execCommand?.("delete", false, null);

  let inserted = false;
  try {
    inserted = !!document.execCommand?.("insertText", false, text);
  } catch {}
  if (!inserted) {
    editor.textContent = text;
    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }

  await new Promise((r) =>
    requestAnimationFrame(() => requestAnimationFrame(r)),
  );

  const submit = document
    .querySelector("svg.lucide-arrow-right")
    ?.closest("button");
  if (submit && !submit.disabled) {
    submit.click();
    return { ok: true, method: "click_submit" };
  }

  // Check for New Conversation view submit button
  const allButtons = Array.from(document.querySelectorAll("button"));
  const newViewSubmit = allButtons.find((b) => {
    if (!b.querySelector("svg.lucide-arrow-right")) return false;
    if (b.disabled) return false;
    if (b.classList.contains("rounded-full")) return true;
    return false;
  });

  if (newViewSubmit) {
    newViewSubmit.click();
    return { ok: true, method: "click_new_view_submit" };
  }

  // Fallback: trigger Enter key
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      key: "Enter",
      code: "Enter",
    }),
  );
  editor.dispatchEvent(
    new KeyboardEvent("keyup", { bubbles: true, key: "Enter", code: "Enter" }),
  );

  return { ok: true, method: "enter_keypress" };
};
