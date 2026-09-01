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

  const requiredNodes = [
    loadingSection, loadingStatus,
    loginSection, loginStatus, loginForm, loginEmail, loginSubmit, captchaStatus, loginFormFields,
    deniedSection,
    mainSection, logoutButton, meetupSelect, statusEl, pondEl, lanesEl, startButton,
    winnerBox, winnersSection, winnersList
  ];
  if (requiredNodes.some((node) => !node)) return;

  const captcha = F.createCaptcha(apiBase, captchaStatus);

  // Same key as checkin.js on purpose: logging in once at /checkin/ (or here) keeps
  // both admin tools open for the rest of the tab's session.
  const SESSION_KEY = "hib.checkin.session";
  const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Informe o e-mail para receber um novo link de acesso.";

  const DUCK_COLORS = [
    "#f4d74d", "#ff9f43", "#2fc3a2", "#ff6b9d", "#4dd0e1",
    "#a78bfa", "#ff6b6b", "#82c91e", "#f5f7f8", "#c08552"
  ];
  const DUCK_ACCESSORIES = ["none", "bowtie", "sunglasses", "cap", "flower", "bandana"];

  const MAX_POND_HEIGHT = 480;
  const MIN_LANE_HEIGHT = 20;
  const MAX_LANE_HEIGHT = 46;

  const WINNER_MIN_MS = 4200;
  const WINNER_MAX_MS = 5400;
  const OTHER_MIN_MS = 6200;
  const OTHER_MAX_MS = 9200;
  const WINNER_FLASH_MS = 3200;

  let meetupsCache = [];
  let currentSlug = "";
  let currentDucks = [];
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
    const accessory = DUCK_ACCESSORIES[Math.floor(seed / DUCK_COLORS.length) % DUCK_ACCESSORIES.length];
    return { color, accessory };
  }

  function accessoryMarkup(accessory) {
    switch (accessory) {
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
      default:
        return "";
    }
  }

  function buildDuckSvg(skin) {
    return '<svg class="duckrace-duck-svg" viewBox="0 0 64 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">' +
      `<ellipse cx="26" cy="32" rx="20" ry="13" fill="${skin.color}"/>` +
      '<path d="M14,26 Q24,17 34,26 Q24,31 14,26 Z" fill="rgba(0,0,0,0.15)"/>' +
      `<circle cx="44" cy="17" r="11" fill="${skin.color}"/>` +
      '<circle cx="47" cy="13" r="2" fill="#1a1a1a"/>' +
      accessoryMarkup(skin.accessory) +
      '<path d="M54,15 L64,18 L54,21 Z" fill="#ff9f1c"/>' +
      '</svg>';
  }

  function laneHeightFor(count) {
    if (count <= 0) return MAX_LANE_HEIGHT;
    const fit = Math.floor(MAX_POND_HEIGHT / count);
    return Math.max(MIN_LANE_HEIGHT, Math.min(MAX_LANE_HEIGHT, fit));
  }

  function renderPond(ducks) {
    laneElements = new Map();
    lanesEl.innerHTML = "";

    if (ducks.length === 0) {
      pondEl.hidden = true;
      return;
    }

    pondEl.hidden = false;
    lanesEl.style.setProperty("--duckrace-lane-h", `${laneHeightFor(ducks.length)}px`);

    ducks.forEach((duck) => {
      const lane = document.createElement("div");
      lane.className = "duckrace-lane";

      const runner = document.createElement("div");
      runner.className = "duckrace-runner";

      const nameTag = document.createElement("span");
      nameTag.className = "duckrace-name";
      nameTag.textContent = duck.name;

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
      name.textContent = winner.name;

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

  function setControlsDisabled(disabled) {
    meetupSelect.disabled = disabled;
    startButton.disabled = disabled || currentDucks.length === 0;
  }

  function applyDuckRaceState(state) {
    currentDucks = Array.isArray(state.ducks) ? state.ducks : [];
    renderPond(currentDucks);
    renderWinners(Array.isArray(state.winners) ? state.winners : []);
    updateStartButtonState();

    if (currentDucks.length === 0) {
      statusEl.textContent = (state.winners || []).length > 0
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
      const laneHeightPx = parseFloat(lanesEl.style.getPropertyValue("--duckrace-lane-h")) || 44;
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

    const label = `🏆 Vencedor(a): ${data.winner.name}`;
    winnerBox.textContent = label;
    winnerBox.hidden = false;
    if (window.HIBFlash) window.HIBFlash.show(label, "success", WINNER_FLASH_MS);

    await loadDuckRaceState(currentSlug);
    racing = false;
    setControlsDisabled(false);
  }

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
