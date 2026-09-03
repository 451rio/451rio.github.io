import {buildCertificatePdf, bytesToBase64Pdf} from "./pdf.js";

function json(data, status = 200, corsOrigin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": corsOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      "cache-control": "no-store",
      vary: "Origin"
    }
  });
}

function runInBackground(ctx, task) {
  const promise = Promise.resolve()
    .then(task)
    .catch((error) => console.error("[background]", error));

  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(promise);
  return promise;
}

function serverError(corsOrigin, context, error) {
  console.error(`[${context}]`, error);
  return json({error: "Erro interno. Tente novamente mais tarde."}, 500, corsOrigin);
}

const MAX_BODY_BYTES = 32 * 1024;

async function readJsonBody(request, corsOrigin) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {error: json({error: "Payload muito grande"}, 413, corsOrigin)};
  }

  let raw;
  try {
    raw = await request.text();
  } catch {
    return {error: json({error: "Invalid JSON body"}, 400, corsOrigin)};
  }

  if (raw.length > MAX_BODY_BYTES) {
    return {error: json({error: "Payload muito grande"}, 413, corsOrigin)};
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {error: json({error: "Invalid JSON body"}, 400, corsOrigin)};
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {error: json({error: "Invalid JSON body"}, 400, corsOrigin)};
  }

  return {body: parsed};
}

function getCorsOrigin(request, env) {
  const allowedOrigins = String(env.ALLOWED_ORIGIN || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const origin = request.headers.get("Origin");
  if (!origin) return allowedOrigins[0] || "*";
  if (allowedOrigins.includes(origin)) return origin;
  return allowedOrigins[0] || "*";
}

function isValidEmail(email) {
  if (typeof email !== "string") return false;
  if (email.length < 6 || email.length > 254) return false;
  if (/[\s\u0000-\u001F\u007F]/.test(email)) return false;

  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return false;
  if (atIndex !== email.lastIndexOf("@")) return false;

  const local = email.slice(0, atIndex);
  const domain = email.slice(atIndex + 1);

  if (!local || !domain) return false;
  if (local.length > 64) return false;
  if (domain.startsWith(".") || domain.endsWith(".")) return false;
  if (domain.includes("..")) return false;

  const lastDot = domain.lastIndexOf(".");
  if (lastDot <= 0 || lastDot === domain.length - 1) return false;

  return true;
}

function normalizeDocument(document) {
  return String(document || "").slice(0, 32).replace(/\D+/g, "");
}

function isValidCpf(document) {
  const cpf = normalizeDocument(document);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1+$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i += 1) sum += Number(cpf[i]) * (10 - i);
  let firstDigit = (sum * 10) % 11;
  if (firstDigit === 10) firstDigit = 0;
  if (firstDigit !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i += 1) sum += Number(cpf[i]) * (11 - i);
  let secondDigit = (sum * 10) % 11;
  if (secondDigit === 10) secondDigit = 0;
  return secondDigit === Number(cpf[10]);
}

function normalizePhone(phone) {
  let digits = String(phone || "").slice(0, 32).replace(/\D+/g, "");
  if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2);
  return digits;
}

function isValidBrazilMobile(nationalDigits) {
  return /^[1-9][1-9]9\d{8}$/.test(nationalDigits);
}

function isValidBrazilContactPhone(nationalDigits) {
  return /^[1-9][1-9]\d{8,9}$/.test(nationalDigits);
}

function isHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "http:" || url.protocol === "https:";
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function redactEmails(text) {
  return text.replace(/[^\s@,;:<>"']+@[^\s@,;:<>"']+\.[^\s@,;:<>"']+/g, "[e-mail removido]");
}

function truncateError(value, maxLength = 500) {
  const text = redactEmails(String(value || ""));
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
}

async function getMeetupBySlug(db, slug) {
  return db
    .prepare(
      "SELECT slug, title, event_date, duration_minutes, capacity, registrations_count, is_open FROM meetups WHERE slug = ?"
    )
    .bind(slug)
    .first();
}

async function getEmailTemplateByMeetupSlug(db, slug) {
  return db
    .prepare("SELECT id, subject, text_body, html_body FROM email_templates WHERE meetup_slug = ?")
    .bind(slug)
    .first();
}

function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes) {
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str);
}

async function importAesKey(env) {
  if (!env.DOC_ENCRYPTION_KEY_BASE64) {
    throw new Error("DOC_ENCRYPTION_KEY_BASE64 secret is required");
  }
  const raw = base64ToBytes(env.DOC_ENCRYPTION_KEY_BASE64);
  if (raw.byteLength !== 32) {
    throw new Error("DOC_ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptField(value, env) {
  const key = await importAesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(value);
  const cipher = await crypto.subtle.encrypt({name: "AES-GCM", iv}, key, plain);
  const payload = new Uint8Array(iv.length + cipher.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(payload);
}

async function importHmacKey(env) {
  if (!env.DOC_ENCRYPTION_KEY_BASE64) {
    throw new Error("DOC_ENCRYPTION_KEY_BASE64 secret is required");
  }
  const raw = base64ToBytes(env.DOC_ENCRYPTION_KEY_BASE64);
  if (raw.byteLength !== 32) {
    throw new Error("DOC_ENCRYPTION_KEY_BASE64 must decode to 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
}

async function blindIndex(label, value, env) {
  const key = await importHmacKey(env);
  const message = new TextEncoder().encode(`${label}:${value}`);
  const signature = await crypto.subtle.sign("HMAC", key, message);
  return bytesToBase64(new Uint8Array(signature));
}

function generateOpaqueToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function isOpaqueToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(value);
}

async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return bytesToBase64(new Uint8Array(digest));
}

function isAdminEmail(email, env) {
  const admins = String(env.ADMIN_EMAILS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return admins.includes(String(email || "").trim().toLowerCase());
}

function stripTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 47) end -= 1;
  return value.slice(0, end);
}

function getSiteBaseUrl(env) {
  const configured = stripTrailingSlashes(String(env.SITE_BASE_URL || "").trim());
  if (configured) return configured;

  const firstAllowedOrigin = stripTrailingSlashes(
    String(env.ALLOWED_ORIGIN || "").split(",")[0].trim()
  );

  return firstAllowedOrigin || "https://hackinbrasil.com.br";
}

function isEventPast(eventDate) {
  const time = Date.parse(String(eventDate || ""));
  if (!Number.isFinite(time)) return false;
  return Date.now() > time;
}

const DISPOSABLE_EMAIL_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.info",
  "sharklasers.com",
  "grr.la",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "tempmail.net",
  "tempmailo.com",
  "yopmail.com",
  "yopmail.net",
  "throwawaymail.com",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "trashmail.com",
  "trashmail.de",
  "fakeinbox.com",
  "maildrop.cc",
  "mailnesia.com",
  "mohmal.com",
  "moakt.com",
  "emailondeck.com",
  "mailcatch.com",
  "spam4.me",
  "tmail.ws",
  "burnermail.io",
  "mytemp.email",
  "tempmailaddress.com"
]);

function isDisposableEmail(email) {
  const atIndex = String(email || "").lastIndexOf("@");
  if (atIndex < 0) return false;
  const domain = email.slice(atIndex + 1).toLowerCase();
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  for (const blocked of DISPOSABLE_EMAIL_DOMAINS) {
    if (domain.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

async function queueConfirmationEmail(env, payload) {
  await env.DB
    .prepare(
      "INSERT INTO email_jobs (meetup_slug, template_id, registration_id, recipient_name, recipient_email, subject, html_body, text_body, send_after, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?), 'pending')"
    )
    .bind(
      payload.meetupSlug,
      payload.templateId,
      payload.registrationId,
      payload.recipientName,
      payload.recipientEmail,
      payload.subject,
      payload.html,
      payload.text,
      `+${payload.delayMinutes} minutes`
    )
    .run();
}

function sanitizeHeaderValue(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u001F\u007F]+/g, " ")
    .trim();
}

async function sendEmailWithResend(env, job) {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY secret is required");
  }
  if (!env.RESEND_FROM_EMAIL) {
    throw new Error("RESEND_FROM_EMAIL variable is required");
  }

  const body = {
    from: env.RESEND_FROM_EMAIL,
    to: [sanitizeHeaderValue(job.recipient_email)],
    subject: sanitizeHeaderValue(job.subject),
    html: job.html_body,
    text: job.text_body
  };

  const replyTo = job.reply_to || env.RESEND_REPLY_TO;
  if (replyTo) {
    body.reply_to = sanitizeHeaderValue(replyTo);
  }

  if (Array.isArray(job.attachments) && job.attachments.length > 0) {
    body.attachments = job.attachments;
  }

  const headers = {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    "content-type": "application/json"
  };

  if (job.id) {
    headers["Idempotency-Key"] = `job-${job.id}`;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.message || payload.error || `Resend request failed with status ${response.status}`;
    throw new Error(message);
  }

  try {
    await env.DB
      .prepare("INSERT INTO email_sends (kind) VALUES (?)")
      .bind(String(job.kind || "transactional"))
      .run();
  } catch (error) {
    console.error("[email:ledger]", error);
  }

  return String(payload.id || "");
}

async function markEmailAsSent(env, jobId, resendEmailId) {
  await env.DB
    .prepare(
      "UPDATE email_jobs SET status = 'sent', resend_email_id = ?, sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
    )
    .bind(resendEmailId, jobId)
    .run();
}

async function markEmailAsRetry(env, jobId, errorText) {
  await env.DB
    .prepare(
      "UPDATE email_jobs SET status = 'pending', send_after = datetime('now', '+10 minutes'), updated_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?"
    )
    .bind(errorText, jobId)
    .run();
}

async function markEmailAsFailed(env, jobId, errorText) {
  await env.DB
    .prepare(
      "UPDATE email_jobs SET status = 'failed', updated_at = CURRENT_TIMESTAMP, last_error = ? WHERE id = ?"
    )
    .bind(errorText, jobId)
    .run();
}

const DEFAULT_DAILY_EMAIL_CAP = 100;
const MAX_CAP_RETRIES = 3;
const MAX_EMAIL_ATTEMPTS = 5;
const DEFAULT_NOTIFY_EMAIL_CAP = 20;

