"use client";

import { useEffect } from "react";

/**
 * Expertise DEV should always open on a usable dossier instead of leaving the
 * workspace blank. The expertise page owns the React selection state; this
 * helper only triggers the page's existing vehicle-button handler once the FTP
 * queue has been rendered.
 */
export default function ExpertiseAutoOpen() {
  useEffect(() => {
    const isExpertisePage = () => {
      const path = window.location.pathname;
      return path === "/developpement/expertise" || path === "/developpement/expertise-mobile" || path === "/expertise-mobile";
    };

    if (!isExpertisePage()) return;

    let timer: number | null = null;
    const openFirstAvailable = () => {
      if (!isExpertisePage()) return;
      const emptyMessage = Array.from(document.querySelectorAll("strong")).find(
        (node) => node.textContent?.trim() === "Sélectionnez un dossier",
      );
      if (!emptyMessage) return;

      const queue = document.querySelector("aside");
      if (!queue) return;

      const firstVehicle = Array.from(queue.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
        if (button.dataset.crvoAutoOpened === "1") return false;
        const title = button.querySelector("strong")?.textContent?.trim();
        const hasOr = Array.from(button.querySelectorAll("span")).some((span) => /^OR\s/i.test(span.textContent?.trim() ?? ""));
        return Boolean(title && hasOr && !button.disabled);
      });

      if (!firstVehicle) return;
      firstVehicle.dataset.crvoAutoOpened = "1";
      firstVehicle.click();
    };

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(openFirstAvailable, 80);
    };

    schedule();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, []);

  return null;
}
