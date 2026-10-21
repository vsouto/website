/* vsouto.com/skills/c4x: copy buttons and the layer tabs. */
(function () {
  document.querySelectorAll(".cmd-copy").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var code = document.getElementById(btn.getAttribute("data-copy"));
      var label = btn.querySelector("span");
      var text = code.textContent;
      var done = function () {
        btn.classList.add("done");
        if (label) label.textContent = "Copied";
        setTimeout(function () { btn.classList.remove("done"); if (label) label.textContent = "Copy"; }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { select(code); });
      } else {
        select(code);
      }
    });
  });

  function select(el) {
    var r = document.createRange();
    r.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }

  var tabs = Array.prototype.slice.call(document.querySelectorAll('.x-tabs [role="tab"]'));
  function show(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", on ? "true" : "false");
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute("aria-controls")).hidden = !on;
    });
  }
  tabs.forEach(function (t, i) {
    t.addEventListener("click", function () { show(t); });
    t.addEventListener("keydown", function (e) {
      var d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var n = tabs[(i + d + tabs.length) % tabs.length];
      show(n);
      n.focus();
    });
  });
})();
