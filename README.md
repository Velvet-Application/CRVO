# KPI CRVO

Dashboard décisionnel CRVO connecté à des instantanés de données historisés. L'application est conçue pour :

- archiver chaque fichier source sans écrasement ;
- détecter les doublons par empreinte SHA-256 ;
- filtrer et comparer les indicateurs dans le temps ;
- importer un historique CSV, XLS ou XLSX ;
- transformer les champs sources en mesures métier modifiables ;
- synchroniser un serveur FTP en lecture seule ;
- exploiter une photo opérationnelle quasi temps réel pour le dashboard et le pilotage.

## Donnée affichée aujourd'hui

Le dashboard conserve les Books CRVO validés comme historique de référence jusqu'au 12/08/2026. Pour la journée en cours, la projection `kpi_ftp_live_dashboard` a désormais priorité et combine :

- `Factory-j+1.csv` pour la production cumulée du jour ;
- `EtatduParc.csv` pour la photo de parc, le stock, l'ancienneté et le pilotage véhicule.

Les flux de production pris en compte pour le VOP sont `VOP EFF` + `VOP EXT`. La carrosserie regroupe la colonne `Carrosseries` et les trois lignes Fixline. Les reprises travaux supplémentaires restent séparées et ne sont pas additionnées au réalisé principal.

`EtatduParc-Nuit.csv` reste archivé mais est exclu de la photo opérationnelle live.

## Architecture

```text
Serveur FTP (lecture seule, port 21)
        |
        v
GitHub Action planifiée / bridge Node
        |-- connexion FTP + téléchargement en mémoire
        |-- empreinte SHA-256 et anti-doublon
        |-- lecture Factory + EtatduParc
        v
Passerelles sécurisées Supabase Edge Functions
        |-- journal des synchronisations
        |-- archive privée à durée limitée
        |-- photo véhicule et production live
        v
Supabase Storage + PostgreSQL
        |
        |-- kpi_ftp_factory_production
        |-- kpi_ftp_vehicle_state
        |-- kpi_ftp_live_dashboard
        v
API serveur Cloudflare
        |
        v
Dashboard + Pilotage + Sources + Studio + Paramètres
```

Le pont FTP est séparé du Worker public : aucun mot de passe FTP ni aucune clé Supabase privilégiée n'est envoyé au navigateur. Le bridge GitHub ne possède pas de clé Supabase privilégiée : les opérations sensibles transitent par les Edge Functions Supabase.

