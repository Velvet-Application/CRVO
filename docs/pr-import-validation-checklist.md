# Validation import PR

Avant import :
- Référence, Marque et Libellé présents.
- Prévisualisation et métriques affichées.
- Empreinte SHA-256 calculée.

Pendant import :
- Traitement par lots bornés.
- Déduplication sur Référence + Marque.
- Conservation de la ligne source et des métadonnées.

Après import :
- Rapport d'intégration disponible.
- Aucun `kpi_pr_stock_balances` créé par le catalogue seul.
- Aucun `kpi_pr_movements` de type `initial_stock` créé par le catalogue seul.
