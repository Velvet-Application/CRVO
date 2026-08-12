"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type AuthPayload = { authenticated?: boolean; error?: string };

function normalize(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function detectDate(filename: string) {
  const iso = filename.match(/(20\d{2})[-_.](\d{2})[-_.](\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const fr = filename.match(/(\d{2})[-_.](\d{2})[-_.](20\d{2})/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  return new Date().toISOString().slice(0, 10);
}

async function sha256(buffer: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function scanFinanceBook(file: File) {
  const XLSX = await import("@e965/xlsx");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const metrics: Record<string, number | string | null> = {};
  const matches: Array<{ label: string; value: number }> = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const range = XLSX.utils.decode_range(sheet["!ref"] || "A1:A1");
    for (let r = range.s.r; r <= range.e.r; r += 1) {
      for (let c = range.s.c; c <= range.e.c; c += 1) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell || typeof cell.v !== "string") continue;
        const label = normalize(cell.v);
        if (!label) continue;
        let value: number | null = null;
        for (let offset = 1; offset <= 5 && value == null; offset += 1) {
          const candidate = sheet[XLSX.utils.encode_cell({ r, c: c + offset })];
          const numeric = Number(candidate?.v);
          if (Number.isFinite(numeric)) value = numeric;
        }
        if (value != null) matches.push({ label, value });
      }
    }
  }

  const find = (...patterns: RegExp[]) => matches.find((item) => patterns.some((pattern) => pattern.test(item.label)))?.value;
  metrics.revenue_day = find(/ca jour/, /chiffre d affaires jour/, /chiffre d affaires du jour/) ?? null;
  metrics.revenue_day_target = find(/objectif ca jour/, /objectif.*chiffre d affaires.*jour/) ?? null;
  metrics.revenue_cumulative = find(/ca cumule/, /chiffre d affaires cumule/) ?? null;
  metrics.revenue_cumulative_target = find(/objectif ca cumule/, /objectif.*chiffre d affaires.*cumule/, /objectif ca$/) ?? null;
  metrics.fre_per_vo = find(/fre.*(vo|vop)/, /frais.*(vo|vop)/, /frais unitaires/) ?? null;
  metrics.mo_per_vop = find(/mo.*(vo|vop)/, /heures.*(vo|vop)/) ?? null;
  metrics.revenue_per_vop = find(/ca.*(vo|vop)/, /chiffre d affaires.*(vo|vop)/) ?? null;
  metrics.labor_hours = find(/heures mo/, /main d oeuvre.*heures/) ?? null;
  metrics.vop = find(/realise vop/, /volume.*vop/, /volumes vo/) ?? null;
  metrics.source_matches = matches.length;
  return { buffer, metrics, snapshotAt: detectDate(file.name) };
}

export default function FinanceSourcePortal() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const locate = () => {
      const sourceCards = document.querySelector(".source-cards");
      if (!sourceCards?.parentElement) {
        setHost((current) => current ? null : current);
        return;
      }

      let portal = document.getElementById("finance-source-portal-root");
      if (!portal) {
        portal = document.createElement("div");
        portal.id = "finance-source-portal-root";
        sourceCards.parentElement.insertBefore(portal, sourceCards);
      }
      setHost((current) => current === portal ? current : portal);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fetch("/api/import-book/auth", { cache: "no-store" })
      .then((response) => response.json() as Promise<AuthPayload>)
      .then((payload) => setAuthorized(Boolean(payload.authenticated)))
      .catch(() => setAuthorized(false));
  }, []);

  async function unlock() {
    setStatus("Vérification de l’accès…");
    const response = await fetch("/api/import-book/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode: code }),
    });
    const payload = await response.json() as AuthPayload;
    if (!response.ok || !payload.authenticated) {
      setAuthorized(false);
      setStatus(payload.error || "Code d’accès refusé.");
      return;
    }
    setAuthorized(true);
    setCode("");
    setStatus("Accès déverrouillé.");
  }

  async function upload() {
    if (!file || !authorized) {
      setStatus("Déverrouille l’accès puis sélectionne un book financier.");
      return;
    }
    setUploading(true);
    setStatus("Analyse du book financier…");
    try {
      const parsed = await scanFinanceBook(file);
      const response = await fetch("/api/finance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          snapshotAt: parsed.snapshotAt,
          filename: file.name,
          byteSize: file.size,
          sha256: await sha256(parsed.buffer),
          metrics: parsed.metrics,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Import financier impossible.");
      setStatus("Book financier enregistré. La page Chiffre d’affaires est maintenant actualisée.");
      setFile(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Erreur pendant l’import financier.");
    } finally {
      setUploading(false);
    }
  }

  if (!host || !host.isConnected) return null;

  return createPortal(
    <section className="finance-source-hub">
      <div className="finance-source-copy">
        <span>FLUX FINANCIER</span>
        <h3>Importer le book financier CRVO</h3>
        <p>Source séparée du SFTP opérationnel. Les données reconnues alimentent exclusivement Chiffre d’affaires.</p>
        <a className="atelier-screen-link" href="/atelier" target="_blank" rel="noreferrer">
          <span>ÉCRAN ATELIER</span>
          <strong>Ouvrir l’affichage terrain ↗</strong>
        </a>
      </div>

      <div className="finance-source-actions">
        {authorized === false && (
          <div className="finance-source-auth">
            <input type="password" value={code} onChange={(event) => setCode(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && code) void unlock(); }} placeholder="Code d’accès" />
            <button onClick={() => void unlock()} disabled={!code}>Déverrouiller</button>
          </div>
        )}
        <label className={file ? "finance-source-drop selected" : "finance-source-drop"}>
          <input type="file" accept=".xlsx,.xls" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setStatus(""); }} />
          <strong>{file ? file.name : "Choisir le book financier"}</strong>
          <small>.xlsx ou .xls · lecture locale avant enregistrement</small>
        </label>
        <button className="finance-source-upload" disabled={!file || authorized !== true || uploading} onClick={() => void upload()}>
          {uploading ? "Analyse en cours…" : "Importer les données financières"}
        </button>
        {status && <p className="finance-source-status">{status}</p>}
      </div>
    </section>,
    host,
  );
}
