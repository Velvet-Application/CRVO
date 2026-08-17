export const ACTIVITY_COLORS = {
  expertise: "#eb5b56",
  mecanique: "#55b779",
  jantes: "#f5a623",
  carrosserie: "#009edb",
  dsp: "#004f9f",
  preparation: "#8d5ec7",
  qualitePhoto: "#c66a1b",
  sortieUsine: "#7b8794",
} as const;

function normalize(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

export function activityKey(value: string) {
  const text = normalize(value);
  if (text.includes("expert")) return "expertise" as const;
  if (text.includes("mecan") || text.includes("meca")) return "mecanique" as const;
  if (text.includes("jante")) return "jantes" as const;
  if (text.includes("carross") || text.includes("fixline") || text.includes("box") || text.includes("toler")) return "carrosserie" as const;
  if (text.includes("dsp") || text.includes("deboss")) return "dsp" as const;
  if (text.includes("prepa") || text.includes("preparation")) return "preparation" as const;
  if (text.includes("qualit") || text.includes("photo")) return "qualitePhoto" as const;
  if (text.includes("sortie") || text.includes("factory exit")) return "sortieUsine" as const;
  return null;
}

export function activityColor(value: string, fallback = "#7b8794") {
  const key = activityKey(value);
  return key ? ACTIVITY_COLORS[key] : fallback;
}

export const ACTIVITY_COLOR_RULE = [
  { label: "Expertise", color: ACTIVITY_COLORS.expertise },
  { label: "Mécanique", color: ACTIVITY_COLORS.mecanique },
  { label: "Jantes", color: ACTIVITY_COLORS.jantes },
  { label: "Carrosserie · Fixline / BOX / Tôlerie", color: ACTIVITY_COLORS.carrosserie },
  { label: "DSP", color: ACTIVITY_COLORS.dsp },
  { label: "Préparation", color: ACTIVITY_COLORS.preparation },
  { label: "Qualité / Photo", color: ACTIVITY_COLORS.qualitePhoto },
  { label: "Sortie usine", color: ACTIVITY_COLORS.sortieUsine },
] as const;
