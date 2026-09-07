(function () {
  const section = document.getElementById("survey-results-section");
  if (!section) return;

  const meetupSelect = document.getElementById("survey-results-meetup-select");
  const statusEl = document.getElementById("survey-results-status");
  const summaryEl = document.getElementById("survey-results-summary");
  const chartsEl = document.getElementById("survey-results-charts");
  const commentsSection = document.getElementById("survey-results-comments-section");
  const commentsCount = document.getElementById("survey-results-comments-count");
  const commentsList = document.getElementById("survey-results-comments-list");
  const reloadButton = document.getElementById("survey-results-reload");

  const nodes = [
    meetupSelect, statusEl, summaryEl, chartsEl,
    commentsSection, commentsCount, commentsList, reloadButton
  ];
  if (nodes.some((node) => !node)) return;

  // Escala de 1 (pior) a 5 (melhor) — vermelho para verde.
  const SCALE_COLORS = ["#ff6b6b", "#ff9f43", "#f4d74d", "#8fd14f", "#2fc3a2"];

  let apiFetch = null;
  let onSessionExpired = function () {};
  let onForbidden = function () {};
  let started = false;

  let questionsMeta = [];
  let currentSlug = "";
  let loading = false;

  function metaFor(key) {
    return questionsMeta.find((question) => question.key === key) || null;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function formatAverage(value) {
    return Number(value).toLocaleString("pt-BR", {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1
    });
  }

  function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
  }

  function formatDate(value) {
    if (!value) return "";
    const raw = String(value).includes("T") ? value : `${String(value).replace(" ", "T")}Z`;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    });
  }

  function renderSummary(data) {
    clear(summaryEl);

    const rated = data.questions.filter((question) => typeof question.average === "number");
    const overall = rated.length > 0
      ? rated.reduce((sum, question) => sum + question.average, 0) / rated.length
      : 0;

    const recommendation = data.questions.find((question) => question.key === "recommendation");
    const promoters = recommendation
      ? (recommendation.counts[3] + recommendation.counts[4])
      : 0;

    const tiles = [
      { label: "Respostas", value: String(data.totalResponses) },
      { label: "Média geral", value: `${formatAverage(overall)} / 5` },
      {
        label: "Indicariam o evento",
        value: data.totalResponses > 0 ? formatPercent(promoters / data.totalResponses) : "—"
      },
      { label: "Comentários", value: String(data.comments.length) }
    ];

    for (const tile of tiles) {
      const card = el("div", "survey-stat");
      card.appendChild(el("p", "survey-stat-value", tile.value));
      card.appendChild(el("p", "survey-stat-label", tile.label));
      summaryEl.appendChild(card);
    }
  }

  function renderAverageRanking(data) {
    const card = el("article", "survey-chart-card");
    card.appendChild(el("h3", "survey-chart-title", "Média por pergunta"));
    card.appendChild(el(
      "p",
      "survey-chart-hint",
      "Escala de 1 (pior) a 5 (melhor). Ordenado da melhor para a pior nota."
    ));

    const rows = data.questions
      .filter((question) => typeof question.average === "number")
      .slice()
      .sort((a, b) => b.average - a.average);

    const chart = el("div", "survey-ranking");
    for (const question of rows) {
      const meta = metaFor(question.key);
      const row = el("div", "survey-ranking-row");
      row.appendChild(el("span", "survey-ranking-label", meta ? meta.short : question.key));

      const track = el("div", "survey-ranking-track");
      const fill = el("div", "survey-ranking-fill");
      fill.style.width = `${(question.average / 5) * 100}%`;
      fill.style.background = SCALE_COLORS[Math.max(0, Math.min(4, Math.round(question.average) - 1))];
      track.appendChild(fill);
      row.appendChild(track);

      row.appendChild(el("span", "survey-ranking-value", formatAverage(question.average)));
      chart.appendChild(row);
    }

    card.appendChild(chart);
    return card;
  }

  function renderQuestionCard(question, total) {
    const meta = metaFor(question.key);
    const card = el("article", "survey-chart-card");
    card.appendChild(el("h3", "survey-chart-title", meta ? meta.label : question.key));

    const subtitle = typeof question.average === "number"
      ? `${total} resposta${total === 1 ? "" : "s"} · média ${formatAverage(question.average)} / 5`
      : `${total} resposta${total === 1 ? "" : "s"}`;
    card.appendChild(el("p", "survey-chart-hint", subtitle));

    const bar = el("div", "survey-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute(
      "aria-label",
      question.counts
        .map((count, index) => {
          const label = meta ? meta.options[index] : String(index + 1);
          return `${label}: ${count}`;
        })
        .join(", ")
    );

    question.counts.forEach(function (count, index) {
      if (count === 0) return;
      const share = count / total;
      const segment = el("div", "survey-bar-segment");
      segment.style.width = `${share * 100}%`;
      segment.style.background = SCALE_COLORS[index];
      if (share >= 0.12) segment.textContent = formatPercent(share);
      bar.appendChild(segment);
    });

    card.appendChild(bar);

    const legend = el("ul", "survey-legend");
    question.counts.forEach(function (count, index) {
      const item = el("li", "survey-legend-item");
      const dot = el("span", "survey-legend-dot");
      dot.style.background = SCALE_COLORS[index];
      item.appendChild(dot);
      item.appendChild(el("span", "survey-legend-label", meta ? meta.options[index] : String(index + 1)));
      item.appendChild(el(
        "span",
        "survey-legend-value",
        `${count} · ${total > 0 ? formatPercent(count / total) : "0%"}`
      ));
      legend.appendChild(item);
    });
    card.appendChild(legend);

    return card;
  }

  function renderComments(comments) {
    clear(commentsList);
    commentsCount.textContent = comments.length === 1
      ? "1 comentário"
      : `${comments.length} comentários`;

    if (comments.length === 0) {
      commentsSection.hidden = true;
      return;
    }

    for (const comment of comments) {
      const item = el("li", "survey-comment");
      item.appendChild(el("p", "survey-comment-text", comment.text));
      const date = formatDate(comment.createdAt);
      if (date) item.appendChild(el("p", "survey-comment-date", date));
      commentsList.appendChild(item);
    }

    commentsSection.hidden = false;
  }

  function renderResults(data) {
    renderSummary(data);

    clear(chartsEl);
    if (data.totalResponses > 0) {
      chartsEl.appendChild(renderAverageRanking(data));
      for (const question of data.questions) {
        chartsEl.appendChild(renderQuestionCard(question, data.totalResponses));
      }
    }

    renderComments(data.comments);
  }

  function renderEmpty() {
    clear(summaryEl);
    clear(chartsEl);
    clear(commentsList);
    commentsSection.hidden = true;
  }

  async function loadResults(slug) {
    if (!slug || loading) return;
    loading = true;
    setStatus("Carregando respostas...");
    reloadButton.disabled = true;

    let response, data;
    try {
      ({ response, data } = await apiFetch(
        `/api/admin/meetups/${encodeURIComponent(slug)}/survey`,
        { method: "GET" }
      ));
    } catch {
      loading = false;
      reloadButton.disabled = false;
      setStatus("Erro de conexão. Tente novamente.");
      return;
    }

    loading = false;
    reloadButton.disabled = false;

    if (response.status === 401) return onSessionExpired();
    if (response.status === 403) return onForbidden();

    if (!response.ok || !data || !Array.isArray(data.questions)) {
      renderEmpty();
      setStatus((data && data.error) || "Não foi possível carregar as respostas.");
      return;
    }

    if (data.totalResponses === 0) {
      renderEmpty();
      setStatus("Nenhuma resposta recebida para este meetup ainda.");
      return;
    }

    setStatus("");
    renderResults(data);
  }

  async function loadMeetups() {
    let response, data;
    try {
      ({ response, data } = await apiFetch("/api/admin/meetups", { method: "GET" }));
    } catch {
      setStatus("Erro de conexão ao carregar os meetups.");
      return;
    }

    if (response.status === 401) return onSessionExpired();
    if (response.status === 403) return onForbidden();
    if (!response.ok || !Array.isArray(data.meetups)) {
      setStatus("Não foi possível carregar a lista de meetups.");
      return;
    }

    clear(meetupSelect);
    for (const meetup of data.meetups) {
      const option = document.createElement("option");
      option.value = meetup.slug;
      option.textContent = meetup.title;
      meetupSelect.appendChild(option);
    }

    if (data.meetups.length === 0) {
      setStatus("Nenhum meetup cadastrado ainda.");
      return;
    }

    currentSlug = meetupSelect.value;
    loadResults(currentSlug);
  }

  meetupSelect.addEventListener("change", function () {
    currentSlug = meetupSelect.value;
    renderEmpty();
    loadResults(currentSlug);
  });

  reloadButton.addEventListener("click", function () {
    if (currentSlug) loadResults(currentSlug);
  });

  window.HIBSurveyResults = {
    start(deps) {
      apiFetch = deps.apiFetch;
      if (deps.onSessionExpired) onSessionExpired = deps.onSessionExpired;
      if (deps.onForbidden) onForbidden = deps.onForbidden;

      questionsMeta = Array.isArray(window.HIBSurveyQuestions) ? window.HIBSurveyQuestions : [];

      section.hidden = false;
      if (started) return;
      started = true;
      loadMeetups();
    },
    stop() {
      section.hidden = true;
    },
    isStarted() {
      return started;
    }
  };
})();
