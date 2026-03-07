function json(data, status = 200, corsOrigin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": corsOrigin,
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization"
    }
  });
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
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeDocument(document) {
  return String(document || "").replace(/\D+/g, "");
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

async function getMeetupBySlug(db, slug) {
  return db
    .prepare("SELECT slug, title, event_date, capacity, registrations_count, is_open FROM meetups WHERE slug = ?")
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

async function encryptDocument(document, env) {
  const key = await importAesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(document);
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain);
  const payload = new Uint8Array(iv.length + cipher.byteLength);
  payload.set(iv, 0);
  payload.set(new Uint8Array(cipher), iv.length);
  return bytesToBase64(payload);
}

async function handleStatus(env, slug, corsOrigin) {
  let meetup;
  try {
    meetup = await getMeetupBySlug(env.DB, slug);
  } catch {
    return json(
      { error: "Database not initialized. Apply D1 migrations before using the API." },
      500,
      corsOrigin
    );
  }

  if (!meetup) return json({ error: "Meetup not found" }, 404, corsOrigin);

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
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400, corsOrigin);
  }

  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const document = normalizeDocument(body.document);
  const consentLgpd = body.consentLgpd === true;

  if (!name || name.length < 3) {
    return json({ error: "Nome inválido" }, 400, corsOrigin);
  }
  if (!isValidEmail(email)) {
    return json({ error: "E-mail inválido" }, 400, corsOrigin);
  }
  if (!isValidCpf(document)) {
    return json({ error: "CPF inválido" }, 400, corsOrigin);
  }
  if (!consentLgpd) {
    return json({ error: "Consentimento LGPD é obrigatório" }, 400, corsOrigin);
  }

  let meetup;
  try {
    meetup = await getMeetupBySlug(env.DB, slug);
  } catch {
    return json(
      { error: "Database not initialized. Apply D1 migrations before using the API." },
      500,
      corsOrigin
    );
  }

  if (!meetup) return json({ error: "Meetup not found" }, 404, corsOrigin);

  if (meetup.is_open !== 1 || meetup.registrations_count >= meetup.capacity) {
    return json({ error: "Inscrições encerradas para este meetup" }, 409, corsOrigin);
  }

  const encryptedDocument = await encryptDocument(document, env);
  const documentLast4 = document.slice(-4);

  const gate = await env.DB
    .prepare(
      "UPDATE meetups SET registrations_count = registrations_count + 1, updated_at = CURRENT_TIMESTAMP WHERE slug = ? AND is_open = 1 AND registrations_count < capacity"
    )
    .bind(slug)
    .run();

  if (!gate.meta || gate.meta.changes !== 1) {
    return json({ error: "Inscrições encerradas para este meetup" }, 409, corsOrigin);
  }

  try {
    await env.DB
      .prepare(
        "INSERT INTO registrations (meetup_slug, name, email, document_encrypted, document_last4, consent_lgpd) VALUES (?, ?, ?, ?, ?, 1)"
      )
      .bind(slug, name, email, encryptedDocument, documentLast4)
      .run();
  } catch (err) {
    const message = String(err?.message || err || "");

    // Reverte a reserva de vaga se o insert falhar.
    await env.DB
      .prepare(
        "UPDATE meetups SET registrations_count = CASE WHEN registrations_count > 0 THEN registrations_count - 1 ELSE 0 END, updated_at = CURRENT_TIMESTAMP WHERE slug = ?"
      )
      .bind(slug)
      .run();

    if (message.includes("UNIQUE constraint failed: registrations.meetup_slug, registrations.email")) {
      return json({ error: "Não foi possível concluir a inscrição" }, 409, corsOrigin);
    }
    return json({ error: "Falha ao registrar inscrição" }, 500, corsOrigin);
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

export default {
  async fetch(request, env) {
    const corsOrigin = getCorsOrigin(request, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": corsOrigin,
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type,authorization"
        }
      });
    }

    const statusMatch = url.pathname.match(/^\/api\/meetups\/([a-z0-9-]+)\/status$/);
    if (request.method === "GET" && statusMatch) {
      return handleStatus(env, statusMatch[1], corsOrigin);
    }

    const registerMatch = url.pathname.match(/^\/api\/meetups\/([a-z0-9-]+)\/register$/);
    if (request.method === "POST" && registerMatch) {
      return handleRegister(request, env, registerMatch[1], corsOrigin);
    }

    return json({ error: "Not found" }, 404, corsOrigin);
  }
};
