/* ------------------------------------------------------------------
   Attention field.

   A regular grid of marks -- not a particle cloud. A soft focus drifts
   across it and the marks under the focus grow and take the accent.
   The grid stays a grid: the subject is attention over a structured
   field, which is the primitive the work is actually built on.

   Pauses when off-screen or when the tab is hidden. Under
   prefers-reduced-motion it paints one static frame and stops.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var canvas = document.getElementById("field");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var GAP = 30;      // grid spacing, css px
  var BASE = 1.5;    // mark size at rest
  var PEAK = 5.4;    // mark size at the centre of a focus
  var RADIUS = 250;  // focus falloff radius
  var DIM = 0.16;    // opacity at rest
  var BRIGHT = 0.92; // opacity at the centre of a focus

  var w = 0, h = 0, cols = 0, rows = 0, ox = 0, oy = 0;
  var dot = "14,15,16", hot = "216,80,27";
  var pointer = { x: 0, y: 0, active: false };
  var raf = null, visible = true, onScreen = true;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function readTheme() {
    var s = getComputedStyle(document.documentElement);
    dot = (s.getPropertyValue("--field-dot") || "14,15,16").trim();
    hot = (s.getPropertyValue("--field-hot") || "216,80,27").trim();
  }

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cols = Math.ceil(w / GAP) + 1;
    rows = Math.ceil(h / GAP) + 1;
    ox = (w - (cols - 1) * GAP) / 2;
    oy = (h - (rows - 1) * GAP) / 2;
  }

  // smoothstep falloff -- no hard edge on the focus
  function falloff(d2, r) {
    if (d2 >= r * r) return 0;
    var t = 1 - Math.sqrt(d2) / r;
    return t * t * (3 - 2 * t);
  }

  function paint(time) {
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    // the drifting focus: two incommensurate periods, so it never
    // retraces the same path
    var t = time * 0.001;
    var fx = w * (0.5 + 0.34 * Math.sin(t * 0.11));
    var fy = h * (0.47 + 0.28 * Math.sin(t * 0.083 + 1.4));

    var pr = RADIUS * 0.62;

    for (var i = 0; i < cols; i++) {
      var x = ox + i * GAP;
      var dxf = x - fx;
      var dxp = x - pointer.x;
      for (var j = 0; j < rows; j++) {
        var y = oy + j * GAP;

        var dyf = y - fy;
        var e = falloff(dxf * dxf + dyf * dyf, RADIUS);

        if (pointer.active) {
          var dyp = y - pointer.y;
          var ep = falloff(dxp * dxp + dyp * dyp, pr);
          if (ep > e) e = ep;
        }

        var size = BASE + (PEAK - BASE) * e;
        var alpha = DIM + (BRIGHT - DIM) * e;
        var half = size / 2;

        ctx.fillStyle = "rgba(" + (e > 0.62 ? hot : dot) + "," + alpha.toFixed(3) + ")";
        ctx.fillRect(x - half, y - half, size, size);
      }
    }
  }

  function frame(time) {
    paint(time);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf !== null || reduce.matches) return;
    if (!visible || !onScreen) return;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf === null) return;
    cancelAnimationFrame(raf);
    raf = null;
  }

  function still() {
    // one static frame: focus parked slightly off-centre
    resize();
    readTheme();
    paint(4200);
  }

  function boot() {
    resize();
    readTheme();
    if (reduce.matches) {
      still();
    } else {
      start();
    }
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      if (reduce.matches) still();
    }, 120);
  });

  window.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch") return;
    var r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.active = pointer.y > -80 && pointer.y < r.height + 80;
  }, { passive: true });

  window.addEventListener("pointerleave", function () { pointer.active = false; });

  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
    visible ? start() : stop();
  });

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      onScreen ? start() : stop();
    }, { threshold: 0 }).observe(canvas);
  }

  // the palette flips with the OS theme; repaint against the new tokens
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  (dark.addEventListener ? dark.addEventListener.bind(dark, "change") : dark.addListener.bind(dark))(
    function () { readTheme(); if (reduce.matches) still(); }
  );

  (reduce.addEventListener ? reduce.addEventListener.bind(reduce, "change") : reduce.addListener.bind(reduce))(
    function () { reduce.matches ? (stop(), still()) : start(); }
  );

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(readTheme);

  boot();
})();

/* scroll reveals ---------------------------------------------------- */
(function () {
  "use strict";
  var items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  if (!("IntersectionObserver" in window) ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (var i = 0; i < items.length; i++) items[i].classList.add("seen");
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.classList.add("seen");
        io.unobserve(en.target);
      }
    });
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.08 });

  items.forEach(function (el) { io.observe(el); });
})();
