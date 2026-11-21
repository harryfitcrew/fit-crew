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

  var SV = function (d) { return '<svg viewBox="0 0 24 24" class="ti">' + d + "</svg>"; };
  var TI = {
    clock: SV('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
    list: SV('<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>'),
    left: SV('<path d="M15 18l-6-6 6-6"/>'), right: SV('<path d="M9 18l6-6-6-6"/>'),
    check: SV('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
    trophy: SV('<path d="M8 4h8v5a4 4 0 01-8 0V4zM8 6H5a3 3 0 003 4M16 6h3a3 3 0 01-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
    dumbbell: SV('<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>'),
    body: SV('<circle cx="12" cy="4.5" r="2"/><path d="M12 7v7M7 9l5 1 5-1M9.5 21l2.5-7 2.5 7"/>'),
    cal: SV('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>'),
    chart: SV('<path d="M4 19h16M7 15l4-5 3 3 5-7"/>'),
    hist: SV('<path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
    sun: SV('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>')
  };
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
  function hoursText(h) { h = Math.ceil(h); if (h < 24) return h + " h"; var d = Math.round(h / 24 * 2) / 2; return d + (d === 1 ? " day" : " days"); }
  function recoveryCard(u, small) {
    var rec = recovery(u.id), h = body(rec, small);
    var sore = [], ready = [];
    M.forEach(function (m, i) { var r = rec[i]; if (!r.trained) return; if (r.f > 0.05) sore.push([i, r.left]); else ready.push(i); });
    sore.sort(function (a, b) { return b[1] - a[1]; });
    if (!small && T.mus != null) {
      var r = rec[T.mus], nm = LABEL[M[T.mus]];
      h += '<p class="mtip"><i style="background:' + heat(r) + '"></i>' + esc(nm) + ": " + (!r.trained ? "not trained this week" : r.f > 0.05 ? hoursText(r.left) + " to go" : "ready") + "</p>";
    }
    h += '<div class="legend lg2"><span><i style="background:#ef6a5e"></i>Recovering</span><span><i style="background:#e3b25b"></i>Nearly</span><span><i style="background:#7cbf86"></i>Ready</span><span><i style="background:#45433f"></i>Not trained</span></div>';
    if (!small && (sore.length || ready.length)) {
      h += '<div class="rchips">' + sore.map(function (s) { return '<span class="rchip" style="--c:' + heat(rec[s[0]]) + '">' + esc(LABEL[M[s[0]]]) + "<b>" + hoursText(s[1]) + "</b></span>"; }).join("")
        + ready.map(function (i) { return '<span class="rchip ok">' + esc(LABEL[M[i]]) + "</span>"; }).join("") + "</div>";
    }
    if (!small) h += A.tip("rec", "A guide from your logged sets in the last week, not a measurement. Bigger muscles and heavy lower-body work take longer (hamstrings up to about 3.5 days); forearms, calves and abs recover in a day or two. More sets mean longer. Tap a muscle for its time. Only workouts logged here count.");
    return h;
  }

  /* ---------- Lift progress chart (best estimated max per session) ---------- */
  function progressData(u) {
    var by = {};
    liftsOf(u.id, 70).forEach(function (o) {
      o.l.exs.forEach(function (e) {
        var best = 0; e.sets.forEach(function (st) { best = Math.max(best, e1rm(st[0], st[1])); });
        if (!best) return;
        (by[e.x] = by[e.x] || []).push([o.d, r1(best)]);
      });
    });
    return Object.keys(by).map(function (id) { return { id: id, pts: by[id].reverse() }; }).filter(function (d) { return d.pts.length > 1; }).sort(function (a, b) { return b.pts.length - a.pts.length; });
  }
  function progressCard(u) {
    var data = progressData(u); if (!data.length) return "";
    var sel = data.filter(function (d) { return d.id === T.prog; })[0] || data[0];
    var pts = sel.pts, W = 320, H = 150, P = 26;
    var vals = pts.map(function (p) { return p[1]; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 5) { lo -= 2.5; hi += 2.5; }
    var x = function (i) { return pts.length === 1 ? W / 2 : P + i * (W - P * 2) / (pts.length - 1); }, y = function (v) { return H - 22 - (v - lo) / (hi - lo) * (H - 44); };
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + y(p[1]).toFixed(1); }).join(" ");
    var area = line + " L" + x(pts.length - 1).toFixed(1) + " " + (H - 22) + " L" + x(0).toFixed(1) + " " + (H - 22) + " Z";
    var first = vals[0], last = vals[vals.length - 1], diff = r1(last - first);
    var svg = '<svg viewBox="0 0 ' + W + " " + H + '" class="pchart"><defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".35"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#pg)"/><path d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>'
      + pts.map(function (p, i) { return '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(p[1]).toFixed(1) + '" r="3.5" fill="var(--card)" stroke="var(--accent)" stroke-width="2"/>'; }).join("")
      + '<text x="' + x(0) + '" y="' + (H - 6) + '" class="pax" text-anchor="' + (pts.length === 1 ? "middle" : "start") + '">' + esc(A.dayLabel(pts[0][0])) + "</text>"
      + (pts.length > 1 ? '<text x="' + x(pts.length - 1) + '" y="' + (H - 6) + '" class="pax" text-anchor="end">' + esc(A.dayLabel(pts[pts.length - 1][0])) + "</text>" : "")
      + '<text x="' + (x(pts.length - 1) - (pts.length > 1 ? 0 : 0)) + '" y="' + (y(last) - 10).toFixed(1) + '" class="pval" text-anchor="' + (pts.length > 1 ? "end" : "middle") + '">' + fmt(last) + " kg</text></svg>";
    return '<div class="card">' + A.head("chart", "Progress", "est. max", "prog")
      + '<div class="chips pchips">' + data.slice(0, 6).map(function (d) { return '<button class="chip' + (d.id === sel.id ? " on" : "") + '" data-tact="prog" data-x="' + esc(d.id) + '">' + esc(shortName(exInfo(d.id).n)) + "</button>"; }).join("") + "</div>"
      + svg + (pts.length > 1 ? '<div class="pdiff ' + (diff > 0 ? "up" : diff < 0 ? "down" : "") + '">' + (diff > 0 ? "▲ +" : diff < 0 ? "▼ " : "") + kgs(diff) + " kg over " + pts.length + " sessions</div>" : '<p class="hint">Log it again to see a trend.</p>')
      + A.tip("prog", "Each dot is your best set that session, turned into an estimated one-rep max (Epley formula) so different weights and reps can be compared. Shows the last 10 weeks.") + "</div>";
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
    var routines = u.routines || [], wd = new Date().getDay();
    var todays = routines.filter(function (r) { return (r.days || []).indexOf(wd) >= 0; });
    var h = "";
    if (todays.length) h += todays.map(function (r) {
      var mus = {}; r.items.forEach(function (it) { exInfo(it.x).p.forEach(function (m) { mus[m] = 1; }); });
      var sets = r.items.reduce(function (s, it) { return s + (+it.sets || 0); }, 0);
      return '<div class="card hero"><div class="hlab">' + TI.sun + "Today · " + DAYS[wd] + '</div><div class="hname">' + esc(r.name) + '</div><div class="hmeta">' + r.items.length + " exercises · " + sets + ' sets</div><div class="mchips left">'
        + Object.keys(mus).map(function (m) { return '<span class="mchip">' + esc(LABEL[M[m]]) + "</span>"; }).join("") + '</div><button class="btn pri wide xl" data-tact="start" data-id="' + r.id + '">' + TI.dumbbell + "Start workout</button></div>";
    }).join("");
    else h += '<div class="card hero rest-day"><div class="hlab">' + TI.sun + "Today · " + DAYS[wd] + '</div><div class="hname">Rest day</div><div class="hmeta">Nothing planned. Train anyway or recover.</div><button class="btn wide" data-tact="startblank">' + A.ICON.plus + "Start an empty workout</button></div>";
    h += '<div class="card">' + A.head("body", "Recovery", "", "rec") + recoveryCard(u) + "</div>";
    h += '<div class="card">' + A.head("list", "My workouts", routines.length ? String(routines.length) : "");
    h += routines.length ? routines.map(function (r) { return routineRow(r, false); }).join("") : '<p class="empty">No workouts yet. Build one with exercises, sets, supersets and days.</p>';
    h += '<div class="btns"><button class="btn pri" style="flex:1" data-tact="new">' + A.ICON.plus + "New workout</button>" + (todays.length ? '<button class="btn" data-tact="startblank">Empty workout</button>' : "") + "</div></div>";
    h += weekCard(u) + progressCard(u) + pbCard(u) + historyCard(u);
    return h;
  }
  function routineRow(r, big) {
    var days = ORDER.filter(function (d) { return (r.days || []).indexOf(d) >= 0; }).map(function (d) { return DAYS[d]; }).join(" ");
    var n = r.items.length, sets = r.items.reduce(function (s, it) { return s + (+it.sets || 0); }, 0);
    return '<div class="row rt"><span class="ricon">' + A.ICON.dumbbell + '</span><div class="t"><b>' + esc(r.name) + "</b><small>" + n + " exercise" + (n === 1 ? "" : "s") + " · " + sets + " sets" + (days ? " · " + days : "") + "</small></div>"
      + (big ? "" : '<button class="btn ghost sm" data-tact="edit" data-id="' + r.id + '">Edit</button>')
      + '<button class="btn pri sm" data-tact="start" data-id="' + r.id + '">Start</button></div>';
  }
  function weekCard(u) {
    var w = weekStats(u.id);
    var h = '<div class="card">' + A.head("cal", "This week", "since Monday", "week") + '<div class="stats"><div class="stat"><span>Workouts</span><b>' + w.sessions + '</b></div><div class="stat"><span>Sets</span><b>' + w.sets + '</b></div><div class="stat"><span>Volume</span><b>' + (w.vol >= 10000 ? r1(w.vol / 1000) + "t" : fmt(w.vol) + " kg") + "</b></div></div>";
    var rows = Object.keys(w.perMuscle).map(function (m) { return [+m, w.perMuscle[m]]; }).sort(function (a, b) { return b[1] - a[1]; });
    if (rows.length) {
      h += '<div class="vol">' + rows.map(function (r) {
        var s = r[1], pct = Math.min(100, s / 20 * 100);
        return '<div class="vr"><span>' + esc(LABEL[M[r[0]]]) + '</span><div class="vb"><i style="width:' + pct + "%;background:" + (s >= 10 ? "var(--good)" : "var(--accent)") + '"></i></div><b>' + r1(s) + "</b></div>";
      }).join("") + "</div>" + A.tip("week", "Sets per muscle this week, with half a set for helper muscles. Around 10 to 20 hard sets a week per muscle is a common target for growth; bars turn green at 10.");
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
    var best = Object.keys(pb).filter(function (id) { return pb[id].e1 > 0; }).sort(function (a, b) { return pb[b].e1 - pb[a].e1; }).slice(0, 4);
    if (!list.length && !best.length) return "";
    var h = '<div class="card">' + A.head("trophy", "PBs", "last 30 days", "pb");
    h += list.length ? '<div class="pbgrid">' + list.slice(0, 6).map(function (p) {
      return '<div class="pbtile"><span class="pbic">' + TI.trophy + '</span><div class="pbn">' + esc(p.t.split(": ")[0]) + '</div><div class="pbv">' + esc(p.t.split(": ")[1] || "") + '</div><div class="pbd">' + esc(p.k) + " · " + esc(A.dayLabel(p.d)) + "</div></div>";
    }).join("") + "</div>" : '<p class="empty">No new PBs in the last 30 days yet.</p>';
    if (best.length) h += '<div class="slab">Strongest lifts</div><div class="strong">' + best.map(function (id) { return '<div><b>' + fmt(pb[id].e1) + '<small>kg</small></b><span>' + esc(shortName(pb[id].n || exInfo(id).n)) + "</span></div>"; }).join("") + "</div>";
    return h + A.tip("pb", "PBs count when you beat your heaviest weight, your best estimated one-rep max, or your most reps on a bodyweight exercise. Your first session with an exercise just sets the starting point. Strongest lifts show estimated one-rep max.") + "</div>";
  }
  function historyCard(u) {
    var list = liftsOf(u.id, 70).slice(0, 12);
    var h = '<div class="card">' + A.head("hist", "History", "", "hist");
    if (!list.length) return h + '<p class="empty">Finished workouts show up here.</p></div>';
    h += '<div class="list">' + list.map(function (o) {
      var l = o.l, sets = l.exs.reduce(function (s, e) { return s + e.sets.length; }, 0), open = T.open[l.id];
      var x = '<div class="row hist" data-tact="hist" data-id="' + l.id + '" role="button"><span class="ricon">' + ((l.pbs || []).length ? TI.trophy : A.ICON.dumbbell) + '</span><div class="t"><b>' + esc(l.name) + "</b><small>" + esc(A.dayLabel(o.d)) + " · " + fmt(l.min) + " min · " + sets + " set" + (sets === 1 ? "" : "s") + ((l.pbs || []).length ? " · " + l.pbs.length + " PB" + (l.pbs.length > 1 ? "s" : "") : "") + '</small></div><span class="k">' + fmt(l.kcal) + "</span></div>";
      if (open) x += '<div class="hdet">' + l.exs.map(function (e) { return "<div><b>" + esc(shortName(e.n || exInfo(e.x).n)) + "</b> " + e.sets.map(function (s) { return (+s[0] ? kgs(s[0]) + "×" : "") + s[1]; }).join(", ") + "</div>"; }).join("") + "</div>";
      return x;
    }).join("") + "</div>";
    return h + A.tip("hist", "Tap a workout to see the sets. To remove one, delete it from Exercise on the Me page.") + "</div>";
  }

  /* ---------- Routine editor ---------- */
  function editView(u) {
    var r = T.draft;
    var h = '<div class="card">' + A.head("dumbbell", r.isNew ? "New workout" : "Edit workout") + '<div class="stack">'
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
  // Rest after a set: big barbell lifts 2:30, other compound lifts 2:00, isolation 1:30
  function defaultRest(id) {
    var x = exInfo(id), n = String(x.n).toLowerCase();
    var big = /deadlift|hip thrust|power clean|^clean|snatch|leg press/.test(n)
      || (/squat/.test(n) && /barbell|front|hack|smith|^squat/.test(n))
      || (/bench press|military press|overhead press|shoulder press|bent over barbell row/.test(n) && /barbell|military|bench press - powerlifting|^bench press/.test(n));
    return big && x.e !== "dumbbell" && x.e !== "kettlebells" ? 150 : x.c ? 120 : 90;
  }
  function newEx(u, id, n, g, rest) {
    var prev = lastFor(u, id), rows = [];
    for (var i = 0; i < n; i++) rows.push({ kg: "", reps: "", done: false });
    return { x: id, g: g || "", sets: rows, prev: prev, rest: rest || defaultRest(id) };
  }
  function startWorkout(r) {
    var u = me();
    T.active = { id: uid(), rid: r ? r.id : "", name: r ? r.name : "Workout", start: Date.now(), date: A.today(), lastTick: 0, cur: 0, rest: null,
      exs: r ? r.items.map(function (it) { return newEx(u, it.x, it.sets, it.g, it.rest); }) : [] };
    T.overview = !T.active.exs.length;
    saveActive(); T.view = "home"; wake(true); render();
    var p = $("#pTrain"); if (p) p.scrollTop = 0;
  }
  function clock(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + ss).slice(-2); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + ("0" + sec % 60).slice(-2); }
  function doneCount(e) { return e.sets.filter(function (s) { return s.done; }).length; }
  function nextSet(e) { for (var j = 0; j < e.sets.length; j++) if (!e.sets[j].done) return j; return -1; }
  function groupOf(k) { var w = T.active, g = w.exs[k].g, out = []; if (!g) return [k]; w.exs.forEach(function (e, i) { if (e.g === g) out.push(i); }); return out; }
  function firstOpen(from) { var w = T.active, n = w.exs.length; for (var i = 0; i < n; i++) { var k = (from + i) % n; if (nextSet(w.exs[k]) >= 0) return k; } return -1; }
  function setVal(e, j, f) {
    // What to show in the editor for set j: what's typed, else this session's previous set, else last time
    var s = e.sets[j]; if (s[f] !== "") return s[f];
    for (var i = j - 1; i >= 0; i--) if (e.sets[i].done) return e.sets[i][f];
    var p = e.prev[j] || e.prev[e.prev.length - 1]; return p ? String(f === "kg" ? p[0] : p[1]) : "";
  }

  // Live workout: one exercise at a time
  function activeView(u) {
    var w = T.active;
    if (T.finish) return finishView(u);
    if (w.cur >= w.exs.length) w.cur = Math.max(0, w.exs.length - 1);
    var done = 0, total = 0;
    w.exs.forEach(function (e) { e.sets.forEach(function (s) { total++; if (s.done) done++; }); });
    var h = '<div class="card livehd"><div class="wkh"><div><input id="wkName" class="wkname" value="' + esc(w.name) + '" aria-label="Workout name"><small>' + TI.clock + '<span id="tTimer">' + clock(Date.now() - w.start) + "</span> · " + done + "/" + total + " sets</small></div>"
      + '<button class="icb' + (T.overview ? " on" : "") + '" data-tact="overview" aria-label="All exercises">' + TI.list + '</button><button class="btn pri" data-tact="finish">Finish</button></div>'
      + '<div class="prog">' + w.exs.map(function (e, k) { var dc = doneCount(e); return '<button data-tact="goto" data-k="' + k + '" class="' + (k === w.cur && !T.overview ? "cur " : "") + (dc === e.sets.length ? "full" : dc ? "part" : "") + '" aria-label="Exercise ' + (k + 1) + '"></button>'; }).join("") + "</div></div>";
    h += restPanel();
    if (T.overview || !w.exs.length) return h + overviewView(u);
    return h + liveExercise(u, w.cur);
  }
  function restPanel() {
    var r = T.active.rest; if (!r) return "";
    var left = Math.max(0, (r.until - Date.now()) / 1000), pct = Math.min(1, left / r.dur), C = 2 * Math.PI * 34;
    return '<div class="card rest"><svg viewBox="0 0 80 80" class="rring"><circle cx="40" cy="40" r="34" class="bg"/><circle id="rArc" cx="40" cy="40" r="34" class="fg" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct)).toFixed(1) + '"/></svg>'
      + '<div class="rmid"><span class="rl">Rest</span><b id="rLeft">' + mmss(left) + '</b></div>'
      + '<div class="rbtn"><button class="btn sm" data-tact="rest" data-v="-15">−15 s</button><button class="btn sm" data-tact="rest" data-v="15">+15 s</button><button class="btn sm pri" data-tact="restskip">Skip</button></div></div>';
  }
  function musChips(x) { return x.p.map(function (m) { return '<span class="mchip">' + esc(LABEL[M[m]]) + "</span>"; }).join("") + x.s.slice(0, 2).map(function (m) { return '<span class="mchip s">' + esc(LABEL[M[m]]) + "</span>"; }).join(""); }
  function liveExercise(u, k) {
    var w = T.active, e = w.exs[k], x = exInfo(e.x), pb = (u.pb || {})[e.x], j = nextSet(e), grp = groupOf(k);
    var h = '<div class="card live"><div class="lnav"><button class="icb" data-tact="goto" data-k="' + (k - 1) + '"' + (k ? "" : " disabled") + ' aria-label="Previous exercise">' + TI.left + '</button>'
      + '<span>Exercise ' + (k + 1) + " of " + w.exs.length + (grp.length > 1 ? ' · <b class="sspill">Superset ' + esc(e.g) + "</b>" : "") + "</span>"
      + '<button class="icb" data-tact="goto" data-k="' + (k + 1) + '"' + (k < w.exs.length - 1 ? "" : " disabled") + ' aria-label="Next exercise">' + TI.right + "</button></div>"
      + '<h3 class="lname">' + esc(shortName(x.n)) + '</h3><div class="mchips">' + musChips(x) + "</div>"
      + (pb && pb.w ? '<div class="lpb">' + TI.trophy + "PB " + kgs(pb.w) + " kg × " + pb.wr + (pb.e1 ? '<span>· est. max ' + fmt(pb.e1) + " kg</span>" : "") + "</div>" : "");
    if (grp.length > 1) h += '<div class="ssnext">' + grp.map(function (i) { return '<span class="' + (i === k ? "on" : "") + '">' + esc(shortName(exInfo(w.exs[i].x).n)) + " " + doneCount(w.exs[i]) + "/" + w.exs[i].sets.length + "</span>"; }).join('<i>→</i>') + "</div>";
    h += '<div class="lsets">' + e.sets.map(function (s, i) {
      var p = e.prev[i] || e.prev[e.prev.length - 1];
      if (s.done) return '<button class="ls done" data-tact="undo" data-k="' + k + '" data-j="' + i + '"><span class="n">' + TI.check + '</span><b>' + (+s.kg ? kgs(+s.kg) + " kg × " : "") + s.reps + '</b><small>tap to redo</small></button>';
      if (i === j) return '<div class="ls now"><span class="n">' + (i + 1) + "</span><b>Set " + (i + 1) + "</b><small>" + (p ? "Last time " + (+p[0] ? kgs(p[0]) + " × " : "") + p[1] : "First time") + "</small></div>";
      return '<div class="ls"><span class="n">' + (i + 1) + "</span><b>" + (p ? (+p[0] ? kgs(p[0]) + " kg × " : "") + p[1] : "Set " + (i + 1)) + "</b><small>" + (p ? "last time" : "") + "</small></div>";
    }).join("") + "</div>";
    if (j >= 0) {
      h += '<div class="editor"><div class="stepper"><span>kg</span><button data-tact="step" data-f="kg" data-v="-2.5" aria-label="Less weight">−</button><input id="lkg" data-k="' + k + '" data-j="' + j + '" data-f="kg" inputmode="decimal" value="' + esc(setVal(e, j, "kg")) + '" placeholder="0"><button data-tact="step" data-f="kg" data-v="2.5" aria-label="More weight">+</button></div>'
        + '<div class="stepper"><span>reps</span><button data-tact="step" data-f="reps" data-v="-1" aria-label="Fewer reps">−</button><input id="lreps" data-k="' + k + '" data-j="' + j + '" data-f="reps" inputmode="numeric" value="' + esc(setVal(e, j, "reps")) + '" placeholder="0"><button data-tact="step" data-f="reps" data-v="1" aria-label="More reps">+</button></div></div>'
        + '<button class="btn pri wide xl" data-tact="log">' + TI.check + "Log set " + (j + 1) + "</button>";
    } else {
      var nx = firstOpen(k + 1);
      h += nx >= 0 ? '<div class="exdone">' + TI.check + 'Exercise done</div><button class="btn pri wide xl" data-tact="goto" data-k="' + nx + '">Next: ' + esc(shortName(exInfo(w.exs[nx].x).n)) + " " + TI.right + "</button>"
        : '<div class="exdone">' + TI.trophy + 'All sets done. Nice work.</div><button class="btn pri wide xl" data-tact="finish">Finish workout</button>';
    }
    h += '<div class="lfoot"><button class="btn ghost sm" data-tact="addset" data-k="' + k + '">+ Set</button>' + (e.sets.length > 1 && j !== 0 ? '<button class="btn ghost sm" data-tact="rmset" data-k="' + k + '">− Set</button>' : "")
      + '<span class="rdef">' + TI.clock + "Rest " + mmss(e.rest) + "</span></div></div>";
    return h;
  }
  function overviewView(u) {
    var w = T.active;
    var h = '<div class="card"><h2>' + TI.list + "Exercises</h2>";
    if (w.exs.length) h += '<div class="list">' + w.exs.map(function (e, k) {
      var x = exInfo(e.x), dc = doneCount(e);
      return '<div class="row ov' + (e.g ? " ssrow" : "") + '"><div class="t tap" data-tact="goto" data-k="' + k + '"><b>' + esc(shortName(x.n)) + "</b><small>" + (e.g ? "Superset " + esc(e.g) + " · " : "") + esc(musText(x)) + '</small></div><span class="cnt' + (dc === e.sets.length ? " full" : "") + '">' + dc + "/" + e.sets.length + '</span><button class="x" data-tact="exrm" data-k="' + k + '" aria-label="Remove exercise">×</button></div>';
    }).join("") + "</div>";
    else h += '<p class="empty">Add your first exercise.</p>';
    return h + '<button class="btn wide" data-tact="pick" data-mode="active">' + A.ICON.plus + "Add exercise</button></div>"
      + '<button class="btn danger wide" data-tact="discard">Discard workout</button>';
  }

  // Short beep and buzz when rest ends (audio is unlocked by the Log set tap)
  var audio = null;
  function unlockAudio() { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (e) {} }
  function beep() {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    try { if (!audio) return; [0, 0.25].forEach(function (t) { var o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; g.gain.setValueAtTime(0.2, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.2); o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2); }); } catch (e) {}
  }
  // Keep the screen on during a workout where the phone allows it
  var lock = null;
  function wake(on) {
    try {
      if (on && !lock && navigator.wakeLock && document.visibilityState === "visible") navigator.wakeLock.request("screen").then(function (l) { lock = l; l.addEventListener("release", function () { lock = null; }); }, function () {});
      if (!on && lock) { lock.release(); lock = null; }
    } catch (e) {}
  }
  function logSet() {
    var w = T.active, k = w.cur, e = w.exs[k], j = nextSet(e); if (j < 0) return;
    var s = e.sets[j];
    s.kg = String(setVal(e, j, "kg")); s.reps = String(setVal(e, j, "reps"));
    if (!(+s.reps > 0)) { A.toast("Enter the reps first"); return; }
    s.done = true; w.lastTick = Date.now(); unlockAudio();
    if (navigator.vibrate) navigator.vibrate(30);
    var grp = groupOf(k), mine = doneCount(e), rest = true, next = k;
    if (grp.length > 1) {
      // Superset: go to the next exercise in the group that hasn't done this round yet, no rest between
      var pos = grp.indexOf(k);
      for (var i = 1; i < grp.length; i++) { var c = grp[(pos + i) % grp.length]; if (nextSet(w.exs[c]) >= 0 && doneCount(w.exs[c]) < mine) { next = c; rest = false; break; } }
      if (rest) { var open = grp.filter(function (c) { return nextSet(w.exs[c]) >= 0; }); next = open.length ? open.sort(function (a, b) { return doneCount(w.exs[a]) - doneCount(w.exs[b]) || a - b; })[0] : firstOpen(grp[grp.length - 1] + 1); }
    } else if (nextSet(e) < 0) next = firstOpen(k + 1);
    if (next < 0) { rest = false; next = k; }
    w.rest = rest ? { until: Date.now() + e.rest * 1000, dur: e.rest, k: k } : null;
    w.cur = next; saveActive(); render();
    var p = $("#pTrain"); if (p) p.scrollTop = 0;
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
    A.changeMe(function (uu) {
      uu.pb = pbMap; uu.last = last;
      // Remember rest times changed during the workout in the saved workout
      var r = (uu.routines || []).filter(function (x) { return x.id === w.rid; })[0];
      if (r) r.items.forEach(function (it) { var e = w.exs.filter(function (z) { return z.x === it.x; })[0]; if (e && e.rest) it.rest = e.rest; });
    });
    A.changeDay(date, function (d) {
      d.lifts = (d.lifts || []).filter(function (l) { return l.id !== lift.id; }); d.lifts.push(lift);
      d.ex = d.ex.filter(function (x) { return x.lift !== lift.id; });
      d.ex.push({ id: uid(), name: lift.name, kcal: kc, min: min, note: min + " min · " + nsets + " sets · tracked", src: "tracker", lift: lift.id });
    });
    T.active = null; T.finish = null; T.overview = false; saveActive(); wake(false); render();
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
    else { T.active.exs.push(newEx(u, id, 3, "")); T.active.cur = T.active.exs.length - 1; T.overview = false; saveActive(); }
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
    log: logSet,
    step: function (b) {
      var w = T.active, e = w.exs[w.cur], j = nextSet(e); if (j < 0) return;
      var f = b.dataset.f, cur = parseFloat(String(setVal(e, j, f)).replace(",", ".")) || 0, v = Math.max(0, r1(cur + +b.dataset.v));
      e.sets[j][f] = String(v); saveActive();
      var el = $(f === "kg" ? "#lkg" : "#lreps"); if (el) el.value = v;
    },
    undo: function (b) { var e = T.active.exs[+b.dataset.k], s = e.sets[+b.dataset.j]; s.done = false; T.active.cur = +b.dataset.k; saveActive(); render(); },
    "goto": function (b) { var k = +b.dataset.k; if (k < 0 || k >= T.active.exs.length) return; T.active.cur = k; T.overview = false; saveActive(); render(); var p = $("#pTrain"); if (p) p.scrollTop = 0; },
    overview: function () { T.overview = !T.overview; render(); },
    rest: function (b) {
      var r = T.active.rest; if (!r) return;
      var v = +b.dataset.v, e = T.active.exs[r.k];
      r.until += v * 1000; r.dur = Math.max(15, r.dur + v);
      if (e) e.rest = Math.max(30, Math.min(600, e.rest + v)); // remembered for this exercise (30 s minimum)
      if (r.until <= Date.now()) T.active.rest = null;
      saveActive(); render();
    },
    restskip: function () { T.active.rest = null; saveActive(); render(); },
    addset: function (b) { var e = T.active.exs[+b.dataset.k]; e.sets.push({ kg: "", reps: "", done: false }); saveActive(); render(); },
    rmset: function (b) { var e = T.active.exs[+b.dataset.k]; if (e.sets.length > 1 && !e.sets[e.sets.length - 1].done) e.sets.pop(); saveActive(); render(); },
    exrm: function (b) { var w = T.active, k = +b.dataset.k; w.exs.splice(k, 1); if (w.cur >= k && w.cur > 0) w.cur--; saveActive(); render(); },
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
      T.active = null; T.finish = null; T.overview = false; saveActive(); wake(false); render(); A.toast("Workout discarded");
    },
    prog: function (b) { T.prog = b.dataset.x; render(); },
    hist: function (b) { T.open[b.dataset.id] = !T.open[b.dataset.id]; render(); }
  };

  /* ---------- Crew page and profile ---------- */
  function crewHtml() {
    var users = A.S.cache.users || [], items = [];
    users.forEach(function (u) { pbList(u, 7).forEach(function (p) { items.push({ u: u, p: p }); }); });
    if (!items.length) return "";
    items.sort(function (a, b) { return a.p.d < b.p.d ? 1 : -1; });
    return '<div class="card">' + A.head("trophy", "PBs this week", String(items.length)) + '<div class="pbgrid">' + items.slice(0, 8).map(function (o) {
      return '<div class="pbtile"><span class="pbav" style="background:' + esc(o.u.color || "#d97757") + '">' + esc(String(o.u.name || "?").charAt(0).toUpperCase()) + '</span><span class="pbic">' + TI.trophy + '</span><div class="pbn">' + esc(o.u.name) + " · " + esc(o.p.t.split(": ")[0]) + '</div><div class="pbv">' + esc(o.p.t.split(": ")[1] || "") + '</div><div class="pbd">' + esc(A.dayLabel(o.p.d)) + "</div></div>";
    }).join("") + "</div></div>";
  }
  function profileHtml(u) {
    var w = weekStats(u.id), last = liftsOf(u.id, 70)[0], pb = u.pb || {};
    var best = Object.keys(pb).filter(function (id) { return pb[id].e1 > 0; }).sort(function (a, b) { return pb[b].e1 - pb[a].e1; }).slice(0, 3);
    if (!w.sessions && !last && !best.length) return "";
    var h = '<div class="card">' + A.head("dumbbell", "Training") + '<div class="stats"><div class="stat"><span>Workouts</span><b>' + w.sessions + '</b></div><div class="stat"><span>Sets</span><b>' + w.sets + '</b></div><div class="stat"><span>Volume</span><b>' + (w.vol >= 10000 ? r1(w.vol / 1000) + "t" : fmt(w.vol)) + "</b></div></div>";
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
      var r = T.active.rest;
      if (r) {
        var left = (r.until - Date.now()) / 1000;
        if (left <= 0) { T.active.rest = null; saveActive(); beep(); A.toast("Rest over. Next set."); render(); return; }
        var lt = $("#rLeft"); if (lt) lt.textContent = mmss(left);
        var arc = $("#rArc"); if (arc) { var C = 2 * Math.PI * 34; arc.setAttribute("stroke-dashoffset", (C * (1 - Math.min(1, left / r.dur))).toFixed(1)); }
      }
    }, 250);
    document.addEventListener("visibilitychange", function () { if (T.active && document.visibilityState === "visible") { wake(true); render(); } });
    if (T.active) wake(true);
  }

  window.FCTrain = { init: init, render: render, crewHtml: crewHtml, profileHtml: profileHtml, active: function () { return !!T.active; },
    _test: { recovery: recovery, e1rm: e1rm, search: search, exInfo: exInfo } };
})();