function notifyEmailCap(env) {
  const configured = Number(env.NOTIFY_EMAIL_DAILY_CAP);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_NOTIFY_EMAIL_CAP;
  return Math.floor(configured);
}

async function notifyBudgetLeft(env, kind) {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS total FROM email_sends WHERE kind = ? AND date(sent_at) = date('now')")
    .bind(kind)
    .first();
  return notifyEmailCap(env) - Number(row?.total || 0);
}
const STALLED_JOB_MINUTES = 15;

function dailyEmailCap(env) {
  const configured = Number(env.DAILY_EMAIL_CAP);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_DAILY_EMAIL_CAP;
  return Math.floor(configured);
}

const REMINDER_LEAD_DAYS = 5;
const REMINDER_SEND_HOUR_UTC = 12;
const REMINDER_BATCH_LIMIT = 200;

async function deferJobsOverDailyCap(env) {
  await env.DB
    .prepare(
      "UPDATE email_jobs SET send_after = datetime('now', '+1 day', 'start of day', '+11 hours'), cap_retries = cap_retries + 1, updated_at = CURRENT_TIMESTAMP, last_error = 'Limite diário de e-mails atingido; reagendado para o dia seguinte' WHERE status = 'pending' AND send_after <= CURRENT_TIMESTAMP AND cap_retries < ?"
    )
    .bind(MAX_CAP_RETRIES)
    .run();

  await env.DB
    .prepare(
      "UPDATE email_jobs SET status = 'failed', updated_at = CURRENT_TIMESTAMP, last_error = 'Limite diário de e-mails atingido em todos os reagendamentos' WHERE status = 'pending' AND send_after <= CURRENT_TIMESTAMP AND cap_retries >= ?"
    )
    .bind(MAX_CAP_RETRIES)
    .run();
}

async function requeueStalledEmailJobs(env) {
  await env.DB
    .prepare(
      `UPDATE email_jobs
       SET status = 'pending',
           updated_at = CURRENT_TIMESTAMP,
           last_error = 'Envio interrompido antes de terminar; recolocado na fila'
       WHERE status = 'processing'
         AND updated_at <= datetime('now', ?)
         AND attempts < ?`
    )
    .bind(`-${STALLED_JOB_MINUTES} minutes`, MAX_EMAIL_ATTEMPTS)
    .run();

  await env.DB
    .prepare(
      `UPDATE email_jobs
       SET status = 'failed',
           updated_at = CURRENT_TIMESTAMP,
           last_error = 'Envio interrompido e tentativas esgotadas'
       WHERE status = 'processing'
         AND updated_at <= datetime('now', ?)
         AND attempts >= ?`
    )
    .bind(`-${STALLED_JOB_MINUTES} minutes`, MAX_EMAIL_ATTEMPTS)
    .run();
}

async function processPendingEmailJobs(env, limit = 20) {
  await requeueStalledEmailJobs(env);

  const sentTodayRow = await env.DB
    .prepare("SELECT COUNT(*) AS total FROM email_sends WHERE date(sent_at) = date('now')")
    .first();

  const sentToday = Number(sentTodayRow?.total || 0);
  const remainingForToday = dailyEmailCap(env) - sentToday;
  if (remainingForToday <= 0) {
    await deferJobsOverDailyCap(env);
    return;
  }

  const maxBatchSize = Math.min(limit, remainingForToday);
  const pending = await env.DB
    .prepare(
      "SELECT id, kind, meetup_slug, certificate_code, recipient_name, recipient_email, subject, html_body, text_body, attempts FROM email_jobs WHERE status = 'pending' AND send_after <= CURRENT_TIMESTAMP ORDER BY id ASC LIMIT ?"
    )
    .bind(maxBatchSize)
    .all();

  const rows = Array.isArray(pending.results) ? pending.results : [];

  for (const job of rows) {
    const lock = await env.DB
      .prepare(
        "UPDATE email_jobs SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending' AND send_after <= CURRENT_TIMESTAMP"
      )
      .bind(job.id)
      .run();

    if (!lock.meta || lock.meta.changes !== 1) {
      continue;
    }

    const currentAttempt = Number(job.attempts || 0) + 1;

    try {
      if (job.kind === "certificate") {
        job.attachments = await buildCertificateAttachment(env, job.certificate_code);
      }

      const resendEmailId = await sendEmailWithResend(env, job);
      await markEmailAsSent(env, job.id, resendEmailId);
    } catch (error) {
      const errorText = truncateError(error?.message || error || "Unknown email sending failure");
      if (currentAttempt >= MAX_EMAIL_ATTEMPTS) {
        await markEmailAsFailed(env, job.id, errorText);
      }
      if (currentAttempt < MAX_EMAIL_ATTEMPTS) {
        await markEmailAsRetry(env, job.id, errorText);
      }
    }
  }
}

function toSqlTimestamp(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ");
}

function reminderWindowOpensAt(eventDate) {
  const start = Date.parse(String(eventDate || ""));
  if (!Number.isFinite(start)) return null;

  const day = new Date(start - REMINDER_LEAD_DAYS * 24 * 60 * 60 * 1000);
  return Date.UTC(
    day.getUTCFullYear(),
    day.getUTCMonth(),
    day.getUTCDate(),
    REMINDER_SEND_HOUR_UTC
  );
}

function reminderSendSlots(eventDate, nowMs) {
  const start = Date.parse(String(eventDate || ""));
  if (!Number.isFinite(start)) return [];

  const upcoming = [];
  for (let daysBefore = REMINDER_LEAD_DAYS; daysBefore >= 1; daysBefore -= 1) {
    const day = new Date(start - daysBefore * 24 * 60 * 60 * 1000);
    const slot = Date.UTC(
      day.getUTCFullYear(),
      day.getUTCMonth(),
      day.getUTCDate(),
      REMINDER_SEND_HOUR_UTC
    );
    if (slot > nowMs) upcoming.push(slot);
  }

  return [nowMs, ...upcoming];
}

async function getReminderTemplate(db, slug) {
  return db
    .prepare("SELECT subject, text_body, html_body FROM reminder_templates WHERE meetup_slug = ?")
    .bind(slug)
    .first();
}

