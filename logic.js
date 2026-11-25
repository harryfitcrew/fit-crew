/* Fit Crew: calorie maths, goal checks and scoring. No DOM here, so it can be tested in Node. */
(function (root) {
  "use strict";

  /* ---------- Body ---------- */
  function age(u, today) {
    var y = +(u && u.birthYear);
    if (!y) return 35;
    return Math.max(14, Math.min(90, +String(today || isoDate(new Date())).slice(0, 4) - y));
  }
  function bmi(kg, cm) {
    if (!kg || !cm) return 0;
    var m = cm / 100;
    return kg / (m * m);
  }
  // Mifflin-St Jeor resting energy, cal per day
  function rmr(kg, cm, yrs, sex) {
    kg = kg || 80; cm = cm || 175; yrs = yrs || 35;
    var s = sex === "m" ? 5 : sex === "f" ? -161 : -78;
    return 10 * kg + 6.25 * cm - 5 * yrs + s;
  }

  /* ---------- Exercise ----------
   * Gross energy at a MET value = MET x 3.5 ml O2/kg/min x weight, at 5 cal per litre of O2,
   * which is MET x kg x 0.0175 per minute. We report NET calories: gross minus what the person
   * would have burned at rest over the same minutes (their own Mifflin-St Jeor resting rate).
   * Height, age and sex come in through the resting rate, so two people of the same weight
   * but different build get different answers. That matches what watches call "active calories". */
  function exerciseCal(met, minutes, body) {
    met = +met || 0; minutes = +minutes || 0;
    if (met <= 0 || minutes <= 0) return 0;
    var kg = body.kg || 80;
    var gross = met * kg * 0.0175 * minutes;
    var rest = rmr(kg, body.cm, body.age, body.sex) / 1440 * minutes;
    return Math.max(0, Math.round(gross - rest));
  }

  // ACSM equations: speed km/h, grade as a fraction (8% = 0.08)
  function walkMET(kmh, grade) {
    var v = kmh * 1000 / 60;
    return (0.1 * v + 1.8 * v * (grade || 0) + 3.5) / 3.5;
  }
  function runMET(kmh, grade) {
    var v = kmh * 1000 / 60;
    return (0.2 * v + 0.9 * v * (grade || 0) + 3.5) / 3.5;
  }
  function bikeMET(kmh) {
    if (!kmh) return 7.5;
    if (kmh < 16) return 5.8;
    if (kmh < 19) return 6.8;
    if (kmh < 22.5) return 8.0;
    if (kmh < 25.5) return 10.0;
    return 12.0;
  }

  // Offline fallback when Claude isn't available: keyword match plus the equations above.
  var KINDS = [
    { re: /\b(run|runs|ran|running|jog|jogged|jogging|parkrun)\b/, name: "Run", kind: "run", pace: 10 },
    { re: /\b(walk|walked|walking|hike|hiking|tramp|tramping|treadmill)\b/, name: "Walk", kind: "walk", pace: 5 },
    { re: /\b(bike|biking|cycle|cycling|ride|riding|spin|peloton)\b/, name: "Bike", kind: "bike", pace: 18 },
    { re: /\b(swim|swimming|laps)\b/, name: "Swim", kind: "met", met: 7.0, pace: 2.5 },
    { re: /\b(row|rowing|erg)\b/, name: "Row", kind: "met", met: 7.0, pace: 12 },
    { re: /\b(hiit|crossfit|circuit|bootcamp|f45)\b/, name: "HIIT / circuit", kind: "met", met: 8.0 },
    { re: /\b(weights?|lifting|weightlifting|gym|strength|bench|squats?|deadlifts?|resistance)\b/, name: "Weight training", kind: "weights" },
    { re: /\b(yoga|pilates|stretch|stretching|mobility)\b/, name: "Yoga / pilates", kind: "met", met: 3.0 },
    { re: /\b(football|soccer|rugby|touch|basketball|netball|squash|tennis|futsal|hockey)\b/, name: "Sport", kind: "met", met: 7.0 },
    { re: /\b(box|boxing|kickboxing|mma|martial)\b/, name: "Boxing", kind: "met", met: 7.8 },
    { re: /\b(stairs|stairmaster|stepper)\b/, name: "Stair climber", kind: "met", met: 9.0 },
    { re: /\b(elliptical|cross ?trainer)\b/, name: "Cross trainer", kind: "met", met: 5.0 },
    { re: /\b(golf)\b/, name: "Golf (walking)", kind: "met", met: 4.8 },
    { re: /\b(surf|surfing)\b/, name: "Surfing", kind: "met", met: 3.0 }
  ];
  function parseWorkout(text) {
    var t = String(text || "").toLowerCase();
    var mins = 0, m;
    var h = t.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
    if (h) mins += +h[1] * 60;
    m = t.match(/(\d+(?:\.\d+)?)\s*(?:-\s*)?(?:minutes?|mins?|m)\b(?!\s*\/)/);
    if (m) mins += +m[1];
    var km = (t.match(/(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet(?:re|er)s?|k)\b(?!\s*\/|\s*per|m?\/?h)/) || [])[1];
    km = km ? +km : 0;
    var spd = (t.match(/(\d+(?:\.\d+)?)\s*(?:km\/h|kmh|kph|km per hour)/) || [])[1];
    spd = spd ? +spd : 0;
    var grade = (t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent|-?\s*degrees?|deg)\b/) || [])[1];
    grade = grade ? +grade / 100 : (/\b(incline|uphill|hill)\b/.test(t) ? 0.05 : 0);
    var hard = /\b(hard|heavy|intense|vigorous|fast|sprint|max)\b/.test(t);
    var easy = /\b(easy|light|gentle|slow|recovery)\b/.test(t);

    var k = null;
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].re.test(t)) { k = KINDS[i]; break; }
    if (!k) k = { name: "Exercise", kind: "met", met: hard ? 7 : easy ? 3.5 : 5 };
    var pace = spd || k.pace || 0;
    if (!mins && km && pace) mins = Math.round(km / pace * 60);
    if (!mins) mins = 30;
    if (!spd && km && mins && k.kind !== "met") pace = km / (mins / 60);

    var met, note;
    if (k.kind === "walk") {
      met = walkMET(Math.min(pace || 5, 7.5), grade);
      note = "Walking at " + round1(Math.min(pace || 5, 7.5)) + " km/h" + (grade ? ", " + round1(grade * 100) + "% incline" : "") + " (ACSM equation)";
    } else if (k.kind === "run") {
      met = runMET(pace || 10, grade);
      note = "Running at " + round1(pace || 10) + " km/h (ACSM equation)";
    } else if (k.kind === "bike") {
      met = bikeMET(pace);
      note = "Cycling at about " + round1(pace || 18) + " km/h";
    } else if (k.kind === "weights") {
      met = hard ? 6.0 : easy ? 3.5 : 5.0;
      note = (hard ? "Hard" : easy ? "Light" : "Normal") + " weights session";
    } else {
      met = k.met;
      if (hard) met *= 1.2;
      if (easy) met *= 0.75;
      note = "Typical MET for " + k.name.toLowerCase();
    }
    return {
      activities: [{ name: k.name, minutes: Math.round(mins), met: round1(met), intensity: hard ? "vigorous" : easy ? "light" : "moderate", note: note }],
      assumptions: (/\d/.test(t) ? "" : "No time given, assumed 30 minutes. ") + "Offline estimate from keywords."
    };
  }

  /* ---------- Days ---------- */
  function foodTotals(day) {
    var t = { kcal: 0, p: 0, c: 0, f: 0 };
    ((day && day.food) || []).forEach(function (e) {
      t.kcal += +e.kcal || 0; t.p += +e.p || 0; t.c += +e.c || 0; t.f += +e.f || 0;
    });
    return t;
  }
  function burned(day) {
    var b = 0;
    ((day && day.ex) || []).forEach(function (e) { b += +e.kcal || 0; });
    return b;
  }
  function macroCal(p, c, f) { return Math.round((+p || 0) * 4 + (+c || 0) * 4 + (+f || 0) * 9); }

  /* Goal check for one day.
   * Goal is a daily intake target. Exercise earns calories back, so we compare NET (eaten - burned).
   *  cut:      on track while net <= goal
   *  bulk:     on track once net >= goal (until evening an unfinished day just shows "to go")
   *  maintain: on track while net is within 10% of goal
   * final = the day is over (a past day, or after 8pm today). */
  /* Weekend calories (optional, Settings > Goals): chosen Fri/Sat/Sun get +extra, and the other days of that
   * Mon-Sun week get the same total taken off, so the weekly total doesn't change.
   * u.wknd = { on, days: usual high days (JS getDay: 5 Fri, 6 Sat, 0 Sun), extra, over: { weekStart: days } } */
  var WKND = [5, 6, 0];
  function highDays(u, date) {
    var w = u && u.wknd; if (!w || !w.on || !date) return [];
    var o = (w.over || {})[weekStart(date)];
    return (o || w.days || []).filter(function (d) { return WKND.indexOf(d) >= 0; });
  }
  function wkExtra(u) { return Math.max(100, Math.min(1000, Math.round(+(u && u.wknd && u.wknd.extra) || 400))); }
  function goalFor(u, date) {
    var base = +(u && u.goalKcal) || 2000, hi = highDays(u, date);
    if (!hi.length) return base;
    var extra = wkExtra(u), dow = new Date(date + "T12:00:00").getDay();
    return hi.indexOf(dow) >= 0 ? base + extra : base - Math.round(extra * hi.length / (7 - hi.length));
  }
  function assess(u, day, final, date) {
    var goal = goalFor(u, date);
    var status = (u && u.status) || "maintain";
    var eaten = foodTotals(day).kcal, burn = burned(day), net = eaten - burn;
    var logged = !!(day && day.food && day.food.length);
    var band = Math.round(goal * 0.1);
    var r = { goal: goal, eaten: eaten, burned: burn, net: net, logged: logged, state: "none", gap: 0, msg: "" };
    if (!logged) { r.state = final ? "missed" : "none"; r.msg = final ? "Nothing logged" : "Nothing logged yet"; return r; }
    if (status === "cut") {
      if (net <= goal) { r.state = "good"; r.gap = goal - net; r.msg = fmt(goal - net) + " cal left"; }
      else { r.state = "bad"; r.gap = net - goal; r.msg = fmt(net - goal) + " cal over. Burn " + fmt(net - goal) + " more to get back on track"; }
    } else if (status === "bulk") {
      if (net >= goal) { r.state = "good"; r.gap = net - goal; r.msg = "Target hit" + (net > goal ? ", " + fmt(net - goal) + " over" : ""); }
      else if (!final) { r.state = "pending"; r.gap = goal - net; r.msg = fmt(goal - net) + " cal to go"; }
      else { r.state = "bad"; r.gap = goal - net; r.msg = fmt(goal - net) + " cal under target"; }
    } else {
      if (Math.abs(net - goal) <= band) { r.state = "good"; r.gap = goal - net; r.msg = "On target" + (net < goal ? ", " + fmt(goal - net) + " left" : ""); }
      else if (net > goal) { r.state = "bad"; r.gap = net - goal - band; r.msg = fmt(net - goal) + " cal over"; }
      else if (!final) { r.state = "pending"; r.gap = goal - net; r.msg = fmt(goal - net) + " cal to go"; }
      else { r.state = "bad"; r.gap = goal - net - band; r.msg = fmt(goal - net) + " cal under"; }
    }
    return r;
  }

  /* ---------- Weight ---------- */
  function weights(u) {
    return ((u && u.weights) || []).slice().sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
  }
  function weightStats(u) {
    var w = weights(u);
    var start = +(u && u.startWeight) || (w[0] && w[0][1]) || 0;
    var current = w.length ? w[w.length - 1][1] : start;
    var change = current - start;
    var status = (u && u.status) || "maintain";
    // progress % in the direction they want
    var pct = start ? change / start * 100 : 0;
    var progress = status === "cut" ? -pct : status === "bulk" ? pct : -Math.abs(pct);
    var target = +(u && u.targetWeight) || 0;
    var toGo = target ? target - current : 0;
    return { start: start, current: current, change: change, pct: pct, progress: progress, target: target, toGo: toGo, points: w };
  }

  /* ---------- Scores ---------- */
  function addDays(iso, n) {
    var d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + n);
    return isoDate(d);
  }
  function isoDate(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function weekStart(iso) {
    var d = new Date(iso + "T12:00:00");
    var dow = (d.getDay() + 6) % 7; // Monday = 0
    return addDays(iso, -dow);
  }
  // getDay: (u, date) => day record or undefined
  function streak(u, getDay, today, evening) {
    var n = 0;
    var t = assess(u, getDay(u.id, today), evening, today);
    if (t.state === "good") n = 1;
    else if (t.state === "bad" || t.state === "missed") return 0;
    for (var i = 1; i < 400; i++) {
      var d = addDays(today, -i);
      if (u.joined && d < u.joined) break;
      if (assess(u, getDay(u.id, d), true, d).state !== "good") break;
      n++;
    }
    return n;
  }
  // 10 per day on track, 5 per day with a workout, 2 per day logged, Monday to today.
  function weekPoints(u, getDay, today, evening) {
    var ws = weekStart(today), pts = 0, good = 0, workouts = 0, days = 0;
    for (var d = ws; d <= today; d = addDays(d, 1)) {
      var day = getDay(u.id, d);
      var a = assess(u, day, d < today || evening, d);
      days++;
      if (a.logged) pts += 2;
      if (a.state === "good" && (d < today || evening)) { pts += 10; good++; }
      if (day && day.ex && day.ex.length) { pts += 5; workouts++; }
    }
    return { points: pts, good: good, workouts: workouts, days: days };
  }

  /* ---------- Suggested goal ---------- */
  function suggestGoal(u, kg) {
    var base = rmr(kg || u.startWeight, u.heightCm, age(u), u.sex) * 1.4; // lightly active, exercise logged separately
    var adj = u.status === "cut" ? -500 : u.status === "bulk" ? 300 : 0;
    return Math.round((base + adj) / 50) * 50;
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function round1(n) { return Math.round(n * 10) / 10; }
  function fmt(n) { return Math.round(Math.abs(n)).toLocaleString("en-NZ"); }

  var api = {
    age: age, bmi: bmi, rmr: rmr, exerciseCal: exerciseCal, walkMET: walkMET, runMET: runMET, bikeMET: bikeMET,
    parseWorkout: parseWorkout, foodTotals: foodTotals, burned: burned, macroCal: macroCal, assess: assess, goalFor: goalFor, highDays: highDays, wkExtra: wkExtra,
    weights: weights, weightStats: weightStats, addDays: addDays, isoDate: isoDate, weekStart: weekStart,
    streak: streak, weekPoints: weekPoints, suggestGoal: suggestGoal, round1: round1, fmt: fmt
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FC = api;
})(this);