Le répertoire distant `\` fourni par le serveur est normalisé en `/`, la racine FTP standard.

## Fréquence FTP

Le workflow `.github/workflows/kpi-sftp-sync.yml` contrôle le FTP toutes les 15 minutes sur la plage opérationnelle, aux minutes `05`, `20`, `35` et `50`. Les dépôts observés arrivant majoritairement autour de H:00 à H:04, le passage H:05 vise à récupérer la nouvelle photo environ cinq minutes après son dépôt. GitHub Actions pouvant démarrer avec un léger décalage, le dashboard affiche toujours l'heure réelle du dernier refresh et l'heure réelle du dernier dépôt source.

Les doublons d'archive sont ignorés par SHA-256. La photo Factory live et la photo véhicule restent idempotentes : un nouveau passage ne crée pas de doublons métier.

## Flux FTP actuellement détecté

Le contrôle opérationnel du 13/08/2026 a confirmé la présence de **12 fichiers CSV** :

- `Analyse-Temps-Bruts.csv`
- `LeadTimeDurees.csv`
- `ETatDeParcClient.csv`
- `Ctrl-Fact-Trans.csv`
- `Analyse-Temps-Bruts-Mois.csv`
- `Factory-j+1.csv`
- `EtatduParc.csv`
- `Factory-j-1.csv`
- `Etat-du-parc.csv`
- `Factory-Mois.csv`
- `EtatduParc-Nuit.csv`
- `LeadTimeFactoryBI.csv`

Rôle métier validé :

- `Factory-j+1` : production du jour qui augmente à chaque dépôt ;
- `Factory-j-1` : production clôturée de la veille ;
- `Factory-Mois` : cumul mensuel réel ;
- `EtatduParc` : photo de parc la plus fraîche ;
- `ETatDeParcClient` : parc toutes entités/clients ;
- `LeadTimeFactoryBI` : source Lead Time opérationnelle ;
- `Analyse-Temps-Bruts` : historique horodaté des changements de statut.

Les CSV non encore exploités comme KPI live continuent d'être archivés avec leur schéma, sans appliquer les anciens mappings Excel.

## Pilotage

`EtatduParc` alimente désormais une table véhicule live. Le champ `Alerte` est conservé et affiché comme information **À faire** pour indiquer les passages restant au véhicule. Le FIFO utilise l'ancienneté du statut, avec repli sur l'ancienneté depuis réception.

Les listes FIFO sont visibles même lorsqu'un secteur a déjà atteint son objectif. Les listes RUN utilisent le temps restant par OR lorsqu'il est disponible ; si le temps SQL n'est pas encore branché, l'interface l'indique explicitement au lieu d'inventer une durée.

Le branchement SQL chiffre d'affaires complètera ensuite le potentiel économique par dossier et le CA instantané.

## Développement local

Prérequis : Node.js 22.13 ou supérieur.

```bash
npm ci
npm run dev
```

Contrôles :

```bash
npm run lint
npx tsc --noEmit
npm run build
npm run validate:artifact
npx wrangler deploy --dry-run --config wrangler.jsonc
```

## Supabase

Projet cible : `tvmkhvfmdstkunwwuzuz`.

1. Appliquer [supabase/schema.sql](supabase/schema.sql), puis les migrations du dossier `supabase/migrations/`.
2. Conserver le bucket privé `kpi-raw-archive`.
3. `kpi-ftp-bridge-gateway` assure les opérations privilégiées générales du bridge FTP.
4. `kpi-ftp-factory-gateway` reçoit uniquement les agrégats Factory normalisés.
5. La source active `Serveur FTP CRVO` contient les paramètres **non sensibles** de connexion (`host`, `port`, `username`, `remoteDir`, `secure`) dans sa colonne `connection`.
6. Définir dans Cloudflare `SUPABASE_URL` et `SUPABASE_SECRET_KEY` comme secrets serveur.
7. Ne jamais créer de variable publique contenant une secret key ou une legacy `service_role` key.

Les tables live ont RLS activé et les rôles `anon` / `authenticated` n'ont pas d'accès direct.

## Passerelle FTP

Le bridge se trouve dans `bridge/` et s'exécute automatiquement via `.github/workflows/kpi-sftp-sync.yml`. Le nom historique du fichier de workflow est conservé ; le workflow lui-même s'appelle `KPI CRVO - synchronisation FTP`.

Secrets GitHub Actions nécessaires :

- `FTP_PASSWORD`
- `SUPABASE_URL`

Les paramètres `FTP_HOST`, `FTP_PORT`, `FTP_USERNAME` et `FTP_REMOTE_DIR` restent acceptés comme fallback, mais la configuration active est lue depuis Supabase. Les anciens secrets `SFTP_*` restent temporairement acceptés comme fallback de transition ; aucune connexion SFTP n'est utilisée.

Le compte FTP est utilisé uniquement en lecture. Aucune opération d'écriture, déplacement ou suppression n'est effectuée sur le serveur source.

## Règles de mapping

Les 30 règles historiques de `kpi_field_mappings` correspondent aux anciens Books Excel (`Synthèse`, `Tdb Production`, `Goulot`) et restent disponibles pour XLS/XLSX.

Les mappings CSV sont séparés de ces règles. Les valeurs absentes ne sont jamais transformées silencieusement en `0`.

## Déploiement Cloudflare

Configuration : [wrangler.jsonc](wrangler.jsonc).

- Build : `npm ci && npm run build`
- Déploiement : `npx wrangler deploy --config wrangler.jsonc`
- Répertoire statique : `dist/client`
- Worker : `dist/server/index.js`

Le déploiement doit conserver les secrets Cloudflare existants. Les données sensibles ne figurent ni dans le code, ni dans `wrangler.jsonc`, ni dans le dépôt GitHub.
