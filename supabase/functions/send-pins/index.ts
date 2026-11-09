// Supabase Edge Function: emails students their PIN.
//
// The browser sends already-written messages ({ id, to, subject, text, html }); this function checks that the
// caller is a signed-in instructor (listed in public.admins), sends each message, and marks the students as
// emailed. Students never reach it: it refuses everyone who is not an instructor.
//
// Secrets (supabase secrets set ...). Pick ONE way of sending:
//   Gmail / any SMTP:  SMTP_USER (the address), SMTP_PASS (a Gmail App Password), optional SMTP_HOST (smtp.gmail.com),
//                      SMTP_PORT (465)
//   Resend:            RESEND_API_KEY and MAIL_FROM (an address on a domain verified in Resend)
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.16";

const MAX_MESSAGES = 25;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const clean = (s: unknown, max: number) => String(s ?? "").replace(/[\r\n<>"]/g, " ").trim().slice(0, max);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST only." }, 405);

  const auth = req.headers.get("Authorization") ?? "";
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: u } = await db.auth.getUser();
  if (!u?.user) return reply({ error: "Sign in as an instructor first." }, 401);
  const { data: isAdmin } = await db.rpc("is_admin");
  if (isAdmin !== true) return reply({ error: "Only instructors can send PIN emails." }, 403);

  const smtpUser = Deno.env.get("SMTP_USER");
  const smtpPass = (Deno.env.get("SMTP_PASS") ?? "").replace(/\s+/g, "");
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = smtpUser || Deno.env.get("MAIL_FROM");
  if (!from || !((smtpUser && smtpPass) || apiKey)) {
    return reply({ error: "Email sending is not set up yet: add the SMTP_USER and SMTP_PASS secrets (see README)." }, 500);
  }
  const smtp = smtpUser && smtpPass
    ? nodemailer.createTransport({
        host: Deno.env.get("SMTP_HOST") || "smtp.gmail.com",
        port: Number(Deno.env.get("SMTP_PORT") || 465),
        secure: Number(Deno.env.get("SMTP_PORT") || 465) === 465,
        auth: { user: smtpUser, pass: smtpPass },
      })
    : null;

  let body: any;
  try { body = await req.json(); } catch { return reply({ error: "Bad request." }, 400); }
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  if (!messages.length || messages.length > MAX_MESSAGES) return reply({ error: "Send between 1 and " + MAX_MESSAGES + " messages at a time." }, 400);
  const test = body?.test === true;
  const sender = clean(body?.sender, 80) || "Grade Portal";
  const replyTo = EMAIL.test(String(body?.replyTo ?? "").trim()) ? String(body.replyTo).trim() : u.user.email;

  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const m of messages) {
    const id = String(m?.id ?? "");
    const to = String(m?.to ?? "").trim();
    if (!EMAIL.test(to) || !m?.subject || !m?.text) { results.push({ id, ok: false, error: "Invalid message." }); continue; }
    try {
      const subject = (test ? "[TEST] " : "") + String(m.subject).slice(0, 200);
      const text = String(m.text).slice(0, 20000);
      const html = m.html ? String(m.html).slice(0, 40000) : undefined;
      if (smtp) {
        await smtp.sendMail({ from: '"' + sender + '" <' + from + ">", to, replyTo, subject, text, html });
        results.push({ id, ok: true });
      } else {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
          body: JSON.stringify({ from: sender + " <" + from + ">", to: [to], reply_to: replyTo, subject, text, html }),
        });
        if (res.ok) results.push({ id, ok: true });
        else results.push({ id, ok: false, error: ((await res.json().catch(() => ({}))) as any).message || "Mail provider error " + res.status });
      }
    } catch (e) {
      results.push({ id, ok: false, error: String((e as Error).message || e) });
    }
    await sleep(smtp ? 250 : 550); // stay under the provider's rate limit
  }

  if (!test) {
    const sent = results.filter((r) => r.ok && r.id).map((r) => r.id);
    if (sent.length) await db.rpc("mark_emailed", { p_ids: sent });
  }
  return reply({ results });
});
