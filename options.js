// Sites declared in manifest.json's host_permissions. These are baked in
// and managed via chrome://extensions, not via this options page.
const DEFAULT_ORIGINS = [
  "https://meet.google.com/*",
  "https://staging.flipnext.de/*",
  "https://show.flipnext.de/*"
];

// Internal-use origin meet.google.com is required for functionality and
// shouldn't be shown as a "site" the user can interact with.
const HIDDEN_DEFAULTS = new Set(["https://meet.google.com/*"]);

const HOST_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function originFor(host) {
  return `https://${host}/*`;
}

function hostFrom(origin) {
  return origin.replace(/^https:\/\//, "").replace(/\/\*$/, "");
}

function showError(message) {
  const el = document.getElementById("error");
  el.textContent = message;
  el.hidden = !message;
}

async function refresh() {
  const perms = await chrome.permissions.getAll();
  const granted = perms.origins || [];

  // Default list — show only those defaults that are still granted (user may
  // have toggled them off via chrome://extensions).
  const defaultList = document.getElementById("default-list");
  defaultList.innerHTML = "";
  const visibleDefaults = DEFAULT_ORIGINS.filter(
    (o) => !HIDDEN_DEFAULTS.has(o)
  );
  for (const origin of visibleDefaults) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = hostFrom(origin);
    const status = document.createElement("span");
    if (granted.includes(origin)) {
      status.textContent = "active";
      status.style.color = "#27a957";
    } else {
      status.textContent = "disabled";
      status.style.color = "#aaa";
    }
    status.style.fontSize = "12px";
    li.appendChild(span);
    li.appendChild(status);
    defaultList.appendChild(li);
  }

  // Custom list — anything granted that isn't a default.
  const customOrigins = granted.filter((o) => !DEFAULT_ORIGINS.includes(o));
  const customList = document.getElementById("custom-list");
  customList.innerHTML = "";
  if (customOrigins.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "(none yet)";
    customList.appendChild(li);
  } else {
    for (const origin of customOrigins) {
      const li = document.createElement("li");
      const span = document.createElement("span");
      span.textContent = hostFrom(origin);
      const btn = document.createElement("button");
      btn.textContent = "Remove";
      btn.addEventListener("click", async () => {
        await chrome.permissions.remove({ origins: [origin] });
        refresh();
      });
      li.appendChild(span);
      li.appendChild(btn);
      customList.appendChild(li);
    }
  }
}

document.getElementById("add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  showError("");
  const input = document.getElementById("new-host");
  const host = input.value.trim().toLowerCase();
  if (!HOST_RE.test(host)) {
    showError("Enter a valid hostname (e.g. prod.flipnext.de).");
    return;
  }
  const origin = originFor(host);
  if (DEFAULT_ORIGINS.includes(origin)) {
    showError("That site is already a default.");
    return;
  }
  try {
    const granted = await chrome.permissions.request({ origins: [origin] });
    if (granted) {
      input.value = "";
      refresh();
    } else {
      showError("Permission denied.");
    }
  } catch (err) {
    showError("Error: " + err.message);
  }
});

document.getElementById("open-extensions").addEventListener("click", (e) => {
  e.preventDefault();
  chrome.tabs.create({
    url: "chrome://extensions/?id=" + chrome.runtime.id
  });
});

refresh();
