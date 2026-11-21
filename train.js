// Fit Crew: workout tracker, PBs, weekly volume and the muscle recovery diagram. No Claude, no cost.
// Data lives in the same places as everything else, so the crew sees it too:
//   user.routines  [{id, name, days:[0-6, Sun=0], items:[{x, sets, g}]}]   (g = superset group letter)
//   user.pb        {exId: {n, w, wr, wd, e1, e1kg, e1r, e1d, r, rd}}         all-time bests
//   user.last      {exId: {d, sets:[[kg, reps]]}}                            last session, for "previous"
//   user.customEx  [{i, n, p:[muscle], s:[]}]                                exercises not in the list
//   day.lifts      [{id, name, rid, start, end, min, effort, kcal, exs:[{x, n, g, sets:[[kg, reps]]}], pbs:[]}]
// The workout in progress is kept on the phone only until Finish.
(function () {
  "use strict";
  var A = null; // app helpers, set in init()
  var DB = window.FC_EX || { m: [], pop: [], x: [] };
  var M = DB.m, EXMAP = {};
  DB.x.forEach(function (r) { EXMAP[r[0]] = { i: r[0], n: r[1], p: r[2], s: r[3], e: r[4], c: r[5], cat: r[6] }; });
  var LABEL = { chest: "Chest", shoulders: "Shoulders", biceps: "Biceps", triceps: "Triceps", forearms: "Forearms", abdominals: "Abs",
    lats: "Lats", "middle back": "Upper back", "lower back": "Lower back", traps: "Traps", neck: "Neck", glutes: "Glutes",
    quadriceps: "Quads", hamstrings: "Hamstrings", adductors: "Inner thighs", abductors: "Outer hips", calves: "Calves" };
  // Hours to recover after a typical hard session (about 4 to 6 working sets). Scaled by how many sets were done.
  // Smaller and single-joint muscles recover faster; big lower-body muscles slower; hamstrings slowest after heavy eccentric work.
  var RECOVER = { forearms: 36, calves: 36, abdominals: 36, neck: 36, biceps: 48, triceps: 48, shoulders: 48, traps: 48, abductors: 48,
    adductors: 60, chest: 60, lats: 60, "middle back": 60, quadriceps: 72, glutes: 72, "lower back": 72, hamstrings: 84 };
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], ORDER = [1, 2, 3, 4, 5, 6, 0];
  var EFFORT = { light: 3.5, normal: 5, hard: 6 };
  var ACT_KEY = "fitcrew.active";

  var T = { view: "home", draft: null, picker: null, q: "", mf: -1, active: loadActive(), finish: null, open: {}, mus: null, custom: null };

  function loadActive() { try { return JSON.parse(localStorage.getItem(ACT_KEY)) || null; } catch (e) { return null; } }
  function saveActive() { try { if (T.active) localStorage.setItem(ACT_KEY, JSON.stringify(T.active)); else localStorage.removeItem(ACT_KEY); } catch (e) {} }
  function $(s) { return document.querySelector(s); }
  function esc(s) { return A.esc(s); }
  function fmt(n) { return A.fmt(n); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function kgs(n) { return (Math.round(n * 100) / 100).toString(); }
  function uid() { return A.uid(); }
  function me() { return A.me(); }

  /* ---------- Exercises ---------- */
  function exInfo(id) {
    if (EXMAP[id]) return EXMAP[id];
    var users = A.S.cache.users || [];
    for (var i = 0; i < users.length; i++) {
      var c = (users[i].customEx || []).filter(function (x) { return x.i === id; })[0];
      if (c) return { i: c.i, n: c.n, p: c.p || [], s: c.s || [], e: "custom", c: 0 };
    }
    return { i: id, n: "Exercise", p: [], s: [], e: "" };
  }
  function shortName(n) { return String(n || "").replace(/ - Medium Grip$/, ""); }
  function musText(x) { return x.p.map(function (m) { return LABEL[M[m]]; }).join(", "); }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\bpull ?ups?\b/g, "pullup").replace(/\bpush ?ups?\b/g, "pushup").replace(/\bchin ?ups?\b/g, "chinup").replace(/\s+/g, " ").trim(); }
  function search(q, mf) {
    var u = me(), list = DB.x.map(function (r) { return EXMAP[r[0]]; }).concat(((u && u.customEx) || []).map(function (c) { return { i: c.i, n: c.n, p: c.p || [], s: c.s || [], e: "custom" }; }));
    if (mf >= 0) list = list.filter(function (x) { return x.p.indexOf(mf) >= 0; });
    var words = norm(q).split(" ").filter(Boolean);
    var popRank = {}; DB.pop.forEach(function (id, i) { popRank[id] = DB.pop.length - i; });
    if (!words.length) return list.sort(function (a, b) { return (popRank[b.i] || 0) - (popRank[a.i] || 0) || (b.c || 0) - (a.c || 0) || a.n.localeCompare(b.n); }).slice(0, 60);
    return list.map(function (x) {
      var n = norm(x.n), ok = words.every(function (w) { return n.indexOf(w) >= 0; });
      if (!ok) return null;
      var score = (popRank[x.i] || 0) * 3 + (n.indexOf(words[0]) === 0 ? 20 : 0) + (x.e === "custom" ? 30 : 0) - n.length / 10;
      return { x: x, s: score };
    }).filter(Boolean).sort(function (a, b) { return b.s - a.s; }).slice(0, 60).map(function (o) { return o.x; });
  }

  /* ---------- History helpers ---------- */
  function liftsOf(userId, days) {
    var out = [], t = A.today();
    for (var i = 0; i < days; i++) {
      var d = A.FC.addDays(t, -i), day = A.getDay(userId, d);
      (day && day.lifts || []).forEach(function (l) { out.push({ d: d, l: l }); });
    }
    return out;
  }
  function weekStart() { var t = A.today(), wd = new Date(t + "T12:00:00").getDay(); return A.FC.addDays(t, -((wd + 6) % 7)); }
  function weekStats(userId) {
    var ws = weekStart(), sets = {}, n = 0, total = 0, vol = 0;
    liftsOf(userId, 7).filter(function (o) { return o.d >= ws; }).forEach(function (o) {
      n++;
      o.l.exs.forEach(function (e) {
        var x = exInfo(e.x);
        e.sets.forEach(function (s) {
          total++; vol += (+s[0] || 0) * (+s[1] || 0);
          x.p.forEach(function (m) { sets[m] = (sets[m] || 0) + 1; });
          x.s.forEach(function (m) { sets[m] = (sets[m] || 0) + 0.5; });
        });
      });
    });
    return { sessions: n, sets: total, vol: vol, perMuscle: sets };
  }
  function e1rm(kg, reps) { reps = Math.min(+reps || 0, 12); return reps > 0 && kg > 0 ? kg * (1 + reps / 30) : 0; } // Epley, capped at 12 reps

  /* ---------- Recovery ---------- */
  function recovery(userId) {
    var now = Date.now(), res = {};
    M.forEach(function (m, i) { res[i] = { f: 0, left: 0, trained: false }; });
    liftsOf(userId, 7).forEach(function (o) {
      var t = o.l.end || o.l.start || new Date(o.d + "T18:00:00").getTime(), hrs = (now - t) / 36e5, per = {};
      o.l.exs.forEach(function (e) {
        var x = exInfo(e.x), n = e.sets.length;
        x.p.forEach(function (m) { per[m] = (per[m] || 0) + n; });
        x.s.forEach(function (m) { per[m] = (per[m] || 0) + n * 0.5; });
      });
      Object.keys(per).forEach(function (m) {
        var sets = per[m], need = RECOVER[M[m]] * Math.min(1.4, Math.max(0.6, 0.5 + 0.1 * sets));
        var f = Math.max(0, 1 - hrs / need) * Math.min(1, 0.4 + 0.15 * sets), r = res[m];
        r.trained = true;
        if (f > r.f) r.f = f;
        if (need - hrs > r.left) r.left = need - hrs;
      });
    });
    return res;
  }
  function mix(a, b, t) { return "#" + [0, 2, 4].map(function (i) { var x = parseInt(a.substr(i + 1, 2), 16), y = parseInt(b.substr(i + 1, 2), 16); return ("0" + Math.round(x + (y - x) * t).toString(16)).slice(-2); }).join(""); }
  function heat(r) {
    if (!r.trained) return "#45433f";
    var f = r.f; if (f <= 0) return "#7cbf86";
    return f < 0.5 ? mix("#7cbf86", "#e3b25b", f / 0.5) : mix("#e3b25b", "#ef6a5e", (f - 0.5) / 0.5);
  }

  // Original, simplified body outlines. Muscle shapes carry data-m (muscle index).
  function body(rec, small) {
    var mi = function (name) { return M.indexOf(name); };
    var shp = function (name, tag, attrs) { var i = mi(name); return "<" + tag + ' class="mus" data-tact="mus" data-m="' + i + '" fill="' + heat(rec[i]) + '" ' + attrs + "/>"; };
    var both = function (name, tag, fn) { return shp(name, tag, fn(1)) + shp(name, tag, fn(-1)); };
    var X = function (s, x) { return 100 + s * (x - 100); };
    var base = '<g class="sil"><circle cx="100" cy="28" r="17"/><path d="M78 58 Q100 50 122 58 L136 70 Q142 120 128 178 L72 178 Q58 120 64 70 Z"/>'
      + '<path d="M66 70 L50 130 L42 186" class="limb" style="stroke-width:22"/><path d="M134 70 L150 130 L158 186" class="limb" style="stroke-width:22"/>'
      + '<path d="M84 176 L80 280 L82 366" class="limb" style="stroke-width:32"/><path d="M116 176 L120 280 L118 366" class="limb" style="stroke-width:32"/>'
      + '<circle cx="41" cy="196" r="8"/><circle cx="159" cy="196" r="8"/><ellipse cx="80" cy="378" rx="11" ry="7"/><ellipse cx="120" cy="378" rx="11" ry="7"/></g>';
    var front = '<svg viewBox="0 0 200 392" class="fig">' + base
      + shp("neck", "rect", 'x="92" y="44" width="16" height="12" rx="4"')
      + both("traps", "path", function (s) { return 'd="M' + X(s, 92) + ' 54 L' + X(s, 76) + ' 62 L' + X(s, 92) + ' 62 Z"'; })
      + both("shoulders", "ellipse", function (s) { return 'cx="' + X(s, 66) + '" cy="76" rx="13" ry="13"'; })
      + both("chest", "path", function (s) { return 'd="M' + X(s, 99) + ' 66 L' + X(s, 79) + ' 68 Q' + X(s, 70) + ' 86 ' + X(s, 80) + ' 102 Q' + X(s, 90) + ' 106 ' + X(s, 99) + ' 102 Z"'; })
      + both("biceps", "ellipse", function (s) { return 'cx="' + X(s, 56) + '" cy="110" rx="8" ry="19" transform="rotate(' + (s * 14) + " " + X(s, 56) + ' 110)"'; })
      + both("forearms", "ellipse", function (s) { return 'cx="' + X(s, 46) + '" cy="158" rx="7.5" ry="23" transform="rotate(' + (s * 9) + " " + X(s, 46) + ' 158)"'; })
      + shp("abdominals", "rect", 'x="87" y="108" width="26" height="62" rx="9"')
      + both("abdominals", "path", function (s) { return 'd="M' + X(s, 84) + ' 112 Q' + X(s, 74) + ' 140 ' + X(s, 78) + ' 168 L' + X(s, 85) + ' 168 Z"'; })
      + both("abductors", "ellipse", function (s) { return 'cx="' + X(s, 72) + '" cy="190" rx="7" ry="13"'; })
      + both("quadriceps", "ellipse", function (s) { return 'cx="' + X(s, 84) + '" cy="232" rx="13" ry="38" transform="rotate(' + (s * 2) + " " + X(s, 84) + ' 232)"'; })
      + both("adductors", "path", function (s) { return 'd="M' + X(s, 98) + ' 186 Q' + X(s, 94) + ' 214 ' + X(s, 96) + ' 246 L' + X(s, 99) + ' 246 Z"'; })
      + both("calves", "ellipse", function (s) { return 'cx="' + X(s, 81) + '" cy="320" rx="8" ry="27"'; })
      + "</svg>";
    var back = '<svg viewBox="0 0 200 392" class="fig">' + base
      + shp("neck", "rect", 'x="92" y="44" width="16" height="10" rx="4"')
      + shp("traps", "path", 'd="M100 50 L76 64 L100 92 L124 64 Z"')
      + both("shoulders", "ellipse", function (s) { return 'cx="' + X(s, 66) + '" cy="76" rx="13" ry="13"'; })
      + shp("middle back", "path", 'd="M88 92 L100 96 L112 92 L110 124 L100 128 L90 124 Z"')
      + both("lats", "path", function (s) { return 'd="M' + X(s, 86) + ' 90 Q' + X(s, 70) + ' 104 ' + X(s, 74) + ' 132 Q' + X(s, 82) + ' 150 ' + X(s, 92) + ' 152 L' + X(s, 90) + ' 128 Z"'; })
      + shp("lower back", "rect", 'x="90" y="134" width="20" height="36" rx="8"')
      + both("triceps", "ellipse", function (s) { return 'cx="' + X(s, 56) + '" cy="110" rx="8" ry="19" transform="rotate(' + (s * 14) + " " + X(s, 56) + ' 110)"'; })
      + both("forearms", "ellipse", function (s) { return 'cx="' + X(s, 46) + '" cy="158" rx="7.5" ry="23" transform="rotate(' + (s * 9) + " " + X(s, 46) + ' 158)"'; })
      + both("glutes", "ellipse", function (s) { return 'cx="' + X(s, 87) + '" cy="190" rx="14" ry="15"'; })
      + both("hamstrings", "ellipse", function (s) { return 'cx="' + X(s, 84) + '" cy="244" rx="12" ry="34" transform="rotate(' + (s * 2) + " " + X(s, 84) + ' 244)"'; })
      + both("calves", "ellipse", function (s) { return 'cx="' + X(s, 81) + '" cy="318" rx="11" ry="27"'; })
      + "</svg>";
    return '<div class="bodies' + (small ? " sm" : "") + '"><div><span>Front</span>' + front + '</div><div><span>Back</span>' + back + "</div></div>";
  }
  function hoursText(h) { h = Math.ceil(h); return h >= 24 ? Math.round(h / 24 * 2) / 2 + " days" : h + " h"; }
  function recoveryCard(u, small) {
    var rec = recovery(u.id), h = body(rec, small);
    var sore = [], ready = [];
    M.forEach(function (m, i) { var r = rec[i]; if (!r.trained) return; if (r.f > 0.05) sore.push([LABEL[m], r.left]); else ready.push(LABEL[m]); });
    sore.sort(function (a, b) { return b[1] - a[1]; });
    var tip = "";
    if (!small && T.mus != null) {
      var r = rec[T.mus], nm = LABEL[M[T.mus]];
      tip = '<p class="mtip">' + esc(nm) + ": " + (!r.trained ? "not trained in the last week." : r.f > 0.05 ? "recovering, about " + hoursText(r.left) + " to go." : "recovered, ready to train.") + "</p>";
    }
    h += tip + '<div class="legend"><span><i style="background:#ef6a5e"></i>Recovering</span><span><i style="background:#e3b25b"></i>Nearly</span><span><i style="background:#7cbf86"></i>Ready</span><span><i style="background:#45433f"></i>Not trained this week</span></div>';
    if (!small) {
      if (sore.length) h += '<p class="hint"><b>Recovering:</b> ' + sore.map(function (s) { return esc(s[0]) + " (" + hoursText(s[1]) + ")"; }).join(", ") + "</p>";
      if (ready.length) h += '<p class="hint"><b>Ready again:</b> ' + esc(ready.join(", ")) + "</p>";
      h += '<p class="hint">A guide from your logged sets, not a measurement. Tap a muscle for details. Only workouts logged here count.</p>';
    }
    return h;
  }

  /* ---------- Rendering ---------- */
  function render(fromSync) {
    var el = $("#train"); if (!el) return;
    if (fromSync && el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    var u = me(); if (!u) { el.innerHTML = ""; return; }
    var h = T.active ? activeView(u) : T.view === "edit" && T.draft ? editView(u) : homeView(u);
    el.innerHTML = h;
    renderPicker();
  }

  function homeView(u) {
    var h = '<div class="card"><h2>Recovery</h2>' + recoveryCard(u) + "</div>";
    var routines = u.routines || [], wd = new Date().getDay();
    var todays = routines.filter(function (r) { return (r.days || []).indexOf(wd) >= 0; });
    h += '<div class="card"><h2>Today <small>' + DAYS[wd] + "</small></h2>";
    h += todays.length ? todays.map(function (r) { return routineRow(r, true); }).join("") : '<p class="empty">Nothing planned for today. Start any workout below, or take the rest.</p>';
    h += '<button class="btn wide" data-tact="startblank">' + A.ICON.plus + "Start an empty workout</button></div>";
    h += '<div class="card"><h2>My workouts <small>' + routines.length + "</small></h2>";
    h += routines.length ? routines.map(function (r) { return routineRow(r, false); }).join("") : '<p class="empty">No workouts yet. Build one: pick exercises, sets, supersets and which days you train it.</p>';
    h += '<button class="btn pri wide" data-tact="new">' + A.ICON.plus + "New workout</button></div>";
    h += weekCard(u) + pbCard(u) + historyCard(u);
    return h;
  }
  function routineRow(r, big) {
    var days = ORDER.filter(function (d) { return (r.days || []).indexOf(d) >= 0; }).map(function (d) { return DAYS[d]; }).join(" ");
    var n = r.items.length, sets = r.items.reduce(function (s, it) { return s + (+it.sets || 0); }, 0);
    return '<div class="row rt"><div class="t"><b>' + esc(r.name) + "</b><small>" + n + " exercise" + (n === 1 ? "" : "s") + " · " + sets + " sets" + (days ? " · " + days : "") + "</small></div>"
      + (big ? "" : '<button class="btn ghost sm" data-tact="edit" data-id="' + r.id + '">Edit</button>')
      + '<button class="btn pri sm" data-tact="start" data-id="' + r.id + '">Start</button></div>';
  }
  function weekCard(u) {
    var w = weekStats(u.id);
    var h = '<div class="card"><h2>This week <small>since Monday</small></h2><div class="stats"><div class="stat"><span>Workouts</span><b>' + w.sessions + '</b></div><div class="stat"><span>Sets</span><b>' + w.sets + '</b></div><div class="stat"><span>Volume</span><b>' + (w.vol >= 10000 ? r1(w.vol / 1000) + "t" : fmt(w.vol) + " kg") + "</b></div></div>";
    var rows = Object.keys(w.perMuscle).map(function (m) { return [+m, w.perMuscle[m]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (rows.length) {
      h += '<div class="vol">' + rows.map(function (r) {
        var s = r[1], pct = Math.min(100, s / 20 * 100);
        return '<div class="vr"><span>' + esc(LABEL[M[r[0]]]) + '</span><div class="vb"><i style="width:' + pct + "%;background:" + (s >= 10 ? "var(--good)" : "var(--accent)") + '"></i></div><b>' + r1(s) + "</b></div>";
      }).join("") + '</div><p class="hint">Sets per muscle this week (half a set for helper muscles). Around 10 to 20 hard sets a week per muscle is a common target for growth.</p>';
    } else h += '<p class="empty">No sets logged this week yet.</p>';
    return h + "</div>";
  }
  function pbList(u, days) {
    var pb = u.pb || {}, cut = A.FC.addDays(A.today(), -days), out = [];
    Object.keys(pb).forEach(function (id) {
      var p = pb[id], n = shortName(p.n || exInfo(id).n);
      if (p.wd && p.wd >= cut && p.wnew) out.push({ d: p.wd, t: n + ": " + kgs(p.w) + " kg × " + p.wr, k: "Heaviest" });
      if (p.e1d && p.e1d >= cut && p.e1new && p.e1d !== p.wd) out.push({ d: p.e1d, t: n + ": " + kgs(p.e1kg) + " kg × " + p.e1r, k: "Best set" });
      if (p.rd && p.rd >= cut && p.rnew) out.push({ d: p.rd, t: n + ": " + p.r + " reps", k: "Most reps" });
    });
    return out.sort(function (a, b) { return a.d < b.d ? 1 : -1; });
  }
  function pbCard(u) {
    var list = pbList(u, 30), pb = u.pb || {};
    var best = Object.keys(pb).filter(function (id) { return pb[id].e1 > 0; }).sort(function (a, b) { return pb[b].e1 - pb[a].e1; }).slice(0, 5);
    var h = '<div class="card"><h2>PBs <small>last 30 days</small></h2>';
    h += list.length ? '<div class="list">' + list.slice(0, 8).map(function (p) { return '<div class="row"><div class="t"><b>' + esc(p.t) + "</b><small>" + esc(p.k) + " · " + esc(A.dayLabel(p.d)) + '</small></div><span class="pbt">PB</span></div>'; }).join("") + "</div>" : '<p class="empty">No new PBs in the last 30 days. They show up here, and on the Crew page, the moment you beat one.</p>';
    if (best.length) h += '<p class="hint"><b>Strongest lifts</b> (estimated one-rep max): ' + best.map(function (id) { return esc(shortName(pb[id].n || exInfo(id).n)) + " " + fmt(pb[id].e1) + " kg"; }).join(" · ") + "</p>";
    return h + "</div>";
  }
  function historyCard(u) {
    var list = liftsOf(u.id, 70).slice(0, 12);
    var h = '<div class="card"><h2>History</h2>';
    if (!list.length) return h + '<p class="empty">Finished workouts show up here.</p></div>';
    h += '<div class="list">' + list.map(function (o) {
      var l = o.l, sets = l.exs.reduce(function (s, e) { return s + e.sets.length; }, 0), open = T.open[l.id];
      var x = '<div class="row hist" data-tact="hist" data-id="' + l.id + '" role="button"><div class="t"><b>' + esc(l.name) + "</b><small>" + esc(A.dayLabel(o.d)) + " · " + fmt(l.min) + " min · " + sets + " set" + (sets === 1 ? "" : "s") + ((l.pbs || []).length ? " · " + l.pbs.length + " PB" + (l.pbs.length > 1 ? "s" : "") : "") + '</small></div><span class="k">' + fmt(l.kcal) + "</span></div>";
      if (open) x += '<div class="hdet">' + l.exs.map(function (e) { return "<div><b>" + esc(shortName(e.n || exInfo(e.x).n)) + "</b> " + e.sets.map(function (s) { return (+s[0] ? kgs(s[0]) + "×" : "") + s[1]; }).join(", ") + "</div>"; }).join("") + "</div>";
      return x;
    }).join("") + "</div>";
    return h + '<p class="hint">Tap a workout to see the sets. To remove one, delete it from Exercise on the Me page.</p></div>';
  }

  /* ---------- Routine editor ---------- */
  function editView(u) {
    var r = T.draft;
    var h = '<div class="card"><h2>' + (r.isNew ? "New workout" : "Edit workout") + '</h2><div class="stack">'
      + '<label class="f">Name<input id="trName" placeholder="e.g. Push day, Upper A, Legs" value="' + esc(r.name) + '"></label>'
      + '<div><div class="hint" style="margin-bottom:6px">Which days?</div><div class="daypick">' + ORDER.map(function (d) { return '<button class="' + (r.days.indexOf(d) >= 0 ? "on" : "") + '" data-tact="day" data-d="' + d + '">' + DAYS[d].slice(0, 2) + "</button>"; }).join("") + "</div></div>";
    if (r.items.length) {
      h += '<div class="rlist">' + r.items.map(function (it, i) {
        var x = exInfo(it.x), linked = it.g && r.items[i + 1] && r.items[i + 1].g === it.g, inSs = !!it.g && ((r.items[i - 1] && r.items[i - 1].g === it.g) || linked);
        return '<div class="ritem' + (inSs ? " ss" : "") + '"><div class="t"><b>' + esc(shortName(x.n)) + "</b><small>" + esc(musText(x)) + (inSs ? " · superset " + it.g : "") + "</small></div>"
          + '<div class="stp"><button data-tact="sets" data-i="' + i + '" data-v="-1" aria-label="Fewer sets">−</button><span>' + it.sets + ' sets</span><button data-tact="sets" data-i="' + i + '" data-v="1" aria-label="More sets">+</button></div>'
          + '<div class="rbtns">' + (i < r.items.length - 1 ? '<button class="lnk' + (linked ? " on" : "") + '" data-tact="link" data-i="' + i + '">' + (linked ? "Unlink" : "Superset with next") + "</button>" : "")
          + '<button class="ic" data-tact="move" data-i="' + i + '" data-v="-1" aria-label="Move up"' + (i ? "" : " disabled") + ">↑</button>"
          + '<button class="ic" data-tact="move" data-i="' + i + '" data-v="1" aria-label="Move down"' + (i < r.items.length - 1 ? "" : " disabled") + ">↓</button>"
          + '<button class="ic" data-tact="rm" data-i="' + i + '" aria-label="Remove">×</button></div></div>';
      }).join("") + "</div>";
    } else h += '<p class="empty">No exercises yet.</p>';
    h += '<button class="btn wide" data-tact="pick" data-mode="routine">' + A.ICON.plus + "Add exercise</button>"
      + '<div class="btns"><button class="btn pri" style="flex:1" data-tact="save">Save workout</button><button class="btn ghost" data-tact="cancel">Cancel</button></div>'
      + (r.isNew ? "" : '<button class="btn danger wide" data-tact="del">Delete this workout</button>')
      + "</div></div>";
    return h;
  }
  function relabel(items) {
    // Give each run of linked exercises its own letter: A, B, C...
    var next = 0, map = {};
    items.forEach(function (it, i) {
      if (!it.g) return;
      var prevSame = items[i - 1] && items[i - 1].g === it.g, nextSame = items[i + 1] && items[i + 1].g === it.g;
      if (!prevSame && !nextSame) { it.g = ""; return; }
      if (!prevSame) map[i] = String.fromCharCode(65 + next++);
      else map[i] = map[i - 1];
    });
    items.forEach(function (it, i) { if (map[i]) it.g = map[i]; });
  }

  /* ---------- Active workout ---------- */
  function lastFor(u, id) { return ((u.last || {})[id] || {}).sets || []; }
  function newEx(u, id, n, g) {
    var prev = lastFor(u, id), rows = [];
    for (var i = 0; i < n; i++) rows.push({ kg: "", reps: "", done: false });
    return { x: id, g: g || "", sets: rows, prev: prev };
  }
  function startWorkout(r) {
    var u = me();
    T.active = { id: uid(), rid: r ? r.id : "", name: r ? r.name : "Workout", start: Date.now(), date: A.today(), lastTick: 0,
      exs: r ? r.items.map(function (it) { return newEx(u, it.x, it.sets, it.g); }) : [] };
    saveActive(); T.view = "home"; render();
    var p = $("#pTrain"); if (p) p.scrollTop = 0;
  }
  function clock(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + ss).slice(-2); }
  function activeView(u) {
    var w = T.active, done = 0, total = 0;
    w.exs.forEach(function (e) { e.sets.forEach(function (s) { total++; if (s.done) done++; }); });
    if (T.finish) return finishView(u);
    var h = '<div class="card wk"><div class="wkh"><div><input id="wkName" class="wkname" value="' + esc(w.name) + '" aria-label="Workout name"><small><span id="tTimer">' + clock(Date.now() - w.start) + "</span> · " + done + "/" + total + ' sets<span id="tRest"></span></small></div>'
      + '<button class="btn pri" data-tact="finish">Finish</button></div></div>';
    var i = 0;
    while (i < w.exs.length) {
      var g = w.exs[i].g, grp = [i];
      if (g) while (w.exs[i + grp.length] && w.exs[i + grp.length].g === g) grp.push(i + grp.length);
      h += grp.length > 1 ? '<div class="ssbox"><div class="sslab">Superset ' + esc(g) + ": do one set of each, then rest</div>" + grp.map(function (k) { return exBlock(u, k); }).join("") + "</div>" : exBlock(u, i);
      i += grp.length;
    }
    if (!w.exs.length) h += '<p class="empty" style="padding:0 4px 12px">Add your first exercise.</p>';
    h += '<button class="btn wide" data-tact="pick" data-mode="active" style="margin-bottom:10px">' + A.ICON.plus + "Add exercise</button>"
      + '<button class="btn danger wide" data-tact="discard">Discard workout</button>';
    return h;
  }
  function exBlock(u, k) {
    var e = T.active.exs[k], x = exInfo(e.x), pb = (u.pb || {})[e.x];
    var h = '<div class="card exb"><div class="exh"><div class="t"><b>' + esc(shortName(x.n)) + "</b><small>" + esc(musText(x)) + (pb && pb.w ? " · PB " + kgs(pb.w) + " kg × " + pb.wr : "") + '</small></div><button class="x" data-tact="exrm" data-k="' + k + '" aria-label="Remove exercise">×</button></div>'
      + '<div class="sets"><div class="sr hd"><span>Set</span><span>Last time</span><span>kg</span><span>Reps</span><span></span></div>';
    e.sets.forEach(function (s, j) {
      var p = e.prev[j] || e.prev[e.prev.length - 1];
      var ptxt = p ? (+p[0] ? kgs(p[0]) + " × " : "") + p[1] : "–";
      h += '<div class="sr' + (s.done ? " done" : "") + '"><span class="sn">' + (j + 1) + '</span><span class="pv">' + ptxt + "</span>"
        + '<input id="s_' + k + "_" + j + '_kg" data-k="' + k + '" data-j="' + j + '" data-f="kg" inputmode="decimal" placeholder="' + (p ? kgs(p[0]) : "kg") + '" value="' + esc(s.kg) + '">'
        + '<input id="s_' + k + "_" + j + '_reps" data-k="' + k + '" data-j="' + j + '" data-f="reps" inputmode="numeric" placeholder="' + (p ? p[1] : "reps") + '" value="' + esc(s.reps) + '">'
        + '<button class="tick' + (s.done ? " on" : "") + '" data-tact="tick" data-k="' + k + '" data-j="' + j + '" aria-label="Set done">✓</button></div>';
    });
    return h + '</div><div class="btns"><button class="btn ghost sm" data-tact="addset" data-k="' + k + '">+ Set</button>' + (e.sets.length > 1 ? '<button class="btn ghost sm" data-tact="rmset" data-k="' + k + '">− Set</button>' : "") + "</div></div>";
  }
  function finishView(u) {
    var w = T.active, f = T.finish, min = f.min, kc = A.FC.exerciseCal(EFFORT[f.effort], min, A.bodyOf(u));
    var sets = w.exs.reduce(function (s, e) { return s + e.sets.filter(function (x) { return x.done; }).length; }, 0);
    return '<div class="card"><h2>Finish workout</h2><div class="stack"><p class="hint">' + sets + " sets done. Unticked sets aren't saved.</p>"
      + '<label class="f">How long did it take (minutes)?<input id="fnMin" inputmode="numeric" value="' + min + '"></label>'
      + '<div><div class="hint" style="margin-bottom:6px">How hard was it?</div><div class="seg">' + ["light", "normal", "hard"].map(function (k) { return '<button class="' + (f.effort === k ? "on" : "") + '" data-tact="effort" data-v="' + k + '">' + k.charAt(0).toUpperCase() + k.slice(1) + "</button>"; }).join("") + "</div></div>"
      + '<label class="f">Calories burned<input id="fnK" inputmode="numeric" value="' + (f.kcal != null ? f.kcal : kc) + '"></label>'
      + '<p class="hint">Worked out from the time and effort with your weight, height, age and sex (weights: light 3.5, normal 5, hard 6 MET). Change it if your watch says otherwise.</p>'
      + '<div class="btns"><button class="btn pri" style="flex:1" data-tact="save-workout">Save workout</button><button class="btn ghost" data-tact="back">Back</button></div></div></div>';
  }

  function saveWorkout() {
    var u = me(), w = T.active, f = T.finish;
    var min = Math.max(1, Math.round(+($("#fnMin") || {}).value || f.min)), kc = Math.round(+($("#fnK") || {}).value);
    if (!(kc >= 0)) kc = A.FC.exerciseCal(EFFORT[f.effort], min, A.bodyOf(u));
    var exs = w.exs.map(function (e) {
      var sets = e.sets.filter(function (s) { return s.done; }).map(function (s) { return [+String(s.kg).replace(",", ".") || 0, Math.round(+s.reps) || 0]; }).filter(function (s) { return s[1] > 0; });
      return { x: e.x, n: exInfo(e.x).n, g: e.g, sets: sets };
    }).filter(function (e) { return e.sets.length; });
    if (!exs.length) { A.toast("Tick at least one set first"); return; }
    var date = w.date || A.today(), pbs = [], pbMap = JSON.parse(JSON.stringify(u.pb || {})), last = JSON.parse(JSON.stringify(u.last || {}));
    exs.forEach(function (e) {
      var old = pbMap[e.x], p = old ? JSON.parse(JSON.stringify(old)) : { n: e.n }, first = !old;
      p.n = e.n;
      e.sets.forEach(function (s) {
        var kg = s[0], reps = s[1], est = e1rm(kg, reps);
        if (kg > 0 && (!(p.w > 0) || kg > p.w || (kg === p.w && reps > p.wr))) { var heavier = p.w > 0 && kg > p.w; p.w = kg; p.wr = reps; p.wd = date; p.wnew = !first && heavier; if (p.wnew) pbs.push({ x: e.x, n: e.n, t: "w", kg: kg, reps: reps }); }
        if (est > (p.e1 || 0) + 0.05) { var better = p.e1 > 0; p.e1 = r1(est); p.e1kg = kg; p.e1r = reps; p.e1d = date; p.e1new = !first && better; if (p.e1new && !(pbs.length && pbs[pbs.length - 1].x === e.x && pbs[pbs.length - 1].kg === kg)) pbs.push({ x: e.x, n: e.n, t: "e1", kg: kg, reps: reps }); }
        if (!kg && reps > (p.r || 0)) { var more = p.r > 0; p.r = reps; p.rd = date; p.rnew = !first && more; if (p.rnew) pbs.push({ x: e.x, n: e.n, t: "r", reps: reps }); }
      });
      pbMap[e.x] = p;
      last[e.x] = { d: date, sets: e.sets };
    });
    // Keep one PB per exercise in the summary
    var seen = {}; pbs = pbs.reverse().filter(function (p) { if (seen[p.x]) return false; seen[p.x] = 1; return true; }).reverse();
    var lift = { id: w.id, name: w.name || "Workout", rid: w.rid, start: w.start, end: Date.now(), min: min, effort: f.effort, kcal: kc, exs: exs, pbs: pbs };
    var nsets = exs.reduce(function (s, e) { return s + e.sets.length; }, 0);
    A.changeMe(function (uu) { uu.pb = pbMap; uu.last = last; });
    A.changeDay(date, function (d) {
      d.lifts = (d.lifts || []).filter(function (l) { return l.id !== lift.id; }); d.lifts.push(lift);
      d.ex = d.ex.filter(function (x) { return x.lift !== lift.id; });
      d.ex.push({ id: uid(), name: lift.name, kcal: kc, min: min, note: min + " min · " + nsets + " sets · tracked", src: "tracker", lift: lift.id });
    });
    T.active = null; T.finish = null; saveActive(); render();
    A.celebrate();
    A.toast(pbs.length ? pbs.length + " new PB" + (pbs.length > 1 ? "s" : "") + "! " + pbs.map(function (p) { return shortName(p.n); }).join(", ") : "Workout saved. " + fmt(kc) + " cal added to today.");
  }

  /* ---------- Exercise picker ---------- */
  function renderPicker() {
    var ov = $("#tpick");
    if (!T.picker) { if (ov) ov.remove(); return; }
    if (!ov) {
      // Built once; typing only refreshes the list, so the phone keyboard stays open
      ov = document.createElement("div"); ov.id = "tpick";
      ov.innerHTML = '<div class="tp-head"><input id="tpQ" type="search" enterkeyhint="search" placeholder="Search 750+ exercises, e.g. bench, squat, curl" autocomplete="off"><button class="btn" data-tact="pickdone">Done</button></div>'
        + '<div class="chips tp-mus" id="tpMus"></div><div class="tp-list" id="tpList"></div>';
      document.body.appendChild(ov);
      $("#tpQ").value = T.q;
    }
    $("#tpMus").innerHTML = '<button class="chip' + (T.mf < 0 ? " on" : "") + '" data-tact="mf" data-m="-1">All</button>' + M.map(function (m, i) { return '<button class="chip' + (T.mf === i ? " on" : "") + '" data-tact="mf" data-m="' + i + '">' + LABEL[m] + "</button>"; }).join("");
    var res = search(T.q, T.mf), h = "";
    if (!T.q && T.mf < 0) h += '<p class="hint" style="padding:4px 2px 8px">Popular exercises. Search or pick a muscle to see more.</p>';
    h += res.map(function (x) { return '<button class="tp-item" data-tact="add" data-x="' + esc(x.i) + '"><b>' + esc(x.n) + "</b><small>" + esc(musText(x)) + (x.e ? " · " + esc(x.e) : "") + "</small></button>"; }).join("");
    if (!res.length) h += '<p class="empty">No match.</p>';
    h += T.custom ? customForm() : '<button class="btn ghost wide" data-tact="custom" style="margin-top:8px">Can\'t find it? Add your own exercise</button>';
    $("#tpList").innerHTML = h;
  }
  function customForm() {
    return '<div class="edit" style="margin-top:8px"><label class="f">Exercise name<input id="cxN" value="' + esc(T.custom.n || T.q) + '"></label>'
      + '<label class="f">Main muscle<select id="cxM">' + M.map(function (m, i) { return '<option value="' + i + '"' + (T.custom.m === i ? " selected" : "") + ">" + LABEL[m] + "</option>"; }).join("") + "</select></label>"
      + '<div class="btns"><button class="btn pri" style="flex:1" data-tact="customsave">Add exercise</button><button class="btn ghost" data-tact="customcancel">Cancel</button></div></div>';
  }
  function addExercise(id) {
    var u = me();
    if (T.picker.mode === "routine") T.draft.items.push({ x: id, sets: 3, g: "" });
    else { T.active.exs.push(newEx(u, id, 3, "")); saveActive(); }
    A.toast("Added " + shortName(exInfo(id).n));
    render();
  }

  /* ---------- Actions ---------- */
  var ACT = {
    mus: function (b) { var m = +b.dataset.m; T.mus = T.mus === m ? null : m; render(); },
    new: function () { T.view = "edit"; T.draft = { id: uid(), name: "", days: [], items: [], isNew: true }; render(); },
    edit: function (b) { var r = (me().routines || []).filter(function (x) { return x.id === b.dataset.id; })[0]; if (!r) return; T.view = "edit"; T.draft = JSON.parse(JSON.stringify(r)); render(); },
    day: function (b) { var d = +b.dataset.d, i = T.draft.days.indexOf(d); if (i >= 0) T.draft.days.splice(i, 1); else T.draft.days.push(d); render(); },
    sets: function (b) { var it = T.draft.items[+b.dataset.i]; it.sets = Math.max(1, Math.min(10, it.sets + +b.dataset.v)); render(); },
    link: function (b) {
      var it = T.draft.items, i = +b.dataset.i, a = it[i], n = it[i + 1];
      if (a.g && n.g === a.g) { // unlink: split the group here
        var rest = it.slice(i + 1).filter(function (x, k) { return it[i + 1 + k].g === a.g; });
        rest.forEach(function (x) { x.g = "z" + i; });
      } else { var g = a.g || n.g || "n" + i; a.g = g; n.g = g; }
      relabel(it); render();
    },
    move: function (b) { var it = T.draft.items, i = +b.dataset.i, j = i + +b.dataset.v; if (j < 0 || j >= it.length) return; var t = it[i]; it[i] = it[j]; it[j] = t; relabel(it); render(); },
    rm: function (b) { T.draft.items.splice(+b.dataset.i, 1); relabel(T.draft.items); render(); },
    save: function () {
      var r = T.draft; r.name = (($("#trName") || {}).value || "").trim() || "Workout";
      if (!r.items.length) return A.toast("Add at least one exercise");
      delete r.isNew; relabel(r.items);
      A.changeMe(function (u) { u.routines = (u.routines || []).filter(function (x) { return x.id !== r.id; }); u.routines.push(r); });
      T.view = "home"; T.draft = null; render(); A.toast("Saved " + r.name);
    },
    cancel: function () { T.view = "home"; T.draft = null; render(); },
    del: function () { var id = T.draft.id; A.changeMe(function (u) { u.routines = (u.routines || []).filter(function (x) { return x.id !== id; }); }); T.view = "home"; T.draft = null; render(); },
    pick: function (b) { T.picker = { mode: b.dataset.mode }; T.q = ""; T.mf = -1; T.custom = null; render(); setTimeout(function () { var q = $("#tpQ"); if (q && window.innerWidth > 700) q.focus(); }, 50); },
    pickdone: function () { T.picker = null; T.custom = null; render(); },
    mf: function (b) { T.mf = +b.dataset.m; renderPicker(); },
    add: function (b) { addExercise(b.dataset.x); },
    custom: function () { T.custom = { n: T.q, m: T.mf >= 0 ? T.mf : 0 }; renderPicker(); },
    customcancel: function () { T.custom = null; renderPicker(); },
    customsave: function () {
      var n = (($("#cxN") || {}).value || "").trim(), m = +($("#cxM") || {}).value;
      if (!n) return A.toast("Name it first");
      var id = "c_" + uid();
      A.changeMe(function (u) { u.customEx = (u.customEx || []).concat([{ i: id, n: n.slice(0, 60), p: [m], s: [] }]); });
      T.custom = null; addExercise(id);
    },
    start: function (b) {
      if (T.active) return A.toast("Finish or discard the current workout first");
      var r = (me().routines || []).filter(function (x) { return x.id === b.dataset.id; })[0]; startWorkout(r);
    },
    startblank: function () { if (T.active) return A.toast("Finish or discard the current workout first"); startWorkout(null); },
    tick: function (b) {
      var e = T.active.exs[+b.dataset.k], s = e.sets[+b.dataset.j], p = e.prev[+b.dataset.j] || e.prev[e.prev.length - 1];
      if (!s.done) {
        if (s.reps === "" && p) { s.reps = String(p[1]); if (s.kg === "") s.kg = String(p[0]); }
        if (!(+s.reps > 0)) return A.toast("Enter the reps first");
        s.done = true; T.active.lastTick = Date.now();
        if (navigator.vibrate) navigator.vibrate(30);
      } else s.done = false;
      saveActive(); render();
    },
    addset: function (b) { var e = T.active.exs[+b.dataset.k], l = e.sets[e.sets.length - 1]; e.sets.push({ kg: l ? l.kg : "", reps: "", done: false }); saveActive(); render(); },
    rmset: function (b) { var e = T.active.exs[+b.dataset.k]; if (e.sets.length > 1) e.sets.pop(); saveActive(); render(); },
    exrm: function (b) { T.active.exs.splice(+b.dataset.k, 1); saveActive(); render(); },
    finish: function () {
      var any = T.active.exs.some(function (e) { return e.sets.some(function (s) { return s.done; }); });
      if (!any) return A.toast("Tick at least one set first");
      T.finish = { min: Math.max(1, Math.round((Date.now() - T.active.start) / 60000)), effort: "normal", kcal: null }; render();
    },
    effort: function (b) { T.finish.effort = b.dataset.v; T.finish.min = Math.max(1, Math.round(+($("#fnMin") || {}).value || T.finish.min)); T.finish.kcal = null; render(); },
    back: function () { T.finish = null; render(); },
    "save-workout": saveWorkout,
    discard: function (b) {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to discard"; setTimeout(function () { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "Discard workout"; } }, 3000); return; }
      T.active = null; T.finish = null; saveActive(); render(); A.toast("Workout discarded");
    },
    hist: function (b) { T.open[b.dataset.id] = !T.open[b.dataset.id]; render(); }
  };

  /* ---------- Crew page and profile ---------- */
  function crewHtml() {
    var users = A.S.cache.users || [], items = [];
    users.forEach(function (u) { pbList(u, 7).forEach(function (p) { items.push({ u: u, p: p }); }); });
    if (!items.length) return "";
    items.sort(function (a, b) { return a.p.d < b.p.d ? 1 : -1; });
    return '<div class="card"><h2>PBs this week <small>' + items.length + "</small></h2><div class=\"list\" style=\"margin:0\">" + items.slice(0, 8).map(function (o) {
      return '<div class="row"><div class="t"><b>' + esc(o.u.name) + " · " + esc(o.p.t) + "</b><small>" + esc(o.p.k) + " · " + esc(A.dayLabel(o.p.d)) + '</small></div><span class="pbt">PB</span></div>';
    }).join("") + "</div></div>";
  }
  function profileHtml(u) {
    var w = weekStats(u.id), last = liftsOf(u.id, 70)[0], pb = u.pb || {};
    var best = Object.keys(pb).filter(function (id) { return pb[id].e1 > 0; }).sort(function (a, b) { return pb[b].e1 - pb[a].e1; }).slice(0, 3);
    if (!w.sessions && !last && !best.length) return "";
    var h = '<div class="card"><h2>Training</h2><div class="stats"><div class="stat"><span>Workouts</span><b>' + w.sessions + '</b></div><div class="stat"><span>Sets</span><b>' + w.sets + '</b></div><div class="stat"><span>Volume</span><b>' + (w.vol >= 10000 ? r1(w.vol / 1000) + "t" : fmt(w.vol)) + "</b></div></div>";
    if (last) h += '<p class="hint" style="margin-bottom:8px">Last workout: <b>' + esc(last.l.name) + "</b>, " + esc(A.dayLabel(last.d).toLowerCase()) + ".</p>";
    if (best.length) h += '<p class="hint" style="margin-bottom:8px">Best lifts: ' + best.map(function (id) { return esc(shortName(pb[id].n || exInfo(id).n)) + " " + kgs(pb[id].w) + " kg × " + pb[id].wr; }).join(" · ") + "</p>";
    return h + recoveryCard(u, true) + "</div>";
  }

  /* ---------- Wiring ---------- */
  function init(api) {
    A = api;
    document.addEventListener("click", function (e) {
      var b = e.target.closest("[data-tact]"); if (!b) return;
      var a = b.dataset.tact; if (ACT[a]) { e.preventDefault(); ACT[a](b, e); }
    });
    document.addEventListener("input", function (e) {
      var t = e.target;
      if (t.id === "tpQ") { T.q = t.value; renderPicker(); return; }
      if (t.id === "trName" && T.draft) { T.draft.name = t.value; return; }
      if (t.id === "wkName" && T.active) { T.active.name = t.value; saveActive(); return; }
      if (t.dataset && t.dataset.f && T.active) {
        var s = T.active.exs[+t.dataset.k].sets[+t.dataset.j]; s[t.dataset.f] = t.value; saveActive();
      }
      if ((t.id === "fnMin") && T.finish) { T.finish.min = Math.max(1, Math.round(+t.value || 1)); var k = $("#fnK"); if (k) k.value = A.FC.exerciseCal(EFFORT[T.finish.effort], T.finish.min, A.bodyOf(me())); }
      if (t.id === "fnK" && T.finish) T.finish.kcal = t.value;
    });
    setInterval(function () {
      if (!T.active) return;
      var tm = $("#tTimer"); if (tm) tm.textContent = clock(Date.now() - T.active.start);
      var rs = $("#tRest"); if (rs) rs.textContent = T.active.lastTick ? " · rest " + clock(Date.now() - T.active.lastTick) : "";
    }, 1000);
  }

  window.FCTrain = { init: init, render: render, crewHtml: crewHtml, profileHtml: profileHtml, active: function () { return !!T.active; },
    _test: { recovery: recovery, e1rm: e1rm, search: search, exInfo: exInfo } };
})();
