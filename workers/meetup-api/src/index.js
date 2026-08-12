function json(data, status = 200, corsOrigin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": corsOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      // Responses carry personal data and are origin-dependent: never let a
      // browser or intermediary keep or share a copy.
      "cache-control": "no-store",
      vary: "Origin"
    }
  });
}

// Work that must not delay (or leak its duration into) the response. Sending
// an e-mail only when an account exists is exactly the kind of timing
// difference that turns a deliberately generic answer into an oracle.
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

  // `null`, arrays and scalars are valid JSON but every handler reads fields
  // off this value — without the guard they throw and surface as a 500.
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
  // Espaço era o único caractere barrado, então "a\n@b.com" passava. Controle e
  // CR/LF são o que transforma um endereço em injeção de cabeçalho mais adiante.
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

// Erros do provedor de e-mail costumam ecoar o endereço que falhou, e esse texto
// vai parar em email_jobs.last_error, que nunca é purgado.
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
    .prepare("SELECT slug, title, event_date, capacity, registrations_count, is_open FROM meetups WHERE slug = ?")
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

async function decryptField(encryptedPayload, env) {
  const key = await importAesKey(env);
  const payload = base64ToBytes(encryptedPayload);
  if (payload.byteLength <= 12) {
    throw new Error("Invalid encrypted document payload");
  }
  const iv = payload.slice(0, 12);
  const cipher = payload.slice(12);
  const plainBuffer = await crypto.subtle.decrypt({name: "AES-GCM", iv}, key, cipher);
  return new TextDecoder().decode(plainBuffer);
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

function getSiteBaseUrl(env) {
  const configured = String(env.SITE_BASE_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  const firstAllowedOrigin = String(env.ALLOWED_ORIGIN || "")
    .split(",")[0]
    .trim()
    .replace(/\/+$/, "");

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

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = payload.message || payload.error || `Resend request failed with status ${response.status}`;
    throw new Error(message);
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

const DAILY_EMAIL_CAP = 100;
const MAX_CAP_RETRIES = 3;

async function deferJobsOverDailyCap(env) {
  await env.DB
    .prepare(
      "UPDATE email_jobs SET send_after = datetime('now', '+12 hours'), cap_retries = cap_retries + 1, updated_at = CURRENT_TIMESTAMP, last_error = 'Limite diário de e-mails atingido; reagendado' WHERE status = 'pending' AND send_after <= CURRENT_TIMESTAMP AND cap_retries < ?"
    )
    .bind(MAX_CAP_RETRIES)
    .run();

  await env.DB
    .prepare(
      "UPDATE email_jobs SET status = 'failed', updated_at = CURRENT_TIMESTAMP, last_error = 'Limite diário de e-mails atingido após 3 reagendamentos' WHERE status = 'pending' AND send_after <= CURRENT_TIMESTAMP AND cap_retries >= ?"
    )
    .bind(MAX_CAP_RETRIES)
    .run();
}

async function processPendingEmailJobs(env, limit = 20) {
  const sentTodayRow = await env.DB
    .prepare("SELECT COUNT(*) AS total FROM email_jobs WHERE status = 'sent' AND date(sent_at) = date('now')")
    .first();

  const sentToday = Number(sentTodayRow?.total || 0);
  const remainingForToday = DAILY_EMAIL_CAP - sentToday;
  if (remainingForToday <= 0) {
    await deferJobsOverDailyCap(env);
    return;
  }

  const maxBatchSize = Math.min(limit, remainingForToday);
  const pending = await env.DB
    .prepare(
      "SELECT id, meetup_slug, recipient_name, recipient_email, subject, html_body, text_body, attempts FROM email_jobs WHERE status = 'pending' AND send_after <= CURRENT_TIMESTAMP ORDER BY id ASC LIMIT ?"
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
      const resendEmailId = await sendEmailWithResend(env, job);
      await markEmailAsSent(env, job.id, resendEmailId);
    } catch (error) {
      const errorText = truncateError(error?.message || error || "Unknown email sending failure");
      if (currentAttempt >= 5) {
        await markEmailAsFailed(env, job.id, errorText);
      }
      if (currentAttempt < 5) {
        await markEmailAsRetry(env, job.id, errorText);
      }
    }
  }
}

function randomInt(maxExclusive) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % maxExclusive;
}

function generateCaptchaChallenge() {
  const a = randomInt(9) + 1;
  const b = randomInt(9) + 1;
  const isAddition = randomInt(2) === 0;
  let left = a;
  let right = b;
  if (!isAddition && left < right) {
    const temp = left;
    left = right;
    right = temp;
  }
  const answer = isAddition ? left + right : left - right;
  const question = `${left} ${isAddition ? "+" : "−"} ${right}`;
  return {question, answer};
}

async function handleCaptchaIssue(env, corsOrigin) {
  const {question, answer} = generateCaptchaChallenge();
  const id = crypto.randomUUID();

  try {
    await env.DB
      .prepare(
        "INSERT INTO captcha_challenges (id, answer, expires_at) VALUES (?, ?, datetime('now', '+10 minutes'))"
      )
      .bind(id, answer)
      .run();
  } catch (err) {
    return serverError(corsOrigin, "captcha:issue", err);
  }

  return json({id, question}, 200, corsOrigin);
}

async function consumeCaptcha(env, id, answer) {
  if (typeof id !== "string" || !id || !Number.isFinite(answer)) return false;

  let consumed;
  try {
    consumed = await env.DB
      .prepare(
        "UPDATE captcha_challenges SET consumed = 1 WHERE id = ? AND consumed = 0 AND expires_at > CURRENT_TIMESTAMP"
      )
      .bind(id)
      .run();
  } catch {
    return false;
  }

  if (!consumed.meta || consumed.meta.changes !== 1) return false;

  const row = await env.DB
    .prepare("SELECT answer FROM captcha_challenges WHERE id = ?")
    .bind(id)
    .first();

  return !!row && Number(row.answer) === answer;
}

const MAGIC_LINK_TTL_MINUTES = 15;
const MAGIC_LINK_WINDOW_MINUTES = 15;
const MAGIC_LINK_MAX_PER_WINDOW = 3;
const SESSION_TTL_MINUTES = 30;
const CANCEL_CONFIRMATION_WORD = "CANCELAR";

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

    const registrationCount = await env.DB
      .prepare("SELECT COUNT(*) AS total FROM registrations WHERE email = ?")
      .bind(email)
      .first();

    if (Number(registrationCount?.total || 0) === 0) {
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

    // Deliberately not awaited: the caller must not be able to tell the two
    // branches apart by how long the answer took.
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
        "SELECT r.meetup_slug, r.name, r.created_at, m.title, m.event_date FROM registrations r JOIN meetups m ON m.slug = r.meetup_slug WHERE r.email = ? ORDER BY m.event_date DESC"
      )
      .bind(session.email)
      .all();
  } catch (err) {
    return serverError(corsOrigin, "me:registrations", err);
  }

  const registrations = (Array.isArray(rows.results) ? rows.results : []).map((row) => {
    const past = isEventPast(row.event_date);
    return {
      meetupSlug: row.meetup_slug,
      title: row.title,
      eventDate: row.event_date,
      name: row.name,
      registeredAt: row.created_at,
      isPast: past,
      canCancel: !past
    };
  });

  // What the person came here to act on goes first: upcoming meetups with the
  // nearest one on top, then past editions most recent first.
  registrations.sort((a, b) => {
    if (a.isPast !== b.isPast) return a.isPast ? 1 : -1;
    const aTime = Date.parse(a.eventDate) || 0;
    const bTime = Date.parse(b.eventDate) || 0;
    return a.isPast ? bTime - aTime : aTime - bTime;
  });

  return json(
    {
      email: session.email,
      confirmationWord: CANCEL_CONFIRMATION_WORD,
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

    // One batch, one transaction. The seat count is recomputed from the
    // registrations table instead of being decremented: that is idempotent, so
    // a double submit can never give two seats back, and it repairs any drift
    // the counter may already carry. Do not gate this on `meta.changes` — D1
    // counts cascaded deletes there too (an `email_jobs` row cascades from the
    // registration), so the value is not a reliable "did I delete one row".
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

    // The seat is already free at this point, so the confirmation e-mail must
    // not keep the person waiting on a third-party round-trip.
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
      let isFull = false;
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
        delayMinutes: 10
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

  let emailSent = false;
  try {
    const recipient =
      env.SPONSOR_NOTIFY_EMAIL || env.RESEND_REPLY_TO || "contato@hackinbrasil.com.br";
    await sendEmailWithResend(env, {
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

  let emailSent = false;
  try {
    const recipient =
      env.TALK_NOTIFY_EMAIL || env.RESEND_REPLY_TO || "contato@hackinbrasil.com.br";
    await sendEmailWithResend(env, {
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
            // This answer is origin-specific: without Vary an intermediary
            // cache could hand one origin's allow-origin header to another.
            // Preflights carry no personal data, so they may be cached — an
            // hour of it saves a round-trip before every POST.
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

      return json({error: "Not found"}, 404, corsOrigin);
    } catch (err) {
      return serverError(corsOrigin, "fetch", err);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      (async () => {
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
