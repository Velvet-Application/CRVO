"use client";

import { useEffect, useRef } from "react";

type LiveRow = { key:string; label:string; count:number; oldestAge:number };
type Payload = { snapshot?: { label?:string }; bottlenecks?: LiveRow[] };

const cadence: Record<string, number> = {
  Expertise:80,
  Chiffrage:50,
  "Contrôle technique":50,
  DSP:30,
  Jantes:35,
  Mécanique:80,
  Carrosserie:50,
  "Parc travaux":80,
  Préparation:80,
};

function setText(node: Element | null, value: string) {
  if (node && node.textContent !== value) node.textContent = value;
}

export default function LiveBottlenecksPatch() {
  const latest = useRef<Payload | null>(null);
  const loading = useRef(false);

  useEffect(() => {
    let active = true;

    const apply = () => {
      const data = latest.current;
      const cards = Array.from(document.querySelectorAll<HTMLElement>(".bottleneck-cards button"));
      if (!data?.bottlenecks?.length || !cards.length) return;
      const rows = new Map(data.bottlenecks.map((row) => [row.label, row]));

      for (const card of cards) {
        const label = card.querySelector(".sector-card-head strong")?.textContent?.trim() || "";
        const row = rows.get(label);
        if (!row) continue;
        setText(card.querySelector(".sector-card-value strong"), String(row.count));
        const maxText = card.querySelector(".sector-card-value span")?.textContent || "";
        const threshold = Number(maxText.match(/(\d+)/)?.[1] || 0);
        const ratio = threshold > 0 ? row.count / threshold : 0;
        const bar = card.querySelector<HTMLElement>(".sector-card-track i");
        if (bar) bar.style.width = `${Math.min(ratio * 100, 100)}%`;
        card.classList.toggle("danger", ratio > 1.5);
        card.classList.toggle("warning", ratio > 1 && ratio <= 1.5);
        card.classList.toggle("healthy", ratio <= 1);
        setText(card.querySelector(".sector-card-head span"), ratio > 1.5 ? "CRITIQUE" : ratio > 1 ? "À SURVEILLER" : "MAÎTRISÉ");
        const days = row.count / Math.max(cadence[label] || 1, 1);
        setText(card.querySelector(".sector-card-foot span"), `${days.toLocaleString("fr-FR", { maximumFractionDigits:2 })} j de charge`);
      }

      const activeCard = cards.find((card) => card.classList.contains("active")) || cards[0];
      const activeLabel = activeCard?.querySelector(".sector-card-head strong")?.textContent?.trim() || "";
      const selected = rows.get(activeLabel);
      if (selected) {
        const maxText = activeCard?.querySelector(".sector-card-value span")?.textContent || "";
        const threshold = Number(maxText.match(/(\d+)/)?.[1] || 0);
        const workDays = selected.count / Math.max(cadence[activeLabel] || 1, 1);
        const values = document.querySelectorAll(".trend-values > div");
        setText(values[0]?.querySelector("strong") || null, String(selected.count));
        setText(values[2]?.querySelector("strong") || null, workDays.toLocaleString("fr-FR", { maximumFractionDigits:2 }));
        const priority = document.querySelector(".bottleneck-priority");
        setText(priority?.querySelector(":scope > strong") || null, String(Math.max(selected.count - threshold, 0)));
        const p = priority?.querySelector("p");
        if (p) p.textContent = selected.count > threshold ? `À cadence constante, le secteur porte ${workDays.toLocaleString("fr-FR", { maximumFractionDigits:2 })} jours de travail en stock.` : "Le secteur reste sous son seuil maximum.";
      }

      const title = document.querySelector(".view-page > .section-title");
      if (title && document.querySelector(".bottleneck-cards")) {
        setText(title.querySelector("h2"), "Encours par secteur · EtatduParc live");
        setText(title.querySelector("p"), `Encours actuel issu de la dernière photo EtatduParc FTP · ${data.snapshot?.label || "donnée live"}.`);
      }
      const note = document.querySelector(".chart-note");
      if (note) note.innerHTML = '<span></span><strong>Encours EtatduParc</strong><i></i>Dernier niveau mis à jour depuis le FTP live';
    };

    const load = async () => {
      if (loading.current || !document.querySelector(".bottleneck-cards")) return;
      loading.current = true;
      try {
        const response = await fetch(`/api/operational-live?_=${Date.now()}`, { cache:"no-store", headers:{ "Cache-Control":"no-cache" } });
        if (response.ok) {
          const payload = await response.json() as Payload;
          if (active) { latest.current = payload; apply(); }
        }
      } catch {} finally { loading.current = false; }
    };

    const onClick = () => window.setTimeout(() => { void load(); apply(); }, 120);
    document.addEventListener("click", onClick);
    const timer = window.setInterval(() => { void load(); apply(); }, 60000);
    void load();
    return () => { active = false; document.removeEventListener("click", onClick); window.clearInterval(timer); };
  }, []);

  return null;
}
