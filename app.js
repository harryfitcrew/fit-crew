/* Fit Crew app. Data syncs through the Apps Script backend in config.js (FITCREW_API).
 * Everything is cached in localStorage so the app opens instantly and works offline;
 * changes queue in an outbox and send when there's signal. */
(function () {
  "use strict";
  var API = window.FITCREW_API || "";
  var LS = { code: "fitcrew.code", me: "fitcrew.me", cache: "fitcrew.cache", outbox: "fitcrew.outbox", board: "fitcrew.board", diary: "fitcrew.diaryAuto" };
  var DIARY_KEY = "calorie-diary.v2"; // optional Calorie Diary app on the same GitHub Pages origin
  var COLOURS = ["#d97757", "#5fb3a8", "#e3b25b", "#9d8cf0", "#62a8e5", "#e07ba0", "#8cc56b", "#c9a27e"];
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
    sheet: null
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
  function avatar(u, lg) { return '<span class="av' + (lg ? " lg" : "") + '" style="background:' + esc(u.color || COLOURS[0]) + '">' + initial(u.name) + "</span>"; }

  var ICON = {
    left: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>',
    hand: '<svg viewBox="0 0 24 24"><path d="M7 11V6a1.5 1.5 0 013 0v4m0-1V4.5a1.5 1.5 0 013 0V10m0-4.5a1.5 1.5 0 013 0V11m0-3a1.5 1.5 0 013 0v6a7 7 0 01-7 7h-1a7 7 0 01-6-3.4L3.6 14a1.5 1.5 0 012.6-1.5L7 14"/></svg>',
    flame: '<svg viewBox="0 0 24 24"><path d="M12 22c4 0 7-2.7 7-6.8 0-3.4-2.3-5.6-3.6-7.6-.4 1.6-1.3 2.7-2.4 3.2C13.4 7 12 4 9.5 2c.2 3.4-1.6 5.4-3.1 7.4A8.5 8.5 0 005 15.2C5 19.3 8 22 12 22z"/></svg>',
    crown: '<svg viewBox="0 0 24 24"><path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z"/></svg>',
    spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
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
    var body = JSON.stringify(Object.assign({ code: S.code, action: action }, data || {}));
    return fetch(API, { method: "POST", body: body, redirect: "follow", signal: ctrl && ctrl.signal })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        clearTimeout(timer);
        if (!j.ok) { var e = new Error(j.error || "Server error"); e.auth = j.auth === false; e.noClaude = !!j.noClaude; throw e; }
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
        S.cache = { users: j.users || [], days: j.days || {}, kudos: j.kudos || [] };
        applyPending();
        persist();
        S.lastSync = Date.now();
        if (S.me && !me() && !S.outbox.length) { S.me = ""; lsSet(LS.me, ""); }
        if (S.claude == null) call("ping").then(function (p) { S.claude = !!p.claude; renderMe(true); }).catch(function () {});
      })
      .catch(function (e) {
        S.err = e.message || "Offline";
        if (e.auth) { S.code = ""; lsSet(LS.code, ""); }
      })
      .then(function () {
        S.syncing = false;
        autoDiary();
        render(true);
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
    var before = FC.assess(u, getDay(u.id, date), isFinal(date)).state;
    var d = clone(getDay(u.id, date) || { food: [], ex: [] });
    d.food = d.food || []; d.ex = d.ex || [];
    fn(d);
    d.updated = Date.now();
    S.cache.days[u.id + "|" + date] = d;
    queue({ action: "saveDay", userId: u.id, date: date, day: d });
    var after = FC.assess(u, d, isFinal(date)).state;
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
      var a = FC.assess(u, getDay(u.id, t), ev);
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
      + '<text x="50%" y="50%" dominant-baseline="central" text-anchor="middle" fill="var(--text)" style="font:600 ' + Math.round(size / 4.6) + 'px var(--serif)">' + (a.logged ? pct + "%" : "–") + "</text></svg>";
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
    var rows = days.map(function (d) { var day = getDay(u.id, d); return { d: d, a: FC.assess(u, day, isFinal(d)) }; });
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
        + '<div class="tfoot">' + (r.streak >= 3 ? '<span class="flame">' + ICON.flame + "</span>" : "") + "<span>" + metric(r) + "</span>"
        + (u.id !== S.me ? '<button class="kudo' + (mine ? " on" : "") + '" data-act="kudos" data-id="' + u.id + '" aria-label="High five ' + esc(u.name) + '">' + ICON.hand + (k.length || "") + "</button>"
          : (k.length ? '<span class="kudo on">' + ICON.hand + k.length + "</span>" : ""))
        + "</div></div>";
    });
    h += "</div>";

    // Week grid
    var ws = FC.weekStart(t), days = []; for (var i = 0; i < 7; i++) days.push(FC.addDays(ws, i));
    h += '<div class="card"><h2>This week <small>Mon to Sun</small></h2><table class="wk"><tr><th></th>'
      + days.map(function (d) { return "<th>" + "MTWTFSS".charAt(days.indexOf(d)) + "</th>"; }).join("") + "</tr>";
    users().forEach(function (u) {
      h += "<tr><td>" + esc(u.name) + "</td>" + days.map(function (d) {
        if (d > t) return '<td><span class="dot" style="opacity:.35"></span></td>';
        var day = getDay(u.id, d), a = FC.assess(u, day, isFinal(d));
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
    h += '<div class="card"><h2>Weight race <small>% change from start</small></h2><div class="chart">'
      + lineChart(series, { zero: true, label: "Weight change by person", fmt: function (v) { return signed(v, 1) + "%"; }, minPad: 0.6, empty: "Weigh-ins will show here." })
      + '</div><div class="keyrow">' + users().map(function (u) { return '<span><i style="background:' + esc(u.color) + '"></i>' + esc(u.name) + "</span>"; }).join("") + "</div></div>";
    el.innerHTML = h;
  }

  /* ---------- Profile sheet ---------- */
  function renderProfile(id) {
    var u = user(id); if (!u) return closeSheet();
    var t = today(), day = getDay(u.id, t) || {}, a = FC.assess(u, day, evening()), w = FC.weightStats(u), ft = FC.foodTotals(day);
    var wk = FC.weekPoints(u, getDay, t, evening()), st = FC.streak(u, getDay, t, evening());
    var bmi = FC.bmi(w.current, +u.heightCm);
    var k = kudosFor(u.id, t), mine = k.some(function (x) { return x.from === S.me; });
    var days14 = []; for (var i = 13; i >= 0; i--) days14.push(FC.addDays(t, -i));
    var h = '<div class="grab"></div><div class="phead">' + avatar(u, true) + "<div><h2>" + esc(u.name) + '</h2><div class="tag">' + STATUS[u.status || "maintain"] + " · goal " + fmt(u.goalKcal) + ' cal</div></div><button class="x" data-act="close" aria-label="Close">×</button></div>';
    h += '<div class="card"><h2>Today' + (u.id !== S.me ? '<button class="kudo' + (mine ? " on" : "") + '" data-act="kudos" data-id="' + u.id + '">' + ICON.hand + "High five" + (k.length ? " · " + k.length : "") + "</button>" : "") + "</h2>"
      + '<div class="summary">' + ring(a, 92) + '<div class="big"><span class="lbl">Eaten</span><span class="eat num">' + fmt(a.eaten) + '<span class="unit">cal</span></span><span class="lbl">Burned</span><span class="brn num">' + fmt(a.burned) + '<span class="unit">cal</span></span></div></div>'
      + '<div class="status ' + a.state + '">' + esc(a.msg) + (a.logged ? " · net " + fmt(a.net) + " of " + fmt(a.goal) : "") + "</div>"
      + (ft.p || ft.c || ft.f ? macroTiles(u, ft) : "")
      + ((day.ex || []).length ? '<div class="list" style="margin:12px 0 0">' + day.ex.map(function (e) { return '<div class="row"><div class="t"><b>' + esc(e.name) + "</b>" + (e.note ? "<small>" + esc(e.note) + "</small>" : "") + '</div><span class="k">' + fmt(e.kcal) + "</span></div>"; }).join("") + "</div>" : "")
      + "</div>";
    h += '<div class="stats"><div class="stat"><span>Streak</span><b>' + st + ' d</b></div><div class="stat"><span>Week pts</span><b>' + wk.points + '</b></div><div class="stat"><span>Workouts</span><b>' + wk.workouts + "</b></div></div>";
    h += '<div class="card"><h2>Weight</h2><div class="stats"><div class="stat"><span>Start</span><b>' + (w.start ? kg(w.start) : "–") + '</b></div><div class="stat"><span>Now</span><b>' + (w.current ? kg(w.current) : "–") + '</b></div><div class="stat"><span>Change</span><b class="' + (w.progress > 0 ? "good" : w.progress < 0 ? "bad" : "") + '">' + (w.start ? signed(w.change, 1) : "–") + "</b></div></div>"
      + '<div class="chart">' + lineChart([{ color: u.color, pts: weightPts(u) }], { label: "Weight over time", target: w.target || 0, extra: w.target ? [w.target] : [], empty: "No weigh-ins yet." }) + "</div>"
      + '<p class="hint" style="margin-top:8px">' + (w.target ? "Target " + kg(w.target) + " kg, " + kg(Math.abs(w.toGo)) + " kg to go. " : "") + (bmi ? "BMI " + bmi.toFixed(1) + "." : "") + "</p></div>";
    h += '<div class="card"><h2>Last 14 days <small>eaten vs goal</small></h2><div class="chart">' + barChart(u, days14) + '</div><div class="legend"><span><i class="dot good"></i>On track</span><span><i class="dot bad"></i>Off track</span><span><i style="width:11px;height:4px;background:var(--accent-2);border-radius:2px;display:inline-block"></i>Burned</span></div></div>';
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
      + '<p class="hint">From Open Food Facts, a free database filled in by volunteers. Check it against the packet if it looks off.</p></div>';
  }

  /* ---------- Meal estimate with Claude (photo and/or description) ---------- */
  function mealTotals(items) {
    var t = { kcal: 0, p: 0, c: 0, f: 0 };
    (items || []).forEach(function (i) { t.kcal += +i.kcal || 0; t.p += +i.protein_g || 0; t.c += +i.carbs_g || 0; t.f += +i.fat_g || 0; });
    t.kcal = Math.round(t.kcal); t.p = Math.round(t.p * 10) / 10; t.c = Math.round(t.c * 10) / 10; t.f = Math.round(t.f * 10) / 10;
    return t;
  }
  function mealBlock() {
    if (!S.claude) return "";
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
        + '<p class="hint">Total ' + fmt(t.kcal) + " cal · P " + fmt(t.p) + " · C " + fmt(t.c) + " · F " + fmt(t.f) + ". Change the calories if it looks off and the macros scale with it.</p>";
    } else {
      h += '<label class="f">Describe a meal or snap a photo<textarea id="mText" placeholder="e.g. 180 g chicken breast, 120 g cooked rice, 1 tbsp olive oil">' + esc(dv("mText", "")) + "</textarea></label>"
        + (S.mealImg ? '<div class="mealimg"><img src="' + S.mealImg + '" alt="Meal photo"><button class="x" data-act="mealnoimg" aria-label="Remove photo">×</button></div>' : "")
        + '<div class="btns"><label class="btn' + (S.mealBusy ? " dis" : "") + '">' + ICON.camera + "Camera" + '<input type="file" id="mPhoto" accept="image/*" capture="environment" hidden' + (S.mealBusy ? " disabled" : "") + "></label>"
        + '<label class="btn' + (S.mealBusy ? " dis" : "") + '">' + ICON.gallery + "Gallery" + '<input type="file" id="mPhotoLib" accept="image/*" hidden' + (S.mealBusy ? " disabled" : "") + "></label></div>"
        + '<div class="btns"><button class="btn pri" style="flex:1" data-act="meal"' + (S.mealBusy ? " disabled" : "") + ">" + ICON.spark + (S.mealBusy ? "Asking Claude..." : "Estimate with Claude") + "</button></div>"
        + '<p class="hint">Weights give the best answer. Photos are a rough guess, so check before adding.</p>';
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
    var el = $("#me"); if (!el) return;
    if (fromSync && el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return; // don't wipe typing
    var u = me(); if (!u) { el.innerHTML = ""; return; }
    var d = S.date, t = today(), day = getDay(u.id, d) || { food: [], ex: [] };
    var a = FC.assess(u, day, isFinal(d)), ft = FC.foodTotals(day), w = FC.weightStats(u);
    var h = '<div class="datebar"><button class="icon" data-act="day" data-v="-1" aria-label="Previous day">' + ICON.left + "</button><b>" + esc(dayLabel(d)) + '</b><button class="icon" data-act="day" data-v="1" aria-label="Next day"' + (d >= t ? " disabled" : "") + ">" + ICON.right + "</button></div>";

    // Summary: eaten on top, burned underneath
    h += '<div class="card"><div class="summary">' + ring(a, 104) + '<div class="big"><span class="lbl">Calories eaten</span><span class="eat num">' + fmt(a.eaten) + '<span class="unit">/ ' + fmt(a.goal) + '</span></span><span class="lbl" style="margin-top:6px">Burned exercising</span><span class="brn num">' + fmt(a.burned) + '<span class="unit">cal</span></span></div></div>'
      + '<div class="status ' + a.state + '">' + esc(a.msg) + (a.logged ? " · net " + fmt(a.net) : "") + "</div>" + macroTiles(u, ft) + "</div>";

    // Food
    var food = day.food || [];
    h += '<div class="card"><h2>Food <small>' + fmt(ft.kcal) + " cal</small></h2>";
    if (hasDiary()) {
      var dd = readDiary(d) || { kcal: 0, items: 0 };
      h += '<div class="diary"><div class="t"><b>Calorie Diary</b><br><span class="muted">' + (dd.items ? fmt(dd.kcal) + " cal from " + dd.items + " items" : "Nothing logged there for this day") + '</span></div><button class="btn" data-act="diary"' + (dd.items ? "" : " disabled") + ">Pull</button></div>"
        + '<label class="toggle" style="margin:-4px 0 12px"><input type="checkbox" data-act="diaryauto"' + (lsGet(LS.diary, "") === "1" ? " checked" : "") + "> Keep today and weigh-ins synced from Calorie Diary</label>";
    }
    h += food.length ? '<div class="list">' + food.map(function (e, i) {
      var m = e.p || e.c || e.f ? "P " + fmt(e.p) + " · C " + fmt(e.c) + " · F " + fmt(e.f) : "";
      return '<div class="row"><div class="t"><b>' + esc(e.name || "Food") + "</b>" + (m ? "<small>" + m + "</small>" : "") + '</div><span class="k">' + fmt(e.kcal) + '</span><button class="x" data-act="delfood" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join("") + "</div>" : '<p class="empty">Nothing logged yet. Add meals as you go, or one total at the end of the day.</p>';
    h += scanBlock();
    h += mealBlock();
    h += '<div class="stack"><label class="f">What (optional)<input id="fName" placeholder="e.g. Lunch, or Day total" value="' + esc(dv("fName", "")) + '"></label>'
      + '<div class="g4"><label class="f">Protein g<input id="fP" inputmode="decimal" value="' + esc(dv("fP", "")) + '"></label><label class="f">Carbs g<input id="fC" inputmode="decimal" value="' + esc(dv("fC", "")) + '"></label><label class="f">Fat g<input id="fF" inputmode="decimal" value="' + esc(dv("fF", "")) + '"></label><label class="f">Calories<input id="fK" inputmode="numeric" placeholder="' + (FC.macroCal(dv("fP"), dv("fC"), dv("fF")) || "") + '" value="' + esc(dv("fK", "")) + '"></label></div>'
      + '<p class="hint">Leave calories blank and it works them out from the macros (4/4/9 per gram).</p>'
      + '<button class="btn pri wide" data-act="addfood">Add food</button></div></div>';

    // Exercise
    var ex = day.ex || [];
    h += '<div class="card"><h2>Exercise <small>' + fmt(a.burned) + " cal burned</small></h2>";
    h += ex.length ? '<div class="list">' + ex.map(function (e, i) {
      return '<div class="row"><div class="t"><b>' + esc(e.name) + "</b><small>" + esc(e.note || (e.src === "manual" ? "Entered by hand" : "")) + '</small></div><span class="k">' + fmt(e.kcal) + '</span><button class="x" data-act="delex" data-i="' + i + '" aria-label="Remove">×</button></div>';
    }).join("") + "</div>" : '<p class="empty">No workouts logged.</p>';
    h += '<div class="stack"><label class="f">Describe it<textarea id="eText" placeholder="e.g. 45 min incline walk at 8% and 5.5 km/h">' + esc(dv("eText", "")) + "</textarea></label>";
    if (S.est) {
      var tot = 0;
      h += '<div class="est"><b>Estimate</b>' + S.est.activities.map(function (x) {
        var c = FC.exerciseCal(x.met, x.minutes, bodyOf(u)); tot += c;
        return '<div class="a"><div>' + esc(x.name) + " · " + fmt(x.minutes) + " min<small>MET " + x.met + " · " + esc(x.note) + '</small></div><b class="num">' + fmt(c) + "</b></div>";
      }).join("") + (S.est.assumptions ? '<p class="hint">' + esc(S.est.assumptions) + "</p>" : "")
        + '<p class="hint">Net calories above resting, using your weight, height, age and sex. Got a watch reading? Type it below to override.</p>'
        + '<div class="g2"><label class="f">Calories to log<input id="eK" inputmode="numeric" value="' + esc(dv("eK", tot)) + '"></label><div style="display:flex;align-items:flex-end;gap:8px"><button class="btn pri" style="flex:1" data-act="addest">Log it</button><button class="btn ghost" data-act="clearest" aria-label="Discard">×</button></div></div></div>';
    } else {
      h += '<div class="btns"><button class="btn pri" style="flex:1" data-act="estimate">' + ICON.spark + (S.claude ? "Estimate with Claude" : "Estimate") + '</button></div><p class="hint">Or skip the estimate: type the calories from your watch and add.</p>'
        + '<div class="g2"><label class="f">Calories (watch)<input id="eK" inputmode="numeric" value="' + esc(dv("eK", "")) + '"></label><div style="display:flex;align-items:flex-end"><button class="btn wide" data-act="addmanual">Add</button></div></div>';
    }
    h += "</div></div>";

    // Weight
    var wt = (u.weights || []).filter(function (x) { return x[0] === d; })[0];
    h += '<div class="card"><h2>Weight</h2><div class="stats"><div class="stat"><span>Start</span><b>' + kg(w.start) + '</b></div><div class="stat"><span>Now</span><b>' + kg(w.current) + '</b></div><div class="stat"><span>Change</span><b class="' + (w.progress > 0 ? "good" : w.progress < 0 ? "bad" : "") + '">' + signed(w.change, 1) + "</b></div></div>"
      + '<div class="chart">' + lineChart([{ color: u.color, pts: weightPts(u) }], { label: "My weight", target: w.target || 0, extra: w.target ? [w.target] : [], empty: "Log a weigh-in to start the chart." }) + "</div>"
      + '<div class="g2" style="margin-top:12px"><label class="f">Weight on ' + esc(dayLabel(d).toLowerCase()) + ' (kg)<input id="wKg" inputmode="decimal" value="' + esc(dv("wKg", wt ? wt[1] : "")) + '"></label><div style="display:flex;align-items:flex-end;gap:8px"><button class="btn pri" style="flex:1" data-act="addweight">Save</button>' + (wt ? '<button class="btn ghost" data-act="delweight" aria-label="Remove weigh-in">×</button>' : "") + "</div></div></div>";

    // Goals
    var st = dv("gStatus", u.status || "maintain");
    h += '<div class="card"><h2>Goals</h2><div class="stack"><div class="seg">' + ["cut", "maintain", "bulk"].map(function (s) { return '<button class="' + (st === s ? "on" : "") + '" data-act="gstatus" data-v="' + s + '">' + STATUS[s] + "</button>"; }).join("") + "</div>"
      + '<div class="g3"><label class="f">Daily cal goal<input id="gKcal" inputmode="numeric" value="' + esc(dv("gKcal", u.goalKcal || "")) + '"></label><label class="f">Protein g<input id="gP" inputmode="numeric" value="' + esc(dv("gP", u.proteinGoal || "")) + '"></label><label class="f">Target kg<input id="gT" inputmode="decimal" value="' + esc(dv("gT", u.targetWeight || "")) + '"></label></div>'
      + '<p class="hint">' + goalHint(st) + " Suggested for you: <b>" + fmt(FC.suggestGoal(Object.assign({}, u, { status: st }), w.current)) + ' cal</b> <button class="btn ghost" style="padding:2px 10px" data-act="suggest">Use</button></p>'
      + '<button class="btn pri wide" data-act="savegoals">Save goals</button></div></div>';

    // Profile and group
    h += '<div class="card"><h2>Profile</h2><div class="stack"><label class="f">Name<input id="pName" value="' + esc(dv("pName", u.name)) + '"></label>'
      + '<div class="g3"><label class="f">Height cm<input id="pH" inputmode="numeric" value="' + esc(dv("pH", u.heightCm || "")) + '"></label><label class="f">Birth year<input id="pY" inputmode="numeric" value="' + esc(dv("pY", u.birthYear || "")) + '"></label><label class="f">Sex<select id="pS">' + sexOpts(dv("pS", u.sex || "")) + "</select></label></div>"
      + '<label class="f">Starting weight kg<input id="pW" inputmode="decimal" value="' + esc(dv("pW", u.startWeight || "")) + '"></label>'
      + '<div style="display:flex;gap:8px;flex-wrap:wrap">' + COLOURS.map(function (c) { return '<button aria-label="Colour" data-act="colour" data-v="' + c + '" style="width:30px;height:30px;border-radius:50%;border:3px solid ' + ((dv("pC", u.color) === c) ? "var(--text)" : "transparent") + ";background:" + c + '"></button>'; }).join("") + "</div>"
      + '<p class="hint">Height, age and sex sharpen the burn estimates and the suggested goal.</p>'
      + '<button class="btn pri wide" data-act="saveprofile">Save profile</button></div></div>';
    h += '<div class="card"><h2>Crew</h2><div class="stack"><button class="btn wide" data-act="invite">' + ICON.share + 'Share invite link</button><p class="hint">Anyone with the link can join and see everyone. Only send it to the crew.</p>'
      + '<button class="btn ghost wide" data-act="switch">Switch person on this phone</button><button class="btn danger wide" data-act="leave">Delete my profile and data</button>'
      + '<p class="hint">Sync: ' + esc(S.err ? "offline (" + S.err + ")" : S.lastSync ? "last synced " + new Date(S.lastSync).toLocaleTimeString("en-NZ", { hour: "numeric", minute: "2-digit" }) : "waiting") + (S.outbox.length ? ", " + S.outbox.length + " change(s) waiting to send" : "") + ". Workout estimates: " + (S.claude ? "Claude" : "built-in formula") + ".</p></div></div>";
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
  function renderGate() {
    var g = $("#gate");
    if (!API) { g.innerHTML = '<div class="wrap"><h1>Fit <b>Crew</b></h1><p class="muted">The app isn\'t connected to its backend yet. Whoever set it up needs to add the web app URL to config.js.</p></div>'; g.classList.add("open"); return true; }
    if (!S.code) { g.innerHTML = '<div class="wrap"><h1>Fit <b>Crew</b></h1><p class="muted">Open this app from the invite link your mate sent you. It carries the crew\'s code.</p>' + (S.err ? '<p class="bad">' + esc(S.err) + "</p>" : "") + "</div>"; g.classList.add("open"); return true; }
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
    if (S.sheet) renderProfile(S.sheet);
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
      render();
    },
    day: function (b) { var n = FC.addDays(S.date, +b.dataset.v); if (n <= today()) { S.date = n; S.est = null; clearDraft(["wKg", "eK"]); renderMe(); } },
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
          if (!j.items.length) { toast(j.assumptions || "Claude couldn't find any food in that"); renderMe(); return; }
          S.meal = { name: j.meal_name, items: j.items, confidence: j.confidence, assumptions: j.assumptions };
          delete S.draft.mK; renderMe();
        })
        .catch(function (e) { S.mealBusy = false; renderMe(); toast(e.message === "Failed to fetch" ? "Couldn't reach the server. Check your connection." : e.message); });
    },
    mealnoimg: function () { S.mealImg = null; renderMe(); },
    mealclear: function () { S.meal = null; delete S.draft.mK; renderMe(); },
    mealadd: function () {
      var r = S.meal; if (!r) return;
      var t = mealTotals(r.items), k = Math.round(num("mK"));
      if (!(k > 0)) return toast("Enter the calories to log");
      var m = t.kcal > 0 ? k / t.kcal : 1, r1 = function (x) { return Math.round(x * m * 10) / 10; };
      changeDay(S.date, function (d) { d.food.push({ id: uid(), name: r.name, p: r1(t.p), c: r1(t.c), f: r1(t.f), kcal: k, src: "claude", items: r.items.map(function (i) { return i.name + " " + Math.round(i.grams) + " g"; }).join(", ").slice(0, 300) }); });
      S.meal = null; S.mealImg = null; clearDraft(["mK", "mText"]); renderMe();
    },
    scanamt: function (b) { S.draft.sG = b.dataset.v; renderMe(); },
    scanclear: function () { S.scan = null; delete S.draft.sG; renderMe(); },
    scanadd: function () {
      var p = S.scan; if (!p) return;
      var g = num("sG"); if (!(g > 0)) return toast("Enter how much you had");
      var r = scanCalc(p, g), u = p.liquid ? " ml" : " g";
      changeDay(S.date, function (d) { d.food.push({ id: uid(), name: p.name + " (" + fmt(g) + u + ")", p: r.p, c: r.c, f: r.f, kcal: r.kcal, src: "barcode", code: p.code }); });
      S.scan = null; delete S.draft.sG; renderMe();
    },
    delfood: function (b) { changeDay(S.date, function (d) { d.food.splice(+b.dataset.i, 1); }); },
    delex: function (b) { changeDay(S.date, function (d) { d.ex.splice(+b.dataset.i, 1); }); },
    diary: function () { pullDiary(S.date); },
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
      S.est = null; clearDraft(["eText", "eK"]); celebrate(); renderMe();
    },
    addmanual: function () {
      var k = Math.round(num("eK")); if (!k) return toast("Enter the calories");
      var text = val("eText");
      changeDay(S.date, function (d) { d.ex.push({ id: uid(), name: text ? text.slice(0, 60) : "Workout", kcal: k, desc: text, note: "From watch", src: "manual" }); });
      clearDraft(["eText", "eK"]); celebrate(); renderMe();
    },
    addweight: function () {
      var w = num("wKg"); if (w < 25 || w > 350) return toast("Enter your weight in kg");
      var d = S.date;
      changeMe(function (u) { u.weights = (u.weights || []).filter(function (x) { return x[0] !== d; }).concat([[d, Math.round(w * 10) / 10]]).sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); });
      clearDraft(["wKg"]); toast("Weigh-in saved");
    },
    delweight: function () { var d = S.date; changeMe(function (u) { u.weights = (u.weights || []).filter(function (x) { return x[0] !== d; }); }); clearDraft(["wKg"]); },
    gstatus: function (b) { S.draft.gStatus = b.dataset.v; renderMe(); },
    suggest: function () {
      var u = me(); S.draft.gKcal = String(FC.suggestGoal(Object.assign({}, u, { status: dv("gStatus", u.status) }), FC.weightStats(u).current)); renderMe();
    },
    savegoals: function () {
      var k = Math.round(num("gKcal")); if (k < 800 || k > 8000) return toast("Goal should be between 800 and 8,000 cal");
      var st = dv("gStatus", me().status), p = Math.round(num("gP")), t = num("gT");
      changeMe(function (u) { u.status = st; u.goalKcal = k; u.proteinGoal = p || 0; u.targetWeight = t || 0; });
      clearDraft(["gStatus", "gKcal", "gP", "gT"]); toast("Goals saved"); renderMe();
    },
    colour: function (b) { S.draft.pC = b.dataset.v; renderMe(); },
    saveprofile: function () {
      var n = val("pName"); if (!n) return toast("Name needed");
      var sw = num("pW"), h = num("pH"), y = num("pY"), s = val("pS"), c = dv("pC", me().color);
      changeMe(function (u) { u.name = n.slice(0, 40); if (sw) u.startWeight = sw; u.heightCm = h || 0; u.birthYear = y || 0; u.sex = s; u.color = c; });
      clearDraft(["pName", "pW", "pH", "pY", "pS", "pC"]); toast("Profile saved"); renderMe();
    },
    invite: function () {
      var link = location.origin + location.pathname + "#g=" + encodeURIComponent(S.code);
      if (navigator.share) navigator.share({ title: "Fit Crew", text: "Join the crew and keep me honest:", url: link }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { toast("Invite link copied"); });
      else prompt("Copy the invite link", link);
    },
    "switch": function () { S.me = ""; lsSet(LS.me, ""); S.draft = {}; render(); },
    leave: function () {
      var u = me(); if (!u) return;
      if (!confirm("Delete " + u.name + " and all their logs for everyone? This can't be undone.")) return;
      call("deleteUser", { userId: u.id }).then(function () {
        S.cache.users = S.cache.users.filter(function (x) { return x.id !== u.id; });
        S.outbox = S.outbox.filter(function (o) { return o.userId !== u.id && !(o.user && o.user.id === u.id); });
        S.me = ""; lsSet(LS.me, ""); persist(); render(); toast("Profile deleted");
      }).catch(function (e) { toast("Couldn't delete: " + e.message); });
    },
    pick: function (b) { S.me = b.dataset.id; lsSet(LS.me, S.me); S.draft = {}; render(); goTab(0); },
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
      upsertUser(u); S.me = u.id; lsSet(LS.me, u.id);
      queue({ action: "saveUser", user: u });
      S.draft = {}; render(); goTab(1); celebrate(); toast("Welcome, " + u.name + ". Goal set to " + fmt(u.goalKcal) + " cal.");
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
      shrinkPhoto(e.target.files[0]).then(function (d) { S.mealImg = d; renderMe(); }, function (er) { toast(er.message); });
      return;
    }
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
  function toast(msg) {
    clearTimeout(toast.t);
    $("#toast").innerHTML = "<div>" + esc(msg) + "</div>";
    toast.t = setTimeout(function () { $("#toast").innerHTML = ""; }, 2600);
  }
  function celebrate(fromEl) {
    if (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var cv = $("#confetti"), ctx = cv.getContext("2d"), dpr = window.devicePixelRatio || 1;
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.scale(dpr, dpr);
    var ox = innerWidth / 2, oy = innerHeight * 0.35;
    if (fromEl && fromEl.getBoundingClientRect) { var r = fromEl.getBoundingClientRect(); ox = r.left + r.width / 2; oy = r.top + r.height / 2; }
    var cols = ["#d97757", "#e8a07f", "#7cbf86", "#e3b25b", "#f5f4ef", "#9d8cf0"], ps = [];
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
