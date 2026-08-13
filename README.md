# KPI CRVO

Dashboard décisionnel CRVO connecté à des instantanés de données historisés. L'application est conçue pour :

- archiver chaque fichier source sans écrasement ;
- détecter les doublons par empreinte SHA-256 ;
- filtrer et comparer les indicateurs dans le temps ;
- importer un historique CSV, XLS ou XLSX ;
- transformer les champs sources en mesures métier modifiables ;
- créer des visuels depuis le Studio ;
- synchroniser un serveur FTP en lecture seule.

## Donnée affichée aujourd'hui

Le dashboard conserve les Books CRVO validés comme historique de référence. L'API `/api/dashboard` donne maintenant la priorité aux instantanés issus du FTP lorsqu'un lot FTP est **vérifié** et possède des KPI réellement mappés. Un fichier uniquement archivé n'écrase jamais une journée validée.

L'historique embarqué couvre notamment les journées du 03/08/2026 au 12/08/2026. Le dernier Book embarqué reste donc utilisable tant que le mapping métier des nouveaux CSV FTP n'est pas validé.

## Architecture

```text
Serveur FTP (lecture seule, port 21)
        |
        v
GitHub Action planifiée / bridge Node
        |-- connexion FTP + téléchargement en mémoire
        |-- empreinte SHA-256 et anti-doublon
        |-- détection du schéma des CSV
        v
Passerelle sécurisée Supabase Edge Function
        |-- journal des synchronisations
        |-- URL d'archive privée à durée limitée
        |-- validation / archivage des lots
        v
Supabase Storage + PostgreSQL
        |
        v
API serveur Cloudflare
        |
        v
Dashboard + Sources + Studio + Paramètres
```

Le pont FTP est séparé du Worker public : aucun mot de passe FTP ni aucune clé Supabase privilégiée n'est envoyé au navigateur. Le bridge GitHub ne possède pas de clé Supabase privilégiée : les opérations sensibles transitent par la fonction `kpi-ftp-bridge-gateway`, qui utilise la clé serveur uniquement dans l'environnement Supabase.

Le répertoire distant `\` fourni par le serveur est normalisé en `/`, la racine FTP standard.

## Flux FTP actuellement détecté

Le contrôle opérationnel du 13/08/2026 a confirmé la connexion au serveur FTP et la présence de **12 fichiers CSV** :

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

Le bridge archive les versions nouvelles et ignore les doublons par SHA-256. Les CSV sont actuellement marqués `pending_csv_schema` tant que leur correspondance métier n'est pas explicitement validée. Cette protection évite qu'un ancien mapping Excel soit appliqué par erreur à un CSV et qu'il génère de faux zéros dans le dashboard.

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
3. La fonction `kpi-ftp-bridge-gateway` assure les opérations privilégiées du bridge FTP.
4. La source active `Serveur FTP CRVO` contient les paramètres **non sensibles** de connexion (`host`, `port`, `username`, `remoteDir`, `secure`) dans sa colonne `connection`.
5. Définir dans Cloudflare :
   - `SUPABASE_URL=https://tvmkhvfmdstkunwwuzuz.supabase.co`
   - `SUPABASE_SECRET_KEY` comme secret serveur pour les API du dashboard qui en ont besoin.
6. Ne jamais créer de variable publique contenant la secret key ou la legacy `service_role` key.

Toutes les tables exposées ont RLS activé. Les rôles `anon` et `authenticated` n'ont aucun accès direct aux tables KPI. Les clés privilégiées restent côté serveur.

## Passerelle FTP

Le bridge se trouve dans `bridge/` et s'exécute automatiquement via `.github/workflows/kpi-sftp-sync.yml` les jours ouvrés. Le nom historique du fichier de workflow est conservé pour ne pas casser la planification existante ; le workflow lui-même s'appelle `KPI CRVO - synchronisation FTP`.

Secrets GitHub Actions réellement nécessaires au bridge :

- `FTP_PASSWORD`
- `SUPABASE_URL`

Les paramètres `FTP_HOST`, `FTP_PORT`, `FTP_USERNAME` et `FTP_REMOTE_DIR` restent acceptés comme fallback, mais la configuration active est lue depuis Supabase. Le workflow accepte également temporairement les anciens secrets `SFTP_*` comme fallback de transition ; aucune connexion SFTP n'est utilisée.

Variables GitHub Actions optionnelles :

- `FTP_SECURE=false` pour le FTP classique ; passer à `true` si le serveur active l'Explicit FTPS ;
- `FTP_FILE_PATTERN=\\.(csv|xls|xlsx)$`.

Le compte FTP est utilisé uniquement en lecture. Le pont liste et télécharge les fichiers correspondant au motif ; il n'appelle aucune opération d'écriture, de déplacement ou de suppression sur le serveur source.

## Règles de mapping

Les 30 règles historiques de `kpi_field_mappings` correspondent aux anciens Books Excel (`Synthèse`, `Tdb Production`, `Goulot`). Elles restent disponibles pour les imports XLS/XLSX.

Les fichiers CSV FTP suivent des schémas différents. Le bridge détecte leurs en-têtes et les archive sans publier de KPI tant que le mapping propre à chaque CSV n'est pas validé. Les valeurs absentes ne sont jamais transformées en `0` par défaut.

## Déploiement Cloudflare

Configuration : [wrangler.jsonc](wrangler.jsonc).

- Commande de build : `npm ci && npm run build`
- Commande de déploiement : `npx wrangler deploy --config wrangler.jsonc`
- Répertoire statique : `dist/client`
- Worker : `dist/server/index.js`

Le déploiement doit conserver les secrets Cloudflare existants. Les données sensibles ne figurent ni dans le code, ni dans `wrangler.jsonc`, ni dans le dépôt GitHub.
