"use client";

import { useEffect } from "react";

export default function CockpitName() {
  useEffect(() => {
    const apply = () => {
      document.title = "CRVO COCKPIT V2";

      document.querySelectorAll<HTMLElement>("main h1").forEach((element) => {
        if (element.textContent?.trim() === "PILOTAGE PRÉDICTIF") {
          element.textContent = "CRVO COCKPIT V2";
        }
      });

      document.querySelectorAll<HTMLElement>("main strong").forEach((element) => {
        if (element.textContent?.includes("Construction du cockpit prédictif")) {
          element.textContent = "Chargement de CRVO COCKPIT V2…";
        }
      });

      document.querySelectorAll<HTMLElement>("main span").forEach((element) => {
        if (element.textContent?.trim() === "CRVO INTELLIGENCE · AIDE À LA DÉCISION") {
          element.textContent = "CRVO COCKPIT V2 · AIDE À LA DÉCISION";
        }
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
