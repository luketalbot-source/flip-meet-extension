chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "create-meet") return;
  createMeetSpace().then(
    (uri) => sendResponse({ ok: true, uri }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) })
  );
  return true;
});

async function createMeetSpace() {
  const token = await getAuthToken(true);
  let res = await callMeetApi(token);
  if (res.status === 401) {
    await removeCachedToken(token);
    const fresh = await getAuthToken(true);
    res = await callMeetApi(fresh);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Meet API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  if (!data.meetingUri) {
    throw new Error("Meet API returned no meetingUri");
  }
  return data.meetingUri;
}

function callMeetApi(token) {
  return fetch("https://meet.googleapis.com/v2/spaces", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: "{}"
  });
}

function getAuthToken(interactive) {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (token) => {
      if (chrome.runtime.lastError || !token) {
        reject(new Error(chrome.runtime.lastError?.message || "no token"));
      } else {
        resolve(token);
      }
    });
  });
}

function removeCachedToken(token) {
  return new Promise((resolve) =>
    chrome.identity.removeCachedAuthToken({ token }, resolve)
  );
}
