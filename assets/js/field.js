/* ------------------------------------------------------------------
   Attention field.

   A regular grid of marks -- not a particle cloud. Soft foci drift
   across it and the marks under them grow and take the accent.
   The grid stays a grid: the subject is attention over a structured
   field, which is the primitive the work is actually built on.

   How it reads:
   - Two heads, not one. A primary focus and a weaker secondary one
     wander on incommensurate paths, so the field never repeats.
   - The pointer is a third head. It follows with inertia instead of
     snapping, fades in when it enters the hero and out when it
     leaves, and is ignored on touch.
   - Heads combine as a soft union (1 - prod(1 - k)), so overlapping
     foci merge into one shape instead of stacking as two blobs.
   - Every mark keeps its own activation, which rises quickly and
     decays slowly: attention leaves a fading wake where it passed.
   - Activation drives a continuous ramp -- size, ink-to-accent
     colour, a faint halo on the hottest marks, and a small lens
     displacement away from each head, so the grid swells under
     attention rather than just changing colour.
   - Marks behind the name and the lines around it are damped, so no
     head ever puts accent on accent under the type.

   Intro, once per page load. The field opens empty -- nothing is
  drawn, not even the rest grid or the cursor; at one second a burst fires from the pointer (or, with no
  pointer known yet, from where the primary focus is). A shockwave
  ring runs out through the grid -- revealing it as it goes -- with a
  softer echo behind it,
  pushing marks outward as the front passes and letting them spring
  back. The core swells, then contracts into the head it started
  from -- the cursor head, or the primary focus -- converging on
  where that head is *now*, at exactly its steady radius and
  strength, so the intro hands over to the steady field with no
  seam. Over by ~4.7 s. Skipped when the page loads scrolled past
  the hero, and never run under reduced motion.

  Rest marks are snapped to the device pixel grid so the field is
   crisp on HiDPI; moving marks keep subpixel positions so motion
   stays smooth. Styles are prebuilt per theme and the hot loop
   allocates nothing.

   Pauses when off-screen or when the tab is hidden. Under
   prefers-reduced-motion it paints one static frame and stops.
   ------------------------------------------------------------------ */

