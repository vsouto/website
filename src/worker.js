// vsouto.com -- the static site plus one route: the contact form.
// Everything except POST /api/contact falls through to the static assets.
// The message goes out through Cloudflare Email Routing (send_email binding),
// so there is no third-party form service and no API key to leak. The
// destination lives in the MAIL_TO secret, never in this public repo.
//
// Anti-spam, cheapest check first: per-IP rate limit, honeypot field, a
// minimum time between opening the form and sending it, then Turnstile
// (enforced only once the TURNSTILE_SECRET secret exists).
import { EmailMessage } from "cloudflare:email";

const FROM = "site@vsouto.com";
const LIMITS = { name: 120, email: 200, problem: 4000 };
const MIN_FILL_MS = 3000; // no human writes a message in under 3 seconds
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/contact") return env.ASSETS.fetch(request);
    if (request.method !== "POST") return json(405, { ok: false });

    const ip = request.headers.get("cf-connecting-ip") || "";
    if (env.CONTACT_LIMIT) {
      const { success } = await env.CONTACT_LIMIT.limit({ key: ip || "anon" });
      if (!success) return json(429, { ok: false, error: "rate_limited" });
    }

    let body;
    try { body = await request.json(); } catch { return json(400, { ok: false, error: "bad_request" }); }

    // honeypot (a field no human sees) and the fill-time trap: answer as if
    // it worked, so the bot has nothing to learn from
    if (body.website) return json(200, { ok: true });
    if (!(Number(body.elapsed) >= MIN_FILL_MS)) return json(200, { ok: true });

    const name = clean(body.name, LIMITS.name);
    const email = clean(body.email, LIMITS.email);
    const problem = String(body.problem || "").trim().slice(0, LIMITS.problem);
    if (!name || !problem || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(422, { ok: false, error: "invalid" });
    }

    if (env.TURNSTILE_SECRET && !(await human(env.TURNSTILE_SECRET, body.turnstile, ip))) {
      return json(403, { ok: false, error: "captcha" });
    }

    const text = [
      `Nome: ${name}`,
      `E-mail: ${email}`,
      "",
      problem,
      "",
      "--",
      `vsouto.com · ${new Date().toISOString()} · ${request.headers.get("cf-ipcountry") || "?"}`,
    ].join("\n");

    const raw = [
      `From: vsouto.com <${FROM}>`,
      `To: ${env.MAIL_TO}`,
      `Reply-To: ${email}`,
      `Subject: ${encodeWord(`Contato pelo site, de ${name}`)}`,
      `Message-ID: <${crypto.randomUUID()}@vsouto.com>`,
      `Date: ${new Date().toUTCString()}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=utf-8",
      "Content-Transfer-Encoding: base64",
      "",
      wrap(b64(text)),
    ].join("\r\n");

    try {
      await env.MAIL.send(new EmailMessage(FROM, env.MAIL_TO, raw));
    } catch (err) {
      console.error("contact: send failed", err && err.message);
      return json(502, { ok: false, error: "send_failed" });
    }
    return json(200, { ok: true });
  },
};

async function human(secret, token, ip) {
  if (!token || typeof token !== "string") return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token.slice(0, 2048));
  if (ip) form.append("remoteip", ip);
  try {
    const r = await fetch(SITEVERIFY, { method: "POST", body: form });
    const out = await r.json();
    return out.success === true;
  } catch (err) {
    console.error("contact: siteverify failed", err && err.message);
    return false;
  }
}

// single line, no control chars: these values end up in mail headers
function clean(v, max) {
  return String(v || "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
}
function b64(s) {
  let bin = "";
  for (const byte of new TextEncoder().encode(s)) bin += String.fromCharCode(byte);
  return btoa(bin);
}
function encodeWord(s) { return `=?UTF-8?B?${b64(s)}?=`; }
function wrap(s) { return s.replace(/.{1,76}/g, "$&\r\n").trimEnd(); }
function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
