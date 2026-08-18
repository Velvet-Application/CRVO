"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

const STAGES = [
  ["expertise", "Expertise"],
  ["chiffrage", "Chiffrage / validation"],
  ["ct", "Contrôle technique"],
  ["mpr", "MPR / pièces"],
  ["travaux", "Travaux"],
  ["preparation", "Préparation"],
  ["qualite", "Qualité"],
  ["sortie", "Photos / sortie"],
  ["anomalie", "Anomalies"],
] as const;

type StageKey = typeof STAGES[number][0];

function rowStage(status: string, partStatus: string) {
  const s = status.toLowerCase();
  const p = partStatus.toLowerCase();
  if (/anomal/.test(s)) return "anomalie";
  if (/photo|sortie usine/.test(s)) return "sortie";
  if (/qualit/.test(s)) return "qualite";
  if (/prépar|prepar/.test(s)) return "preparation";
  if (/mécan|mecan|carross|fixline|dsp|jante|restor|travaux/.test(s)) {
    return /command|a commander|indisponible|pas d'engagement/.test(p) ? "mpr" : "travaux";
  }
  if (/contrôle technique|controle technique|départ ct|depart ct/.test(s)) return "ct";
  if (/chiffr|devis|validation/.test(s)) return "chiffrage";
  if (/expert|lavage|réceptionné|receptionne/.test(s)) return "expertise";
  if (/command|a commander|indisponible|pas d'engagement/.test(p)) return "mpr";
  return "travaux";
}

function findDossierTable() {
  return Array.from(document.querySelectorAll("table")).find((table) =>
    table.querySelector("thead")?.textContent?.includes("Statut source / simulé"),
  ) ?? null;
}

function findStageFlow() {
  return document.querySelector<HTMLElement>('[class*="stageFlow"]');
}

function clickDossiersTab() {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) =>
    item.textContent?.trim() === "Dossiers en cours",
  );
  button?.click();
}

export default function ProductionStageFilter() {
  const pathname = usePathname();
  const [stage, setStage] = useState<StageKey | null>(null);
  const [visibleCount, setVisibleCount] = useState(0);
  const stageRef = useRef<StageKey | null>(null);
  const boundCards = useRef(new WeakSet<Element>());

  useEffect(() => {
    stageRef.current = stage;
  }, [stage]);

  useEffect(() => {
    if (pathname !== "/developpement/production") return;

    let scheduled = 0;

    const paintCards = () => {
      const flow = findStageFlow();
      if (!flow) return;
      const cards = Array.from(flow.children) as HTMLElement[];
      cards.forEach((card, index) => {
        const config = STAGES[index];
        if (!config) return;
        const [key, label] = config;
        card.setAttribute("role", "button");
        card.setAttribute("tabindex", "0");
        card.setAttribute("aria-label", `Filtrer les dossiers : ${label}`);
        card.title = `Afficher les dossiers · ${label}`;
        card.style.cursor = "pointer";
        card.style.transition = "transform .16s ease, box-shadow .16s ease, background .16s ease";
        const active = stageRef.current === key;
        card.style.boxShadow = active ? "0 0 0 3px rgba(0,158,219,.28), 0 8px 22px rgba(0,79,159,.16)" : "";
        card.style.transform = active ? "translateY(-3px)" : "";
        card.style.background = active ? "#eef9fd" : "";

        if (boundCards.current.has(card)) return;
        boundCards.current.add(card);
        const activate = () => {
          const next = stageRef.current === key ? null : key;
          stageRef.current = next;
          setStage(next);
          clickDossiersTab();
          window.setTimeout(() => applyFilter(next), 50);
          window.setTimeout(() => applyFilter(next), 250);
        };
        card.addEventListener("click", activate);
        card.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activate();
          }
        });
      });
    };

    const applyFilter = (activeStage = stageRef.current) => {
      paintCards();
      const table = findDossierTable();
      if (!table) return;
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
      let count = 0;
      rows.forEach((row) => {
        const cells = row.querySelectorAll<HTMLTableCellElement>("td");
        if (!activeStage) {
          row.style.display = "";
          count += 1;
          return;
        }
        const status = cells[3]?.innerText ?? "";
        const mpr = cells[4]?.innerText ?? "";
        const match = rowStage(status, mpr) === activeStage;
        row.style.display = match ? "" : "none";
        if (match) count += 1;
      });
      setVisibleCount(count);
    };

    const schedule = () => {
      window.clearTimeout(scheduled);
      scheduled = window.setTimeout(() => applyFilter(), 30);
    };

    paintCards();
    applyFilter();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      window.clearTimeout(scheduled);
    };
  }, [pathname]);

  useEffect(() => {
    if (pathname !== "/developpement/production") return;
    const flow = findStageFlow();
    if (flow) {
      Array.from(flow.children).forEach((card, index) => {
        const key = STAGES[index]?.[0];
        const element = card as HTMLElement;
        const active = stage === key;
        element.style.boxShadow = active ? "0 0 0 3px rgba(0,158,219,.28), 0 8px 22px rgba(0,79,159,.16)" : "";
        element.style.transform = active ? "translateY(-3px)" : "";
        element.style.background = active ? "#eef9fd" : "";
      });
    }
  }, [pathname, stage]);

  if (pathname !== "/developpement/production" || !stage) return null;
  const label = STAGES.find(([key]) => key === stage)?.[1] ?? stage;

  return (
    <div style={{
      position: "fixed", right: 18, bottom: 18, zIndex: 1000, display: "flex", alignItems: "center", gap: 14,
      padding: "12px 14px", borderRadius: 14, background: "#ffffff", border: "1px solid #cfe3ee",
      borderTop: "4px solid #009edb", boxShadow: "0 14px 38px rgba(0,79,159,.20)", color: "#004f9f",
      fontFamily: "inherit", maxWidth: "min(520px, calc(100vw - 36px))",
    }}>
      <div style={{ display: "grid", gap: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".08em", color: "#009edb" }}>FILTRE FLUX ACTIF</span>
        <strong style={{ fontSize: 15 }}>{label}</strong>
        <small style={{ color: "#61788c" }}>{visibleCount} dossier{visibleCount > 1 ? "s" : ""} affiché{visibleCount > 1 ? "s" : ""}</small>
      </div>
      <button
        type="button"
        onClick={() => {
          stageRef.current = null;
          setStage(null);
          const table = findDossierTable();
          table?.querySelectorAll<HTMLTableRowElement>("tbody tr").forEach((row) => { row.style.display = ""; });
        }}
        style={{ border: 0, borderRadius: 9, padding: "9px 12px", background: "#004f9f", color: "white", fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap" }}
      >
        Tout afficher
      </button>
    </div>
  );
}
