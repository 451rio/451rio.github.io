(function () {
  const form = document.getElementById("talk-form");
  const submit = document.getElementById("talk-submit");
  const feedbackModal = document.getElementById("talkFeedbackModal");
  const feedbackTitle = document.getElementById("talk-feedback-title");
  const feedbackMessage = document.getElementById("talk-feedback-message");
  const phoneInput = document.getElementById("talk-phone");
  const phoneHelp = document.getElementById("talk-phone-help");
  const captchaStatus = document.getElementById("talk-captcha-status");
  const formFields = document.getElementById("talk-form-fields");

  if (!form || !submit || !feedbackModal || !feedbackTitle || !feedbackMessage) return;
  if (!window.HIBForms) return;

  const F = window.HIBForms;
  const apiBase = (form.dataset.apiBase || "").trim().replace(/\/$/, "");
  const submitUrl = `${apiBase}/api/talks`;

  const feedback = F.createFeedback(feedbackModal, feedbackTitle, feedbackMessage, {
    success: "Proposta enviada",
    error: "Não foi possível enviar"
  });
  const captcha = F.createCaptcha(apiBase, captchaStatus);

  if (!apiBase || apiBase.includes("REPLACE-WITH-YOUR-WORKER-DOMAIN")) {
    submit.disabled = true;
    feedback.show("Configuração pendente: defina o domínio da API no formulário.", "error");
    return;
  }

  const requiredControls = {
    "título": form.querySelector('[name="title"]'),
    "descrição": form.querySelector('[name="abstract"]'),
    "nome": form.querySelector('[name="speakerName"]'),
    "e-mail": form.querySelector('[name="email"]'),
    "link da foto": form.querySelector('[name="photoUrl"]'),
    "minibio": form.querySelector('[name="bio"]'),
    "disponibilidade presencial": form.querySelector('[name="inPerson"]'),
    "uso de imagem": form.querySelector('[name="imageConsent"]'),
    "ciência das orientações": form.querySelector('[name="termsAck"]'),
    "verificação": captchaStatus,
    "campos do formulário": formFields
  };
  const missingControls = Object.keys(requiredControls).filter((label) => !requiredControls[label]);
  if (missingControls.length > 0) {
    submit.disabled = true;
    feedback.show(`Formulário indisponível: campo(s) ausente(s) — ${missingControls.join(", ")}.`, "error");
    return;
  }

  function setPhoneErrorState(isInvalid) {
    if (!phoneInput) return;
    phoneInput.classList.toggle("is-invalid", isInvalid);
    if (phoneHelp) {
      phoneHelp.classList.toggle("is-error", isInvalid);
      phoneHelp.textContent = isInvalid
        ? "Número inválido. Use DDD + número, ex.: (11) 912345678."
        : "Opcional. DDD + número, com +55 (Brasil). Ex.: (11) 912345678.";
    }
  }

  if (phoneInput) {
    phoneInput.addEventListener("input", function () {
      phoneInput.value = F.formatPhone(phoneInput.value);
      const digits = F.normalizePhone(phoneInput.value);
      if (digits.length === 0 || digits.length < 10) {
        setPhoneErrorState(false);
        return;
      }
      setPhoneErrorState(!F.isBrazilContactPhone(phoneInput.value));
    });
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (submit.disabled) return;

    const formData = new FormData(form);
    const payload = {
      title: String(formData.get("title") || "").trim(),
      abstract: String(formData.get("abstract") || "").trim(),
      speakerName: String(formData.get("speakerName") || "").trim(),
      email: String(formData.get("email") || "").trim(),
      photoUrl: String(formData.get("photoUrl") || "").trim(),
      bio: String(formData.get("bio") || "").trim(),
      inPerson: String(formData.get("inPerson") || "").trim(),
      imageConsent: formData.get("imageConsent") === "on",
      termsAck: formData.get("termsAck") === "on"
    };

    const phoneDigits = F.normalizePhone(phoneInput.value);
    if (phoneDigits && !F.isBrazilContactPhone(phoneInput.value)) {
      setPhoneErrorState(true);
      feedback.show("Número de telefone inválido. Use DDD + número, ex.: (11) 912345678.", "error");
      return;
    }
    setPhoneErrorState(false);

    if (!payload.inPerson) {
      feedback.show("Informe sua disponibilidade para palestrar presencialmente no Rio de Janeiro.", "error");
      return;
    }
    if (!payload.imageConsent) {
      feedback.show("É necessário autorizar o uso de imagem para enviar a proposta.", "error");
      return;
    }
    if (!payload.termsAck) {
      feedback.show("Confirme que está ciente das orientações para enviar a proposta.", "error");
      return;
    }

    if (!captcha.ready()) {
      feedback.show("Aguarde a verificação de segurança terminar e tente novamente.", "error");
      captcha.render();
      return;
    }

    payload.phone = phoneDigits ? `+55${phoneDigits}` : "";
    payload.captchaId = captcha.getToken();
    payload.captcha = Number(captcha.getAnswer());

    submit.disabled = true;
    submit.textContent = "Enviando...";

    try {
      const res = await fetch(submitUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });

      const data = await res.json();

      if (!res.ok) {
        feedback.show(data.error || "Não foi possível enviar a proposta.", "error");
        captcha.render();
        submit.disabled = false;
        submit.textContent = "Enviar proposta";
        return;
      }

      feedbackTitle.textContent = "Proposta enviada! 🎉";
      feedbackMessage.textContent =
        "Recebemos a sua proposta de palestra. A organização entrará em contato pelo e-mail informado com o resultado da seleção.";
      feedbackModal.classList.remove("is-error");
      feedbackModal.classList.add("is-success", "open");

      form.reset();
      setPhoneErrorState(false);
      captcha.render();
      submit.disabled = false;
      submit.textContent = "Enviar proposta";
    } catch {
      feedback.show("Erro de conexão. Tente novamente.", "error");
      captcha.render();
      submit.disabled = false;
      submit.textContent = "Enviar proposta";
    }
  });

  captcha.render().then(function () {
    if (captcha.ready()) {
      formFields.hidden = false;
    } else {
      feedback.show("Não foi possível carregar o formulário. Recarregue a página.", "error");
    }
  });
})();
