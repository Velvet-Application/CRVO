# Import PR — Références gérées

## Règle métier
Le fichier `Références Gérées` alimente le **catalogue des références connues**. Il ne constitue pas un inventaire physique certifié.

- Identité d'une fiche : **Référence + Marque**.
- Les quantités, CMM, PAMP, casiers et dates du fichier sont archivés comme informations source.
- Aucun mouvement `initial_stock` n'est produit par cet import.
- Le stock réel sera créé ultérieurement à partir d'un stock/inventaire certifié, via le grand livre PR.
- Un fichier déjà importé est détecté par empreinte SHA-256 et n'est pas réinjecté.
- Une action stock utilisant une référence brute ambiguë est refusée ; l'itemId ou la marque doit être précisé.

## Colonnes reconnues
`Référence`, `Marque`, `Libellé`, `Prix Achat`, `Qté Stock`, `CMM`, `PAMP`, `Casier 1`, `D. Dernière Entrée`, `D. Dern. Sortie`, `Catégorie Pièce (code)`, `V. Comptable`, `Remplacée par`.
