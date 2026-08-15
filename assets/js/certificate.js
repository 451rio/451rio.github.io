(function () {
  const page = document.getElementById("certificate-page");
  if (!page) return;

  const apiBase = (page.dataset.apiBase || "").trim().replace(/\/$/, "");

  const statusCard = document.getElementById("certificate-status-card");
  const status = document.getElementById("certificate-status");
  const lookupForm = document.getElementById("certificate-lookup-form");
  const lookupInput = document.getElementById("certificate-code-input");
  const lookupSubmit = document.getElementById("certificate-lookup-submit");

  const viewport = document.getElementById("certificate-viewport");
  const nameNode = document.getElementById("certificate-name");
  const participationNode = document.getElementById("certificate-participation");
  const issuedNode = document.getElementById("certificate-issued");
  const codeNode = document.getElementById("certificate-code");

  const actions = document.getElementById("certificate-actions");
  const printButton = document.getElementById("certificate-print");
  const shareUrlNode = document.getElementById("certificate-share-url");

  const requiredNodes = [
    statusCard, status, lookupForm, lookupInput, lookupSubmit,
    viewport, nameNode, participationNode, issuedNode, codeNode,
    actions, printButton, shareUrlNode
  ];
  if (requiredNodes.some((node) => !node)) return;

  // O código é sorteado em blocos de 4, mas ninguém deveria precisar acertar os
  // hífens: aceita com ou sem separador, em qualquer caixa.
  function normalizeCode(value) {
    const raw = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const body = raw.startsWith("HIB") ? raw.slice(3) : raw;
    if (body.length !== 12) return "";
    return `HIB-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}`;
  }

  // D1 devolve CURRENT_TIMESTAMP como "YYYY-MM-DD HH:MM:SS" em UTC, sem fuso.
  // Date.parse leria isso como horário local e adiantaria o certificado em
  // algumas horas.
  function parseTimestamp(value) {
    const text = String(value || "").trim();
    if (!text) return NaN;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
      return Date.parse(`${text.replace(" ", "T")}Z`);
    }
    return Date.parse(text);
  }

  function formatLongDate(value) {
    const time = parseTimestamp(value);
    if (!Number.isFinite(time)) return "";
    return new Date(time).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "numeric",
      month: "long",
      year: "numeric"
    });
  }

  function formatShortDate(value) {
    const time = parseTimestamp(value);
    if (!Number.isFinite(time)) return "";
    return new Date(time).toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
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
    return parts.join(" e ");
  }

  function buildParticipationSentence(certificate) {
    const eventDate = formatLongDate(certificate.eventDate);
    const duration = formatDuration(certificate.durationMinutes);

    let sentence = "participou do evento Hack in Brasil";
    if (eventDate) sentence += `, realizado em ${eventDate}`;
    if (duration) sentence += `, com carga horária total de ${duration}`;
    sentence += ", por meio da participação em palestras e conteúdos técnicos.";
    return sentence;
  }

  function showStatus(message, options) {
    const config = options || {};
    status.textContent = message;
    statusCard.hidden = false;
    lookupForm.hidden = !config.showLookup;
    viewport.hidden = true;
    actions.hidden = true;
    if (config.showLookup) window.setTimeout(() => lookupInput.focus(), 50);
  }

  function render(certificate) {
    nameNode.textContent = certificate.participantName || "";
    participationNode.textContent = buildParticipationSentence(certificate);

    const issuedAt = formatShortDate(certificate.issuedAt);
    issuedNode.textContent = issuedAt
      ? `Emitido em Rio de Janeiro, Brasil, ${issuedAt}.`
      : "Emitido em Rio de Janeiro, Brasil.";

    codeNode.textContent =
      `Certificado nº ${certificate.code} · confira em hackinbrasil.com.br/certificado/`;

    const shareUrl =
      certificate.url || `${window.location.origin}/certificado/?codigo=${certificate.code}`;
    shareUrlNode.textContent = shareUrl;

    if (certificate.participantName) {
      document.title = `Certificado de ${certificate.participantName} | Hack in Brasil`;
    }

    statusCard.hidden = true;
    viewport.hidden = false;
    actions.hidden = false;
  }

  async function loadCertificate(code) {
    showStatus("Carregando certificado...");
    lookupSubmit.disabled = true;

    let response;
    let data;
    try {
      response = await fetch(`${apiBase}/api/certificates/${encodeURIComponent(code)}`);
      data = await response.json().catch(() => ({}));
    } catch {
      showStatus("Erro de conexão ao carregar o certificado. Tente novamente.", {showLookup: true});
      lookupSubmit.disabled = false;
      return;
    }

    lookupSubmit.disabled = false;

    if (!response.ok || !data.certificate) {
      showStatus(
        data.error || "Certificado não encontrado. Confira o código e tente de novo.",
        {showLookup: true}
      );
      return;
    }

    render(data.certificate);
  }

  function setCodeInUrl(code) {
    const params = new URLSearchParams(window.location.search);
    params.set("codigo", code);
    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}?${params.toString()}`
    );
  }

  lookupForm.addEventListener("submit", function (event) {
    event.preventDefault();

    const code = normalizeCode(lookupInput.value);
    if (!code) {
      showStatus("Código inválido. Ele tem o formato HIB-XXXX-XXXX-XXXX.", {showLookup: true});
      lookupInput.value = String(lookupInput.value || "").trim();
      return;
    }

    lookupInput.value = code;
    setCodeInUrl(code);
    loadCertificate(code);
  });

  printButton.addEventListener("click", function () {
    window.print();
  });

  if (!apiBase) {
    showStatus("Configuração pendente: defina o domínio da API nesta página.");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const requestedCode = normalizeCode(params.get("codigo") || params.get("code") || "");

  if (requestedCode) {
    loadCertificate(requestedCode);
  } else {
    showStatus(
      "Informe o código impresso no certificado para visualizá-lo e conferir sua autenticidade.",
      {showLookup: true}
    );
  }
})();
