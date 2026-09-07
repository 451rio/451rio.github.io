(function () {
  const form = document.getElementById("survey-form");
  const submit = document.getElementById("survey-submit");
  const feedbackModal = document.getElementById("surveyFeedbackModal");
  const feedbackTitle = document.getElementById("survey-feedback-title");
  const feedbackMessage = document.getElementById("survey-feedback-message");
  const captchaStatus = document.getElementById("survey-captcha-status");
  const formFields = document.getElementById("survey-form-fields");
  const meetupTitle = document.getElementById("survey-meetup-title");

  if (!form || !submit || !feedbackModal || !feedbackTitle || !feedbackMessage) return;
  if (!formFields || !captchaStatus) return;
  if (!window.HIBForms) return;

  const questions = Array.isArray(window.HIBSurveyQuestions) ? window.HIBSurveyQuestions : [];
  if (questions.length === 0) return;

  const F = window.HIBForms;
  const apiBase = (form.dataset.apiBase || "").trim().replace(/\/$/, "");

  const slugFromQuery = new URLSearchParams(window.location.search).get("meetup") || "";
  const slug = /^[a-z0-9-]{3,64}$/.test(slugFromQuery)
    ? slugFromQuery
    : (form.dataset.meetupSlug || "").trim();

  const feedback = F.createFeedback(feedbackModal, feedbackTitle, feedbackMessage, {
    success: "Resposta enviada",
    error: "Não foi possível enviar"
  });
  const captcha = F.createCaptcha(apiBase, captchaStatus);

  if (!apiBase || !slug) {
    submit.disabled = true;
    feedback.show("Configuração pendente: defina a API e o meetup desta pesquisa.", "error");
    return;
  }

  async function loadMeetupTitle() {
    if (!meetupTitle) return;
    try {
      const res = await fetch(`${apiBase}/api/meetups/${encodeURIComponent(slug)}/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data.title === "string" && data.title) {
        meetupTitle.textContent = data.title;
      }
    } catch {
    }
  }

  const progressFill = document.getElementById("survey-progress-fill");
  const progressLabel = document.getElementById("survey-progress-label");
  const commentsInput = document.getElementById("survey-comments");
  const commentsCount = document.getElementById("survey-comments-count");

  function answeredCount() {
    return questions.filter((question) => form.querySelector(`input[name="${question.key}"]:checked`)).length;
  }

  function syncProgress() {
    const answered = answeredCount();
    if (progressFill) progressFill.style.width = `${(answered / questions.length) * 100}%`;
    if (progressLabel) {
      progressLabel.textContent = `${answered} de ${questions.length} respondidas`;
    }
  }

  function syncSelectedLabel(question) {
    const target = form.querySelector(`.survey-selected[data-for="${question.key}"]`);
    if (!target) return;
    const checked = form.querySelector(`input[name="${question.key}"]:checked`);
    const options = Array.isArray(question.options) ? question.options : [];
    target.textContent = checked ? (options[Number(checked.value) - 1] || "") : "";
  }

  form.addEventListener("change", function (event) {
    const question = questions.find((item) => item.key === event.target.name);
    if (question) {
      syncSelectedLabel(question);
      syncProgress();
    }
    if (commentsCount && event.target === commentsInput) {
      commentsCount.textContent = String(commentsInput.value.length);
    }
  });

  if (commentsInput && commentsCount) {
    commentsInput.addEventListener("input", function () {
      commentsCount.textContent = String(commentsInput.value.length);
    });
  }

  function readAnswers() {
    const payload = {};
    const missing = [];

    for (const question of questions) {
      const checked = form.querySelector(`input[name="${question.key}"]:checked`);
      if (!checked) {
        missing.push(question.short || question.label);
        continue;
      }
      payload[question.key] = Number(checked.value);
    }

    return { payload, missing };
  }

  function resetSubmitButton() {
    submit.disabled = false;
    submit.textContent = "Enviar respostas";
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (submit.disabled) return;

    const { payload, missing } = readAnswers();
    if (missing.length > 0) {
      feedback.show(`Responda todas as perguntas antes de enviar. Faltou: ${missing.join(", ")}.`, "error");
      return;
    }

    const comments = String(new FormData(form).get("comments") || "").trim();
    if (comments.length > 2000) {
      feedback.show("Comentário muito longo. Use no máximo 2000 caracteres.", "error");
      return;
    }
    payload.comments = comments;

    if (!captcha.ready()) {
      feedback.show("Aguarde a verificação de segurança terminar e tente novamente.", "error");
      captcha.render();
      return;
    }

    payload.captchaId = captcha.getToken();
    payload.captcha = Number(captcha.getAnswer());

    submit.disabled = true;
    submit.textContent = "Enviando...";

    try {
      const res = await fetch(`${apiBase}/api/meetups/${encodeURIComponent(slug)}/survey`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        feedback.show(data.error || "Não foi possível enviar suas respostas.", "error");
        captchaStatus.hidden = false;
        captcha.render();
        resetSubmitButton();
        return;
      }

      feedbackTitle.textContent = "Obrigado! 💚";
      feedbackMessage.textContent =
        "Suas respostas foram registradas de forma anônima e vão ajudar a melhorar as próximas edições do Hack in Brasil.";
      feedbackModal.classList.remove("is-error");
      feedbackModal.classList.add("is-success", "open");

      form.reset();
      formFields.hidden = true;
      captchaStatus.hidden = false;
      captchaStatus.textContent = "Pesquisa respondida. Obrigado por contribuir com a comunidade!";
    } catch {
      feedback.show("Erro de conexão. Tente novamente.", "error");
      captchaStatus.hidden = false;
      captcha.render();
      resetSubmitButton();
    }
  });

  loadMeetupTitle();

  captcha.render().then(function () {
    if (captcha.ready()) {
      formFields.hidden = false;
      captchaStatus.hidden = true;
      syncProgress();
    } else {
      feedback.show("Não foi possível carregar o formulário. Recarregue a página.", "error");
    }
  });
})();
