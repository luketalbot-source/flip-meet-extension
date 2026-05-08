chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "create-meet") return;
  createMeetSpace().then(
    (uri) => {
      console.log("[flip-meet] success:", uri);
      sendResponse({ ok: true, uri });
    },
    (err) => {
      console.error("[flip-meet] failed:", err);
      sendResponse({ ok: false, error: String(err?.message ?? err) });
    }
  );
  return true;
});

// A real Meet URL looks like https://meet.google.com/abc-defg-hij
// Three segments of 3–4 lowercase letters separated by dashes.
const MEETING_URL_RE =
  /^https:\/\/meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})(?:[/?#]|$)/;

const TIMEOUT_MS = 15000;

async function createMeetSpace() {
  // Open meet.google.com/new in a background tab in the user's current
  // window. Minimized popup windows are subject to Chrome loading
  // throttling, which is why earlier attempts sometimes hung at
  // "Creating Meet link…". Background tabs in a focused window load at
  // full speed and are immediately closed once we grab the URL.
  console.log("[flip-meet] opening meet.google.com/new in background tab");
  const tab = await chrome.tabs.create({
    url: "https://meet.google.com/new",
    active: false
  });
  console.log("[flip-meet] tab created:", tab.id);

  let lastSeenUrl = "";

  try {
    const uri = await waitForMeetingUrl(tab.id, TIMEOUT_MS, (u) => {
      lastSeenUrl = u;
    });
    return uri;
  } catch (err) {
    err.message += ` (last URL seen: ${lastSeenUrl || "<none>"})`;
    throw err;
  } finally {
    chrome.tabs.remove(tab.id).catch((e) =>
      console.warn("[flip-meet] failed to close meet tab:", e)
    );
  }
}

function waitForMeetingUrl(tabId, timeoutMs, onUrl) {
  return new Promise((resolve, reject) => {
    let done = false;

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (done || updatedTabId !== tabId) return;
      const url = changeInfo.url || tab?.url || "";
      if (url) {
        onUrl(url);
        console.log("[flip-meet] tab url:", url);
      }
      const match = url.match(MEETING_URL_RE);
      if (match) {
        done = true;
        cleanup();
        resolve(`https://meet.google.com/${match[1]}`);
      }
    };

    const onRemoved = (removedTabId) => {
      if (done || removedTabId !== tabId) return;
      done = true;
      cleanup();
      reject(new Error("Meet tab was closed before it redirected"));
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(
        new Error(
          "Timed out waiting for Meet URL — are you signed in to Google?"
        )
      );
    }, timeoutMs);

    function cleanup() {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
      clearTimeout(timer);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
  });
}

// ---------------------------------------------------------------------------
// Dynamic content script registration for user-added optional hosts.
//
// Static content scripts (in manifest.json) cover the default Flip sites.
// When the user adds a custom site via options.html, we register a separate
// content script for that origin scoped to the /chats/* path.
// ---------------------------------------------------------------------------

const STATIC_ORIGINS = new Set([
  "https://meet.google.com/*",
  "https://staging.flipnext.de/*",
  "https://show.flipnext.de/*"
]);

const CUSTOM_SCRIPT_ID = "flip-meet-custom-content";

async function syncCustomContentScripts() {
  const perms = await chrome.permissions.getAll();
  const customOrigins = (perms.origins || [])
    .filter((o) => o.startsWith("https://"))
    .filter((o) => !STATIC_ORIGINS.has(o));

  // Convert "https://prod.flipnext.de/*" -> "https://prod.flipnext.de/chats/*"
  const matches = customOrigins.map(
    (o) => o.replace(/\/\*$/, "") + "/chats/*"
  );

  // Always unregister first; idempotent.
  try {
    await chrome.scripting.unregisterContentScripts({
      ids: [CUSTOM_SCRIPT_ID]
    });
  } catch (_) {
    // No existing registration; fine.
  }

  if (matches.length === 0) {
    console.log("[flip-meet] no custom sites granted; nothing to register");
    return;
  }

  await chrome.scripting.registerContentScripts([
    {
      id: CUSTOM_SCRIPT_ID,
      matches,
      js: ["content.js"],
      runAt: "document_idle"
    }
  ]);
  console.log("[flip-meet] registered custom content script for:", matches);
}

chrome.runtime.onInstalled.addListener(syncCustomContentScripts);
chrome.runtime.onStartup.addListener(syncCustomContentScripts);
chrome.permissions.onAdded.addListener(syncCustomContentScripts);
chrome.permissions.onRemoved.addListener(syncCustomContentScripts);
