(function () {
  const tablist = document.getElementById("admin-tabs");
  if (!tablist) return;

  const tabs = Array.from(tablist.querySelectorAll("[data-tab]"));
  const panels = Array.from(document.querySelectorAll(".admin-tabpanel[data-tab]"));
  if (tabs.length === 0 || panels.length === 0) return;

  function select(name) {
    for (const tab of tabs) {
      const isActive = tab.dataset.tab === name;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.tabIndex = isActive ? 0 : -1;
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.tab !== name;
    }
  }

  tablist.addEventListener("click", function (event) {
    const tab = event.target.closest("[data-tab]");
    if (!tab || !tablist.contains(tab)) return;
    select(tab.dataset.tab);
  });

  tablist.addEventListener("keydown", function (event) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const currentIndex = tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true");
    if (currentIndex === -1) return;
    const offset = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(currentIndex + offset + tabs.length) % tabs.length];
    select(next.dataset.tab);
    next.focus();
    event.preventDefault();
  });

  select(tabs[0].dataset.tab);

  window.HIBAdminTabs = { select };
})();