function buildDefaultReminderEmail(env, meetup) {
  const baseUrl = getSiteBaseUrl(env);
  const pageUrl = `${baseUrl}/${meetup.slug}/`;
  const cancelUrl = `${baseUrl}/minhas-inscricoes/`;
  const weekday = formatWeekday(meetup.event_date);
  const date = formatMeetupDate(meetup.event_date);
  const time = formatMeetupTime(meetup.event_date);
  const title = String(meetup.title || "meetup do Hack in Brasil");
  const when = weekday ? `${weekday}, ${date}` : date;

  const subject = `Lembrete: ${title}`;

  const text_body = [
    "Olá,",
    "",
    `Passando para lembrar que o ${title} está chegando e que sua inscrição está confirmada.`,
    "",
    `Data: ${when}`,
    time ? `Horário: a partir das ${time}` : "",
    "",
    "Agenda, endereço e como chegar estão na página da edição:",
    pageUrl,
    "",
    "Não vai conseguir ir?",
    "As vagas são limitadas e a sua está reservada. Se você já sabe que não vai, cancele a inscrição para que outra pessoa da comunidade possa ocupar o lugar.",
    "",
    `Para cancelar, acesse ${cancelUrl} e peça o link de acesso com o seu e-mail. Não tem senha: o link chega na sua caixa de entrada e abre a sua inscrição.`,
    "",
    "Se você vai, não precisa fazer nada. Nos vemos lá!",
    "",
    "Abraços,",
    "Equipe Hack in Brasil"
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");

  const html_body =
    "<p>Olá,</p>" +
    `<p>Passando para lembrar que o <strong>${escapeHtml(title)}</strong> está chegando e que sua inscrição está confirmada.</p>` +
    `<p><strong>Data:</strong> ${escapeHtml(when)}` +
    (time ? `<br><strong>Horário:</strong> a partir das ${escapeHtml(time)}` : "") +
    "</p>" +
    `<p>Agenda, endereço e como chegar estão na <a href="${escapeHtml(pageUrl)}">página da edição</a>.</p>` +
    "<h3>Não vai conseguir ir?</h3>" +
    "<p>As vagas são limitadas e a sua está reservada. Se você já sabe que não vai, cancele a inscrição para que outra pessoa da comunidade possa ocupar o lugar.</p>" +
    `<p>Para cancelar, acesse <a href="${escapeHtml(cancelUrl)}">${escapeHtml(cancelUrl)}</a> e peça o link de acesso com o seu e-mail. Não tem senha: o link chega na sua caixa de entrada e abre a sua inscrição.</p>` +
    "<p>Se você vai, não precisa fazer nada. Nos vemos lá!</p>" +
    "<p>Abraços,<br>Equipe Hack in Brasil</p>";

  return {subject, text_body, html_body};
}

async function queueDueReminders(env) {
  const meetups = await env.DB
    .prepare("SELECT slug, title, event_date FROM meetups")
    .all();

  const rows = Array.isArray(meetups.results) ? meetups.results : [];
  const now = Date.now();

  for (const meetup of rows) {
    const opensAt = reminderWindowOpensAt(meetup.event_date);
    if (opensAt === null || now < opensAt) continue;
    if (isEventPast(meetup.event_date)) continue;

    const pending = await env.DB
      .prepare(
        "SELECT id, name, email, created_at FROM registrations r WHERE r.meetup_slug = ? AND NOT EXISTS (SELECT 1 FROM email_jobs j WHERE j.registration_id = r.id AND j.kind = 'reminder') ORDER BY r.id ASC LIMIT ?"
      )
      .bind(meetup.slug, REMINDER_BATCH_LIMIT)
      .all();

    const registrations = Array.isArray(pending.results) ? pending.results : [];
    if (registrations.length === 0) continue;

    const template =
      (await getReminderTemplate(env.DB, meetup.slug)) || buildDefaultReminderEmail(env, meetup);
    const slots = reminderSendSlots(meetup.event_date, now);
    const lastSlotIndex = slots.length - 1;

    const earlyAlreadyQueued = await env.DB
      .prepare(
        "SELECT COUNT(*) AS total FROM email_jobs j JOIN registrations r ON r.id = j.registration_id WHERE j.meetup_slug = ? AND j.kind = 'reminder' AND r.created_at < ?"
      )
      .bind(meetup.slug, toSqlTimestamp(opensAt))
      .first();
    let rotatingIndex = Number(earlyAlreadyQueued?.total || 0);

    await env.DB.batch(
      registrations.map((registration) => {
        const registeredAt = Date.parse(`${String(registration.created_at).replace(" ", "T")}Z`);
        const isLateJoiner = !Number.isFinite(registeredAt) || registeredAt >= opensAt;

        let slotIndex;
        if (isLateJoiner) {
          slotIndex = lastSlotIndex;
        } else {
          slotIndex = rotatingIndex % slots.length;
          rotatingIndex += 1;
        }

        return env.DB
          .prepare(
            "INSERT OR IGNORE INTO email_jobs (kind, meetup_slug, registration_id, recipient_name, recipient_email, subject, text_body, html_body, send_after, status) VALUES ('reminder', ?, ?, ?, ?, ?, ?, ?, ?, 'pending')"
          )
          .bind(
            meetup.slug,
            registration.id,
            registration.name,
            registration.email,
            template.subject,
            template.text_body,
            template.html_body,
            toSqlTimestamp(slots[slotIndex])
          );
      })
    );
  }
}


function randomHex(byteLength) {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return Array.from(buf, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomIndexBelow(count) {
  const limit = Math.floor(0x100000000 / count) * count;
  const buf = new Uint32Array(1);
  let value;
  do {
    crypto.getRandomValues(buf);
    value = buf[0];
  } while (value >= limit);
  return value % count;
}

const POW_DIFFICULTY_BITS = 10;
const POW_CHALLENGE_TTL_MINUTES = 5;
const DEFAULT_POW_MIN_SOLVE_SECONDS = 1;

function powMinSolveSeconds(env) {
  const configured = Number(env.POW_MIN_SOLVE_SECONDS);
  if (!Number.isFinite(configured) || configured < 0) return DEFAULT_POW_MIN_SOLVE_SECONDS;
  return Math.floor(configured);
}

function powLeadingZeroBits(bytes) {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    for (let bit = 7; bit >= 0; bit -= 1) {
      if ((byte >> bit) & 1) return count;
      count += 1;
    }
  }
  return count;
}

async function powSatisfies(seed, nonce, difficulty) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${seed}:${nonce}`));
  return powLeadingZeroBits(new Uint8Array(digest)) >= difficulty;
}

async function handleCaptchaIssue(env, corsOrigin) {
  const id = crypto.randomUUID();
  const seed = randomHex(16);

  try {
    await env.DB
      .prepare(
        `INSERT INTO captcha_challenges (id, seed, difficulty, expires_at) VALUES (?, ?, ?, datetime('now', '+${POW_CHALLENGE_TTL_MINUTES} minutes'))`
      )
      .bind(id, seed, POW_DIFFICULTY_BITS)
      .run();
  } catch (err) {
    return serverError(corsOrigin, "captcha:issue", err);
  }

  return json({id, seed, difficulty: POW_DIFFICULTY_BITS}, 200, corsOrigin);
}

async function consumeCaptcha(env, id, nonce) {
  if (typeof id !== "string" || !id) return false;
  if (!Number.isSafeInteger(nonce) || nonce < 0) return false;

  let consumed;
  try {
    consumed = await env.DB
      .prepare(
        `UPDATE captcha_challenges SET consumed = 1 WHERE id = ? AND consumed = 0 AND expires_at > CURRENT_TIMESTAMP AND created_at <= datetime('now', ?)`
      )
      .bind(id, `-${powMinSolveSeconds(env)} seconds`)
      .run();
  } catch {
    return false;
  }

  if (!consumed.meta || consumed.meta.changes !== 1) return false;

  const row = await env.DB
    .prepare("SELECT seed, difficulty FROM captcha_challenges WHERE id = ?")
    .bind(id)
    .first();

  if (!row) return false;

  return powSatisfies(String(row.seed), nonce, Number(row.difficulty));
}

const MAGIC_LINK_TTL_MINUTES = 15;
const MAGIC_LINK_WINDOW_MINUTES = 15;
const MAGIC_LINK_MAX_PER_WINDOW = 3;
const SESSION_TTL_MINUTES = 30;
const CANCEL_CONFIRMATION_WORD = "CANCELAR";
const RESET_CONFIRMATION_WORD = "RESETAR";
const DRAW_MAX_ATTEMPTS = 5;
const CERTIFICATE_DELAY_HOURS = 24;
const CERTIFICATE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const RANKING_LIMIT = 100;
const NICKNAME_MIN_LENGTH = 3;
const NICKNAME_MAX_LENGTH = 24;
const RESERVED_NICKNAMES = [
  "hackinbrasil",
  "organizador",
  "organizacao",
  "moderador",
  "admin",
  "oficial",
  "staff"
];

const GENERIC_MAGIC_LINK_MESSAGE =
  "Se houver inscrições vinculadas a este e-mail, enviamos um link de acesso. O link vale por 15 minutos e só pode ser usado uma vez.";

function normalizeConfirmation(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function formatMeetupDate(eventDate) {
  const time = Date.parse(String(eventDate || ""));
  if (!Number.isFinite(time)) return String(eventDate || "");
  return new Date(time).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatLongDate(eventDate) {
  const time = Date.parse(String(eventDate || ""));
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "numeric",
    month: "long",
    year: "numeric"
  });
}

function formatWeekday(eventDate) {
  const time = Date.parse(String(eventDate || ""));
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleDateString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long"
  });
}

function formatMeetupTime(eventDate) {
  const time = Date.parse(String(eventDate || ""));
  if (!Number.isFinite(time)) return "";
  return new Date(time).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatDuration(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const parts = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
  if (rest > 0) parts.push(`${rest} ${rest === 1 ? "minuto" : "minutos"}`);
  return parts.join(" e ");
}

function buildMagicLinkEmail(link) {
  const safeLink = escapeHtml(link);

  const subject = "Acesso às suas inscrições — Hack in Brasil";

  const textBody = [
    "Olá,",
    "",
    "Recebemos um pedido de acesso à área de inscrições do Hack in Brasil.",
    "Abra o link abaixo para ver e gerenciar suas inscrições:",
    "",
    link,
    "",
    `O link expira em ${MAGIC_LINK_TTL_MINUTES} minutos e só pode ser usado uma vez.`,
    "Se não foi você quem pediu, ignore este e-mail: nenhuma ação será tomada.",
    "",
    "Abraços,",
    "Equipe Hack in Brasil"
  ].join("\n");

  const htmlBody =
    "<p>Olá,</p>" +
    "<p>Recebemos um pedido de acesso à área de inscrições do Hack in Brasil.</p>" +
    `<p><a href="${safeLink}">Ver e gerenciar minhas inscrições</a></p>` +
    `<p style="color:#666;font-size:13px;word-break:break-all;">Se o botão não funcionar, copie este endereço no navegador:<br>${safeLink}</p>` +
    `<p>O link expira em ${MAGIC_LINK_TTL_MINUTES} minutos e só pode ser usado uma vez.</p>` +
    "<p>Se não foi você quem pediu, ignore este e-mail: nenhuma ação será tomada.</p>" +
    "<p>Abraços,<br>Equipe Hack in Brasil</p>";

  return {subject, textBody, htmlBody};
}

function buildCancellationEmail(meetupTitle, eventDate) {
  const formattedDate = formatMeetupDate(eventDate);
  const subject = `Inscrição cancelada — ${meetupTitle}`;

  const textBody = [
    "Olá,",
    "",
    `Sua inscrição no meetup "${meetupTitle}" (${formattedDate}) foi cancelada e a vaga foi liberada.`,
    "",
    "Se o cancelamento não foi feito por você, escreva para contato@hackinbrasil.com.br.",
    "Você pode se inscrever novamente enquanto houver vagas abertas.",
    "",
    "Abraços,",
    "Equipe Hack in Brasil"
  ].join("\n");

  const htmlBody =
    "<p>Olá,</p>" +
    `<p>Sua inscrição no meetup <strong>${escapeHtml(meetupTitle)}</strong> (${escapeHtml(
      formattedDate
    )}) foi cancelada e a vaga foi liberada.</p>` +
    "<p>Se o cancelamento não foi feito por você, escreva para contato@hackinbrasil.com.br.</p>" +
    "<p>Você pode se inscrever novamente enquanto houver vagas abertas.</p>" +
    "<p>Abraços,<br>Equipe Hack in Brasil</p>";

  return {subject, textBody, htmlBody};
}

async function handleMagicLinkRequest(request, env, corsOrigin, ctx) {
  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const email = String(body.email || "").trim().toLowerCase();
  const captchaId = String(body.captchaId || "");
  const captchaValue = Number(body.captcha);

  if (!isValidEmail(email)) {
    return json({error: "E-mail inválido"}, 400, corsOrigin);
  }
  if (!captchaId || !Number.isFinite(captchaValue)) {
    return json({error: "Verificação obrigatória"}, 400, corsOrigin);
  }
  if (!(await consumeCaptcha(env, captchaId, captchaValue))) {
    return json({error: "Verificação inválida ou expirada. Tente novamente."}, 400, corsOrigin);
  }

  let emailHash;
  try {
    emailHash = await blindIndex("login", email, env);
  } catch (err) {
    return serverError(corsOrigin, "auth:blindIndex", err);
  }

  try {
    const recentRequests = await env.DB
      .prepare(
        "SELECT COUNT(*) AS total FROM auth_login_requests WHERE email_hash = ? AND created_at > datetime('now', ?)"
      )
      .bind(emailHash, `-${MAGIC_LINK_WINDOW_MINUTES} minutes`)
      .first();

    if (Number(recentRequests?.total || 0) >= MAGIC_LINK_MAX_PER_WINDOW) {
      return json(
        {
          error: `Muitas solicitações de acesso. Aguarde ${MAGIC_LINK_WINDOW_MINUTES} minutos e tente novamente.`
        },
        429,
        corsOrigin
      );
    }

    const hasRegistration =
      Number(
        (await env.DB
          .prepare("SELECT COUNT(*) AS total FROM registrations WHERE email = ?")
          .bind(email)
          .first())?.total || 0
      ) > 0;
    const authorized = hasRegistration || isAdminEmail(email, env);

    if (!authorized) {
      await env.DB
        .prepare("INSERT INTO auth_login_requests (email_hash) VALUES (?)")
        .bind(emailHash)
        .run();
      return json({ok: true, message: GENERIC_MAGIC_LINK_MESSAGE}, 200, corsOrigin);
    }

    const token = generateOpaqueToken();
    const tokenHash = await hashToken(token);

    await env.DB
      .prepare(
        "INSERT INTO auth_login_requests (email_hash, email, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', ?))"
      )
      .bind(emailHash, email, tokenHash, `+${MAGIC_LINK_TTL_MINUTES} minutes`)
      .run();

    const link = `${getSiteBaseUrl(env)}/minhas-inscricoes/?token=${encodeURIComponent(token)}`;
    const message = buildMagicLinkEmail(link);

    runInBackground(ctx, () =>
      sendEmailWithResend(env, {
        recipient_email: email,
        subject: message.subject,
        html_body: message.htmlBody,
        text_body: message.textBody
      })
    );
  } catch (err) {
    return serverError(corsOrigin, "auth:magicLink", err);
  }

  return json({ok: true, message: GENERIC_MAGIC_LINK_MESSAGE}, 200, corsOrigin);
}

async function handleSessionCreate(request, env, corsOrigin) {
  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;

  const token = String(parsed.body.token || "").trim();
  const invalidTokenResponse = json(
    {error: "Link de acesso inválido ou expirado. Solicite um novo."},
    401,
    corsOrigin
  );

  if (!isOpaqueToken(token)) return invalidTokenResponse;

  try {
    const tokenHash = await hashToken(token);

    const consumed = await env.DB
      .prepare(
        "UPDATE auth_login_requests SET consumed = 1 WHERE token_hash = ? AND consumed = 0 AND expires_at > CURRENT_TIMESTAMP"
      )
      .bind(tokenHash)
      .run();

    if (!consumed.meta || consumed.meta.changes !== 1) return invalidTokenResponse;

    const loginRequest = await env.DB
      .prepare("SELECT email FROM auth_login_requests WHERE token_hash = ?")
      .bind(tokenHash)
      .first();

    if (!loginRequest?.email) return invalidTokenResponse;

    const sessionToken = generateOpaqueToken();
    const sessionHash = await hashToken(sessionToken);

    await env.DB
      .prepare(
        "INSERT INTO auth_sessions (email, token_hash, expires_at) VALUES (?, ?, datetime('now', ?))"
      )
      .bind(loginRequest.email, sessionHash, `+${SESSION_TTL_MINUTES} minutes`)
      .run();

    return json(
      {
        ok: true,
        token: sessionToken,
        email: loginRequest.email,
        expiresInMinutes: SESSION_TTL_MINUTES
      },
      200,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "auth:session", err);
  }
}

function getBearerToken(request) {
  const header = request.headers.get("Authorization") || "";
  const match = header.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  return isOpaqueToken(match[1]) ? match[1] : null;
}

async function getSession(request, env) {
  const token = getBearerToken(request);
  if (!token) return null;

  const tokenHash = await hashToken(token);
  const session = await env.DB
    .prepare(
      "SELECT id, email FROM auth_sessions WHERE token_hash = ? AND revoked = 0 AND expires_at > CURRENT_TIMESTAMP"
    )
    .bind(tokenHash)
    .first();

  return session || null;
}

async function withSession(request, env, corsOrigin, handler) {
  let session;
  try {
    session = await getSession(request, env);
  } catch (err) {
    return serverError(corsOrigin, "auth:getSession", err);
  }

  if (!session) {
    return json(
      {error: "Sessão expirada ou inválida. Solicite um novo link de acesso."},
      401,
      corsOrigin
    );
  }

  return handler(session);
}

async function handleMyRegistrations(env, session, corsOrigin) {
  let rows;
  try {
    rows = await env.DB
      .prepare(
        "SELECT r.meetup_slug, r.name, r.created_at, r.checked_in_at, m.title, m.event_date, m.duration_minutes, m.xp_reward, c.code AS certificate_code FROM registrations r JOIN meetups m ON m.slug = r.meetup_slug LEFT JOIN certificates c ON c.registration_id = r.id WHERE r.email = ? ORDER BY m.event_date DESC"
      )
      .bind(session.email)
      .all();
  } catch (err) {
    return serverError(corsOrigin, "me:registrations", err);
  }

  const registrations = (Array.isArray(rows.results) ? rows.results : []).map((row) => {
    const past = isEventPast(row.event_date);
    const availableAt = certificateAvailableAt(row);
    return {
      meetupSlug: row.meetup_slug,
      title: row.title,
      eventDate: row.event_date,
      durationMinutes: Number(row.duration_minutes),
      name: row.name,
      registeredAt: row.created_at,
      isPast: past,
      canCancel: !past,
      xpReward: Number(row.xp_reward || 0),
      xpEarned: past ? Number(row.xp_reward || 0) : 0,
      checkedInAt: row.checked_in_at || null,
      certificate: {
        available: isCertificateAvailable(availableAt) && !!row.checked_in_at,
        availableAt,
        code: row.certificate_code || null
      }
    };
  });

  registrations.sort((a, b) => {
    if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
    const aTime = Date.parse(a.eventDate) || 0;
    const bTime = Date.parse(b.eventDate) || 0;
    return a.isPast ? bTime - aTime : aTime - bTime;
  });

  let profile;
  try {
    profile = await getParticipantProfile(env, session.email);
  } catch (err) {
    return serverError(corsOrigin, "me:profile", err);
  }

  return json(
    {
      email: session.email,
      confirmationWord: CANCEL_CONFIRMATION_WORD,
      profile,
      registrations
    },
    200,
    corsOrigin
  );
}

async function handleCancelRegistration(request, env, session, slug, corsOrigin, ctx) {
  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;

  if (normalizeConfirmation(parsed.body.confirmation) !== CANCEL_CONFIRMATION_WORD) {
    return json(
      {error: `Digite ${CANCEL_CONFIRMATION_WORD} para confirmar o cancelamento.`},
      400,
      corsOrigin
    );
  }

  try {
    const registration = await env.DB
      .prepare("SELECT id FROM registrations WHERE meetup_slug = ? AND email = ?")
      .bind(slug, session.email)
      .first();

    if (!registration) {
      return json({error: "Inscrição não encontrada"}, 404, corsOrigin);
    }

    const meetup = await getMeetupBySlug(env.DB, slug);
    if (!meetup) {
      return json({error: "Meetup not found"}, 404, corsOrigin);
    }
    if (isEventPast(meetup.event_date)) {
      return json(
        {error: "Este meetup já aconteceu, então a inscrição não pode mais ser cancelada."},
        409,
        corsOrigin
      );
    }

    await env.DB.batch([
      env.DB
        .prepare("DELETE FROM email_jobs WHERE registration_id = ? AND status IN ('pending', 'processing')")
        .bind(registration.id),
      env.DB
        .prepare("DELETE FROM registrations WHERE id = ? AND meetup_slug = ? AND email = ?")
        .bind(registration.id, slug, session.email),
      env.DB
        .prepare(
          "UPDATE meetups SET registrations_count = (SELECT COUNT(*) FROM registrations WHERE meetup_slug = ?), updated_at = CURRENT_TIMESTAMP WHERE slug = ?"
        )
        .bind(slug, slug),
      env.DB
        .prepare("INSERT INTO registration_cancellations (meetup_slug) VALUES (?)")
        .bind(slug)
    ]);

    const notice = buildCancellationEmail(String(meetup.title), meetup.event_date);
    runInBackground(ctx, () =>
      sendEmailWithResend(env, {
        recipient_email: session.email,
        subject: notice.subject,
        html_body: notice.htmlBody,
        text_body: notice.textBody
      })
    );

    return json(
      {ok: true, message: "Inscrição cancelada. A vaga foi liberada para outra pessoa."},
      200,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "me:cancel", err);
  }
}

function certificateAvailableAt(meetup) {
  const start = Date.parse(String(meetup?.event_date || ""));
  if (!Number.isFinite(start)) return null;
  const durationMs = Number(meetup?.duration_minutes || 0) * 60 * 1000;
  return new Date(start + durationMs + CERTIFICATE_DELAY_HOURS * 60 * 60 * 1000).toISOString();
}

function isCertificateAvailable(availableAt) {
  if (!availableAt) return false;
  const time = Date.parse(availableAt);
  return Number.isFinite(time) && Date.now() >= time;
}

function generateCertificateCode() {
  const alphabetLength = CERTIFICATE_CODE_ALPHABET.length;
  const maxUnbiased = Math.floor(256 / alphabetLength) * alphabetLength;
  let chars = "";

  while (chars.length < 12) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte >= maxUnbiased) continue;
      chars += CERTIFICATE_CODE_ALPHABET[byte % alphabetLength];
      if (chars.length === 12) break;
    }
  }

  return `HIB-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}

function isCertificateCode(value) {
  return /^HIB-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(value);
}

function generateCheckinCode() {
  return `chk_${randomHex(16)}`;
}

async function handleGetCheckinCode(env, session, slug, corsOrigin) {
  try {
    const registration = await env.DB
      .prepare("SELECT id, checkin_code, checked_in_at FROM registrations WHERE meetup_slug = ? AND email = ?")
      .bind(slug, session.email)
      .first();

    if (!registration) {
      return json({error: "Inscrição não encontrada"}, 404, corsOrigin);
    }

    if (registration.checkin_code) {
      return json(
        {code: registration.checkin_code, checkedIn: !!registration.checked_in_at},
        200,
        corsOrigin
      );
    }

    await env.DB
      .prepare("UPDATE registrations SET checkin_code = ? WHERE id = ? AND checkin_code IS NULL")
      .bind(generateCheckinCode(), registration.id)
      .run();

    const updated = await env.DB
      .prepare("SELECT checkin_code, checked_in_at FROM registrations WHERE id = ?")
      .bind(registration.id)
      .first();

    if (!updated?.checkin_code) {
      return serverError(corsOrigin, "me:checkinCode", new Error("checkin_code missing right after insert"));
    }

    return json(
      {code: updated.checkin_code, checkedIn: !!updated.checked_in_at},
      200,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "me:checkinCode", err);
  }
}

async function handleAdminStatus(env, session, corsOrigin) {
  return json({isAdmin: isAdminEmail(session.email, env)}, 200, corsOrigin);
}

async function handleAdminCheckin(request, env, session, corsOrigin) {
  if (!isAdminEmail(session.email, env)) {
    return json({error: "Acesso restrito à organização."}, 403, corsOrigin);
  }

  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;

  const code = String(parsed.body.code || "").trim();
  if (!code) {
    return json({error: "Código de check-in inválido"}, 400, corsOrigin);
  }

  try {
    const registration = await env.DB
      .prepare(
        "SELECT r.id, r.name, r.checked_in_at, m.title FROM registrations r JOIN meetups m ON m.slug = r.meetup_slug WHERE r.checkin_code = ?"
      )
      .bind(code)
      .first();

    if (!registration) {
      return json({error: "Código não encontrado. Confira se é o QR certo."}, 404, corsOrigin);
    }

    const alreadyCheckedIn = !!registration.checked_in_at;

    if (!alreadyCheckedIn) {
      await env.DB
        .prepare("UPDATE registrations SET checked_in_at = CURRENT_TIMESTAMP WHERE id = ? AND checked_in_at IS NULL")
        .bind(registration.id)
        .run();
    }

    return json(
      {
        ok: true,
        alreadyCheckedIn,
        name: registration.name,
        meetupTitle: registration.title
      },
      200,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "admin:checkin", err);
  }
}

async function handleAdminMeetupList(env, session, corsOrigin) {
  if (!isAdminEmail(session.email, env)) {
    return json({error: "Acesso restrito à organização."}, 403, corsOrigin);
  }

  try {
    const rows = await env.DB
      .prepare("SELECT slug, title, event_date FROM meetups ORDER BY event_date DESC")
      .all();

    return json(
      {
        meetups: (rows.results || []).map((row) => ({
          slug: row.slug,
          title: row.title,
          eventDate: row.event_date
        }))
      },
      200,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "admin:meetupList", err);
  }
}

async function loadDuckRaceEligible(env, slug) {
  const rows = await env.DB
    .prepare(
      `SELECT id, name FROM registrations
       WHERE meetup_slug = ? AND checked_in_at IS NOT NULL
         AND id NOT IN (SELECT registration_id FROM raffle_winners WHERE meetup_slug = ?)
       ORDER BY id`
    )
    .bind(slug, slug)
    .all();
  return rows.results || [];
}

async function handleDuckRaceState(env, session, slug, corsOrigin) {
  if (!isAdminEmail(session.email, env)) {
    return json({error: "Acesso restrito à organização."}, 403, corsOrigin);
  }

  try {
    const ducks = await loadDuckRaceEligible(env, slug);
    const winnerRows = await env.DB
      .prepare(
        "SELECT registration_id, name, won_at FROM raffle_winners WHERE meetup_slug = ? ORDER BY won_at ASC"
      )
      .bind(slug)
      .all();

    return json(
      {
        ducks: ducks.map((row) => ({id: row.id, name: row.name})),
        winners: (winnerRows.results || []).map((row) => ({
          id: row.registration_id,
          name: row.name,
          wonAt: row.won_at
        }))
      },
      200,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "admin:duckRaceState", err);
  }
}

async function handleDuckRaceDraw(env, session, slug, corsOrigin) {
  if (!isAdminEmail(session.email, env)) {
    return json({error: "Acesso restrito à organização."}, 403, corsOrigin);
  }

  try {
    for (let attempt = 0; attempt < DRAW_MAX_ATTEMPTS; attempt += 1) {
      const ducks = await loadDuckRaceEligible(env, slug);
      if (ducks.length === 0) {
        return json({error: "Não há participantes elegíveis para a corrida."}, 409, corsOrigin);
      }

      const winner = ducks[randomIndexBelow(ducks.length)];

      const claimed = await env.DB
        .prepare(
          `INSERT INTO raffle_winners (meetup_slug, registration_id, name)
           SELECT r.meetup_slug, r.id, r.name FROM registrations r
           WHERE r.id = ? AND r.meetup_slug = ? AND r.checked_in_at IS NOT NULL
             AND NOT EXISTS (
               SELECT 1 FROM raffle_winners w
               WHERE w.meetup_slug = r.meetup_slug AND w.registration_id = r.id
             )`
        )
        .bind(winner.id, slug)
        .run();

      if (claimed.meta && claimed.meta.changes === 1) {
        return json({winner: {id: winner.id, name: winner.name}}, 200, corsOrigin);
      }
    }

    return json(
      {error: "Outro sorteio aconteceu ao mesmo tempo. Tente novamente."},
      409,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "admin:duckRaceDraw", err);
  }
}

async function handleDuckRaceReset(request, env, session, slug, corsOrigin) {
  if (!isAdminEmail(session.email, env)) {
    return json({error: "Acesso restrito à organização."}, 403, corsOrigin);
  }

  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;

  if (normalizeConfirmation(parsed.body.confirmation) !== RESET_CONFIRMATION_WORD) {
    return json(
      {error: `Digite ${RESET_CONFIRMATION_WORD} para confirmar o reset do sorteio.`},
      400,
      corsOrigin
    );
  }

  try {
    const result = await env.DB
      .prepare("DELETE FROM raffle_winners WHERE meetup_slug = ?")
      .bind(slug)
      .run();

    return json({ok: true, removed: result.meta?.changes || 0}, 200, corsOrigin);
  } catch (err) {
    return serverError(corsOrigin, "admin:duckRaceReset", err);
  }
}

function certificateUrl(env, code) {
  return `${getSiteBaseUrl(env)}/certificado/?codigo=${encodeURIComponent(code)}`;
}

function buildPublicCertificatePayload(row) {
  return {
    code: row.code,
    meetupTitle: row.title,
    eventDate: row.event_date,
    durationMinutes: Number(row.duration_minutes),
    issuedAt: row.issued_at
  };
}

function buildCertificateTexts(row) {
  const eventDate = formatLongDate(row.event_date);
  const duration = formatDuration(row.duration_minutes);

  let participation = "participou do evento Hack in Brasil";
  if (eventDate) participation += `, realizado em ${eventDate}`;
  if (duration) participation += `, com carga horária total de ${duration}`;
  participation += ", por meio da participação em palestras e conteúdos técnicos.";

  const issuedDate = formatMeetupDate(row.issued_at);

  return {
    participantName: String(row.participant_name || ""),
    participationSentence: participation,
    issuedSentence: issuedDate
      ? `Emitido em Rio de Janeiro, Brasil, ${issuedDate}.`
      : "Emitido em Rio de Janeiro, Brasil.",
    code: String(row.code || "")
  };
}

function buildCertificateEmail(env, row) {
  const eventDate = formatLongDate(row.event_date);
  const duration = formatDuration(row.duration_minutes);
  const validationUrl = certificateUrl(env, row.code);

  const subject = `Seu certificado — ${row.title}`;

  const textBody = [
    `Olá, ${row.participant_name},`,
    "",
    `Seu certificado de participação no meetup de ${eventDate} está em anexo, em PDF.`,
    `Carga horária: ${duration}.`,
    "",
    `Número do certificado: ${row.code}`,
    `Qualquer pessoa pode conferir a validade dele em: ${validationUrl}`,
    "A consulta confirma o certificado sem exibir seu nome.",
    "",
    "Obrigado por participar — nos vemos no próximo meetup.",
    "",
    "Abraços,",
    "Equipe Hack in Brasil"
  ].join("\n");

  const htmlBody =
    `<p>Olá, ${escapeHtml(row.participant_name)},</p>` +
    `<p>Seu certificado de participação no meetup de ${escapeHtml(eventDate)} está em anexo, em PDF.<br>` +
    `Carga horária: ${escapeHtml(duration)}.</p>` +
    `<p>Número do certificado: <strong>${escapeHtml(row.code)}</strong><br>` +
    `Qualquer pessoa pode conferir a validade dele em <a href="${escapeHtml(validationUrl)}">${escapeHtml(validationUrl)}</a> ` +
    "— a consulta confirma o certificado sem exibir seu nome.</p>" +
    "<p>Obrigado por participar — nos vemos no próximo meetup.</p>" +
    "<p>Abraços,<br>Equipe Hack in Brasil</p>";

  return {subject, textBody, htmlBody};
}

async function findCertificateByRegistration(env, registrationId) {
  return env.DB
    .prepare(
      "SELECT c.code, c.participant_name, c.duration_minutes, c.issued_at, c.meetup_slug, m.title, m.event_date FROM certificates c JOIN meetups m ON m.slug = c.meetup_slug WHERE c.registration_id = ?"
    )
    .bind(registrationId)
    .first();
}

async function buildCertificateAttachment(env, code) {
  const row = await env.DB
    .prepare(
      "SELECT c.code, c.participant_name, c.duration_minutes, c.issued_at, c.meetup_slug, m.title, m.event_date FROM certificates c JOIN meetups m ON m.slug = c.meetup_slug WHERE c.code = ?"
    )
    .bind(String(code || ""))
    .first();

  if (!row) throw new Error(`certificate ${code} not found when building the attachment`);

  const pdf = buildCertificatePdf(buildCertificateTexts(row));
  return [
    {
      filename: `certificado-hack-in-brasil-${row.code}.pdf`,
      content: bytesToBase64Pdf(pdf)
    }
  ];
}

async function remainingEmailsToday(env) {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS total FROM email_sends WHERE date(sent_at) = date('now')")
    .first();
  return Math.max(0, dailyEmailCap(env) - Number(row?.total || 0));
}

async function queueCertificateEmail(env, certificate, recipientEmail) {
  const pending = await env.DB
    .prepare(
      "SELECT id FROM email_jobs WHERE kind = 'certificate' AND certificate_code = ? AND status IN ('pending', 'processing')"
    )
    .bind(certificate.code)
    .first();

  if (pending) return false;

  const message = buildCertificateEmail(env, certificate);

  await env.DB
    .prepare(
      "INSERT INTO email_jobs (kind, meetup_slug, certificate_code, recipient_name, recipient_email, subject, text_body, html_body, send_after, status) VALUES ('certificate', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 'pending')"
    )
    .bind(
      certificate.meetup_slug,
      certificate.code,
      certificate.participant_name,
      recipientEmail,
      message.subject,
      message.textBody,
      message.htmlBody
    )
    .run();

  return true;
}

async function handleIssueCertificate(env, session, slug, corsOrigin) {
  try {
    const registration = await env.DB
      .prepare("SELECT id, name, checked_in_at FROM registrations WHERE meetup_slug = ? AND email = ?")
      .bind(slug, session.email)
      .first();

    if (!registration) {
      return json({error: "Inscrição não encontrada"}, 404, corsOrigin);
    }

    if (!registration.checked_in_at) {
      return json(
        {error: "O certificado só é liberado para quem fez check-in no dia do meetup."},
        409,
        corsOrigin
      );
    }

    const meetup = await getMeetupBySlug(env.DB, slug);
    if (!meetup) return json({error: "Meetup not found"}, 404, corsOrigin);

    const availableAt = certificateAvailableAt(meetup);
    if (!isCertificateAvailable(availableAt)) {
      return json(
        {
          error: `O certificado fica disponível ${CERTIFICATE_DELAY_HOURS} horas após o fim do meetup.`,
          availableAt
        },
        409,
        corsOrigin
      );
    }

    let certificate = await findCertificateByRegistration(env, registration.id);

    if (!certificate) {
      await env.DB
        .prepare(
          "INSERT INTO certificates (code, meetup_slug, registration_id, participant_name, duration_minutes) VALUES (?, ?, ?, ?, ?) ON CONFLICT (meetup_slug, registration_id) DO NOTHING"
        )
        .bind(
          generateCertificateCode(),
          slug,
          registration.id,
          registration.name,
          meetup.duration_minutes
        )
        .run();

      certificate = await findCertificateByRegistration(env, registration.id);
    }

    if (!certificate) {
      return serverError(
        corsOrigin,
        "me:certificate",
        new Error("certificate row missing right after insert")
      );
    }

    const queued = await queueCertificateEmail(env, certificate, session.email);
    const remaining = await remainingEmailsToday(env);

    const message = remaining > 0
      ? `Certificado a caminho de ${session.email} — deve chegar em alguns minutos. Verifique também a caixa de spam.`
      : `Certificado na fila para ${session.email}. O limite diário de envios já foi atingido, então ele sai amanhã de manhã.`;

    return json(
      {
        ok: true,
        message: queued
          ? message
          : `Seu certificado já está na fila de envio para ${session.email}.`,
        code: certificate.code
      },
      200,
      corsOrigin
    );
  } catch (err) {
    return serverError(corsOrigin, "me:certificate", err);
  }
}

async function handleCertificateLookup(env, rawCode, corsOrigin) {
  const code = String(rawCode || "").trim().toUpperCase();
  const notFound = json({error: "Certificado não encontrado"}, 404, corsOrigin);

  if (!isCertificateCode(code)) return notFound;

  let row;
  try {
    row = await env.DB
      .prepare(
        "SELECT c.code, c.participant_name, c.duration_minutes, c.issued_at, c.meetup_slug, m.title, m.event_date FROM certificates c JOIN meetups m ON m.slug = c.meetup_slug WHERE c.code = ?"
      )
      .bind(code)
      .first();
  } catch (err) {
    return serverError(corsOrigin, "certificates:lookup", err);
  }

  if (!row) return notFound;

  return json({valid: true, certificate: buildPublicCertificatePayload(row)}, 200, corsOrigin);
}

const ENDED_MEETUP_CONDITION =
  "datetime(m.event_date, '+' || m.duration_minutes || ' minutes') <= datetime('now')";

function normalizeNickname(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function nicknameKey(nickname) {
  return String(nickname || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function isValidNickname(nickname) {
  if (nickname.length < NICKNAME_MIN_LENGTH || nickname.length > NICKNAME_MAX_LENGTH) return false;
  return /^[\p{L}\p{N}][\p{L}\p{N} ._-]*[\p{L}\p{N}]$/u.test(nickname);
}

function isReservedNickname(nickname) {
  const key = nicknameKey(nickname);

  if (RESERVED_NICKNAMES.includes(key.replace(/[^a-z0-9]/g, ""))) return true;

  return key
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .some((word) => RESERVED_NICKNAMES.includes(word));
}

async function getParticipantProfile(env, email) {
  const row = await env.DB
    .prepare("SELECT nickname, is_public FROM participant_profiles WHERE email = ?")
    .bind(email)
    .first();

  const totals = await env.DB
    .prepare(
      `SELECT COALESCE(SUM(m.xp_reward), 0) AS xp, COUNT(*) AS meetups FROM registrations r JOIN meetups m ON m.slug = r.meetup_slug WHERE r.email = ? AND ${ENDED_MEETUP_CONDITION}`
    )
    .bind(email)
    .first();

  return {
    nickname: row?.nickname || null,
    isPublic: Number(row?.is_public || 0) === 1,
    xp: Number(totals?.xp || 0),
    meetupsAttended: Number(totals?.meetups || 0),
    nicknameMinLength: NICKNAME_MIN_LENGTH,
    nicknameMaxLength: NICKNAME_MAX_LENGTH
  };
}

async function handleUpdateProfile(request, env, session, corsOrigin) {
  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;

  const nickname = normalizeNickname(parsed.body.nickname);
  const isPublic = parsed.body.isPublic === true;

  if (!nickname) {
    return json({error: "Escolha um apelido para aparecer no ranking."}, 400, corsOrigin);
  }

  if (nickname.length < NICKNAME_MIN_LENGTH) {
    return json(
      {error: `Apelido muito curto. Use pelo menos ${NICKNAME_MIN_LENGTH} caracteres.`},
      400,
      corsOrigin
    );
  }

  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return json(
      {
        error: `Apelido muito longo: ${nickname.length} caracteres. O limite é ${NICKNAME_MAX_LENGTH}.`
      },
      400,
      corsOrigin
    );
  }

  if (!isValidNickname(nickname)) {
    return json(
      {
        error: "Apelido inválido. Use letras e números, começando e terminando com letra ou número — espaço, ponto, hífen e underscore são permitidos no meio."
      },
      400,
      corsOrigin
    );
  }

  if (isReservedNickname(nickname)) {
    return json({error: "Esse apelido é reservado. Escolha outro."}, 400, corsOrigin);
  }

  try {
    await env.DB
      .prepare(
        "INSERT INTO participant_profiles (email, nickname, nickname_key, is_public) VALUES (?, ?, ?, ?) ON CONFLICT (email) DO UPDATE SET nickname = excluded.nickname, nickname_key = excluded.nickname_key, is_public = excluded.is_public, updated_at = CURRENT_TIMESTAMP"
      )
      .bind(session.email, nickname, nicknameKey(nickname), isPublic ? 1 : 0)
      .run();
  } catch (err) {
    if (String(err?.message || err || "").includes("UNIQUE constraint failed")) {
      return json({error: "Esse apelido já está em uso. Escolha outro."}, 409, corsOrigin);
    }
    return serverError(corsOrigin, "me:profileUpdate", err);
  }

  let profile;
  try {
    profile = await getParticipantProfile(env, session.email);
  } catch (err) {
    return serverError(corsOrigin, "me:profileUpdate", err);
  }

  return json(
    {
      ok: true,
      message: profile.isPublic
        ? "Perfil salvo. Você já aparece no ranking da comunidade."
        : "Perfil salvo. Você não aparece no ranking.",
      profile
    },
    200,
    corsOrigin
  );
}

async function handleRanking(env, corsOrigin) {
  let rows;
  try {
    rows = await env.DB
      .prepare(
        `SELECT p.nickname, COALESCE(SUM(m.xp_reward), 0) AS xp FROM participant_profiles p LEFT JOIN registrations r ON r.email = p.email LEFT JOIN meetups m ON m.slug = r.meetup_slug AND ${ENDED_MEETUP_CONDITION} WHERE p.is_public = 1 GROUP BY p.id ORDER BY xp DESC, p.nickname ASC LIMIT ?`
      )
      .bind(RANKING_LIMIT)
      .all();
  } catch (err) {
    return serverError(corsOrigin, "ranking", err);
  }

  const ranking = (Array.isArray(rows.results) ? rows.results : []).map((row, index) => ({
    position: index + 1,
    nickname: row.nickname,
    xp: Number(row.xp || 0)
  }));

  return json({limit: RANKING_LIMIT, ranking}, 200, corsOrigin);
}

async function handleLogout(env, session, corsOrigin) {
  try {
    await env.DB
      .prepare("UPDATE auth_sessions SET revoked = 1 WHERE id = ?")
      .bind(session.id)
      .run();
  } catch (err) {
    return serverError(corsOrigin, "auth:logout", err);
  }

  return json({ok: true}, 200, corsOrigin);
}

async function purgeExpiredAuthRecords(env) {
  await env.DB
    .prepare("DELETE FROM auth_login_requests WHERE created_at < datetime('now', '-1 day')")
    .run();

  await env.DB
    .prepare("DELETE FROM auth_sessions WHERE expires_at < datetime('now', '-1 day') OR (revoked = 1 AND created_at < datetime('now', '-1 day'))")
    .run();
}

async function handleStatus(env, slug, corsOrigin) {
  let meetup;
  try {
    meetup = await getMeetupBySlug(env.DB, slug);
  } catch (err) {
    return serverError(corsOrigin, "getMeetup", err);
  }

  if (!meetup) return json({error: "Meetup not found"}, 404, corsOrigin);

  const isFull = meetup.registrations_count >= meetup.capacity || meetup.is_open !== 1;
  return json(
    {
      slug: meetup.slug,
      title: meetup.title,
      eventDate: meetup.event_date,
      isOpen: meetup.is_open === 1,
      isFull
    },
    200,
    corsOrigin
  );
}

async function handleRegister(request, env, slug, corsOrigin) {
  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const document = normalizeDocument(body.document);
  const phoneNational = normalizePhone(body.phone);
  const phone = `+55${phoneNational}`;
  const consentLgpd = body.consentLgpd === true;
  const captchaId = String(body.captchaId || "");
  const captchaValue = Number(body.captcha);

  if (!name || name.length < 3 || name.length > 200) {
    return json({error: "Nome inválido"}, 400, corsOrigin);
  }
  if (!isValidEmail(email)) {
    return json({error: "E-mail inválido"}, 400, corsOrigin);
  }
  if (isDisposableEmail(email)) {
    return json({error: "Use um e-mail permanente. E-mails temporários/descartáveis não são aceitos."}, 400, corsOrigin);
  }
  if (!isValidCpf(document)) {
    return json({error: "CPF inválido"}, 400, corsOrigin);
  }
  if (!isValidBrazilMobile(phoneNational)) {
    return json({error: "Número de celular inválido"}, 400, corsOrigin);
  }
  if (!captchaId || !Number.isFinite(captchaValue)) {
    return json({error: "Verificação obrigatória"}, 400, corsOrigin);
  }
  if (!consentLgpd) {
    return json({error: "Consentimento LGPD é obrigatório"}, 400, corsOrigin);
  }

  let meetup;
  try {
    meetup = await getMeetupBySlug(env.DB, slug);
  } catch (err) {
    return serverError(corsOrigin, "getMeetup", err);
  }

  if (!meetup) return json({error: "Meetup not found"}, 404, corsOrigin);

  if (meetup.is_open !== 1 || meetup.registrations_count >= meetup.capacity) {
    return json({error: "Inscrições encerradas para este meetup"}, 409, corsOrigin);
  }

  if (!(await consumeCaptcha(env, captchaId, captchaValue))) {
    return json({error: "Verificação inválida ou expirada. Tente novamente."}, 400, corsOrigin);
  }

  const encryptedDocument = await encryptField(document, env);
  const encryptedPhone = await encryptField(phone, env);
  const documentLast4 = document.slice(-4);
  const documentHash = await blindIndex("document", document, env);
  const phoneHash = await blindIndex("phone", phoneNational, env);

  let batchResults;
  try {
    batchResults = await env.DB.batch([
      env.DB
        .prepare(
          "INSERT INTO registrations (meetup_slug, name, email, phone_encrypted, document_encrypted, document_last4, document_hash, phone_hash, consent_lgpd) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 1 FROM meetups WHERE slug = ? AND is_open = 1 AND registrations_count < capacity"
        )
        .bind(slug, name, email, encryptedPhone, encryptedDocument, documentLast4, documentHash, phoneHash, slug),
      env.DB
        .prepare(
          "UPDATE meetups SET registrations_count = registrations_count + 1, updated_at = CURRENT_TIMESTAMP WHERE slug = ? AND is_open = 1 AND registrations_count < capacity"
        )
        .bind(slug)
    ]);
  } catch (err) {
    const message = String(err?.message || err || "");

    if (message.includes("UNIQUE constraint failed")) {
      let isFull;
      try {
        const current = await getMeetupBySlug(env.DB, slug);
        isFull = current.registrations_count >= current.capacity || current.is_open !== 1;
      } catch {
        isFull = false;
      }
      return json(
        {
          ok: true,
          message: "Inscrição realizada com sucesso",
          isFull
        },
        201,
        corsOrigin
      );
    }
    return json({error: "Falha ao registrar inscrição"}, 500, corsOrigin);
  }

  const insertResult = batchResults[0];
  const updateResult = batchResults[1];

  if (
    !insertResult?.meta ||
    insertResult.meta.changes !== 1 ||
    !updateResult?.meta ||
    updateResult.meta.changes !== 1
  ) {
    return json({error: "Inscrições encerradas para este meetup"}, 409, corsOrigin);
  }

  let registrationId = Number(insertResult.meta.last_row_id || 0);

  if (!registrationId) {
    const createdRegistration = await env.DB
      .prepare(
        "SELECT id FROM registrations WHERE meetup_slug = ? AND email = ? ORDER BY id DESC LIMIT 1"
      )
      .bind(slug, email)
      .first();

    registrationId = Number(createdRegistration?.id || 0);
  }

  try {
    const emailTemplate = await getEmailTemplateByMeetupSlug(env.DB, slug);
    if (emailTemplate && registrationId) {
      await queueConfirmationEmail(env, {
        meetupSlug: slug,
        templateId: Number(emailTemplate.id),
        registrationId,
        recipientName: name,
        recipientEmail: email,
        subject: String(emailTemplate.subject),
        html: String(emailTemplate.html_body),
        text: String(emailTemplate.text_body),
        delayMinutes: 0
      });
    }
  } catch {
  }

  const updated = await getMeetupBySlug(env.DB, slug);
  const isFull = updated.registrations_count >= updated.capacity || updated.is_open !== 1;

  return json(
    {
      ok: true,
      message: "Inscrição realizada com sucesso",
      isFull
    },
    201,
    corsOrigin
  );
}

function buildSponsorNotificationEmail(data) {
  const rows = [
    ["Empresa", data.company],
    ["Site da empresa", data.website || "—"],
    ["Pessoa para contato", data.contactName],
    ["Cargo", data.role || "—"],
    ["E-mail", data.email],
    ["Celular para contato", data.phone],
    ["Mensagem / observações", data.message || "—"]
  ];

  const subject = `Nova solicitação de patrocínio — ${data.company}`;

  const textBody = [
    "Uma nova solicitação de patrocínio foi enviada pelo site.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Responda diretamente a este e-mail para entrar em contato com a empresa."
  ].join("\n");

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(
          label
        )}</td><td style="padding:6px 0;">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`
    )
    .join("");

  const htmlBody = `<p>Uma nova solicitação de patrocínio foi enviada pelo site.</p>` +
    `<table style="border-collapse:collapse;font-size:14px;">${htmlRows}</table>` +
    `<p style="color:#666;font-size:13px;">Responda diretamente a este e-mail para entrar em contato com a empresa.</p>`;

  return {subject, textBody, htmlBody};
}

async function handleSponsorRegister(request, env, corsOrigin) {
  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const company = String(body.company || "").trim();
  const website = String(body.website || "").trim();
  const contactName = String(body.contactName || "").trim();
  const role = String(body.role || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phoneNational = normalizePhone(body.phone);
  const phone = `+55${phoneNational}`;
  const message = String(body.message || "").trim();
  const captchaId = String(body.captchaId || "");
  const captchaValue = Number(body.captcha);

  if (!company || company.length < 2 || company.length > 200) {
    return json({error: "Nome da empresa inválido"}, 400, corsOrigin);
  }
  if (website.length > 300) {
    return json({error: "Site da empresa inválido"}, 400, corsOrigin);
  }
  if (!contactName || contactName.length < 3 || contactName.length > 200) {
    return json({error: "Nome de contato inválido"}, 400, corsOrigin);
  }
  if (role.length > 150) {
    return json({error: "Cargo inválido"}, 400, corsOrigin);
  }
  if (!isValidEmail(email)) {
    return json({error: "E-mail inválido"}, 400, corsOrigin);
  }
  if (!isValidBrazilContactPhone(phoneNational)) {
    return json({error: "Número de celular inválido"}, 400, corsOrigin);
  }
  if (message.length > 2000) {
    return json({error: "Mensagem muito longa"}, 400, corsOrigin);
  }
  if (!captchaId || !Number.isFinite(captchaValue)) {
    return json({error: "Verificação obrigatória"}, 400, corsOrigin);
  }
  if (!(await consumeCaptcha(env, captchaId, captchaValue))) {
    return json({error: "Verificação inválida ou expirada. Tente novamente."}, 400, corsOrigin);
  }

  try {
    await env.DB
      .prepare(
        "INSERT INTO sponsor_requests (company, website, contact_name, role, email, phone, message) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(company, website || null, contactName, role || null, email, phone, message || null)
      .run();
  } catch (err) {
    return serverError(corsOrigin, "sponsors:insert", err);
  }

  const notify = buildSponsorNotificationEmail({
    company,
    website,
    contactName,
    role,
    email,
    phone,
    message
  });

  let emailSent;
  try {
    const recipient =
      env.SPONSOR_NOTIFY_EMAIL || env.RESEND_REPLY_TO || "contato@hackinbrasil.com.br";
    if ((await notifyBudgetLeft(env, "sponsor")) <= 0) {
      throw new Error("Limite diário de notificações de patrocínio atingido");
    }
    await sendEmailWithResend(env, {
      kind: "sponsor",
      recipient_email: recipient,
      subject: notify.subject,
      html_body: notify.htmlBody,
      text_body: notify.textBody,
      reply_to: email
    });
    emailSent = true;
  } catch {
    emailSent = false;
  }

  return json(
    {
      ok: true,
      message: "Solicitação de patrocínio enviada com sucesso",
      emailSent
    },
    201,
    corsOrigin
  );
}

function buildTalkNotificationEmail(data) {
  const rows = [
    ["Título", data.title],
    ["Palestrante", data.speakerName],
    ["E-mail", data.email],
    ["Telefone", data.phone || "—"],
    ["Presencial no RJ", data.inPerson ? "Sim" : "Não"],
    ["Link da foto", data.photoUrl],
    ["Minibio", data.bio],
    ["Descrição da palestra", data.abstract],
    ["Autoriza uso de imagem", data.imageConsent ? "Sim" : "Não"],
    ["Ciente das orientações", data.termsAck ? "Sim" : "Não"]
  ];

  const subject = `Nova proposta de palestra — ${data.title}`;

  const textBody = [
    "Uma nova proposta de palestra foi enviada pelo site.",
    "",
    ...rows.map(([label, value]) => `${label}: ${value}`),
    "",
    "Responda diretamente a este e-mail para entrar em contato com a pessoa palestrante."
  ].join("\n");

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 12px 6px 0;font-weight:600;vertical-align:top;white-space:nowrap;">${escapeHtml(
          label
        )}</td><td style="padding:6px 0;">${escapeHtml(value).replace(/\n/g, "<br>")}</td></tr>`
    )
    .join("");

  const htmlBody = `<p>Uma nova proposta de palestra foi enviada pelo site.</p>` +
    `<table style="border-collapse:collapse;font-size:14px;">${htmlRows}</table>` +
    `<p style="color:#666;font-size:13px;">Responda diretamente a este e-mail para entrar em contato com a pessoa palestrante.</p>`;

  return {subject, textBody, htmlBody};
}

async function handleTalkSubmit(request, env, corsOrigin) {
  const parsed = await readJsonBody(request, corsOrigin);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const title = String(body.title || "").trim();
  const abstract = String(body.abstract || "").trim();
  const speakerName = String(body.speakerName || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phoneRaw = String(body.phone || "").trim();
  const phoneNational = normalizePhone(phoneRaw);
  const phone = phoneRaw ? `+55${phoneNational}` : "";
  const photoUrl = String(body.photoUrl || "").trim();
  const bio = String(body.bio || "").trim();
  const inPersonRaw = String(body.inPerson || "").trim().toLowerCase();
  const imageConsent = body.imageConsent === true;
  const termsAck = body.termsAck === true;
  const captchaId = String(body.captchaId || "");
  const captchaValue = Number(body.captcha);

  if (!title || title.length < 3 || title.length > 200) {
    return json({error: "Título inválido"}, 400, corsOrigin);
  }
  if (!abstract || abstract.length < 10 || abstract.length > 5000) {
    return json({error: "Descrição da palestra inválida"}, 400, corsOrigin);
  }
  if (!speakerName || speakerName.length < 2 || speakerName.length > 200) {
    return json({error: "Nome inválido"}, 400, corsOrigin);
  }
  if (!isValidEmail(email)) {
    return json({error: "E-mail inválido"}, 400, corsOrigin);
  }
  if (phoneRaw && !isValidBrazilContactPhone(phoneNational)) {
    return json({error: "Número de telefone inválido"}, 400, corsOrigin);
  }
  if (!photoUrl || photoUrl.length > 500 || !isHttpUrl(photoUrl)) {
    return json({error: "Link da foto inválido"}, 400, corsOrigin);
  }
  if (!bio || bio.length < 10 || bio.length > 3000) {
    return json({error: "Minibio inválida"}, 400, corsOrigin);
  }
  if (inPersonRaw !== "sim" && inPersonRaw !== "nao") {
    return json({error: "Informe sua disponibilidade presencial"}, 400, corsOrigin);
  }
  if (!imageConsent) {
    return json({error: "É necessário autorizar o uso de imagem"}, 400, corsOrigin);
  }
  if (!termsAck) {
    return json({error: "É necessário confirmar ciência das orientações"}, 400, corsOrigin);
  }
  if (!captchaId || !Number.isFinite(captchaValue)) {
    return json({error: "Verificação obrigatória"}, 400, corsOrigin);
  }
  if (!(await consumeCaptcha(env, captchaId, captchaValue))) {
    return json({error: "Verificação inválida ou expirada. Tente novamente."}, 400, corsOrigin);
  }

  const inPerson = inPersonRaw === "sim" ? 1 : 0;

  try {
    await env.DB
      .prepare(
        "INSERT INTO talk_proposals (title, abstract, speaker_name, email, phone, photo_url, bio, in_person, image_consent, terms_ack) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .bind(
        title,
        abstract,
        speakerName,
        email,
        phone || null,
        photoUrl,
        bio,
        inPerson,
        imageConsent ? 1 : 0,
        termsAck ? 1 : 0
      )
      .run();
  } catch (err) {
    return serverError(corsOrigin, "talks:insert", err);
  }

  const notify = buildTalkNotificationEmail({
    title,
    abstract,
    speakerName,
    email,
    phone,
    photoUrl,
    bio,
    inPerson: inPerson === 1,
    imageConsent,
    termsAck
  });

  let emailSent;
  try {
    const recipient =
      env.TALK_NOTIFY_EMAIL || env.RESEND_REPLY_TO || "contato@hackinbrasil.com.br";
    if ((await notifyBudgetLeft(env, "talk")) <= 0) {
      throw new Error("Limite diário de notificações de palestra atingido");
    }
    await sendEmailWithResend(env, {
      kind: "talk",
      recipient_email: recipient,
      subject: notify.subject,
      html_body: notify.htmlBody,
      text_body: notify.textBody,
      reply_to: email
    });
    emailSent = true;
  } catch {
    emailSent = false;
  }

  return json(
    {
      ok: true,
      message: "Proposta de palestra enviada com sucesso",
      emailSent
    },
    201,
    corsOrigin
  );
}

export default {
  async fetch(request, env, ctx) {
    const corsOrigin = getCorsOrigin(request, env);

    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            "access-control-allow-origin": corsOrigin,
            "access-control-allow-methods": "GET,POST,OPTIONS",
            "access-control-allow-headers": "content-type,authorization",
            vary: "Origin",
            "access-control-max-age": "3600"
          }
        });
      }

      const statusMatch = url.pathname.match(/^\/api\/meetups\/([a-z0-9-]+)\/status$/);
      if (request.method === "GET" && statusMatch) {
        return handleStatus(env, statusMatch[1], corsOrigin);
      }

      if (request.method === "GET" && url.pathname === "/api/captcha") {
        return handleCaptchaIssue(env, corsOrigin);
      }

      const registerMatch = url.pathname.match(/^\/api\/meetups\/([a-z0-9-]+)\/register$/);
      if (request.method === "POST" && registerMatch) {
        return handleRegister(request, env, registerMatch[1], corsOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/sponsors") {
        return handleSponsorRegister(request, env, corsOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/talks") {
        return handleTalkSubmit(request, env, corsOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/magic-link") {
        return handleMagicLinkRequest(request, env, corsOrigin, ctx);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/session") {
        return handleSessionCreate(request, env, corsOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/auth/logout") {
        return withSession(request, env, corsOrigin, (session) =>
          handleLogout(env, session, corsOrigin)
        );
      }

      if (request.method === "GET" && url.pathname === "/api/me/registrations") {
        return withSession(request, env, corsOrigin, (session) =>
          handleMyRegistrations(env, session, corsOrigin)
        );
      }

      const cancelMatch = url.pathname.match(/^\/api\/me\/registrations\/([a-z0-9-]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch) {
        return withSession(request, env, corsOrigin, (session) =>
          handleCancelRegistration(request, env, session, cancelMatch[1], corsOrigin, ctx)
        );
      }

      const certificateMatch = url.pathname.match(
        /^\/api\/me\/registrations\/([a-z0-9-]+)\/certificate$/
      );
      if (request.method === "POST" && certificateMatch) {
        return withSession(request, env, corsOrigin, (session) =>
          handleIssueCertificate(env, session, certificateMatch[1], corsOrigin)
        );
      }

      const certificateLookupMatch = url.pathname.match(/^\/api\/certificates\/([A-Za-z0-9-]{8,32})$/);
      if (request.method === "GET" && certificateLookupMatch) {
        return handleCertificateLookup(env, certificateLookupMatch[1], corsOrigin);
      }

      if (request.method === "GET" && url.pathname === "/api/ranking") {
        return handleRanking(env, corsOrigin);
      }

      if (request.method === "POST" && url.pathname === "/api/me/profile") {
        return withSession(request, env, corsOrigin, (session) =>
          handleUpdateProfile(request, env, session, corsOrigin)
        );
      }

      const checkinCodeMatch = url.pathname.match(
        /^\/api\/me\/registrations\/([a-z0-9-]+)\/checkin-code$/
      );
      if (request.method === "GET" && checkinCodeMatch) {
        return withSession(request, env, corsOrigin, (session) =>
          handleGetCheckinCode(env, session, checkinCodeMatch[1], corsOrigin)
        );
      }

      if (request.method === "GET" && url.pathname === "/api/me/admin-status") {
        return withSession(request, env, corsOrigin, (session) =>
          handleAdminStatus(env, session, corsOrigin)
        );
      }

      if (request.method === "POST" && url.pathname === "/api/admin/checkin") {
        return withSession(request, env, corsOrigin, (session) =>
          handleAdminCheckin(request, env, session, corsOrigin)
        );
      }

      if (request.method === "GET" && url.pathname === "/api/admin/meetups") {
        return withSession(request, env, corsOrigin, (session) =>
          handleAdminMeetupList(env, session, corsOrigin)
        );
      }

      const duckRaceStateMatch = url.pathname.match(/^\/api\/admin\/meetups\/([a-z0-9-]+)\/duck-race$/);
      if (request.method === "GET" && duckRaceStateMatch) {
        return withSession(request, env, corsOrigin, (session) =>
          handleDuckRaceState(env, session, duckRaceStateMatch[1], corsOrigin)
        );
      }

      const duckRaceDrawMatch = url.pathname.match(
        /^\/api\/admin\/meetups\/([a-z0-9-]+)\/duck-race\/draw$/
      );
      if (request.method === "POST" && duckRaceDrawMatch) {
        return withSession(request, env, corsOrigin, (session) =>
          handleDuckRaceDraw(env, session, duckRaceDrawMatch[1], corsOrigin)
        );
      }

      const duckRaceResetMatch = url.pathname.match(
        /^\/api\/admin\/meetups\/([a-z0-9-]+)\/duck-race\/reset$/
      );
      if (request.method === "POST" && duckRaceResetMatch) {
        return withSession(request, env, corsOrigin, (session) =>
          handleDuckRaceReset(request, env, session, duckRaceResetMatch[1], corsOrigin)
        );
      }

      return json({error: "Not found"}, 404, corsOrigin);
    } catch (err) {
      return serverError(corsOrigin, "fetch", err);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
        try {
          await queueDueReminders(env);
        } catch {
        }
        await processPendingEmailJobs(env);
        try {
          await env.DB
            .prepare("DELETE FROM captcha_challenges WHERE expires_at < CURRENT_TIMESTAMP")
            .run();
        } catch {
        }
        try {
          await purgeExpiredAuthRecords(env);
        } catch {
        }
      })()
    );
  }
};
