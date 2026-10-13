const $ = (id) => document.getElementById(id);
const get = (k) => chrome.storage.local.get(k);
const note = (el, text, ok) => { el.textContent = text; el.className = "note" + (ok ? " ok" : ""); };

// tabs
document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    $("tab-mute").hidden = t.dataset.tab !== "mute";
    $("tab-filter").hidden = t.dataset.tab !== "filter";
  };
});

async function renderPeople() {
  const { muted = {}, vcMuted = {} } = await get(["muted", "vcMuted"]);
  const ids = [...new Set([...Object.keys(muted), ...Object.keys(vcMuted)])];
  const ul = $("people"); ul.innerHTML = "";
  if (!ids.length) { const li = document.createElement("li"); li.className = "empty"; li.textContent = "Nobody muted yet"; ul.append(li); return; }
  ids.sort((a, b) => (muted[a] || vcMuted[a]).localeCompare(muted[b] || vcMuted[b]));
  for (const id of ids) {
    const name = muted[id] || vcMuted[id];
    const li = document.createElement("li"); li.className = "person";
    const nm = document.createElement("span"); nm.className = "nm"; nm.textContent = name;
    const mk = (label, key) => {
      const b = document.createElement("button"); b.className = "pill" + ((key === "muted" ? muted : vcMuted)[id] ? " on" : ""); b.textContent = label;
      b.onclick = async () => {
        const cur = (await get(key))[key] || {};
        if (cur[id]) delete cur[id]; else cur[id] = name;
        await chrome.storage.local.set({ [key]: cur });
        renderPeople();
      };
      return b;
    };
    const x = document.createElement("button"); x.className = "x"; x.textContent = "×"; x.title = "Unmute everywhere";
    x.onclick = async () => {
      const v = await get(["muted", "vcMuted"]);
      const m = v.muted || {}, vm = v.vcMuted || {};
      delete m[id]; delete vm[id];
      await chrome.storage.local.set({ muted: m, vcMuted: vm });
      renderPeople();
    };
    li.append(nm, mk("Chat", "muted"), mk("Voice", "vcMuted"), x);
    ul.append(li);
  }
}

async function render() {
  const v = await get(["profiles", "censorOn", "geminiKey", "model"]);
  $("known").innerHTML = "";
  [...new Set(Object.values(v.profiles || {}))].sort().forEach((n) => { const o = document.createElement("option"); o.value = n; $("known").append(o); });
  $("censorOn").checked = !!v.censorOn; $("key").value = v.geminiKey || ""; $("model").value = v.model || "";
  renderPeople();
}

$("add").onclick = async () => {
  const name = $("who").value.trim().toLowerCase();
  if (!name) return;
  if (!$("inChat").checked && !$("inVoice").checked) { note($("mmsg"), "Pick Chat, Voice, or both."); return; }
  const v = await get(["muted", "vcMuted", "profiles"]);
  const hit = Object.entries(v.profiles || {}).find(([, n]) => n.toLowerCase() === name);
  if (!hit) { note($("mmsg"), "Haven't seen that user yet. Open a channel where they've posted, then try again."); return; }
  const out = {};
  if ($("inChat").checked) out.muted = { ...(v.muted || {}), [hit[0]]: hit[1] };
  if ($("inVoice").checked) out.vcMuted = { ...(v.vcMuted || {}), [hit[0]]: hit[1] };
  await chrome.storage.local.set(out);
  $("who").value = ""; note($("mmsg"), `Muted ${hit[1]}.`, true);
  renderPeople();
};
$("who").addEventListener("keydown", (e) => { if (e.key === "Enter") $("add").click(); });

$("showkey").onclick = () => {
  const show = $("key").type === "password";
  $("key").type = show ? "text" : "password"; $("showkey").textContent = show ? "Hide" : "Show";
};
$("censorOn").onchange = () => chrome.storage.local.set({ censorOn: $("censorOn").checked });
$("save").onclick = async () => {
  await chrome.storage.local.set({ censorOn: $("censorOn").checked, geminiKey: $("key").value.trim(), model: $("model").value.trim() || undefined });
  note($("fmsg"), $("key").value.trim() ? "Saved. Reload yapper.website to apply." : "Saved, but no API key is set yet.", !!$("key").value.trim());
};
render();
