export type MailRecipient = { name: string; address: string };

export type SignatureProfile = {
  key: "cyril" | "celine" | "direction";
  name: string;
  title: string;
  company: string;
  mobile?: string;
  email?: string;
};

const BODY_FONT = "'Aptos Display','Aptos Display_EmbeddedFont','Aptos Display_MSFontService','Calibri Light','Helvetica Light',sans-serif";
const BODY_COLOR = "#002451";
const SIGNATURE_BLUE = "#004f9f";
const SIGNATURE_DARK = "#000e3d";
const LINK_BLUE = "#0563c1";

export const TO_RECIPIENTS: MailRecipient[] = [
  { name: "Emeline BOULONNE", address: "emeline.boulonne@crvo.fr" },
  { name: "Cyril GAY", address: "cyril.gay@crvo.fr" },
  { name: "Benjamin BALINGON", address: "benjamin.balingon@crvo.fr" },
  { name: "Jean Francois PIASECKI", address: "jean-francois.piasecki@crvo.fr" },
  { name: "Laurence LAUDES", address: "laurence.laudes@crvo.fr" },
  { name: "Valérie GRONIER", address: "valerie.gronier@crvo.fr" },
  { name: "Vanessa COUVERT", address: "vanessa.couvert@crvo.fr" },
  { name: "Yves Marie THERON", address: "yves-marie.theron@crvo.fr" },
  { name: "Yohan VELLE", address: "yohan.velle@crvo.fr" },
  { name: "Audrey ATMANIA", address: "audrey.atmania@crvo.fr" },
  { name: "Christopher LEMORT", address: "christopher.lemort@crvo.fr" },
  { name: "Romuald LAURENT", address: "romuald.laurent@crvo.fr" },
  { name: "Johnny TRANAIN", address: "johnny.tranain@crvo.fr" },
  { name: "Frederic BARTCZAK", address: "frederic.bartczak@crvo.fr" },
  { name: "Geremy VELLE", address: "geremy.velle@crvo.fr" },
  { name: "Ludovic DUMONT", address: "ludovic.dumont@crvo.fr" },
  { name: "Anthony MARMUSE", address: "anthony.marmuse@crvo.fr" },
  { name: "Jeffrey COILLOT", address: "jeffrey.coillot@crvo.fr" },
  { name: "Jean Francois COLAERT", address: "jean-francois.colaert@crvo.fr" },
  { name: "Vincent DYNOWSKI", address: "vincent.dynowski@crvo.fr" },
  { name: "Lucie DEGARDIN", address: "lucie.degardin@crvo.fr" },
  { name: "Stacy MUSIOL", address: "stacy.musiol@crvo.fr" },
  { name: "Vanessa LEGRAND", address: "vanessa.legrand@crvo.fr" },
  { name: "Guillaume GOUILLIART", address: "guillaume.gouilliart@crvo.fr" },
  { name: "Morgane LOPES", address: "morgane.lopes@crvo.fr" },
  { name: "Alexandre FOURNIER", address: "alexandre.fournier@crvo.fr" },
  { name: "Giovanny CAVROIS", address: "giovanny.cavrois@crvo.fr" },
  { name: "Julien LEMAIRE", address: "julien.lemaire1@crvo.fr" },
  { name: "Sarah OLIVIER", address: "sarah.olivier@crvo.fr" },
  { name: "Geoffrey CAMBIEN", address: "geoffrey.cambien@crvo.fr" },
  { name: "Allan BONNAILLIE", address: "allan.bonnaillie@crvo.fr" },
  { name: "Quentin PEYRARD", address: "quentin.peyrard@crvo.fr" },
  { name: "Tifany LHOMME", address: "tifany.lhomme@crvo.fr" },
  { name: "Steven DESTUNDER", address: "steven.destunder@crvo.fr" },
  { name: "Thomas GESTIN", address: "thomas.gestin@crvo.fr" },
  { name: "Anthony SPREUX", address: "anthony.spreux@crvo.fr" },
  { name: "Mandy DUJARDIN", address: "mandy.dujardin@crvo.fr" },
  { name: "Jordan CLABAUT", address: "jordan.clabaut@crvo.fr" },
  { name: "Julie BECQUAERT", address: "julie.becquaert@crvo.fr" },
  { name: "Baptiste CORBEAU", address: "baptiste.corbeau@crvo.fr" },
  { name: "Corentin ARZU", address: "corentin.arzu@crvo.fr" },
  { name: "Karine HOURDE", address: "karine.hourde@crvo.fr" },
  { name: "Sarah PIETSZYKOWSKI", address: "sarah.pietszykowski@crvo.fr" },
  { name: "Leslie DANEL", address: "leslie.danel@crvo.fr" },
  { name: "Baptiste CADART", address: "baptiste.cadart@crvo.fr" },
  { name: "Séverine VERITE", address: "severine.verite@crvo.fr" },
  { name: "Dan DURAND", address: "dan.durand@crvo.fr" },
  { name: "Jessy LECOINTE", address: "jessy.lecointe@crvo.fr" },
  { name: "Inès MORTREUX", address: "ines.mortreux@crvo.fr" },
  { name: "Fabien GRONUS", address: "fabien.gronus@crvo.fr" },
  { name: "Jean Marc DEGARDIN", address: "jean-marc.degardin@crvo.fr" },
  { name: "Maxence CHATELET", address: "maxence.chatelet@crvo.fr" },
];

