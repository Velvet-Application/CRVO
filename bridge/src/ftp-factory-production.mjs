import * as XLSX from "@e965/xlsx";

function number(value) {
  const parsed = Number(String(value ?? "0").trim().replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function isoDate(value) {
  const text = String(value ?? "").trim();
  const fr = text.match(/^(\d{2})[\/.-](\d{2})[\/.-](20\d{2})$/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const iso = text.match(/^(20\d{2})[\/.-](\d{2})[\/.-](\d{2})$/);
  return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
}

function readRows(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, dense: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheet ? XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "", blankrows: false }) : [];
}

function commonMetrics(row, sourceModifiedAt) {
  return {
    source_modified_at: sourceModifiedAt ? new Date(sourceModifiedAt).toISOString() : null,
    received: number(row["Réceptionnés"]),
    dynamic_expertise: number(row["Expertises Dynamiques"]),
    washing: number(row.Lavages),
    expertise: number(row.Expertises),
    mechanics: number(row.Mecaniques),
    bodywork: number(row.Carrosseries),
    fixline_1: number(row["Fixline 1"]),
    fixline_2: number(row["Fixline 2"]),
    fixline_3: number(row["Fixline 3"]),
    dsp: number(row.DSP),
    preparation: number(row["Préparations"]),
    photos: number(row.Photos),
    quality: number(row["Qualités"]),
    wheels: number(row.Jantes),
    restor_fx: number(row["Restor-FX"]),
    technical_control: number(row.CT ?? row["CT OK"]),
    available: number(row.Disponibles),
  };
}

export function parseFactoryToday(buffer, sourceModifiedAt) {
  return readRows(buffer).map((row) => ({
    production_date: isoDate(row.CAL_DATE),
    flow: String(row.RDT_LIBELLE ?? "").trim(),
    ...commonMetrics(row, sourceModifiedAt),
  })).filter((row) => row.production_date && row.flow);
}

/**
 * Factory-j-1 est le fichier de clôture du jour précédent. Il a priorité sur
 * la photographie Factory-j+1 prise pendant la journée, car la colonne
 * "Disponibles" peut encore évoluer après le dernier relevé live.
 */
export function parseFactoryPrevious(buffer, sourceModifiedAt) {
  return readRows(buffer).map((row) => ({
    production_date: isoDate(row.Date),
    flow: String(row.Type ?? "").trim(),
    ...commonMetrics(row, sourceModifiedAt),
  })).filter((row) => row.production_date && row.flow);
}
