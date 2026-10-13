// Runs in the PAGE world at document_start, before the site's own scripts.
// Wraps fetch + the Supabase realtime WebSocket so muted/censored messages
// never reach the app. Has no access to your API key (that stays in the bridge/background).
(() => {
  const CENSOR = "[filtered by Yapper Tools]";
  const MUTED_REPLY = "[message from muted user]";
  let cfg = { muted: {}, censorOn: false };
  let markReady;
  const readyP = new Promise((r) => (markReady = r));
  const waitCfg = () => Promise.race([readyP, new Promise((r) => setTimeout(r, 1500))]);

  // ---- bridge messaging -------------------------------------------------
  const pending = new Map();
  let reqSeq = 0;
  window.addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== window || !m || m.src !== "yapx-bridge") return;
    if (m.type === "config") {
      cfg = { muted: m.config.muted || {}, censorOn: !!m.config.censorOn };
      markReady();
    } else if (m.type === "dead") {
      cfg.censorOn = false; // bridge is gone (extension reloaded): stop waiting on the filter
    } else if (m.type === "classifyResult") {
      const res = pending.get(m.reqId);
      if (res) { pending.delete(m.reqId); res(m.flagged); }
    }
  });
  const post = (msg) => window.postMessage({ src: "yapx-page", ...msg }, "*");

  const CHUNK = 40;
  function classifyChunk(texts) {
    return new Promise((resolve) => {
      const reqId = ++reqSeq;
      pending.set(reqId, resolve);
      post({ type: "classify", reqId, texts });
      setTimeout(() => {
        if (pending.delete(reqId)) resolve(texts.map(() => false)); // fail open
      }, 8000);
    });
  }
  async function classify(texts) {
    const out = [];
    for (let i = 0; i < texts.length; i += CHUNK) {
      const flags = await classifyChunk(texts.slice(i, i + CHUNK));
      out.push(...(flags || texts.slice(i, i + CHUNK).map(() => false)));
    }
    return out;
  }

  function rememberRows(rows) {
    const map = {};
    for (const r of rows) if (r && r.id && r.author_id) map[r.id] = r.author_id;
    if (Object.keys(map).length) post({ type: "msgmap", map });
  }

  // ---- core filter ------------------------------------------------------
  async function processRows(rows, isSingleLookup) {
    await waitCfg();
    const out = [];
    const skip = new Set();
    for (const r of rows) {
      if (r && cfg.muted[r.author_id]) {
        if (isSingleLookup) { // reply-preview lookups: blank it instead of removing
          const stub = { ...r, content: MUTED_REPLY, attachment_path: null, attachment_width: null, attachment_height: null };
          skip.add(stub); out.push(stub);
        }
        continue;
      }
      out.push(r);
    }
    if (cfg.censorOn) {
      const idx = [];
      out.forEach((r, i) => {
        if (!skip.has(r) && r && typeof r.content === "string" && r.content.trim().length >= 2) idx.push(i);
      });
      if (idx.length) {
        const flags = await classify(idx.map((i) => out[i].content));
        idx.forEach((i, k) => { if (flags[k]) out[i] = { ...out[i], content: CENSOR }; });
      }
    }
    return out;
  }

  // ---- fetch wrapper ----------------------------------------------------
  const _fetch = window.fetch;
  window.fetch = async function (input, init) {
    const res = await _fetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input.url || String(input);
      const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (method !== "GET" || !url.includes(".supabase.co/rest/v1/") || !res.ok) return res;
      const isMsg = /\/rest\/v1\/messages\?/.test(url);
      const isProf = /\/rest\/v1\/profiles\?/.test(url);
      if (!isMsg && !isProf) return res;
      const data = await res.clone().json();
      if (!Array.isArray(data)) return res;
      if (isProf) {
        const map = {};
        for (const p of data) if (p && p.id && p.username) map[p.id] = p.username;
        if (Object.keys(map).length) post({ type: "profiles", map });
        return res;
      }
      rememberRows(data);
      const out = await processRows(data, /[?&]id=eq\./.test(url));
      return new Response(JSON.stringify(out), {
        status: res.status,
        statusText: res.statusText,
        headers: { "content-type": "application/json; charset=utf-8" },
      });
    } catch (_) {
      return res;
    }
  };

  // ---- realtime WebSocket wrapper --------------------------------------
  const _WS = window.WebSocket;
  function hook(ws) {
    const passed = new WeakSet();
    ws.addEventListener("message", (ev) => {
      if (passed.has(ev)) return;
      if (typeof ev.data !== "string" || ev.data.indexOf('"postgres_changes"') < 0) return;
      let frame;
      try { frame = JSON.parse(ev.data); } catch (_) { return; }
      if (!Array.isArray(frame) || frame[3] !== "postgres_changes") return;
      const d = frame[4] && frame[4].data;
      if (!d || d.table !== "messages" || !d.record) return;
      if (d.type !== "INSERT" && d.type !== "UPDATE") return;
      rememberRows([d.record]);
      ev.stopImmediatePropagation(); // hold it back until we've decided
      (async () => {
        let rows;
        try { rows = await processRows([d.record], false); } catch (_) { rows = [d.record]; }
        if (!rows.length) return; // muted -> dropped
        d.record = rows[0];
        const ne = new MessageEvent("message", { data: JSON.stringify(frame), origin: ev.origin });
        passed.add(ne);
        ws.dispatchEvent(ne);
      })();
    });
  }
  function WS(url, protocols) {
    const ws = protocols === undefined ? new _WS(url) : new _WS(url, protocols);
    try { if (String(url).includes(".supabase.co/realtime")) hook(ws); } catch (_) {}
    return ws;
  }
  WS.prototype = _WS.prototype;
  ["CONNECTING", "OPEN", "CLOSING", "CLOSED"].forEach((k) => (WS[k] = _WS[k]));
  window.WebSocket = WS;
})();
