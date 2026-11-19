// Barcode scanning and food lookup. Free: no keys, no accounts.
// Camera reading uses the phone's built-in barcode reader where it has one (Chrome on Android),
// otherwise barcode.js + zxing_reader.wasm (ZXing, MIT/Apache licences), loaded only when needed.
// Nutrition comes from Open Food Facts (openfoodfacts.org), a free open database. Only the barcode
// number is sent to it, nothing about the person.
(function () {
  "use strict";
  var FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"];
  var OFF = "https://world.openfoodfacts.org/api/v2/product/";
  var detectorP = null;

  function loadScript(src) {
    return new Promise(function (ok, fail) {
      var s = document.createElement("script");
      s.src = src; s.onload = ok; s.onerror = function () { fail(new Error("Couldn't load the scanner")); };
      document.head.appendChild(s);
    });
  }

  function getDetector() {
    if (detectorP) return detectorP;
    detectorP = Promise.resolve()
      .then(function () {
        if (!("BarcodeDetector" in window) || !window.BarcodeDetector.getSupportedFormats) return false;
        return window.BarcodeDetector.getSupportedFormats().then(function (f) { return f.indexOf("ean_13") >= 0; }, function () { return false; });
      })
      .then(function (native) {
        if (native) return new window.BarcodeDetector({ formats: FORMATS });
        return loadScript("barcode.js").then(function () {
          var api = window.BarcodeDetectionAPI;
          var wasm = new URL("zxing_reader.wasm", location.href).href;
          api.prepareZXingModule({ overrides: { locateFile: function (p, prefix) { return p.slice(-5) === ".wasm" ? wasm : prefix + p; } } });
          return new api.BarcodeDetector({ formats: FORMATS });
        });
      });
    detectorP.catch(function () { detectorP = null; });
    return detectorP;
  }

  function num(v) { v = parseFloat(v); return isFinite(v) && v >= 0 ? v : null; }

  // Turn an Open Food Facts product into per-100 g figures. kJ is converted (NZ labels are often kJ only).
  function parseProduct(code, p) {
    var n = p.nutriments || {};
    var per = function (k) { return num(n[k + "_100g"]); };
    var kcal = per("energy-kcal");
    if (kcal == null && per("energy-kj") != null) kcal = per("energy-kj") / 4.184;
    if (kcal == null && per("energy") != null) kcal = per("energy") / 4.184; // "energy" is kJ
    var sq = num(p.serving_quantity);
    var unit = String(p.serving_quantity_unit || "g").toLowerCase();
    if (unit !== "g" && unit !== "ml") sq = null;
    // Some products only list per serving
    if (kcal == null && sq) {
      var ks = num(n["energy-kcal_serving"]); if (ks == null && num(n["energy-kj_serving"]) != null) ks = n["energy-kj_serving"] / 4.184;
      if (ks != null) kcal = ks * 100 / sq;
    }
    if (kcal == null) return null;
    var name = String(p.product_name_en || p.product_name || "").trim();
    var brand = String(p.brands || "").split(",")[0].trim();
    return {
      code: code,
      name: name || "Scanned food",
      brand: brand && name.toLowerCase().indexOf(brand.toLowerCase()) < 0 ? brand : "",
      kcal: kcal, p: per("proteins") || 0, c: per("carbohydrates") || 0, f: per("fat") || 0,
      liquid: unit === "ml" || /ml\b/i.test(String(p.quantity || "")),
      serving: sq && sq > 0 && sq < 2000 ? Math.round(sq * 10) / 10 : null,
      servingText: String(p.serving_size || "")
    };
  }

  function fetchOne(code) {
    var fields = "product_name,product_name_en,brands,quantity,serving_size,serving_quantity,serving_quantity_unit,nutriments";
    return fetch(OFF + encodeURIComponent(code) + ".json?fields=" + fields)
      .then(function (r) { if (r.status === 404) return { status: 0 }; if (!r.ok) throw new Error("Food database busy (" + r.status + ")"); return r.json(); })
      .then(function (j) { return j && j.status === 1 && j.product ? j.product : null; });
  }

  // Resolves to a product, or null when it isn't in the database (or has no calories listed).
  function lookup(code) {
    code = String(code || "").replace(/\D/g, "");
    if (code.length < 8 || code.length > 14) return Promise.reject(new Error("That doesn't look like a barcode number"));
    var tries = [code];
    if (code.length === 12) tries.push("0" + code); // UPC-A is stored as EAN-13 with a leading 0
    if (code.length === 13 && code[0] === "0") tries.push(code.slice(1));
    var i = 0, found = null;
    function next() {
      if (i >= tries.length) return found;
      var c = tries[i++];
      return fetchOne(c).then(function (p) {
        if (!p) return next();
        var r = parseProduct(code, p);
        if (r) return r;
        found = found || { code: code, noData: true, name: String(p.product_name || "").trim() };
        return next();
      });
    }
    return Promise.resolve().then(next);
  }

  /* ---------- Camera overlay ---------- */
  var ov = null, stream = null, timer = null, done = false;

  function close() {
    done = true; clearTimeout(timer); timer = null;
    if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
    if (ov) { ov.remove(); ov = null; }
  }

  // onCode(code) is called once with the barcode number, from the camera or typed in.
  function open(onCode) {
    close(); done = false;
    ov = document.createElement("div");
    ov.id = "scan";
    ov.innerHTML = '<div class="scan-cam"><video playsinline muted autoplay></video><div class="scan-frame"></div></div>'
      + '<div class="scan-panel"><p class="scan-msg">Starting camera...</p>'
      + '<div class="scan-type"><input id="scanCode" inputmode="numeric" autocomplete="off" placeholder="Or type the barcode number"><button class="btn" data-s="type">Look up</button></div>'
      + '<button class="btn ghost wide" data-s="cancel">Cancel</button></div>';
    document.body.appendChild(ov);
    var video = ov.querySelector("video"), msg = ov.querySelector(".scan-msg");
    var finish = function (code) { if (done) return; close(); onCode(code); };

    ov.addEventListener("click", function (e) {
      var b = e.target.closest("[data-s]"); if (!b) return;
      if (b.dataset.s === "cancel") close();
      if (b.dataset.s === "type") { var v = ov.querySelector("#scanCode").value.replace(/\D/g, ""); if (v.length >= 8) finish(v); else msg.textContent = "Type all the numbers under the barcode."; }
    });
    ov.querySelector("#scanCode").addEventListener("keydown", function (e) { if (e.key === "Enter") ov.querySelector('[data-s="type"]').click(); });

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { msg.textContent = "This browser can't use the camera here. Type the barcode number instead."; return; }
    Promise.all([
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }),
      getDetector()
    ]).then(function (r) {
      if (done) { r[0].getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = r[0]; var det = r[1];
      video.srcObject = stream;
      var pl = video.play(); if (pl && pl.catch) pl.catch(function () {});
      msg.textContent = "Point the camera at the barcode.";
      var busy = false;
      (function tick() {
        if (done) return;
        if (!busy && video.readyState >= 2) {
          busy = true;
          det.detect(video).then(function (codes) {
            busy = false;
            var hit = (codes || []).filter(function (c) { return /^\d{8,14}$/.test(c.rawValue); })[0];
            if (hit) { if (navigator.vibrate) navigator.vibrate(60); finish(hit.rawValue); }
          }, function () { busy = false; });
        }
        timer = setTimeout(tick, 200);
      })();
    }).catch(function (e) {
      if (done) return;
      var n = e && e.name;
      msg.textContent = n === "NotAllowedError" ? "Camera access is blocked. Allow the camera for this site in your phone's settings, or type the barcode number."
        : n === "NotFoundError" ? "No camera found. Type the barcode number instead."
        : "Couldn't start the scanner (" + (e && e.message || e) + "). Type the barcode number instead.";
    });
  }

  window.FCScan = { open: open, close: close, lookup: lookup, parseProduct: parseProduct };
})();
