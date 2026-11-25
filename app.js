/* Fit Crew app. Data syncs through the Apps Script backend in config.js (FITCREW_API).
 * Everything is cached in localStorage so the app opens instantly and works offline;
 * changes queue in an outbox and send when there's signal. */
(function () {
  "use strict";
  var API = window.FITCREW_API || "";
  var LS = { code: "fitcrew.code", me: "fitcrew.me", cache: "fitcrew.cache", outbox: "fitcrew.outbox", board: "fitcrew.board", diary: "fitcrew.diaryAuto", pin: "fitcrew.pin" };
  var DIARY_KEY = "calorie-diary.v2"; // optional Calorie Diary app on the same GitHub Pages origin
  var COLOURS = ["#c4f135", "#5fb3a8", "#ffb547", "#9d8cf0", "#62a8e5", "#e07ba0", "#ff7a45", "#d97757"];
  var STATUS = { cut: "Cutting", bulk: "Bulking", maintain: "Maintaining" };
  var POLL_MS = 20000;

  var S = {
    code: lsGet(LS.code, ""),
    me: lsGet(LS.me, ""),
    cache: lsJSON(LS.cache, { users: [], days: {}, kudos: [] }),
    outbox: lsJSON(LS.outbox, []),
    board: lsGet(LS.board, "week"),
    date: today(),
    draft: {},
    est: null,
    claude: null,
    syncing: false,
    err: "",
    lastSync: 0,
    sheet: null,
    pin: lsGet(LS.pin, ""), gate: null, pinBuf: "", pinFirst: "", pinErr: "", pinless: false, pinChecked: false,
    info: {}
  };

  /* ---------- Small helpers ---------- */
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { if (v == null || v === "") localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function lsJSON(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v || d; } catch (e) { return d; } }
  function persist() { lsSet(LS.cache, JSON.stringify(S.cache)); lsSet(LS.outbox, JSON.stringify(S.outbox)); }
  function today() { return FC.isoDate(new Date()); }
  function evening() { return new Date().getHours() >= 20; }
  function isFinal(d) { return d < today() || (d === today() && evening()); }
  function uid() { return Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fmt(n) { return Math.round(n || 0).toLocaleString("en-NZ"); }
  function kg(n) { return (Math.round(n * 10) / 10).toFixed(1); }
  function signed(n, dp) { var v = (Math.round(n * Math.pow(10, dp || 0)) / Math.pow(10, dp || 0)); return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(dp || 0); }
  function dayLabel(d) {
    var t = today();
    if (d === t) return "Today";
    if (d === FC.addDays(t, -1)) return "Yesterday";
    var x = new Date(d + "T12:00:00");
    return x.toLocaleDateString("en-NZ", { weekday: "short", day: "numeric", month: "short" });
  }
  function shortDate(d) { return new Date(d + "T12:00:00").toLocaleDateString("en-NZ", { day: "numeric", month: "short" }); }
  function users() { return S.cache.users.slice().sort(function (a, b) { return (a.joined || "") < (b.joined || "") ? -1 : 1; }); }
  function user(id) { for (var i = 0; i < S.cache.users.length; i++) if (S.cache.users[i].id === id) return S.cache.users[i]; return null; }
  function me() { return user(S.me); }
  function getDay(id, d) { return S.cache.days[id + "|" + d]; }
  function bodyOf(u) { var w = FC.weightStats(u); return { kg: w.current || u.startWeight || 80, cm: +u.heightCm || 0, age: FC.age(u), sex: u.sex }; }
  function initial(n) { return esc(String(n || "?").trim().charAt(0).toUpperCase()); }
  function lastActive(u) {
    var t = Math.max(+u.seen || 0, +u.updated || 0), d = today();
    for (var i = 0; i < 8; i++) {
      var day = getDay(u.id, FC.addDays(d, -i)); if (!day) continue;
      t = Math.max(t, +day.updated || 0);
      (day.lifts || []).forEach(function (l) { t = Math.max(t, +l.end || 0); });
    }
    return t;
  }
  function agoText(t) {
    if (!t) return "";
    var m = Math.floor((Date.now() - t) / 60000);
    if (m < 5) return "Active now";
    if (m < 60) return "Active " + m + " min ago";
    var h = Math.floor(m / 60); if (h < 24) return "Active " + h + " h ago";
    var dd = Math.floor(h / 24); return dd === 1 ? "Active yesterday" : "Active " + dd + " days ago";
  }
  function activeLine(u) {
    var t = lastActive(u), txt = agoText(t); if (!txt) return "";
    var fresh = Date.now() - t < 3600e3;
    return '<div class="seen' + (fresh ? " on" : "") + '"><i></i>' + txt + "</div>";
  }
  function avatar(u, lg) { return '<span class="av' + (lg ? " lg" : "") + '" style="background:' + esc(u.color || COLOURS[0]) + '">' + initial(u.name) + "</span>"; }

  var ICON = {
    left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M7 11V6a1.5 1.5 0 013 0v4m0-1V4.5a1.5 1.5 0 013 0V10m0-4.5a1.5 1.5 0 013 0V11m0-3a1.5 1.5 0 013 0v6a7 7 0 01-7 7h-1a7 7 0 01-6-3.4L3.6 14a1.5 1.5 0 012.6-1.5L7 14"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 22c4 0 7-2.7 7-6.8 0-3.4-2.3-5.6-3.6-7.6-.4 1.6-1.3 2.7-2.4 3.2C13.4 7 12 4 9.5 2c.2 3.4-1.6 5.4-3.1 7.4A8.5 8.5 0 005 15.2C5 19.3 8 22 12 22z"/></svg>',
    crown: '<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
    utensils: '<svg viewBox="0 0 24 24"><path d="M7 3v8a2 2 0 002 2v8M11 3v8a2 2 0 01-2 2M7 3v5M11 3v5M17 21V3c-2 1-3 3.5-3 7v3h3"/></svg>',
    bulb: '<svg viewBox="0 0 24 24"><path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0012 3z"/></svg>',
    scale: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M8.5 9.5a5 5 0 017 0M12 9.5l1.5-2"/></svg>',
    target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
    user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg>',
    users: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4"/></svg>',
    dumbbell: '<svg viewBox="0 0 24 24"><path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/></svg>',
    trophy: '<svg viewBox="0 0 24 24"><path d="M8 4h8v5a4 4 0 01-8 0V4zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8.5 20h7M10 17h4"/></svg>',
    watch: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="3"/><path d="M9 6l1-3h4l1 3M9 18l1 3h4l1-3M12 9.5V12l1.5 1"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><path d="M4 19h16M7 15l4-5 3 3 5-7"/></svg>',
    body: '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M7 9l5 1 5-1M9.5 21l2.5-7 2.5 7"/></svg>',
    hist: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></svg>',
    list: '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    drop: '<svg viewBox="0 0 24 24"><path d="M12 3s6 6.6 6 11a6 6 0 01-12 0c0-4.4 6-11 6-11z"/></svg>',
    ruler: '<svg viewBox="0 0 24 24"><path d="M3 16.5L16.5 3 21 7.5 7.5 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>',
    medal: '<svg viewBox="0 0 24 24"><circle cx="12" cy="15" r="6"/><path d="M8.5 3h7l-2 6.5h-3zM12 12.5l.9 1.8 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z"/></svg>',
    run: '<svg viewBox="0 0 24 24"><circle cx="14" cy="4.5" r="2"/><path d="M7 21l3-6 3 2v5M5.5 12l3-4 4 1 3 4 3 1M10 15l2-6"/></svg>',
    check2: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    equals: '<svg viewBox="0 0 24 24"><path d="M6 9h12M6 15h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"/></svg>',
    camera: '<svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
    gallery: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>',
    barcode: '<svg viewBox="0 0 24 24"><path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 8v8M10 8v8M13 8v8M17 8v8"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a2 2 0 002 2h12a2 2 0 002-2v-7M16 6l-4-4-4 4M12 2v13"/></svg>'
  };

  /* ---------- Server ---------- */
  function call(action, data) {
    if (!API) return Promise.reject(new Error("No backend set up"));
    var ctrl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 30000);
    var body = JSON.stringify(Object.assign({ code: S.code, action: action, viewer: S.me || undefined, pin: S.pin || undefined }, data || {}));
    return fetch(API, { method: "POST", body: body, redirect: "follow", signal: ctrl && ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        if (!j.ok) { var e = new Error(j.error || "Server error"); e.auth = j.auth === false; e.noClaude = !!j.noClaude; e.pin = !!j.pin; throw e; }
        return j;
      }, function (e) { clearTimeout(timer); throw e.name === "AbortError" ? new Error("Timed out") : e; });
  }

  function queue(op) {
    // Only the latest version of a record needs sending
    S.outbox = S.outbox.filter(function (o) {
      if (o.action !== op.action) return true;
      if (op.action === "saveDay") return !(o.userId === op.userId && o.date === op.date);
      if (op.action === "saveUser") return o.user.id !== op.user.id;
      if (op.action === "kudos") return !(o.from === op.from && o.to === op.to && o.date === op.date);
      return true;
    });
    S.outbox.push(op);
    persist();
    clearTimeout(queue.t);
    queue.t = setTimeout(sync, 400);
  }

  function flush() {
    if (!S.outbox.length) return Promise.resolve();
    var op = S.outbox[0];
    var data = Object.assign({}, op); delete data.action;
    return call(op.action, data).then(function () {
      if (S.outbox[0] === op) S.outbox.shift(); else S.outbox = S.outbox.filter(function (o) { return o !== op; });
      persist();
      return flush();
    });
  }

  function applyPending() {
    S.outbox.forEach(function (o) {
      if (o.action === "saveDay") S.cache.days[o.userId + "|" + o.date] = o.day;
      if (o.action === "saveUser") upsertUser(o.user);
      if (o.action === "kudos") setKudos(o.from, o.to, o.date, o.on);
    });
  }

  function sync() {
    if (S.syncing || !API || !S.code) return Promise.resolve();
    S.syncing = true; S.err = ""; paintSync();
    return flush()
      .then(function () { return call("state", { since: FC.addDays(today(), -70) }); })
      .then(function (j) {
        if (j.limited && S.me) {
          if (!me()) S.cache.users = j.users || []; // names only, so the PIN screen can say who it's for
          if (!S.gate) S.gate = "enter"; S.lastSync = Date.now(); return;
        }
        S.cache = { users: j.users || [], days: j.days || {}, kudos: j.kudos || [] };
        applyPending();
        persist();
        S.lastSync = Date.now();
        if (S.me && !me() && !S.outbox.length) { S.me = ""; lsSet(LS.me, ""); }
        if (S.me && !S.pin && !S.pinChecked && !S.pinless && !j.limited) checkPin();
        var mu = me();
        if (mu && document.visibilityState === "visible" && Date.now() - (+mu.seen || 0) > 15 * 60000) {
          var sx = clone(mu); sx.seen = Date.now(); upsertUser(sx); setTimeout(function () { queue({ action: "saveUser", user: sx }); }, 0); // quiet: no redraw while typing
        }
        if (S.claude == null) call("ping").then(function (p) { S.claude = !!p.claude; renderMe(true); }).catch(function () {});
      })
      .catch(function (e) {
        S.err = e.message || "Offline";
        if (e.auth) { S.code = ""; lsSet(LS.code, ""); }
        if (e.pin && S.me) { S.pin = ""; lsSet(LS.pin, ""); if (!S.gate) S.gate = "enter"; S.err = ""; }
      })
      .then(function () {
        S.syncing = false;
        autoDiary();
        render(true);
        checkBadges();
      });
  }

  function paintSync() {
    var el = $("#sync"); if (!el) return;
    el.className = "sync" + (S.syncing ? " busy" : S.err ? " err" : "");
    var t = S.syncing ? "Syncing" : S.err ? (S.outbox.length ? S.outbox.length + " waiting" : "Offline") : S.outbox.length ? "Saving" : "Synced";
    el.querySelector("span").textContent = t;
    el.title = S.err || (S.lastSync ? "Last synced " + new Date(S.lastSync).toLocaleTimeString("en-NZ") : "");
  }

  /* ---------- Local changes ---------- */
  function upsertUser(u) {
    var i = S.cache.users.findIndex(function (x) { return x.id === u.id; });
    if (i >= 0) S.cache.users[i] = u; else S.cache.users.push(u);
  }
  function setKudos(from, to, date, on) {
    S.cache.kudos = S.cache.kudos.filter(function (k) { return !(k.from === from && k.to === to && k.date === date); });
    if (on) S.cache.kudos.push({ from: from, to: to, date: date });
  }
  function changeDay(date, fn) {
    var u = me(); if (!u) return;
    var before = FC.assess(u, getDay(u.id, date), isFinal(date), date).state;
    var d = clone(getDay(u.id, date) || { food: [], ex: [] });
    d.food = d.food || []; d.ex = d.ex || [];
    fn(d);
    d.updated = Date.now();
    S.cache.days[u.id + "|" + date] = d;
    queue({ action: "saveDay", userId: u.id, date: date, day: d });
    var after = FC.assess(u, d, isFinal(date), date).state;
    if (after === "good" && before !== "good") { celebrate(); toast("On track. Nice work."); }
    render();
  }
  function changeMe(fn) {
    var u = clone(me()); if (!u) return;
    fn(u);
    u.updated = Date.now();
    upsertUser(u);
    queue({ action: "saveUser", user: u });
    render();
  }

  /* ---------- Calorie Diary link (same origin) ---------- */
  function readDiary(date) {
    try {
      var o = JSON.parse(localStorage.getItem(DIARY_KEY));
      if (!o || !o.days) return null;
      var list = o.days[date] || [];
      var k = 0;
      list.forEach(function (e) { k += (+e.kcal || 0) * (+e.servings || 1); });
      return { kcal: Math.round(k), items: list.length, weights: o.weights || {} };
    } catch (e) { return null; }
  }
  function hasDiary() { try { return !!localStorage.getItem(DIARY_KEY); } catch (e) { return false; } }
  function pullDiary(date, quiet) {
    var dd = readDiary(date); if (!dd) return false;
    var day = getDay(S.me, date);
    var cur = ((day && day.food) || []).filter(function (e) { return e.src === "diary"; })[0];
    if (cur && cur.kcal === dd.kcal) return false;
    if (!dd.items && !cur) return false;
    changeDay(date, function (d) {
      d.food = d.food.filter(function (e) { return e.src !== "diary"; });
      if (dd.items) d.food.unshift({ id: uid(), name: "Calorie Diary (" + dd.items + " item" + (dd.items === 1 ? "" : "s") + ")", kcal: dd.kcal, src: "diary" });
    });
    if (!quiet) toast("Pulled " + fmt(dd.kcal) + " cal from Calorie Diary");
    return true;
  }
  function autoDiary() {
    if (!me() || lsGet(LS.diary, "") !== "1" || !hasDiary()) return;
    pullDiary(today(), true);
    // weigh-ins from the diary
    var dd = readDiary(today()); if (!dd) return;
    var u = me(), have = {}; (u.weights || []).forEach(function (w) { have[w[0]] = w[1]; });
    var add = Object.keys(dd.weights).filter(function (k) { return k >= (u.joined || "0") && have[k] !== dd.weights[k]; });
    if (add.length) changeMe(function (x) {
      var m = {}; (x.weights || []).forEach(function (w) { m[w[0]] = w[1]; });
      add.forEach(function (k) { m[k] = +dd.weights[k]; });
      x.weights = Object.keys(m).sort().map(function (k) { return [k, m[k]]; });
    });
  }

  /* ---------- Scores ---------- */
  function scoreRows() {
    var t = today(), ev = evening();
    return users().map(function (u) {
      var a = FC.assess(u, getDay(u.id, t), ev, t);
      var wk = FC.weekPoints(u, getDay, t, ev);
      var st = FC.streak(u, getDay, t, ev);
      var w = FC.weightStats(u);
      return { u: u, a: a, wk: wk, streak: st, w: w, day: getDay(u.id, t) || {} };
    });
  }
  function sortRows(rows) {
    var b = S.board;
    rows.sort(function (x, y) {
      if (b === "streak") return (y.streak - x.streak) || (y.wk.points - x.wk.points);
      if (b === "weight") return (y.w.progress - x.w.progress) || (y.wk.points - x.wk.points);
      return (y.wk.points - x.wk.points) || (y.streak - x.streak);
    });
    return rows;
  }
  function metric(r) {
    if (S.board === "streak") return '<span class="metric">' + r.streak + "</span> day streak";
    if (S.board === "weight") return '<span class="metric">' + (r.w.points.length ? signed(r.w.change, 1) + " kg" : "No weigh-ins") + "</span>" + (r.w.points.length ? " (" + signed(r.w.pct, 1) + "%)" : "");
    return '<span class="metric">' + r.wk.points + "</span> pts this week";
  }
  function kudosFor(to, date) { return S.cache.kudos.filter(function (k) { return k.to === to && k.date === date; }); }

  /* ---------- Rings and charts ---------- */
  function ring(a, size) {
    size = size || 64;
    var r = size / 2 - 6, c = 2 * Math.PI * r;
    var p = a.goal ? Math.max(0, Math.min(1, a.net / a.goal)) : 0;
    var col = a.state === "bad" ? "var(--bad)" : a.state === "good" ? "var(--good)" : a.state === "pending" ? "var(--warn)" : "var(--faint)";
    var pct = a.goal ? Math.round(a.net / a.goal * 100) : 0;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="' + pct + '% of goal">'
      + '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="6"/>'
      + '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="6" stroke-linecap="round" stroke-dasharray="' + (c * p) + " " + c + '" transform="rotate(-90 ' + size / 2 + " " + size / 2 + ')"/>'
      + '<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="var(--text)" style="font:700 ' + Math.round(size / 4) + 'px var(--hfont)">' + (a.logged ? pct + "%" : "–") + "</text></svg>";
  }

  // series: [{color, name, pts:[[date, value]]}]
  function lineChart(series, opt) {
    opt = opt || {};
    var W = 340, H = opt.h || 150, L = 46, R = 10, T = 10, B = 22;
    var all = []; series.forEach(function (s) { s.pts.forEach(function (p) { all.push(p); }); });
    if (all.length < 1) return '<p class="empty">' + (opt.empty || "No data yet") + "</p>";
    var t = function (d) { return new Date(d + "T12:00:00").getTime(); };
    var x0 = Math.min.apply(null, all.map(function (p) { return t(p[0]); })), x1 = Math.max.apply(null, all.map(function (p) { return t(p[0]); }));
    if (opt.from) x0 = Math.min(x0, t(opt.from));
    if (x1 === x0) { x0 -= 864e5 * 3; x1 += 864e5 * 3; }
    var vals = all.map(function (p) { return p[1]; }); if (opt.zero) vals.push(0); if (opt.extra) vals = vals.concat(opt.extra);
    var y0 = Math.min.apply(null, vals), y1 = Math.max.apply(null, vals);
    var pad = Math.max((y1 - y0) * 0.12, opt.minPad || 0.5); y0 -= pad; y1 += pad;
    var X = function (d) { return L + (t(d) - x0) / (x1 - x0) * (W - L - R); };
    var Y = function (v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); };
    var h = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(opt.label || "Chart") + '">';
    [y0 + pad, (y0 + y1) / 2, y1 - pad].forEach(function (v) {
      h += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--line)" stroke-dasharray="2 4"/>';
      h += '<text x="' + (L - 6) + '" y="' + Y(v) + '" text-anchor="end" dominant-baseline="central">' + (opt.fmt ? opt.fmt(v) : Math.round(v * 10) / 10) + "</text>";
    });
    if (opt.zero) h += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--faint)"/>';
    if (opt.target) h += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(opt.target) + '" y2="' + Y(opt.target) + '" stroke="var(--good)" stroke-dasharray="5 4"/><text x="' + (W - R) + '" y="' + (Y(opt.target) - 7) + '" text-anchor="end" style="fill:var(--good)">target</text>';
    var d0 = new Date(x0).toISOString().slice(0, 10), d1 = new Date(x1).toISOString().slice(0, 10);
    h += '<text x="' + L + '" y="' + (H - 4) + '">' + shortDate(d0) + '</text><text x="' + (W - R) + '" y="' + (H - 4) + '" text-anchor="end">' + shortDate(d1) + "</text>";
    series.forEach(function (s) {
      if (!s.pts.length) return;
      var path = s.pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
      h += '<path d="' + path + '" fill="none" stroke="' + esc(s.color) + '" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round"/>';
      var last = s.pts[s.pts.length - 1];
      h += '<circle cx="' + X(last[0]) + '" cy="' + Y(last[1]) + '" r="3.5" fill="' + esc(s.color) + '"/>';
      if (s.pts.length < 12) s.pts.slice(0, -1).forEach(function (p) { h += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="2" fill="' + esc(s.color) + '"/>'; });
    });
    return h + "</svg>";
  }

  function barChart(u, days) {
    var W = 340, H = 140, L = 34, R = 6, T = 8, B = 20, n = days.length, bw = (W - L - R) / n;
    var goal = +u.goalKcal || 2000;
    var rows = days.map(function (d) { var day = getDay(u.id, d); return { d: d, a: FC.assess(u, day, isFinal(d), d) }; });
    var max = Math.max(goal * 1.25, Math.max.apply(null, rows.map(function (r) { return r.a.eaten; })));
    var Y = function (v) { return T + (1 - v / max) * (H - T - B); };
    var h = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Calories eaten each day against goal">';
    h += '<text x="' + (L - 6) + '" y="' + Y(goal) + '" text-anchor="end" dominant-baseline="central">' + fmt(goal) + "</text>";
    rows.forEach(function (r, i) {
      var x = L + i * bw + bw * 0.18, w = bw * 0.64;
      var col = r.a.state === "good" ? "var(--good)" : r.a.state === "bad" ? "var(--bad)" : r.a.state === "pending" ? "var(--warn)" : "var(--line)";
      if (r.a.eaten) h += '<rect x="' + x + '" y="' + Y(r.a.eaten) + '" width="' + w + '" height="' + (Y(0) - Y(r.a.eaten)) + '" rx="3" fill="' + col + '" opacity=".85"><title>' + shortDate(r.d) + ": " + fmt(r.a.eaten) + " eaten, " + fmt(r.a.burned) + " burned</title></rect>";
      if (r.a.burned) h += '<rect x="' + (x + w * 0.25) + '" y="' + Y(0) + '" width="' + (w * 0.5) + '" height="' + Math.min(B - 6, 4 + r.a.burned / max * 40) + '" rx="2" fill="var(--accent-2)"/>';
      if (i % 2 === (n - 1) % 2) h += '<text x="' + (x + w / 2) + '" y="' + (H - 2) + '" text-anchor="middle" style="font-size:9px">' + new Date(r.d + "T12:00:00").getDate() + "</text>";
    });
    h += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(goal) + '" y2="' + Y(goal) + '" stroke="var(--text)" stroke-dasharray="4 4" opacity=".6"/>';
    return h + "</svg>";
  }

  /* ---------- Crew page ---------- */
  function renderCrew() {
    var el = $("#crew"); if (!el) return;
    var rows = sortRows(scoreRows()), t = today();
    if (!rows.length) { el.innerHTML = '<p class="empty">No one here yet.</p>'; return; }
    var good = rows.filter(function (r) { return r.a.state === "good"; }).length;
    var h = '<div class="sect"><h2>Leaderboard</h2><span>' + good + " of " + rows.length + " on track today</span></div>";
    h += '<div class="chips" role="tablist">' + [["week", "Week points"], ["streak", "Streak"], ["weight", "Weight progress"]].map(function (b) {
      return '<button class="chip' + (S.board === b[0] ? " on" : "") + '" data-act="board" data-v="' + b[0] + '">' + b[1] + "</button>";
    }).join("") + "</div>";
    h += '<div class="tiles">';
    rows.forEach(function (r, i) {
      var u = r.u, a = r.a, k = kudosFor(u.id, t), mine = k.some(function (x) { return x.from === S.me; });
      var cls = a.state === "good" ? " good" : a.state === "bad" ? " bad" : "";
      h += '<div class="tile' + cls + (i === 0 && rows.length > 2 ? " lead" : "") + '" role="button" tabindex="0" data-act="profile" data-id="' + u.id + '">'
        + '<div class="who">' + avatar(u) + "<div style=\"min-width:0\"><b>" + esc(u.name) + (u.id === S.me ? '<span class="me-dot">YOU</span>' : "") + '</b><div class="tag">' + STATUS[u.status || "maintain"] + "</div></div>"
        + '<span class="rank' + (i === 0 ? " r1" : "") + '">' + (i === 0 ? ICON.crown : "") + "#" + (i + 1) + "</span></div>"
        + '<div class="tmain">' + ring(a, i === 0 && rows.length > 2 ? 70 : 58)
        + '<div class="tnums"><div class="eat num">' + fmt(a.eaten) + "<small>/ " + fmt(a.goal) + " eaten</small></div>"
        + '<div class="brn num">' + (a.burned ? "−" : "") + fmt(a.burned) + "<small>burned</small></div></div></div>"
        + '<div class="tmsg ' + (a.state === "bad" ? "bad" : a.state === "good" ? "good" : "warn") + '">' + esc(a.msg) + "</div>"
        + activeLine(u)
        + '<div class="tfoot">' + (r.streak >= 3 ? '<span class="flame">' + ICON.flame + "</span>" : "") + "<span>" + metric(r) + "</span>"
        + (u.id !== S.me ? '<button class="kudo' + (mine ? " on" : "") + '" data-act="kudos" data-id="' + u.id + '" aria-label="High five ' + esc(u.name) + '">' + ICON.hand + (k.length || "") + "</button>"
          : (k.length ? '<span class="kudo on">' + ICON.hand + k.length + "</span>" : ""))
        + "</div></div>";
    });
    h += "</div>";

    // Week grid
    var ws = FC.weekStart(t), days = []; for (var i = 0; i < 7; i++) days.push(FC.addDays(ws, i));
    h += '<div class="card">' + head("cal", "This week", "Mon to Sun") + '<table class="wk"><tr><th></th>'
      + days.map(function (d) { return "<th>" + "MTWTFSS".charAt(days.indexOf(d)) + "</th>"; }).join("") + "</tr>";
    users().forEach(function (u) {
      h += "<tr><td>" + esc(u.name) + "</td>" + days.map(function (d) {
        if (d > t) return '<td><span class="dot" style="opacity:.35"></span></td>';
        var day = getDay(u.id, d), a = FC.assess(u, day, isFinal(d), d);
        var ex = day && day.ex && day.ex.length;
        return '<td><span class="dot ' + a.state + (ex ? " ex" : "") + '" title="' + esc(shortDate(d) + ": " + a.msg) + '"></span></td>';
      }).join("") + "</tr>";
    });
    h += '</table><div class="legend"><span><i class="dot good"></i>On track</span><span><i class="dot bad"></i>Off track</span><span><i class="dot pending"></i>In progress</span><span><i class="dot missed"></i>Not logged</span><span><i class="dot ex"></i>Worked out</span></div></div>';

    // Weight race
    var series = users().map(function (u) {
      var w = FC.weightStats(u);
      var pts = w.start ? [[u.joined || (w.points[0] && w.points[0][0]) || t, 0]].concat(w.points.filter(function (p) { return p[0] >= (u.joined || ""); }).map(function (p) { return [p[0], (p[1] - w.start) / w.start * 100]; })) : [];
      return { color: u.color, name: u.name, pts: pts };
    });
    if (window.FCTrain) h += FCTrain.crewHtml();
    h += '<div class="card">' + head("chart", "Weight race", "% change from start") + '<div class="chart">'
      + lineChart(series, { zero: true, label: "Weight change by person", fmt: function (v) { return signed(v, 1) + "%"; }, minPad: 0.6, empty: "Weigh-ins will show here." })
      + '</div><div class="keyrow">' + users().map(function (u) { return '<span><i style="background:' + esc(u.color) + '"></i>' + esc(u.name) + "</span>"; }).join("") + "</div></div>";
    el.innerHTML = h;
  }

  /* ---------- Profile sheet ---------- */
  function renderProfile(id, fromSync) {
    if (id === "settings") return renderSettings(fromSync);
    var u = user(id); if (!u) return closeSheet();
    var t = today(), day = getDay(u.id, t) || {}, a = FC.assess(u, day, evening(), t), w = FC.weightStats(u), ft = FC.foodTotals(day);
    var wk = FC.weekPoints(u, getDay, t, evening()), st = FC.streak(u, getDay, t, evening());
    var bmi = FC.bmi(w.current, +u.heightCm);
    var k = kudosFor(u.id, t), mine = k.some(function (x) { return x.from === S.me; });
    var days14 = []; for (var i = 13; i >= 0; i--) days14.push(FC.addDays(t, -i));
    var h = '<div class="grab"></div><div class="phead">' + avatar(u, true) + "<div><h2>" + esc(u.name) + '</h2><div class="tag">' + STATUS[u.status || "maintain"] + " · goal " + fmt(FC.goalFor(u, t)) + " cal" + (FC.goalFor(u, t) !== +u.goalKcal ? " today" : "") + '</div></div><button class="x" data-act="close" aria-label="Close">×</button></div>';
    h += '<div class="card"><h2>Today' + (u.id !== S.me ? '<button class="kudo' + (mine ? " on" : "") + '" data-act="kudos" data-id="' + u.id + '">' + ICON.hand + "High five" + (k.length ? " · " + k.length : "") + "</button>" : "") + "</h2>"
      + '<div class="summary">' + ring(a, 92) + '<div class="big"><span class="lbl">Eaten</span><span class="eat num">' + fmt(a.eaten) + '<span class="unit">cal</span></span><span class="lbl">Burned</span><span class="brn num">' + fmt(a.burned) + '<span class="unit">cal</span></span></div></div>'
      + '<div class="status ' + a.state + '">' + esc(a.msg) + (a.logged ? " · net " + fmt(a.net) + " of " + fmt(a.goal) : "") + "</div>"
      + (ft.p || ft.c || ft.f ? macroTiles(u, ft) : "")
      + ((day.ex || []).length ? '<div class="list" style="margin:12px 0 0">' + day.ex.map(function (e) { return '<div class="row"><div class="t"><b>' + esc(e.name) + "</b>" + (e.note ? "<small>" + esc(e.note) + "</small>" : "") + '</div><span class="k">' + fmt(e.kcal) + "</span></div>"; }).join("") + "</div>" : "")
      + "</div>";
    h += '<div class="stats"><div class="stat"><span>Streak</span><b>' + st + ' d</b></div><div class="stat"><span>Week pts</span><b>' + wk.points + '</b></div><div class="stat"><span>Workouts</span><b>' + wk.workouts + "</b></div></div>";
    if (window.FCTrain) h += FCTrain.profileHtml(u);
    h += badgesCard(u, false);
    h += '<div class="card">' + head("scale", "Weight") + '<div class="stats"><div class="stat"><span>Start</span><b>' + (w.start ? kg(w.start) : "–") + '</b></div><div class="stat"><span>Now</span><b>' + (w.current ? kg(w.current) : "–") + '</b></div><div class="stat"><span>Change</span><b class="' + (w.progress > 0 ? "good" : w.progress < 0 ? "bad" : "") + '">' + (w.start ? signed(w.change, 1) : "–") + "</b></div></div>"
      + '<div class="chart">' + lineChart([{ color: u.color, pts: weightPts(u) }], { label: "Weight over time", target: w.target || 0, extra: w.target ? [w.target] : [], empty: "No weigh-ins yet." }) + "</div>"
      + '<p class="hint" style="margin-top:8px">' + (w.target ? "Target " + kg(w.target) + " kg, " + kg(Math.abs(w.toGo)) + " kg to go. " : "") + (bmi ? "BMI " + bmi.toFixed(1) + "." : "") + "</p></div>";
    h += '<div class="card">' + head("chart", "Last 14 days", "eaten vs goal") + '<div class="chart">' + barChart(u, days14) + '</div><div class="legend"><span><i class="dot good"></i>On track</span><span><i class="dot bad"></i>Off track</span><span><i style="width:11px;height:4px;background:var(--accent-2);border-radius:2px;display:inline-block"></i>Burned</span></div></div>';
    $("#panel").innerHTML = h;
  }
  function weightPts(u) {
    var w = FC.weights(u);
    if (u.startWeight && (!w.length || w[0][0] > (u.joined || ""))) w.unshift([u.joined || today(), +u.startWeight]);
    return w;
  }
  function macroTiles(u, ft) {
    var pg = +u.proteinGoal || 0;
    return '<div class="macros"><div class="macro"><b>' + fmt(ft.p) + "g</b><span>Protein" + (pg ? " / " + pg + "g" : "") + "</span>" + (pg ? '<div class="bar"><i style="width:' + Math.min(100, ft.p / pg * 100) + '%"></i></div>' : "") + '</div><div class="macro"><b>' + fmt(ft.c) + 'g</b><span>Carbs</span></div><div class="macro"><b>' + fmt(ft.f) + "g</b><span>Fat</span></div></div>";
  }
  function openSheet(id) { S.sheet = id; renderProfile(id); $("#sheet").classList.add("open"); }
  function closeSheet() { S.sheet = null; $("#sheet").classList.remove("open"); }

  /* ---------- Shared look: card headings with an icon and an optional (i) for the explanations ---------- */
  function head(ic, title, small, key) {
    return "<h2>" + (ic ? '<span class="hic">' + ICON[ic] + "</span>" : "") + title + (small ? "<small>" + small + "</small>" : "")
      + (key ? '<button class="info' + (S.info[key] ? " on" : "") + '" data-act="info" data-k="' + key + '" aria-label="Explain">' + ICON.info + "</button>" : "") + "</h2>";
  }
  function tip(key, html) { return S.info[key] ? '<p class="hint tip">' + html + "</p>" : ""; }
  var MAC = { p: "var(--pro)", c: "var(--carb)", f: "var(--fat)" };
  function macText(e) { return e.p || e.c || e.f ? '<small class="mac"><em class="p">' + fmt(e.p) + 'P</em><em class="c">' + fmt(e.c) + 'C</em><em class="f">' + fmt(e.f) + "F</em></small>" : ""; }
  function macBar(p, c, f) { var t = p * 4 + c * 4 + f * 9; if (!t) return ""; return '<span class="mbar"><i style="flex:' + p * 4 + ";background:" + MAC.p + '"></i><i style="flex:' + c * 4 + ";background:" + MAC.c + '"></i><i style="flex:' + f * 9 + ";background:" + MAC.f + '"></i></span>'; }
  var FOOD_IC = { barcode: "barcode", claude: "spark", saved: "star", idea: "bulb", diary: "cal" }, EX_IC = { tracker: "dumbbell", cardio: "run", saved: "star", estimate: "spark", manual: "watch" };
  function rowIcon(ic, cls) { return '<span class="ricon ' + (cls || "") + '">' + ICON[ic] + "</span>"; }

  function summaryCard(u, a, ft) {
    var size = 150, r = 62, c = 2 * Math.PI * r, p = a.goal ? Math.max(0, Math.min(1, a.net / a.goal)) : 0;
    var col = a.state === "bad" ? "var(--bad)" : a.state === "good" ? "var(--good)" : a.state === "pending" ? "var(--warn)" : "var(--accent)";
    var left = Math.round(a.goal - a.net), bulk = u.status === "bulk";
    var mid = a.logged ? fmt(Math.abs(left)) : fmt(a.goal), lbl = !a.logged ? "cal to eat" : left >= 0 ? (bulk ? "cal to go" : "cal left") : (bulk ? "cal over goal" : "cal over");
    var ringSvg = '<svg viewBox="0 0 ' + size + " " + size + '" class="bigring" role="img" aria-label="' + mid + " " + lbl + '"><circle cx="75" cy="75" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="12"/>'
      + '<circle cx="75" cy="75" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="12" stroke-linecap="round" stroke-dasharray="' + (c * p).toFixed(1) + " " + c.toFixed(1) + '" transform="rotate(-90 75 75)"/></svg>';
    var st = function (ic, cls, v, l) { return '<div class="ss"><span class="ssi ' + cls + '">' + ICON[ic] + "</span><div><b>" + v + "</b><small>" + l + "</small></div></div>"; };
    return '<div class="card sum"><div class="sumtop"><div class="bring">' + ringSvg + '<div class="bmid"><b class="' + (left < 0 && !bulk ? "bad" : "") + '">' + mid + "</b><span>" + lbl + "</span></div></div>"
      + '<div class="sstats">' + st("utensils", "eat", fmt(a.eaten), "eaten of " + fmt(a.goal)) + st("flame", "brn", fmt(a.burned), "burned") + st("equals", "net", fmt(a.net), "net") + "</div></div>"
      + (a.state === "good" ? '<div class="okchip">' + ICON.check2 + "On track</div>" : a.logged ? '<div class="status ' + a.state + '">' + esc(a.msg) + "</div>" : "") + weekAvgRow(u) + macroBlock(u, ft) + "</div>";
  }
  // Weekly running average: completed days this week (Mon to yesterday, plus today after 8pm), days with food logged
  function weekAvg(u) {
    var t = today(), wd = new Date(t + "T12:00:00").getDay(), mon = FC.addDays(t, -((wd + 6) % 7));
    var eat = 0, net = 0, n = 0, gs = 0;
    for (var d = mon; d <= t; d = FC.addDays(d, 1)) {
      if (d === t && !evening()) break;
      var day = getDay(u.id, d), k = FC.foodTotals(day).kcal; if (!k) continue;
      eat += k; net += k - FC.burned(day); gs += FC.goalFor(u, d); n++;
    }
    if (!n) return null;
    var e = Math.round(eat / n), nt = Math.round(net / n), g = u.goalKcal ? Math.round(gs / n) : 0, st = u.status || "maintain";
    var ok = !g ? null : st === "cut" ? nt <= g : st === "bulk" ? nt >= g : Math.abs(nt - g) <= g * 0.1;
    return { eat: e, net: nt, n: n, goal: g, ok: ok };
  }
  function weekAvgRow(u) {
    var w = weekAvg(u);
    if (!w) return '<div class="wavg"><span class="wl">' + ICON.cal + 'Week avg</span><span class="wm">Starts after your first full day</span></div>';
    return '<div class="wavg"><span class="wl">' + ICON.cal + "Week avg</span><b>" + fmt(w.eat) + '</b><span class="wm">/ ' + fmt(w.goal) + ' eaten</span><span class="wn ' + (w.ok === true ? "good" : w.ok === false ? "bad" : "") + '">net ' + fmt(w.net) + '</span><small>' + w.n + " day" + (w.n === 1 ? "" : "s") + "</small></div>";
  }
  function macroBlock(u, ft) {
    var pg = +u.proteinGoal || 0, kc = ft.p * 4 + ft.c * 4 + ft.f * 9, R = 34, C = 2 * Math.PI * R, off = 0;
    var seg = function (v, col) { if (!kc || !v) return ""; var len = v / kc * C, s = '<circle cx="44" cy="44" r="' + R + '" fill="none" stroke="' + col + '" stroke-width="12" stroke-dasharray="' + len.toFixed(2) + " " + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 44 44)"/>'; off += len; return s; };
    var donut = '<svg viewBox="0 0 88 88" class="donut"><circle cx="44" cy="44" r="' + R + '" fill="none" stroke="var(--line)" stroke-width="12"/>' + seg(ft.p * 4, MAC.p) + seg(ft.c * 4, MAC.c) + seg(ft.f * 9, MAC.f) + "</svg>";
    var row = function (k, name, g, goal) {
      var pct = goal ? Math.min(100, g / goal * 100) : kc ? Math.round((k === "f" ? g * 9 : g * 4) / kc * 100) : 0;
      return '<div class="mr"><span class="md" style="background:' + MAC[k] + '"></span><span class="mn">' + name + "</span><b>" + fmt(g) + 'g</b><span class="mx">' + (goal ? "/ " + goal + "g" : pct + "%") + '</span><div class="mb"><i style="width:' + (goal ? pct : pct) + "%;background:" + MAC[k] + '"></i></div></div>';
    };
    return '<div class="macblock">' + donut + '<div class="mrows">' + row("p", "Protein", ft.p, pg) + row("c", "Carbs", ft.c, 0) + row("f", "Fat", ft.f, 0) + "</div></div>";
  }

  /* ---------- Water ---------- */
  function waterGoal(u) { return +u.waterGoal || 2000; }
  function waterCard(u, day) {
    var ml = +(day && day.water) || 0, fw = foodWater(u, day), tot = ml + fw, goal = waterGoal(u), glasses = Math.max(1, Math.round(goal / 250)), full = Math.floor(ml / 250);
    var h = '<div class="card">' + head("drop", "Water", fmt(tot) + " / " + fmt(goal) + " ml", "water") + '<div class="glasses">';
    for (var i = 0; i < Math.max(glasses, full); i++) h += '<button class="glass' + (i < full ? " on" : "") + (i >= glasses ? " extra" : "") + '" data-act="glass" data-i="' + i + '" aria-label="' + ((i + 1) * 250) + ' ml">' + ICON.drop + "</button>";
    h += '</div><div class="wbar"><i style="width:' + Math.min(100, ml / goal * 100) + '%"></i><i class="fw" style="width:' + Math.max(0, Math.min(100 - ml / goal * 100, fw / goal * 100)) + '%"></i></div>'
      + '<div class="wsplit"><span><i class="d1"></i>' + fmt(ml) + " ml drunk</span>" + (u.foodWater === false ? '<span class="off">Food water off</span>' : '<span><i class="d2"></i>' + fmt(fw) + " ml from food</span>") + "</div>"
      + '<div class="btns"><button class="btn sm" data-act="water" data-v="250">+250 ml</button><button class="btn sm" data-act="water" data-v="500">+500 ml</button><button class="btn ghost sm" data-act="water" data-v="-250"' + (ml ? "" : " disabled") + ">−250</button></div>"
      + tip("water", "Glasses are what you drink. Water in food is added automatically for barcode scans, Claude meal estimates and the food ideas, worked out as the food's weight minus its protein, carbs and fat. Hand-typed entries without a weight can't be counted. About a fifth of most people's water comes from food, so your goal is total water: guidelines suggest around 2.5 L a day for men and 2 L for women, more when training. Turn food water off in Settings > Goals.");
    return h + "</div>";
  }
  function setWater(ml) {
    var u = me(), day = getDay(u.id, S.date), before = waterTotal(u, day), goal = waterGoal(u);
    ml = Math.max(0, Math.min(10000, Math.round(ml)));
    changeDay(S.date, function (d) { d.water = ml; });
    if (before < goal && waterTotal(u, getDay(u.id, S.date)) >= goal) { celebrate(); toast("Water goal hit. Nice."); }
  }

  /* ---------- Measurements (private: the script only sends them back to you) ---------- */
  var MEAS = [["waist", "Waist"], ["chest", "Chest"], ["hips", "Hips"], ["arm", "Arms"], ["thigh", "Thighs"], ["neck", "Neck"], ["bf", "Body fat"]];
  function measList(u) { return ((u.priv || {}).meas || []).slice().sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); }
  function measCard(u, d) {
    var list = measList(u), unit = function (k) { return k === "bf" ? "%" : " cm"; };
    var h = '<div class="card">' + head("ruler", "Measurements", ICON.lock + "Only you", "meas")
      + tip("meas", "Measurements are private. Your Google script strips them out before sending your profile to anyone else, so the crew never receives them, whatever your sharing settings. (Whoever owns the Google Sheet can still see the raw data there.)");
    var latest = {}, first = {};
    list.forEach(function (e) { MEAS.forEach(function (m) { var v = +e[1][m[0]]; if (v) { latest[m[0]] = v; if (first[m[0]] == null) first[m[0]] = v; } }); });
    var have = MEAS.filter(function (m) { return latest[m[0]]; });
    if (have.length) {
      h += '<div class="mgrid">' + have.map(function (m) {
        var ch = Math.round((latest[m[0]] - first[m[0]]) * 10) / 10;
        return '<div class="mt"><span>' + m[1] + "</span><b>" + latest[m[0]] + "<small>" + unit(m[0]) + "</small></b>" + (ch ? '<em class="' + (ch < 0 ? "dn" : "up") + '">' + (ch > 0 ? "▲ +" : "▼ ") + ch + "</em>" : "<em>first</em>") + "</div>";
      }).join("") + "</div>";
      var sel = S.measSel && latest[S.measSel] ? S.measSel : have[0][0];
      var pts = list.filter(function (e) { return +e[1][sel]; }).map(function (e) { return [e[0], +e[1][sel]]; });
      h += '<div class="chips mchips2">' + have.map(function (m) { return '<button class="chip' + (m[0] === sel ? " on" : "") + '" data-act="meassel" data-v="' + m[0] + '">' + m[1] + "</button>"; }).join("") + "</div>";
      if (pts.length > 1) h += '<div class="chart">' + lineChart([{ color: "var(--accent)", pts: pts }], { label: "Measurement", empty: "" }) + "</div>";
    } else h += '<p class="empty">Track waist, chest, arms and more over time. Measure every 2 to 4 weeks, same time of day.</p>';
    var cur = (list.filter(function (e) { return e[0] === d; })[0] || [d, {}])[1];
    h += '<div class="slab2">On ' + esc(dayLabel(d).toLowerCase()) + '</div><div class="g3 mform">' + MEAS.map(function (m) {
      return '<label class="f">' + m[1] + (m[0] === "bf" ? " %" : " cm") + '<input id="ms_' + m[0] + '" inputmode="decimal" value="' + esc(dv("ms_" + m[0], cur[m[0]] || "")) + '"></label>';
    }).join("") + '</div><div class="btns" style="margin-top:10px"><button class="btn pri" style="flex:1" data-act="meassave">Save measurements</button>' + (Object.keys(cur).length ? '<button class="btn ghost" data-act="measdel" aria-label="Remove">×</button>' : "") + "</div>";
    return h + "</div>";
  }

  /* ---------- Badges ----------
   * Lifetime counters live in profile.stats (workouts, volume, PBs, cardio minutes, high fives), so they keep
   * counting past the 10 weeks each phone holds. Once earned, a badge is kept in profile.badges for good. */
  var BADGES = [
    { id: "first", n: "First rep", d: "Log a workout in the tracker", ic: "dumbbell", t: 1, k: "w", g: 1 },
    { id: "w10", n: "Regular", d: "10 workouts", ic: "dumbbell", t: 1, k: "w", g: 10 },
    { id: "w25", n: "Committed", d: "25 workouts", ic: "dumbbell", t: 2, k: "w", g: 25 },
    { id: "w50", n: "Gym rat", d: "50 workouts", ic: "dumbbell", t: 3, k: "w", g: 50 },
    { id: "w100", n: "Centurion", d: "100 workouts", ic: "dumbbell", t: 4, k: "w", g: 100 },
    { id: "pb1", n: "PB breaker", d: "Beat a personal best", ic: "trophy", t: 1, k: "pbs", g: 1 },
    { id: "pb10", n: "Record setter", d: "10 PBs", ic: "trophy", t: 2, k: "pbs", g: 10 },
    { id: "pb25", n: "Unstoppable", d: "25 PBs", ic: "trophy", t: 3, k: "pbs", g: 25 },
    { id: "vol10", n: "10 tonnes", d: "Lift 10,000 kg in total", ic: "chart", t: 1, k: "vol", g: 10000 },
    { id: "vol100", n: "100 tonnes", d: "Lift 100,000 kg in total", ic: "chart", t: 3, k: "vol", g: 100000 },
    { id: "st3", n: "On a roll", d: "3 days on track in a row", ic: "flame", t: 1, k: "streak", g: 3 },
    { id: "st7", n: "Week warrior", d: "7 days on track in a row", ic: "flame", t: 2, k: "streak", g: 7 },
    { id: "st30", n: "Iron will", d: "30 days on track in a row", ic: "flame", t: 4, k: "streak", g: 30 },
    { id: "log7", n: "Logger", d: "Log food 7 days in a row", ic: "utensils", t: 1, k: "logStreak", g: 7 },
    { id: "log30", n: "Diary devotee", d: "Log food 30 days in a row", ic: "utensils", t: 3, k: "logStreak", g: 30 },
    { id: "h2o", n: "Hydrated", d: "Hit your water goal 7 days in a row", ic: "drop", t: 2, k: "waterStreak", g: 7 },
    { id: "cardio", n: "Cardio king", d: "300 minutes of cardio", ic: "run", t: 2, k: "cmin", g: 300 },
    { id: "hf10", n: "Hype man", d: "Send 10 high fives", ic: "hand", t: 1, k: "hf", g: 10 },
    { id: "kg2", n: "On the move", d: "2 kg towards your goal", ic: "scale", t: 2, k: "kgGoal", g: 2 },
    { id: "target", n: "Goal getter", d: "Reach your target weight", ic: "target", t: 4, k: "atTarget", g: 1 }
  ];
  var TIER = ["", "bronze", "silver", "gold", "elite"];
  function dayStreak(u, test) { var n = 0, d = today(); if (!test(getDay(u.id, d))) d = FC.addDays(d, -1); while (n < 70 && test(getDay(u.id, d))) { n++; d = FC.addDays(d, -1); } return n; }
  function badgeValues(u) {
    var st = u.stats || {}, w = FC.weightStats(u), goal = waterGoal(u), start = +u.startWeight || w.start || 0, now = w.current || start;
    var kgGoal = !start ? 0 : u.status === "bulk" ? now - start : u.status === "cut" ? start - now : 0;
    return {
      w: +st.w || 0, pbs: +st.pbs || 0, vol: +st.vol || 0, cmin: +st.cmin || 0, hf: +st.hf || 0,
      streak: FC.streak(u, getDay, today(), evening()),
      logStreak: dayStreak(u, function (d) { return FC.foodTotals(d).kcal > 0; }),
      waterStreak: dayStreak(u, function (d) { return waterTotal(u, d) >= goal; }),
      kgGoal: Math.max(0, Math.round(kgGoal * 10) / 10),
      atTarget: u.targetWeight && now && ((u.status === "cut" && now <= u.targetWeight) || (u.status === "bulk" && now >= u.targetWeight)) ? 1 : 0
    };
  }
  // Counters for people who logged before badges existed: count what's on the phone once
  function backfillStats(u) {
    var st = { w: 0, vol: 0, pbs: 0, cmin: 0, hf: 0 };
    Object.keys(S.cache.days).forEach(function (k) {
      if (k.split("|")[0] !== u.id) return;
      (S.cache.days[k].lifts || []).forEach(function (l) {
        st.w++; st.pbs += (l.pbs || []).length;
        l.exs.forEach(function (e) { if (e.cardio) st.cmin += +e.cardio.min || 0; if (!e.t) (e.sets || []).forEach(function (x) { st.vol += (+x[0] || 0) * (+x[1] || 0); }); });
      });
    });
    st.hf = S.cache.kudos.filter(function (k) { return k.from === u.id; }).length;
    st.pbs = Math.max(st.pbs, Object.keys(u.pb || {}).filter(function (id) { var p = u.pb[id]; return p.wnew || p.e1new || p.rnew; }).length);
    return st;
  }
  function bump(field, by) { changeMe(function (u) { u.stats = u.stats || backfillStats(u); u.stats[field] = Math.max(0, (+u.stats[field] || 0) + by); }); }
  var badgeBusy = false;
  function checkBadges() {
    var u = me(); if (!u || badgeBusy || S.gate) return;
    var x = clone(u), changed = false;
    if (!x.stats) { x.stats = backfillStats(x); changed = true; }
    var v = badgeValues(x), got = x.badges || {}, fresh = [];
    BADGES.forEach(function (b) { if (!got[b.id] && v[b.k] >= b.g) { got[b.id] = today(); fresh.push(b); } });
    if (!fresh.length && !changed) return;
    x.badges = got; badgeBusy = true;
    upsertUser(x); queue({ action: "saveUser", user: x });
    setTimeout(function () { badgeBusy = false; }, 0);
    if (fresh.length) { celebrate(); toast(fresh.length === 1 ? "Badge unlocked: " + fresh[0].n : fresh.length + " badges unlocked: " + fresh.map(function (b) { return b.n; }).join(", "), true); render(true); }
  }
  function badgeTile(b, on, prog) {
    return '<div class="bdg ' + TIER[b.t] + (on ? " on" : "") + '"><span class="bic">' + ICON[b.ic] + "</span><b>" + esc(b.n) + "</b><small>" + esc(b.d) + "</small>"
      + (!on && prog != null ? '<div class="bprog"><i style="width:' + Math.min(100, prog * 100) + '%"></i></div>' : "") + "</div>";
  }
  function badgesCard(u, mine) {
    var got = u.badges || {}, earned = BADGES.filter(function (b) { return got[b.id]; });
    if (!mine) return earned.length ? '<div class="card">' + head("medal", "Badges", earned.length + " / " + BADGES.length) + '<div class="bgrid">' + earned.map(function (b) { return badgeTile(b, true); }).join("") + "</div></div>" : "";
    var v = badgeValues(u), next = BADGES.filter(function (b) { return !got[b.id]; }).map(function (b) { return { b: b, p: Math.min(0.99, v[b.k] / b.g) }; }).sort(function (a, b) { return b.p - a.p; }).slice(0, 3);
    var h = '<div class="card">' + head("medal", "Badges", earned.length + " / " + BADGES.length, "badges");
    h += earned.length ? '<div class="bgrid">' + earned.map(function (b) { return badgeTile(b, true); }).join("") + "</div>" : '<p class="empty">None yet. Your first one is close.</p>';
    if (next.length) h += '<div class="slab2">Next up</div><div class="bgrid">' + next.map(function (o) { return badgeTile(o.b, false, o.p); }).join("") + "</div>";
    return h + tip("badges", "Badges are earned from your workouts, PBs, streaks, food logging, water, cardio, high fives and weight progress. Once earned they're yours for good, and the crew can see them on your profile.") + "</div>";
  }

  /* ---------- Me page ---------- */
  function dv(k, d) { return S.draft[k] != null ? S.draft[k] : d; }
  /* ---------- Barcode food (scan.js + Open Food Facts) ---------- */
  function scanCalc(p, g) {
    var m = (g || 0) / 100;
    return { kcal: Math.round(p.kcal * m), p: Math.round(p.p * m * 10) / 10, c: Math.round(p.c * m * 10) / 10, f: Math.round(p.f * m * 10) / 10 };
  }
  function scanCalcText(p, g) {
    var r = scanCalc(p, g);
    return g > 0 ? "= <b>" + fmt(r.kcal) + " cal</b> · P " + fmt(r.p) + " · C " + fmt(r.c) + " · F " + fmt(r.f) : "Enter how much you had.";
  }
  function scanBlock() {
    if (!window.FCScan) return "";
    var p = S.scan;
    if (!p) return '<button class="btn wide scanbtn" data-act="scan">' + ICON.barcode + "Scan a barcode</button>";
    var u = p.liquid ? "ml" : "g", g = parseFloat(dv("sG", p.serving || 100)) || 0;
    var per = "Per 100 " + u + ": " + fmt(Math.round(p.kcal)) + " cal · P " + fmt(Math.round(p.p * 10) / 10) + " · C " + fmt(Math.round(p.c * 10) / 10) + " · F " + fmt(Math.round(p.f * 10) / 10);
    return '<div class="scanned"><div class="sh"><div class="t"><b>' + esc(p.name) + "</b>" + (p.brand ? "<small>" + esc(p.brand) + "</small>" : "") + '<small>' + per + '</small></div><button class="x" data-act="scanclear" aria-label="Discard">×</button></div>'
      + '<div class="g2"><label class="f">How much (' + u + ')<input id="sG" inputmode="decimal" value="' + esc(String(dv("sG", p.serving || 100))) + '"></label><div class="qa">'
      + (p.serving ? '<button class="btn ghost" data-act="scanamt" data-v="' + p.serving + '">' + esc(p.servingText && p.servingText.length <= 22 && p.servingText.indexOf(String(p.serving)) >= 0 && !/^\s*[\d.,]+\s*(g|ml)\s*$/i.test(p.servingText) ? p.servingText : "1 serve (" + fmt(p.serving) + " " + u + ")") + "</button>" : "")
      + '<button class="btn ghost" data-act="scanamt" data-v="100">100 ' + u + "</button></div></div>"
      + '<p class="hint" id="sCalc">' + scanCalcText(p, g) + "</p>"
      + '<button class="btn pri wide" data-act="scanadd">Add to food</button>'
      + tip("food", "Barcode figures come from Open Food Facts, a free database filled in by volunteers. Check it against the packet if it looks off.") + "</div>";
  }

  /* ---------- Editing logged entries ---------- */
  function editForm(kind, e, i) {
    var food = kind === "food";
    var h = '<div class="edit"><label class="f">Name<input id="edN" value="' + esc(dv("edN", e.name || "")) + '"></label>';
    if (food) h += '<div class="g4"><label class="f">Protein g<input id="edP" inputmode="decimal" value="' + esc(dv("edP", e.p || "")) + '"></label><label class="f">Carbs g<input id="edC" inputmode="decimal" value="' + esc(dv("edC", e.c || "")) + '"></label><label class="f">Fat g<input id="edF" inputmode="decimal" value="' + esc(dv("edF", e.f || "")) + '"></label><label class="f">Calories<input id="edK" inputmode="numeric" value="' + esc(dv("edK", e.kcal || "")) + '"></label></div>';
    else h += '<label class="f">Calories burned<input id="edK" inputmode="numeric" value="' + esc(dv("edK", e.kcal || "")) + '"></label>';
    var saved = isSaved(kind, e.name);
    return h + '<div class="btns"><button class="btn pri" style="flex:1" data-act="editsave">Save</button><button class="btn" data-act="favadd" data-k="' + kind + '" data-i="' + i + '"' + (saved ? " disabled" : "") + ">" + ICON.star + (saved ? "Saved" : "Save for later") + '</button><button class="btn ghost" data-act="editcancel">Cancel</button></div></div>';
  }

  /* ---------- Saved and recent foods / workouts ---------- */
  function savedList(kind, u) { return ((u && u.saved) || {})[kind] || []; }
  function isSaved(kind, name) { var n = String(name || "").toLowerCase(); return savedList(kind, me()).some(function (x) { return x.name.toLowerCase() === n; }); }
  function recentFoods(u) {
    var seen = {}, out = [], todayNames = {};
    ((getDay(u.id, S.date) || {}).food || []).forEach(function (e) { todayNames[(e.name || "").toLowerCase()] = 1; });
    savedList("food", u).forEach(function (x) { seen[x.name.toLowerCase()] = 1; });
    for (var i = 1; i <= 21 && out.length < 6; i++) {
      var day = getDay(u.id, FC.addDays(S.date, -i)); if (!day || !day.food) continue;
      day.food.slice().reverse().forEach(function (e) {
        var n = (e.name || "").toLowerCase();
        if (!e.kcal || !n || n === "food" || n === "day total" || e.src === "diary" || seen[n] || todayNames[n] || out.length >= 6) return;
        seen[n] = 1; out.push({ name: e.name, kcal: e.kcal, p: e.p || 0, c: e.c || 0, f: e.f || 0, w: +e.w || 0 });
      });
    }
    return out;
  }
  function quickChips(kind, u) {
    var sv = savedList(kind, u), rc = kind === "food" ? recentFoods(u) : [], ed = S.favEdit === kind;
    if (!sv.length && !rc.length) return "";
    var chip = function (x, i, src) {
      return '<button class="chip q" data-act="' + (ed && src === "s" ? "favdel" : "quick") + '" data-k="' + kind + '" data-src="' + src + '" data-i="' + i + '">' + esc(x.name) + " <span>" + fmt(x.kcal) + "</span>" + (ed && src === "s" ? " ×" : "") + "</button>";
    };
    var h = '<div class="quick">';
    if (sv.length) h += '<div class="qh"><span>Saved' + (kind === "ex" ? " workouts" : "") + '</span><button class="lnk" data-act="favedit" data-k="' + kind + '">' + (ed ? "Done" : "Edit") + "</button></div>"
      + '<div class="chips">' + sv.map(function (x, i) { return chip(x, i, "s"); }).join("") + "</div>";
    if (rc.length && !ed) h += '<div class="qh"><span>Recent</span></div><div class="chips">' + rc.map(function (x, i) { return chip(x, i, "r"); }).join("") + "</div>";
    return h + (ed ? '<p class="hint">Tap one to remove it.</p>' : tip(kind === "food" ? "food" : "ex", "Tap a chip to add it. To save something, tap it in the list above and choose Save for later.")) + "</div>";
  }

  /* ---------- Free food ideas (built-in list, no Claude) ----------
   * Typical NZ serves, values from USDA / NZ FOODfiles (rounded). */
  var IDEAS = [
    ["Chicken breast, cooked", "150 g", 248, 46.5, 0, 5.4, 150],
    ["Tuna in springwater", "95 g can", 95, 21, 0, 1, 95],
    ["Greek yoghurt, unsweetened low fat", "170 g", 100, 17, 6, 0.7, 170],
    ["Cottage cheese, low fat", "125 g", 90, 15.5, 3.4, 1.3, 125],
    ["Egg whites", "150 g (about 5)", 78, 16, 1, 0.3, 150],
    ["Eggs, boiled", "2 large", 155, 12.6, 1.1, 10.6, 100],
    ["Whey protein shake with water", "1 scoop (30 g)", 120, 24, 3, 1.5, 330],
    ["Lean beef mince (5% fat), cooked", "150 g", 246, 38.4, 0, 9.6, 150],
    ["Salmon, cooked", "120 g", 247, 26.4, 0, 14.9, 120],
    ["Firm tofu", "150 g", 216, 26, 4.2, 13, 150],
    ["Trim milk", "250 ml", 85, 8.5, 12.5, 0.2, 250],
    ["Protein bar", "1 bar (60 g)", 220, 20, 20, 7, 60],
    ["Edamame, shelled", "100 g", 121, 11.9, 8.9, 5.2, 100],
    ["Banana", "1 medium", 105, 1.3, 27, 0.4, 118],
    ["Apple", "1 medium", 95, 0.5, 25, 0.3, 182],
    ["White rice, cooked", "150 g", 195, 4, 42, 0.4, 150],
    ["Kumara, cooked", "150 g", 135, 3, 31, 0.2, 150],
    ["Weet-Bix with trim milk", "2 biscuits + 150 ml", 168, 9, 29.6, 0.6, 183],
    ["Wholemeal bread", "2 slices", 176, 8.7, 30, 2.5, 70],
    ["Peanut butter", "2 tbsp (32 g)", 190, 7, 7, 16, 32],
    ["Almonds", "30 g", 174, 6.4, 6.5, 15, 30],
    ["Oats with full-fat milk", "80 g + 300 ml", 486, 20, 68, 15, 380],
    ["Avocado", "half", 120, 1.5, 6.4, 11, 75],
    ["Trail mix", "50 g", 231, 6.9, 22.5, 14.7, 50],
    ["Cheddar cheese", "30 g", 121, 7.5, 0.4, 9.9, 30]
  ].map(function (r, i) { return { i: i, name: r[0], serve: r[1], kcal: r[2], p: r[3], c: r[4], f: r[5], g: r[6] }; });

  /* ---------- Water in food ----------
   * Roughly what isn't protein, carbs or fat is water (less ~2% for fibre and minerals). Cooked rice comes out
   * near 68%, chicken near 65%, fruit and milk near 85-90%, peanut butter near 0, which matches food tables
   * closely. Only works where the weight is known: barcode scans, Claude meal estimates and the food ideas. */
  function waterFrom(g, p, c, f) { g = +g || 0; if (g <= 0) return 0; return Math.max(0, Math.round(g - (+p || 0) - (+c || 0) - (+f || 0) - 0.02 * g)); }
  function foodWater(u, day) { if (u.foodWater === false) return 0; var w = 0; ((day && day.food) || []).forEach(function (e) { w += +e.w || 0; }); return Math.round(w); }
  function waterTotal(u, day) { return (+(day && day.water) || 0) + foodWater(u, day); }

  // Same picks all day, different mix each day
  function rotate(list) { var n = list.length; if (n < 2) return list; var k = Math.floor(Date.now() / 864e5) % n; return list.slice(k).concat(list.slice(0, k)); }
  function pickIdeas(u, a, ft) {
    var st = u.status || "maintain", pg = +u.proteinGoal || 0;
    var kLeft = Math.round(a.goal - a.net), pLeft = pg ? Math.round(pg - ft.p) : 0;
    var lean = function (x) { return x.p / x.kcal; };
    var fits = function (x) { return st === "bulk" || x.kcal <= Math.max(kLeft, 0) + 20; };
    var r = { kLeft: kLeft, pLeft: pLeft, list: [], msg: "" };
    if (st !== "bulk" && kLeft < 0) {
      var walk = FC.exerciseCal(FC.walkMET(5.5, 0), 30, bodyOf(u));
      r.msg = fmt(-kLeft) + " cal over today, so nothing more to eat. A 30 minute brisk walk burns about " + fmt(walk) + " cal if you want to claw some back.";
      return r;
    }
    if (pg && pLeft >= 10) {
      var opts = IDEAS.filter(function (x) { return x.p >= 8 && fits(x); }).sort(function (x, y) { return lean(y) - lean(x); });
      if (st === "bulk") opts = IDEAS.filter(function (x) { return x.p >= 8; }).sort(function (x, y) { return y.p - x.p; });
      r.list = rotate(opts.slice(0, 6)).slice(0, 3);
      r.msg = st === "bulk" ? "Protein-packed picks:" : kLeft < 250 ? "Calories are tight. Most protein for the fewest calories:" : "Lean protein first:";
      if (!r.list.length) r.msg = pLeft + " g protein short, but there isn't room for more food today. Front-load protein tomorrow.";
      return r;
    }
    if (st === "bulk" && kLeft > 150) {
      r.list = IDEAS.filter(function (x) { return x.kcal >= 170; }).sort(function (x, y) { return y.kcal / 100 + y.p / 10 - (x.kcal / 100 + x.p / 10); }).slice(0, 3);
      r.msg = (pg ? "Protein's done. " : "") + "Easy calorie-dense options:";
      return r;
    }
    if (kLeft > 150) {
      r.list = IDEAS.filter(function (x) { return x.kcal <= kLeft && x.c >= 20 && x.p < 12; }).sort(function (x, y) { return x.kcal - y.kcal; }).slice(0, 3);
      r.msg = (pg ? "Protein's done. " : "") + "Fill the rest with carbs for training:";
      return r;
    }
    r.msg = pg ? "Protein and calories are both on target. Nothing needed." : "Right on your calories. Set a protein goal under Goals to get protein tips.";
    return r;
  }
  function ideasCard(u, a, ft) {
    var r = pickIdeas(u, a, ft);
    var h = '<div class="card">' + head("bulb", "Ideas", (r.pLeft > 0 ? r.pLeft + " g protein · " : "") + (r.kLeft >= 0 ? fmt(r.kLeft) + " cal left" : fmt(-r.kLeft) + " cal over")) + "<p class=\"hint\" style=\"margin-bottom:" + (r.list.length ? "10px" : "0") + '">' + esc(r.msg) + "</p>";
    if (r.list.length) h += '<div class="list" style="margin:0">' + r.list.map(function (x) {
      return '<div class="row">' + rowIcon("bulb", "idea") + '<div class="t"><b>' + esc(x.name) + "</b><small>" + esc(x.serve) + " · " + fmt(x.kcal) + ' cal</small></div><span class="ppill">' + fmt(x.p) + 'g P</span><button class="btn ghost sm" data-act="ideaadd" data-i="' + x.i + '" aria-label="Add ' + esc(x.name) + '">' + ICON.plus + "</button></div>";
    }).join("") + "</div>";
    return h + "</div>";
  }

  /* ---------- Meal estimate with Claude (photo and/or description) ---------- */
  function mealTotals(items) {
    var t = { kcal: 0, p: 0, c: 0, f: 0 };
    (items || []).forEach(function (i) { t.kcal += +i.kcal || 0; t.p += +i.protein_g || 0; t.c += +i.carbs_g || 0; t.f += +i.fat_g || 0; });
    t.kcal = Math.round(t.kcal); t.p = Math.round(t.p * 10) / 10; t.c = Math.round(t.c * 10) / 10; t.f = Math.round(t.f * 10) / 10;
    return t;
  }
  function photosLeft() { return S.photos && S.photos.d === today() ? S.photos.n : null; }
  function photoNote() { var n = photosLeft(); return n == null ? "" : '<p class="hint pleft' + (n ? "" : " none") + '">' + ICON.camera + (n ? n + " photo" + (n === 1 ? "" : "s") + " left today" : "No photos left today. Describe the meal in words instead.") + "</p>"; }
  function mealBlock() {
    if (!S.claude) return "";
    if (photosLeft() === 0 && S.mealImg) S.mealImg = null; // out of photos: estimate from the words only
    var r = S.meal, h = '<div class="meal">';
    if (r) {
      var t = mealTotals(r.items);
      h += '<div class="sh"><div class="t"><b>' + esc(r.name) + '</b><small>Claude estimate · ' + esc(r.confidence) + " confidence</small></div>"
        + '<button class="x" data-act="mealclear" aria-label="Discard">×</button></div>'
        + '<div class="list">' + r.items.map(function (i) {
          return '<div class="row"><div class="t"><b>' + esc(i.name) + "</b><small>" + fmt(i.grams) + " g · P " + fmt(i.protein_g) + " · C " + fmt(i.carbs_g) + " · F " + fmt(i.fat_g) + '</small></div><span class="k">' + fmt(i.kcal) + "</span></div>";
        }).join("") + "</div>"
        + (r.assumptions ? '<p class="hint">' + esc(r.assumptions) + "</p>" : "")
        + '<div class="g2"><label class="f">Calories to log<input id="mK" inputmode="numeric" value="' + esc(String(dv("mK", t.kcal))) + '"></label><div style="display:flex;align-items:flex-end"><button class="btn pri wide" data-act="mealadd">Add to food</button></div></div>'
        + '<div class="mtot">' + macBar(t.p, t.c, t.f) + macText(t) + "</div>" + tip("food", "Change the calories if it looks off and the macros scale with it.");
    } else {
      h += '<label class="f">Describe a meal or snap a photo<textarea id="mText" placeholder="e.g. 180 g chicken breast, 120 g cooked rice, 1 tbsp olive oil">' + esc(dv("mText", "")) + "</textarea></label>"
        + photoNote()
        + (S.mealImg ? '<div class="mealimg"><img src="' + S.mealImg + '" alt="Meal photo"><button class="x" data-act="mealnoimg" aria-label="Remove photo">×</button></div>' : "")
        + (S.photoBusy ? '<p class="hint pleft">' + ICON.camera + "Processing photo...</p>" : "")
        + '<div class="btns"><button class="btn" data-act="photo" data-v="cam"' + (S.mealBusy || S.photoBusy || photosLeft() === 0 ? " disabled" : "") + ">" + ICON.camera + "Camera</button>"
        + '<button class="btn" data-act="photo" data-v="lib"' + (S.mealBusy || S.photoBusy || photosLeft() === 0 ? " disabled" : "") + ">" + ICON.gallery + "Gallery</button></div>"
        + '<div class="btns"><button class="btn pri" style="flex:1" data-act="meal"' + (S.mealBusy ? " disabled" : "") + ">" + ICON.spark + (S.mealBusy ? "Asking Claude..." : "Estimate with Claude") + "</button></div>"
        + tip("food", "Weights give the best answer. Photos are a rough guess, so check before adding.");
    }
    return h + "</div>";
  }
  // Shrink the photo on the phone before sending: smaller upload, lower cost (about 1,200 image tokens).
  function shrinkPhoto(file) {
    return new Promise(function (ok, fail) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var max = 1024, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement("canvas"); cv.width = Math.round(w * k); cv.height = Math.round(h * k);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        ok(cv.toDataURL("image/jpeg", 0.8));
      };
      img.onerror = function () { URL.revokeObjectURL(url); fail(new Error("Couldn't read that photo")); };
      img.src = url;
    });
  }

  function renderMe(fromSync) {
    renderMeOnly(fromSync);
    if (window.FCTrain) FCTrain.render(fromSync);
  }
  function renderMeOnly(fromSync) {
    var el = $("#me"); if (!el) return;
    if (fromSync && el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; // don't wipe typing
    var u = me(); if (!u) { el.innerHTML = ""; return; }
    var d = S.date, t = today(), day = getDay(u.id, d) || { food: [], ex: [] };
    var a = FC.assess(u, day, isFinal(d), d), ft = FC.foodTotals(day), w = FC.weightStats(u);
    var h = '<div class="datebar"><button class="icon" data-act="day" data-v="-1" aria-label="Previous day">' + ICON.left + "</button><b>" + esc(dayLabel(d)) + '</b><button class="icon" data-act="day" data-v="1" aria-label="Next day"' + (d >= t ? " disabled" : "") + ">" + ICON.right + "</button></div>";

    // Summary: eaten on top, burned underneath
    h += summaryCard(u, a, ft);
    h += wkCard(u, d);
    if (0) h += '<div class="card"><div class="summary">' + ring(a, 104) + '<div class="big"><span class="lbl">Calories eaten</span><span class="eat num">' + fmt(a.eaten) + '<span class="unit">/ ' + fmt(a.goal) + '</span></span><span class="lbl" style="margin-top:6px">Burned exercising</span><span class="brn num">' + fmt(a.burned) + '<span class="unit">cal</span></span></div></div>'
      + '<div class="status ' + a.state + '">' + esc(a.msg) + (a.logged ? " · net " + fmt(a.net) : "") + "</div>" + macroTiles(u, ft) + "</div>";

    // Food
    var food = day.food || [];
    h += '<div class="card">' + head("utensils", "Food", fmt(ft.kcal) + " cal", "food");
    if (hasDiary()) {
      var dd = readDiary(d) || { kcal: 0, items: 0 };
      h += '<div class="diary"><div class="t"><b>Calorie Diary</b><br><span class="muted">' + (dd.items ? fmt(dd.kcal) + " cal from " + dd.items + " items" : "Nothing logged there for this day") + '</span></div><button class="btn" data-act="diary"' + (dd.items ? "" : " disabled") + ">Pull</button></div>"
        + '<label class="toggle" style="margin:-4px 0 12px"><input type="checkbox" data-act="diaryauto"' + (lsGet(LS.diary, "") === "1" ? " checked" : "") + "> Keep today and weigh-ins synced from Calorie Diary</label>";
    }
    h += food.length ? '<div class="list">' + food.map(function (e, i) {
      if (S.edit && S.edit.kind === "food" && S.edit.i === i) return editForm("food", e, i);
      var m = macText(e);
      return '<div class="row">' + rowIcon(FOOD_IC[e.src] || "utensils") + '<div class="t tap" data-act="edit" data-k="food" data-i="' + i + '" role="button" tabindex="0"><b>' + esc(e.name || "Food") + "</b>" + (m ? m + macBar(+e.p || 0, +e.c || 0, +e.f || 0) : "<small>Tap to edit</small>") + '</div><span class="k">' + fmt(e.kcal) + '</span><button class="x" data-act="delfood" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join("") + "</div>" : '<p class="empty">Nothing logged yet. Add meals as you go, or one total at the end of the day.</p>';
    h += quickChips("food", u);
    h += scanBlock();
    h += mealBlock();
    h += '<div class="stack"><label class="f">What (optional)<input id="fName" placeholder="e.g. Lunch, or Day total" value="' + esc(dv("fName", "")) + '"></label>'
      + '<div class="g4"><label class="f">Protein g<input id="fP" inputmode="decimal" value="' + esc(dv("fP", "")) + '"></label><label class="f">Carbs g<input id="fC" inputmode="decimal" value="' + esc(dv("fC", "")) + '"></label><label class="f">Fat g<input id="fF" inputmode="decimal" value="' + esc(dv("fF", "")) + '"></label><label class="f">Calories<input id="fK" inputmode="numeric" placeholder="' + (FC.macroCal(dv("fP"), dv("fC"), dv("fF")) || "") + '" value="' + esc(dv("fK", "")) + '"></label></div>'
      + tip("food", "Leave calories blank and it works them out from the macros (4/4/9 per gram).")
      + '<button class="btn pri wide" data-act="addfood">Add food</button></div></div>';

    if (d === t) h += ideasCard(u, a, ft);
    h += waterCard(u, day);

    // Exercise: summary only. Logging and editing live on the Train page.
    var ex = day.ex || [];
    h += '<div class="card">' + head("flame", "Exercise", fmt(a.burned) + " cal burned");
    h += ex.length ? '<div class="list">' + ex.map(function (e) {
      return '<div class="row">' + rowIcon(EX_IC[e.src] || "flame", "ex") + '<div class="t"><b>' + esc(e.name) + "</b><small>" + esc(e.note || "") + '</small></div><span class="k">' + fmt(e.kcal) + "</span></div>";
    }).join("") + "</div>" : '<p class="empty">No exercise logged.</p>';
    h += '<button class="btn wide" data-act="gotrain">' + ICON.dumbbell + "Log or edit on Train</button></div>";

    // Weight
    var wt = (u.weights || []).filter(function (x) { return x[0] === d; })[0];
    h += '<div class="card">' + head("scale", "Weight") + '<div class="stats"><div class="stat"><span>Start</span><b>' + kg(w.start) + '</b></div><div class="stat"><span>Now</span><b>' + kg(w.current) + '</b></div><div class="stat"><span>Change</span><b class="' + (w.progress > 0 ? "good" : w.progress < 0 ? "bad" : "") + '">' + signed(w.change, 1) + "</b></div></div>"
      + '<div class="chart">' + lineChart([{ color: u.color, pts: weightPts(u) }], { label: "My weight", target: w.target || 0, extra: w.target ? [w.target] : [], empty: "Log a weigh-in to start the chart." }) + "</div>"
      + '<div class="g2" style="margin-top:12px"><label class="f">Weight on ' + esc(dayLabel(d).toLowerCase()) + ' (kg)<input id="wKg" inputmode="decimal" value="' + esc(dv("wKg", wt ? wt[1] : "")) + '"></label><div style="display:flex;align-items:flex-end;gap:8px"><button class="btn pri" style="flex:1" data-act="addweight">Save</button>' + (wt ? '<button class="btn ghost" data-act="delweight" aria-label="Remove weigh-in">×</button>' : "") + "</div></div></div>";

    h += measCard(u, d);
    h += badgesCard(u, true);
    h += '<button class="btn wide setbtn" data-act="settings">' + ICON.gear + "Settings: profile, goals, sharing, PIN</button>";
    el.innerHTML = h;
  }
  /* ---------- Exercise pieces shown on the Train page (always for the day picked with the date arrows) ---------- */
  function exListHtml(u) {
    var d = S.date, ex = ((getDay(u.id, d) || {}).ex) || [];
    var h = ex.length ? '<div class="list">' + ex.map(function (e, i) {
      if (S.edit && S.edit.kind === "ex" && S.edit.i === i) return editForm("ex", e, i);
      return '<div class="row">' + rowIcon(EX_IC[e.src] || "flame", "ex") + '<div class="t tap" data-act="edit" data-k="ex" data-i="' + i + '" role="button" tabindex="0"><b>' + esc(e.name) + "</b><small>" + esc(e.note || (e.src === "manual" ? "Entered by hand" : "Tap to edit")) + '</small></div><span class="k">' + fmt(e.kcal) + '</span><button class="x" data-act="delex" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join("") + "</div>" : '<p class="empty">Nothing logged ' + (d === today() ? "today" : "this day") + ".</p>";
    return h + quickChips("ex", u);
  }
  function exLogHtml(mode) {
    var u = me(), h = "";
    if (mode === "watch") {
      return '<div class="stack"><label class="f">What was it (optional)<input id="eName" placeholder="e.g. Football training" value="' + esc(dv("eName", "")) + '"></label>'
        + '<label class="f">Calories from your watch<input id="eK" inputmode="numeric" value="' + esc(dv("eK", "")) + '"></label>'
        + '<button class="btn pri wide" data-act="addmanual">' + ICON.check2 + "Add</button></div>";
    }
    h += '<div class="stack"><label class="f">Describe it<textarea id="eText" placeholder="e.g. 45 min incline walk at 8% and 5.5 km/h, then 20 min swim">' + esc(dv("eText", "")) + "</textarea></label>";
    if (S.est) {
      var tot = 0;
      h += '<div class="est"><b>Estimate</b>' + S.est.activities.map(function (x) {
        var c = FC.exerciseCal(x.met, x.minutes, bodyOf(u)); tot += c;
        return '<div class="a"><div>' + esc(x.name) + " · " + fmt(x.minutes) + " min<small>MET " + x.met + " · " + esc(x.note) + '</small></div><b class="num">' + fmt(c) + "</b></div>";
      }).join("") + (S.est.assumptions ? '<p class="hint">' + esc(S.est.assumptions) + "</p>" : "")
        + tip("ex", "Net calories above resting, using your weight, height, age and sex. Got a watch reading? Type it below to override.")
        + '<div class="g2"><label class="f">Calories to log<input id="eK" inputmode="numeric" value="' + esc(dv("eK", tot)) + '"></label><div style="display:flex;align-items:flex-end;gap:8px"><button class="btn pri" style="flex:1" data-act="addest">Log it</button><button class="btn ghost" data-act="clearest" aria-label="Discard">×</button></div></div></div>';
    } else h += '<button class="btn pri wide" data-act="estimate">' + ICON.spark + (S.claude ? "Estimate with Claude" : "Estimate") + "</button>"
      + tip("ex", S.claude ? "Claude reads what you did and works out the calories. Each estimate uses a small amount of your Claude credit. If Claude can't be reached, the free built-in estimate is used." : "The built-in estimate reads what you did and works out the calories. It's free.");
    return h + "</div>";
  }

  /* ---------- Weekend calories ---------- */
  var WKD = [[5, "Fri"], [6, "Sat"], [0, "Sun"]];
  function dayNames(list) { var n = WKD.filter(function (x) { return list.indexOf(x[0]) >= 0; }).map(function (x) { return x[1]; }); return n.length > 1 ? n.slice(0, -1).join(", ") + " and " + n[n.length - 1] : n[0] || ""; }
  function wkPlanText(u, list) {
    var e = FC.wkExtra(u), n = list.length; if (!n) return "No high days picked, so every day uses your normal goal.";
    var cut = Math.round(e * n / (7 - n)), g = +u.goalKcal || 2000;
    return dayNames(list) + ": " + fmt(g + e) + " cal (+" + fmt(e) + "). Other days: " + fmt(g - cut) + " cal (" + fmt(cut) + " less). The week stays at " + fmt(g * 7) + ".";
  }
  function wkSettings(u) {
    var w = u.wknd || {}, on = !!w.on, days = w.days || [6, 0];
    var h = '<button class="row sharerow fwtog" data-act="wkon" role="switch" aria-checked="' + on + '"><div class="t"><b>Weekend calories</b><small>' + (on ? "On: higher on " + (dayNames(days) || "no days yet") : "Off") + '</small></div><span class="tog' + (on ? " on" : "") + '"><i></i></span></button>';
    if (!on) return h;
    return h + '<div class="wkset"><div class="chips">' + WKD.map(function (x) { return '<button class="chip' + (days.indexOf(x[0]) >= 0 ? " on" : "") + '" data-act="wkusual" data-v="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>"
      + '<label class="f">Extra per high day<input id="gWk" inputmode="numeric" value="' + esc(dv("gWk", FC.wkExtra(u))) + '"></label></div>'
      + '<p class="hint">' + esc(wkPlanText(u, days)) + "</p>"
      + tip("wknd", "Your usual high days. From Friday, the Me page lets you change this weekend's days if plans change. The extra comes off the other days of the same Monday to Sunday week, so your weekly total doesn't change. Choose 100 to 1,000 extra per high day.");
  }
  // On the Me page: Fri to Sun lets you pick this weekend's days; Mon to Thu shows why the goal is lower
  function wkCard(u, d) {
    var w = u.wknd; if (!w || !w.on || d !== today()) return "";
    var dow = new Date(d + "T12:00:00").getDay(), hi = FC.highDays(u, d), base = +u.goalKcal || 2000, g = FC.goalFor(u, d);
    if (WKD.every(function (x) { return x[0] !== dow; })) {
      return hi.length ? '<div class="wkhint">' + ICON.cal + "<span>Weekend plan: today's goal is " + fmt(g) + " (" + fmt(base - g) + " less) so " + esc(dayNames(hi)) + " can be +" + fmt(FC.wkExtra(u)) + ".</span></div>" : "";
    }
    var order = [5, 6, 0], pos = order.indexOf(dow);
    var h = '<div class="card">' + head("cal", "This weekend", g !== base ? "today " + fmt(g) + " cal" : "", "wknd2") + '<div class="chips wkchips">' + WKD.map(function (x, i) {
      var past = i < pos;
      return '<button class="chip' + (hi.indexOf(x[0]) >= 0 ? " on" : "") + '" data-act="wkday" data-v="' + x[0] + '"' + (past ? " disabled" : "") + ">" + x[1] + (hi.indexOf(x[0]) >= 0 ? " +" + fmt(FC.wkExtra(u)) : "") + "</button>";
    }).join("") + "</div>";
    return h + '<p class="hint">' + esc(wkPlanText(u, hi)) + "</p>" + tip("wknd2", "Tap a day to make it a high day this weekend or not. Days already gone are locked. Changing it also adjusts the earlier days this week, so the weekly total stays the same and those days may change between on and off track. Your usual days are in Settings > Goals.") + "</div>";
  }

  /* ---------- Settings (opens as a sheet from the gear) ---------- */
  function sharingCard(u) {
    var others = S.cache.users.filter(function (x) { return x.id !== u.id; }), hide = u.hide || [];
    var h = '<div class="card">' + head("eye", "Sharing", "", "share") + tip("share", "Ticked people see your food, calories, weight, workouts and lifts. Unticked people can't see you at all, not even on the leaderboard. New people who join are ticked automatically. Your PIN keeps this private: the Google script only sends your data to people you've ticked.");
    if (!others.length) return h + '<p class="empty">No one else in the crew yet.</p></div>';
    h += '<div class="list" style="margin:0">' + others.map(function (x) {
      var on = hide.indexOf(x.id) < 0;
      return '<button class="row sharerow" data-act="share" data-id="' + x.id + '" role="switch" aria-checked="' + on + '">' + avatar(x) + '<div class="t"><b>' + esc(x.name) + "</b><small>" + (on ? "Can see your data" : "Can't see you") + '</small></div><span class="tog' + (on ? " on" : "") + '"><i></i></span></button>';
    }).join("") + "</div>";
    return h + "</div>";
  }
  function renderSettings(fromSync) {
    var el = $("#panel"); if (!el) return;
    if (fromSync && el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    var u = me(); if (!u) return closeSheet();
    var w = FC.weightStats(u), h = '<div class="grab"></div><div class="phead"><span class="hic big">' + ICON.gear + '</span><div><h2>Settings</h2><div class="tag">' + esc(u.name) + '</div></div><button class="x" data-act="close" aria-label="Close">×</button></div>';
    // Goals
    var st = dv("gStatus", u.status || "maintain");
    h += '<div class="card">' + head("target", "Goals", "", "goals") + '<div class="stack"><div class="seg">' + ["cut", "maintain", "bulk"].map(function (s) { return '<button class="' + (st === s ? "on" : "") + '" data-act="gstatus" data-v="' + s + '">' + STATUS[s] + "</button>"; }).join("") + "</div>"
      + '<div class="g2"><label class="f">Water goal (ml a day)<input id="gWater" inputmode="numeric" value="' + esc(dv("gWater", u.waterGoal || 2000)) + '"></label>'
      + '<button class="row sharerow fwtog" data-act="foodwater" role="switch" aria-checked="' + (u.foodWater !== false) + '"><div class="t"><b>Water from food</b><small>' + (u.foodWater !== false ? "Counted" : "Not counted") + '</small></div><span class="tog' + (u.foodWater !== false ? " on" : "") + '"><i></i></span></button></div>'
      + wkSettings(u)
      + '<div class="g3"><label class="f">Daily cal goal<input id="gKcal" inputmode="numeric" value="' + esc(dv("gKcal", u.goalKcal || "")) + '"></label><label class="f">Protein g<input id="gP" inputmode="numeric" value="' + esc(dv("gP", u.proteinGoal || "")) + '"></label><label class="f">Target kg<input id="gT" inputmode="decimal" value="' + esc(dv("gT", u.targetWeight || "")) + '"></label></div>'
 + tip("goals", goalHint(st)) + '<p class="hint">Suggested for you: <b>' + fmt(FC.suggestGoal(Object.assign({}, u, { status: st }), w.current)) + ' cal</b> <button class="btn ghost" style="padding:2px 10px" data-act="suggest">Use</button></p>'
      + '<button class="btn pri wide" data-act="savegoals">Save goals</button></div></div>';

    // Profile and group
    h += '<div class="card">' + head("user", "Profile", "", "profile") + '<div class="stack"><label class="f">Name<input id="pName" value="' + esc(dv("pName", u.name)) + '"></label>'
      + '<div class="g3"><label class="f">Height cm<input id="pH" inputmode="numeric" value="' + esc(dv("pH", u.heightCm || "")) + '"></label><label class="f">Birth year<input id="pY" inputmode="numeric" value="' + esc(dv("pY", u.birthYear || "")) + '"></label><label class="f">Sex<select id="pS">' + sexOpts(dv("pS", u.sex || "")) + "</select></label></div>"
      + '<label class="f">Starting weight kg<input id="pW" inputmode="decimal" value="' + esc(dv("pW", u.startWeight || "")) + '"></label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + COLOURS.map(function (c) { return '<button aria-label="Colour" data-act="colour" data-v="' + c + '" style="width:30px;height:30px;border-radius:50%;border:3px solid ' + ((dv("pC", u.color) === c) ? "var(--text)" : "transparent") + ";background:" + c + '"></button>'; }).join("") + "</div>"
      + tip("profile", "Height, age and sex sharpen the burn estimates and the suggested goal.")
      + '<button class="btn pri wide" data-act="saveprofile">Save profile</button></div></div>';
    h += sharingCard(u);
    if (window.FCTrain) h += FCTrain.noEquipHtml(u);
    h += '<div class="card">' + head("lock", "Security") + '<div class="stack">' + (S.pinless ? '<p class="hint">PINs need the updated Google script.</p>' : '<button class="btn wide" data-act="changepin">' + ICON.lock + "Change my PIN</button>")
      + '<button class="btn ghost wide" data-act="switch">Switch person on this phone</button></div></div>';
    h += '<div class="card">' + head("users", "Crew", "", "crew") + '<div class="stack"><button class="btn wide" data-act="invite">' + ICON.share + 'Share invite link</button>' + tip("crew", "Anyone with the link can join the crew. Only send it to people you want in.")
      + '<button class="btn danger wide" data-act="leave">Delete my profile and data</button>'
      + tip("crew", "Sync: " + esc(S.err ? "offline (" + S.err + ")" : S.lastSync ? "last synced " + new Date(S.lastSync).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" }) : "waiting") + (S.outbox.length ? ", " + S.outbox.length + " change(s) waiting to send" : "") + ". Workout estimates: " + (S.claude ? "Claude" : "built-in formula") + ".") + "</div></div>";
    el.innerHTML = h;
  }
  function goalHint(st) {
    return st === "cut" ? "Cutting: stay at or under your goal. Exercise earns calories back."
      : st === "bulk" ? "Bulking: reach your goal each day, after what you burn."
        : "Maintaining: land within 10% of your goal.";
  }
  function sexOpts(v) {
    return [["", "Rather not say"], ["m", "Male"], ["f", "Female"]].map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === v ? " selected" : "") + ">" + o[1] + "</option>"; }).join("");
  }

  /* ---------- Gate: invite + who are you ---------- */
  /* ---------- PIN ---------- */
  // Asks the server whether this person has a PIN yet. Old scripts without PINs just carry on.
  function checkPin() {
    S.pinChecked = true;
    return call("login").then(function (r) {
      if (r.nopin) { S.gate = "create"; S.pinBuf = ""; render(); }
      else if (S.gate === "checking") { S.gate = null; render(); sync(); }
    }).catch(function (e) {
      if (/Unknown action/.test(e.message)) { S.pinless = true; if (S.gate) { S.gate = null; render(); } }
      else if (e.pin) { S.gate = "enter"; S.pinBuf = ""; render(); }
      else if (S.gate === "checking") { S.pinChecked = false; S.pinErr = e.message; render(); }
    });
  }
  var PIN_TXT = {
    checking: ["One moment", ""],
    enter: ["Enter your PIN", ""],
    create: ["Create a 4-digit PIN", "Stops anyone else opening the app as you. If you forget it, whoever set up the app can reset it."],
    confirm: ["Type it again", ""],
    "change-new": ["New PIN", ""],
    "change-confirm": ["Type the new PIN again", ""]
  };
  function pinScreen() {
    var u = me() || user(S.me) || { name: "You", color: COLOURS[0] }, t = PIN_TXT[S.gate] || PIN_TXT.enter, n = S.pinBuf.length;
    var h = '<div class="wrap pinwrap"><div class="pinwho">' + avatar(u, true) + "<b>" + esc(u.name) + "</b></div><h2>" + t[0] + "</h2>";
    if (S.gate === "checking") return h + '<p class="muted">Checking your sign-in...</p>' + (S.pinErr ? '<p class="bad">' + esc(S.pinErr) + '</p><button class="btn" data-act="pinretry">Try again</button>' : "") + "</div>";
    h += '<div class="pindots' + (S.pinErr ? " shake" : "") + '">' + [0, 1, 2, 3].map(function (i) { return "<i" + (i < n ? ' class="on"' : "") + "></i>"; }).join("") + "</div>"
      + '<p class="pinerr">' + esc(S.pinErr || t[1]) + "</p>"
      + '<div class="keypad">' + ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"].map(function (k) {
        return k === "" ? "<span></span>" : '<button data-act="pinkey" data-v="' + k + '"' + (k === "back" ? ' aria-label="Delete"' : "") + ">" + (k === "back" ? "⌫" : k) + "</button>";
      }).join("") + "</div>";
    h += /^change/.test(S.gate) ? '<button class="btn ghost" data-act="pincancel">Cancel</button>' : '<button class="lnk pinswitch" data-act="switch">Not ' + esc(u.name) + "? Switch person</button>";
    return h + "</div>";
  }
  function pinDone(code) {
    var g = S.gate;
    if (g === "enter") {
      var keep = S.pin; S.pin = code;
      call("login").then(function () {
        lsSet(LS.pin, code); S.gate = null; S.pinErr = ""; S.pinBuf = ""; S.pinChecked = true; render(); sync();
      }).catch(function (e) { S.pin = keep; S.pinErr = e.message; S.pinBuf = ""; render(); });
      return;
    }
    if (g === "create" || g === "change-new") { S.pinFirst = code; S.pinBuf = ""; S.pinErr = ""; S.gate = g === "create" ? "confirm" : "change-confirm"; render(); return; }
    if (g === "confirm" || g === "change-confirm") {
      if (code !== S.pinFirst) { S.pinErr = "Those didn't match. Start again."; S.pinBuf = ""; S.gate = g === "confirm" ? "create" : "change-new"; render(); return; }
      call("setPin", { newPin: code }).then(function () {
        S.pin = code; lsSet(LS.pin, code); S.gate = null; S.pinBuf = ""; S.pinErr = ""; S.pinChecked = true; toast(g === "confirm" ? "PIN set. Nobody else can open the app as you." : "PIN changed"); render(); sync();
      }).catch(function (e) { S.pinErr = e.message; S.pinBuf = ""; render(); });
    }
  }

  function renderGate() {
    var g = $("#gate");
    if (!API) { g.innerHTML = '<div class="wrap"><h1>Fit <b>Crew</b></h1><p class="muted">The app isn\'t connected to its backend yet. Whoever set it up needs to add the web app URL to config.js.</p></div>'; g.classList.add("open"); return true; }
    if (!S.code) { g.innerHTML = '<div class="wrap"><h1>Fit <b>Crew</b></h1><p class="muted">Open this app from the invite link your mate sent you. It carries the crew\'s code.</p>' + (S.err ? '<p class="bad">' + esc(S.err) + "</p>" : "") + "</div>"; g.classList.add("open"); return true; }
    if (S.me && S.gate) { g.innerHTML = pinScreen(); g.classList.add("open"); return true; }
    if (S.me && me()) { g.classList.remove("open"); return false; }
    var list = users();
    var h = '<div class="wrap"><h1>Fit <b>Crew</b></h1><p class="muted">Who are you?</p>';
    if (!list.length && !S.lastSync) h += '<p class="muted">' + (S.err ? esc(S.err) : "Loading the crew...") + "</p>";
    list.forEach(function (u) { h += '<button class="pick" data-act="pick" data-id="' + u.id + '">' + avatar(u) + "<b>" + esc(u.name) + '</b><span class="tag" style="margin-left:auto">' + STATUS[u.status || "maintain"] + "</span></button>"; });
    var st = dv("nStatus", "cut");
    h += '<div class="card" style="margin-top:18px"><h2>New here? Add yourself</h2><div class="stack">'
      + '<label class="f">Name<input id="nName" value="' + esc(dv("nName", "")) + '"></label>'
      + '<div class="g2"><label class="f">Starting weight kg<input id="nW" inputmode="decimal" value="' + esc(dv("nW", "")) + '"></label><label class="f">Height cm<input id="nH" inputmode="numeric" value="' + esc(dv("nH", "")) + '"></label></div>'
      + '<div class="g2"><label class="f">Birth year<input id="nY" inputmode="numeric" value="' + esc(dv("nY", "")) + '"></label><label class="f">Sex<select id="nS">' + sexOpts(dv("nS", "")) + "</select></label></div>"
      + '<div class="seg">' + ["cut", "maintain", "bulk"].map(function (s) { return '<button class="' + (st === s ? "on" : "") + '" data-act="nstatus" data-v="' + s + '">' + STATUS[s] + "</button>"; }).join("") + "</div>"
      + '<label class="f">Daily calorie goal<input id="nK" inputmode="numeric" placeholder="Leave blank for a suggestion" value="' + esc(dv("nK", "")) + '"></label>'
      + '<button class="btn pri wide" data-act="join">Join the crew</button></div></div></div>';
    g.innerHTML = h; g.classList.add("open");
    return true;
  }

  /* ---------- Render ---------- */
  function render(fromSync) {
    paintSync();
    if (renderGate()) return;
    renderCrew();
    renderMe(fromSync);
    if (S.sheet) renderProfile(S.sheet, fromSync);
  }

  /* ---------- Actions ---------- */
  function num(id) { var el = document.getElementById(id); var v = el ? parseFloat(String(el.value).replace(",", ".")) : NaN; return isNaN(v) ? 0 : v; }
  function val(id) { var el = document.getElementById(id); return el ? el.value.trim() : ""; }
  function clearDraft(keys) { keys.forEach(function (k) { delete S.draft[k]; }); }

  var ACT = {
    board: function (b) { S.board = b.dataset.v; lsSet(LS.board, S.board); renderCrew(); },
    profile: function (b) { openSheet(b.dataset.id); },
    close: closeSheet,
    kudos: function (b) {
      var to = b.dataset.id, t = today(), on = !kudosFor(to, t).some(function (k) { return k.from === S.me; });
      setKudos(S.me, to, t, on); persist();
      queue({ action: "kudos", from: S.me, to: to, date: t, on: on });
      if (on) { celebrate(b); toast("High five sent to " + (user(to) || {}).name); }
      bump("hf", on ? 1 : -1);
      render();
    },
    day: function (b) { var n = FC.addDays(S.date, +b.dataset.v); if (n <= today()) { S.date = n; S.est = null; S.edit = null; clearDraft(["wKg", "eK"]); renderMe(); } },
    addfood: function () {
      var p = num("fP"), c = num("fC"), f = num("fF"), k = Math.round(num("fK")) || FC.macroCal(p, c, f);
      if (!k) return toast("Enter calories or macros");
      changeDay(S.date, function (d) { d.food.push({ id: uid(), name: val("fName") || "Food", p: p, c: c, f: f, kcal: k, src: "manual" }); });
      clearDraft(["fName", "fP", "fC", "fF", "fK"]); renderMe();
    },
    scan: function () {
      window.FCScan.open(function (code) {
        toast("Looking up " + code + "...");
        window.FCScan.lookup(code).then(function (p) {
          if (!p) { toast("Not in the food database yet. Type the label figures below."); return; }
          if (p.noData) { if (p.name) S.draft.fName = p.name; toast("Found it, but no nutrition info is listed. Type the label figures below."); renderMe(); return; }
          S.scan = p; delete S.draft.sG; renderMe();
        }).catch(function (e) {
          toast(e instanceof TypeError ? "Couldn't reach the food database. Check your connection." : e.message);
        });
      });
    },
    meal: function () {
      var text = val("mText");
      if (!text && !S.mealImg) return toast("Describe the meal or add a photo first");
      S.mealBusy = true; renderMe();
      call("meal", { userId: S.me, text: text, image: S.mealImg ? S.mealImg.split(",")[1] : "" })
        .then(function (j) {
          S.mealBusy = false;
          if (j.photosLeft != null) S.photos = { d: today(), n: j.photosLeft };
          if (!j.items.length) { toast(j.assumptions || "Claude couldn't find any food in that"); renderMe(); return; }
          S.meal = { name: j.meal_name, items: j.items, confidence: j.confidence, assumptions: j.assumptions };
          delete S.draft.mK; renderMe();
        })
        .catch(function (e) { S.mealBusy = false; if (/photos/.test(e.message)) { S.photos = { d: today(), n: 0 }; S.mealImg = null; } renderMe(); toast(e.message === "Failed to fetch" ? "Couldn't reach the server. Check your connection." : e.message); });
    },
    mealnoimg: function () { S.mealImg = null; renderMe(); },
    mealclear: function () { S.meal = null; delete S.draft.mK; renderMe(); },
    mealadd: function () {
      var r = S.meal; if (!r) return;
      var t = mealTotals(r.items), k = Math.round(num("mK"));
      if (!(k > 0)) return toast("Enter the calories to log");
      var m = t.kcal > 0 ? k / t.kcal : 1, r1 = function (x) { return Math.round(x * m * 10) / 10; };
      var mw = Math.round(r.items.reduce(function (sw, i) { return sw + waterFrom(i.grams, i.protein_g, i.carbs_g, i.fat_g); }, 0) * m);
      changeDay(S.date, function (d) { d.food.push({ id: uid(), name: r.name, p: r1(t.p), c: r1(t.c), f: r1(t.f), kcal: k, w: mw, src: "claude", items: r.items.map(function (i) { return i.name + " " + Math.round(i.grams) + " g"; }).join(", ").slice(0, 300) }); });
      S.meal = null; S.mealImg = null; clearDraft(["mK", "mText"]); renderMe();
    },
    scanamt: function (b) { S.draft.sG = b.dataset.v; renderMe(); },
    scanclear: function () { S.scan = null; delete S.draft.sG; renderMe(); },
    scanadd: function () {
      var p = S.scan; if (!p) return;
      var g = num("sG"); if (!(g > 0)) return toast("Enter how much you had");
      var r = scanCalc(p, g), u = p.liquid ? " ml" : " g";
      changeDay(S.date, function (d) { d.food.push({ id: uid(), name: p.name + " (" + fmt(g) + u + ")", p: r.p, c: r.c, f: r.f, kcal: r.kcal, w: waterFrom(g, r.p, r.c, r.f), src: "barcode", code: p.code }); });
      S.scan = null; delete S.draft.sG; renderMe();
    },
    wkon: function () { changeMe(function (u) { var w = u.wknd = u.wknd || {}; w.on = !w.on; if (!w.days) w.days = [6, 0]; if (!w.extra) w.extra = 400; }); },
    wkusual: function (b) { var v = +b.dataset.v; changeMe(function (u) { var w = u.wknd = u.wknd || { on: true, extra: 400 }, l = (w.days || [6, 0]).slice(), i = l.indexOf(v); if (i >= 0) l.splice(i, 1); else l.push(v); w.days = l; }); },
    wkday: function (b) {
      var v = +b.dataset.v, t = today(), ws = FC.weekStart(t);
      changeMe(function (u) {
        var w = u.wknd; if (!w) return;
        var l = FC.highDays(u, t).slice(), i = l.indexOf(v); if (i >= 0) l.splice(i, 1); else l.push(v);
        w.over = w.over || {}; w.over[ws] = l;
        Object.keys(w.over).forEach(function (k) { if (k < FC.addDays(ws, -28)) delete w.over[k]; }); // keep about a month
      });
    },
    foodwater: function () { changeMe(function (u) { u.foodWater = u.foodWater === false; }); },
    photo: function (b) { var el = document.getElementById(b.dataset.v === "cam" ? "mPhoto" : "mPhotoLib"); if (el) el.click(); },
    water: function (b) { var cur = +((getDay(S.me, S.date) || {}).water) || 0; setWater(cur + +b.dataset.v); },
    glass: function (b) { var i = +b.dataset.i, cur = +((getDay(S.me, S.date) || {}).water) || 0, full = Math.floor(cur / 250); setWater(i + 1 === full ? i * 250 : (i + 1) * 250); },
    meassel: function (b) { S.measSel = b.dataset.v; renderMe(); },
    meassave: function () {
      var d = S.date, vals = {};
      MEAS.forEach(function (m) { var v = num("ms_" + m[0]); if (v > 0 && v < (m[0] === "bf" ? 70 : 300)) vals[m[0]] = Math.round(v * 10) / 10; });
      if (!Object.keys(vals).length) return toast("Enter at least one measurement");
      changeMe(function (u) { u.priv = u.priv || {}; u.priv.meas = (u.priv.meas || []).filter(function (e) { return e[0] !== d; }).concat([[d, vals]]); });
      clearDraft(MEAS.map(function (m) { return "ms_" + m[0]; })); toast("Measurements saved. Only you can see them.");
    },
    measdel: function () { var d = S.date; changeMe(function (u) { if (u.priv && u.priv.meas) u.priv.meas = u.priv.meas.filter(function (e) { return e[0] !== d; }); }); clearDraft(MEAS.map(function (m) { return "ms_" + m[0]; })); },
    info: function (b) { var k = b.dataset.k; S.info[k] = !S.info[k]; render(); },
    edit: function (b) {
      var k = b.dataset.k, i = +b.dataset.i, e = ((getDay(S.me, S.date) || {})[k] || [])[i]; if (!e) return;
      S.edit = { kind: k, i: i, id: e.id }; clearDraft(["edN", "edP", "edC", "edF", "edK"]); renderMe();
      var el = $("#edN"); if (el) el.focus();
    },
    editcancel: function () { S.edit = null; renderMe(); },
    editsave: function () {
      var ed = S.edit; if (!ed) return;
      var name = val("edN"), k = Math.round(num("edK"));
      if (ed.kind === "food") {
        var p = num("edP"), c = num("edC"), f = num("edF");
        if (!val("edK")) k = FC.macroCal(p, c, f);
        if (!(k > 0)) return toast("Enter calories or macros");
        changeDay(S.date, function (d) { var e = d.food.filter(function (x) { return x.id === ed.id; })[0] || d.food[ed.i]; if (!e) return; if (e.w && e.kcal && k !== e.kcal) e.w = Math.round(e.w * k / e.kcal); e.name = name || "Food"; e.p = p; e.c = c; e.f = f; e.kcal = k; e.edited = 1; });
      } else {
        if (!(k > 0)) return toast("Enter the calories");
        changeDay(S.date, function (d) { var e = d.ex.filter(function (x) { return x.id === ed.id; })[0] || d.ex[ed.i]; if (!e) return; e.name = name || "Workout"; e.kcal = k; e.edited = 1; });
      }
      S.edit = null; clearDraft(["edN", "edP", "edC", "edF", "edK"]); renderMe();
    },
    favadd: function (b) {
      var k = b.dataset.k, e = ((getDay(S.me, S.date) || {})[k] || [])[+b.dataset.i]; if (!e) return;
      var name = val("edN") || e.name, kc = Math.round(num("edK")) || e.kcal;
      var item = k === "food" ? { name: name, kcal: kc, p: num("edP"), c: num("edC"), f: num("edF"), w: +e.w || 0 } : { name: name, kcal: kc, note: e.note || "" };
      changeMe(function (u) { u.saved = u.saved || {}; var l = u.saved[k] = (u.saved[k] || []).filter(function (x) { return x.name.toLowerCase() !== name.toLowerCase(); }); l.unshift(item); if (l.length > 40) l.length = 40; });
      toast("Saved. It's in your " + (k === "food" ? "saved foods" : "saved workouts") + " now.");
    },
    favedit: function (b) { S.favEdit = S.favEdit === b.dataset.k ? null : b.dataset.k; renderMe(); },
    favdel: function (b) { var k = b.dataset.k, i = +b.dataset.i; changeMe(function (u) { (u.saved[k] || []).splice(i, 1); }); },
    quick: function (b) {
      var k = b.dataset.k, u = me(), x = (b.dataset.src === "s" ? savedList(k, u) : recentFoods(u))[+b.dataset.i]; if (!x) return;
      if (k === "food") changeDay(S.date, function (d) { d.food.push({ id: uid(), name: x.name, p: x.p || 0, c: x.c || 0, f: x.f || 0, kcal: x.kcal, w: +x.w || 0, src: "saved" }); });
      else { changeDay(S.date, function (d) { d.ex.push({ id: uid(), name: x.name, kcal: x.kcal, note: x.note || "Saved workout", src: "saved" }); }); celebrate(b); }
      toast("Added " + x.name);
    },
    ideaadd: function (b) {
      var x = IDEAS[+b.dataset.i]; if (!x) return;
      changeDay(S.date, function (d) { d.food.push({ id: uid(), name: x.name + " (" + x.serve + ")", p: x.p, c: x.c, f: x.f, kcal: x.kcal, w: waterFrom(x.g, x.p, x.c, x.f), src: "idea" }); });
      toast("Added " + x.name);
    },
    delfood: function (b) { S.edit = null; changeDay(S.date, function (d) { d.food.splice(+b.dataset.i, 1); }); },
    delex: function (b) {
      S.edit = null;
      var e = ((getDay(S.me, S.date) || {}).ex || [])[+b.dataset.i];
      if (e && e.lift && window.FCTrain) return FCTrain.deleteWorkout(S.date, e.lift);
      changeDay(S.date, function (d) { d.ex.splice(+b.dataset.i, 1); });
    },
    diary: function () { pullDiary(S.date); },
    gotrain: function () { goTab(2); },
    estimate: function (b) {
      var text = val("eText"); if (!text) return toast("Describe the workout first");
      var u = me(), body = bodyOf(u);
      var local = function (why) { S.est = FC.parseWorkout(text); if (why) S.est.assumptions = why + " " + S.est.assumptions; delete S.draft.eK; renderMe(); };
      if (!S.claude) return local("");
      b.disabled = true; b.textContent = "Asking Claude...";
      call("estimate", { userId: u.id, text: text, weightKg: body.kg })
        .then(function (j) {
          if (!j.activities.length) { toast(j.assumptions || "Couldn't find a workout in that"); renderMe(); return; }
          S.est = { activities: j.activities, assumptions: j.assumptions }; delete S.draft.eK; renderMe();
        })
        .catch(function (e) { local("Claude wasn't reachable (" + e.message + "), so this is the built-in estimate."); });
    },
    clearest: function () { S.est = null; delete S.draft.eK; renderMe(); },
    addest: function () {
      var u = me(), k = Math.round(num("eK")); if (!k) return toast("Enter the calories");
      var est = S.est, text = val("eText");
      var calc = 0; est.activities.forEach(function (x) { calc += FC.exerciseCal(x.met, x.minutes, bodyOf(u)); });
      var names = est.activities.map(function (x) { return x.name; }).join(" + ");
      var mins = est.activities.reduce(function (s, x) { return s + (+x.minutes || 0); }, 0);
      changeDay(S.date, function (d) {
        d.ex.push({ id: uid(), name: names || "Workout", kcal: k, min: mins, desc: text, note: fmt(mins) + " min" + (k !== calc ? " · watch figure" : " · estimated"), src: k !== calc ? "manual" : "estimate", acts: est.activities });
      });
      S.est = null; clearDraft(["eText", "eK"]); if (window.FCTrain) FCTrain.doneLog(); celebrate(); renderMe(); toast("Added " + fmt(k) + " cal");
    },
    addmanual: function () {
      var k = Math.round(num("eK")); if (!k) return toast("Enter the calories");
      var text = val("eText");
      var name = val("eName") || text;
      changeDay(S.date, function (d) { d.ex.push({ id: uid(), name: name ? name.slice(0, 60) : "Workout", kcal: k, desc: text, note: "From watch", src: "manual" }); });
      clearDraft(["eText", "eName", "eK"]); if (window.FCTrain) FCTrain.doneLog(); celebrate(); renderMe(); toast("Added " + fmt(k) + " cal");
    },
    addweight: function () {
      var w = num("wKg"); if (w < 25 || w > 350) return toast("Enter your weight in kg");
      var d = S.date;
      changeMe(function (u) { u.weights = (u.weights || []).filter(function (x) { return x[0] !== d; }).concat([[d, Math.round(w * 10) / 10]]).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); });
      clearDraft(["wKg"]); toast("Weigh-in saved");
    },
    delweight: function () { var d = S.date; changeMe(function (u) { u.weights = (u.weights || []).filter(function (x) { return x[0] !== d; }); }); clearDraft(["wKg"]); },
    gstatus: function (b) { S.draft.gStatus = b.dataset.v; render(); },
    suggest: function () {
      var u = me(); S.draft.gKcal = String(FC.suggestGoal(Object.assign({}, u, { status: dv("gStatus", u.status) }), FC.weightStats(u).current)); render();
    },
    savegoals: function () {
      var k = Math.round(num("gKcal")); if (k < 800 || k > 8000) return toast("Goal should be between 800 and 8,000 cal");
      var st = dv("gStatus", me().status), p = Math.round(num("gP")), t = num("gT");
      var wg = Math.round(num("gWater"));
      var wk = Math.round(num("gWk"));
      changeMe(function (u) { u.status = st; u.goalKcal = k; u.proteinGoal = p || 0; u.targetWeight = t || 0; if (wg >= 500 && wg <= 8000) u.waterGoal = wg; if (u.wknd && wk) u.wknd.extra = Math.max(100, Math.min(1000, wk)); });
      clearDraft(["gStatus", "gKcal", "gP", "gT", "gWater", "gWk"]); toast("Goals saved"); render();
    },
    colour: function (b) { S.draft.pC = b.dataset.v; render(); },
    saveprofile: function () {
      var n = val("pName"); if (!n) return toast("Name needed");
      var sw = num("pW"), h = num("pH"), y = num("pY"), s = val("pS"), c = dv("pC", me().color);
      changeMe(function (u) { u.name = n.slice(0, 40); if (sw) u.startWeight = sw; u.heightCm = h || 0; u.birthYear = y || 0; u.sex = s; u.color = c; });
      clearDraft(["pName", "pW", "pH", "pY", "pS", "pC"]); toast("Profile saved"); render();
    },
    invite: function () {
      var link = location.origin + location.pathname + "#g=" + encodeURIComponent(S.code);
      if (navigator.share) navigator.share({ title: "Fit Crew", text: "Join the crew and keep me honest:", url: link }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast("Invite link copied"); });
      else prompt("Copy the invite link", link);
    },
    "switch": function () { S.me = ""; lsSet(LS.me, ""); S.pin = ""; lsSet(LS.pin, ""); S.gate = null; S.pinBuf = ""; S.pinErr = ""; S.pinChecked = false; S.draft = {}; closeSheet(); render(); sync(); },
    pinkey: function (b) {
      var v = b.dataset.v; S.pinErr = "";
      if (v === "back") S.pinBuf = S.pinBuf.slice(0, -1); else if (S.pinBuf.length < 4) S.pinBuf += v;
      if (navigator.vibrate) navigator.vibrate(15);
      renderGate();
      if (S.pinBuf.length === 4) { var c = S.pinBuf; setTimeout(function () { pinDone(c); }, 120); }
    },
    pinretry: function () { S.pinErr = ""; checkPin(); render(); },
    pincancel: function () { S.gate = null; S.pinBuf = ""; S.pinErr = ""; render(); },
    changepin: function () { closeSheet(); S.gate = "change-new"; S.pinBuf = ""; S.pinErr = ""; render(); },
    settings: function () { openSheet("settings"); },
    share: function (b) {
      var id = b.dataset.id;
      changeMe(function (u) { var h = u.hide || []; var i = h.indexOf(id); if (i >= 0) h.splice(i, 1); else h.push(id); u.hide = h; });
    },
    leave: function () {
      var u = me(); if (!u) return;
      if (!confirm("Delete " + u.name + " and all their logs for everyone? This can't be undone.")) return;
      call("deleteUser", { userId: u.id }).then(function () {
        S.cache.users = S.cache.users.filter(function (x) { return x.id !== u.id; });
        S.outbox = S.outbox.filter(function (o) { return o.userId !== u.id && !(o.user && o.user.id === u.id); });
        S.me = ""; lsSet(LS.me, ""); S.pin = ""; lsSet(LS.pin, ""); persist(); closeSheet(); render(); toast("Profile deleted");
      }).catch(function (e) { toast("Couldn't delete: " + e.message); });
    },
    pick: function (b) {
      S.me = b.dataset.id; lsSet(LS.me, S.me); S.pin = ""; lsSet(LS.pin, ""); S.draft = {}; S.pinErr = ""; S.pinBuf = "";
      S.gate = "checking"; S.pinChecked = false; render(); goTab(0); checkPin();
    },
    nstatus: function (b) { S.draft.nStatus = b.dataset.v; renderGate(); },
    join: function () {
      var n = val("nName"), w = num("nW");
      if (!n) return toast("Add your name");
      if (w < 25 || w > 350) return toast("Add your starting weight in kg");
      var used = users().map(function (x) { return x.color; });
      var u = {
        id: uid(), name: n.slice(0, 40), startWeight: Math.round(w * 10) / 10, heightCm: num("nH") || 0, birthYear: num("nY") || 0, sex: val("nS"),
        status: dv("nStatus", "cut"), joined: today(), weights: [[today(), Math.round(w * 10) / 10]],
        color: COLOURS.filter(function (c) { return used.indexOf(c) < 0; })[0] || COLOURS[users().length % COLOURS.length]
      };
      u.goalKcal = Math.round(num("nK")) || FC.suggestGoal(u, w);
      upsertUser(u); S.me = u.id; lsSet(LS.me, u.id); S.pin = ""; lsSet(LS.pin, "");
      queue({ action: "saveUser", user: u });
      S.draft = {}; S.gate = S.pinless ? null : "create"; S.pinBuf = ""; S.pinChecked = true; render(); goTab(1); celebrate(); toast("Welcome, " + u.name + ". Goal set to " + fmt(u.goalKcal) + " cal.");
    }
  };

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-act]"); if (!b) return;
    var a = b.dataset.act; if (a === "diaryauto") return;
    if (b.tagName === "BUTTON" && b.closest(".tile") && a !== "profile") e.stopPropagation();
    if (ACT[a]) { e.preventDefault(); ACT[a](b, e); }
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("tile")) { e.preventDefault(); openSheet(e.target.dataset.id); }
    if (e.key === "Escape" && S.sheet) closeSheet();
  });
  document.addEventListener("input", function (e) {
    if (e.target.id) S.draft[e.target.id] = e.target.value;
    if (e.target.id === "sG" && S.scan) { var sc = $("#sCalc"); if (sc) sc.innerHTML = scanCalcText(S.scan, parseFloat(String(e.target.value).replace(",", ".")) || 0); }
    if (/^f[PCF]$/.test(e.target.id)) { var k = $("#fK"); if (k) k.placeholder = FC.macroCal(dv("fP"), dv("fC"), dv("fF")) || ""; }
  });
  document.addEventListener("change", function (e) {
    if ((e.target.id === "mPhoto" || e.target.id === "mPhotoLib") && e.target.files && e.target.files[0]) {
      // These inputs live outside the redrawn page, so a photo taken while the app redraws in the background isn't lost
      var inp = e.target, f = inp.files[0]; S.photoBusy = true; renderMe();
      shrinkPhoto(f).then(function (d) { S.mealImg = d; S.photoBusy = false; inp.value = ""; renderMe(); }, function (er) { S.photoBusy = false; inp.value = ""; renderMe(); toast(er.message); });
      return;
    }
    if (e.target.id === "gWk") { var wv = Math.round(+e.target.value || 0); if (wv) { changeMe(function (u) { if (u.wknd) u.wknd.extra = Math.max(100, Math.min(1000, wv)); }); delete S.draft.gWk; } return; }
    if (e.target.dataset && e.target.dataset.act === "diaryauto") { lsSet(LS.diary, e.target.checked ? "1" : ""); if (e.target.checked) autoDiary(); }
    else if (e.target.tagName === "SELECT" && e.target.id) S.draft[e.target.id] = e.target.value;
  });
  $("#sheet").addEventListener("click", function (e) { if (e.target.id === "sheet") closeSheet(); });
  $("#sync").addEventListener("click", function () { sync(); });

  /* ---------- Tabs and swipe ---------- */
  var pager = $("#pager");
  function goTab(i) { pager.scrollTo({ left: i * pager.clientWidth, behavior: "smooth" }); }
  document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { goTab(+b.dataset.tab); }); });
  pager.addEventListener("scroll", function () {
    var f = pager.scrollLeft / Math.max(1, pager.clientWidth);
    $("#pill").style.transform = "translateX(" + (f * 100) + "%) translateX(" + (f * 4) + "px)";
    var on = Math.round(f);
    document.querySelectorAll(".tabs button").forEach(function (b) { b.classList.toggle("on", +b.dataset.tab === on); });
  }, { passive: true });

  /* ---------- Feedback ---------- */
  // Messages queue up so a "badge unlocked" doesn't wipe out a "new PB" shown a moment earlier
  var toastQ = [];
  function toast(msg, important) {
    if (toast.busy && (important || toastQ.length < 2) && toast.busyImportant) { toastQ.push(msg); return; }
    clearTimeout(toast.t);
    toast.busy = true; toast.busyImportant = !!important;
    $("#toast").innerHTML = "<div>" + esc(msg) + "</div>";
    toast.t = setTimeout(function () { $("#toast").innerHTML = ""; toast.busy = false; toast.busyImportant = false; if (toastQ.length) toast(toastQ.shift(), true); }, 2600);
  }
  function celebrate(fromEl) {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var cv = $("#confetti"), ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    var ox = innerWidth / 2, oy = innerHeight * 0.35;
    if (fromEl && fromEl.getBoundingClientRect) { var r = fromEl.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; }
    var cols = ["#c4f135", "#dcff6e", "#34d6a4", "#ffb547", "#f3f6f2", "#6aa9e9"], ps = [];
    for (var i = 0; i < (fromEl ? 40 : 110); i++) {
      var ang = Math.random() * Math.PI * 2, sp = 3 + Math.random() * (fromEl ? 5 : 9);
      ps.push({ x: ox, y: oy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 4, s: 4 + Math.random() * 5, c: cols[i % cols.length], r: Math.random() * 6, vr: (Math.random() - .5) * .4 });
    }
    var start = performance.now();
    (function frame(now) {
      var t = now - start; ctx.clearRect(0, 0, innerWidth, innerHeight);
      ps.forEach(function (p) {
        p.vy += 0.25; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - t / 1600); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore();
      });
      if (t < 1600) requestAnimationFrame(frame); else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(start);
  }

  /* ---------- Workout tracker (train.js) ---------- */
  if (window.FCTrain) FCTrain.init({ S: S, FC: FC, me: me, user: user, getDay: getDay, changeDay: changeDay, changeMe: changeMe, toast: toast, celebrate: celebrate,
    esc: esc, fmt: fmt, today: today, dayLabel: dayLabel, uid: uid, bodyOf: bodyOf, ICON: ICON, head: head, tip: tip, checkBadges: function () { setTimeout(checkBadges, 50); }, backfillStats: backfillStats, exListHtml: exListHtml, exLogHtml: exLogHtml });

  /* ---------- Start ---------- */
  (function readHash() {
    var m = location.hash.match(/[#&]g=([^&]+)/);
    if (m) {
      var c = decodeURIComponent(m[1]);
      if (c !== S.code) { S.code = c; lsSet(LS.code, c); }
      history.replaceState(null, "", location.pathname + location.search);
    }
  })();
  render();
  sync();
  setInterval(function () { if (document.visibilityState === "visible") sync(); }, POLL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      if (S.date !== today() && S.date === FC.addDays(today(), -1)) S.date = today();
      sync();
    }
  });
  window.addEventListener("online", sync);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(function () {});

  // Test hook (local test server only)
  window.__fc = { S: S, render: render, sync: sync };
})();
