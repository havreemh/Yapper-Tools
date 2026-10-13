// Isolated-world content script: relays between the page script and extension storage/background.
const YX = (globalThis.YX = globalThis.YX || { msgAuthor: new Map(), refresh: null });
const send = (msg) => window.postMessage({ src: "yapx-bridge", ...msg }, "*");
// After the extension is reloaded/updated, an already-open tab keeps a dead copy of this script.
const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
let announcedDead = false;
function dead() { if (!announcedDead) { announcedDead = true; send({ type: "dead" }); } }

async function pushConfig() {
  if (!alive()) return dead();
  try { await pushConfigInner(); } catch (_) { dead(); }
}
async function pushConfigInner() {
  const { muted = {}, censorOn = false } = await chrome.storage.local.get(["muted", "censorOn"]);
  send({ type: "config", config: { muted, censorOn } }); // note: API key is never sent to the page
}
pushConfig();
chrome.storage.onChanged.addListener((changes) => {
  if (changes.muted || changes.censorOn) pushConfig();
});

let pendingProfiles = {};
let profTimer = null;
function queueProfiles(map) {
  Object.assign(pendingProfiles, map);
  if (profTimer) return;
  profTimer = setTimeout(async () => {
    const batch = pendingProfiles; pendingProfiles = {}; profTimer = null;
    if (!alive()) return dead();
    try {
      const { profiles = {} } = await chrome.storage.local.get("profiles");
      Object.assign(profiles, batch);
      const keys = Object.keys(profiles);
      if (keys.length > 5000) keys.slice(0, keys.length - 5000).forEach((k) => delete profiles[k]);
      await chrome.storage.local.set({ profiles });
    } catch (_) { dead(); }
  }, 1000);
}

window.addEventListener("message", (e) => {
  const m = e.data;
  if (e.source !== window || !m || m.src !== "yapx-page") return;
  if (m.type === "profiles" && m.map && typeof m.map === "object") {
    const clean = {};
    for (const [id, name] of Object.entries(m.map)) {
      if (typeof id === "string" && id.length === 36 && typeof name === "string") clean[id] = name.slice(0, 64);
    }
    queueProfiles(clean);
  } else if (m.type === "msgmap" && m.map && typeof m.map === "object") {
    for (const [mid, aid] of Object.entries(m.map)) {
      if (typeof mid === "string" && typeof aid === "string" && mid.length === 36 && aid.length === 36) YX.msgAuthor.set(mid, aid);
    }
    if (YX.msgAuthor.size > 30000) {
      const drop = YX.msgAuthor.size - 30000; let i = 0;
      for (const k of YX.msgAuthor.keys()) { if (i++ >= drop) break; YX.msgAuthor.delete(k); }
    }
    if (YX.refresh) YX.refresh();
  } else if (m.type === "classify" && Array.isArray(m.texts)) {
    const texts = m.texts.slice(0, 40).map((t) => String(t));
    const failOpen = () => send({ type: "classifyResult", reqId: m.reqId, flagged: texts.map(() => false) });
    if (!alive()) { dead(); return failOpen(); }
    try { chrome.runtime.sendMessage({ type: "classify", texts }, (resp) => {
      if (chrome.runtime.lastError) { return failOpen(); }
      const ok = resp && resp.ok && Array.isArray(resp.flagged);
      if (!ok && resp && resp.error) console.debug("[Yapper Tools] filter skipped:", resp.error);
      send({ type: "classifyResult", reqId: m.reqId, flagged: ok ? resp.flagged : texts.map(() => false) });
    }); } catch (_) { dead(); failOpen(); }
  }
});
