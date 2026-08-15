(function () {
  const page = document.getElementById("subscriptions-page");
  if (!page || !window.HIBForms) return;

  const F = window.HIBForms;
  const apiBase = (page.dataset.apiBase || "").trim().replace(/\/$/, "");

  const loadingSection = document.getElementById("loading-section");
  const loadingStatus = document.getElementById("loading-status");
  const retryButton = document.getElementById("retry-button");

  const loginSection = document.getElementById("login-section");
  const loginStatus = document.getElementById("login-status");
  const loginForm = document.getElementById("magic-link-form");
  const loginEmail = document.getElementById("login-email");
  const loginSubmit = document.getElementById("magic-link-submit");
  const captchaQuestion = document.getElementById("login-captcha-question");
  const captchaInput = document.getElementById("login-captcha");

  const profileSection = document.getElementById("profile-section");
  const profileSummary = document.getElementById("profile-summary");
  const profileForm = document.getElementById("profile-form");
  const profileNickname = document.getElementById("profile-nickname");
  const profilePublic = document.getElementById("profile-public");
  const profileSubmit = document.getElementById("profile-submit");
  const profileNicknameHelp = document.getElementById("profile-nickname-help");

  const listSection = document.getElementById("subscriptions-section");
  const list = document.getElementById("subscription-list");
  const accountEmail = document.getElementById("account-email");
  const logoutButton = document.getElementById("logout-button");

  const cancelModal = document.getElementById("cancelModal");
  const cancelForm = document.getElementById("cancel-form");
  const cancelMessage = document.getElementById("cancel-modal-message");
  const cancelInput = document.getElementById("cancel-confirmation");
  const cancelSubmit = document.getElementById("cancel-submit");
  const cancelWordLabel = document.getElementById("cancel-confirmation-word");

  const feedbackModal = document.getElementById("subscriptionFeedbackModal");
  const feedbackTitle = document.getElementById("subscription-feedback-title");
  const feedbackMessage = document.getElementById("subscription-feedback-message");

  const requiredNodes = [
    loadingSection, loadingStatus, retryButton,
    loginSection, loginStatus, loginForm, loginEmail, loginSubmit, captchaQuestion, captchaInput,
    profileSection, profileSummary, profileForm, profileNickname, profilePublic, profileSubmit,
    profileNicknameHelp,
    listSection, list, accountEmail, logoutButton,
    cancelModal, cancelForm, cancelMessage, cancelInput, cancelSubmit, cancelWordLabel,
    feedbackModal, feedbackTitle, feedbackMessage
  ];
  if (requiredNodes.some((node) => !node)) return;

  const feedback = F.createFeedback(feedbackModal, feedbackTitle, feedbackMessage, {
    success: "Tudo certo",
    error: "Não foi possível concluir"
  });
  const captcha = F.createCaptcha(captchaQuestion, captchaInput, apiBase);

  const SESSION_KEY = "hib.subscriptions.session";
  const SESSION_EXPIRED_MESSAGE =
    "Sua sessão expirou. Informe o e-mail para receber um novo link de acesso.";

  let confirmationWord = "CANCELAR";
  let pendingCancellation = null;

  // Os limites do apelido chegam na resposta do perfil: assim o formulário
  // nunca fica discordando da regra que o Worker aplica de verdade.
  const nicknameLimits = { min: 3, max: 24 };
  const nicknameHelpDefault = profileNicknameHelp.textContent;

  function getSessionToken() {
    try {
      return sessionStorage.getItem(SESSION_KEY) || "";
    } catch {
      return "";
    }
  }

  function setSessionToken(token) {
    try {
      if (token) sessionStorage.setItem(SESSION_KEY, token);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
    }
  }

  function normalizeConfirmation(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toUpperCase();
  }

  function formatEventDate(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "";
    return new Date(time).toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "long",
      year: "numeric"
    });
  }

  // Perto do limite das 24h, só a data faria a pessoa voltar aqui no escuro.
  function formatEventDateTime(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "";
    return new Date(time).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  }



  function showOnly(section) {
    loadingSection.hidden = section !== loadingSection;
    loginSection.hidden = section !== loginSection;
    listSection.hidden = section !== listSection;
    profileSection.hidden = section !== listSection;
  }

  function formatXp(xp) {
    return `${Number(xp || 0).toLocaleString("pt-BR")} XP`;
  }

  function setNicknameError(message) {
    profileNickname.classList.toggle("is-invalid", Boolean(message));
    profileNickname.setAttribute("aria-invalid", message ? "true" : "false");
    profileNicknameHelp.classList.toggle("is-error", Boolean(message));
    profileNicknameHelp.textContent = message || nicknameHelpDefault;
  }

  function normalizeNicknameInput(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  // Mesma checagem do Worker, na mesma ordem — o que muda é só quando ela roda.
  function validateNickname(value) {
    const nickname = normalizeNicknameInput(value);
    if (!nickname) return "Escolha um apelido para aparecer no ranking.";
    if (nickname.length < nicknameLimits.min) {
      return `Apelido muito curto. Use pelo menos ${nicknameLimits.min} caracteres.`;
    }
    if (nickname.length > nicknameLimits.max) {
      return `Apelido muito longo: ${nickname.length} caracteres. O limite é ${nicknameLimits.max}.`;
    }
    return "";
  }

  // Enquanto digita, só o excesso é apontado: avisar "muito curto" na primeira
  // letra seria implicar com quem ainda está escrevendo.
  profileNickname.addEventListener("input", function () {
    const nickname = normalizeNicknameInput(profileNickname.value);
    setNicknameError(
      nickname.length > nicknameLimits.max
        ? `Apelido muito longo: ${nickname.length} caracteres. O limite é ${nicknameLimits.max}.`
        : ""
    );
  });

  function renderProfile(profile) {
    const data = profile || {};
    const xp = Number(data.xp || 0);
    const meetups = Number(data.meetupsAttended || 0);

    const earned = meetups === 1
      ? `${formatXp(xp)} em 1 meetup`
      : `${formatXp(xp)} em ${meetups} meetups`;

    profileSummary.textContent = data.isPublic
      ? `Você tem ${earned} e aparece no ranking como "${data.nickname}".`
      : `Você tem ${earned}. Seu perfil está privado: ninguém vê você no ranking.`;

    if (Number(data.nicknameMinLength) > 0) nicknameLimits.min = Number(data.nicknameMinLength);
    if (Number(data.nicknameMaxLength) > 0) nicknameLimits.max = Number(data.nicknameMaxLength);

    // Não sobrescreve o que a pessoa está digitando enquanto salva.
    if (document.activeElement !== profileNickname) {
      profileNickname.value = data.nickname || "";
      setNicknameError("");
    }
    profilePublic.checked = Boolean(data.isPublic);
  }

  function showLogin(message) {
    showOnly(loginSection);
    retryButton.hidden = true;
    if (message) loginStatus.textContent = message;
    captcha.render();
  }

  function showLoading(message) {
    showOnly(loadingSection);
    retryButton.hidden = true;
    loadingStatus.textContent = message;
  }

  // A hiccup while loading should not cost the person their session — keep
  // them signed in and let them try again.
  function showRetry(message) {
    showOnly(loadingSection);
    loadingStatus.textContent = message;
    retryButton.hidden = false;
  }

  retryButton.addEventListener("click", function () {
    loadRegistrations();
  });

  async function apiFetch(path, options) {
    const config = Object.assign({}, options);
    config.headers = Object.assign({}, config.headers, {
      authorization: `Bearer ${getSessionToken()}`
    });

    const response = await fetch(`${apiBase}${path}`, config);
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function buildEmptyState() {
    const empty = document.createElement("p");
    empty.className = "subscription-empty";
    empty.textContent =
      "Não encontramos inscrições vinculadas a este e-mail. Se você se inscreveu com outro endereço, saia e entre novamente com ele.";
    return empty;
  }

  function buildCard(registration) {
    const card = document.createElement("article");
    card.className = "subscription-card";

    const main = document.createElement("div");
    main.className = "subscription-card-main";

    const badge = document.createElement("span");
    badge.className = `subscription-badge ${registration.isPast ? "is-past" : "is-upcoming"}`;
    badge.textContent = registration.isPast ? "Já realizado" : "Inscrição confirmada";
    main.append(badge);

    // Ao lado do status, e não solto no meio do card: os dois dizem o que
    // aconteceu com aquela inscrição.
    if (registration.xpEarned > 0) {
      const xpBadge = document.createElement("span");
      xpBadge.className = "subscription-badge is-xp";
      xpBadge.textContent = `+${formatXp(registration.xpEarned)}`;
      main.append(xpBadge);
    }

    const title = document.createElement("h3");
    title.textContent = registration.title || registration.meetupSlug;
    main.append(title);

    const eventDate = formatEventDate(registration.eventDate);
    if (eventDate) {
      const meta = document.createElement("p");
      meta.className = "subscription-meta";
      meta.textContent = `Data do meetup: ${eventDate}`;
      main.append(meta);
    }

    if (registration.name) {
      const owner = document.createElement("p");
      owner.className = "subscription-meta";
      owner.textContent = `Inscrição em nome de ${registration.name}`;
      main.append(owner);
    }

    card.append(main);

    const actions = document.createElement("div");
    actions.className = "subscription-actions";

    const certificate = registration.certificate || {};

    if (registration.canCancel) {
      const cancelButton = document.createElement("button");
      cancelButton.type = "button";
      cancelButton.className = "btn btn-danger";
      cancelButton.textContent = "Cancelar inscrição";
      cancelButton.addEventListener("click", function () {
        openCancelModal(registration);
      });
      actions.append(cancelButton);
    } else if (certificate.available) {
      // Emitido ou não, a ação é a mesma: mandar o PDF para o e-mail da
      // inscrição. Reemitir devolve o mesmo documento, com o mesmo número.
      const label = certificate.code
        ? "Reenviar certificado por e-mail"
        : "Receber certificado por e-mail";

      const certificateButton = document.createElement("button");
      certificateButton.type = "button";
      certificateButton.className = certificate.code ? "btn btn-ghost" : "btn btn-primary";
      certificateButton.textContent = label;
      certificateButton.addEventListener("click", function () {
        issueCertificate(registration, certificateButton, label);
      });
      actions.append(certificateButton);
    } else {
      const note = document.createElement("p");
      note.className = "subscription-note";
      note.textContent = certificate.availableAt
        ? `Certificado disponível a partir de ${formatEventDateTime(certificate.availableAt)}.`
        : "Evento encerrado — não é mais possível cancelar.";
      actions.append(note);
    }

    card.append(actions);
    return card;
  }

  async function issueCertificate(registration, button, label) {
    button.disabled = true;
    button.textContent = "Enviando...";

    let result;
    try {
      result = await apiFetch(
        `/api/me/registrations/${encodeURIComponent(registration.meetupSlug)}/certificate`,
        { method: "POST" }
      );
    } catch {
      button.disabled = false;
      button.textContent = label;
      feedback.show("Erro de conexão. Tente novamente.", "error");
      return;
    }

    const { response, data } = result;

    if (response.status === 401) {
      setSessionToken("");
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }

    button.disabled = false;
    button.textContent = label;

    if (!response.ok) {
      feedback.show(data.error || "Não foi possível enviar o certificado.", "error");
      await loadRegistrations();
      return;
    }

    feedback.show(data.message || "Certificado enviado para o seu e-mail.", "success");
    await loadRegistrations();
  }

  function renderList(registrations) {
    list.textContent = "";

    if (registrations.length === 0) {
      list.append(buildEmptyState());
      return;
    }

    registrations.forEach((registration) => list.append(buildCard(registration)));
  }

  async function loadRegistrations() {
    showLoading("Carregando suas inscrições...");

    let result;
    try {
      result = await apiFetch("/api/me/registrations", { method: "GET" });
    } catch {
      showRetry("Erro de conexão ao carregar suas inscrições.");
      return;
    }

    const { response, data } = result;

    if (response.status === 401) {
      setSessionToken("");
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }

    if (!response.ok) {
      showRetry(data.error || "Não foi possível carregar suas inscrições.");
      return;
    }

    confirmationWord = normalizeConfirmation(data.confirmationWord) || confirmationWord;
    cancelWordLabel.textContent = confirmationWord;
    cancelInput.placeholder = confirmationWord;

    accountEmail.textContent = data.email || "";
    renderProfile(data.profile);
    renderList(Array.isArray(data.registrations) ? data.registrations : []);
    showOnly(listSection);
  }

  function closeCancelModal() {
    cancelModal.classList.remove("open");
    pendingCancellation = null;
  }

  function openCancelModal(registration) {
    pendingCancellation = registration;

    cancelMessage.textContent =
      `Você está prestes a cancelar sua inscrição em "${registration.title || registration.meetupSlug}". ` +
      "A vaga será liberada na hora para outra pessoa e esta ação não pode ser desfeita.";

    cancelInput.value = "";
    cancelSubmit.disabled = true;
    cancelModal.classList.add("open");
    window.setTimeout(() => cancelInput.focus(), 50);
  }

  cancelInput.addEventListener("input", function () {
    cancelSubmit.disabled = normalizeConfirmation(cancelInput.value) !== confirmationWord;
  });

  cancelForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    if (!pendingCancellation) return;
    if (normalizeConfirmation(cancelInput.value) !== confirmationWord) {
      cancelSubmit.disabled = true;
      return;
    }

    const registration = pendingCancellation;
    cancelSubmit.disabled = true;
    cancelSubmit.textContent = "Cancelando...";

    let result;
    try {
      result = await apiFetch(
        `/api/me/registrations/${encodeURIComponent(registration.meetupSlug)}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: cancelInput.value })
        }
      );
    } catch {
      closeCancelModal();
      cancelSubmit.textContent = "Cancelar inscrição";
      feedback.show("Erro de conexão. Tente novamente.", "error");
      return;
    }

    closeCancelModal();
    cancelSubmit.textContent = "Cancelar inscrição";

    const { response, data } = result;

    if (response.status === 401) {
      setSessionToken("");
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }

    if (!response.ok) {
      feedback.show(data.error || "Não foi possível cancelar a inscrição.", "error");
      await loadRegistrations();
      return;
    }

    feedback.show(
      data.message || "Inscrição cancelada. A vaga foi liberada para outra pessoa.",
      "success"
    );
    await loadRegistrations();
  });

  profileForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const nickname = normalizeNicknameInput(profileNickname.value);
    const localError = validateNickname(nickname);
    if (localError) {
      setNicknameError(localError);
      feedback.show(localError, "error");
      profileNickname.focus();
      return;
    }
    setNicknameError("");

    profileSubmit.disabled = true;
    profileSubmit.textContent = "Salvando...";

    let result;
    try {
      result = await apiFetch("/api/me/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nickname, isPublic: profilePublic.checked })
      });
    } catch {
      profileSubmit.disabled = false;
      profileSubmit.textContent = "Salvar preferências";
      feedback.show("Erro de conexão. Tente novamente.", "error");
      return;
    }

    profileSubmit.disabled = false;
    profileSubmit.textContent = "Salvar preferências";

    const { response, data } = result;

    if (response.status === 401) {
      setSessionToken("");
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }

    if (!response.ok) {
      const message = data.error || "Não foi possível salvar suas preferências.";
      // 400/409 são sempre sobre o apelido: o erro pertence ao campo, não só
      // ao modal, senão ele some no primeiro clique e a pessoa perde a dica.
      if (response.status === 400 || response.status === 409) {
        setNicknameError(message);
        profileNickname.focus();
      }
      feedback.show(message, "error");
      return;
    }

    setNicknameError("");
    renderProfile(data.profile);
    feedback.show(data.message || "Preferências salvas.", "success");
  });

  logoutButton.addEventListener("click", async function () {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
    }
    setSessionToken("");
    showLogin("Você saiu. Informe o e-mail para receber um novo link de acesso.");
  });

  // Only 3 links are allowed per address every 15 minutes. An impatient second
  // click would quietly spend one, so hold the button after a successful send.
  const RESEND_COOLDOWN_SECONDS = 30;
  let cooldownTimer = null;

  function startResendCooldown() {
    let remaining = RESEND_COOLDOWN_SECONDS;
    loginSubmit.disabled = true;

    const tick = () => {
      loginSubmit.textContent =
        remaining > 0 ? `Link enviado (${remaining}s)` : "Reenviar link de acesso";
      if (remaining > 0) {
        remaining -= 1;
        return;
      }
      window.clearInterval(cooldownTimer);
      cooldownTimer = null;
      loginSubmit.disabled = false;
    };

    tick();
    window.clearInterval(cooldownTimer);
    cooldownTimer = window.setInterval(tick, 1000);
  }

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const email = String(loginEmail.value || "").trim();
    if (!email) return;

    if (!captcha.ready()) {
      feedback.show("Resolva a verificação antes de enviar.", "error");
      captcha.render();
      return;
    }

    loginSubmit.disabled = true;
    loginSubmit.textContent = "Enviando...";

    let sent = false;

    try {
      const response = await fetch(`${apiBase}/api/auth/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          captchaId: captcha.getToken(),
          captcha: Number(captcha.getAnswer())
        })
      });

      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const message =
          data.message ||
          "Se houver inscrições vinculadas a este e-mail, enviamos um link de acesso.";
        loginStatus.textContent = message;
        feedback.show(message, "success");
        loginForm.reset();
        sent = true;
      } else {
        feedback.show(data.error || "Não foi possível enviar o link de acesso.", "error");
      }
    } catch {
      feedback.show("Erro de conexão. Tente novamente.", "error");
    }

    // A used challenge is never valid again, so always issue a fresh one.
    captcha.render();

    if (sent) {
      startResendCooldown();
      return;
    }

    loginSubmit.disabled = false;
    loginSubmit.textContent = "Receber link de acesso";
  });

  async function exchangeAccessToken(token) {
    showLoading("Validando seu link de acesso...");

    let response;
    let data;
    try {
      response = await fetch(`${apiBase}/api/auth/session`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token })
      });
      data = await response.json().catch(() => ({}));
    } catch {
      showLogin("Erro de conexão ao validar o link. Tente novamente.");
      return;
    }

    if (!response.ok || !data.token) {
      setSessionToken("");
      showLogin(data.error || "Link de acesso inválido ou expirado. Solicite um novo.");
      return;
    }

    setSessionToken(data.token);
    await loadRegistrations();
  }

  function takeTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) return "";

    // Drop the token from the address bar so it does not linger in history,
    // bookmarks or anything the user might copy and share.
    params.delete("token");
    const query = params.toString();
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);

    return token;
  }

  if (!apiBase) {
    showLogin("Configuração pendente: defina o domínio da API nesta página.");
  } else {
    const urlToken = takeTokenFromUrl();
    if (urlToken) exchangeAccessToken(urlToken);
    else if (getSessionToken()) loadRegistrations();
    else showLogin();
  }
})();
