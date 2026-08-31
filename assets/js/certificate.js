(function () {
  const page = document.getElementById("certificate-page");
  if (!page) return;

  const apiBase = (page.dataset.apiBase || "").trim().replace(/\/$/, "");

  const form = document.getElementById("certificate-lookup-form");
  const input = document.getElementById("certificate-code-input");
  const submit = document.getElementById("certificate-lookup-submit");
  const status = document.getElementById("certificate-status");
  const result = document.getElementById("certificate-result");

  const fields = {
    meetup: document.getElementById("certificate-meetup"),
    date: document.getElementById("certificate-date"),
    duration: document.getElementById("certificate-duration"),
    issued: document.getElementById("certificate-issued"),
    code: document.getElementById("certificate-code")
  };

  const required = [form, input, submit, status, result].concat(Object.values(fields));
  if (required.some((node) => !node)) return;

  function normalizeCode(value) {
    const raw = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const body = raw.startsWith("HIB") ? raw.slice(3) : raw;
    if (body.length !== 12) return "";
    return `HIB-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
  }

  function parseTimestamp(value) {
    const text = String(value || "").trim();
    if (!text) return NaN;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
      return Date.parse(`${text.replace(" ", "T")}Z`);
    }
    return Date.parse(text);
  }

  function formatDate(value) {
    const time = parseTimestamp(value);
    if (!Number.isFinite(time)) return "—";
    return new Date(time).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  }

  function formatDuration(minutes) {
    const total = Math.max(0, Math.round(Number(minutes) || 0));
    const hours = Math.floor(total / 60);
    const rest = total % 60;
    const parts = [];
    if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hora" : "horas"}`);
    if (rest > 0) parts.push(`${rest} ${rest === 1 ? "minuto" : "minutos"}`);
    return parts.join(" e ") || "—";
  }

  function showStatus(message, kind) {
    status.textContent = message;
    status.classList.toggle("is-valid", kind === "valid");
    status.classList.toggle("is-invalid", kind === "invalid");
    if (kind !== "valid") result.hidden = true;
  }

  function render(certificate) {
    fields.meetup.textContent = certificate.meetupTitle || "—";
    fields.date.textContent = formatDate(certificate.eventDate);
    fields.duration.textContent = formatDuration(certificate.durationMinutes);
    fields.issued.textContent = formatDate(certificate.issuedAt);
    fields.code.textContent = certificate.code || "—";

    showStatus("Certificado válido — emitido pelo Hack in Brasil.", "valid");
    result.hidden = false;
  }

  async function lookup(code) {
    showStatus("Consultando...", "");
    submit.disabled = true;

    let response;
    let data;
    try {
      response = await fetch(`${apiBase}/api/certificates/${encodeURIComponent(code)}`);
      data = await response.json().catch(() => ({}));
    } catch {
      submit.disabled = false;
      showStatus("Erro de conexão ao consultar. Tente novamente.", "invalid");
      return;
    }

    submit.disabled = false;

    if (response.status === 404) {
      showStatus(
        "Não encontramos nenhum certificado com esse número. Confira os caracteres e tente de novo.",
        "invalid"
      );
      return;
    }

    if (!response.ok || !data.certificate) {
      showStatus(data.error || "Não foi possível consultar agora. Tente novamente.", "invalid");
      return;
    }

    render(data.certificate);
  }

  function setCodeInUrl(code) {
    const params = new URLSearchParams(window.location.search);
    params.set("codigo", code);
    window.history.replaceState({}, document.title, `${window.location.pathname}?${params.toString()}`);
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    const code = normalizeCode(input.value);
    if (!code) {
      showStatus("Número inválido. Ele tem o formato HIB-XXXX-XXXX-XXXX.", "invalid");
      return;
    }

    input.value = code;
    setCodeInUrl(code);
    lookup(code);
  });

  if (!apiBase) {
    showStatus("Configuração pendente: defina o domínio da API nesta página.", "invalid");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requested = normalizeCode(params.get("codigo") || params.get("code") || "");
  if (requested) {
    input.value = requested;
    lookup(requested);
  }
})();
