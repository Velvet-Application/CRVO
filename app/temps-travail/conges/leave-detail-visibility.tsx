"use client";

import { useEffect } from "react";

function findSectorSelect() {
  const labels = Array.from(document.querySelectorAll("label"));
  const label = labels.find((item) => /^SECTEUR\b/i.test((item.textContent ?? "").trim()));
  return (label?.querySelector("select") ?? null) as HTMLSelectElement | null;
}

function findDayDetail() {
  return Array.from(document.querySelectorAll("section")).find((section) => {
    const text = (section.textContent ?? "").toUpperCase();
    return text.includes("DÉTAIL DU JOUR") || text.includes("DETAIL DU JOUR");
  }) as HTMLElement | undefined;
}

export default function LeaveDetailVisibility() {
  useEffect(() => {
    let lastVisible: boolean | null = null;

    const apply = () => {
      const select = findSectorSelect();
      const detail = findDayDetail();
      const visible = Boolean(select && select.value !== "*");
      if (!detail || visible === lastVisible) return;
      lastVisible = visible;
      detail.style.display = visible ? "" : "none";
      detail.setAttribute("aria-hidden", visible ? "false" : "true");
    };

    const onChange = (event: Event) => {
      if (!(event.target instanceof HTMLSelectElement)) return;
      const label = event.target.closest("label");
      if (label && /^SECTEUR\b/i.test((label.textContent ?? "").trim())) {
        lastVisible = null;
        apply();
      }
    };

    const observer = new MutationObserver(() => {
      lastVisible = null;
      apply();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("change", onChange, true);
    apply();

    return () => {
      observer.disconnect();
      document.removeEventListener("change", onChange, true);
    };
  }, []);

  return null;
}
