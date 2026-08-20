"use client";

import { useEffect, useMemo, useState } from "react";

type MemberStatus = "present" | "leave" | "medical" | "other_absence" | "pending_leave" | string;
type Member = {
  employeeKey: string;
  matricule?: string | null;
  name: string;
  team: string;
  service?: string | null;
  jobTitle?: string | null;
  sector: string;
  status: MemberStatus;
  reasonCodes?: string | null;
};
type TeamPayload = {
  connected?: boolean;
  date: string;
  sector: string;
  team: string;
  nominal: number;
  present: number;
  unavailable: number;
  pendingLeave: number;
  members: Member[];
  error?: string;
};

const SECTOR_BY_LABEL: Record<string, string> = {
  expertise: "expertise",
  mecanique: "mecanique",
  dsp: "dsp",
  jantes: "jantes",
  carrosserie: "carrosserie",
  preparation: "preparation",
  qualite: "qualite",
  photo: "photo",
};

const STATUS_LABEL: Record<string, string> = {
  present: "Présent",
  leave: "CP / RTT",
  medical: "Arrêt",
  other_absence: "Absent",
  pending_leave: "Souhait CP en attente",
};

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function parisToday() {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

function prettyDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

export default function TeamMembersEnhancer() {
  const [payload, setPayload] = useState<TeamPayload | null>(null);
  const [activityLabel, setActivityLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const decorate = () => {
      document.querySelectorAll<HTMLElement>('[class*="teamCard"]').forEach((card) => {
        if (!/Équipe\s+[ABC]/i.test(card.textContent ?? "")) return;
        card.style.cursor = "pointer";
        card.tabIndex = 0;
        card.setAttribute("role", "button");
        card.setAttribute("title", "Voir les collaborateurs de cette équipe");
      });
    };

    const openCard = async (card: HTMLElement) => {
      const teamMatch = (card.textContent ?? "").match(/Équipe\s+([ABC])/i);
      const activity = card.closest("article")?.querySelector("h2")?.textContent?.trim() ?? "";
      const sector = SECTOR_BY_LABEL[normalize(activity)];
      if (!teamMatch || !sector) return;
      const team = teamMatch[1].toUpperCase();
      const dateInput = document.querySelector<HTMLInputElement>('main input[type="date"]');
      const date = dateInput?.value || parisToday();

      setActivityLabel(activity);
      setPayload(null);
      setError("");
      setLoading(true);
      try {
        const params = new URLSearchParams({ members: "1", date, sector, team, _: String(Date.now()) });
        const response = await fetch(`/api/site-presence-capacity?${params.toString()}`, { cache: "no-store" });
        const body = await response.json() as TeamPayload;
        if (!response.ok) throw new Error(body.error || "Composition de l'équipe indisponible.");
        setPayload(body);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Composition de l'équipe indisponible.");
      } finally {
        setLoading(false);
      }
    };

    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>('[class*="teamCard"]');
      if (card && /Équipe\s+[ABC]/i.test(card.textContent ?? "")) void openCard(card);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest<HTMLElement>('[class*="teamCard"]');
      if (!card || !/Équipe\s+[ABC]/i.test(card.textContent ?? "")) return;
      event.preventDefault();
      void openCard(card);
    };

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    decorate();
    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);

  useEffect(() => {
    if (!payload && !loading && !error) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPayload(null); setError(""); setLoading(false); }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [payload, loading, error]);

  const counts = useMemo(() => {
    const members = payload?.members ?? [];
    return {
      present: members.filter((item) => item.status === "present").length,
      leave: members.filter((item) => item.status === "leave").length,
      medical: members.filter((item) => item.status === "medical").length,
      other: members.filter((item) => item.status === "other_absence").length,
      pending: members.filter((item) => item.status === "pending_leave").length,
    };
  }, [payload]);

  if (!payload && !loading && !error) return null;
  const close = () => { setPayload(null); setError(""); setLoading(false); };

  return <div onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }} style={{ position: "fixed", inset: 0, zIndex: 10080, background: "rgba(7,32,51,.46)", backdropFilter: "blur(8px)", display: "grid", placeItems: "center", padding: 18 }}>
    <section style={{ width: "min(760px,96vw)", maxHeight: "86vh", overflow: "hidden", borderRadius: 24, background: "#fff", boxShadow: "0 28px 80px rgba(0,48,87,.25)", border: "1px solid rgba(0,79,159,.14)", fontFamily: "Exo,Arial,sans-serif" }}>
      <header style={{ padding: "20px 22px 16px", background: "linear-gradient(135deg,#f5fbff,#eef7fb)", borderBottom: "1px solid #dbe9ef", display: "flex", justifyContent: "space-between", gap: 20, alignItems: "flex-start" }}>
        <div><span style={{ display: "block", color: "#009edb", fontSize: 10, fontWeight: 900, letterSpacing: ".12em", textTransform: "uppercase" }}>Composition de l'équipe</span><h2 style={{ margin: "4px 0 2px", color: "#004f9f", fontSize: 26, fontStyle: "italic" }}>{activityLabel}{payload ? ` · Équipe ${payload.team}` : ""}</h2>{payload&&<small style={{ color: "#6f8797" }}>{prettyDate(payload.date)} · {payload.present}/{payload.nominal} productifs disponibles</small>}</div>
        <button onClick={close} aria-label="Fermer" style={{ width: 36, height: 36, borderRadius: 12, border: "1px solid #d6e4ea", background: "#fff", color: "#004f9f", fontSize: 22, cursor: "pointer" }}>×</button>
      </header>
      {loading&&<div style={{ padding: 34, textAlign: "center", color: "#597689", fontWeight: 700 }}>Chargement de l'équipe…</div>}
      {error&&<div style={{ margin: 20, padding: 16, borderRadius: 14, background: "#fff1f0", border: "1px solid #f3bbb6", color: "#b73531", fontWeight: 800 }}>{error}</div>}
      {payload&&!loading&&<>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 8, padding: "14px 20px 12px" }}>
          {[["Présents",counts.present],["CP / RTT",counts.leave],["Arrêts",counts.medical],["Autres abs.",counts.other],["CP en attente",counts.pending]].map(([label,value])=><div key={String(label)} style={{ background: "#f6fafc", border: "1px solid #e1ebef", borderRadius: 12, padding: "9px 10px" }}><span style={{ display: "block", color: "#738897", fontSize: 9, fontWeight: 800, textTransform: "uppercase" }}>{label}</span><strong style={{ color: "#004f9f", fontSize: 20 }}>{value}</strong></div>)}
        </div>
        <div style={{ overflowY: "auto", maxHeight: "58vh", padding: "0 20px 20px" }}>
          {(payload.members??[]).map((member) => <div key={member.employeeKey} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", padding: "11px 4px", borderBottom: "1px solid #e5edf1" }}>
            <div><strong style={{ display: "block", color: "#163f59", fontSize: 14 }}>{member.name}</strong><small style={{ color: "#7c8f9b" }}>{member.jobTitle || member.service || "Productif"}{member.matricule ? ` · ${member.matricule}` : ""}</small></div>
            <span style={{ borderRadius: 999, padding: "6px 9px", fontSize: 9, fontWeight: 900, background: member.status === "present" ? "#eaf7ef" : member.status === "pending_leave" ? "#fff7df" : "#fff0ef", color: member.status === "present" ? "#2f7b50" : member.status === "pending_leave" ? "#9d7412" : "#b94742" }}>{STATUS_LABEL[member.status] ?? member.status}</span>
          </div>)}
          {!payload.members?.length&&<div style={{ padding: 28, textAlign: "center", color: "#708695" }}>Aucun productif référencé dans cette équipe à cette date.</div>}
        </div>
      </>}
    </section>
  </div>;
}
