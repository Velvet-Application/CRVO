# ToolBox CRVO Lens — RH / Annualisation du centre 2027

## Statut

- Cible de mise en service officielle : **01/01/2027**.
- Fondation technique : **préparation / mode miroir uniquement**.
- Le moteur legacy `kpi_worktime_annualization` reste inchangé tant que la V2 n'a pas franchi les contrôles de go-live.
- `official_engine_enabled` doit rester à `false` jusqu'à validation formelle RH/Juridique/Direction.

## 1. Objectif produit

Créer dans **RH → Annualisation du centre** le référentiel unique du temps annualisé CRVO : simple à utiliser, explicable au salarié, exploitable par le management et auditable par RH.

Le module doit relier :

`planning → temps de travail → Data RH → CP → formation → prêt d'équipe → heures spéciales → annualisation → conformité → clôture → paie / preuve`.

La donnée officielle ne doit jamais être un total saisi manuellement. Elle résulte d'un journal d'écritures versionnées et traçables.

## 2. Invariants métier

1. **Solde d'annualisation ≠ heures supplémentaires ≠ contingent HS.** Ces compteurs sont séparés.
2. Un solde négatif technique n'est jamais automatiquement une dette salarié. La cause, la neutralisation et la part éventuellement imputable sont distinctes.
3. Une journée suit les états : `forecast → observed → validated → closed`. Une correction après clôture crée une écriture d'ajustement, jamais une modification silencieuse.
4. Toute écriture porte une source, une explication et la version du référentiel de règles appliqué.
5. Les règles conventionnelles ne sont pas codées en dur sans validation. Elles vivent dans un `ruleset` versionné.
6. Les calculs historiques restent reproductibles avec la règle en vigueur à l'époque.
7. Le collaborateur peut comprendre son solde en ouvrant le détail de chaque mouvement.
8. Les accès sont limités au strict périmètre organisationnel ; les consultations/modifications sensibles sont auditables.
9. Une clôture mensuelle ou annuelle fige un snapshot. Toute correction postérieure est une régularisation datée.
10. Le moteur officiel ne peut être activé que lorsque tous les contrôles de go-live requis sont validés.

## 3. Expérience utilisateur cible

### 3.1 Centre

Vue RH / Direction / responsables autorisés :

- effectif annualisé ;
- solde positif cumulé ;
- solde négatif cumulé ;
- projection au 31/12 ;
- heures de nuit ;
- heures majorées ;
- heures supplémentaires ;
- contingent consommé ;
- repos compensateurs acquis / consommés ;
- alertes de conformité ;
- dossiers non validés ;
- répartition par service, secteur, équipe et tranche de solde.

Le cockpit doit mettre en avant les situations nécessitant une action, pas uniquement les totaux.

### 3.2 Mon équipe

Pour le manager, selon son périmètre :

- solde et projection de chaque collaborateur ;
- jours en attente de validation ;
- alertes prévisionnelles ;
- prêts d'équipe ;
- anomalies à instruire ;
- repos/contreparties à planifier ;
- demandes de correction des salariés.

### 3.3 Collaborateur / Mon annualisation

Le salarié concerné voit uniquement ses propres données :

- objectif annuel contractuel et période de référence ;
- théorique à date ;
- heures comptabilisées ;
- solde annualisation validé ;
- éléments provisoires séparés ;
- projection au 31/12 ;
- détail mois / année : travail effectif, absences neutralisées, formation, nuit, majorations, HS, contingent, repos, prêts ;
- chronologie détaillée des mouvements ;
- documents mensuels / annuels ;
- bouton **Signaler une anomalie** ;
- accusé de consultation du relevé sans effet de renonciation aux droits.

### 3.4 Conformité & clôture

- anomalies légales / conventionnelles ;
- alertes prédictives avant construction d'un planning à risque ;
- pré-clôture mensuelle ;
- contrôles bloquants ;
- clôture RH ;
- réouverture exceptionnelle motivée ;
- régularisations ;
- pré-clôture annuelle ;
- génération des relevés et exports.

## 4. Registres de données V2

### `kpi_annualization_settings`
Mode du moteur (`preparation`, `shadow`, `dual_run`, `official`, `frozen`), date officielle et garde-fou d'activation.

### `kpi_annualization_rulesets`
Référentiel versionné : période, seuils, règles d'absence, nuit, majorations, contingent, repos, entrées/sorties, prévenance, sources juridiques et statut de validation.

### `kpi_annualization_employee_contracts`
Règle individuelle applicable sur une période : temps plein/partiel, cible annuelle, charge contractuelle, équipe/secteur de référence, exclusions et métadonnées.

