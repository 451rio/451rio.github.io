(function () {
  const page = document.getElementById("duckrace-page");
  if (!page || !window.HIBForms) return;

  const F = window.HIBForms;
  const apiBase = (page.dataset.apiBase || "").trim().replace(/\/$/, "");

  const loadingSection = document.getElementById("duckrace-loading-section");
  const loadingStatus = document.getElementById("duckrace-loading-status");

  const loginSection = document.getElementById("duckrace-login-section");
  const loginStatus = document.getElementById("duckrace-login-status");
  const loginForm = document.getElementById("duckrace-login-form");
  const loginEmail = document.getElementById("duckrace-login-email");
  const loginSubmit = document.getElementById("duckrace-login-submit");
  const captchaStatus = document.getElementById("duckrace-captcha-status");
  const loginFormFields = document.getElementById("duckrace-login-form-fields");

  const deniedSection = document.getElementById("duckrace-denied-section");

  const mainSection = document.getElementById("duckrace-main-section");
  const logoutButton = document.getElementById("duckrace-logout-button");
  const meetupSelect = document.getElementById("duckrace-meetup-select");
  const statusEl = document.getElementById("duckrace-status");
  const pondEl = document.getElementById("duckrace-pond");
  const lanesEl = document.getElementById("duckrace-lanes");
  const startButton = document.getElementById("duckrace-start-button");
  const winnerBox = document.getElementById("duckrace-winner");
  const winnersSection = document.getElementById("duckrace-winners-section");
  const winnersList = document.getElementById("duckrace-winners-list");
  const resetButton = document.getElementById("duckrace-reset-button");

  const resetModal = document.getElementById("duckrace-reset-modal");
  const resetForm = document.getElementById("duckrace-reset-form");
  const resetInput = document.getElementById("duckrace-reset-confirmation");
  const resetConfirmButton = document.getElementById("duckrace-reset-confirm-button");

  const requiredNodes = [
    loadingSection, loadingStatus,
    loginSection, loginStatus, loginForm, loginEmail, loginSubmit, captchaStatus, loginFormFields,
    deniedSection,
    mainSection, logoutButton, meetupSelect, statusEl, pondEl, lanesEl, startButton,
    winnerBox, winnersSection, winnersList, resetButton,
    resetModal, resetForm, resetInput, resetConfirmButton
  ];
  if (requiredNodes.some((node) => !node)) return;

  const captcha = F.createCaptcha(apiBase, captchaStatus);

  // Same key as checkin.js on purpose: logging in once at /checkin/ (or here) keeps
  // both admin tools open for the rest of the tab's session.
  const SESSION_KEY = "hib.checkin.session";
  const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Informe o e-mail para receber um novo link de acesso.";

  // Colors, costumes and age variants are three independent axes hashed off the
  // registration id, so ~100 ducks in the same pond still read as distinct individuals
  // without the list needing to be manually curated.
  const DUCK_COLORS = [
    "#f4d74d", "#ff9f43", "#2fc3a2", "#ff6b9d", "#4dd0e1",
    "#a78bfa", "#ff6b6b", "#82c91e", "#f5f7f8", "#c08552",
    "#3a86ff", "#e07a5f"
  ];
  // Superhero-flavored costumes are original silhouettes (cowl + cape, bold cape +
  // emblem) rather than any specific copyrighted character's design.
  const DUCK_COSTUMES = [
    "none", "bowtie", "sunglasses", "cap", "flower", "bandana",
    "cowl-hero", "cape-hero", "wizard", "pirate", "crown", "headphones"
  ];
  const DUCK_VARIANTS = ["adult", "young", "old"];

  const RESET_CONFIRMATION_WORD = "RESETAR";

  const WINNER_MIN_MS = 8000;
  const WINNER_MAX_MS = 10500;
  const OTHER_MIN_MS = 11500;
  const OTHER_MAX_MS = 17000;
  const WINNER_FLASH_MS = 3600;

  let meetupsCache = [];
  let currentSlug = "";
  let currentDucks = [];
  let currentWinnersCount = 0;
  let laneElements = new Map();
  let racing = false;

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

  function showOnly(section) {
    loadingSection.hidden = section !== loadingSection;
    loginSection.hidden = section !== loginSection;
    deniedSection.hidden = section !== deniedSection;
    mainSection.hidden = section !== mainSection;
  }

  function showLoading(message) {
    showOnly(loadingSection);
    loadingStatus.textContent = message;
  }

  function showLogin(message) {
    showOnly(loginSection);
    if (message) loginStatus.textContent = message;
    loginFormFields.hidden = true;
    captcha.render().then(function () {
      if (captcha.ready()) {
        loginFormFields.hidden = false;
      } else {
        loginStatus.textContent = "Não foi possível carregar o formulário. Recarregue a página.";
      }
    });
  }

  function showDenied() {
    showOnly(deniedSection);
  }

  async function apiFetch(path, options) {
    const config = Object.assign({}, options);
    config.headers = Object.assign({}, config.headers, {
      authorization: `Bearer ${getSessionToken()}`
    });
    const response = await fetch(`${apiBase}${path}`, config);
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function hashSeed(value) {
    let hash = 5381;
    const str = String(value);
    for (let i = 0; i < str.length; i += 1) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
    }
    return hash;
  }

  function duckSkinFor(id) {
    const seed = hashSeed(id);
    const color = DUCK_COLORS[seed % DUCK_COLORS.length];
    const costume = DUCK_COSTUMES[Math.floor(seed / DUCK_COLORS.length) % DUCK_COSTUMES.length];
    const variant = DUCK_VARIANTS[
      Math.floor(seed / (DUCK_COLORS.length * DUCK_COSTUMES.length)) % DUCK_VARIANTS.length
    ];
    return { color, costume, variant };
  }

  // Drawn before the head, so a cape reads as attached at the back of the body.
  function costumeBackMarkup(costume) {
    if (costume === "cowl-hero") {
      return '<path d="M8,22 Q2,32 8,40 L22,34 Q15,28 22,24 Z" fill="#1b1b2e"/>';
    }
    if (costume === "cape-hero") {
      return '<path d="M8,22 Q2,32 8,40 L22,34 Q15,28 22,24 Z" fill="#d62828"/>';
    }
    return "";
  }

  function eyeMarkup(variant) {
    if (variant === "young") {
      return '<circle cx="47" cy="13" r="2.6" fill="#1a1a1a"/><circle cx="48" cy="12" r="0.8" fill="#ffffff"/>';
    }
    return '<circle cx="47" cy="13" r="2" fill="#1a1a1a"/>';
  }

  function variantExtraMarkup(variant) {
    if (variant === "old") {
      return '<path d="M40,8 L42,6" stroke="#d9d9d9" stroke-width="1" stroke-linecap="round"/>' +
        '<path d="M43,7 L45,5" stroke="#d9d9d9" stroke-width="1" stroke-linecap="round"/>' +
        '<circle cx="47" cy="13" r="3.4" fill="none" stroke="#3a3a3a" stroke-width="1.1"/>' +
        '<line x1="50.4" y1="13" x2="54" y2="13" stroke="#3a3a3a" stroke-width="1.1"/>';
    }
    return "";
  }

  // Drawn after the eye/variant details, so masks, hats and glasses sit on top of them.
  function costumeFrontMarkup(costume) {
    switch (costume) {
      case "bowtie":
        return '<path d="M30,25 L38,21 L38,29 Z" fill="#e63946"/>' +
          '<path d="M46,25 L38,21 L38,29 Z" fill="#e63946"/>' +
          '<circle cx="38" cy="25" r="1.8" fill="#c1121f"/>';
      case "sunglasses":
        return '<rect x="38" y="11" width="15" height="5" rx="2.5" fill="#111111"/>';
      case "cap":
        return '<path d="M33,10 A11,9 0 0 1 53,10 L53,13 L33,13 Z" fill="#2b6cb0"/>' +
          '<rect x="49" y="10" width="8" height="3" rx="1.5" fill="#1d4e89"/>';
      case "flower":
        return '<g fill="#ff6b9d"><circle cx="37" cy="5" r="2.2"/><circle cx="40" cy="7" r="2.2"/>' +
          '<circle cx="39" cy="10" r="2.2"/><circle cx="35" cy="10" r="2.2"/><circle cx="34" cy="7" r="2.2"/></g>' +
          '<circle cx="37.5" cy="7.5" r="1.6" fill="#f4d74d"/>';
      case "bandana":
        return '<path d="M28,21 L40,21 L34,31 Z" fill="#e63946"/>' +
          '<circle cx="32" cy="24" r="1" fill="#ffffff"/><circle cx="35" cy="26" r="1" fill="#ffffff"/>';
      case "cowl-hero":
        return '<path d="M38,7 L41,1 L43,8 Z" fill="#1b1b2e"/><path d="M46,6 L48,1 L50,7 Z" fill="#1b1b2e"/>' +
          '<rect x="40" y="10" width="14" height="6" rx="2" fill="#1b1b2e"/>';
      case "cape-hero":
        return '<path d="M20,28 L24,32 L20,36 L16,32 Z" fill="#f4d74d" stroke="#d62828" stroke-width="1"/>';
      case "wizard":
        return '<path d="M38,10 L46,1 L54,10 Z" fill="#5b3a99"/><ellipse cx="46" cy="10" rx="9" ry="2" fill="#5b3a99"/>' +
          '<circle cx="46" cy="4" r="1.4" fill="#f4d74d"/>';
      case "pirate":
        return '<path d="M35,9 Q46,1 57,9 Q46,4 35,9 Z" fill="#2b2b2b"/>' +
          '<ellipse cx="47" cy="13" rx="3" ry="2.4" fill="#1a1a1a"/><path d="M40,10 L54,16" stroke="#1a1a1a" stroke-width="1"/>';
      case "crown":
        return '<path d="M36,9 L39,3 L43,8 L47,2 L51,8 L55,3 L58,9 Z" fill="#f4d74d" stroke="#c9a227" stroke-width="0.6"/>' +
          '<circle cx="43" cy="6" r="1" fill="#e63946"/><circle cx="51" cy="6" r="1" fill="#2fc3a2"/>';
      case "headphones":
        return '<path d="M36,11 Q46,1 56,11" fill="none" stroke="#222222" stroke-width="2"/>' +
          '<circle cx="36" cy="13" r="3" fill="#222222"/><circle cx="56" cy="13" r="3" fill="#e63946"/>';
      default:
        return "";
    }
  }

  function buildDuckSvg(skin) {
    return '<svg class="duckrace-duck-svg" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">' +
      `<ellipse cx="26" cy="32" rx="20" ry="13" fill="${skin.color}"/>` +
      '<path d="M14,26 Q24,17 34,26 Q24,31 14,26 Z" fill="rgba(0,0,0,0.15)"/>' +
      costumeBackMarkup(skin.costume) +
      `<circle cx="44" cy="17" r="11" fill="${skin.color}"/>` +
      eyeMarkup(skin.variant) +
      variantExtraMarkup(skin.variant) +
      costumeFrontMarkup(skin.costume) +
      '<path d="M54,15 L64,18 L54,21 Z" fill="#ff9f1c"/>' +
      '</svg>';
  }

  // Fixed density tiers (backed by CSS custom properties per `data-density`) instead of
  // a continuous formula: a pond with ~100 racers needs a hard legibility floor on font
  // size and icon size, which a smooth scale-to-fit curve would eventually shrink past.
  function densityFor(count) {
    if (count <= 10) return "roomy";
    if (count <= 30) return "cozy";
    return "compact";
  }

  function renderPond(ducks) {
    laneElements = new Map();
    lanesEl.innerHTML = "";

    if (ducks.length === 0) {
      pondEl.hidden = true;
      return;
    }

    pondEl.hidden = false;
    lanesEl.dataset.density = densityFor(ducks.length);

    ducks.forEach((duck) => {
      const lane = document.createElement("div");
      lane.className = "duckrace-lane";

      const runner = document.createElement("div");
      runner.className = "duckrace-runner";

      const nameTag = document.createElement("span");
      nameTag.className = "duckrace-name";
      // The id is appended because two checked-in people can share the same name —
      // it's the only thing that disambiguates them at a glance.
      nameTag.textContent = `${duck.name} #${duck.id}`;

      const duckIconHolder = document.createElement("div");
      duckIconHolder.innerHTML = buildDuckSvg(duckSkinFor(duck.id));

      runner.appendChild(nameTag);
      runner.appendChild(duckIconHolder.firstElementChild);
      lane.appendChild(runner);
      lanesEl.appendChild(lane);

      laneElements.set(duck.id, runner);
    });
  }

  function formatWonAt(value) {
    const time = Date.parse(`${String(value || "").replace(" ", "T")}Z`);
    if (!Number.isFinite(time)) return "";
    return new Date(time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function renderWinners(winners) {
    winnersList.innerHTML = "";
    winnersSection.hidden = winners.length === 0;

    winners.forEach((winner) => {
      const li = document.createElement("li");

      const name = document.createElement("span");
      name.className = "duckrace-winner-name";
      name.textContent = `${winner.name} #${winner.id}`;

      const time = document.createElement("span");
      time.className = "duckrace-winner-time";
      time.textContent = formatWonAt(winner.wonAt);

      li.appendChild(name);
      li.appendChild(time);
      winnersList.appendChild(li);
    });
  }

  function updateStartButtonState() {
    startButton.disabled = racing || !currentSlug || currentDucks.length === 0;
  }

  function updateResetButtonState() {
    resetButton.disabled = racing || currentWinnersCount === 0;
  }

  function setControlsDisabled(disabled) {
    meetupSelect.disabled = disabled;
    startButton.disabled = disabled || currentDucks.length === 0;
    resetButton.disabled = disabled || currentWinnersCount === 0;
  }

  function applyDuckRaceState(state) {
    currentDucks = Array.isArray(state.ducks) ? state.ducks : [];
    const winners = Array.isArray(state.winners) ? state.winners : [];
    currentWinnersCount = winners.length;

    renderPond(currentDucks);
    renderWinners(winners);
    updateStartButtonState();
    updateResetButtonState();

    if (currentDucks.length === 0) {
      statusEl.textContent = winners.length > 0
        ? "Todo mundo já ganhou! 🎉"
        : "Ninguém fez check-in ainda neste meetup.";
    } else {
      statusEl.textContent = "";
    }
  }

  async function loadDuckRaceState(slug) {
    statusEl.textContent = "Carregando participantes...";

    let response, data;
    try {
      ({ response, data } = await apiFetch(`/api/admin/meetups/${encodeURIComponent(slug)}/duck-race`, { method: "GET" }));
    } catch {
      statusEl.textContent = "Erro de conexão. Tente novamente.";
      return;
    }

    if (response.status === 401) {
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (response.status === 403) {
      showDenied();
      return;
    }
    if (!response.ok) {
      statusEl.textContent = data.error || "Não foi possível carregar os participantes.";
      return;
    }

    applyDuckRaceState(data);
  }

  function formatMeetupOptionDate(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "";
    return new Date(time).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function pickDefaultSlug(meetups) {
    if (meetups.length === 0) return "";
    const now = Date.now();
    let best = meetups[0];
    let bestDiff = Infinity;

    meetups.forEach((meetup) => {
      const time = Date.parse(meetup.eventDate);
      if (!Number.isFinite(time)) return;
      const diff = Math.abs(time - now);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = meetup;
      }
    });

    return best.slug;
  }

  function populateMeetupSelect(meetups) {
    meetupSelect.innerHTML = "";
    meetups.forEach((meetup) => {
      const option = document.createElement("option");
      option.value = meetup.slug;
      option.textContent = `${meetup.title} — ${formatMeetupOptionDate(meetup.eventDate)}`;
      meetupSelect.appendChild(option);
    });
  }

  async function initMain() {
    showOnly(mainSection);
    winnerBox.hidden = true;

    let response, data;
    try {
      ({ response, data } = await apiFetch("/api/admin/meetups", { method: "GET" }));
    } catch {
      statusEl.textContent = "Erro de conexão. Recarregue a página.";
      return;
    }

    if (response.status === 401) {
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (response.status === 403) {
      showDenied();
      return;
    }
    if (!response.ok || !Array.isArray(data.meetups)) {
      statusEl.textContent = "Não foi possível carregar os meetups.";
      return;
    }

    meetupsCache = data.meetups;
    if (meetupsCache.length === 0) {
      statusEl.textContent = "Nenhum meetup cadastrado.";
      return;
    }

    populateMeetupSelect(meetupsCache);
    currentSlug = pickDefaultSlug(meetupsCache);
    meetupSelect.value = currentSlug;
    await loadDuckRaceState(currentSlug);
  }

  async function checkAdminAndStart() {
    showLoading("Verificando acesso...");

    let response, data;
    try {
      ({ response, data } = await apiFetch("/api/me/admin-status", { method: "GET" }));
    } catch {
      showLoading("Erro de conexão. Recarregue a página.");
      return;
    }

    if (response.status === 401) {
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (!response.ok || !data.isAdmin) {
      showDenied();
      return;
    }

    await initMain();
  }

  // Runs a purely cosmetic race: the winner is already decided server-side by the
  // draw endpoint, so every other duck is given a finish time strictly slower than
  // the winner's. The visible order can vary lap to lap, but who crosses first never does.
  function animateRace(winnerId) {
    return new Promise((resolve) => {
      const laneHeightPx = parseFloat(getComputedStyle(lanesEl).getPropertyValue("--duckrace-lane-h")) || 44;
      const bobAmplitude = Math.min(6, laneHeightPx * 0.12);

      const entries = [];
      laneElements.forEach((runner, id) => {
        const lane = runner.closest(".duckrace-lane");
        const trackWidth = Math.max(0, lane.clientWidth - runner.offsetWidth - 8);
        const isWinner = id === winnerId;
        const finishTime = isWinner
          ? WINNER_MIN_MS + Math.random() * (WINNER_MAX_MS - WINNER_MIN_MS)
          : OTHER_MIN_MS + Math.random() * (OTHER_MAX_MS - OTHER_MIN_MS);

        entries.push({
          el: runner,
          trackWidth,
          finishTime,
          phase: Math.random() * Math.PI * 2,
          isWinner
        });
      });

      if (entries.length === 0) {
        resolve();
        return;
      }

      const start = performance.now();

      function tick(now) {
        const elapsed = now - start;
        let winnerDone = false;

        entries.forEach((entry) => {
          const raw = Math.min(1, elapsed / entry.finishTime);
          const eased = 1 - Math.pow(1 - raw, 3);
          const x = eased * entry.trackWidth;
          const bob = Math.sin(elapsed / 220 + entry.phase) * bobAmplitude;
          entry.el.style.transform = `translate(${x}px, calc(-50% + ${bob}px))`;
          if (entry.isWinner && raw >= 1) winnerDone = true;
        });

        if (winnerDone) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      }

      requestAnimationFrame(tick);
    });
  }

  async function startRace() {
    if (racing || !currentSlug) return;

    racing = true;
    setControlsDisabled(true);
    winnerBox.hidden = true;
    statusEl.textContent = "Sorteando...";

    let response, data;
    try {
      ({ response, data } = await apiFetch(
        `/api/admin/meetups/${encodeURIComponent(currentSlug)}/duck-race/draw`,
        { method: "POST" }
      ));
    } catch {
      statusEl.textContent = "Erro de conexão. Tente novamente.";
      racing = false;
      setControlsDisabled(false);
      return;
    }

    if (response.status === 401) {
      racing = false;
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (response.status === 403) {
      racing = false;
      showDenied();
      return;
    }
    if (response.status === 409 || !response.ok || !data.winner) {
      statusEl.textContent = data.error || "Não foi possível sortear. Tente novamente.";
      racing = false;
      setControlsDisabled(false);
      return;
    }

    statusEl.textContent = "Corrida em andamento...";
    await animateRace(data.winner.id);

    const label = `🏆 Vencedor(a): ${data.winner.name} #${data.winner.id}`;
    winnerBox.textContent = label;
    winnerBox.hidden = false;
    if (window.HIBFlash) window.HIBFlash.show(label, "success", WINNER_FLASH_MS);

    await loadDuckRaceState(currentSlug);
    racing = false;
    setControlsDisabled(false);
  }

  // Combining Diacritical Marks block (U+0300-U+036F), built from char codes instead of
  // a \u escape literal so accented source ambiguity can't creep back in here.
  const COMBINING_MARKS_RE = new RegExp(
    `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
    "g"
  );

  function normalizeConfirmation(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(COMBINING_MARKS_RE, "")
      .trim()
      .toUpperCase();
  }

  function closeResetModal() {
    resetModal.classList.remove("open");
  }

  function openResetModal() {
    resetInput.value = "";
    resetConfirmButton.disabled = true;
    resetModal.classList.add("open");
    window.setTimeout(() => resetInput.focus(), 50);
  }

  resetButton.addEventListener("click", openResetModal);

  resetInput.addEventListener("input", function () {
    resetConfirmButton.disabled = normalizeConfirmation(resetInput.value) !== RESET_CONFIRMATION_WORD;
  });

  resetForm.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (normalizeConfirmation(resetInput.value) !== RESET_CONFIRMATION_WORD) return;
    if (!currentSlug || racing) return;

    resetConfirmButton.disabled = true;
    resetConfirmButton.textContent = "Resetando...";

    let response, data;
    try {
      ({ response, data } = await apiFetch(
        `/api/admin/meetups/${encodeURIComponent(currentSlug)}/duck-race/reset`,
        { method: "POST" }
      ));
    } catch {
      closeResetModal();
      resetConfirmButton.textContent = "Resetar sorteio";
      statusEl.textContent = "Erro de conexão. Tente novamente.";
      return;
    }

    closeResetModal();
    resetConfirmButton.textContent = "Resetar sorteio";

    if (response.status === 401) {
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (response.status === 403) {
      showDenied();
      return;
    }
    if (!response.ok) {
      statusEl.textContent = data.error || "Não foi possível resetar o sorteio.";
      return;
    }

    winnerBox.hidden = true;
    await loadDuckRaceState(currentSlug);
  });

  logoutButton.addEventListener("click", function () {
    setSessionToken("");
    showLogin();
  });

  meetupSelect.addEventListener("change", function () {
    if (racing) return;
    currentSlug = meetupSelect.value;
    if (currentSlug) loadDuckRaceState(currentSlug);
  });

  startButton.addEventListener("click", startRace);

  loginForm.addEventListener("submit", async function (event) {
    event.preventDefault();

    const email = String(loginEmail.value || "").trim();
    if (!email) return;

    if (!captcha.ready()) {
      loginStatus.textContent = "Aguarde a verificação de segurança terminar e tente novamente.";
      return;
    }

    loginSubmit.disabled = true;
    loginSubmit.textContent = "Enviando...";

    try {
      const response = await fetch(`${apiBase}/api/auth/magic-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          purpose: "admin",
          captchaId: captcha.getToken(),
          captcha: Number(captcha.getAnswer())
        })
      });
      const data = await response.json().catch(() => ({}));
      loginStatus.textContent = data.message || "Se o e-mail tiver acesso, enviamos um link de acesso.";
    } catch {
      loginStatus.textContent = "Erro de conexão. Tente novamente.";
    }

    captcha.render();
    loginSubmit.disabled = false;
    loginSubmit.textContent = "Receber link de acesso";
  });

  async function exchangeAccessToken(token) {
    showLoading("Validando seu link de acesso...");

    let response, data;
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
    await checkAdminAndStart();
  }

  function takeTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) return "";

    params.delete("token");
    const query = params.toString();
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);

    return F.isOpaqueToken(token) ? token : "";
  }

  if (!apiBase) {
    showLogin("Configuração pendente: defina o domínio da API nesta página.");
  } else {
    const urlToken = takeTokenFromUrl();
    if (urlToken) exchangeAccessToken(urlToken);
    else if (getSessionToken()) checkAdminAndStart();
    else showLogin();
  }
})();
