"use client";

import { useEffect } from "react";

function setText(node: Element | null | undefined, value: string) {
  if (node && node.textContent !== value) node.textContent = value;
}

export default function EmailSourcePatch() {
  useEffect(() => {
    const apply = () => {
      const cards = document.querySelectorAll(".source-cards .source-card");
      const emailCard = cards.item(2);
      if (emailCard) {
        const copy = emailCard.querySelector("div:nth-child(2)");
        setText(copy?.querySelector("span"), "FLUX E-MAIL MÉTIERS");
        setText(copy?.querySelector("h3"), "Data RH · CA · pointage facturé");
        setText(copy?.querySelector("p"), "Réception de fichiers par e-mail, archivage, dédoublonnage et intégration automatique. Le FTP reste indépendant.");
        setText(emailCard.querySelector(":scope > strong"), "MAIL");
      }

      const hub = document.querySelector(".finance-source-hub");
      if (hub) {
        setText(hub.querySelector(".finance-source-copy > span"), "SECOURS MANUEL");
        setText(hub.querySelector(".finance-source-copy > h3"), "Import financier de secours");
        setText(hub.querySelector(".finance-source-copy > p"), "Le flux principal passe désormais par e-mail. Cet import reste disponible uniquement comme solution de secours.");
      }

      const financeUploader = document.querySelector(".finance-uploader");
      if (financeUploader) {
        setText(financeUploader.querySelector(".upload-heading span"), "SECOURS MANUEL");
        setText(financeUploader.querySelector(".upload-heading h3"), "Ajouter un fichier financier de secours");
        setText(financeUploader.querySelector(".upload-heading p"), "Le flux principal du chiffre d’affaires passe désormais par e-mail. Cet import manuel reste disponible en cas de besoin.");
      }
    };

    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