### `kpi_annualization_employee_account_links`
Lien vérifié entre un compte ToolBox et un `employee_key`. Ce lien conditionne la transparence individuelle et évite toute exposition par simple recherche de nom.

### `kpi_annualization_ledger`
Journal principal. Une écriture contient notamment :

- date ;
- heures théoriques ;
- travail effectif ;
- heures créditées ;
- delta technique ;
- heures neutralisées ;
- delta imputable ;
- source et référence ;
- règle appliquée ;
- état ;
- explication lisible ;
- lien éventuel vers l'écriture corrigée.

### `kpi_annualization_special_hours`
Heures supplémentaires, nuit, dimanche, férié, majorations, repos compensateurs et contingent.

### `kpi_annualization_team_loans`
Prêts d'équipe avec origine, destination, période, heures prévues/réelles, motif et workflow de décision.

### `kpi_annualization_period_closures`
Pré-clôtures / clôtures mensuelles et annuelles, snapshots, bloqueurs et historique de réouverture.

### `kpi_annualization_disputes`
Signalements salariés, décision manager/RH et lien vers l'ajustement généré si accepté.

### `kpi_annualization_acknowledgements`
Preuve de mise à disposition/consultation d'un relevé par son hash et son horodatage.

### `kpi_annualization_compliance_alerts`
Alertes constatées ou prédictives avec sévérité, règle, preuve et traitement.

### `kpi_annualization_audit`
Journal des actions sensibles et changements de données.

### `kpi_annualization_go_live_checks`
Checklist bloquante avant activation officielle.

## 5. Sources et responsabilités

| Domaine | Source de référence | Usage Annualisation |
| --- | --- | --- |
| Population / identité | référentiel effectif CRVO + Data RH | contrat, équipe, dates d'entrée/sortie |
| Présence / horaires | Temps de travail validé | travail effectif, théorique, écarts |
| Evénements RH | Data RH | maladie, AT, absences, neutralisations |
| Congés | Souhaits de CP + Data RH validé | planning et projection, puis réalisé |
| Formation | module Formation validé | temps de travail / indisponibilité productive |
| Prêts | Annualisation V2 | déplacement temporaire de capacité / horaire |
| Nuit / majorations | horaires validés + ruleset | qualification et contreparties |
| Production / capacité | Présentéisme et Capacitaire | analyse d'impact, sans modifier les droits RH |
| Paie | export futur contrôlé | transmission des éléments validés uniquement |

Aucune source ne doit recalculer directement le solde officiel hors du moteur de ledger.

## 6. Modèle de calcul journalier

Pour chaque collaborateur et chaque jour :

1. résoudre le contrat/ruleset applicable ;
2. établir l'horaire théorique ;
3. récupérer le temps constaté et les événements RH ;
4. qualifier les absences ;
5. déterminer les heures neutralisées ;
6. calculer le delta d'annualisation technique ;
7. calculer séparément la part imputable selon la règle validée ;
8. qualifier nuit / HS / majorations / repos ;
9. détecter les alertes de conformité ;
10. enregistrer une écriture explicable et reproductible.

Le moteur ne doit pas réécrire une journée `closed`. Une évolution tardive produit une `adjustment` rattachée à l'écriture d'origine.

## 7. Prêt d'équipe

Workflow cible :

`demande → accord équipe d'origine → validation selon règles → exécution → clôture`.

Le prêt doit alimenter simultanément :

- capacité de l'équipe d'origine ;
- capacité de l'équipe d'accueil ;
- attribution des heures réellement effectuées ;
- qualification de nuit/majoration le cas échéant ;
- annualisation ;
- historique individuel ;
- statistiques de prêts inter-équipes.

Le prêt ne doit pas créer artificiellement du crédit/débit d'annualisation.

## 8. Conformité et règles juridiques

Le moteur de règles doit être paramétré à partir des textes réellement applicables au CRVO : Code du travail, convention collective/IDCC, accords d'entreprise ou d'établissement, avenants et règles RH validées.

Références officielles utilisées pour cadrer la fondation, à revalider au moment du paramétrage 2027 :

- Service-Public — Aménagement du temps de travail sur une période supérieure à la semaine : https://www.service-public.fr/particuliers/vosdroits/F75
- Service-Public — Durée du travail du salarié : https://www.service-public.fr/particuliers/vosdroits/F1911
- Service-Public — Travail de nuit : https://www.service-public.fr/particuliers/vosdroits/F2212
- Légifrance — conservation des documents de décompte : https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000033515983