export const CC_RECIPIENTS: MailRecipient[] = [
  { name: "Benoit PECQUEUR", address: "benoit.pecqueur@crvo.fr" },
  { name: "Jaouad OUARIBA", address: "jaouad.ouariba@emilfrey.fr" },
  { name: "Vincent GORCE", address: "vincent.gorce@emilfrey.fr" },
  { name: "Damien PAILLET", address: "damien.paillet@emilfrey.fr" },
  { name: "Ali MELLOUL", address: "ali.melloul@crvo.fr" },
  { name: "Daniel PELLETIER", address: "daniel.pelletier@autosphere.fr" },
  { name: "Jean-Baptiste ALLEAU", address: "jean-baptiste.alleau@crvo.fr" },
];

const CYRIL_SIGNATURE: SignatureProfile = {
  key: "cyril",
  name: "Cyril GAY",
  title: "Directeur",
  company: "CRVO Lens & Emil Frey Transphère",
  mobile: "07.64.70.76.83",
  email: "cyril.gay@crvo.fr",
};

const CELINE_SIGNATURE: SignatureProfile = {
  key: "celine",
  name: "Céline MANIEZ",
  title: "Cheffe de groupe administratif",
  company: "CRVO Lens",
};

const DIRECTION_SIGNATURE: SignatureProfile = {
  key: "direction",
  name: "Direction CRVO",
  title: "CRVO Lens",
  company: "CRVO Lens",
};

export function signatureFor(username?: string | null): SignatureProfile {
  const key = String(username ?? "").trim().toLowerCase();
  if (key === "cyril") return CYRIL_SIGNATURE;
  if (key === "celine.maniez") return CELINE_SIGNATURE;
  return DIRECTION_SIGNATURE;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function signaturePlain(signature: SignatureProfile) {
  const rows = ["Cordialement", "", signature.name, signature.title, signature.company];
  if (signature.mobile) rows.push(`Mob. ${signature.mobile}`);
  if (signature.email) rows.push(signature.email);
  rows.push("", "CRVO Lens", "Rue Alexis Halette", "62300 Lens", "www.crvo.fr");
  return rows.join("\n");
}

function signatureHtml(signature: SignatureProfile) {
  const mobile = signature.mobile
    ? `<div style="font-family:Arial,sans-serif;font-size:8pt;color:#000;margin-top:12pt">Mob. ${escapeHtml(signature.mobile)}</div>`
    : "";
  const email = signature.email
    ? `<div style="font-family:Arial,sans-serif;font-size:7.5pt;margin:6pt 0"><a href="mailto:${escapeHtml(signature.email)}" style="color:${LINK_BLUE};text-decoration:underline">${escapeHtml(signature.email)}</a></div>`
    : "";

  return `<div style="margin-top:14pt">
    <div style="font-family:${BODY_FONT};font-size:10pt;color:${BODY_COLOR};margin-bottom:10pt">Cordialement</div>
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:collapse">
      <tr>
        <td style="padding:0;vertical-align:top">
          <div style="font-family:Arial,sans-serif;font-size:10pt;line-height:1.5;color:${SIGNATURE_BLUE};font-weight:700">${escapeHtml(signature.name)}</div>
          <div style="font-family:Arial,sans-serif;font-size:9pt;line-height:1.5;color:${SIGNATURE_DARK};font-weight:700">${escapeHtml(signature.title)}</div>
          <div style="font-family:Arial,sans-serif;font-size:9pt;line-height:1.5;color:${SIGNATURE_DARK};font-weight:700">${escapeHtml(signature.company)}</div>
          ${mobile}
          ${email}
          <div style="font-family:Arial,sans-serif;font-size:7.5pt;line-height:9.6pt;color:#000">CRVO Lens</div>
          <div style="font-family:Arial,sans-serif;font-size:7.5pt;line-height:9.6pt;color:#000">Rue Alexis Halette</div>
          <div style="font-family:Arial,sans-serif;font-size:7.5pt;line-height:9.6pt;color:#000">62300 Lens</div>
          <div style="font-family:Arial,sans-serif;font-size:7.5pt;margin:6pt 0"><a href="https://www.crvo.fr" style="color:${LINK_BLUE};text-decoration:underline">www.crvo.fr</a></div>
        </td>
      </tr>
    </table>
    <div style="font-family:Arial,sans-serif;font-size:6.5pt;line-height:1.3;color:#6b6b6b;margin-top:12pt;max-width:620px">En respect du droit à la déconnexion, cet email est à traiter pendant le temps de travail. Son contenu est confidentiel et s’adresse uniquement aux destinataires indiqués dans le message. Il est strictement interdit de partager tout ou partie de ce message avec un tiers sans l’accord écrit de l’expéditeur.</div>
  </div>`;
}

export function emailHtml(text: string, signature: SignatureProfile) {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => `<p style="font-family:${BODY_FONT};font-size:10pt;line-height:1.35;color:${BODY_COLOR};margin:0 0 10pt 0">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:${BODY_FONT};font-size:10pt;line-height:1.35;color:${BODY_COLOR}">${paragraphs}${signatureHtml(signature)}</div>`;
}

export function graphRecipient(recipient: MailRecipient) {
  return { emailAddress: { name: recipient.name, address: recipient.address } };
}
