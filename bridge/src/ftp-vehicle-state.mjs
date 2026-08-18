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

function timestamp(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString();
  const french = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!french) return null;
  const year = french[3].length === 2 ? Number(`20${french[3]}`) : Number(french[3]);
  const date = new Date(Date.UTC(year, Number(french[2]) - 1, Number(french[1]), Number(french[4] || 0), Number(french[5] || 0), Number(french[6] || 0)));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function parseEtatduParcVehicleState(buffer, { snapshotAt, sourceModifiedAt }) {
  return objects(buffer).map((row) => ({
    snapshot_at: snapshotAt,
    source_modified_at: sourceModifiedAt ? new Date(sourceModifiedAt).toISOString() : null,
    registration: value(row, "Immatriculation", "Immat.") || null,
    work_order: value(row, "OR") || null,
    client: value(row, "Client") || null,
    vin: value(row, "VIN", "Vin") || null,
    model: value(row, "Modèle", "Modele") || null,
    mileage: numeric(value(row, "KM")),
    status: value(row, "Dernier statut", "Etat actuel") || null,
    status_at: timestamp(value(row, "Dernier statut (Date)")),
    status_age_days: numeric(value(row, "Dernier statut (Durée Jours Ouv")),
    factory_age_days: numeric(value(row, "Depuis reception (Durée Jours O", "LeadTime Usine (Jours")),
    alert: value(row, "Alerte") || null,
    urgency: value(row, "Urgence") || null,
    mechanics: value(row, "Mécanique", "Mecanique", "Mecanique - 3 Heures") || null,
    bodywork: value(row, "Carrosserie") || null,
    technical_control: value(row, "CT") || null,
    dsp: value(row, "DSP") || null,
    wheels: value(row, "Jantes") || null,
    part_available: value(row, "Pièce disponible", "Piece disponible") || null,
    part_ordered_days: numeric(value(row, "Pièce commandée (Durée Jours Ou", "Piece commandee (Duree Jours Ou", "LeadTime Pièces (Jours")),
    metadata: {
      type: value(row, "Type", "Flux") || null,
      position: value(row, "Position") || null,
      site: value(row, "Site", "Nom SITE", "Libelle Site") || null,
      manufacturer: value(row, "Constructeur", "Marque") || null,
      folder_number: value(row, "Numéro de dossier", "Numero de dossier") || null,
      source_schema: value(row, "Position") ? "park_with_position" : "park_live",
    },
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
    { sector_key: "preparation", sector_label: "Préparation", vehicle_count: count((row) => /preparation/.test(status(row))) },
  ];
}