**Important :** ces références ne remplacent pas l'identification de la convention collective et de l'accord d'annualisation réellement applicables. Le ruleset `2027.0-DRAFT` conserve volontairement les valeurs conventionnelles à `null`.

### Contrôles à implémenter

- durée quotidienne ;
- durée hebdomadaire absolue ;
- moyenne glissante applicable ;
- temps de pause ;
- repos quotidien ;
- repos hebdomadaire ;
- travail de nuit et population de travailleurs de nuit ;
- amplitudes et successions de postes ;
- contingent HS ;
- repos/contreparties ;
- temps partiel ;
- apprentis/mineurs si concernés ;
- éléments non validés ;
- anomalies de compteur ;
- projection d'un planning avant validation.

Les seuils effectifs sont lus dans le ruleset validé et non dupliqués dans l'UI.

## 9. Matrice d'accès cible

| Rôle | Propre compteur | Equipe | Centre | Clôture | Règles |
| --- | ---: | ---: | ---: | ---: | ---: |
| Collaborateur lié | Oui | Non | Non | Non | Non |
| Chef d'équipe | Oui si lié | Périmètre | Non | Non | Non |
| Superviseur / manager | Oui si lié | Périmètre descendant | Consolidé selon droits | Non | Non |
| Chef de service | Oui si lié | Périmètre | Consolidé | Non | Non |
| RH | Oui si lié | Oui | Oui | Oui | Oui |
| Admin | Selon habilitation | Oui | Oui | Oui | Oui |

Le rôle `admin` technique ne justifie pas une consultation non tracée des données RH sensibles. Les futures lectures individuelles devront être journalisées.

## 10. Clôture mensuelle

1. collecte des données du mois ;
2. résolution des événements RH tardifs ;
3. contrôle des journées non validées ;
4. génération des anomalies ;
5. pré-clôture ;
6. validation RH ;
7. snapshot ;
8. relevé salarié ;
9. export paie si requis.

Une modification après clôture exige : auteur, motif, écriture de régularisation et nouvelle version du relevé.

## 11. Clôture annuelle

Avant le 31/12, la pré-clôture doit projeter :

- soldes positifs/négatifs ;
- heures supplémentaires potentielles ;
- contingent restant ;
- repos/contreparties non consommés ;
- dossiers incomplets ;
- risques de conformité.

La clôture annuelle fige la règle utilisée, le calcul final et les preuves nécessaires à l'explication du solde.

## 12. Go-live 01/01/2027

### Août / septembre
- fondation V2 parallèle ;
- collecte des textes applicables ;
- définition des populations ;
- validation du modèle de règles ;
- matrice de droits.

### Septembre / octobre
- moteur journalier ;
- qualification des heures ;
- prêts ;
- conformité ;
- vues RH/manager/salarié.

### Octobre
- rejeu 2026 ;
- rapprochement avec les historiques existants ;
- traitement des cas limites.

### Novembre
- **mode miroir** sans valeur officielle ;
- écarts analysés et justifiés.

### Décembre
- **dual run** ;
- tests clôtures, relevés, exports, sécurité ;
- validation formelle du go-live.

### 01/01/2027
- activation `official_engine_enabled=true` uniquement si tous les contrôles obligatoires sont `passed` ou explicitement `waived` avec preuve et décision autorisée ;
- ouverture des compteurs 2027 à partir de contrats/règles validés.

## 13. Cas de recette obligatoires

- salarié temps plein standard ;
- entrée en cours d'année ;
- départ en cours d'année ;
- changement d'horaire/équipe ;
- temps partiel ;
- CP ;
- maladie ;
- AT ;
- absence longue ;
- absence non justifiée ;
- formation ;
- nuit ;
- heures supplémentaires ;
- repos compensateur ;
- prêt inter-équipe ;
- correction avant clôture ;
- correction après clôture ;
- contestation salarié acceptée/refusée ;
- dépassement prévisionnel ;
- compte salarié non lié ;
- tentative d'accès hors périmètre ;
- changement de ruleset sans altérer un exercice antérieur.

## 14. Définition de « prêt pour production »

Le moteur ne peut pas être considéré prêt parce que l'interface fonctionne. Il est prêt uniquement lorsque :

- le ruleset 2027 est juridiquement validé ;
- la population 2027 est complète ;
- les données sources sont réconciliées ;
- le rejeu historique est explicable ;
- le mode miroir et le dual run ne présentent aucun écart non justifié ;
- les salariés peuvent voir et contester leurs données ;
- les clôtures et corrections sont auditables ;
- les accès/RLS ont été testés ;
- les exports nécessaires sont validés ;
- la checklist de go-live est formellement signée.
