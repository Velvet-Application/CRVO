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

export function parseFactoryToday(buffer, sourceModifiedAt) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, dense: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "", blankrows: false });
  return rows.map((row) => ({
    production_date: isoDate(row.CAL_DATE),
    source_modified_at: sourceModifiedAt ? new Date(sourceModifiedAt).toISOString() : null,
    flow: String(row.RDT_LIBELLE ?? "").trim(),
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
    technical_control: number(row.CT),
    available: number(row.Disponibles),
  })).filter((row) => row.production_date && row.flow);
}
