"use client";

import { useEffect } from "react";

function setReactInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function firstDayOfMonth(value: string) {
  return /^20\d{2}-\d{2}-\d{2}$/.test(value) ? `${value.slice(0, 7)}-01` : "";
}

export default function PeriodDefaultPatch() {
  useEffect(() => {
    const apply = () => {
      document.querySelectorAll<HTMLElement>(".period-filter").forEach((container) => {
        const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="date"]'));
        const start = inputs[0];
        const end = inputs[1];
        if (!start || !end) return;

        const maxDate = end.max || start.max || end.value || start.value;
        const monthStart = firstDayOfMonth(maxDate);
        if (!monthStart || !maxDate) return;

        start.min = monthStart;

        // Le dashboard démarre avec une valeur de secours puis reçoit la date live en asynchrone.
        // On réapplique donc le défaut uniquement lorsque le max disponible change (ex. 07 -> 13),
        // sans écraser ensuite un filtre modifié manuellement par l'utilisateur.
        if (container.dataset.monthDefaultFor === maxDate) return;
        container.dataset.monthDefaultFor = maxDate;
        setReactInputValue(start, monthStart);
        setReactInputValue(end, maxDate);
      });
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["min", "max", "value"] });
    const timer = window.setInterval(apply, 1000);
    return () => { observer.disconnect(); window.clearInterval(timer); };
  }, []);

  return null;
}
