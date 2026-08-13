import * as XLSX from "@e965/xlsx";

function normalize(value) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function objects(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", raw: true, dense: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheet ? XLSX.utils.sheet_to_json(sheet, { raw: false, defval: "", blankrows: false }) : [];
}

function value(row, ...prefixes) {
  const entries = Object.entries(row);
  for (const prefix of prefixes) {
    const wanted = normalize(prefix);
    const match = entries.find(([key]) => normalize(key) === wanted) ?? entries.find(([key]) => normalize(key).startsWith(wanted));
    if (match) return String(match[1] ?? "").trim();
  }
  return "";
}

function numeric(value) {
  const cleaned = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseEtatduParcVehicleState(buffer, { snapshotAt, sourceModifiedAt }) {
  return objects(buffer).map((row) => ({
    snapshot_at: snapshotAt,
    source_modified_at: sourceModifiedAt ? new Date(sourceModifiedAt).toISOString() : null,
    registration: value(row, "Immatriculation") || null,
    work_order: value(row, "OR") || null,
    client: value(row, "Client") || null,
    vin: value(row, "VIN") || null,
    model: value(row, "Modèle", "Modele") || null,
    mileage: numeric(value(row, "KM")),
    status: value(row, "Dernier statut") || null,
    status_age_days: numeric(value(row, "Dernier statut (Durée Jours Ouv")),
    factory_age_days: numeric(value(row, "Depuis reception (Durée Jours O")),
    alert: value(row, "Alerte") || null,
    urgency: value(row, "Urgence") || null,
    mechanics: value(row, "Mécanique", "Mecanique") || null,
    bodywork: value(row, "Carrosserie") || null,
    technical_control: value(row, "CT") || null,
    dsp: value(row, "DSP") || null,
    wheels: value(row, "Jantes") || null,
    part_available: value(row, "Pièce disponible", "Piece disponible") || null,
    part_ordered_days: numeric(value(row, "Pièce commandée (Durée Jours Ou", "Piece commandee (Duree Jours Ou")),
    metadata: { type: value(row, "Type") || null },
  })).filter((row) => row.registration || row.work_order || row.vin);
}

export function computeSectorBacklog(rows) {
  const scope = rows.filter((row) => ["VOP EFF", "VOP EXT"].includes(String(row.metadata?.type ?? "").trim()));
  const status = (row) => normalize(row.status);
  const park = (row) => status(row) === "stocke sur parc d attente travaux";
  const present = (entry) => String(entry ?? "").trim() !== "";
  const count = (test) => scope.filter(test).length;
  return [
    { sector_key: "expertise", sector_label: "Expertise", vehicle_count: count((row) => /expertise|lavage rapide/.test(status(row))) },
    { sector_key: "chiffrage", sector_label: "Chiffrage", vehicle_count: count((row) => status(row) === "stocke sur parc d attente chiffrage") },
    { sector_key: "controle_technique", sector_label: "Contrôle technique", vehicle_count: count((row) => ["stocke sur parc d attente depart ct", "controle technique en cours"].includes(status(row))) },
    { sector_key: "dsp", sector_label: "DSP", vehicle_count: count((row) => park(row) && present(row.dsp)) },
    { sector_key: "jantes", sector_label: "Jantes", vehicle_count: count((row) => park(row) && present(row.wheels)) },
    { sector_key: "mecanique", sector_label: "Mécanique", vehicle_count: count((row) => park(row) && present(row.mechanics)) },
    { sector_key: "carrosserie", sector_label: "Carrosserie", vehicle_count: count((row) => park(row) && present(row.bodywork)) },
    { sector_key: "parc_travaux", sector_label: "Parc travaux", vehicle_count: count((row) => park(row) && normalize(row.part_available) === "piece disponible") },
    { sector_key: "preparation", sector_label: "Préparation", vehicle_count: count((row) => status(row) === "stocke sur parc d attente preparation") },
  ];
}
