chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "create-meet") return;
  createMeetViaRedirect().then(
    (uri) => sendResponse({ ok: true, uri }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) })
  );
  return true;
});

// A real Meet URL looks like https://meet.google.com/abc-defg-hij
// Three segments of 3–4 lowercase letters separated by dashes.
const MEETING_URL_RE =
  /^https:\/\/meet\.google\.com\/([a-z]{3,4}-[a-z]{3,4}-[a-z]{3,4})(?:[/?]|$)/;

const TIMEOUT_MS = 15000;

async function createMeetViaRedirect() {
  // Open a minimized popup window pointing at meet.google.com/new.
  // Google redirects the URL to a fresh meeting URL when the user is signed in.
  // Note: Chrome rejects width/height when state is "minimized" — they're
  // mutually exclusive, so we omit dimensions here.
  const win = await chrome.windows.create({
    url: "https://meet.google.com/new",
    focused: false,
    state: "minimized",
    type: "popup"
  });

  const tabId = win.tabs?.[0]?.id;
  if (!tabId) throw new Error("Could not open Meet tab");

  try {
    return await waitForMeetingUrl(tabId, TIMEOUT_MS);
  } finally {
    chrome.windows.remove(win.id).catch(() => {});
  }
}

function waitForMeetingUrl(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    let done = false;

    const onUpdated = (updatedTabId, changeInfo, tab) => {
      if (done || updatedTabId !== tabId) return;
      const url = changeInfo.url || tab?.url || "";
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
      reject(new Error("Meet tab closed before redirect completed"));
    };

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      cleanup();
      reject(
        new Error(
          "Timed out waiting for Meet URL — are you signed in to Google in this browser?"
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
