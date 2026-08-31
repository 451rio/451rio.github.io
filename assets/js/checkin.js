(function () {
  const page = document.getElementById("checkin-page");
  if (!page || !window.HIBForms) return;

  const F = window.HIBForms;
  const apiBase = (page.dataset.apiBase || "").trim().replace(/\/$/, "");

  const loadingSection = document.getElementById("checkin-loading-section");
  const loadingStatus = document.getElementById("checkin-loading-status");

  const loginSection = document.getElementById("checkin-login-section");
  const loginStatus = document.getElementById("checkin-login-status");
  const loginForm = document.getElementById("checkin-login-form");
  const loginEmail = document.getElementById("checkin-login-email");
  const loginSubmit = document.getElementById("checkin-login-submit");
  const captchaStatus = document.getElementById("checkin-captcha-status");
  const loginFormFields = document.getElementById("checkin-login-form-fields");

  const deniedSection = document.getElementById("checkin-denied-section");

  const scanSection = document.getElementById("checkin-scan-section");
  const scanStatus = document.getElementById("checkin-scan-status");
  const logoutButton = document.getElementById("checkin-logout-button");
  const video = document.getElementById("checkin-video");
  const resultContainer = document.getElementById("checkin-result");

  const requiredNodes = [
    loadingSection, loadingStatus,
    loginSection, loginStatus, loginForm, loginEmail, loginSubmit, captchaStatus, loginFormFields,
    deniedSection,
    scanSection, scanStatus, logoutButton, video, resultContainer
  ];
  if (requiredNodes.some((node) => !node)) return;

  const captcha = F.createCaptcha(apiBase, captchaStatus);

  const SESSION_KEY = "hib.checkin.session";
  const SESSION_EXPIRED_MESSAGE = "Sua sessão expirou. Informe o e-mail para receber um novo link de acesso.";
  const RESCAN_COOLDOWN_MS = 4000;
  const SCAN_INTERVAL_MS = 200;

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
    scanSection.hidden = section !== scanSection;
  }

  function showLoading(message) {
    showOnly(loadingSection);
    loadingStatus.textContent = message;
  }

  function showLogin(message) {
    stopScanning();
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
    stopScanning();
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

  let scanning = false;
  let scanIntervalId = null;
  let stream = null;
  let lastCode = "";
  let lastCodeAt = 0;
  let busy = false;
  const FLASH_DURATION_MS = 3000;

  function stopScanning() {
    scanning = false;
    busy = false;
    if (scanIntervalId !== null) {
      window.clearInterval(scanIntervalId);
      scanIntervalId = null;
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    video.srcObject = null;
    if (window.HIBFlash) window.HIBFlash.hide();
  }

  function showResult(message, kind) {
    resultContainer.textContent = message;
    resultContainer.className = `checkin-result${kind ? ` is-${kind}` : ""}`;
  }

  function flashAndResume(message, type) {
    showResult("", "");
    if (window.HIBFlash) {
      window.HIBFlash.show(message, type, FLASH_DURATION_MS);
      window.setTimeout(() => {
        busy = false;
      }, FLASH_DURATION_MS);
    } else {
      showResult(message, type);
      busy = false;
    }
  }

  async function handleDetectedCode(code) {
    if (busy) return;

    const now = Date.now();
    if (code === lastCode && now - lastCodeAt < RESCAN_COOLDOWN_MS) return;
    lastCode = code;
    lastCodeAt = now;
    busy = true;

    showResult("Verificando...", "pending");

    let response;
    let data;
    try {
      ({ response, data } = await apiFetch("/api/admin/checkin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code })
      }));
    } catch {
      flashAndResume("Erro de conexão. Tente novamente.", "error");
      return;
    }

    if (response.status === 401) {
      busy = false;
      showLogin(SESSION_EXPIRED_MESSAGE);
      return;
    }
    if (response.status === 403) {
      busy = false;
      showDenied();
      return;
    }
    if (!response.ok) {
      flashAndResume(data.error || "Não foi possível confirmar o check-in.", "error");
      return;
    }

    const label = data.alreadyCheckedIn
      ? `✓ ${data.name} já tinha check-in confirmado\n${data.meetupTitle}`
      : `✓ Check-in confirmado: ${data.name}\n${data.meetupTitle}`;
    flashAndResume(label, "success");
  }

  async function scanTick(canvas, ctx, detector) {
    if (!scanning || busy || video.readyState !== video.HAVE_ENOUGH_DATA) return;

    try {
      if (detector) {
        const barcodes = await detector.detect(video);
        if (barcodes.length > 0) handleDetectedCode(barcodes[0].rawValue);
      } else {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const result = window.jsQR(imageData.data, imageData.width, imageData.height);
        if (result && result.data) handleDetectedCode(result.data);
      }
    } catch {
    }
  }

  async function startScanning() {
    showOnly(scanSection);
    scanStatus.textContent = "Aponte a câmera para o QR code da pessoa.";
    showResult("", "");

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
    } catch {
      scanStatus.textContent = "Não foi possível acessar a câmera. Verifique as permissões do navegador.";
      return;
    }

    video.srcObject = stream;
    await video.play();

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const detector = "BarcodeDetector" in window
      ? new window.BarcodeDetector({ formats: ["qr_code"] })
      : null;

    scanning = true;
    scanIntervalId = window.setInterval(() => scanTick(canvas, ctx, detector), SCAN_INTERVAL_MS);
  }

  async function checkAdminAndStart() {
    showLoading("Verificando acesso...");

    let response;
    let data;
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

    startScanning();
  }

  logoutButton.addEventListener("click", function () {
    setSessionToken("");
    showLogin();
  });

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
