/* contact sheet ------------------------------------------------------
   Native <dialog>: focus trap, Esc and the inert background come from the
   browser. Posts JSON to /api/contact (src/worker.js), which mails it.
   Turnstile loads on the first open, and only when the form carries a
   site key; without one the worker doesn't ask for a token either.
   -------------------------------------------------------------------- */
(function () {
  var dlg = document.getElementById("contact-dialog");
  if (!dlg || typeof dlg.showModal !== "function") return;
  var form = dlg.querySelector("form");
  var done = dlg.querySelector(".sheet-done");
  var status = dlg.querySelector(".sheet-status");
  var send = dlg.querySelector(".sheet-send");
  var opener = null;
  var openedAt = 0;
  var sitekey = form.getAttribute("data-turnstile-sitekey");
  var captcha = null, token = null;

  function loadCaptcha() {
    if (!sitekey || captcha !== null) return;
    captcha = "";
    window.onTurnstileLoad = function () {
      captcha = window.turnstile.render(dlg.querySelector(".sheet-captcha"), {
        sitekey: sitekey,
        appearance: "interaction-only",
        language: "pt-br",
        callback: function (t) { token = t; },
        "expired-callback": function () { token = null; },
        "error-callback": function () { token = null; }
      });
    };
    var js = document.createElement("script");
    js.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoad";
    js.async = true;
    document.head.appendChild(js);
  }
  function resetCaptcha() {
    token = null;
    if (captcha && window.turnstile) window.turnstile.reset(captcha);
  }

  function open(e) {
    opener = e.currentTarget;
    if (!done.hidden) { form.reset(); done.hidden = true; form.hidden = false; }
    status.textContent = "";
    openedAt = Date.now();
    loadCaptcha();
    dlg.showModal();
    document.documentElement.classList.add("sheet-open");
    setTimeout(function () { form.elements.name.focus(); }, 60);
  }
  function close() {
    dlg.classList.add("closing");
    setTimeout(function () { dlg.classList.remove("closing"); dlg.close(); }, 220);
  }
  dlg.addEventListener("close", function () {
    document.documentElement.classList.remove("sheet-open");
    if (opener) opener.focus();
  });
  // Esc: animate out instead of the instant native close
  dlg.addEventListener("cancel", function (e) { e.preventDefault(); close(); });
  // click on the backdrop (the dialog box itself, outside the panel)
  dlg.addEventListener("click", function (e) { if (e.target === dlg) close(); });

  document.querySelectorAll("[data-open-contact]").forEach(function (b) { b.addEventListener("click", open); });
  dlg.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", close); });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var f = form.elements;
    var bad = null;
    ["name", "email", "problem"].forEach(function (k) {
      var ok = f[k].value.trim() && f[k].checkValidity();
      f[k].closest(".fld").classList.toggle("invalid", !ok);
      if (!ok && !bad) bad = f[k];
    });
    if (bad) { status.textContent = "Faltou preencher algo."; bad.focus(); return; }
    if (sitekey && !token) { status.textContent = "Só um instante, confirmando que você não é um robô…"; return; }

    send.disabled = true;
    status.textContent = "Enviando…";
    fetch("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.name.value, email: f.email.value,
        problem: f.problem.value, website: f.website.value,
        elapsed: Date.now() - openedAt, turnstile: token
      })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      form.hidden = true; done.hidden = false;
      done.querySelector("button").focus();
    }).catch(function (err) {
      var code = String(err && err.message);
      status.textContent =
        code === "429" ? "Muitas mensagens seguidas. Espere um minuto e tente de novo." :
        code === "403" ? "Não deu para confirmar que você não é um robô. Tente de novo." :
        "Não foi possível enviar agora. Tente de novo em instantes.";
      resetCaptcha();
    }).then(function () { send.disabled = false; });
  });

  dlg.querySelectorAll(".fld input, .fld textarea").forEach(function (el) {
    el.addEventListener("input", function () { el.closest(".fld").classList.remove("invalid"); });
  });
})();
