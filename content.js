// Flip Meet — content script
// A small slash-command framework for chat composers. Watches editable
// elements for a trailing/standalone slash command and dispatches to a
// handler. Some commands rewrite the composer inline (/meet, /time, macros),
// others open a Shadow-DOM modal (/help, /consent, /poll, /time).
(() => {
  "use strict";

  const PLACEHOLDER = "Creating Meet link…";

  // Guards. `suppressInput` blocks our own programmatic writes from
  // re-entering the input handler. `pending` blocks /meet's async window.
  let suppressInput = false;
  const pending = new WeakSet();

  // Remember the composer we last acted on so modals can refocus it on close.
  let lastEditable = null;

  // -------------------------------------------------------------------------
  // Composer read/write helpers (shared by every command)
  // -------------------------------------------------------------------------

  function isEditable(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    if (el.tagName === "INPUT" && (el.type === "text" || el.type === "search"))
      return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function readText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT")
      return el.value || "";
    return el.textContent || "";
  }

  function writeText(el, newText) {
    suppressInput = true;
    try {
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
        // insertText fires its own input event; keep it inside the suppress
        // window so we don't recurse.
        document.execCommand("insertText", false, newText);
      }
    } finally {
      suppressInput = false;
    }
  }

  function clearComposer(el) {
    writeText(el, "");
  }

  function refocus(el) {
    if (el && document.documentElement.contains(el)) {
      try {
        el.focus();
      } catch (_) {}
    }
  }

  // -------------------------------------------------------------------------
  // Command registry (single source of truth, also drives /help)
  // -------------------------------------------------------------------------

  const MACROS = {
    shrug: "¯\\_(ツ)_/¯",
    tableflip: "(╯°□°)╯︵ ┻━┻",
    unflip: "┬─┬ ノ( ゜-゜ノ)",
    lenny: "( ͡° ͜ʖ ͡°)",
    disapprove: "ಠ_ಠ"
  };

  // /flip — bold "FLIP" wordmark in solid full-block glyphs, no icon.
  // Pure █ (no thin shadow chars) so the letters read as clean solid blocks.
  // The ``` fence is required: it's the only thing that makes Flip render the
  // message monospace (4-space-indented blocks are NOT honoured — tested).
  // Fence markers show only in the composer draft; the sent message renders
  // as a clean monospace block.
  const FLIP_ART = [
    "```",
    "██████ ██     ██████ ██████",
    "██     ██       ██   ██  ██",
    "█████  ██       ██   ██████",
    "██     ██       ██   ██    ",
    "██     ██       ██   ██    ",
    "██████ ██████ ██████ ██    ",
    "```"
  ].join("\n");

  // Standalone commands: must be the entire trimmed composer text (an
  // optional trailing argument is captured for the paste case).
  const STANDALONE = [
    { name: "meet", re: /^\/meet$/ },
    { name: "help", re: /^\/help$/ },
    { name: "consent", re: /^\/consent$/ },
    { name: "time", re: /^\/time(?:\s+([\s\S]+))?$/ },
    { name: "poll", re: /^\/poll(?:\s+([\s\S]+))?$/ },
    { name: "flip", re: /^\/flip$/ }
  ];

  // Drives the /help modal. Keep usage strings human-friendly.
  const COMMAND_INFO = [
    { usage: "/meet", desc: "Insert an instant Google Meet link" },
    { usage: "/help", desc: "Show this list of commands" },
    {
      usage: "/time",
      desc: "Convert a time across team timezones, then insert it"
    },
    { usage: "/poll", desc: "Build an emoji-reaction poll and insert it" },
    {
      usage: "/consent",
      desc: "Show a demo recording-consent dialog (not wired to anything)"
    },
    {
      usage: "/shrug",
      desc: "Insert ¯\\_(ツ)_/¯  ·  also /tableflip /unflip /lenny /disapprove"
    },
    { usage: "/flip", desc: "Insert Flip logo ASCII art" }
  ];

  // -------------------------------------------------------------------------
  // Detection + dispatch
  // -------------------------------------------------------------------------

  function detect(rawText) {
    const trimmed = rawText.trim();
    if (!trimmed) return null;

    for (const cmd of STANDALONE) {
      const m = trimmed.match(cmd.re);
      if (m) return { kind: "standalone", name: cmd.name, arg: (m[1] || "").trim() };
    }

    // Trailing macro: command token at end of message, on a word boundary.
    const macroMatch = trimmed.match(/(^|\s)\/([a-z]+)$/i);
    if (macroMatch) {
      const token = macroMatch[2].toLowerCase();
      if (Object.prototype.hasOwnProperty.call(MACROS, token)) {
        const prefix = trimmed.slice(0, trimmed.length - macroMatch[0].length);
        return { kind: "macro", name: token, prefix };
      }
    }
    return null;
  }

  function onInput(e) {
    if (suppressInput) return;

    const el = e.target;
    // Ignore events originating inside our own modal (Shadow DOM, composed).
    if (modalHost && typeof e.composedPath === "function") {
      if (e.composedPath().includes(modalHost)) return;
    }
    if (!isEditable(el)) return;
    if (pending.has(el)) return;

    const hit = detect(readText(el));
    if (!hit) return;

    lastEditable = el;

    if (hit.kind === "macro") {
      const glyph = MACROS[hit.name];
      writeText(el, hit.prefix ? hit.prefix + " " + glyph : glyph);
      return;
    }

    switch (hit.name) {
      case "meet":
        return runMeet(el);
      case "help":
        clearComposer(el);
        return openHelp();
      case "consent":
        clearComposer(el);
        return openConsent(el);
      case "time":
        clearComposer(el);
        return openTime(el, hit.arg);
      case "poll":
        clearComposer(el);
        return openPoll(el, hit.arg);
      case "flip":
        return writeText(el, FLIP_ART);
    }
  }

  document.addEventListener("input", onInput, true);

  // -------------------------------------------------------------------------
  // /meet — unchanged behaviour: placeholder, ask the service worker, swap in
  // -------------------------------------------------------------------------

  function runMeet(el) {
    pending.add(el);
    writeText(el, PLACEHOLDER);

    // Settle exactly once. Without this, a synchronous throw from
    // sendMessage (the content script is "orphaned" when the extension is
    // reloaded while this page stays open) would leave `el` stuck in
    // `pending` forever — bricking every command on that composer until the
    // page is reloaded. The timeout is a backstop for a dropped channel.
    let settled = false;
    const finish = (text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pending.delete(el);
      if (text != null) writeText(el, text);
    };
    const timer = setTimeout(
      () => finish("Meet error: timed out — try again"),
      25000
    );

    try {
      chrome.runtime.sendMessage({ type: "create-meet" }, (response) => {
        if (chrome.runtime.lastError) {
          finish("Meet error: " + chrome.runtime.lastError.message);
          return;
        }
        if (!response) {
          finish("Meet error: no response from extension");
          return;
        }
        if (response.ok) finish(response.uri);
        else finish("Meet error: " + (response.error || "unknown"));
      });
    } catch (err) {
      finish("Meet error: " + (err?.message || err));
    }
  }

  // -------------------------------------------------------------------------
  // Modal framework (Shadow DOM so the host page can't restyle us, and we
  // can't leak styles into the host page)
  // -------------------------------------------------------------------------

  let modalHost = null;
  let shadow = null;
  let keyHandler = null;
  const KEY_EVENTS = ["keydown", "keyup", "keypress"];

  const MODAL_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont,
        "Segoe UI", system-ui, sans-serif; }
    .overlay {
      position: fixed; inset: 0; z-index: 2147483647;
      background: rgba(0,0,0,.45);
      display: flex; align-items: center; justify-content: center;
      padding: 24px;
    }
    .dialog {
      background: #fff; color: #1a1a1a; width: 100%; max-width: 460px;
      max-height: 86vh; overflow: auto; border-radius: 10px;
      box-shadow: 0 12px 48px rgba(0,0,0,.3);
      animation: pop .12s ease-out;
    }
    @keyframes pop { from { transform: scale(.97); opacity: .6 } to { transform: scale(1); opacity: 1 } }
    .head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 16px 20px; border-bottom: 1px solid #eee;
    }
    .head h2 { font-size: 16px; font-weight: 600; margin: 0; }
    .x {
      border: 0; background: transparent; font-size: 20px; line-height: 1;
      cursor: pointer; color: #999; padding: 2px 6px; border-radius: 4px;
    }
    .x:hover { color: #333; background: #f1f1f1; }
    .body { padding: 18px 20px; }
    .body p { margin: 0 0 12px; line-height: 1.55; color: #333; font-size: 14px; }
    .muted { color: #888; font-size: 12px; }
    code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: .9em;
      background: #eef0f4; padding: 1px 5px; border-radius: 3px; }
    .cmd-list { list-style: none; padding: 0; margin: 0; }
    .cmd-list li { display: flex; gap: 12px; padding: 9px 0; border-bottom: 1px solid #f2f2f2; font-size: 14px; }
    .cmd-list li:last-child { border-bottom: 0; }
    .cmd-list .u { font-family: ui-monospace, Menlo, monospace; color: #2641e8;
      min-width: 96px; font-weight: 600; }
    .cmd-list .d { color: #444; }
    label { display: block; font-size: 13px; color: #555; margin: 12px 0 5px; font-weight: 500; }
    input[type=text], select {
      width: 100%; padding: 9px 12px; border: 1px solid #ccc; border-radius: 6px;
      font-size: 14px; background: #fff; color: #1a1a1a;
    }
    input[type=text]:focus, select:focus {
      outline: none; border-color: #2641e8; box-shadow: 0 0 0 2px rgba(38,65,232,.15);
    }
    .opt-row { display: flex; gap: 8px; margin-bottom: 6px; align-items: center; }
    .opt-row input { flex: 1; }
    .opt-row button, .link-btn {
      border: 1px solid #ddd; background: transparent; border-radius: 6px;
      padding: 8px 10px; cursor: pointer; font-size: 13px; color: #666;
    }
    .opt-row button:hover { color: #c33; border-color: #c33; }
    .link-btn:hover { border-color: #2641e8; color: #2641e8; }
    .result {
      background: #f7f8fb; border: 1px solid #e7e9f0; border-radius: 8px;
      padding: 12px 14px; font-size: 14px; line-height: 1.7; color: #1a1a1a;
      margin-top: 12px; word-break: break-word;
    }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
    .btn {
      border: 0; border-radius: 6px; padding: 9px 18px; font-size: 14px;
      font-weight: 500; cursor: pointer;
    }
    .btn.primary { background: #2641e8; color: #fff; }
    .btn.primary:hover { background: #1f33b8; }
    .btn.primary:disabled { background: #b9c0e8; cursor: not-allowed; }
    .btn.ghost { background: #f1f1f3; color: #444; }
    .btn.ghost:hover { background: #e7e7ea; }
    .consent-box {
      display: flex; gap: 10px; align-items: flex-start; margin: 14px 0 4px;
      padding: 12px 14px; background: #fbfbfc; border: 1px solid #eee; border-radius: 8px;
    }
    .consent-box input { margin-top: 2px; }
    .consent-box label { margin: 0; font-size: 14px; color: #222; font-weight: 500; }
    .badge { display: inline-block; font-size: 11px; font-weight: 600; color: #b26a00;
      background: #fff4e0; border-radius: 4px; padding: 2px 7px; margin-bottom: 12px; }
  `;

  function ensureHost() {
    if (modalHost && document.documentElement.contains(modalHost)) return;
    modalHost = document.createElement("div");
    modalHost.id = "flip-meet-modal-host";
    shadow = modalHost.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = MODAL_CSS;
    shadow.appendChild(style);
    document.documentElement.appendChild(modalHost);
  }

  function closeModal() {
    if (keyHandler) {
      for (const t of KEY_EVENTS)
        window.removeEventListener(t, keyHandler, true);
      keyHandler = null;
    }
    if (shadow) {
      const existing = shadow.querySelector(".overlay");
      if (existing) existing.remove();
    }
    refocus(lastEditable);
  }

  // build(body, close) populates the dialog body and may wire buttons.
  function openModal(title, build) {
    ensureHost();
    closeModal();

    const overlay = document.createElement("div");
    overlay.className = "overlay";

    const dialog = document.createElement("div");
    dialog.className = "dialog";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("tabindex", "-1");

    const head = document.createElement("div");
    head.className = "head";
    const h2 = document.createElement("h2");
    h2.textContent = title;
    const x = document.createElement("button");
    x.className = "x";
    x.setAttribute("aria-label", "Close");
    x.textContent = "×";
    x.addEventListener("click", closeModal);
    head.append(h2, x);

    const body = document.createElement("div");
    body.className = "body";

    dialog.append(head, body);
    overlay.appendChild(dialog);

    // Backdrop click closes; clicks inside the dialog do not.
    overlay.addEventListener("mousedown", (ev) => {
      if (ev.target === overlay) closeModal();
    });

    // Belt-and-braces for non-keyboard events: swallow modal-originated
    // pointer/mouse and input events in the bubble phase so the host page
    // can't react to them. Keyboard events are handled separately in the
    // capture phase below (the host registers shortcuts in capture, which a
    // bubble swallow can't reach). We do NOT swallow "input"/"beforeinput"
    // here at capture because our own field listeners need them.
    const swallow = (ev) => ev.stopPropagation();
    [
      "beforeinput", "input",
      "click", "dblclick", "mousedown", "mouseup",
      "pointerdown", "pointerup"
    ].forEach((type) => overlay.addEventListener(type, swallow));

    function focusables() {
      return Array.from(
        dialog.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      );
    }

    // Capture-phase key handler on window. The host page (Flip) registers
    // global single-key shortcuts (e.g. "n" opens "new message"), and because
    // our inputs live in a Shadow DOM the host's "is an input focused?" guard
    // is defeated by event retargeting — so those shortcuts fire on modal
    // keystrokes. We must intercept in the CAPTURE phase (window is first in
    // the path) to beat a host listener on document/window, and call ONLY
    // stopPropagation — never preventDefault — so the character still types
    // into our field and the field's own "input" listeners still fire.
    keyHandler = (ev) => {
      if (typeof ev.composedPath === "function" &&
          !ev.composedPath().includes(modalHost)) {
        return; // not our event; leave the host page alone
      }
      ev.stopPropagation();
      if (ev.type !== "keydown") return;

      if (ev.key === "Escape") {
        closeModal();
        return;
      }
      if (ev.key === "Tab") {
        // Trap focus inside the dialog so Tab can't reach host-page controls
        // hidden behind the overlay.
        const f = focusables();
        if (f.length === 0) {
          ev.preventDefault();
          dialog.focus();
          return;
        }
        const first = f[0];
        const last = f[f.length - 1];
        const active = shadow.activeElement;
        if (!active || !dialog.contains(active)) {
          ev.preventDefault();
          first.focus();
        } else if (ev.shiftKey && active === first) {
          ev.preventDefault();
          last.focus();
        } else if (!ev.shiftKey && active === last) {
          ev.preventDefault();
          first.focus();
        }
      }
    };
    for (const t of KEY_EVENTS) window.addEventListener(t, keyHandler, true);

    shadow.appendChild(overlay);
    build(body, closeModal);

    // Seed focus into the dialog (first interactive control in the body,
    // else the dialog itself for AT).
    const seed = body.querySelector(
      'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    );
    (seed || dialog).focus();
    return closeModal;
  }

  function el(tag, props, ...kids) {
    const node = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (k === "class") node.className = v;
        else if (k === "text") node.textContent = v;
        else if (k.startsWith("on") && typeof v === "function")
          node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      }
    }
    for (const kid of kids) if (kid != null) node.append(kid);
    return node;
  }

  // -------------------------------------------------------------------------
  // /help
  // -------------------------------------------------------------------------

  function openHelp() {
    openModal("Flip Meet — commands", (body) => {
      body.append(
        el("p", {
          text:
            "Type a command into the chat composer. Most replace the text; some open a window."
        })
      );
      const ul = el("ul", { class: "cmd-list" });
      for (const c of COMMAND_INFO) {
        ul.append(
          el(
            "li",
            null,
            el("span", { class: "u", text: c.usage }),
            el("span", { class: "d", text: c.desc })
          )
        );
      }
      body.append(ul);
    });
  }

  // -------------------------------------------------------------------------
  // /consent — demo recording-consent dialog (US / Wiretap Act). Not wired
  // into anything; it's a UI mock.
  // -------------------------------------------------------------------------

  function openConsent(composer) {
    openModal("Recording consent", (body, close) => {
      body.append(el("span", { class: "badge", text: "DEMO" }));
      body.append(
        el("p", {
          text:
            "This conversation may be recorded and transcribed for note-taking."
        }),
        el("p", {
          text:
            "Under the U.S. federal Wiretap Act (18 U.S.C. §§ 2510–2522) and " +
            "state all-party-consent laws (e.g. California, Florida, Illinois), " +
            "recording a conversation may require the consent of every participant."
        })
      );

      const checkbox = el("input", { type: "checkbox", id: "consent-cb" });
      const box = el(
        "div",
        { class: "consent-box" },
        checkbox,
        el("label", {
          for: "consent-cb",
          text:
            "I consent to this conversation being recorded and processed."
        })
      );
      body.append(box);

      const approve = el("button", {
        class: "btn primary",
        text: "Approve",
        disabled: "true"
      });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) approve.removeAttribute("disabled");
        else approve.setAttribute("disabled", "true");
      });
      approve.addEventListener("click", () => {
        if (!checkbox.checked) return;
        close();
      });

      body.append(el("div", { class: "actions" }, approve));
      body.append(
        el("p", {
          class: "muted",
          text:
            "Demo only — this dialog is a mock and is not connected to any " +
            "recording system. Not legal advice."
        })
      );
    });
  }

  // -------------------------------------------------------------------------
  // /time — timezone helper (pure logic below is unit-tested in tools/)
  // -------------------------------------------------------------------------

  const TIME_ZONES = [
    { label: "Berlin", tz: "Europe/Berlin" },
    { label: "London", tz: "Europe/London" },
    { label: "New York", tz: "America/New_York" },
    { label: "San Francisco", tz: "America/Los_Angeles" },
    { label: "Singapore", tz: "Asia/Singapore" }
  ];

  const TZ_ALIASES = {
    cet: "Europe/Berlin", cest: "Europe/Berlin", berlin: "Europe/Berlin",
    bst: "Europe/London", gmt: "Europe/London", london: "Europe/London", uk: "Europe/London",
    et: "America/New_York", est: "America/New_York", edt: "America/New_York",
    ny: "America/New_York", nyc: "America/New_York", eastern: "America/New_York",
    pt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles",
    sf: "America/Los_Angeles", la: "America/Los_Angeles", pacific: "America/Los_Angeles",
    sgt: "Asia/Singapore", singapore: "Asia/Singapore",
    ist: "Asia/Kolkata", india: "Asia/Kolkata",
    utc: "UTC"
  };

  function localTz() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch (_) {
      return "UTC";
    }
  }

  // Offset (ms) between a UTC instant and the given zone's wall clock.
  function zoneOffsetMs(utcMs, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const parts = {};
    for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
    let hour = parts.hour === "24" ? 0 : Number(parts.hour);
    const asUtc = Date.UTC(
      Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      hour, Number(parts.minute), Number(parts.second)
    );
    return asUtc - utcMs;
  }

  // Calendar parts of a UTC instant as seen in a zone.
  function partsInZone(utcMs, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit"
    });
    const p = {};
    for (const part of dtf.formatToParts(new Date(utcMs))) p[part.type] = part.value;
    return { y: Number(p.year), mo: Number(p.month), d: Number(p.day) };
  }

  // Convert a wall-clock time in a zone to a UTC instant (ms).
  function wallToUtcMs(y, mo, d, h, mi, timeZone) {
    const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
    // Two passes so the offset converges to its value at the TRUE instant,
    // not the guessed one. A single pass mis-converts wall times within an
    // hour of a DST transition (e.g. 1:30 AM on spring-forward day samples
    // the post-transition offset and lands an hour off).
    const o1 = zoneOffsetMs(guess, timeZone);
    const o2 = zoneOffsetMs(guess - o1, timeZone);
    return guess - o2;
  }

  function parseTimeArg(arg) {
    let sourceTz = null;
    let str = (arg || "").trim();
    if (str) {
      const tokens = str.split(/\s+/);
      const last = tokens[tokens.length - 1].toLowerCase().replace(/[.,]/g, "");
      if (TZ_ALIASES[last]) {
        sourceTz = TZ_ALIASES[last];
        tokens.pop();
        str = tokens.join(" ");
      }
    }
    let hasTime = false, hour = 0, minute = 0;
    const m = str.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i);
    if (m) {
      hour = Number(m[1]);
      minute = m[2] ? Number(m[2]) : 0;
      const ap = (m[3] || "").toLowerCase().replace(/\./g, "");
      if (ap === "pm" && hour < 12) hour += 12;
      if (ap === "am" && hour === 12) hour = 0;
      hasTime = hour <= 23 && minute <= 59;
    }
    return { hasTime, hour, minute, sourceTz };
  }

  function fmtTime(utcMs, timeZone) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone, hour: "numeric", minute: "2-digit", hour12: true
    }).format(new Date(utcMs));
  }

  // Build the one-line summary. `nowMs` is injectable for testing.
  function buildTimeLine(parsed, nowMs) {
    const src = parsed.sourceTz || localTz();
    let instant;
    if (parsed.hasTime) {
      const today = partsInZone(nowMs, src);
      instant = wallToUtcMs(today.y, today.mo, today.d, parsed.hour, parsed.minute, src);
    } else {
      instant = nowMs;
    }
    const srcDate = partsInZone(instant, src);
    const pieces = TIME_ZONES.map((z) => {
      const t = fmtTime(instant, z.tz);
      const zd = partsInZone(instant, z.tz);
      let mark = "";
      const cmp = zd.y * 10000 + zd.mo * 100 + zd.d - (srcDate.y * 10000 + srcDate.mo * 100 + srcDate.d);
      if (cmp > 0) mark = " (+1)";
      else if (cmp < 0) mark = " (−1)";
      return `${t} ${z.label}${mark}`;
    });
    return "🕒 " + pieces.join(" · ");
  }

  function openTime(composer, arg) {
    openModal("Time across timezones", (body, close) => {
      body.append(
        el("p", {
          text: "Enter a time (e.g. 3pm, 15:30, 9am ET) — or leave blank for now."
        })
      );
      const input = el("input", {
        type: "text",
        placeholder: "now",
        value: arg || ""
      });
      body.append(el("label", { text: "Time" }), input);

      const result = el("div", { class: "result" });
      body.append(result);

      const insertBtn = el("button", { class: "btn primary", text: "Insert" });
      const cancelBtn = el("button", { class: "btn ghost", text: "Cancel", onclick: close });

      function update() {
        const line = buildTimeLine(parseTimeArg(input.value), Date.now());
        result.textContent = line;
        return line;
      }
      input.addEventListener("input", update);
      insertBtn.addEventListener("click", () => {
        const line = update();
        writeText(composer, line);
        close();
      });

      body.append(el("div", { class: "actions" }, cancelBtn, insertBtn));
      update();
    });
  }

  // -------------------------------------------------------------------------
  // /poll
  // -------------------------------------------------------------------------

  const NUM_EMOJI = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
  const MAX_OPTS = 10;

  function buildPollText(question, options) {
    const clean = options.map((o) => o.trim()).filter(Boolean).slice(0, MAX_OPTS);
    const lines = clean.map((o, i) => `${NUM_EMOJI[i]} ${o}`);
    return `📊 ${question.trim()}\n\n${lines.join("\n")}`;
  }

  function openPoll(composer, arg) {
    openModal("Build a poll", (body, close) => {
      const q = el("input", { type: "text", placeholder: "What should we…?", value: arg || "" });
      body.append(el("label", { text: "Question" }), q);

      body.append(el("label", { text: "Options" }));
      const optWrap = el("div", {});
      body.append(optWrap);

      const insertBtn = el("button", { class: "btn primary", text: "Insert poll", disabled: "true" });

      function rows() {
        return Array.from(optWrap.querySelectorAll("input")).map((i) => i.value);
      }
      function validate() {
        const filled = rows().filter((v) => v.trim()).length;
        if (q.value.trim() && filled >= 2) insertBtn.removeAttribute("disabled");
        else insertBtn.setAttribute("disabled", "true");
      }
      function addRow(initial) {
        if (optWrap.children.length >= MAX_OPTS) return;
        const input = el("input", { type: "text", placeholder: `Option ${optWrap.children.length + 1}`, value: initial || "" });
        input.addEventListener("input", validate);
        const remove = el("button", {
          type: "button",
          text: "✕",
          onclick: () => {
            if (optWrap.children.length <= 2) return;
            row.remove();
            validate();
          }
        });
        const row = el("div", { class: "opt-row" }, input, remove);
        optWrap.append(row);
      }
      addRow();
      addRow();

      const addBtn = el("button", {
        class: "link-btn",
        type: "button",
        text: "+ Add option",
        onclick: () => {
          addRow();
          validate();
        }
      });
      body.append(addBtn);

      q.addEventListener("input", validate);
      insertBtn.addEventListener("click", () => {
        writeText(composer, buildPollText(q.value, rows()));
        close();
      });
      const cancelBtn = el("button", { class: "btn ghost", text: "Cancel", onclick: close });

      body.append(el("div", { class: "actions" }, cancelBtn, insertBtn));
    });
  }

  // Expose pure helpers for the Node test harness (no-op in the browser).
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { detect, parseTimeArg, buildTimeLine, buildPollText, MACROS };
  }

  try {
    console.log(
      "flip-meet content script loaded — v" +
        chrome.runtime.getManifest().version
    );
  } catch (_) {
    console.log("flip-meet content script loaded");
  }
})();
