(function () {
  const page = document.getElementById("ranking-page");
  if (!page) return;

  const apiBase = (page.dataset.apiBase || "").trim().replace(/\/$/, "");

  const status = document.getElementById("ranking-status");
  const retryButton = document.getElementById("ranking-retry");
  const list = document.getElementById("ranking-list");

  if (!status || !retryButton || !list) return;

  function formatXp(xp) {
    return `${Number(xp || 0).toLocaleString("pt-BR")} XP`;
  }

  function buildRow(entry) {
    const item = document.createElement("li");
    item.className = "ranking-row";
    if (entry.position <= 3) item.classList.add(`is-top-${entry.position}`);

    const position = document.createElement("span");
    position.className = "ranking-position";
    position.textContent = `${entry.position}º`;

    const nickname = document.createElement("span");
    nickname.className = "ranking-nickname";
    nickname.textContent = entry.nickname;

    const xp = document.createElement("span");
    xp.className = "ranking-xp";
    xp.textContent = formatXp(entry.xp);

    item.append(position, nickname, xp);
    return item;
  }

  function render(ranking) {
    list.textContent = "";

    if (ranking.length === 0) {
      list.hidden = true;
      status.textContent =
        "Ninguém no ranking ainda. Ative seu perfil público em Minha conta para ser a primeira pessoa da lista.";
      return;
    }

    ranking.forEach((entry) => list.append(buildRow(entry)));
    list.hidden = false;
    status.textContent = `Mostrando ${ranking.length} ${ranking.length === 1 ? "participante" : "participantes"}.`;
  }

  async function loadRanking() {
    status.textContent = "Carregando ranking...";
    retryButton.hidden = true;
    list.hidden = true;

    let response;
    let data;
    try {
      response = await fetch(`${apiBase}/api/ranking`);
      data = await response.json().catch(() => ({}));
    } catch {
      status.textContent = "Erro de conexão ao carregar o ranking.";
      retryButton.hidden = false;
      return;
    }

    if (!response.ok) {
      status.textContent = data.error || "Não foi possível carregar o ranking.";
      retryButton.hidden = false;
      return;
    }

    render(Array.isArray(data.ranking) ? data.ranking : []);
  }

  retryButton.addEventListener("click", loadRanking);

  if (!apiBase) {
    status.textContent = "Configuração pendente: defina o domínio da API nesta página.";
    return;
  }

  loadRanking();
})();
