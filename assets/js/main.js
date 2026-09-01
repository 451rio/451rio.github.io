window.HIBFlash = (function () {
  let overlay = null;
  let hideTimer = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.className = "flash-message";
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    document.body.appendChild(overlay);
    return overlay;
  }

  function hide() {
    if (!overlay) return;
    overlay.classList.remove("is-visible");
  }

  function show(message, type, durationMs) {
    const el = ensureOverlay();
    window.clearTimeout(hideTimer);
    el.textContent = message;
    el.className = `flash-message is-visible is-${type || "info"}`;
    if (durationMs) {
      hideTimer = window.setTimeout(hide, durationMs);
    }
  }

  return { show, hide };
})();

(function () {
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const modalReturnFocus = new WeakMap();

function getVisibleFocusable(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    el => el.offsetParent !== null || el === document.activeElement
  );
}

function closeModal(modal) {
  modal.classList.remove("open");
}

function applyModalOpen(modal) {
  modal.setAttribute("aria-hidden", "false");
  modalReturnFocus.set(modal, document.activeElement);

  const content = modal.querySelector(".modal-content");
  if (!content) return;

  content.setAttribute("role", "dialog");
  content.setAttribute("aria-modal", "true");
  if (!content.hasAttribute("tabindex")) content.setAttribute("tabindex", "-1");

  if (!content.hasAttribute("aria-labelledby")) {
    const heading = content.querySelector("[id]");
    if (heading && heading.id) content.setAttribute("aria-labelledby", heading.id);
  }

  if (!content.hasAttribute("aria-describedby")) {
    const desc = content.querySelector('[id$="-message"], [id$="-description"]');
    if (desc && desc.id) content.setAttribute("aria-describedby", desc.id);
  }

  content.focus();
}

function applyModalClosed(modal) {
  modal.setAttribute("aria-hidden", "true");
  const previous = modalReturnFocus.get(modal);
  modalReturnFocus.delete(modal);
  if (previous && typeof previous.focus === "function" && document.contains(previous)) {
    previous.focus();
  }
}

document.querySelectorAll(".modal").forEach(modal => {
  const syncModalState = () => {
    const isOpen = modal.classList.contains("open");
    const wasOpen = modal.getAttribute("aria-hidden") === "false";
    if (isOpen && !wasOpen) applyModalOpen(modal);
    else if (!isOpen && wasOpen) applyModalClosed(modal);
  };

  new MutationObserver(syncModalState).observe(modal, {
    attributes: true,
    attributeFilter: ["class"]
  });

  if (modal.classList.contains("open")) applyModalOpen(modal);

  modal.addEventListener("click", e => {
    if (e.target === modal) closeModal(modal);
  });
});

document.querySelectorAll("[data-close]").forEach(btn =>
  btn.addEventListener("click", () => {
    const modal = btn.closest(".modal");
    if (modal) closeModal(modal);
  })
);

document.addEventListener("keydown", e => {
  const openModal = document.querySelector(".modal.open");
  if (!openModal) return;

  if (e.key === "Escape") {
    e.preventDefault();
    closeModal(openModal);
    return;
  }

  if (e.key !== "Tab") return;

  const content = openModal.querySelector(".modal-content");
  if (!content) return;

  const focusable = getVisibleFocusable(content);
  if (focusable.length === 0) {
    e.preventDefault();
    content.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (e.shiftKey && (active === first || active === content)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
});
})();
