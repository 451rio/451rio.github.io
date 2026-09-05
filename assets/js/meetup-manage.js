(function () {
  const section = document.getElementById("meetup-manage-section");
  if (!section) return;

  const createButton = document.getElementById("manage-create-button");
  const editButton = document.getElementById("manage-edit-button");

  const pickModal = document.getElementById("meetupPickModal");
  const pickSearch = document.getElementById("pick-search");
  const pickList = document.getElementById("pick-list");

  const formModal = document.getElementById("meetupFormModal");
  const formTitle = document.getElementById("meetup-form-title");
  const fTitle = document.getElementById("mf-title");
  const fSlug = document.getElementById("mf-slug");
  const fSlugHelp = document.getElementById("mf-slug-help");
  const fDate = document.getElementById("mf-date");
  const fDuration = document.getElementById("mf-duration");
  const fCapacity = document.getElementById("mf-capacity");
  const fOpen = document.getElementById("mf-open");
  const formStatus = document.getElementById("meetup-form-status");
  const formSave = document.getElementById("meetup-form-save");
  const formBack = document.getElementById("meetup-form-back");
  const attendanceButton = document.getElementById("manage-attendance-button");
  const exportButton = document.getElementById("manage-export-button");

  const manageModal = document.getElementById("manageModal");
  const manageTitle = document.getElementById("manage-modal-title");
  const manageSearch = document.getElementById("manage-search");
  const manageStatus = document.getElementById("manage-status");
  const manageList = document.getElementById("manage-list");
  const manageSave = document.getElementById("manage-save-button");
  const manageBack = document.getElementById("manage-back-button");

  const nodes = [
    createButton, editButton,
    pickModal, pickSearch, pickList,
    formModal, formTitle, fTitle, fSlug, fSlugHelp, fDate, fDuration, fCapacity, fOpen, formStatus, formSave, formBack, attendanceButton, exportButton,
    manageModal, manageTitle, manageSearch, manageStatus, manageList, manageSave, manageBack
  ];
  if (nodes.some((node) => !node)) return;

  let apiFetch = null;
  let feedback = {show() {}};
  let onSessionExpired = function () {};
  let onForbidden = function () {};
  let started = false;

  let meetupsCache = [];
  let formMode = "create";
  let editingSlug = "";

  let records = [];
  const original = new Map();
  const pending = new Map();

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function open(modal) {
    modal.classList.add("open");
  }
  function close(modal) {
    modal.classList.remove("open");
  }

  function formatMeetupOptionDate(value) {
    const time = Date.parse(String(value || ""));
    if (!Number.isFinite(time)) return "";
    return new Date(time).toLocaleDateString("pt-BR", {day: "2-digit", month: "2-digit", year: "numeric"});
  }

  function eventDateToInput(value) {
    const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
    return match ? match[1] : "";
  }
  function inputToEventDate(value) {
    const trimmed = String(value || "").trim();
    if (!trimmed) return "";
    return `${trimmed.length === 16 ? trimmed : trimmed.slice(0, 16)}:00-03:00`;
  }

  function fillForm(meetup) {
    fTitle.value = meetup ? meetup.title || "" : "";
    fSlug.value = meetup ? meetup.slug || "" : "";
    fDate.value = meetup ? eventDateToInput(meetup.eventDate) : "";
    fDuration.value = meetup ? String(meetup.durationMinutes || 240) : "240";
    fCapacity.value = meetup ? String(meetup.capacity || 100) : "100";
    fOpen.checked = meetup ? !!meetup.isOpen : true;
    formStatus.textContent = "";
    formStatus.classList.remove("is-error");
    formStatus.classList.remove("is-success");
  }

  function openCreate() {
    formMode = "create";
    editingSlug = "";
    fillForm(null);
    fSlug.disabled = false;
    fSlugHelp.hidden = false;
    attendanceButton.hidden = true;
    exportButton.hidden = true;
    formBack.hidden = true;
    formTitle.textContent = "Criar meetup";
    open(formModal);
    window.setTimeout(() => fTitle.focus(), 50);
  }

  function openEditForm(meetup) {
    formMode = "edit";
    editingSlug = meetup.slug;
    fillForm(meetup);
    fSlug.disabled = true;
    fSlugHelp.hidden = true;
    attendanceButton.hidden = false;
    exportButton.hidden = false;
    formBack.hidden = false;
    formTitle.textContent = "Editar meetup";
    close(pickModal);
    open(formModal);
  }

  function formError(message) {
    formStatus.textContent = message;
    formStatus.classList.remove("is-success");
    formStatus.classList.add("is-error");
  }

  async function saveForm() {
    const title = fTitle.value.trim();
    if (!title) return formError("Informe o título.");

    const slug = fSlug.value.trim().toLowerCase();
    if (formMode === "create" && !/^[a-z0-9-]{3,64}$/.test(slug)) {
      return formError("Slug inválido. Use letras minúsculas, números e hífens (3 a 64).");
    }
    if (!fDate.value) return formError("Informe a data e hora.");

    const durationMinutes = Number(fDuration.value);
    if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
      return formError("Duração deve ser um número de minutos maior que zero.");
    }
    const capacity = Number(fCapacity.value);
    if (!Number.isInteger(capacity) || capacity <= 0) {
      return formError("Capacidade deve ser um número maior que zero.");
    }

    const payload = {
      title,
      eventDate: inputToEventDate(fDate.value),
      durationMinutes,
      capacity,
      isOpen: fOpen.checked
    };
    const path = formMode === "create"
      ? "/api/admin/meetups"
      : `/api/admin/meetups/${encodeURIComponent(editingSlug)}`;
    const method = "POST";
    if (formMode === "create") payload.slug = slug;

    formSave.disabled = true;
    formSave.textContent = "Salvando...";

    let response, data;
    try {
      ({response, data} = await apiFetch(path, {method, body: JSON.stringify(payload)}));
    } catch {
      formSave.disabled = false;
      formSave.textContent = "Salvar";
      return formError("Erro de conexão. Tente novamente.");
    }

    formSave.disabled = false;
    formSave.textContent = "Salvar";

    if (response.status === 401) return onSessionExpired();
    if (response.status === 403) return onForbidden();
    if (!response.ok) {
      return formError(data.error || "Não foi possível salvar o meetup.");
    }

    const created = formMode === "create";
    await loadMeetups();

    if (created) {
      formMode = "edit";
      editingSlug = slug;
      fSlug.disabled = true;
      fSlugHelp.hidden = true;
      attendanceButton.hidden = false;
      exportButton.hidden = false;
      formBack.hidden = false;
      formTitle.textContent = "Editar meetup";
    }

    formStatus.textContent = created ? "✓ Meetup criado." : "✓ Meetup atualizado.";
    formStatus.classList.remove("is-error");
    formStatus.classList.add("is-success");
  }

  function renderPickList() {
    const query = normalize(pickSearch.value);
    pickList.textContent = "";

    const visible = meetupsCache.filter((m) => !query || normalize(m.title).includes(query));
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "subscription-empty";
      empty.textContent = meetupsCache.length === 0 ? "Nenhum meetup cadastrado." : "Nenhum meetup encontrado.";
      pickList.appendChild(empty);
      return;
    }

    visible.forEach((meetup) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "manage-row manage-row--pick";

      const info = document.createElement("div");
      info.className = "manage-row-info";
      const name = document.createElement("span");
      name.className = "manage-row-name";
      name.textContent = meetup.title;
      const meta = document.createElement("span");
      meta.className = "manage-row-email";
      meta.textContent = `${formatMeetupOptionDate(meetup.eventDate)} · ${meetup.registrationsCount} inscrito${meetup.registrationsCount === 1 ? "" : "s"}`;
      info.append(name, meta);

      const tag = document.createElement("span");
      tag.className = "manage-row-tag";
      tag.textContent = meetup.isOpen ? "aberto" : "fechado";

      row.append(info, tag);
      row.addEventListener("click", () => openEditForm(meetup));
      pickList.appendChild(row);
    });
  }

  async function openPick() {
    pickSearch.value = "";
    renderPickList();
    open(pickModal);
    await loadMeetups();
    renderPickList();
  }

  function dirtyCount() {
    let count = 0;
    for (const record of records) {
      if (pending.get(record.id) !== original.get(record.id)) count += 1;
    }
    return count;
  }

  function updateManageStatus() {
    const total = records.length;
    let present = 0;
    for (const record of records) if (pending.get(record.id)) present += 1;
    const dirty = dirtyCount();
    let text = `${present} presente${present === 1 ? "" : "s"} · ${total - present} ausente${total - present === 1 ? "" : "s"} · ${total} inscrito${total === 1 ? "" : "s"}`;
    if (dirty > 0) text += ` · ${dirty} alteração${dirty === 1 ? "" : "ões"} não salva${dirty === 1 ? "" : "s"}`;
    manageStatus.textContent = text;
    manageStatus.classList.remove("is-error");
    manageStatus.classList.remove("is-success");
    manageSave.disabled = dirty === 0;
  }

  function renderAttendance() {
    const query = normalize(manageSearch.value);
    manageList.textContent = "";

    if (records.length === 0) {
      const empty = document.createElement("p");
      empty.className = "subscription-empty";
      empty.textContent = "Nenhuma inscrição neste meetup.";
      manageList.appendChild(empty);
      updateManageStatus();
      return;
    }

    const visible = records.filter((record) =>
      !query || normalize(record.name).includes(query) || normalize(record.email).includes(query)
    );
    if (visible.length === 0) {
      const empty = document.createElement("p");
      empty.className = "subscription-empty";
      empty.textContent = "Nenhum participante encontrado para essa busca.";
      manageList.appendChild(empty);
      updateManageStatus();
      return;
    }

    visible.forEach((record) => {
      const present = pending.get(record.id);
      const changed = pending.get(record.id) !== original.get(record.id);

      const row = document.createElement("label");
      row.className = `manage-row${present ? " is-present" : ""}${changed ? " is-changed" : ""}`;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "manage-check";
      checkbox.checked = present;
      checkbox.addEventListener("change", function () {
        pending.set(record.id, checkbox.checked);
        row.classList.toggle("is-present", checkbox.checked);
        row.classList.toggle("is-changed", pending.get(record.id) !== original.get(record.id));
        const tag = row.querySelector(".manage-row-tag");
        if (tag) tag.textContent = checkbox.checked ? "presente" : "ausente";
        updateManageStatus();
      });

      const info = document.createElement("div");
      info.className = "manage-row-info";
      const name = document.createElement("span");
      name.className = "manage-row-name";
      name.textContent = record.name || "(sem nome)";
      const email = document.createElement("span");
      email.className = "manage-row-email";
      email.textContent = record.email || "";
      info.append(name, email);

      const tag = document.createElement("span");
      tag.className = "manage-row-tag";
      tag.textContent = present ? "presente" : "ausente";

      row.append(checkbox, info, tag);
      manageList.appendChild(row);
    });

    updateManageStatus();
  }

  async function openAttendance(slug) {
    let response, data;
    try {
      ({response, data} = await apiFetch(
        `/api/admin/meetups/${encodeURIComponent(slug)}/attendance`,
        {method: "GET"}
      ));
    } catch {
      feedback.show("Erro de conexão. Tente novamente.", "error");
      return;
    }

    if (response.status === 401) return onSessionExpired();
    if (response.status === 403) return onForbidden();
    if (!response.ok || !Array.isArray(data.registrations)) {
      feedback.show(data.error || "Não foi possível carregar os participantes.", "error");
      return;
    }

    records = data.registrations.map((r) => ({id: r.id, name: r.name, email: r.email}));
    original.clear();
    pending.clear();
    data.registrations.forEach((r) => {
      original.set(r.id, !!r.present);
      pending.set(r.id, !!r.present);
    });

    manageTitle.textContent = data.meetupTitle ? `Check-in — ${data.meetupTitle}` : "Gerenciar check-in";
    manageSearch.value = "";
    renderAttendance();
    close(formModal);
    open(manageModal);
  }

  async function saveAttendance() {
    const changes = records
      .filter((record) => pending.get(record.id) !== original.get(record.id))
      .map((record) => ({id: record.id, present: pending.get(record.id)}));
    if (changes.length === 0) return;

    manageSave.disabled = true;
    manageSave.textContent = "Salvando...";

    let response, data;
    try {
      ({response, data} = await apiFetch(
        `/api/admin/meetups/${encodeURIComponent(editingSlug)}/attendance`,
        {method: "POST", body: JSON.stringify({changes})}
      ));
    } catch {
      manageSave.disabled = false;
      manageSave.textContent = "Salvar";
      manageStatus.textContent = "Erro de conexão. Tente novamente.";
      manageStatus.classList.add("is-error");
      return;
    }

    manageSave.textContent = "Salvar";

    if (response.status === 401) return onSessionExpired();
    if (response.status === 403) return onForbidden();
    if (!response.ok) {
      manageSave.disabled = false;
      manageStatus.textContent = data.error || "Não foi possível salvar as alterações.";
      manageStatus.classList.add("is-error");
      return;
    }

    const count = changes.length;
    records.forEach((record) => original.set(record.id, pending.get(record.id)));
    renderAttendance();
    manageStatus.textContent = `✓ Salvo (${count} alteração${count === 1 ? "" : "ões"}) · ${manageStatus.textContent}`;
    manageStatus.classList.add("is-success");
  }

  function csvField(value) {
    const s = String(value == null ? "" : value);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function downloadCsv(filename, csv) {
    const blob = new Blob(["﻿" + csv], {type: "text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();

    window.setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 2000);
  }

  async function exportRegistrants() {
    if (!editingSlug) return;
    exportButton.disabled = true;
    exportButton.textContent = "Exportando...";

    let response, data;
    try {
      ({response, data} = await apiFetch(
        `/api/admin/meetups/${encodeURIComponent(editingSlug)}/attendance`,
        {method: "GET"}
      ));
    } catch {
      exportButton.disabled = false;
      exportButton.textContent = "Exportar inscritos";
      return formError("Erro de conexão ao exportar.");
    }

    exportButton.disabled = false;
    exportButton.textContent = "Exportar inscritos";

    if (response.status === 401) return onSessionExpired();
    if (response.status === 403) return onForbidden();
    if (!response.ok || !Array.isArray(data.registrations)) {
      return formError(data.error || "Não foi possível exportar os inscritos.");
    }

    const rows = data.registrations
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
    const csv = ["nome,email"]
      .concat(rows.map((r) => `${csvField(r.name)},${csvField(r.email)}`))
      .join("\r\n");
    downloadCsv(`inscritos-${editingSlug}.csv`, csv);

    formStatus.textContent = `✓ ${rows.length} inscrito${rows.length === 1 ? "" : "s"} exportado${rows.length === 1 ? "" : "s"}.`;
    formStatus.classList.remove("is-error");
    formStatus.classList.add("is-success");
  }

  async function loadMeetups() {
    let response, data;
    try {
      ({response, data} = await apiFetch("/api/admin/meetups", {method: "GET"}));
    } catch {
      return;
    }
    if (response.status === 401) return onSessionExpired();
    if (response.status === 403) return onForbidden();
    if (!response.ok || !Array.isArray(data.meetups)) return;
    meetupsCache = data.meetups;
  }

  createButton.addEventListener("click", openCreate);
  editButton.addEventListener("click", openPick);
  pickSearch.addEventListener("input", renderPickList);
  formSave.addEventListener("click", saveForm);
  formBack.addEventListener("click", () => {
    close(formModal);
    openPick();
  });
  attendanceButton.addEventListener("click", () => {
    if (editingSlug) openAttendance(editingSlug);
  });
  exportButton.addEventListener("click", exportRegistrants);
  manageSearch.addEventListener("input", renderAttendance);
  manageSave.addEventListener("click", saveAttendance);
  manageBack.addEventListener("click", () => {
    close(manageModal);
    open(formModal);
  });

  window.HIBMeetupManage = {
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
      close(pickModal);
      close(formModal);
      close(manageModal);
    },
    isStarted() {
      return started;
    }
  };
})();
