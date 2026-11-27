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
    run: SV('<circle cx="14" cy="4.5" r="2"/><path d="M7 21l3-6 3 2v5M5.5 12l3-4 4 1 3 4 3 1M10 15l2-6"/>'),
    up: SV('<path d="M12 19V5M5 12l7-7 7 7"/>'), down: SV('<path d="M12 5v14M5 12l7 7 7-7"/>'),
    target: SV('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'),
    expand: SV('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    note: SV('<path d="M5 4h11l3 3v13H5z"/><path d="M8 10h8M8 14h8M8 18h5"/>'),
    play: SV('<path d="M8 5.5v13l10.5-6.5z"/>'),
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
  /* ---------- Cardio ----------
   * Treadmill, run and walk use the ACSM walking/running equations (speed and incline); outdoor cycling uses
   * speed bands. Machines without speed use approximate Compendium of Physical Activities values by effort.
   * A watch figure always overrides. */
  var CARDIO = {
    treadmill: { n: "Treadmill", f: ["min", "kmh", "inc"] },
    run: { n: "Run", f: ["min", "km"], eff: { light: 8, normal: 10, hard: 12 } },
    walk: { n: "Walk", f: ["min", "km"], eff: { light: 4, normal: 5, hard: 6 } },
    cycle: { n: "Cycle (outdoor)", f: ["min", "km"], eff: { light: 15, normal: 20, hard: 25 } },
    bike: { n: "Exercise bike", f: ["min"], met: { light: 3.5, normal: 6.8, hard: 8.8 } },
    row: { n: "Rower", f: ["min", "km"], met: { light: 4.8, normal: 7.0, hard: 8.5 } },
    elliptical: { n: "Cross trainer", f: ["min"], met: { light: 4.0, normal: 5.0, hard: 7.0 } },
    stairs: { n: "Stair climber", f: ["min"], met: { light: 6.0, normal: 9.0, hard: 10.0 } },
    swim: { n: "Swim", f: ["min", "km"], met: { light: 5.8, normal: 7.0, hard: 9.8 } },
    other: { n: "Other cardio", f: ["min"], met: { light: 4.0, normal: 6.0, hard: 8.0 } }
  };
  var CORDER = ["treadmill", "run", "walk", "cycle", "bike", "row", "elliptical", "stairs", "swim", "other"];
  function isCardio(e) { return String(e && e.x || "").indexOf("cardio:") === 0; }
  function cardioType(id) { return String(id).replace("cardio:", ""); }
  function num(v) { var n = parseFloat(String(v == null ? "" : v).replace(",", ".")); return isFinite(n) && n > 0 ? n : 0; }
  // Returns {met, min, note} for a cardio entry {min, km, kmh, inc, eff}
  function cardioMET(type, c) {
    var T0 = CARDIO[type] || CARDIO.other, min = num(c.min), km = num(c.km), eff = c.eff || "normal", met = 0, note = "";
    if (type === "treadmill") {
      var v = num(c.kmh) || 5, g = num(c.inc) / 100;
      met = v < 7.5 ? A.FC.walkMET(v, g) : A.FC.runMET(v, g);
      note = v + " km/h" + (g ? " · " + num(c.inc) + "% incline" : "");
    } else if (type === "run" || type === "walk" || type === "cycle") {
      var sp = km && min ? km / (min / 60) : T0.eff[eff];
      met = type === "run" ? A.FC.runMET(sp, 0) : type === "walk" ? A.FC.walkMET(Math.min(sp, 7.5), 0) : A.FC.bikeMET(sp);
      note = km ? km + " km · " + (Math.round(sp * 10) / 10) + " km/h" : eff + " pace";
    } else { met = (T0.met || CARDIO.other.met)[eff]; note = (km ? km + " km · " : "") + eff; }
    return { met: Math.round(met * 10) / 10, min: min, note: note };
  }
  function cardioKcal(type, c) {
    if (num(c.watch)) return Math.round(num(c.watch));
    var r = cardioMET(type, c); return A.FC.exerciseCal(r.met, r.min, A.bodyOf(me()));
  }

  function exInfo(id) {
    if (String(id).indexOf("cardio:") === 0) { var ct = CARDIO[cardioType(id)] || CARDIO.other; return { i: id, n: ct.n, p: [], s: [], e: "cardio", c: 0, cardio: true }; }
    if (EXMAP[id]) return EXMAP[id];
    var users = A.S.cache.users || [];
    for (var i = 0; i < users.length; i++) {
      var c = (users[i].customEx || []).filter(function (x) { return x.i === id; })[0];
      if (c) return { i: c.i, n: c.n, p: c.p || [], s: c.s || [], e: "custom", c: 0 };
    }
    return { i: id, n: "Exercise", p: [], s: [], e: "" };
  }
  // Two photos per exercise (start and end position) from free-exercise-db, public domain. Loaded when first shown, then kept on the phone.
  var IMG = "https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/";
  var NOIMG = { Kettlebell_Halo: 1, Kettlebell_Halo_With_Overhead_Extension: 1, Kettlebell_Overhead_Triceps_Extension: 1 };
  function demo(id, small) {
    if (!EXMAP[id] || NOIMG[id]) return '<div class="demo none' + (small ? " sm" : "") + '">' + TI.dumbbell + "<span>No demo for this one</span></div>";
    var u = IMG + encodeURIComponent(id) + "/";
    return '<div class="demo' + (small ? " sm" : "") + '" data-tact="zoom" data-x="' + esc(id) + '" role="button" aria-label="Enlarge demo"><img src="' + u + '0.jpg" alt="Start position" decoding="async" onerror="this.parentNode.classList.add(\'none\')"><img class="f2" src="' + u + '1.jpg" alt="End position" decoding="async" onerror="this.parentNode.classList.add(\'none\')"><span class="dlab">Demo</span><span class="dzoom">' + TI.expand + "Tap to enlarge</span></div>";
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
    var ws = weekStart(), sets = {}, n = 0, total = 0, vol = 0, cmin = 0;
    liftsOf(userId, 7).filter(function (o) { return o.d >= ws; }).forEach(function (o) {
      n++;
      o.l.exs.forEach(function (e) {
        var x = exInfo(e.x);
        if (e.cardio) cmin += +e.cardio.min || 0;
        e.sets.forEach(function (s) {
          total++; if (!e.t) vol += (+s[0] || 0) * (+s[1] || 0);
          x.p.forEach(function (m) { sets[m] = (sets[m] || 0) + 1; });
          x.s.forEach(function (m) { sets[m] = (sets[m] || 0) + 0.5; });
        });
      });
    });
    return { sessions: n, sets: total, vol: vol, perMuscle: sets, cmin: cmin };
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
    if (!r.trained) return "#3a413c";
    var f = r.f; if (f <= 0) return "#34d6a4";
    return f < 0.5 ? mix("#34d6a4", "#ffb547", f / 0.5) : mix("#ffb547", "#ff5d5d", (f - 0.5) / 0.5);
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
    h += '<div class="legend lg2"><span><i style="background:#ff5d5d"></i>Recovering</span><span><i style="background:#ffb547"></i>Nearly</span><span><i style="background:#34d6a4"></i>Ready</span><span><i style="background:#3a413c"></i>Not trained</span></div>';
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
        if (e.t) return;
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
    var h = T.active ? activeView(u) : T.view === "edit" && T.draft ? editView(u) : T.view === "cardio" && T.cardio ? cardioView(u) : T.view === "rec" && T.rec ? recView(u) : homeView(u);
    el.innerHTML = h;
    renderPicker();
    if (A.syncHistory) A.syncHistory();
  }
  // Phone back button on the Train tab: close the top thing that's open. False when there's nothing to close.
  function goBack() {
    if (T.picker) { T.picker = null; T.custom = null; render(); return true; }
    if (T.active && T.finish) { T.finish = null; render(); return true; }
    if (T.active && T.overview && T.active.exs.length) { T.overview = false; render(); return true; }
    if (!T.active && T.view !== "home") { T.view = "home"; T.draft = null; T.cardio = null; T.logMode = null; T.rec = null; A.S.est = null; render(); return true; }
    return false;
  }

  function homeView(u) {
    var routines = u.routines || [], wd = new Date().getDay();
    var todays = routines.filter(function (r) { return (r.days || []).indexOf(wd) >= 0; });
    var h = "";
    if (todays.length) h += todays.map(function (r) {
      var mus = {}; r.items.forEach(function (it) { exInfo(it.x).p.forEach(function (m) { mus[m] = 1; }); });
      var sets = r.items.reduce(function (s, it) { return s + (+it.sets || 0); }, 0);
      return '<div class="card hero"><div class="hlab">' + TI.sun + "Today · " + DAYS[wd] + '</div><div class="hname">' + esc(r.name) + '</div><div class="hmeta">' + r.items.length + " exercises · " + sets + ' sets</div><div class="mchips left">'
        + Object.keys(mus).map(function (m) { return '<span class="mchip">' + esc(LABEL[M[m]]) + "</span>"; }).join("") + '</div><button class="btn pri wide xl" data-tact="start" data-id="' + r.id + '">' + TI.dumbbell + "Start workout</button>" + recBtn() + "</div>";
    }).join("");
    else h += '<div class="card hero rest-day"><div class="hlab">' + TI.sun + "Today · " + DAYS[wd] + '</div><div class="hname">Rest day</div><div class="hmeta">Nothing planned. Train anyway or recover.</div><button class="btn wide" data-tact="startblank">' + A.ICON.plus + "Start an empty workout</button>" + recBtn() + "</div>";
    h += activityCard(u);
    h += '<div class="card">' + A.head("body", "Recovery", "", "rec") + recoveryCard(u) + "</div>";
    h += '<div class="card">' + A.head("list", "My workouts", routines.length ? String(routines.length) : "");
    h += routines.length ? sortedRoutines(routines).map(function (r) { return routineRow(r, false); }).join("") : '<p class="empty">No workouts yet. Build one with exercises, sets, supersets and days.</p>';
    h += '<div class="btns"><button class="btn pri" style="flex:1" data-tact="new">' + A.ICON.plus + "New workout</button>" + (todays.length ? '<button class="btn" data-tact="startblank">Empty workout</button>' : "") + "</div>"
      + "</div>";
    h += weekCard(u) + progressCard(u) + pbCard(u) + historyCard(u);
    return h;
  }
  /* Everything burned on the chosen day: tracked workouts, cardio, estimates and watch figures */
  function activityCard(u) {
    var d = A.S.date, t = A.today(), ex = ((A.getDay(u.id, d) || {}).ex) || [], kc = ex.reduce(function (s, e) { return s + (+e.kcal || 0); }, 0);
    return '<div class="card">' + A.head("flame", "Activity", fmt(kc) + " cal burned")
      + '<div class="datebar sm"><button class="icon" data-act="day" data-v="-1" aria-label="Previous day">' + TI.left + "</button><b>" + esc(A.dayLabel(d)) + '</b><button class="icon" data-act="day" data-v="1" aria-label="Next day"' + (d >= t ? " disabled" : "") + ">" + TI.right + "</button></div>"
      + A.exListHtml(u)
      + '<button class="btn pri wide" data-tact="lognew" style="margin-top:10px">' + A.ICON.plus + "Log activity</button></div>";
  }
  function sortedRoutines(list) {
    var rank = function (r) { var ds = (r.days || []).map(function (d) { return ORDER.indexOf(d); }).filter(function (i) { return i >= 0; }); return ds.length ? Math.min.apply(null, ds) : 99; };
    return list.slice().sort(function (a, b) { return rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)); });
  }
  function recBtn() { return '<button class="btn ghost sm recbtn" data-tact="rec">' + A.ICON.spark + "Recommend a workout</button>"; }
  function routineRow(r, big) {
    var days = ORDER.filter(function (d) { return (r.days || []).indexOf(d) >= 0; }).map(function (d) { return DAYS[d]; }).join(" ");
    var n = r.items.length, sets = r.items.reduce(function (s, it) { return s + (+it.sets || 0); }, 0), cmin = r.items.reduce(function (s, it) { return s + (String(it.x).indexOf("cardio:") === 0 ? (+it.min || 0) : 0); }, 0);
    return '<div class="row rt"><span class="ricon">' + A.ICON.dumbbell + '</span><div class="t"><b>' + esc(r.name) + "</b><small>" + n + " exercise" + (n === 1 ? "" : "s") + " · " + sets + " sets" + (cmin ? " · " + cmin + " min cardio" : "") + (days ? " · " + days : "") + "</small></div>"
      + (big ? "" : '<button class="btn ghost sm" data-tact="edit" data-id="' + r.id + '">Edit</button>')
      + '<button class="btn pri sm" data-tact="start" data-id="' + r.id + '">Start</button></div>';
  }
  function weekCard(u) {
    var w = weekStats(u.id);
    var h = '<div class="card">' + A.head("cal", "This week", "since Monday", "week") + '<div class="stats"><div class="stat"><span>Workouts</span><b>' + w.sessions + '</b></div><div class="stat"><span>Sets</span><b>' + w.sets + '</b></div><div class="stat"><span>Volume</span><b>' + (w.vol >= 10000 ? r1(w.vol / 1000) + "t" : fmt(w.vol) + " kg") + "</b></div></div>" + (w.cmin ? '<div class="cmin">' + TI.run + "<b>" + fmt(w.cmin) + " min</b> cardio this week</div>" : "");
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
      if (p.tsd && p.tsd >= cut && p.tsnew) out.push({ d: p.tsd, t: n + ": " + p.ts + " s", k: "Longest hold" });
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
      var x = '<div class="row hist" data-tact="hist" data-id="' + l.id + '" role="button"><span class="ricon">' + ((l.pbs || []).length ? TI.trophy : l.exs.every(function (e) { return e.cardio; }) ? TI.run : A.ICON.dumbbell) + '</span><div class="t"><b>' + esc(l.name) + "</b><small>" + esc(A.dayLabel(o.d)) + " · " + fmt(l.min) + " min" + (l.amin != null && sets ? " (" + fmt(l.amin) + " active)" : "") + " · " + (sets ? sets + " set" + (sets === 1 ? "" : "s") : "cardio") + ((l.pbs || []).length ? " · " + l.pbs.length + " PB" + (l.pbs.length > 1 ? "s" : "") : "") + '</small></div><span class="k">' + fmt(l.kcal) + "</span></div>";
      if (open) x += '<div class="hdet">' + l.exs.map(function (e) { return "<div><b>" + esc(shortName(e.n || exInfo(e.x).n)) + "</b> " + (e.cardio ? fmt(e.cardio.min) + " min · " + esc(e.cardio.note || "") + " · " + fmt(e.cardio.kcal) + " cal" : e.sets.map(function (s) { return e.t ? setTxt(s[0], s[1], true) : (+s[0] ? kgs(s[0]) + "×" : "") + s[1]; }).join(", ")) + "</div>"; }).join("")
        + '<button class="btn danger sm hdel" data-tact="histdel" data-id="' + l.id + '" data-d="' + o.d + '">' + A.ICON.trash + "Delete workout</button></div>";
      return x;
    }).join("") + "</div>";
    return h + A.tip("hist", "Tap a workout to see its sets or delete it. Deleting also removes its calories and puts back any PBs it set.") + "</div>";
  }

  /* ---------- Log activity: cardio with intervals, describe it, or a watch figure ---------- */
  function newPart(type, eff) { return { type: type || "treadmill", min: "", km: "", kmh: "", inc: "", eff: eff || "normal" }; }
  function soloCalc() {
    var c = T.cardio, calc = 0, min = 0;
    c.parts.forEach(function (p) { if (num(p.min)) { calc += cardioKcal(p.type, p); min += num(p.min); } });
    return { calc: calc, min: min, total: num(c.watch) ? Math.round(num(c.watch)) : calc };
  }
  function cardioView(u) {
    var m = T.logMode || "cardio", c = T.cardio;
    var h = '<div class="card">' + A.head("flame", "Log activity", A.dayLabel(A.S.date))
      + '<div class="seg logseg">' + [["cardio", "Cardio"], ["describe", "Describe it"], ["watch", "Watch"]].map(function (x) { return '<button class="' + (m === x[0] ? "on" : "") + '" data-tact="lmode" data-v="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>";
    if (m !== "cardio") return h + A.exLogHtml(m) + '<button class="btn ghost wide" style="margin-top:8px" data-tact="cancel">Cancel</button></div>';
    h += c.parts.map(function (p, i) {
      return '<div class="ivl"><div class="ivh"><b>' + (c.parts.length > 1 ? "Interval " + (i + 1) : "Machine") + "</b>" + (c.parts.length > 1 ? '<button class="x" data-tact="ivdel" data-i="' + i + '" aria-label="Remove interval">×</button>' : "") + "</div>"
        + '<select id="sct_' + i + '" data-ct="' + i + '" aria-label="Machine or activity">' + CORDER.map(function (k) { return '<option value="' + k + '"' + (k === p.type ? " selected" : "") + ">" + esc(CARDIO[k].n) + "</option>"; }).join("") + "</select>"
        + '<div class="cfbox">' + cardioFields(p.type, p, "sc" + i + "_", true) + "</div></div>";
    }).join("");
    var t = soloCalc();
    h += '<button class="btn wide" data-tact="ivadd">' + A.ICON.plus + "Add an interval</button>"
      + '<div class="cfout tot"><b id="scTot">' + fmt(t.total) + '</b><span>cal total</span><small id="scTotN">' + fmt(t.min) + " min" + (c.parts.length > 1 ? " over " + c.parts.length + " intervals" : "") + (num(c.watch) ? " · watch figure" : "") + "</small></div>"
      + '<label class="f">Watch calories for the whole session (optional)<input id="scwatch" data-cw="1" inputmode="numeric" value="' + esc(c.watch || "") + '"></label>'
      + A.tip("ivl", "Doing more than one thing? Add an interval for each part, like 10 min on the bike then 20 min on the treadmill. Each part is worked out on its own and added up.")
      + '<div class="btns"><button class="btn pri" style="flex:1" data-tact="csave">' + TI.check + 'Save</button><button class="btn ghost" data-tact="cancel">Cancel</button></div></div>';
    return h;
  }
  function saveCardio() {
    var c = T.cardio, parts = c.parts.filter(function (p) { return num(p.min); });
    if (!parts.length) return A.toast("Add the minutes");
    var t = soloCalc(), scale = num(c.watch) && t.calc ? num(c.watch) / t.calc : 1, kc = t.total, min = t.min;
    var date = A.S.date || A.today(), id = uid(), names = [];
    var exs = parts.map(function (p) {
      var r = cardioMET(p.type, p), k = Math.round(cardioKcal(p.type, p) * scale), n = CARDIO[p.type].n;
      if (names.indexOf(n) < 0) names.push(n);
      return { x: "cardio:" + p.type, n: n, cardio: { min: num(p.min), km: num(p.km), kmh: num(p.kmh), inc: num(p.inc), eff: p.eff, met: r.met, note: r.note, kcal: k }, sets: [] };
    });
    var name = names.join(" + "), end = date === A.today() ? Date.now() : new Date(date + "T12:00:00").getTime();
    var note = Math.round(min) + " min · " + (parts.length > 1 ? parts.length + " intervals" : cardioMET(parts[0].type, parts[0]).note) + (num(c.watch) ? " · watch figure" : "");
    var lift = { id: id, name: name, start: end - min * 60000, end: end, min: Math.round(min), effort: parts[0].eff, kcal: kc, exs: exs, pbs: [] };
    A.changeMe(function (uu) { addStats(uu, lift, 1); });
    A.changeDay(date, function (d) { d.lifts = (d.lifts || []).concat([lift]); d.ex.push({ id: uid(), name: name, kcal: kc, min: Math.round(min), note: note, src: "cardio", lift: id }); });
    T.view = "home"; T.cardio = null; T.logMode = null; render(); if (A.checkBadges) A.checkBadges(); A.celebrate(); A.toast(name + " saved. " + fmt(kc) + " cal added.");
  }

  /* ---------- Recommend a workout (free, no Claude) ----------
   * Picks the freshest muscle groups from the recovery model, fits exercises and sets into the time chosen,
   * and links intensity with estimated calories (change one and the other follows, moving the time if needed).
   * Exercises come from a shortlist of well-known ones. Swapping prefers more common equipment
   * (body weight, dumbbells, bands, kettlebells, then barbell, cable, machine) and remembers what you don't have. */
  var LEVELS = [
    { n: "Casual", sets: [2, 2], rest: [150, 105], met: 3.0, eff: "light", fin: 5, fe: "light", ss: 0, cp: 1 },
    { n: "Low", sets: [3, 2], rest: [135, 90], met: 3.5, eff: "light", fin: 6, fe: "normal", ss: 0, cp: 1 },
    { n: "Medium", sets: [3, 3], rest: [120, 75], met: 5, eff: "normal", fin: 8, fe: "normal", ss: 1, cp: 2 },
    { n: "Intense", sets: [4, 3], rest: [90, 60], met: 6, eff: "hard", fin: 10, fe: "hard", ss: 2, cp: 2 },
    { n: "Brutal", sets: [4, 4], rest: [75, 45], met: 6.5, eff: "hard", fin: 0.33, fe: "hard", ss: 3, cp: 3 }
  ];
  var RTIMES = [20, 30, 45, 60, 75, 90];
  var POOL = {
    chest: { m: ["chest"], n: "chest", c: ["Barbell_Bench_Press_-_Medium_Grip", "Dumbbell_Bench_Press", "Incline_Dumbbell_Press", "Barbell_Incline_Bench_Press_-_Medium_Grip", "Machine_Bench_Press", "Leverage_Chest_Press", "Pushups", "Push-Ups_With_Feet_Elevated", "Dumbbell_Floor_Press"],
      i: ["Dumbbell_Flyes", "Cable_Crossover", "Butterfly", "Incline_Dumbbell_Flyes", "Bench_Press_-_With_Bands"] },
    back: { m: ["lats", "middle back"], n: "back", c: ["Wide-Grip_Lat_Pulldown", "Seated_Cable_Rows", "Pullups", "One-Arm_Dumbbell_Row", "Bent_Over_Barbell_Row", "Chin-Up", "Bent_Over_Two-Dumbbell_Row", "Leverage_Iso_Row", "T-Bar_Row_with_Handle", "Close-Grip_Front_Lat_Pulldown", "Inverted_Row", "One-Arm_Kettlebell_Row", "Dumbbell_Incline_Row"],
      i: ["Straight-Arm_Pulldown", "Rope_Straight-Arm_Pulldown"] },
    shoulders: { m: ["shoulders"], n: "shoulders", c: ["Dumbbell_Shoulder_Press", "Standing_Military_Press", "Seated_Dumbbell_Press", "Machine_Shoulder_Military_Press", "Arnold_Dumbbell_Press", "Alternating_Kettlebell_Press"],
      i: ["Side_Lateral_Raise", "Seated_Side_Lateral_Raise", "Lateral_Raise_-_With_Bands", "Front_Dumbbell_Raise"] },
    rear: { m: ["shoulders"], n: "rear shoulders", c: [], i: ["Face_Pull", "Reverse_Flyes", "Band_Pull_Apart", "Back_Flyes_-_With_Bands"] },
    biceps: { m: ["biceps"], n: "biceps", c: [], i: ["Barbell_Curl", "Dumbbell_Bicep_Curl", "Hammer_Curls", "EZ-Bar_Curl", "Incline_Dumbbell_Curl", "Standing_Biceps_Cable_Curl", "Concentration_Curls", "Cable_Hammer_Curls_-_Rope_Attachment"] },
    triceps: { m: ["triceps"], n: "triceps", c: ["Dips_-_Triceps_Version", "Close-Grip_Barbell_Bench_Press", "Bench_Dips", "Push-Ups_-_Close_Triceps_Position"],
      i: ["Triceps_Pushdown", "Triceps_Pushdown_-_Rope_Attachment", "Cable_Rope_Overhead_Triceps_Extension", "Lying_Triceps_Press", "Standing_Dumbbell_Triceps_Extension", "Tricep_Dumbbell_Kickback"] },
    quads: { m: ["quadriceps"], n: "quads", c: ["Barbell_Squat", "Leg_Press", "Goblet_Squat", "Hack_Squat", "Dumbbell_Lunges", "Smith_Machine_Squat", "Split_Squat_with_Dumbbells", "Dumbbell_Step_Ups", "Dumbbell_Squat", "Bodyweight_Squat"],
      i: ["Leg_Extensions", "Bodyweight_Walking_Lunge"] },
    hams: { m: ["hamstrings"], n: "hamstrings", c: ["Romanian_Deadlift", "Stiff-Legged_Dumbbell_Deadlift", "Barbell_Deadlift", "One-Arm_Kettlebell_Swings", "Kettlebell_One-Legged_Deadlift"],
      i: ["Lying_Leg_Curls", "Seated_Leg_Curl", "Standing_Leg_Curl", "Ball_Leg_Curl"] },
    glutes: { m: ["glutes"], n: "glutes", c: ["Barbell_Hip_Thrust", "Barbell_Glute_Bridge", "Pull_Through"], i: ["Single_Leg_Glute_Bridge", "Glute_Kickback", "Hip_Lift_with_Band"] },
    calves: { m: ["calves"], n: "calves", c: [], i: ["Standing_Calf_Raises", "Seated_Calf_Raise", "Calf_Raise_On_A_Dumbbell", "Smith_Machine_Calf_Raise", "Calf_Press_On_The_Leg_Press_Machine"] },
    abs: { m: ["abdominals"], n: "abs", c: [], i: ["Cable_Crunch", "Hanging_Leg_Raise", "Plank", "Crunches", "Reverse_Crunch", "Russian_Twist", "Ab_Roller"] }
  };
  var TPL = [
    { n: "Push", lbl: "chest, shoulders and triceps", g: ["chest", "shoulders", "triceps"], s: ["chest.c", "shoulders.c", "chest.c", "shoulders.i", "triceps.i", "chest.i", "triceps.i", "shoulders.i"] },
    { n: "Pull", lbl: "back and biceps", g: ["back", "biceps"], s: ["back.c", "back.c", "back.c", "biceps.i", "rear.i", "biceps.i", "back.i", "biceps.i"] },
    { n: "Legs", lbl: "quads, hamstrings and glutes", g: ["quads", "hams", "glutes"], s: ["quads.c", "hams.c", "quads.c", "glutes.c", "hams.i", "quads.i", "calves.i", "glutes.i"] },
    { n: "Upper body", lbl: "chest, back, shoulders and arms", g: ["chest", "back", "shoulders"], s: ["chest.c", "back.c", "shoulders.c", "back.c", "biceps.i", "triceps.i", "shoulders.i", "chest.i"] },
    { n: "Full body", lbl: "legs, chest and back", g: ["quads", "chest", "back", "hams"], s: ["quads.c", "chest.c", "back.c", "hams.c", "shoulders.c", "biceps.i", "triceps.i", "glutes.c"], pen: 0.1 }
  ];
  var PUMPS = [
    { n: "Arm pump", lbl: "biceps and triceps", g: ["biceps", "triceps"], s: ["biceps.i", "triceps.i", "biceps.i", "triceps.i", "biceps.i", "triceps.i", "biceps.i", "triceps.i"] },
    { n: "Shoulder and arm pump", lbl: "shoulders and arms", g: ["shoulders", "biceps", "triceps"], s: ["shoulders.i", "rear.i", "biceps.i", "triceps.i", "biceps.i", "triceps.i", "shoulders.i", "rear.i"] },
    { n: "Chest and back pump", lbl: "chest and back", g: ["chest", "back"], s: ["chest.c", "back.c", "chest.i", "back.c", "chest.i", "back.i", "chest.c", "back.c"] },
    { n: "Leg pump", lbl: "quads and hamstrings", g: ["quads", "hams"], s: ["quads.i", "hams.i", "quads.c", "hams.c", "calves.i", "glutes.i", "quads.c", "hams.i"] }
  ];
  // Muscles you can choose yourself (overrides recovery)
  var MCHOICE = [["chest", "Chest", ["chest"]], ["back", "Back", ["back", "rear"]], ["shoulders", "Shoulders", ["shoulders", "rear"]], ["biceps", "Biceps", ["biceps"]], ["triceps", "Triceps", ["triceps"]],
    ["legs", "Legs", ["quads", "hams", "glutes", "calves"]], ["glutes", "Glutes", ["glutes"]], ["abs", "Abs", ["abs"]]];
  function customTpl(mus) {
    var picks = MCHOICE.filter(function (c) { return mus.indexOf(c[0]) >= 0; }), groups = [], seen = {};
    picks.forEach(function (c) { c[2].forEach(function (g) { if (!seen[g] && !(g === "rear" && mus.length > 1 && mus.indexOf("back") < 0 && mus.indexOf("shoulders") < 0)) { seen[g] = 1; groups.push(g); } }); });
    var slots = [], pass = ["c", "i", "c", "i", "i"];
    pass.forEach(function (r) { groups.forEach(function (g) { var role = POOL[g][r].length ? r : "i"; if (slots.length < 8 && POOL[g][role].length) slots.push(g + "." + role); }); });
    var names = picks.map(function (c) { return c[1].toLowerCase(); }), lbl = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
    return { n: lbl.charAt(0).toUpperCase() + lbl.slice(1), lbl: "your choice", g: groups.filter(function (g) { return g !== "rear" && g !== "calves"; }), s: slots, custom: 1 };
  }
  var EQRANK = { "body only": 0, "": 0, dumbbell: 1, bands: 2, kettlebells: 3, barbell: 4, "e-z curl bar": 4, cable: 5, machine: 6, other: 6 };
  var CMACH = ["treadmill", "bike", "row", "elliptical", "stairs", "walk", "run", "swim"];
  function eqRank(id) { var r = EQRANK[exInfo(id).e]; return r == null ? 6 : r; }
  function noEquip(u) { return ((u && u.priv) || {}).noEquip || []; }
  function addNoEquip(id) { A.changeMe(function (uu) { uu.priv = uu.priv || {}; var l = uu.priv.noEquip = (uu.priv.noEquip || []).filter(function (x) { return x !== id; }); l.push(id); if (l.length > 80) l.shift(); }); }
  function groupF(rec, g) { var f = 0, tr = false; POOL[g].m.forEach(function (m) { var r = rec[M.indexOf(m)]; if (r) { if (r.f > f) f = r.f; if (r.trained) tr = true; } }); return { f: f, tr: tr }; }
  function groupLeft(rec, g) { var l = 0; POOL[g].m.forEach(function (m) { var r = rec[M.indexOf(m)]; if (r && r.left > l) l = r.left; }); return l; }
  function pickTpl(list, rec, force) {
    var best = null;
    list.forEach(function (t) {
      var fs = t.g.map(function (g) { return groupF(rec, g); }), worst = Math.max.apply(null, fs.map(function (x) { return x.f; }));
      if (worst > 0.5 && !force) return;
      var sc = fs.reduce(function (s, x) { return s + (1 - x.f) + (x.tr ? 0 : 0.25); }, 0) / fs.length - (t.pen || 0) - (force ? worst : 0);
      if (!best || sc > best.sc) best = { t: t, sc: sc };
    });
    return best && best.t;
  }
  function pickEx(u, slot, used) {
    var p = slot.split("."), list = POOL[p[0]][p[1]], ne = noEquip(u);
    var c = list.filter(function (id) { return EXMAP[id] && !used[id] && ne.indexOf(id) < 0; });
    c.sort(function (a, b) { return (lastFor(u, b).length ? 1 : 0) - (lastFor(u, a).length ? 1 : 0) || list.indexOf(a) - list.indexOf(b); });
    return c[0] || null;
  }
  function round5(n) { return Math.max(5, Math.round(n / 5) * 5); }
  function cardioPiece(type, min, lvl) {
    var kmh = [5, 5.5, 6, 6.5, 9][lvl], inc = [3, 5, 8, 10, 3][lvl];
    return { x: "cardio:" + type, min: min, eff: LEVELS[lvl].fe, kmh: type === "treadmill" ? String(kmh) : "", inc: type === "treadmill" ? String(inc) : "" };
  }
  function cardioTypes(u, legsSore) {
    var ne = noEquip(u), order = legsSore ? ["bike", "elliptical", "row", "walk", "treadmill"] : ["treadmill", "row", "bike", "stairs", "elliptical", "run"];
    var ok = order.filter(function (t) { return ne.indexOf("cardio:" + t) < 0; });
    return ok.length ? ok : ["other"];
  }
  function cardioSplit(u, min, lvl, pieces, legsSore) {
    var types = cardioTypes(u, legsSore), out = [], n = Math.max(1, Math.min(pieces, Math.floor(min / 5), types.length)), left = min;
    for (var i = 0; i < n; i++) { var m = i === n - 1 ? left : Math.round(min / n); left -= m; out.push(cardioPiece(types[i], m, lvl)); }
    return out;
  }
  function buildPlan(u, st) {
    var L = LEVELS[st.lvl], rec = recovery(u.id), pump = st.pump;
    var legsSore = Math.max(groupF(rec, "quads").f, groupF(rec, "hams").f) > 0.3;
    var custom = st.mus && st.mus.length ? customTpl(st.mus) : null;
    var tpl = custom || pickTpl(pump ? PUMPS : TPL, rec, st.force), forceG = st.force || !!custom;
    var fresh = [], sore = [];
    ["chest", "back", "shoulders", "biceps", "triceps", "quads", "hams", "glutes"].forEach(function (g) { var x = groupF(rec, g); if (x.f > 0.3) sore.push([g, groupLeft(rec, g)]); else fresh.push(g); });
    sore.sort(function (a, b) { return b[1] - a[1]; });
    var why = (fresh.length ? "Fresh: " + fresh.map(function (g) { return POOL[g].n; }).join(", ") + ". " : "") + (sore.length ? "Still recovering: " + sore.map(function (s) { return POOL[s[0]].n + " (" + hoursText(s[1]) + ")"; }).join(", ") + "." : "");
    if (!tpl) {
      return { kind: "cardio", name: "Cardio", lbl: legsSore ? "easy on the legs" : "intervals", why: why, items: cardioSplit(u, st.min, st.lvl, [1, 1, 2, 2, 3][st.lvl], legsSore), lvl: st.lvl, min: st.min };
    }
    var finMin = st.fin === false ? 0 : st.lvl === 4 ? Math.min(Math.round(st.min * 0.45), Math.max(10, round5(st.min * L.fin))) : Math.min(Math.round(st.min * 0.4), L.fin);
    var budget = (st.min - finMin) * 60 - 180, spent = 0, items = [], used = {};
    var restP = Math.max(30, Math.round(L.rest[1] * 0.6 / 5) * 5);
    var add = function (slot, k, force) {
      var g = slot.split(".")[0]; if (groupF(rec, g).f > 0.5 && !forceG) return false;
      var id = pickEx(u, slot, used); if (!id) return false;
      var comp = slot.split(".")[1] === "c", timed = isTimedEx(id);
      var full = pump ? L.sets[1] : L.sets[comp ? 0 : 1], rest = timed ? 60 : pump ? restP : L.rest[comp ? 0 : 1];
      var paired = pump || (L.ss >= 2 && !comp) || (L.ss === 3 && items.length > 0), one = 45 + (paired ? rest / 2 + 15 : rest);
      var sets = full; while (sets > 2 && spent + sets * one > budget) sets--; // fewer sets before fewer exercises
      if (spent + sets * one > budget && !force) return false;
      used[id] = 1; spent += sets * one;
      var rg = timed ? [20, 45] : pump ? [12, 20] : st.lvl <= 1 ? (comp ? [8, 12] : [12, 15]) : (comp ? [6, 10] : [10, 15]);
      items.push({ x: id, sets: sets, full: full, g: "", rest: rest, rg: rg, c: comp ? 1 : 0, one: one, k: k });
      return true;
    };
    // Every muscle group in the session gets one exercise first, then the rest of the slots in order
    var order = [], seen = {};
    tpl.s.forEach(function (sl, k) { var g = sl.split(".")[0]; if (!seen[g]) { seen[g] = 1; order.push(k); } });
    tpl.s.forEach(function (sl, k) { if (order.indexOf(k) < 0) order.push(k); });
    order.forEach(function (k) { add(tpl.s[k], k, items.length < 2); });
    if (budget - spent > 240 && !pump && !custom) add("abs.i", 99, false);
    if (custom) { var sorec = custom.g.filter(function (g) { return groupF(rec, g).f > 0.3; }); if (sorec.length) why = "Heads up, still recovering: " + sorec.map(function (g) { return POOL[g].n + " (" + hoursText(groupLeft(rec, g)) + ")"; }).join(", ") + ". Go lighter on those if they feel sore."; else why = "All the muscles you picked are fresh."; }
    items.sort(function (a, b) { return a.k - b.k; });
    var grow = true; // spare time: add sets, big lifts first
    while (grow) {
      grow = false;
      items.slice().sort(function (a, b) { return b.c - a.c; }).forEach(function (it) {
        if (it.sets < Math.min(5, it.full + 1) && budget - spent > it.one) { it.sets++; spent += it.one; grow = true; }
      });
    }
    // Supersets: pump pairs everything; Medium pairs the last two isolation moves; Intense pairs isolation; Brutal pairs all after the first
    var elig = items.map(function (it, k) { return k; }).filter(function (k) { var it = items[k]; return pump || (L.ss >= 2 && !it.c) || (L.ss === 3 && k > 0) || (L.ss === 1 && !it.c); });
    if (L.ss === 1 && !pump) elig = elig.slice(-2);
    var letter = 0, partner = {};
    for (var j = 0; j + 1 < elig.length; j += 2) {
      var a = items[elig[j]], b = items[elig[j + 1]], ch = "ABCDEF"[letter++];
      a.g = b.g = ch; var r = Math.max(a.rest, b.rest); a.rest = b.rest = r;
      if (pump && st.lvl >= 3) a.drop = b.drop = 1;
      partner[elig[j]] = elig[j + 1]; partner[elig[j + 1]] = -1;
    }
    var ord = []; // keep each pair together
    items.forEach(function (it, k) { if (partner[k] === -1) return; ord.push(it); if (partner[k] != null) ord.push(items[partner[k]]); });
    items = ord;
    var out = items.map(function (it) { return { x: it.x, sets: it.sets, g: it.g, rest: it.rest, rg: it.rg, drop: it.drop || 0, c: it.c }; });
    if (finMin) out = out.concat(cardioSplit(u, finMin, st.lvl, st.lvl === 4 ? 3 : 1, tpl.n === "Legs" || legsSore).map(function (c) { c.fin = 1; return c; }));
    return { kind: "lift", name: tpl.n, lbl: tpl.lbl, why: why, items: out, lvl: st.lvl, min: st.min, pump: pump, custom: !!custom };
  }
  function planKcal(u, p) {
    var L = LEVELS[p.lvl], sec = 0, kc = 0, body = A.bodyOf(u);
    p.items.forEach(function (it) {
      if (String(it.x).indexOf("cardio:") === 0) kc += cardioKcal(cardioType(it.x), it);
      else sec += it.sets * (45 + Math.min(180, it.g ? it.rest / 2 + 15 : it.rest));
    });
    if (sec) kc += A.FC.exerciseCal(L.met, sec / 60, body);
    return Math.round(kc);
  }
  function recSolve(u, target) {
    var R = T.rec, k = function (t, l) { return planKcal(u, buildPlan(u, { min: t, lvl: l, pump: R.pump, force: R.force, fin: R.fin, mus: R.mus })); };
    var near = function (t) { var best = 0, d = 1e9; for (var l = 0; l < 5; l++) { var x = Math.abs(k(t, l) - target); if (x < d) { d = x; best = l; } } return best; };
    var times = RTIMES.slice().sort(function (a, b) { return Math.abs(a - R.min) - Math.abs(b - R.min); });
    for (var i = 0; i < times.length; i++) {
      var t = times[i], lo = k(t, 0), hi = k(t, 4);
      if (target >= lo * 0.95 && target <= hi * 1.03) return { min: t, lvl: near(t) };
    }
    return target > k(90, 4) ? { min: 90, lvl: 4, cap: k(90, 4) } : { min: 20, lvl: 0 };
  }
  function recBuild() { var u = me(), R = T.rec; R.plan = buildPlan(u, R); R.saved = null; }
  function itemTxt(it) {
    if (String(it.x).indexOf("cardio:") === 0) { var c = CARDIO[cardioType(it.x)] || CARDIO.other; return fmt(it.min) + " min · " + (it.kmh ? it.kmh + " km/h" + (+it.inc ? " · " + it.inc + "% incline" : "") : it.eff === "light" ? "easy" : it.eff === "hard" ? "hard" : "moderate") + (it.fin ? " · finisher" : ""); }
    var timed = isTimedEx(it.x);
    return it.sets + " × " + it.rg[0] + "–" + it.rg[1] + (timed ? " s" : "") + " · rest " + mmss(it.rest) + (it.drop ? " · drop set on the last" : "");
  }
  function recView(u) {
    var R = T.rec, p = R.plan, kc = planKcal(u, p);
    var h = '<div class="card rec">' + A.head("spark", "Recommend a workout", "", "rec")
      + '<div class="slab">How long</div><div class="chips rtimes">' + RTIMES.map(function (t) { return '<button class="chip' + (t === R.min ? " on" : "") + '" data-tact="rcmin" data-v="' + t + '">' + t + " min</button>"; }).join("") + "</div>"
      + '<div class="slab">Intensity</div><div class="seg seg5">' + LEVELS.map(function (L, i) { return '<button class="' + (i === R.lvl ? "on" : "") + '" data-tact="rclvl" data-v="' + i + '">' + L.n + "</button>"; }).join("") + "</div>"
      + '<div class="g2 rcrow"><label class="f">Calories (about)<input id="rcK" inputmode="numeric" value="' + kc + '"></label>'
      + '<button class="row sharerow" data-tact="rcpump" role="switch" aria-checked="' + !!R.pump + '"><div class="t"><b>Pump</b><small>' + (R.pump ? "Fewer muscles, supersets" : "Off") + '</small></div><span class="tog' + (R.pump ? " on" : "") + '"><i></i></span></button></div>'
      + '<button class="row sharerow rcmus" id="rcMus" data-tact="rcmusopen" aria-expanded="' + !!R.musOpen + '"><div class="t"><b>Muscles</b><small>' + (R.mus.length ? esc(customTpl(R.mus).n) : "Auto, by recovery") + '</small></div><span class="lnk">' + (R.musOpen ? "Done" : "Change") + "</span></button>"
      + (R.musOpen ? '<div class="chips rmchips"><button class="chip' + (R.mus.length ? "" : " on") + '" data-tact="rcmus" data-v="">Auto</button>' + MCHOICE.map(function (c) { return '<button class="chip' + (R.mus.indexOf(c[0]) >= 0 ? " on" : "") + '" data-tact="rcmus" data-v="' + c[0] + '">' + c[1] + "</button>"; }).join("") + "</div>" : "")
      + (R.note ? '<p class="hint rcnote">' + esc(R.note) + "</p>" : "")
      + A.tip("rec", "Calories and intensity are linked: change one and the other follows. Typing calories picks the closest intensity, and changes the time if it can't be reached in the time chosen. Pump uses fewer muscles, higher reps (12 to 20) and short rests, with opposite muscles paired as supersets; on Intense and Brutal the last set of each is a drop set. A guide only: it doesn't know about injuries or how you feel today.")
      + "</div>";
    h += '<div class="card rplan"><div class="hlab">' + TI.sun + (p.kind === "cardio" ? "Cardio" : LEVELS[p.lvl].n + (p.pump ? " pump" : "")) + " · " + p.min + ' min</div><div class="hname">' + esc(p.name) + '</div><div class="hmeta">' + esc(p.lbl) + " · about " + fmt(kc) + " cal</div>"
      + (p.kind === "cardio" ? '<div class="rcwarn">' + TI.body + "<div><b>Most of your muscles are still recovering</b><p>So here's a cardio session instead.</p></div></div>" : "")
      + (p.why ? '<p class="hint">' + esc(p.why) + "</p>" : "");
    h += '<div class="list rclist">' + p.items.map(function (it, i) {
      var cd = String(it.x).indexOf("cardio:") === 0, x = exInfo(it.x);
      return '<div class="rcx"><div class="row"><span class="ricon">' + (cd ? TI.run : it.g ? '<b class="sslet">' + it.g + "</b>" : TI.dumbbell) + '</span><div class="t"><b>' + esc(shortName(x.n)) + "</b><small>" + esc(itemTxt(it)) + (it.g ? " · superset " + it.g : "") + '</small></div><button class="x" data-tact="rcdel" data-i="' + i + '" aria-label="Remove">×</button></div>'
        + '<button class="lnk rswap" data-tact="rcswap" data-i="' + i + '">' + (cd ? "Don't have this machine? Swap it" : "Don't have this machine? Swap for a different exercise") + "</button></div>";
    }).join("") + "</div>";
    if (!p.items.length) h += '<p class="empty">Nothing left. Change a setting to rebuild it.</p>';
    if (p.kind === "cardio") h += '<div class="btns"><button class="btn" style="flex:1" data-tact="rcforce">' + TI.dumbbell + 'Lift anyway</button><button class="btn" style="flex:1" data-tact="rcmuspick">Choose muscles anyway</button></div>';
    h += '<button class="btn pri wide xl" data-tact="rcstart"' + (p.items.length ? "" : " disabled") + ">" + TI.dumbbell + "Start this workout</button>"
      + '<div class="g2 rcsave"><label class="f">Name<input id="rcName" value="' + esc(R.name || p.name + " · " + p.min + " min") + '"></label><div style="display:flex;align-items:flex-end"><button class="btn wide" data-tact="rcsave"' + (R.saved || !p.items.length ? " disabled" : "") + ">" + A.ICON.star + (R.saved ? "Saved" : "Save this workout") + "</button></div></div>"
      + '<button class="btn ghost wide" data-tact="cancel">Back</button></div>';
    return h;
  }
  // Another exercise for the same muscles using more common equipment
  function altFor(u, id, usedList) {
    var ne = noEquip(u), g = null, role = "c";
    Object.keys(POOL).some(function (k) { if (POOL[k].c.indexOf(id) >= 0) { g = k; role = "c"; return true; } if (POOL[k].i.indexOf(id) >= 0) { g = k; role = "i"; return true; } });
    if (!g) {
      var x = exInfo(id), m = M[x.p[0]];
      Object.keys(POOL).some(function (k) { if (k !== "rear" && POOL[k].m.indexOf(m) >= 0) { g = k; return true; } });
      role = x.c ? "c" : "i"; if (!g) return null;
    }
    var mine = eqRank(id), ok = function (c) { return EXMAP[c] && c !== id && usedList.indexOf(c) < 0 && ne.indexOf(c) < 0; };
    var same = POOL[g][role].filter(ok), other = POOL[g][role === "c" ? "i" : "c"].filter(ok);
    var pick = function (l) { var lower = l.filter(function (c) { return eqRank(c) < mine; }); lower.sort(function (a, b) { return eqRank(a) - eqRank(b); }); return lower[0] || l.filter(function (c) { return eqRank(c) <= mine; })[0] || l[0]; };
    return pick(same) || pick(other) || null;
  }
  function altCardio(u, type, usedTypes) {
    var ne = noEquip(u);
    return CMACH.filter(function (t) { return t !== type && ne.indexOf("cardio:" + t) < 0 && usedTypes.indexOf(t) < 0; })[0]
      || CMACH.filter(function (t) { return t !== type && ne.indexOf("cardio:" + t) < 0; })[0] || null;
  }
  function noEquipHtml(u) {
    var l = noEquip(u); if (!l.length) return "";
    return '<div class="card">' + A.head("dumbbell", "Equipment you don't have", String(l.length), "noeq")
      + '<div class="chips">' + l.map(function (id) { return '<button class="chip q" data-tact="noeqdel" data-x="' + esc(id) + '">' + esc(shortName(exInfo(id).n)) + " ×</button>"; }).join("") + "</div>"
      + A.tip("noeq", "Things you've swapped out. Recommended workouts and swaps avoid them. Tap one to allow it again.") + "</div>";
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
          + (String(it.x).indexOf("cardio:") === 0 ? '<div class="stp"><button data-tact="cmin" data-i="' + i + '" data-v="-5" aria-label="Less time">−</button><span>' + (it.min || 10) + ' min</span><button data-tact="cmin" data-i="' + i + '" data-v="5" aria-label="More time">+</button></div>'
            : '<div class="stp"><button data-tact="sets" data-i="' + i + '" data-v="-1" aria-label="Fewer sets">−</button><span>' + it.sets + ' sets</span><button data-tact="sets" data-i="' + i + '" data-v="1" aria-label="More sets">+</button></div>')
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
  /* ---------- Timed exercises (planks and other holds): seconds instead of reps ---------- */
  var TIMED = /\bplank\b|side bridge|isometric (chest|neck)|wall sit|dead ?hang|l-sit|hollow (hold|body)|\bhold\b|static hang/i;
  function isTimedEx(id) { var n = exInfo(id).n; return TIMED.test(n) && !/push ?up to/i.test(n); }
  function modeFor(u, id) { return ((u && u.modes) || {})[id] || (isTimedEx(id) ? "time" : "reps"); }
  function setTxt(kg, n, timed) { return (+kg ? kgs(+kg) + (timed ? " kg · " : " kg × ") : "") + n + (timed ? " s" : ""); }
  function newCardio(id, min) { return { x: id, g: "", sets: [], prev: [], rest: 0, done: false, c: { min: min ? String(min) : "", km: "", kmh: "", inc: "", eff: "normal", watch: "" } }; }
  function newEx(u, id, n, g, rest) {
    if (String(id).indexOf("cardio:") === 0) return newCardio(id, n);
    var prev = lastFor(u, id), rows = [];
    for (var i = 0; i < n; i++) rows.push({ kg: "", reps: "", done: false });
    var mode = modeFor(u, id);
    return { x: id, g: g || "", sets: rows, prev: prev, rest: rest || (mode === "time" ? 60 : defaultRest(id)), mode: mode };
  }
  function startWorkout(r) {
    var u = me();
    T.active = { id: uid(), rid: r ? r.id : "", name: r ? r.name : "Workout", start: Date.now(), date: A.today(), lastTick: 0, cur: 0, rest: null,
      exs: r ? r.items.map(function (it) { return String(it.x).indexOf("cardio:") === 0 ? newCardio(it.x, it.min) : newEx(u, it.x, it.sets, it.g, it.rest); }) : [] };
    if (r) r.items.forEach(function (it, i) {
      var e = T.active.exs[i]; if (!e) return;
      if (it.rg) e.rg = it.rg; if (it.drop) e.drop = 1;
      if (e.c && it.eff) { e.c.eff = it.eff; e.c.kmh = it.kmh || ""; e.c.inc = it.inc || ""; }
    });
    T.overview = !T.active.exs.length;
    saveActive(); T.view = "home"; wake(true); render();
    var p = $("#pTrain"); if (p) p.scrollTop = 0;
  }
  function clock(ms) { var s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60; return (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + ss).slice(-2); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ":" + ("0" + sec % 60).slice(-2); }
  function doneCount(e) { return isCardio(e) ? (e.done ? 1 : 0) : e.sets.filter(function (s) { return s.done; }).length; }
  function setCount(e) { return isCardio(e) ? 1 : e.sets.length; }
  function nextSet(e) { if (isCardio(e)) return e.done ? -1 : 0; for (var j = 0; j < e.sets.length; j++) if (!e.sets[j].done) return j; return -1; }
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
    w.exs.forEach(function (e) { total += setCount(e); done += doneCount(e); });
    var h = '<div class="card livehd"><div class="wkh"><div><input id="wkName" class="wkname" value="' + esc(w.name) + '" aria-label="Workout name"><small>' + TI.clock + '<span id="tTimer">' + clock(Date.now() - w.start) + "</span> · " + done + "/" + total + " sets</small></div>"
      + '<button class="icb' + (T.overview ? " on" : "") + '" data-tact="overview" aria-label="All exercises">' + TI.list + '</button><button class="btn pri" data-tact="finish">Finish</button></div>'
      + restBar()
      + '<div class="prog">' + w.exs.map(function (e, k) { var dc = doneCount(e); return '<button data-tact="goto" data-k="' + k + '" class="' + (k === w.cur && !T.overview ? "cur " : "") + (dc === setCount(e) ? "full" : dc ? "part" : "") + '" aria-label="Exercise ' + (k + 1) + '"></button>'; }).join("") + "</div></div>";
    if (T.overview || !w.exs.length) return h + overviewView(u);
    return h + liveExercise(u, w.cur);
  }
  var RC = 2 * Math.PI * 15;
  function restBar() {
    var r = T.active.rest; if (!r) return "";
    var left = Math.max(0, (r.until - Date.now()) / 1000), pct = Math.min(1, left / r.dur);
    return '<div class="restbar"><svg viewBox="0 0 36 36" class="rring"><circle cx="18" cy="18" r="15" class="bg"/><circle id="rArc" cx="18" cy="18" r="15" class="fg" stroke-dasharray="' + RC.toFixed(1) + '" stroke-dashoffset="' + (RC * (1 - pct)).toFixed(1) + '"/></svg>'
      + '<div class="rmid"><span class="rl">Rest</span><b id="rLeft">' + mmss(left) + "</b></div>"
      + '<div class="rbtn"><button class="btn sm" data-tact="rest" data-v="-15">−15</button><button class="btn sm" data-tact="rest" data-v="15">+15</button><button class="btn sm pri" data-tact="restskip">Skip</button></div></div>';
  }
  function musChips(x) { return x.p.map(function (m) { return '<span class="mchip">' + esc(LABEL[M[m]]) + "</span>"; }).join("") + x.s.slice(0, 2).map(function (m) { return '<span class="mchip s">' + esc(LABEL[M[m]]) + "</span>"; }).join(""); }
  function cardioFields(type, c, prefix, part) {
    var T0 = CARDIO[type] || CARDIO.other, f = T0.f, inp = function (id, lbl, v, mode) { return '<label class="f">' + lbl + '<input id="' + prefix + id + '" data-cf="' + id + '" inputmode="' + (mode || "decimal") + '" value="' + esc(v || "") + '"></label>'; };
    var h = '<div class="g3 cf">' + inp("min", "Minutes", c.min, "numeric")
      + (f.indexOf("kmh") >= 0 ? inp("kmh", "Speed km/h", c.kmh) : "") + (f.indexOf("inc") >= 0 ? inp("inc", "Incline %", c.inc) : "")
      + (f.indexOf("km") >= 0 ? inp("km", "Distance km", c.km) : "") + "</div>";
    if (type !== "treadmill") h += '<div class="seg cfeff">' + ["light", "normal", "hard"].map(function (k) { return '<button class="' + ((c.eff || "normal") === k ? "on" : "") + '" data-tact="ceff" data-v="' + k + '" data-p="' + prefix + '">' + (k === "light" ? "Easy" : k === "normal" ? "Moderate" : "Hard") + "</button>"; }).join("") + "</div>";
    var r = cardioMET(type, c), kc = cardioKcal(type, c);
    h += '<div class="cfout' + (part ? " sm" : "") + '"><b id="' + prefix + 'kc">' + fmt(kc) + '</b><span>cal' + (num(c.watch) ? " (watch)" : "") + '</span><small id="' + prefix + 'note">MET ' + r.met + " · " + esc(r.note) + "</small></div>";
    if (!part) h += '<label class="f">Watch calories (optional)<input id="' + prefix + 'watch" data-cf="watch" inputmode="numeric" value="' + esc(c.watch || "") + '"></label>';
    return h;
  }
  function cardioLive(u, k) {
    var w = T.active, e = w.exs[k], type = cardioType(e.x), T0 = CARDIO[type] || CARDIO.other;
    var h = '<div class="card live"><div class="lnav"><button class="icb" data-tact="goto" data-k="' + (k - 1) + '"' + (k ? "" : " disabled") + ' aria-label="Previous">' + TI.left + "</button><span>Exercise " + (k + 1) + " of " + w.exs.length + " · Cardio</span>"
      + '<button class="icb" data-tact="goto" data-k="' + (k + 1) + '"' + (k < w.exs.length - 1 ? "" : " disabled") + ' aria-label="Next">' + TI.right + "</button></div>"
      + '<div class="cardhero">' + TI.run + '</div><h3 class="lname">' + esc(T0.n) + "</h3>" + noteBox(u, e.x)
      + (e.done ? "" : '<select id="lct" data-lct="' + k + '" aria-label="Machine or activity">' + CORDER.map(function (c) { return '<option value="' + c + '"' + (c === type ? " selected" : "") + ">" + esc(CARDIO[c].n) + "</option>"; }).join("") + "</select>");
    if (e.done) {
      var nx = firstOpen(k + 1);
      h += '<div class="exdone">' + TI.check + esc(fmt(num(e.c.min))) + " min · " + fmt(cardioKcal(type, e.c)) + ' cal</div><div class="btns"><button class="btn ghost" style="flex:1" data-tact="cundo" data-k="' + k + '">Edit</button><button class="btn" style="flex:1" data-tact="civl" data-k="' + k + '">' + A.ICON.plus + "Add an interval</button></div>"
        + (nx >= 0 ? '<button class="btn pri wide xl" style="margin-top:10px" data-tact="goto" data-k="' + nx + '">Next: ' + esc(shortName(exInfo(w.exs[nx].x).n)) + " " + TI.right + "</button>" : '<button class="btn pri wide xl" style="margin-top:10px" data-tact="finish">Finish workout</button>');
      return h + "</div>";
    }
    return h + '<div class="cfbox" data-k="' + k + '">' + cardioFields(type, e.c, "lc_") + '</div><button class="btn pri wide xl" data-tact="clog" data-k="' + k + '">' + TI.check + "Log cardio</button></div>";
  }

  /* ---------- Notes to self (kept in the private part of the profile, so only you see them) ---------- */
  function noteOf(u, id) { return ((u.priv || {}).notes || {})[id] || ""; }
  function noteBox(u, id) {
    var n = noteOf(u, id);
    if (T.noteEdit === id) return '<div class="exnote edit"><textarea id="exNote" maxlength="300" placeholder="e.g. Seat on 4, grip just outside the rings, pause at the bottom">' + esc(T.noteDraft != null ? T.noteDraft : n) + '</textarea><div class="btns"><button class="btn pri sm" data-tact="notesave" data-x="' + esc(id) + '">Save note</button><button class="btn ghost sm" data-tact="notecancel">Cancel</button>' + (n ? '<button class="btn ghost sm" data-tact="notedel" data-x="' + esc(id) + '">Delete</button>' : "") + "</div></div>";
    if (n) return '<button class="exnote" data-tact="noteedit" data-x="' + esc(id) + '"><span class="nic">' + TI.note + '</span><span class="ntx">' + esc(n) + '</span><span class="ned">Edit</span></button>';
    return '<button class="exnote add" data-tact="noteedit" data-x="' + esc(id) + '">' + TI.note + "Add a note</button>";
  }
  function saveNote(id, text) {
    text = String(text || "").trim().slice(0, 300);
    A.changeMe(function (uu) { uu.priv = uu.priv || {}; uu.priv.notes = uu.priv.notes || {}; if (text) uu.priv.notes[id] = text; else delete uu.priv.notes[id]; });
    T.noteEdit = null; T.noteDraft = null; render(); A.toast(text ? "Note saved. You'll see it next time." : "Note deleted");
  }

  /* ---------- Weight suggestions ----------
   * Rep targets: compound lifts 6-10, isolation 10-15 (muscle grows across roughly 6-30 reps when sets are taken
   * close to failure, Schoenfeld et al. 2021). Double progression: add reps at the same weight until the top of the
   * range is beaten by a rep or more, then raise the load 2-10% (ACSM 2009 progression models). The new weight is
   * worked out with the Epley formula (1RM = kg x (1 + reps/30)) for a rep target near the bottom of the range,
   * capped at +10% and rounded to the nearest plate/dumbbell step. */
  function repRange(x) { return x.c ? [6, 10] : [10, 15]; }
  function stepFor(x) { return x.e === "dumbbell" ? 2 : x.e === "kettlebells" ? 4 : 2.5; }
  function roundTo(v, st) { return Math.round(v / st) * st; }
  function loadFor(e1, reps) { return e1 / (1 + reps / 30); }
  function suggestion(u, e) {
    if (isCardio(e)) return null;
    if (e.mode === "time") {
      var dn = e.sets.filter(function (s) { return s.done; });
      if (dn.length) return null;
      var pv = e.prev || []; if (!pv.length) return { txt: "Hold with good form and stop just before it breaks down. 20 to 60 seconds is a useful range.", range: [20, 60] };
      var best = pv.reduce(function (a, b) { return b[1] > a[1] ? b : a; }, pv[0]);
      if (best[1] >= 60) return { txt: "Last time: " + setTxt(best[0], best[1], true) + ". Over a minute: add weight or a harder version rather than going longer.", range: [20, 60], up: true };
      return { txt: "Last time: " + setTxt(best[0], best[1], true) + ". Aim for " + (best[1] + 5) + " s this time.", range: [20, 60], kg: +best[0] || "", reps: best[1] + 5 };
    }
    var x = exInfo(e.x), rg = e.rg || repRange(x), st = stepFor(x), done = e.sets.filter(function (s) { return s.done; });
    var sets = done.length ? done.map(function (s) { return [num(s.kg), Math.round(num(s.reps))]; }) : (e.prev || []);
    if (!sets.length) return { txt: "First time: pick a weight you can lift " + rg[0] + "–" + rg[1] + " times, stopping 1–2 reps short of failure.", range: rg };
    var live = done.length > 0, ref = live ? sets[sets.length - 1] : sets.reduce(function (a, b) { return e1rm(b[0], b[1]) > e1rm(a[0], a[1]) ? b : a; }, sets[0]);
    var kg = ref[0], reps = ref[1], from = (live ? "That set: " : "Last time: ") + (kg ? kgs(kg) + " kg × " : "") + reps + ".";
    if (!kg) { // bodyweight
      if (reps > rg[1] + 5) return { txt: from + " Plenty of reps. Add weight (belt or vest) or slow the lowering to stay near " + rg[1] + ".", range: rg };
      return live ? null : { txt: from + " Aim for " + (reps + 1) + "+ reps this time.", range: rg, reps: reps + 1 };
    }
    var e1 = kg * (1 + Math.min(reps, 30) / 30);
    if (reps >= rg[1] + (live ? 3 : 1)) {
      var tgt = rg[0] + 2, up = Math.min(loadFor(e1, tgt), kg * (live ? 1.15 : 1.10));
      var nk = Math.max(roundTo(up, st), kg + st);
      return { txt: from + " Above your " + rg[0] + "–" + rg[1] + " range, so go heavier: try " + kgs(nk) + " kg for " + tgt + "–" + (tgt + 2) + " reps.", kg: nk, reps: tgt, range: rg, up: true };
    }
    if (reps < rg[0] - (live ? 1 : 0)) {
      var tg2 = rg[0] + 1, dn = Math.min(roundTo(loadFor(e1, tg2), st), kg - st);
      if (dn <= 0) return null;
      return { txt: from + " Below " + rg[0] + " reps, so it's too heavy for growth work: try " + kgs(dn) + " kg for " + tg2 + "+ reps.", kg: dn, reps: tg2, range: rg, down: true };
    }
    if (live) return null;
    return { txt: from + " In range. Stay at " + kgs(kg) + " kg and aim for " + Math.min(reps + 1, rg[1] + 1) + "+ reps. Go up once you hit " + (rg[1] + 1) + ".", kg: kg, reps: Math.min(reps + 1, rg[1] + 1), range: rg };
  }
  function tipBox(u, e, j) {
    var sg = suggestion(u, e); if (!sg || j < 0) return "";
    return '<div class="sugg' + (sg.up ? " up" : sg.down ? " down" : "") + '"><span class="sic">' + (sg.up ? TI.up : sg.down ? TI.down : TI.target) + '</span><div><b>' + (sg.up ? "Go heavier" : sg.down ? "Go lighter" : sg.kg ? "Beat last time" : "Target " + sg.range[0] + "–" + sg.range[1] + " reps") + "</b><p>" + esc(sg.txt) + "</p></div>"
      + (sg.kg || sg.reps ? '<button class="btn sm" data-tact="usesugg" data-kg="' + (sg.kg || "") + '" data-r="' + (sg.reps || "") + '">Use</button>' : "") + "</div>";
  }

  function liveExercise(u, k) {
    if (isCardio(T.active.exs[k])) return cardioLive(u, k);
    var w = T.active, e = w.exs[k], x = exInfo(e.x), pb = (u.pb || {})[e.x], j = nextSet(e), grp = groupOf(k);
    var h = '<div class="card live"><div class="lnav"><button class="icb" data-tact="goto" data-k="' + (k - 1) + '"' + (k ? "" : " disabled") + ' aria-label="Previous exercise">' + TI.left + '</button>'
      + '<span>Exercise ' + (k + 1) + " of " + w.exs.length + (grp.length > 1 ? ' · <b class="sspill">Superset ' + esc(e.g) + "</b>" : "") + "</span>"
      + '<button class="icb" data-tact="goto" data-k="' + (k + 1) + '"' + (k < w.exs.length - 1 ? "" : " disabled") + ' aria-label="Next exercise">' + TI.right + "</button></div>"
      + demo(e.x) + '<h3 class="lname">' + esc(shortName(x.n)) + '</h3><div class="mchips">' + musChips(x) + "</div>"
      + (e.mode === "time" ? (pb && pb.ts ? '<div class="lpb">' + TI.trophy + "PB " + pb.ts + " s hold</div>" : "") : pb && pb.w ? '<div class="lpb">' + TI.trophy + "PB " + kgs(pb.w) + " kg × " + pb.wr + (pb.e1 ? '<span>· est. max ' + fmt(pb.e1) + " kg</span>" : "") + "</div>" : "");
    if (grp.length > 1) h += '<div class="ssnext">' + grp.map(function (i) { return '<span class="' + (i === k ? "on" : "") + '">' + esc(shortName(exInfo(w.exs[i].x).n)) + " " + doneCount(w.exs[i]) + "/" + setCount(w.exs[i]) + "</span>"; }).join('<i>→</i>') + "</div>";
    if (e.rg || e.drop) h += '<div class="ptgt">' + TI.target + (e.rg ? "Target " + e.rg[0] + "–" + e.rg[1] + (e.mode === "time" ? " s" : " reps") : "") + (e.drop ? (e.rg ? " · " : "") + "<b>last set is a drop set</b>" : "") + "</div>";
    if (e.drop && j === e.sets.length - 1) h += '<p class="hint dropnow">Drop set: after this set, lower the weight by about 25% and keep going until you can\'t, then log it.</p>';
    if (!doneCount(e)) h += w.plan && w.plan.swap ? '<button class="lnk rswap" data-tact="lswap">Don\'t have this machine? Swap for a different exercise</button>'
      : '<button class="lnk rswap" data-tact="pick" data-mode="swap">Change this exercise (this time only)</button>';
    h += noteBox(u, e.x);
    var timed = e.mode === "time";
    h += '<div class="modesw"><button class="' + (timed ? "" : "on") + '" data-tact="mode" data-v="reps">Reps</button><button class="' + (timed ? "on" : "") + '" data-tact="mode" data-v="time">Time</button></div>';
    h += '<div class="lsets">' + e.sets.map(function (s, i) {
      var p = e.prev[i] || e.prev[e.prev.length - 1];
      if (s.done) return '<button class="ls done" data-tact="undo" data-k="' + k + '" data-j="' + i + '"><span class="n">' + TI.check + "</span><b>" + setTxt(s.kg, s.reps, timed) + "</b><small>tap to redo</small></button>";
      if (i === j) return '<div class="ls now"><span class="n">' + (i + 1) + "</span><b>Set " + (i + 1) + "</b><small>" + (p ? "Last time " + setTxt(p[0], p[1], timed) : "First time") + "</small></div>";
      return '<div class="ls"><span class="n">' + (i + 1) + "</span><b>" + (p ? setTxt(p[0], p[1], timed) : "Set " + (i + 1)) + "</b><small>" + (p ? "last time" : "") + "</small></div>";
    }).join("") + "</div>";
    if (j >= 0) {
      h += tipBox(u, e, j);
      var per = x.e === "dumbbell" ? "per dumbbell" : x.e === "kettlebells" ? "per kettlebell" : "";
      h += '<div class="editor"><div class="stepper"><span>kg' + (per ? ' <em class="per">' + per + "</em>" : "") + '</span><button data-tact="step" data-f="kg" data-v="-2.5" aria-label="Less weight">−</button><input id="lkg" data-k="' + k + '" data-j="' + j + '" data-f="kg" inputmode="decimal" value="' + esc(setVal(e, j, "kg")) + '" placeholder="0"><button data-tact="step" data-f="kg" data-v="2.5" aria-label="More weight">+</button></div>'
        + (timed ? '<div class="stepper"><span>seconds</span><button data-tact="step" data-f="reps" data-v="-5" aria-label="Less time">−</button><input id="lreps" data-k="' + k + '" data-j="' + j + '" data-f="reps" inputmode="numeric" value="' + esc(setVal(e, j, "reps")) + '" placeholder="0"><button data-tact="step" data-f="reps" data-v="5" aria-label="More time">+</button></div></div>'
          + (T.sw && T.sw.k === k ? '<div class="swatch on"><b id="swClock">' + mmss((Date.now() - T.sw.start) / 1000) + '</b><button class="btn pri wide xl" data-tact="swstop">' + TI.check + "Stop and log</button></div>"
            : '<div class="swatch"><button class="btn wide xl" data-tact="swstart">' + TI.clock + "Start timer</button></div>")
          : '<div class="stepper"><span>reps</span><button data-tact="step" data-f="reps" data-v="-1" aria-label="Fewer reps">−</button><input id="lreps" data-k="' + k + '" data-j="' + j + '" data-f="reps" inputmode="numeric" value="' + esc(setVal(e, j, "reps")) + '" placeholder="0"><button data-tact="step" data-f="reps" data-v="1" aria-label="More reps">+</button></div></div>')
        + (T.sw && T.sw.k === k ? "" : '<button class="btn pri wide xl" data-tact="log">' + TI.check + "Log set " + (j + 1) + "</button>");
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
      var x = exInfo(e.x), dc = doneCount(e), sc = setCount(e);
      return '<div class="row ov' + (e.g ? " ssrow" : "") + '"><div class="t tap" data-tact="goto" data-k="' + k + '"><b>' + esc(shortName(x.n)) + (noteOf(u, e.x) ? ' <span class="hasnote">' + TI.note + "</span>" : "") + "</b><small>" + (e.g ? "Superset " + esc(e.g) + " · " : "") + esc(musText(x)) + '</small></div><span class="cnt' + (dc === sc ? " full" : "") + '">' + (isCardio(e) ? (e.done ? "done" : (num(e.c.min) || "–") + " min") : dc + "/" + sc) + '</span><button class="x" data-tact="exrm" data-k="' + k + '" aria-label="Remove exercise">×</button></div>';
    }).join("") + "</div>";
    else h += '<p class="empty">Add your first exercise.</p>';
    return h + '<button class="btn wide" data-tact="pick" data-mode="active">' + A.ICON.plus + "Add exercise</button></div>"
      + '<button class="btn danger wide" data-tact="discard">Discard workout</button>';
  }

  // Short beep and buzz when rest ends (audio is unlocked by the Log set tap)
  var audio = null;
  function unlockAudio() { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === "suspended") audio.resume(); } catch (e) {} }
  function tone(t0, f, d, vol, type) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.type = type || "square"; o.frequency.setValueAtTime(f, audio.currentTime + t0);
    g.gain.setValueAtTime(0.0001, audio.currentTime + t0); g.gain.exponentialRampToValueAtTime(vol, audio.currentTime + t0 + 0.01);
    g.gain.setValueAtTime(vol, audio.currentTime + t0 + d - 0.03); g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + t0 + d);
    o.connect(g); g.connect(audio.destination); o.start(audio.currentTime + t0); o.stop(audio.currentTime + t0 + d + 0.02);
  }
  /* Rest timer sound, chosen in Settings (saved on the profile as "sound"):
   *  alarm  loud two-tone alarm repeated three times, with 3-2-1 ticks (the original)
   *  chime  gentle rising three-note tune, soft ticks
   *  sport  two short sharp beeps, medium ticks
   *  silent no sound and no buzz */
  var SOUNDS = [["alarm", "Alarm"], ["chime", "Chime"], ["sport", "Sport"], ["silent", "Silent"]];
  function soundOf() { var s = (me() || {}).sound; return SOUNDS.some(function (x) { return x[0] === s; }) ? s : "alarm"; }
  function tick(kind) {
    kind = kind || soundOf(); if (kind === "silent") return;
    try { if (audio) { if (kind === "chime") tone(0, 1046, 0.08, 0.12, "sine"); else if (kind === "sport") tone(0, 1200, 0.06, 0.25, "triangle"); else tone(0, 880, 0.09, 0.35, "square"); } } catch (e) {}
    if (navigator.vibrate) navigator.vibrate(kind === "chime" ? 20 : 40);
  }
  function beep(kind) {
    kind = kind || soundOf(); if (kind === "silent") return;
    if (navigator.vibrate) navigator.vibrate(kind === "chime" ? [200, 100, 200] : kind === "sport" ? [250, 100, 250] : [400, 120, 400, 120, 600]);
    try { if (!audio) return; if (audio.state === "suspended") audio.resume();
      if (kind === "chime") { [[0, 784], [0.18, 988], [0.36, 1175], [0.62, 1568]].forEach(function (n, i) { tone(n[0], n[1], i === 3 ? 0.7 : 0.32, 0.35, "sine"); tone(n[0], n[1] * 2, i === 3 ? 0.5 : 0.2, 0.06, "sine"); }); }
      else if (kind === "sport") { [0, 0.28].forEach(function (t0) { tone(t0, 1760, 0.18, 0.6, "triangle"); tone(t0, 880, 0.18, 0.25, "square"); }); }
      else for (var r = 0; r < 3; r++) for (var k = 0; k < 3; k++) { var t0 = r * 0.75 + k * 0.2; tone(t0, k % 2 ? 1320 : 990, 0.16, 0.9, "square"); tone(t0, k % 2 ? 660 : 495, 0.16, 0.4, "sawtooth"); }
    } catch (e) {}
  }
  function soundHtml(u) {
    var cur = soundOf();
    return '<div class="card">' + A.head("watch", "Rest timer sound", "", "snd") + '<div class="seg seg4">' + SOUNDS.map(function (x) { return '<button class="' + (cur === x[0] ? "on" : "") + '" data-tact="sound" data-v="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>"
      + '<button class="btn wide" data-tact="soundtest" style="margin-top:10px"' + (cur === "silent" ? " disabled" : "") + ">" + TI.clock + "Test the sound</button>"
      + A.tip("snd", "Plays when your rest is over, with ticks for the last 3 seconds. Alarm is the loudest, Chime is gentle, Sport is two short beeps, Silent turns off the sound and the buzz. It's as loud as your phone's media volume.") + "</div>";
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
    if (!(+s.reps > 0)) { A.toast(e.mode === "time" ? "Enter the seconds, or use the timer" : "Enter the reps first"); return; }
    s.done = true; s.at = Date.now(); w.lastTick = Date.now(); unlockAudio();
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
  function cardioDone(w) { return w.exs.filter(function (e) { return isCardio(e) && e.done; }); }
  /* Active lifting time: the gap before each logged set counts up to 3 minutes (or that exercise's rest + 1 min
   * if longer); anything beyond is a break and isn't counted. Cardio steps count their own minutes instead. */
  function activeMinutes(w) {
    var ev = [];
    w.exs.forEach(function (e) {
      if (isCardio(e)) { if (e.done && e.at) ev.push({ t: e.at, c: 1 }); return; }
      e.sets.forEach(function (st) { if (st.done) ev.push({ t: st.at || 0, cap: Math.max(180, (+e.rest || 0) + 60) }); });
    });
    var lifts = ev.filter(function (x) { return !x.c; });
    if (!lifts.length) return 0;
    if (lifts.some(function (x) { return !x.t; })) return null; // sets logged before this update: no timestamps
    ev.sort(function (a, b) { return a.t - b.t; });
    var prev = w.start, sec = 0;
    ev.forEach(function (x) { if (!x.c) sec += Math.min(Math.max(0, x.t - prev) / 1000, x.cap); prev = x.t; });
    return Math.max(1, Math.round(sec / 60));
  }
  function finishKcal(u, w, min, effort) {
    var cd = cardioDone(w), cmin = cd.reduce(function (s, e) { return s + num(e.c.min); }, 0), ckc = cd.reduce(function (s, e) { return s + cardioKcal(cardioType(e.x), e.c); }, 0);
    var smin = Math.max(0, min), hasLift = w.exs.some(function (e) { return !isCardio(e) && doneCount(e); });
    var met = w.plan && w.plan.eff === effort ? w.plan.met : EFFORT[effort]; // a recommended workout keeps its own level until changed
    return { total: (hasLift ? A.FC.exerciseCal(met, smin, A.bodyOf(u)) : 0) + ckc, cmin: cmin, ckc: ckc, smin: smin, hasLift: hasLift };
  }
  function finishView(u) {
    var w = T.active, f = T.finish, min = f.min, fk = finishKcal(u, w, min, f.effort), kc = fk.total, total = Math.max(1, Math.round((Date.now() - w.start) / 60000));
    var sets = w.exs.reduce(function (s, e) { return s + (isCardio(e) ? 0 : e.sets.filter(function (x) { return x.done; }).length); }, 0);
    return '<div class="card"><h2>Finish workout</h2><div class="stack"><p class="hint">' + sets + " sets done. Unticked sets aren't saved.</p>"
      + (fk.hasLift ? '<label class="f">Active lifting minutes<input id="fnMin" inputmode="numeric" value="' + min + '"></label>'
        + '<p class="hint actv">' + TI.clock + fmt(min) + " active of " + fmt(total) + " min in the gym" + (total - min - fk.cmin > 2 ? ". Breaks over 3 minutes between sets aren't counted." : ".") + "</p>" : "")
      + '<div><div class="hint" style="margin-bottom:6px">How hard was it?</div><div class="seg">' + ["light", "normal", "hard"].map(function (k) { return '<button class="' + (f.effort === k ? "on" : "") + '" data-tact="effort" data-v="' + k + '">' + k.charAt(0).toUpperCase() + k.slice(1) + "</button>"; }).join("") + "</div></div>"
      + '<label class="f">Calories burned<input id="fnK" inputmode="numeric" value="' + (f.kcal != null ? f.kcal : kc) + '"></label>'
      + (fk.cmin ? '<p class="hint">Includes ' + fmt(fk.ckc) + " cal from " + fmt(fk.cmin) + " min of cardio" + (fk.hasLift && fk.smin >= 1 ? "; plus " + fmt(fk.smin) + " active min of weights." : ".") + "</p>" : "")
      + A.tip("finish", "Weights: active lifting minutes × effort (light 3.5, normal 5, hard 6 MET), using your weight, height, age and sex. Active minutes count the time before each set up to 3 minutes (or your rest + 1 minute if longer), so chats and waits for a machine don't count. Cardio uses its own entry. Change the calories if your watch says otherwise.")
      + '<div class="btns"><button class="btn pri" style="flex:1" data-tact="save-workout">Save workout</button><button class="btn ghost" data-tact="back">Back</button></div></div></div>';
  }

  function saveWorkout() {
    var u = me(), w = T.active, f = T.finish;
    var amin = Math.max(0, Math.round(+(($("#fnMin") || {}).value || f.min))), kc = Math.round(+($("#fnK") || {}).value);
    var min = Math.max(1, Math.round((Date.now() - w.start) / 60000));
    if (!(kc >= 0)) kc = finishKcal(u, w, amin, f.effort).total;
    var exs = w.exs.map(function (e) {
      if (isCardio(e)) { if (!e.done) return null; var ct = cardioType(e.x), r = cardioMET(ct, e.c); return { x: e.x, n: exInfo(e.x).n, cardio: { min: num(e.c.min), km: num(e.c.km), kmh: num(e.c.kmh), inc: num(e.c.inc), eff: e.c.eff, met: r.met, note: r.note, kcal: cardioKcal(ct, e.c) }, sets: [] }; }
      var sets = e.sets.filter(function (s) { return s.done; }).map(function (s) { return [+String(s.kg).replace(",", ".") || 0, Math.round(+s.reps) || 0]; }).filter(function (s) { return s[1] > 0; });
      var out = { x: e.x, n: exInfo(e.x).n, g: e.g, sets: sets }; if (e.mode === "time") out.t = 1; return out;
    }).filter(function (e) { return e && (e.cardio || e.sets.length); });
    if (!exs.length) { A.toast("Log at least one set first"); return; }
    var date = w.date || A.today(), pbs = [], pbMap = JSON.parse(JSON.stringify(u.pb || {})), last = JSON.parse(JSON.stringify(u.last || {}));
    var pbBefore = {}, pbAfter = {}, lastBefore = {};
    exs.forEach(function (e) {
      if (e.cardio) return;
      var old = pbMap[e.x], p = old ? JSON.parse(JSON.stringify(old)) : { n: e.n }, first = !old;
      p.n = e.n;
      if (e.t) e.sets.forEach(function (s) { if (s[1] > (p.ts || 0)) { var longer = p.ts > 0; p.ts = s[1]; p.tsk = s[0]; p.tsd = date; p.tsnew = !first && longer; if (p.tsnew) pbs.push({ x: e.x, n: e.n, t: "ts", secs: s[1] }); } });
      else e.sets.forEach(function (s) {
        var kg = s[0], reps = s[1], est = e1rm(kg, reps);
        if (kg > 0 && (!(p.w > 0) || kg > p.w || (kg === p.w && reps > p.wr))) { var heavier = p.w > 0 && kg > p.w; p.w = kg; p.wr = reps; p.wd = date; p.wnew = !first && heavier; if (p.wnew) pbs.push({ x: e.x, n: e.n, t: "w", kg: kg, reps: reps }); }
        if (est > (p.e1 || 0) + 0.05) { var better = p.e1 > 0; p.e1 = r1(est); p.e1kg = kg; p.e1r = reps; p.e1d = date; p.e1new = !first && better; if (p.e1new && !(pbs.length && pbs[pbs.length - 1].x === e.x && pbs[pbs.length - 1].kg === kg)) pbs.push({ x: e.x, n: e.n, t: "e1", kg: kg, reps: reps }); }
        if (!kg && reps > (p.r || 0)) { var more = p.r > 0; p.r = reps; p.rd = date; p.rnew = !first && more; if (p.rnew) pbs.push({ x: e.x, n: e.n, t: "r", reps: reps }); }
      });
      if (JSON.stringify(old || null) !== JSON.stringify(p)) { pbBefore[e.x] = old || null; pbAfter[e.x] = p; }
      lastBefore[e.x] = last[e.x] || null;
      pbMap[e.x] = p;
      last[e.x] = { d: date, sets: e.sets };
    });
    // Keep one PB per exercise in the summary
    var seen = {}; pbs = pbs.reverse().filter(function (p) { if (seen[p.x]) return false; seen[p.x] = 1; return true; }).reverse();
    var lift = { id: w.id, name: w.name || "Workout", rid: w.rid, start: w.start, end: Date.now(), min: min, amin: amin, effort: f.effort, kcal: kc, exs: exs, pbs: pbs, pbBefore: pbBefore, pbAfter: pbAfter, lastBefore: lastBefore };
    var nsets = exs.reduce(function (s, e) { return s + e.sets.length; }, 0);
    A.changeMe(function (uu) {
      uu.pb = pbMap; uu.last = last;
      // Remember rest times changed during the workout in the saved workout
      addStats(uu, lift, 1);
      var r = (uu.routines || []).filter(function (x) { return x.id === w.rid; })[0];
      if (r) r.items.forEach(function (it) { var e = w.exs.filter(function (z) { return z.x === it.x; })[0]; if (e && e.rest) it.rest = e.rest; });
    });
    A.changeDay(date, function (d) {
      d.lifts = (d.lifts || []).filter(function (l) { return l.id !== lift.id; }); d.lifts.push(lift);
      d.ex = d.ex.filter(function (x) { return x.lift !== lift.id; });
      var cmn = exs.reduce(function (s2, e) { return s2 + (e.cardio ? e.cardio.min : 0); }, 0);
      d.ex.push({ id: uid(), name: lift.name, kcal: kc, min: min, note: min + " min" + (nsets ? " (" + amin + " active) · " + nsets + " sets" : "") + (cmn ? " · " + fmt(cmn) + " min cardio" : "") + " · tracked", src: "tracker", lift: lift.id });
    });
    T.active = null; T.finish = null; T.overview = false; saveActive(); wake(false); render();
    A.celebrate();
    setTimeout(function () { if (A.checkBadges) A.checkBadges(); }, 0);
    A.toast(pbs.length ? pbs.length + " new PB" + (pbs.length > 1 ? "s" : "") + "! " + pbs.map(function (p) { return shortName(p.n); }).join(", ") : "Workout saved. " + fmt(kc) + " cal added to today.", true);
  }

  // What a workout adds to the lifetime counters behind badges
  function liftTotals(l) {
    var t = { vol: 0, cmin: 0, pbs: (l.pbs || []).length };
    l.exs.forEach(function (e) { if (e.cardio) t.cmin += +e.cardio.min || 0; if (!e.t) (e.sets || []).forEach(function (x) { t.vol += (+x[0] || 0) * (+x[1] || 0); }); });
    return t;
  }
  function addStats(uu, l, sign) {
    uu.stats = uu.stats || (A.backfillStats ? A.backfillStats(uu) : { w: 0, vol: 0, pbs: 0, cmin: 0, hf: 0 });
    var t = liftTotals(l), st = uu.stats;
    st.w = Math.max(0, (+st.w || 0) + sign); st.vol = Math.max(0, Math.round((+st.vol || 0) + sign * t.vol)); st.pbs = Math.max(0, (+st.pbs || 0) + sign * t.pbs); st.cmin = Math.max(0, (+st.cmin || 0) + sign * t.cmin);
  }

  /* ---------- Deleting a logged workout ---------- */
  // Rebuild one exercise's bests from the sessions still on the phone (last 10 weeks)
  function rebuildPb(userId, exId, skipId, name) {
    var p = null;
    liftsOf(userId, 70).slice().reverse().forEach(function (o) {
      if (o.l.id === skipId) return;
      o.l.exs.forEach(function (e) {
        if (e.x !== exId) return;
        p = p || { n: name };
        if (e.t) { e.sets.forEach(function (st) { if (st[1] > (p.ts || 0)) { p.ts = st[1]; p.tsk = st[0]; p.tsd = o.d; } }); return; }
        e.sets.forEach(function (st) {
          var kg = st[0], reps = st[1], est = e1rm(kg, reps);
          if (kg > 0 && (!(p.w > 0) || kg > p.w || (kg === p.w && reps > p.wr))) { p.w = kg; p.wr = reps; p.wd = o.d; }
          if (est > (p.e1 || 0)) { p.e1 = r1(est); p.e1kg = kg; p.e1r = reps; p.e1d = o.d; }
          if (!kg && reps > (p.r || 0)) { p.r = reps; p.rd = o.d; }
        });
      });
    });
    return p;
  }
  function lastSession(userId, exId, skipId) {
    var list = liftsOf(userId, 70);
    for (var i = 0; i < list.length; i++) {
      if (list[i].l.id === skipId) continue;
      var e = list[i].l.exs.filter(function (x) { return x.x === exId; })[0];
      if (e) return { d: list[i].d, sets: e.sets };
    }
    return null;
  }
  function deleteWorkout(date, id) {
    var u = me(), day = A.getDay(u.id, date), lift = ((day && day.lifts) || []).filter(function (l) { return l.id === id; })[0];
    if (!lift) return;
    A.changeMe(function (uu) {
      addStats(uu, lift, -1);
      uu.pb = uu.pb || {}; uu.last = uu.last || {};
      lift.exs.forEach(function (e) {
        var cur = uu.pb[e.x];
        if (lift.pbAfter && Object.prototype.hasOwnProperty.call(lift.pbAfter, e.x)) {
          // Saved after this update: put the old bests back if nothing has beaten them since
          if (JSON.stringify(cur) === JSON.stringify(lift.pbAfter[e.x])) { if (lift.pbBefore[e.x]) uu.pb[e.x] = lift.pbBefore[e.x]; else delete uu.pb[e.x]; }
        } else if (!lift.pbAfter && cur && (cur.wd === date || cur.e1d === date || cur.rd === date)) {
          // Older workout: best effort from the history still on the phone
          var rb = rebuildPb(u.id, e.x, id, e.n);
          if (rb) uu.pb[e.x] = rb; else delete uu.pb[e.x];
        }
        var l = uu.last[e.x];
        if (l && l.d === date) {
          var prev = (lift.lastBefore && lift.lastBefore[e.x]) || lastSession(u.id, e.x, id);
          if (prev) uu.last[e.x] = prev; else delete uu.last[e.x];
        }
      });
    });
    A.changeDay(date, function (d) {
      d.lifts = (d.lifts || []).filter(function (l) { return l.id !== id; });
      d.ex = d.ex.filter(function (x) { return x.lift !== id; });
    });
    delete T.open[id]; render(); A.toast("Workout deleted");
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
    $("#tpMus").innerHTML = '<button class="chip' + (T.mf === -1 ? " on" : "") + '" data-tact="mf" data-m="-1">All</button><button class="chip' + (T.mf === -2 ? " on" : "") + '" data-tact="mf" data-m="-2">Cardio</button>' + M.map(function (m, i) { return '<button class="chip' + (T.mf === i ? " on" : "") + '" data-tact="mf" data-m="' + i + '">' + LABEL[m] + "</button>"; }).join("");
    var q = norm(T.q), cards = T.mf === -1 || T.mf === -2 ? CORDER.filter(function (k) { return !q || norm(CARDIO[k].n + " " + k + " cardio").indexOf(q) >= 0; }) : [];
    var res = T.mf === -2 ? [] : search(T.q, T.mf), h = "";
    if (cards.length) h += '<div class="slab">Cardio</div><div class="cpick">' + cards.map(function (k) { return '<button class="chip" data-tact="add" data-x="cardio:' + k + '">' + TI.run + esc(CARDIO[k].n) + "</button>"; }).join("") + "</div>" + (res.length ? '<div class="slab">Strength</div>' : "");
    if (!T.q && T.mf < 0) h += '<p class="hint" style="padding:4px 2px 8px">Popular exercises. Search or pick a muscle to see more.</p>';
    h += res.map(function (x) {
      var open = T.peek === x.i;
      return '<div class="tp-row' + (open ? " open" : "") + '"><button class="tp-item" data-tact="add" data-x="' + esc(x.i) + '"><b>' + esc(x.n) + "</b><small>" + esc(musText(x)) + (x.e ? " · " + esc(x.e) : "") + "</small></button>"
        + (x.e !== "custom" ? '<button class="tp-peek' + (open ? " on" : "") + '" data-tact="peek" data-x="' + esc(x.i) + '" aria-label="Show demo">' + TI.play + "</button>" : "")
        + (open ? demo(x.i, true) : "") + "</div>";
    }).join("");
    if (!res.length && !cards.length) h += '<p class="empty">No match.</p>';
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
    if (T.picker.mode === "swap") { // this session only: the saved workout keeps its exercise
      var w = T.active, old = w.exs[w.cur]; if (!old || doneCount(old)) { T.picker = null; return render(); }
      var n = String(id).indexOf("cardio:") === 0 ? newCardio(id, 10) : newEx(u, id, old.sets.length || 3, old.g);
      w.exs[w.cur] = n; T.sw = null; T.picker = null; saveActive();
      A.toast("Changed to " + shortName(exInfo(id).n) + " for this workout"); render(); var p = $("#pTrain"); if (p) p.scrollTop = 0; return;
    }
    if (T.picker.mode === "routine") T.draft.items.push(String(id).indexOf("cardio:") === 0 ? { x: id, min: 10, g: "" } : { x: id, sets: 3, g: "" });
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
    cancel: function () { T.view = "home"; T.draft = null; T.cardio = null; T.logMode = null; T.rec = null; A.S.est = null; render(); },
    del: function () { var id = T.draft.id; A.changeMe(function (u) { u.routines = (u.routines || []).filter(function (x) { return x.id !== id; }); }); T.view = "home"; T.draft = null; render(); },
    pick: function (b) { T.picker = { mode: b.dataset.mode }; T.q = ""; T.mf = -1; T.custom = null; render(); setTimeout(function () { var q = $("#tpQ"); if (q && window.innerWidth > 700) q.focus(); }, 50); },
    pickdone: function () { T.picker = null; T.custom = null; render(); },
    mf: function (b) { T.mf = +b.dataset.m; renderPicker(); },
    peek: function (b) { T.peek = T.peek === b.dataset.x ? null : b.dataset.x; renderPicker(); },
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
    swstart: function () { T.sw = { k: T.active.cur, start: Date.now() }; unlockAudio(); render(); },
    swstop: function () {
      var w = T.active, e = w.exs[w.cur], j = nextSet(e); if (!T.sw || j < 0) return;
      e.sets[j].reps = String(Math.max(1, Math.round((Date.now() - T.sw.start) / 1000))); T.sw = null; logSet();
    },
    mode: function (b) {
      var w = T.active, e = w.exs[w.cur], v = b.dataset.v; if (e.mode === v) return;
      e.mode = v; T.sw = null; e.sets.forEach(function (st) { if (!st.done) { st.reps = ""; } });
      if (v === "time" && e.rest > 90) e.rest = 60;
      saveActive(); A.changeMe(function (uu) { uu.modes = uu.modes || {}; uu.modes[e.x] = v; }); render();
    },
    zoom: function (b) {
      var id = b.dataset.x, u = IMG + encodeURIComponent(id) + "/", z = document.createElement("div");
      z.id = "zoom"; z.innerHTML = '<div class="zbox"><img src="' + u + '0.jpg" alt="Start position"><img class="f2" src="' + u + '1.jpg" alt="End position"></div><p>' + esc(shortName(exInfo(id).n)) + "<br><small>Tap anywhere to close</small></p>";
      z.addEventListener("click", function () { z.remove(); if (A.syncHistory) A.syncHistory(); }); document.body.appendChild(z); if (A.syncHistory) A.syncHistory();
    },
    noteedit: function (b) { T.noteEdit = b.dataset.x; T.noteDraft = null; render(); setTimeout(function () { var t = $("#exNote"); if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length); } }, 30); },
    notecancel: function () { T.noteEdit = null; T.noteDraft = null; render(); },
    notesave: function (b) { var t = $("#exNote"); saveNote(b.dataset.x, t ? t.value : T.noteDraft); },
    notedel: function (b) { saveNote(b.dataset.x, ""); },
    usesugg: function (b) {
      var w = T.active, e = w.exs[w.cur], j = nextSet(e); if (j < 0) return;
      if (b.dataset.kg) e.sets[j].kg = String(b.dataset.kg); if (b.dataset.r) e.sets[j].reps = String(b.dataset.r);
      saveActive(); render();
    },
    ceff: function (b) {
      var m = /^sc(\d+)_$/.exec(b.dataset.p), c = m ? T.cardio.parts[+m[1]] : T.active.exs[T.active.cur].c; c.eff = b.dataset.v;
      if (!m) saveActive(); render();
    },
    clog: function (b) {
      var e = T.active.exs[+b.dataset.k]; if (!num(e.c.min)) return A.toast("Add the minutes");
      e.done = true; e.at = Date.now(); T.active.lastTick = Date.now(); T.active.rest = null;
      var nx = firstOpen(+b.dataset.k + 1); if (nx >= 0) T.active.cur = nx;
      saveActive(); render(); var p = $("#pTrain"); if (p) p.scrollTop = 0;
    },
    cundo: function (b) { T.active.exs[+b.dataset.k].done = false; saveActive(); render(); },
    cmin: function (b) { var it = T.draft.items[+b.dataset.i]; it.min = Math.max(5, Math.min(180, (+it.min || 10) + +b.dataset.v)); render(); },
    rec: function () {
      if (T.active) return A.toast("Finish or discard the current workout first");
      T.rec = { min: 45, lvl: 2, pump: false, force: false, fin: true, note: "", name: "", mus: [], musOpen: false }; recBuild(); T.view = "rec"; render();
      var p = $("#pTrain"); if (p) p.scrollTop = 0;
    },
    rcmin: function (b) { T.rec.min = +b.dataset.v; T.rec.note = ""; recBuild(); render(); },
    rclvl: function (b) { T.rec.lvl = +b.dataset.v; T.rec.note = ""; recBuild(); render(); },
    rcpump: function () { T.rec.pump = !T.rec.pump; T.rec.note = ""; recBuild(); render(); },
    rcmusopen: function () { T.rec.musOpen = !T.rec.musOpen; render(); },
    rcmuspick: function () { T.rec.musOpen = true; render(); var el = $("#rcMus"); if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); },
    rcmus: function (b) {
      var R = T.rec, v = b.dataset.v;
      if (!v) R.mus = []; else { var i = R.mus.indexOf(v); if (i >= 0) R.mus.splice(i, 1); else R.mus.push(v); }
      R.note = ""; R.name = ""; recBuild(); render();
    },
    rcforce: function () { T.rec.force = true; recBuild(); render(); },
    rcdel: function (b) { T.rec.plan.items.splice(+b.dataset.i, 1); T.rec.saved = null; render(); },
    rcswap: function (b) {
      var u = me(), p = T.rec.plan, it = p.items[+b.dataset.i]; if (!it) return;
      if (String(it.x).indexOf("cardio:") === 0) {
        var ty = cardioType(it.x), nt = altCardio(u, ty, p.items.map(function (x) { return cardioType(x.x); }));
        if (!nt) return A.toast("No other machine to swap to");
        addNoEquip(it.x); var np = cardioPiece(nt, it.min, p.lvl); np.fin = it.fin; p.items[+b.dataset.i] = np;
        A.toast("Swapped to " + CARDIO[nt].n);
      } else {
        var alt = altFor(u, it.x, p.items.map(function (x) { return x.x; }));
        if (!alt) return A.toast("No other exercise to swap to");
        addNoEquip(it.x); var old = it.x; it.x = alt;
        if (isTimedEx(alt) !== isTimedEx(old)) it.rg = isTimedEx(alt) ? [20, 45] : [10, 15];
        A.toast("Swapped to " + shortName(exInfo(alt).n));
      }
      T.rec.saved = null; render();
    },
    rcstart: function () {
      var R = T.rec, p = R.plan, L = LEVELS[p.lvl], nm = ($("#rcName") || {}).value || R.name || p.name;
      startWorkout({ id: R.saved || "", name: nm, items: p.items });
      if (T.active) { T.active.plan = { eff: L.eff, met: L.met, lvl: p.lvl, swap: !R.saved }; saveActive(); render(); } // once saved it's one of your workouts: change-once instead
      T.rec = null;
    },
    rcsave: function () {
      var R = T.rec, p = R.plan, nm = (($("#rcName") || {}).value || "").trim() || p.name, id = uid();
      var items = p.items.map(function (it) { var o = { x: it.x, g: it.g || "" }; if (String(it.x).indexOf("cardio:") === 0) { o.min = it.min; o.eff = it.eff; o.kmh = it.kmh; o.inc = it.inc; } else { o.sets = it.sets; o.rest = it.rest; o.rg = it.rg; if (it.drop) o.drop = 1; } return o; });
      A.changeMe(function (uu) { uu.routines = (uu.routines || []).concat([{ id: id, name: nm, days: [], items: items }]); });
      R.saved = id; R.name = nm; render(); A.toast("Saved to My workouts");
    },
    lswap: function () {
      var u = me(), w = T.active, e = w.exs[w.cur]; if (!e || isCardio(e) || doneCount(e)) return;
      var alt = altFor(u, e.x, w.exs.map(function (x) { return x.x; })); if (!alt) return A.toast("No other exercise to swap to");
      addNoEquip(e.x);
      var n = newEx(u, alt, e.sets.length, e.g, e.rest); if (e.rg) n.rg = isTimedEx(alt) !== isTimedEx(e.x) ? (isTimedEx(alt) ? [20, 45] : [10, 15]) : e.rg; if (e.drop) n.drop = 1;
      w.exs[w.cur] = n; T.sw = null; saveActive(); render(); A.toast("Swapped to " + shortName(exInfo(alt).n));
    },
    noeqdel: function (b) { var id = b.dataset.x; A.changeMe(function (uu) { if (uu.priv && uu.priv.noEquip) uu.priv.noEquip = uu.priv.noEquip.filter(function (x) { return x !== id; }); }); },
    sound: function (b) { var v = b.dataset.v; A.changeMe(function (uu) { uu.sound = v; }); unlockAudio(); setTimeout(function () { beep(v); }, 60); },
    soundtest: function () { unlockAudio(); setTimeout(function () { beep(); }, 60); },
    lognew: function () { T.view = "cardio"; T.logMode = "cardio"; T.cardio = { parts: [newPart()], watch: "" }; A.S.edit = null; render(); var p = $("#pTrain"); if (p) p.scrollTop = 0; },
    lmode: function (b) { T.logMode = b.dataset.v; render(); },
    ivadd: function () { var ps = T.cardio.parts, l = ps[ps.length - 1]; ps.push(newPart(l.type, l.eff)); render(); },
    ivdel: function (b) { T.cardio.parts.splice(+b.dataset.i, 1); render(); },
    civl: function (b) {
      var k = +b.dataset.k, w = T.active, e = w.exs[k], n = newCardio(e.x); n.g = e.g || ""; n.c.eff = e.c.eff;
      w.exs.splice(k + 1, 0, n); w.cur = k + 1; saveActive(); render();
    },
    csave: saveCardio,
    step: function (b) {
      var w = T.active, e = w.exs[w.cur], j = nextSet(e); if (j < 0) return;
      var f = b.dataset.f, cur = parseFloat(String(setVal(e, j, f)).replace(",", ".")) || 0, v = Math.max(0, r1(cur + +b.dataset.v));
      e.sets[j][f] = String(v); saveActive();
      var el = $(f === "kg" ? "#lkg" : "#lreps"); if (el) el.value = v;
    },
    undo: function (b) { var e = T.active.exs[+b.dataset.k], s = e.sets[+b.dataset.j]; s.done = false; delete s.at; T.active.cur = +b.dataset.k; saveActive(); render(); },
    "goto": function (b) { var k = +b.dataset.k; if (k < 0 || k >= T.active.exs.length) return; T.active.cur = k; T.sw = null; T.noteEdit = null; T.noteDraft = null; T.overview = false; saveActive(); render(); var p = $("#pTrain"); if (p) p.scrollTop = 0; },
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
      var any = T.active.exs.some(function (e) { return doneCount(e) > 0; });
      if (!any) return A.toast("Tick at least one set first");
      var cm = cardioDone(T.active).reduce(function (s, e) { return s + num(e.c.min); }, 0), am = activeMinutes(T.active);
      if (am == null) am = Math.max(1, Math.round((Date.now() - T.active.start) / 60000) - cm); // older sets without times
      T.finish = { min: am, effort: (T.active.plan && T.active.plan.eff) || "normal", kcal: null };
      render();
    },
    effort: function (b) { T.finish.effort = b.dataset.v; T.finish.min = Math.max(1, Math.round(+($("#fnMin") || {}).value || T.finish.min)); T.finish.kcal = null; render(); },
    back: function () { T.finish = null; render(); },
    "save-workout": saveWorkout,
    discard: function (b) {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Tap again to discard"; setTimeout(function () { if (b.isConnected) { b.dataset.sure = ""; b.textContent = "Discard workout"; } }, 3000); return; }
      T.active = null; T.finish = null; T.overview = false; saveActive(); wake(false); render(); A.toast("Workout discarded");
    },
    histdel: function (b) {
      if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.lastChild.textContent = "Tap again to delete"; setTimeout(function () { if (b.isConnected) { b.dataset.sure = ""; b.lastChild.textContent = "Delete workout"; } }, 3000); return; }
      deleteWorkout(b.dataset.d, b.dataset.id);
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
    var best = Object.keys(pb).filter(function (id) { return pb[id].e1 > 0; }).sort(function (a, b) { return pb[b].e1 - pb[a].e1; }).slice(0, 6);
    if (!w.sessions && !last && !best.length) return "";
    var h = '<div class="card">' + A.head("dumbbell", "Training") + '<div class="stats"><div class="stat"><span>Workouts</span><b>' + w.sessions + '</b></div><div class="stat"><span>Sets</span><b>' + w.sets + '</b></div><div class="stat"><span>Volume</span><b>' + (w.vol >= 10000 ? r1(w.vol / 1000) + "t" : fmt(w.vol)) + "</b></div></div>";
    if (last) h += '<p class="hint" style="margin-bottom:8px">Last workout: <b>' + esc(last.l.name) + "</b>, " + esc(A.dayLabel(last.d).toLowerCase()) + ".</p>";
    if (best.length) h += '<div class="slab">Heaviest lifts · estimated 1RM</div><div class="ormgrid">' + best.map(function (id) {
      var q = pb[id]; return '<div class="orm"><b>' + fmt(q.e1) + '<small>kg</small></b><span>' + esc(shortName(q.n || exInfo(id).n)) + "</span><em>best set " + kgs(q.e1kg) + " × " + q.e1r + "</em></div>";
    }).join("") + "</div>";
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
      if (t.id === "exNote") { T.noteDraft = t.value; return; }
      if (t.id === "trName" && T.draft) { T.draft.name = t.value; return; }
      if (t.id === "wkName" && T.active) { T.active.name = t.value; saveActive(); return; }
      if (t.dataset && t.dataset.f && T.active) {
        var s = T.active.exs[+t.dataset.k].sets[+t.dataset.j]; s[t.dataset.f] = t.value; saveActive();
      }
      if ((t.id === "fnMin") && T.finish) { T.finish.min = Math.max(1, Math.round(+t.value || 1)); var k = $("#fnK"); if (k) k.value = finishKcal(me(), T.active, T.finish.min, T.finish.effort).total; }
      if (t.id === "fnK" && T.finish) T.finish.kcal = t.value;
      if (t.dataset && (t.dataset.cf || t.dataset.cw)) {
        var sm = /^sc(\d+)_/.exec(t.id), solo = !!sm || !!t.dataset.cw;
        if (t.dataset.cw) { if (T.cardio) T.cardio.watch = t.value; }
        else {
          var c = sm ? T.cardio && T.cardio.parts[+sm[1]] : T.active && T.active.exs[T.active.cur].c; if (!c) return;
          c[t.dataset.cf] = t.value; if (!solo) saveActive();
          var type = sm ? c.type : cardioType(T.active.exs[T.active.cur].x), pre = sm ? sm[0] : "lc_", r = cardioMET(type, c);
          var kc = $("#" + pre + "kc"); if (kc) kc.textContent = fmt(cardioKcal(type, c));
          var nt = $("#" + pre + "note"); if (nt) nt.textContent = "MET " + r.met + " · " + r.note;
        }
        if (solo && T.cardio) {
          var tt = soloCalc(), tb = $("#scTot"), tn = $("#scTotN");
          if (tb) tb.textContent = fmt(tt.total);
          if (tn) tn.textContent = fmt(tt.min) + " min" + (T.cardio.parts.length > 1 ? " over " + T.cardio.parts.length + " intervals" : "") + (num(T.cardio.watch) ? " · watch figure" : "");
        }
      }
    });
    setInterval(function () {
      if (!T.active) return;
      var tm = $("#tTimer"); if (tm) tm.textContent = clock(Date.now() - T.active.start);
      var sw = $("#swClock"); if (sw && T.sw) sw.textContent = mmss((Date.now() - T.sw.start) / 1000);
      var r = T.active.rest;
      if (r) {
        var left = (r.until - Date.now()) / 1000;
        if (left <= 0) { T.active.rest = null; saveActive(); beep(); A.toast("Rest over. Next set."); render(); return; }
        var lt = $("#rLeft"); if (lt) lt.textContent = mmss(left);
        var arc = $("#rArc"); if (arc) arc.setAttribute("stroke-dashoffset", (RC * (1 - Math.min(1, left / r.dur))).toFixed(1));
        var whole = Math.ceil(left); if (whole <= 3 && whole >= 1 && T.lastTickBeep !== whole) { T.lastTickBeep = whole; tick(); }
      }
    }, 250);
    document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.id === "rcK") e.target.blur(); });
    document.addEventListener("change", function (e) {
      var t = e.target;
      if (t.id === "rcK" && T.rec) {
        var u = me(), want = Math.round(+t.value || 0), R = T.rec; if (!(want > 0)) { render(); return; }
        var sv = recSolve(u, want), moved = sv.min !== R.min; R.min = sv.min; R.lvl = sv.lvl; recBuild();
        var got = planKcal(u, R.plan);
        R.note = sv.cap ? "The most this can plan is about " + fmt(sv.cap) + " cal (90 min, Brutal)." : (moved ? "Changed to " + sv.min + " min to get there. " : "") + (Math.abs(got - want) > 15 ? "Closest is about " + fmt(got) + " cal (" + LEVELS[R.lvl].n + ")." : LEVELS[R.lvl].n + " gets you about " + fmt(got) + " cal.");
        render(); return;
      }
      if (t.id === "rcName" && T.rec) T.rec.name = t.value;
      if (t.dataset && t.dataset.ct != null && T.cardio) { T.cardio.parts[+t.dataset.ct].type = t.value; render(); }
      if (t.dataset && t.dataset.lct != null && T.active) { T.active.exs[+t.dataset.lct].x = "cardio:" + t.value; saveActive(); render(); }
    });
    document.addEventListener("visibilitychange", function () { if (T.active && document.visibilityState === "visible") { wake(true); render(); } });
    if (T.active) wake(true);
  }

  window.FCTrain = { init: init, render: render, newWorkout: function () { if (T.active) return; ACT.new(); var p = $("#pTrain"); if (p) p.scrollTop = 0; }, soundHtml: function (u) { return soundHtml(u); }, goBack: goBack, noEquipHtml: function (u) { return noEquipHtml(u); }, doneLog: function () { if (T.view === "cardio") { T.view = "home"; T.cardio = null; T.logMode = null; } }, crewHtml: crewHtml, profileHtml: profileHtml, deleteWorkout: deleteWorkout, active: function () { return !!T.active; },
    _test: { buildPlan: buildPlan, planKcal: planKcal, recSolve: recSolve, altFor: altFor, LEVELS: LEVELS, activeMinutes: activeMinutes, recovery: recovery, e1rm: e1rm, search: search, exInfo: exInfo, suggestion: suggestion, cardioMET: cardioMET, cardioKcal: cardioKcal } };
})();
