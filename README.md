# Flip Meet

Chrome extension. Type `/meet` in a Flip chat composer; it gets replaced with a fresh Google Meet link. Press Enter to send.

Currently scoped to `https://staging.flipnext.de/chats/*`.

## One-time setup

The extension can't create real Meet links until you complete steps 1–4 below. Without them, `/meet` will show an error.

### 1. Create a Google Cloud project

1. Go to https://console.cloud.google.com
2. Create a new project (e.g. `flip-meet-extension`).

### 2. Enable the Google Meet API

In the project: APIs & Services → Library → search "Google Meet API" → Enable.

### 3. Configure the OAuth consent screen

APIs & Services → OAuth consent screen.

- **User type:** Internal if your Google account belongs to the Workspace org that owns flipnext.de (no app verification needed). Otherwise External + Testing mode.
- **Scopes:** add `https://www.googleapis.com/auth/meetings.space.created`.

### 4. Create the OAuth client + pin the extension ID

The OAuth client is type "Chrome Extension," which requires a stable extension ID. Easiest path:

1. Load the extension unpacked once (see "Loading the extension" below) to get an auto-generated ID from `chrome://extensions`.
2. Pin that ID by capturing the extension's public key:
   - Pack the extension once (`chrome://extensions` → Pack extension → point at the project folder, leave private key blank). Chrome will generate a `.pem` file alongside it.
   - On the next load, take the public key from the generated `.crx` (or use `openssl` on the `.pem` to derive it) and add it to `manifest.json` as `"key": "<base64 public key>"`. This pins the extension ID.
3. In Google Cloud → APIs & Services → Credentials → Create credentials → OAuth client ID → Application type "Chrome Extension." Paste the pinned extension ID.
4. Copy the resulting client ID and replace `REPLACE_WITH_YOUR_OAUTH_CLIENT_ID...` in `manifest.json`.

### 5. Workspace admin check (skip if you're solo testing)

The `meetings.space.created` scope may be flagged as restricted by your Workspace admin. If so, either request approval, or fall back to the Calendar API (`events.insert` with `conferenceData.createRequest`) — same outcome, slightly different code in `background.js`.

## Loading the extension

1. Open `chrome://extensions`.
2. Toggle "Developer mode" on.
3. Click "Load unpacked" → select this folder.
4. Open https://staging.flipnext.de/chats/&lt;any chat id&gt;.
5. Type `/meet` in the message composer.

## How it works

- `content.js` listens for `input` events on any editable element on the page. When the trimmed text equals `/meet`, it replaces the input with `Creating Meet link…` and asks the service worker for a Meet space.
- `background.js` calls `chrome.identity.getAuthToken` (interactive on first run) and `POST https://meet.googleapis.com/v2/spaces`. Returns `meetingUri`.
- `content.js` swaps the placeholder for the URI. The user presses Enter to send.

The extension does **not** auto-send the message — that's deliberate, in case the API is slow or the response is unexpected.

## Files

```
manifest.json   Permissions, host matches, OAuth config
background.js   Service worker: chrome.identity + Meet API
content.js      Detects /meet and rewrites the composer
```

## Troubleshooting

- **"Meet error: bad client id"** — `manifest.json` still has the placeholder client ID, or the OAuth client wasn't created with the right extension ID.
- **"Meet error: 403"** — Workspace scope restriction; see step 5 above.
- **`/meet` doesn't trigger** — open DevTools console on the Flip page, confirm "flip-meet content script loaded" is logged. If not, the host match is wrong (production domain not yet supported).
- **Link replaces but doesn't send when you press Enter** — Flip's composer may use a framework-managed editor (Slate, Lexical) where programmatic edits get re-rendered. The `execCommand("insertText")` path is the most compatible; if it still misbehaves, file an issue and we'll add a framework-specific path.
