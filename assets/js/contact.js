/* contact sheet ------------------------------------------------------
   Native <dialog>: focus trap, Esc and the inert background come from the
   browser. Posts JSON to /api/contact (src/worker.js), which mails it.
   -------------------------------------------------------------------- */
(function () {
  var dlg = document.getElementById("contact-dialog");
  if (!dlg || typeof dlg.showModal !== "function") return;
  var form = dlg.querySelector("form");
  var done = dlg.querySelector(".sheet-done");
  var status = dlg.querySelector(".sheet-status");
  var send = dlg.querySelector(".sheet-send");
  var opener = null;

  function open(e) {
    opener = e.currentTarget;
    if (!done.hidden) { form.reset(); done.hidden = true; form.hidden = false; }
    status.textContent = "";
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

    send.disabled = true;
    status.textContent = "Enviando…";
    fetch("/api/contact", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: f.name.value, email: f.email.value,
        problem: f.problem.value, website: f.website.value
      })
    }).then(function (r) {
      if (!r.ok) throw new Error(r.status);
      form.hidden = true; done.hidden = false;
      done.querySelector("button").focus();
    }).catch(function () {
      status.textContent = "Não foi possível enviar agora. Tente de novo em instantes.";
    }).then(function () { send.disabled = false; });
  });

  dlg.querySelectorAll(".fld input, .fld textarea").forEach(function (el) {
    el.addEventListener("input", function () { el.closest(".fld").classList.remove("invalid"); });
  });
})();
