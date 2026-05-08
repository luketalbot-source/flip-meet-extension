# Privacy Policy — Flip Meet

**Last updated:** 2026-05-08

Flip Meet is a Chrome extension that turns the text `/meet`, typed into a chat composer on Flip, into a Google Meet link.

## Data we collect

**None.** The extension does not collect, store, transmit, or share any personal data.

## How the extension works

When you type `/meet` in a Flip chat composer, the extension:

1. Opens `https://meet.google.com/new` in a temporary minimized window in your own browser.
2. Reads the URL Google redirects that window to (a fresh meeting URL like `https://meet.google.com/abc-defg-hij`).
3. Writes that URL into your chat composer.
4. Closes the temporary window.

All of these steps happen entirely within your own browser. The extension does not communicate with any server operated by the developer.

## What the extension cannot see

- Your Flip chat messages (the extension only writes to the composer; it does not read message history).
- Your Google account credentials (it never touches Google authentication directly — it relies on your existing browser session with Google).
- Your browsing activity outside the configured Flip domains.

## Permissions we request

- **Host access to `meet.google.com`** — to open the redirect window and read the resulting meeting URL.
- **Host access to `staging.flipnext.de` and `show.flipnext.de`** — to inject the content script that detects `/meet` in chat composers.

## Contact

Questions or concerns: open an issue at https://github.com/luketalbot-source/flip-meet-extension/issues
