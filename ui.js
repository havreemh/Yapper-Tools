// Isolated-world DOM features: per-message mute button and voice mute.
(() => {
  const YX = globalThis.YX;
  const S = { muted: {}, vcMuted: {}, profiles: {} };
  const KEYS = Object.keys(S);

  chrome.storage.local.get(KEYS).then((v) => { Object.assign(S, v); schedule(true); }).catch(() => {});
  chrome.storage.onChanged.addListener((ch) => {
    let touched = false;
    for (const k of KEYS) if (ch[k]) { S[k] = ch[k].newValue || {}; touched = true; }
    if (touched) schedule(true);
  });

  const style = document.createElement("style");
  style.id = "yx-style";
  style.textContent = `
    [data-yx-hidden]{display:none!important}
    .msg-actions .yx-mute{font-size:14px}
    .voice-person .yx-vc{margin-left:auto;cursor:pointer;opacity:0;font-size:12px;padding:0 4px;border-radius:4px}
    .voice-person:hover .yx-vc,.voice-person .yx-vc[data-on]{opacity:1}
    .voice-person .yx-vc[data-on]{background:var(--danger);color:#fff}
  `;
  (document.head || document.documentElement).appendChild(style);

  const nameOf = (id) => S.profiles[id] || id.slice(0, 8);
  function toggle(map, id) {
    const m = { ...S[map] };
    if (m[id]) delete m[id]; else m[id] = nameOf(id);
    try { chrome.storage.local.set({ [map]: m }); } catch (_) { /* extension was reloaded; refresh the tab */ }
  }

  function applyMessages() {
    document.querySelectorAll(".msg[data-message-id]").forEach((m) => {
      const a = YX.msgAuthor.get(m.dataset.messageId);
      if (a && S.muted[a]) m.setAttribute("data-yx-hidden", ""); else m.removeAttribute("data-yx-hidden");

      const act = m.querySelector(":scope > .msg-actions");
      if (act && a && !act.querySelector(".yx-mute")) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "icon-btn yx-mute"; b.textContent = "🔇";
        b.title = "Mute this user's messages (Yapper Tools)";
        b.addEventListener("click", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const id = YX.msgAuthor.get(m.dataset.messageId);
          if (id) toggle("muted", id);
        });
        act.appendChild(b);
      }
    });
  }

  function voiceId(row) {
    const img = row.querySelector("img");
    const m = img && /\/avatars\/([0-9a-f-]{36})\//.exec(img.getAttribute("src") || "");
    if (m) return m[1];
    const name = (row.querySelector(".name")?.textContent || "").trim().toLowerCase();
    if (!name) return null;
    const ids = Object.keys(S.profiles).filter((id) => S.profiles[id].toLowerCase() === name);
    return ids.length === 1 ? ids[0] : null;
  }
  function applyVoice() {
    document.querySelectorAll(".voice-person").forEach((row) => {
      const id = voiceId(row);
      let b = row.querySelector(":scope > .yx-vc");
      if (!id) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement("span");
        b.className = "yx-vc"; b.setAttribute("role", "button"); b.textContent = "🔇";
        b.addEventListener("click", (ev) => {
          ev.preventDefault(); ev.stopPropagation(); // don't trigger the row's own click
          if (b.dataset.id) toggle("vcMuted", b.dataset.id);
        });
        row.appendChild(b);
      }
      b.dataset.id = id;
      b.title = S.vcMuted[id] ? "Unmute in voice (local)" : "Mute in voice (local, only you)";
      if (S.vcMuted[id]) b.setAttribute("data-on", ""); else b.removeAttribute("data-on");
    });
    // Only touch audio elements we muted ourselves, so the site's own deafen logic is left alone.
    document.querySelectorAll("audio[data-participant]").forEach((a) => {
      const want = !!S.vcMuted[a.dataset.participant];
      if (want && !a.muted) { a.muted = true; a.dataset.yxMuted = "1"; }
      else if (!want && a.dataset.yxMuted) { a.muted = false; delete a.dataset.yxMuted; }
    });
  }

  const alive = () => { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } };
  let timer = null, observer = null, interval = null;
  function shutdown() { clearTimeout(timer); clearInterval(interval); if (observer) observer.disconnect(); }
  function run() {
    timer = null;
    if (!alive()) return shutdown();
    try { applyMessages(); applyVoice(); } catch (_) { shutdown(); }
  }
  function schedule(now) {
    if (now) { clearTimeout(timer); timer = null; run(); return; }
    if (!timer) timer = setTimeout(run, 150);
  }
  YX.refresh = () => schedule(false);
  observer = new MutationObserver(() => schedule(false));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  interval = setInterval(() => { if (!alive()) return shutdown(); try { applyVoice(); } catch (_) { shutdown(); } }, 1000); // keep voice mutes enforced
})();
