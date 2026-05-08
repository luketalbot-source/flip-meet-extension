# Flip Meet

Chrome extension. Type `/meet` in a chat composer; it gets replaced with a fresh Google Meet link. Press Enter to send.

Ships pre-configured for `staging.flipnext.de` and `show.flipnext.de`. Other sites can be added via the options page.

## Setup

No Google Cloud project, no OAuth, no API keys. Two steps:

1. Open `chrome://extensions`, toggle Developer mode on, click "Load unpacked," and select this folder.
2. Make sure you're signed into Google in this browser. That's it.

## Using it

1. Open `https://staging.flipnext.de/chats/<any chat id>` (or `show.flipnext.de`, or any custom site you've added).
2. Type `/meet` in the message composer (just those five characters — nothing else).
3. Wait ~1 second. A meet.google.com tab briefly opens in the background and closes.
4. The composer now contains a real `https://meet.google.com/...` link. Press Enter to send.

## Adding more sites

To activate `/meet` on additional sites (e.g. a new Flip environment, another chat tool that uses `/chats/*` URLs):

1. Right-click the Flip Meet extension icon → **Options**, or visit `chrome://extensions` and click "Details" → "Extension options."
2. Enter the hostname (e.g. `prod.flipnext.de`) and click **Add site**.
3. Chrome will prompt you to grant permission for that origin. Approve.
4. Refresh any open chat page on that site to activate.

The extension matches `/chats/*` paths on each allowed site — same as the defaults.

## How it works

The extension does **not** call any Google API. It relies on `https://meet.google.com/new`, which Google redirects to a fresh meeting URL when you're signed in.

- `content.js` listens for `input` events on any editable element on the page. When the trimmed text equals `/meet`, it replaces the input with `Creating Meet link…` and asks the service worker for a Meet space.
- `background.js` opens `https://meet.google.com/new` in a backgrounded tab, watches `chrome.tabs.onUpdated` for the URL to redirect to a meeting pattern (`abc-defg-hij`), grabs that URL, and closes the tab.
- `content.js` swaps the placeholder for the URI. The user presses Enter to send.
- For sites added via the options page, `background.js` uses `chrome.scripting.registerContentScripts` to dynamically register `content.js` on `/chats/*` paths of the granted origin.

The extension does **not** auto-send the message — that's deliberate, in case the redirect is slow or returns something unexpected.

## Files

```
manifest.json   Permissions, host matches, content script registration
background.js   Service worker: Meet redirect handler + dynamic content scripts
content.js      Detects /meet in the composer and rewrites it
options.html    Settings page UI
options.css     Settings page styling
options.js      Settings page logic (add/remove host permissions)
```

## Trade-offs vs. the Meet API approach

This is the "no Google Cloud setup" version. Compared to using the official Meet Spaces API:

- **Pros:** zero setup, works for anyone signed into Google, no Workspace admin approval, ships to anyone in seconds.
- **Cons:** a meet.google.com tab briefly opens in the background; ~1–2s slower than a direct API call; depends on `meet.google.com/new` continuing to redirect the way it does today (stable for years, but not a contractual API).

If `meet.google.com/new` ever stops redirecting reliably, swap `background.js` for the Meet Spaces API version (Google Cloud project + OAuth client ID, then a `POST` to `https://meet.googleapis.com/v2/spaces`). The contract between `content.js` and `background.js` is unchanged.

## Troubleshooting

- **"Timed out waiting for Meet URL — are you signed in to Google?"** — exactly what it says. Sign into Google in any tab, then try again.
- **`/meet` doesn't fire** — open DevTools console on the chat page, confirm "flip-meet content script loaded" is logged. If not, the site isn't in the allowed list (check the options page) or the URL doesn't match `/chats/*`.
- **Stuck at "Creating Meet link…"** — open the service worker console (`chrome://extensions` → click "service worker" link on the Flip Meet card). The `[flip-meet]` log lines will show the last URL the redirect tab settled on.
- **Link replaces but doesn't send when you press Enter** — the chat composer may use a framework-managed editor (Slate, Lexical) where programmatic edits get re-rendered. The `execCommand("insertText")` path is the most compatible; if it still misbehaves, file an issue.
