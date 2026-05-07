const TRIGGER = "/meet";
const PLACEHOLDER = "Creating Meet link…";

const pending = new WeakSet();

document.addEventListener("input", onInput, true);

function onInput(e) {
  const el = e.target;
  if (!isEditable(el)) return;
  if (pending.has(el)) return;

  const text = readText(el).trim();
  if (text !== TRIGGER) return;

  pending.add(el);
  writeText(el, PLACEHOLDER);

  chrome.runtime.sendMessage({ type: "create-meet" }, (response) => {
    pending.delete(el);

    if (chrome.runtime.lastError) {
      writeText(el, "Meet error: " + chrome.runtime.lastError.message);
      return;
    }
    if (!response) {
      writeText(el, "Meet error: no response from extension");
      return;
    }
    if (response.ok) {
      writeText(el, response.uri);
    } else {
      writeText(el, "Meet error: " + (response.error || "unknown"));
    }
  });
}

function isEditable(el) {
  if (!el) return false;
  if (el.tagName === "TEXTAREA") return true;
  if (el.tagName === "INPUT" && (el.type === "text" || el.type === "search")) return true;
  if (el.isContentEditable) return true;
  return false;
}

function readText(el) {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") return el.value || "";
  return el.textContent || "";
}

function writeText(el, newText) {
  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const proto =
      el.tagName === "TEXTAREA"
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, newText);
    else el.value = newText;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }
  if (el.isContentEditable) {
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("insertText", false, newText);
  }
}

console.log("flip-meet content script loaded");
