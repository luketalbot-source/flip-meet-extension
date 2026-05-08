# Flip Meet

Chrome extension. Type `/meet` in a Flip chat composer; it gets replaced with a fresh Google Meet link. Press Enter to send.

Currently scoped to `https://staging.flipnext.de/chats/*`.

## Setup

No Google Cloud project, no OAuth, no API keys. Two steps:

1. Open `chrome://extensions`, toggle Developer mode on, click "Load unpacked," and select this folder.
2. Make sure you're signed into Google in this browser. That's it.

## Using it

1. Open https://staging.flipnext.de/chats/&lt;any chat id&gt;
2. Type `/meet` in the message composer (just those five characters — nothing else)
3. Wait ~1–2 seconds. A small minimized window flashes in the corner while the extension fetches a meeting URL, then closes.
4. The composer now contains a real `https://meet.google.com/...` link. Press Enter to send.

## How it works

The extension does **not** call any Google API. Instead, it relies on `https://meet.google.com/new`, which Google redirects to a fresh meeting URL when you're signed in.

- `content.js` listens for `input` events on any editable element on the page. When the trimmed text equals `/meet`, it replaces the input with `Creating Meet link…` and asks the service worker for a Meet space.
- `background.js` opens `https://meet.google.com/new` in a minimized popup window, watches `chrome.tabs.onUpdated` for the URL to redirect to a meeting pattern (`abc-defg-hij`), grabs that URL, and closes the window.
- `content.js` swaps the placeholder for the URI. The user presses Enter to send.

The extension does **not** auto-send the message — that's deliberate, in case the redirect is slow or returns something unexpected.

## Files

```
manifest.json   Permissions, host matches, content script registration
background.js   Service worker: opens meet.google.com/new and grabs the redirect URL
content.js      Detects /meet in the composer and rewrites it
```

## Trade-offs vs. the Meet API approach

This is the "no Google Cloud setup" version. Compared to using the official Meet Spaces API:

- **Pros:** zero setup, works for anyone signed into Google, no Workspace admin approval, ships to anyone in seconds.
- **Cons:** a small popup window flashes briefly when triggered; ~1–2s slower than a direct API call; depends on `meet.google.com/new` continuing to redirect the way it does today (stable for years, but not a contractual API).

If `meet.google.com/new` ever stops redirecting reliably, swap `background.js` for the Meet Spaces API version (Google Cloud project + OAuth client ID, then a `POST` to `https://meet.googleapis.com/v2/spaces`). The contract between `content.js` and `background.js` is unchanged.

## Troubleshooting

- **"Timed out waiting for Meet URL — are you signed in to Google in this browser?"** — exactly what it says. Sign into Google in any tab, then try again.
- **The `/meet` trigger doesn't fire** — open DevTools console on the Flip page, confirm "flip-meet content script loaded" is logged. If not, the host match is wrong (production domain not yet supported).
- **Link replaces but doesn't send when you press Enter** — Flip's composer may use a framework-managed editor (Slate, Lexical) where programmatic edits get re-rendered. The `execCommand("insertText")` path is the most compatible; if it still misbehaves, file an issue and we'll add a framework-specific path.
- **A popup window briefly visible instead of minimized** — Chrome occasionally ignores `state: "minimized"` if no other window is focused. Cosmetic only; the URL is still grabbed correctly.
