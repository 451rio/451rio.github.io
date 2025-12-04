    const navToggle = document.getElementById("nav-toggle");
    const navMenu = document.getElementById("nav-menu");

    if (navToggle && navMenu) {
      navToggle.addEventListener("click", () => navMenu.classList.toggle("open"));
      document.querySelectorAll("#nav-menu a").forEach(link =>
        link.addEventListener("click", () => navMenu.classList.remove("open"))
      );
    }

    const newsletterForm = document.getElementById("newsletter-form");
    if (newsletterForm) {
      newsletterForm.addEventListener("submit", e => {
        e.preventDefault();
        const emailInput = document.getElementById("newsletter-email");
        if (emailInput) emailInput.value = "";
        alert("Obrigado! Em breve te mandaremos novidades!");
      });
    }

    function setupModal(triggerId, modalId) {
      const trigger = document.getElementById(triggerId);
      const modal = document.getElementById(modalId);
      if (!trigger || !modal) return;
      trigger.addEventListener("click", () => modal.classList.add("open"));
    }

    setupModal("openSponsorsModal", "sponsorsModal");
    setupModal("openSpeakersModal", "speakersModal");

    document.querySelectorAll("[data-close]").forEach(btn =>
      btn.addEventListener("click", () => {
        const modal = btn.closest(".modal");
        if (modal) modal.classList.remove("open");
      })
    );

    document.querySelectorAll(".modal").forEach(modal =>
      modal.addEventListener("click", e => {
        if (e.target === modal) modal.classList.remove("open");
      })
    );