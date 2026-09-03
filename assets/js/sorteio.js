(function () {
  const section = document.getElementById("duckrace-section");
  if (!section) return;

  const meetupSelect = document.getElementById("duckrace-meetup-select");
  const statusEl = document.getElementById("duckrace-status");
  const pondEl = document.getElementById("duckrace-pond");
  const lanesEl = document.getElementById("duckrace-lanes");
  const startButton = document.getElementById("duckrace-start-button");
  const muteButton = document.getElementById("duckrace-mute-button");
  const fullscreenButton = document.getElementById("duckrace-fullscreen-button");
  const stageEl = document.getElementById("duckrace-stage");
  const winnerBox = document.getElementById("duckrace-winner");
  const winnersSection = document.getElementById("duckrace-winners-section");
  const winnersList = document.getElementById("duckrace-winners-list");
  const resetButton = document.getElementById("duckrace-reset-button");

  const resetModal = document.getElementById("duckrace-reset-modal");
  const resetForm = document.getElementById("duckrace-reset-form");
  const resetInput = document.getElementById("duckrace-reset-confirmation");
  const resetConfirmButton = document.getElementById("duckrace-reset-confirm-button");

  const requiredNodes = [
    meetupSelect, statusEl, pondEl, lanesEl, startButton, muteButton, fullscreenButton, stageEl,
    winnerBox, winnersSection, winnersList, resetButton,
    resetModal, resetForm, resetInput, resetConfirmButton
  ];
  if (requiredNodes.some((node) => !node)) return;

  let apiFetch = null;
  let feedback = { show() {} };
  let onSessionExpired = function () {};
  let onForbidden = function () {};
  let started = false;

  const DUCK_COLORS = [
    "#f4d74d", "#ff9f43", "#2fc3a2", "#ff6b9d", "#4dd0e1",
    "#a78bfa", "#ff6b6b", "#82c91e", "#f5f7f8", "#c08552",
    "#3a86ff", "#e07a5f"
  ];
  const DUCK_COSTUMES = [
    "none", "bowtie", "sunglasses", "cap", "flower", "bandana",
    "cowl-hero", "cape-hero", "wizard", "pirate", "crown", "headphones"
  ];
  const DUCK_VARIANTS = ["adult", "young", "old"];

  const RESET_CONFIRMATION_WORD = "RESETAR";

  const WINNER_MIN_MS = 13000;
  const WINNER_MAX_MS = 16000;
  const OTHER_MIN_MS = 17500;
  const OTHER_MAX_MS = 25000;
  const WINNER_FLASH_MS = 3600;
  const START_STAGGER_MS = 350;
  const QUACK_MIN_GAP_MS = 450;
  const QUACK_GAP_SPREAD_MS = 900;
  const VICTORY_RUN_MS = 1600;
  const VICTORY_RUN_PX = 42;

  let meetupsCache = [];
  let currentSlug = "";
  let currentDucks = [];
  let currentWinnersCount = 0;
  let laneElements = new Map();
  let racing = false;
  let liveEntries = null;

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

  function densityFor(count) {
    if (count <= 10) return "roomy";
    if (count <= 30) return "cozy";
    return "compact";
  }

  const MIN_READABLE_LANE = 18;
  const MAX_COLUMNS = 4;

  function availableHeight() {
    if (isFullscreen()) {
      const chrome = Array.from(stageEl.children)
        .filter((child) => child !== pondEl && !child.hidden)
        .reduce((total, child) => total + child.offsetHeight, 0);
      return Math.max(240, stageEl.clientHeight - chrome - 24);
    }
    return Math.max(240, Math.round(window.innerHeight * 0.7));
  }

  function columnsFor(count) {
    if (count <= 0) return 1;
    const perColumn = Math.max(1, Math.floor(availableHeight() / MIN_READABLE_LANE));
    return Math.max(1, Math.min(MAX_COLUMNS, Math.ceil(count / perColumn)));
  }

  function buildRunner(duck) {
    const runner = document.createElement("div");
    runner.className = "duckrace-runner";

    const nameTag = document.createElement("span");
    nameTag.className = "duckrace-name";

    const nameText = document.createElement("span");
    nameText.className = "duckrace-name-text";
    nameText.textContent = duck.name;

    const nameId = document.createElement("span");
    nameId.className = "duckrace-name-id";
    nameId.textContent = ` #${duck.id}`;

    nameTag.appendChild(nameText);
    nameTag.appendChild(nameId);

    const holder = document.createElement("div");
    holder.innerHTML = buildDuckSvg(duckSkinFor(duck.id));

    runner.appendChild(nameTag);
    runner.appendChild(holder.firstElementChild);
    return runner;
  }

  function renderPond(ducks) {
    laneElements = new Map();
    lanesEl.innerHTML = "";

    if (ducks.length === 0) {
      pondEl.hidden = true;
      return;
    }

    pondEl.hidden = false;

    const columns = columnsFor(ducks.length);
    const perColumn = Math.ceil(ducks.length / columns);
    lanesEl.style.setProperty("--duckrace-columns", String(columns));
    lanesEl.dataset.density = densityFor(perColumn);

    for (let c = 0; c < columns; c += 1) {
      const column = document.createElement("div");
      column.className = "duckrace-column";

      const group = document.createElement("div");
      group.className = "duckrace-lane-group";

      for (const duck of ducks.slice(c * perColumn, (c + 1) * perColumn)) {
        const lane = document.createElement("div");
        lane.className = "duckrace-lane";

        const runner = buildRunner(duck);
        lane.appendChild(runner);
        group.appendChild(lane);
        laneElements.set(duck.id, runner);
      }

      const finish = document.createElement("div");
      finish.className = "duckrace-finish";
      finish.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.className = "duckrace-finish-label";
      label.textContent = "Chegada";
      finish.appendChild(label);

      column.appendChild(group);
      column.appendChild(finish);
      lanesEl.appendChild(column);
    }

    fitStage();
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
      onSessionExpired();
      return;
    }
    if (response.status === 403) {
      onForbidden();
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

  async function loadMeetups() {
    winnerBox.hidden = true;

    let response, data;
    try {
      ({ response, data } = await apiFetch("/api/admin/meetups", { method: "GET" }));
    } catch {
      statusEl.textContent = "Erro de conexão. Recarregue a página.";
      return;
    }

    if (response.status === 401) {
      onSessionExpired();
      return;
    }
    if (response.status === 403) {
      onForbidden();
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

  function createAudioEngine() {
    let ctx = null;
    let muted = false;

    function getCtx() {
      if (!ctx) {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        try {
          ctx = new AudioCtor();
        } catch {
          return null;
        }
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }

    function tone(audioCtx, startAt, options) {
      try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = options.type || "sine";
        osc.frequency.setValueAtTime(options.from, startAt);
        if (options.to) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(options.to, 1), startAt + options.duration);
        }
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(options.peak, startAt + options.duration * 0.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + options.duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(startAt);
        osc.stop(startAt + options.duration + 0.03);
      } catch {
      }
    }

    return {
      prime() {
        getCtx();
      },
      playStart() {
        if (muted) return;
        const audioCtx = getCtx();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        tone(audioCtx, now, { from: 392, duration: 0.2, type: "sawtooth", peak: 0.16 });
        tone(audioCtx, now + 0.18, { from: 523.25, duration: 0.4, type: "sawtooth", peak: 0.18 });
      },
      playQuack() {
        if (muted) return;
        const audioCtx = getCtx();
        if (!audioCtx) return;
        const from = 520 + Math.random() * 140;
        tone(audioCtx, audioCtx.currentTime, {
          from,
          to: from * 0.45,
          duration: 0.13,
          type: "square",
          peak: 0.07
        });
      },
      playVictory() {
        if (muted) return;
        const audioCtx = getCtx();
        if (!audioCtx) return;
        const now = audioCtx.currentTime;
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, index) => {
          tone(audioCtx, now + index * 0.13, { from: freq, duration: 0.26, type: "triangle", peak: 0.15 });
        });
      },
      setMuted(value) {
        muted = value;
      },
      isMuted() {
        return muted;
      }
    };
  }

  const audio = createAudioEngine();

  const FIT_MIN_LANE = 12;
  const FIT_MAX_LANE = 46;

  function fitStage() {
    if (currentDucks.length === 0) {
      for (const prop of ["--duckrace-lane-h", "--duckrace-name-size", "--duckrace-duck-w", "--duckrace-name-max-w"]) {
        lanesEl.style.removeProperty(prop);
      }
      return;
    }

    const columns = Number(lanesEl.style.getPropertyValue("--duckrace-columns")) || 1;
    const perColumn = Math.ceil(currentDucks.length / columns);
    const lane = Math.max(FIT_MIN_LANE, Math.min(FIT_MAX_LANE, Math.floor(availableHeight() / perColumn)));

    lanesEl.style.setProperty("--duckrace-lane-h", `${lane}px`);
    lanesEl.style.setProperty("--duckrace-duck-w", `${Math.max(14, Math.round(lane * 0.9))}px`);
    lanesEl.style.setProperty("--duckrace-name-size", `${Math.max(9, Math.round(lane * 0.4))}px`);
    lanesEl.style.setProperty("--duckrace-name-max-w", `${Math.max(64, Math.round(lane * 6))}px`);
  }

  function measureTrack(entry) {
    const lane = entry.el.closest(".duckrace-lane");
    if (!lane) return entry.trackWidth;
    return Math.max(0, lane.clientWidth - entry.el.offsetWidth - 8);
  }

  function remeasureTrack() {
    if (!liveEntries) return;
    for (const entry of liveEntries) {
      const next = measureTrack(entry);
      if (entry.frozenX !== null && entry.trackWidth > 0) {
        entry.frozenX = (entry.frozenX / entry.trackWidth) * next;
      }
      entry.trackWidth = next;
    }
  }

  function isFullscreen() {
    return Boolean(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function syncFullscreenButton() {
    const active = isFullscreen();
    fullscreenButton.textContent = active ? "⛶ Sair da tela cheia" : "⛶ Tela cheia";
    fullscreenButton.setAttribute("aria-pressed", active ? "true" : "false");

    const overlay = document.querySelector(".flash-message");
    if (overlay) {
      if (active) stageEl.appendChild(overlay);
      else document.body.appendChild(overlay);
    }

    fitStage();
    remeasureTrack();
  }

  async function toggleFullscreen() {
    try {
      if (isFullscreen()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        return;
      }
      if (stageEl.requestFullscreen) await stageEl.requestFullscreen();
      else if (stageEl.webkitRequestFullscreen) stageEl.webkitRequestFullscreen();
    } catch {
      feedback.show("Não foi possível abrir a tela cheia neste navegador.", "error");
    }
  }

  function raceProgress(entry, elapsed) {
    const span = Math.max(1, entry.finishTime - entry.startDelay);
    const u = Math.min(1, Math.max(0, (elapsed - entry.startDelay) / span));
    if (u <= 0) return 0;
    if (u >= 1) return 1;

    const envelope = Math.sin(Math.PI * u);
    const surge = entry.surgeAmp * Math.sin(2 * Math.PI * entry.surgeFreq * u + entry.surgePhase) * envelope;
    const ripple = entry.rippleAmp * Math.sin(2 * Math.PI * entry.rippleFreq * u + entry.ripplePhase) * envelope;

    return Math.min(1, Math.max(0, u + surge + ripple));
  }

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
          startDelay: Math.random() * START_STAGGER_MS,
          surgeAmp: 0.05 + Math.random() * 0.035,
          surgeFreq: 0.5 + Math.random() * 0.3,
          surgePhase: Math.random() * Math.PI * 2,
          rippleAmp: 0.008 + Math.random() * 0.007,
          rippleFreq: 1.2 + Math.random() * 0.5,
          ripplePhase: Math.random() * Math.PI * 2,
          bobPhase: Math.random() * Math.PI * 2,
          frozenX: null,
          isWinner
        });
      });

      if (entries.length === 0) {
        resolve();
        return;
      }

      liveEntries = entries;
      const winnerEntry = entries.find((entry) => entry.isWinner) || entries[0];
      const start = performance.now();
      let nextQuackAt = QUACK_MIN_GAP_MS + Math.random() * QUACK_GAP_SPREAD_MS;
      let winnerCrossedAt = null;

      function tick(now) {
        const elapsed = now - start;

        if (winnerCrossedAt === null && elapsed >= nextQuackAt) {
          audio.playQuack();
          nextQuackAt = elapsed + QUACK_MIN_GAP_MS + Math.random() * QUACK_GAP_SPREAD_MS;
        }

        if (winnerCrossedAt === null && elapsed >= winnerEntry.finishTime) {
          winnerCrossedAt = elapsed;
          audio.playVictory();
          entries.forEach((entry) => {
            if (!entry.isWinner) entry.frozenX = raceProgress(entry, elapsed) * entry.trackWidth;
          });
        }

        entries.forEach((entry) => {
          let x;
          if (entry.frozenX !== null) {
            x = entry.frozenX;
          } else if (entry.isWinner && winnerCrossedAt !== null) {
            const victory = Math.min(1, (elapsed - winnerCrossedAt) / VICTORY_RUN_MS);
            x = entry.trackWidth + (1 - Math.pow(1 - victory, 3)) * VICTORY_RUN_PX;
          } else {
            x = raceProgress(entry, elapsed) * entry.trackWidth;
          }

          const bob = Math.sin(elapsed / 220 + entry.bobPhase) * bobAmplitude;
          entry.el.style.transform = `translate(${x}px, calc(-50% + ${bob}px))`;
        });

        if (winnerCrossedAt !== null && elapsed - winnerCrossedAt >= VICTORY_RUN_MS) {
          liveEntries = null;
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

    audio.prime();
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
      onSessionExpired();
      return;
    }
    if (response.status === 403) {
      racing = false;
      onForbidden();
      return;
    }
    if (response.status === 409 || !response.ok || !data.winner) {
      statusEl.textContent = data.error || "Não foi possível sortear. Tente novamente.";
      racing = false;
      setControlsDisabled(false);
      return;
    }

    statusEl.textContent = "Corrida em andamento...";
    audio.playStart();
    await animateRace(data.winner.id);

    const label = `🏆 Vencedor(a): ${data.winner.name} #${data.winner.id}`;
    winnerBox.textContent = label;
    winnerBox.hidden = false;
    if (window.HIBFlash) {
      window.HIBFlash.show(label, "success", WINNER_FLASH_MS);
      if (isFullscreen()) {
        const overlay = document.querySelector(".flash-message");
        if (overlay) stageEl.appendChild(overlay);
      }
    }

    await loadDuckRaceState(currentSlug);
    racing = false;
    setControlsDisabled(false);
  }

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
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation: resetInput.value })
        }
      ));
    } catch {
      closeResetModal();
      resetConfirmButton.textContent = "Resetar sorteio";
      feedback.show("Erro de conexão. Tente novamente.", "error");
      return;
    }

    closeResetModal();
    resetConfirmButton.textContent = "Resetar sorteio";

    if (response.status === 401) {
      onSessionExpired();
      return;
    }
    if (response.status === 403) {
      onForbidden();
      return;
    }
    if (!response.ok) {
      feedback.show(data.error || "Não foi possível resetar o sorteio.", "error");
      return;
    }

    winnerBox.hidden = true;
    await loadDuckRaceState(currentSlug);
  });


  meetupSelect.addEventListener("change", function () {
    if (racing) return;
    currentSlug = meetupSelect.value;
    if (currentSlug) loadDuckRaceState(currentSlug);
  });

  startButton.addEventListener("click", startRace);
  fullscreenButton.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", syncFullscreenButton);
  document.addEventListener("webkitfullscreenchange", syncFullscreenButton);
  window.addEventListener("resize", function () {
    fitStage();
    remeasureTrack();
  });

  muteButton.addEventListener("click", function () {
    const nextMuted = !audio.isMuted();
    audio.setMuted(nextMuted);
    muteButton.textContent = nextMuted ? "🔇 Som desligado" : "🔊 Som ligado";
    muteButton.setAttribute("aria-pressed", nextMuted ? "true" : "false");
  });


  window.HIBDuckRace = {
    start(deps) {
      apiFetch = deps.apiFetch;
      if (deps.feedback) feedback = deps.feedback;
      if (deps.onSessionExpired) onSessionExpired = deps.onSessionExpired;
      if (deps.onForbidden) onForbidden = deps.onForbidden;

      section.hidden = false;
      if (started) return;
      started = true;
      loadMeetups();
    },
    stop() {
      section.hidden = true;
      closeResetModal();
    },
    isStarted() {
      return started;
    }
  };
})();