(function () {
  "use strict";

  var canvas = document.getElementById("field");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  var GAP = 30;        // grid spacing, css px
  var BASE = 1.5;      // mark size at rest
  var PEAK = 5.8;      // mark size at full activation
  var RADIUS = 260;    // primary focus radius
  var RADIUS_2 = 170;  // secondary focus radius
  var GAIN_2 = 0.62;   // secondary focus strength
  var RADIUS_P = 190;  // pointer radius
  var DIM = 0.16;      // opacity at rest
  var BRIGHT = 0.94;   // opacity at full activation
  var LENS = 9;        // max lens displacement scale, css px
  var QUIET = 0.38;    // activation kept behind the type
  var RISE = 0.07;     // activation time constant going up, s
  var FALL = 0.95;     // ... and coming down: the wake, s
  var LEVELS = 64;     // colour ramp resolution

  var INTRO_DELAY = 1.0; // calm before the burst, s
  var INTRO_LEN = 3.7;   // burst to hand-over, s
  var PRE_GAIN = 0.55;   // drift heads before the burst
  var INTRO_GAIN = 0.5;  // overall burst intensity (ring, echo, push, core swell)
  var SHOCK = 16;        // ring displacement at full ring strength, css px (scaled via ringA)
  var RING_QUIET = 0.35; // how much of the type damping the ring ignores

  var R1 = RADIUS, R2 = RADIUS_2; // head radii, scaled to the viewport
  var w = 0, h = 0, dpr = 1, cols = 0, rows = 0, ox = 0, oy = 0, n = 0;
  var act = new Float32Array(0);    // per-mark activation, smoothed
  var quiet = new Float32Array(0);  // per-mark damping behind the type
  var order = new Int32Array(0);    // marks bucketed by colour level
  var lvl = new Uint8Array(0);
  var counts = new Int32Array(LEVELS + 1);
  var styles = new Array(LEVELS);
  var restStyle = "", restSize = 1;
  var halo = null, haloAlpha = 0.2;

  var pointer = { cx: 0, cy: 0, x: 0, y: 0, inside: false, presence: 0, seen: false };
  var rectTop = 0, rectLeft = 0, rectH = 0, rectDirty = true;
  var raf = null, last = 0, visible = true, onScreen = true;

  // intro state, written once per frame by intro(), read in the hot loop
  var introState = 0, introClock = 0;        // 0 pending, 1 running, 2 done
  var headGain = 1, iOn = false, iPtr = false, iTau = 0;
  var iOx = 0, iOy = 0, iReach = 0, iG0 = 0;  // burst origin, reach, start gain
  var iCx = 0, iCy = 0, iR = 1, iG = 0;       // the contracting core
  var iSettle = 1;                            // 0 at the blast, 1 at hand-over
  var ringR = 0, ringS = 1, ringA = 0;        // shock front
  var echoR = 0, echoS = 1, echoA = 0;        // softer echo
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  function parseRGB(s, fallback) {
    var p = (s || "").split(",");
    if (p.length < 3) p = fallback.split(",");
    return [+p[0], +p[1], +p[2]];
  }

  function readTheme() {
    var s = getComputedStyle(document.documentElement);
    var dot = parseRGB(s.getPropertyValue("--field-dot"), "14,15,16");
    var hot = parseRGB(s.getPropertyValue("--field-hot"), "216,80,27");
    var darkGround = (dot[0] + dot[1] + dot[2]) / 3 > 128;

    // ink -> accent through a warm mid-tone. A straight RGB lerp from
    // near-black to orange passes through mud; lifting the midpoint
    // toward the accent keeps the transition clean in both themes.
    for (var i = 0; i < LEVELS; i++) {
      var e = i / (LEVELS - 1);
      var c = smooth(0.18, 0.78, e);
      var m = c * c * (3 - 2 * c) * 0.35 + c * 0.65;
      var r = Math.round(dot[0] + (hot[0] - dot[0]) * m);
      var g = Math.round(dot[1] + (hot[1] - dot[1]) * m);
      var b = Math.round(dot[2] + (hot[2] - dot[2]) * m);
      var a = DIM + (BRIGHT - DIM) * Math.pow(e, 0.8);
      styles[i] = "rgba(" + r + "," + g + "," + b + "," + a.toFixed(3) + ")";
    }

    // rest marks are drawn at a whole device-pixel size; scale the
    // opacity so the snapped mark carries the same amount of ink
    var ideal = BASE * dpr;
    restSize = Math.max(1, Math.round(ideal));
    var ra = DIM * (ideal * ideal) / (restSize * restSize);
    restStyle = "rgba(" + dot[0] + "," + dot[1] + "," + dot[2] + "," + Math.min(1, ra).toFixed(3) + ")";

    // halo sprite: one radial gradient, stamped with drawImage
    halo = document.createElement("canvas");
    halo.width = halo.height = 64;
    var hc = halo.getContext("2d");
    var gr = hc.createRadialGradient(32, 32, 0, 32, 32, 32);
    var hs = hot[0] + "," + hot[1] + "," + hot[2];
    gr.addColorStop(0, "rgba(" + hs + ",1)");
    gr.addColorStop(0.35, "rgba(" + hs + ",.35)");
    gr.addColorStop(1, "rgba(" + hs + ",0)");
    hc.fillStyle = gr;
    hc.fillRect(0, 0, 64, 64);
    haloAlpha = darkGround ? 0.32 : 0.16;
  }

  function smooth(a, b, x) {
    var t = (x - a) / (b - a);
    return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    // on a phone a 260px focus would fill the hero; scale the heads
    var sc = Math.max(0.62, Math.min(1, w / 1200));
    R1 = RADIUS * sc; R2 = RADIUS_2 * sc;
    cols = Math.ceil(w / GAP) + 1;
    rows = Math.ceil(h / GAP) + 1;
    ox = (w - (cols - 1) * GAP) / 2;
    oy = (h - (rows - 1) * GAP) / 2;
    if (cols * rows !== n) {
      n = cols * rows;
      act = new Float32Array(n);
      quiet = new Float32Array(n);
      order = new Int32Array(n);
      lvl = new Uint8Array(n);
    }
    rectDirty = true;
    measureType();
  }

  // Damping mask from the line boxes of the hero type. Range rects
  // hug the glyph lines, so the short "Victor" line doesn't quiet the
  // empty space beside it.
  function measureType() {
    if (!n) return;
    for (var q = 0; q < n; q++) quiet[q] = 1;
    var hero = canvas.parentNode;
    if (!hero || !document.createRange) return;
    var els = hero.querySelectorAll(".hero-name, .hero-line, .eyebrow");
    var cr = canvas.getBoundingClientRect();
    var range = document.createRange();
    var PAD = 10, SOFT = 26;
    for (var k = 0; k < els.length; k++) {
      range.selectNodeContents(els[k]);
      var rs = range.getClientRects();
      for (var m = 0; m < rs.length; m++) {
        var r = rs[m];
        if (!r.width || !r.height) continue;
        var x0 = r.left - cr.left - PAD, x1 = r.right - cr.left + PAD;
        var y0 = r.top - cr.top - PAD, y1 = r.bottom - cr.top + PAD;
        for (var i = 0; i < cols; i++) {
          var x = ox + i * GAP;
          var dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0;
          if (dx >= SOFT) continue;
          for (var j = 0; j < rows; j++) {
            var y = oy + j * GAP;
            var dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
            if (dy >= SOFT) continue;
            var d = Math.sqrt(dx * dx + dy * dy);
            var v = QUIET + (1 - QUIET) * smooth(0, SOFT, d);
            var idx = i * rows + j;
            if (v < quiet[idx]) quiet[idx] = v;
          }
        }
      }
    }
  }

  // compact kernel: smooth to zero at r, no sqrt
  function kernel(d2, r2) {
    if (d2 >= r2) return 0;
    var u = 1 - d2 / r2;
    return u * u * u;
  }

  // Head positions for time t (s). Written to module scope to avoid
  // returning objects from the hot path.
  var f1x = 0, f1y = 0, f2x = 0, f2y = 0;
  function heads(t) {
    // incommensurate periods, so neither head retraces its path
    f1x = w * (0.52 + 0.33 * Math.sin(t * 0.11) + 0.05 * Math.sin(t * 0.31 + 2.1));
    f1y = h * (0.50 + 0.27 * Math.sin(t * 0.083 + 1.4) + 0.04 * Math.sin(t * 0.23));
    f2x = w * (0.50 + 0.38 * Math.sin(t * 0.067 + 3.7));
    f2y = h * (0.46 + 0.32 * Math.sin(t * 0.097 + 0.6));
  }

  function paint(t, dt) {
    if (!w || !h || !n) return;
    heads(t);

    var r1 = R1 * R1, r2 = R2 * R2, rp = RADIUS_P * RADIUS_P;
    var pw = pointer.presence;
    var px = pointer.x, py = pointer.y;
    // dt < 0 means "settle instantly" (static frame)
    // during the intro the front is faster than RISE, so marks take it
    // instantly, and the wake behind it is shorter; both ease back to
    // the steady constants by the hand-over
    var rise = iOn ? RISE * iSettle : RISE;
    var fall = iOn ? 0.22 + (FALL - 0.22) * iSettle : FALL;
    var up = dt < 0 ? 1 : 1 - Math.exp(-dt / Math.max(rise, 0.0001));
    var down = dt < 0 ? 1 : 1 - Math.exp(-dt / fall);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Before the burst the hero is empty: no marks, no heads, no cursor.
    // While the shock front travels, only the disc it has already swept
    // is drawn, so the grid is born exactly where the wave passes.
    if (introState === 0) return;
    var reveal = iOn && ringR + 2 * ringS < iReach;
    if (reveal) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(iOx * dpr, iOy * dpr, (ringR + 0.8 * ringS) * dpr, 0, 6.2832);
      ctx.clip();
    }

    // pass 1: activation, displacement-free colour level, bucket counts
    for (var c = 0; c <= LEVELS; c++) counts[c] = 0;
    var idx = 0;
    for (var i = 0; i < cols; i++) {
      var x = ox + i * GAP;
      var d1x = x - f1x, d2x = x - f2x, dpx = x - px;
      for (var j = 0; j < rows; j++, idx++) {
        var y = oy + j * GAP;
        var d1y = y - f1y, d2y = y - f2y;
        var k1 = headGain * kernel(d1x * d1x + d1y * d1y, r1);
        var k2 = headGain * GAIN_2 * kernel(d2x * d2x + d2y * d2y, r2);
        var kp = 0;
        if (pw > 0.001) {
          var dpy = y - py;
          kp = pw * kernel(dpx * dpx + dpy * dpy, rp);
        }
        var q = quiet[idx];
        var target;
        if (iOn) {
          // the core stands in for the head it will hand over to
          if (iPtr) kp = 0; else k1 = 0;
          var cx = x - iCx, cy = y - iCy;
          var ki = iG * kernel(cx * cx + cy * cy, iR * iR);
          target = (1 - (1 - k1) * (1 - k2) * (1 - kp) * (1 - ki)) * q;
          var ex = x - iOx, ey = y - iOy;
          var dd = Math.sqrt(ex * ex + ey * ey);
          var u = (dd - ringR) / ringS, v = (dd - echoR) / echoS;
          var ring = u > -3 && u < 3 ? ringA * Math.exp(-u * u) : 0;
          var echo = v > -3 && v < 3 ? echoA * Math.exp(-v * v) : 0;
          var wave = (1 - (1 - ring) * (1 - echo)) * (q + (1 - q) * RING_QUIET);
          target = 1 - (1 - target) * (1 - wave);
        } else {
          target = (1 - (1 - k1) * (1 - k2) * (1 - kp)) * q;
        }

        var a = act[idx];
        a += (target - a) * (target > a ? up : down);
        if (a < 0.0005) a = 0;
        act[idx] = a;

        var L = a > 0.004 ? 1 + Math.min(LEVELS - 1, (a * (LEVELS - 1) + 0.5) | 0) : 0;
        lvl[idx] = L;
        counts[L]++;
      }
    }

    // counting sort by level: one fillStyle change per level
    var sum = 0;
    for (c = 0; c <= LEVELS; c++) { var cc = counts[c]; counts[c] = sum; sum += cc; }
    for (idx = 0; idx < n; idx++) order[counts[lvl[idx]]++] = idx;
    // counts[c] is now the end of bucket c

    // pass 2: rest marks, snapped to whole device pixels
    var rs = restSize, rh = rs >> 1;
    ctx.fillStyle = restStyle;
    var end = counts[0];
    for (var o = 0; o < end; o++) {
      idx = order[o];
      var gi = (idx / rows) | 0, gj = idx - gi * rows;
      ctx.fillRect(Math.round((ox + gi * GAP) * dpr) - rh, Math.round((oy + gj * GAP) * dpr) - rh, rs, rs);
    }

    // pass 3: halo under the hottest marks
    var haloFrom = counts[(LEVELS * 0.55) | 0];
    if (halo && haloFrom < n) {
      for (o = haloFrom; o < n; o++) {
        idx = order[o];
        a = act[idx];
        var ha = (a - 0.55) / 0.45;
        if (ha <= 0) continue;
        gi = (idx / rows) | 0; gj = idx - gi * rows;
        var hx = lensX(ox + gi * GAP, oy + gj * GAP, a);
        var hy = lensY;
        var hsz = (10 + 20 * ha) * dpr;
        ctx.globalAlpha = haloAlpha * ha * ha;
        ctx.drawImage(halo, hx * dpr - hsz / 2, hy * dpr - hsz / 2, hsz, hsz);
      }
      ctx.globalAlpha = 1;
    }

    // pass 4: active marks, bucketed by colour, subpixel positions
    o = end;
    for (c = 1; c <= LEVELS; c++) {
      var stop = counts[c];
      if (o >= stop) continue;
      ctx.fillStyle = styles[c - 1];
      for (; o < stop; o++) {
        idx = order[o];
        a = act[idx];
        gi = (idx / rows) | 0; gj = idx - gi * rows;
        var mx = lensX(ox + gi * GAP, oy + gj * GAP, a);
        var my = lensY;
        // ease-out on size: marks swell early, settle at the peak
        var s = (BASE + (PEAK - BASE) * (1 - (1 - a) * (1 - a))) * dpr;
        ctx.fillRect(mx * dpr - s / 2, my * dpr - s / 2, s, s);
      }
    }
    if (reveal) ctx.restore();
  }

  // Lens: push a mark away from each head in proportion to that
  // head's kernel, so the grid bulges slightly under attention.
  // Returns x, leaves y in lensY (no allocation).
  var lensY = 0;
  function lensX(x, y, a) {
    var dx = 0, dy = 0, k, ex, ey;
    if (!(iOn && !iPtr)) {
      ex = x - f1x; ey = y - f1y;
      k = headGain * kernel(ex * ex + ey * ey, R1 * R1);
      dx += ex / R1 * k; dy += ey / R1 * k;
    }
    ex = x - f2x; ey = y - f2y;
    k = headGain * GAIN_2 * kernel(ex * ex + ey * ey, R2 * R2);
    dx += ex / R2 * k; dy += ey / R2 * k;
    if (pointer.presence > 0.001 && !(iOn && iPtr)) {
      ex = x - pointer.x; ey = y - pointer.y;
      k = pointer.presence * kernel(ex * ex + ey * ey, RADIUS_P * RADIUS_P);
      dx += ex / RADIUS_P * k; dy += ey / RADIUS_P * k;
    }
    var sx = 0, sy = 0;
    if (iOn) {
      ex = x - iCx; ey = y - iCy;
      k = iG * kernel(ex * ex + ey * ey, iR * iR);
      dx += ex / iR * k; dy += ey / iR * k;
      // shock: pushed out as the front passes, a small pull behind it,
      // then back to rest -- reads as a spring, not a slide
      ex = x - iOx; ey = y - iOy;
      var d = Math.sqrt(ex * ex + ey * ey) + 0.001;
      var u = (d - ringR) / ringS, v = (d - echoR) / echoS, b = u + 1.8;
      var push = ringA * (Math.exp(-u * u) - 0.35 * Math.exp(-b * b)) + 0.6 * echoA * Math.exp(-v * v);
      sx = ex / d * push * SHOCK; sy = ey / d * push * SHOCK;
    }
    var amp = LENS * Math.min(1, a * 1.4);
    lensY = y + dy * amp + sy;
    return x + dx * amp + sx;
  }

  // Advances the intro by dt and publishes its state for paint().
  function intro(dt) {
    if (introState === 2) return;
    introClock += dt;
    if (introState === 0) {
      headGain = PRE_GAIN;
      if (introClock < INTRO_DELAY) return;
      introState = 1;
      iTau = 0;
      iPtr = pointer.seen && pointer.inside;
      iOx = iPtr ? pointer.x : f1x;
      iOy = iPtr ? pointer.y : f1y;
      iG0 = iPtr ? pointer.presence : PRE_GAIN;
      var fx = Math.max(iOx, w - iOx), fy = Math.max(iOy, h - iOy);
      iReach = Math.sqrt(fx * fx + fy * fy) + 140; // the front leaves the screen
    } else {
      iTau += dt;
    }
    var t = iTau;
    if (t >= INTRO_LEN) { introState = 2; iOn = false; headGain = 1; return; }
    iOn = true;

    // drift heads come back up while the burst settles
    headGain = PRE_GAIN + (1 - PRE_GAIN) * smooth(1.0, 3.4, t);

    // shock front: fast out, slow finish (ease-out cubic), widening and
    // fading as it travels
    var p = Math.min(1, t / 2.0), ip = 1 - p;
    ringR = iReach * (1 - ip * ip * ip);
    ringS = 34 + 90 * p;
    ringA = INTRO_GAIN * smooth(0, 0.09, t) * Math.pow(ip, 1.4);
    var te = t - 0.32;
    if (te > 0) {
      var p2 = Math.min(1, te / 2.6), ip2 = 1 - p2;
      echoR = 0.9 * iReach * (1 - ip2 * ip2 * ip2);
      echoS = 30 + 96 * p2;
      echoA = INTRO_GAIN * 0.5 * smooth(0, 0.14, te) * Math.pow(ip2, 1.6);
    } else {
      echoA = 0;
    }

    // core: swells with the blast, then contracts into the live head --
    // its position, radius and gain all land exactly on that head's
    var tx = iPtr ? pointer.x : f1x, ty = iPtr ? pointer.y : f1y;
    var tr = iPtr ? RADIUS_P : R1, tg = iPtr ? pointer.presence : headGain;
    var conv = smooth(1.2, 3.4, t);
    iSettle = smooth(0.6, 3.4, t);
    var swell = smooth(0, 0.35, t) * (1 - conv);
    iR = tr * (1 + 1.3 * INTRO_GAIN * swell);
    iG = (iG0 + (1 - iG0) * smooth(0, 0.2, t)) * (1 - conv) + tg * conv;
    var cp = smooth(0.5, 3.0, t);
    iCx = iOx + (tx - iOx) * cp;
    iCy = iOy + (ty - iOy) * cp;
  }

  function updatePointer(dt) {
    if (rectDirty) {
      var r = canvas.getBoundingClientRect();
      rectTop = r.top; rectLeft = r.left; rectH = r.height;
      rectDirty = false;
    }
    var tx = pointer.cx - rectLeft, ty = pointer.cy - rectTop;
    var inside = pointer.inside && ty > -40 && ty < rectH + 40;

    if (!pointer.seen) { pointer.x = tx; pointer.y = ty; }
    // inertial follow: frame-rate independent exponential approach
    var f = 1 - Math.exp(-dt * 7);
    pointer.x += (tx - pointer.x) * f;
    pointer.y += (ty - pointer.y) * f;

    // presence fades in a little faster than it fades out
    var goal = inside ? 1 : 0;
    var rate = inside ? 3.2 : 1.6;
    pointer.presence += (goal - pointer.presence) * (1 - Math.exp(-dt * rate));
    if (pointer.presence < 0.001 && !inside) pointer.presence = 0;
  }

  function frame(time) {
    // cap dt so a resumed tab doesn't jump the dynamics
    var dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
    last = time;
    updatePointer(dt);
    heads(time * 0.001); // intro reads the focus position
    intro(dt);
    paint(time * 0.001, dt);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (raf !== null || reduce.matches) return;
    if (!visible || !onScreen) return;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf === null) return;
    cancelAnimationFrame(raf);
    raf = null;
  }

  function still() {
    // one static frame: heads parked off-centre, no pointer, settled
    resize();
    readTheme();
    pointer.presence = 0;
    introState = 2; iOn = false; headGain = 1;
    paint(4.2, -1);
  }

  function boot() {
    resize();
    readTheme();
    if (reduce.matches) {
      still();
    } else {
      // first frame settled, so the field doesn't fade up from empty
      if (introState === 0) headGain = PRE_GAIN;
      paint(performance.now() * 0.001, -1);
      start();
    }
  }

  var resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      resize();
      readTheme(); // rest size depends on dpr
      if (reduce.matches) still();
    }, 120);
  });

  window.addEventListener("scroll", function () { rectDirty = true; }, { passive: true });

  function track(e) {
    if (e.pointerType === "touch") return;
    pointer.cx = e.clientX;
    pointer.cy = e.clientY;
    pointer.inside = true;
    if (!pointer.seen) {
      rectDirty = true;
      updatePointer(0);
      pointer.seen = true;
    }
  }
  window.addEventListener("pointermove", track, { passive: true });
  // a cursor already resting over the page reports in via pointerover
  window.addEventListener("pointerover", track, { passive: true });

  document.documentElement.addEventListener("pointerleave", function () { pointer.inside = false; });
  window.addEventListener("blur", function () { pointer.inside = false; });

  document.addEventListener("visibilitychange", function () {
    visible = !document.hidden;
    visible ? start() : stop();
  });

  if ("IntersectionObserver" in window) {
    var firstSight = true;
    new IntersectionObserver(function (entries) {
      onScreen = entries[0].isIntersecting;
      // loaded scrolled past the hero: no intro waiting for the way back
      if (firstSight && !onScreen && introState === 0) { introState = 2; headGain = 1; }
      firstSight = false;
      onScreen ? start() : stop();
    }, { threshold: 0 }).observe(canvas);
  }

  function retheme() { readTheme(); if (reduce.matches) still(); }

  // the palette flips with the OS theme; repaint against the new tokens
  var dark = window.matchMedia("(prefers-color-scheme: dark)");
  (dark.addEventListener ? dark.addEventListener.bind(dark, "change") : dark.addListener.bind(dark))(retheme);

  // ... and with an explicit data-theme on <html>, if one is ever set
  if ("MutationObserver" in window) {
    new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }

  (reduce.addEventListener ? reduce.addEventListener.bind(reduce, "change") : reduce.addListener.bind(reduce))(
    function () { reduce.matches ? (stop(), still()) : start(); }
  );

  // the type mask depends on font metrics and on the entrance motion
  // settling; measure again once both are done
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(function () { readTheme(); measureType(); if (reduce.matches) still(); });
  }
  window.addEventListener("load", function () {
    setTimeout(function () { measureType(); if (reduce.matches) still(); }, 1400);
  });

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
