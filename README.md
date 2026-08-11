# KPI CRVO

Dashboard décisionnel CRVO connecté à des instantanés de données historisés. L'application est conçue pour :

- archiver chaque fichier source sans écrasement ;
- détecter les doublons par empreinte SHA-256 ;
- filtrer et comparer les indicateurs dans le temps ;
- importer un historique CSV, XLS ou XLSX ;
- transformer les champs sources en mesures métier modifiables ;
- créer des visuels depuis le Studio ;
- synchroniser un serveur SFTP en lecture seule.

## Donnée affichée aujourd'hui

Le dashboard embarque un premier instantané métier réellement vérifié dans le classeur CRVO du 07/08/2026 :

| Indicateur | Valeur |
| --- | ---: |
| Entrées VOP | 78 |
| Sorties VOP | 86 |
| Stock usine | 1 097 |
| Stock > 15 jours | 494 |
| Stock > 20 jours | 399 |
| Expertise | 80 |
| Mécanique | 96 |
| DSP | 24 |
| Carrosserie | 11 |
| Préparation | 89 |
| Qualité | 88 |
| Sortie usine | 86 |

L'API `/api/dashboard` utilise automatiquement la dernière ligne Supabase dès que les secrets sont configurés. En l'absence de connexion, elle conserve ce premier instantané vérifié et l'identifie explicitement comme tel.

## Architecture

```text
Serveur SFTP (lecture seule)
        |
        v
GitHub Action planifiée / bridge Node
        |-- empreinte SHA-256 et anti-doublon
        |-- archive originale privée Supabase Storage
        `-- indicateurs normalisés dans PostgreSQL
                    |
                    v
          API serveur Cloudflare
                    |
                    v
       Dashboard + Sources + Studio + Paramètres
```

Le pont SFTP est séparé du Worker public : aucun mot de passe, aucune clé privée et aucune clé Supabase privilégiée n'est envoyée au navigateur.

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

1. Appliquer [supabase/schema.sql](supabase/schema.sql) dans l'éditeur SQL du projet.
2. Créer ou laisser le bridge créer le bucket privé `kpi-raw-archive` via l'API Storage.
3. Définir dans Cloudflare :
   - `SUPABASE_URL=https://tvmkhvfmdstkunwwuzuz.supabase.co`
   - `SUPABASE_SECRET_KEY` comme secret serveur.
4. Ne jamais créer de variable publique contenant la secret key ou la legacy `service_role` key.

Toutes les tables exposées ont RLS activé. Les rôles `anon` et `authenticated` n'ont aucun accès direct aux tables KPI. Le Worker serveur et le bridge utilisent seuls la clé privilégiée.

## Passerelle SFTP

Le bridge se trouve dans `bridge/` et s'exécute automatiquement via `.github/workflows/kpi-sftp-sync.yml` les jours ouvrés.

Secrets GitHub Actions requis :

- `SFTP_HOST`
- `SFTP_PORT`
- `SFTP_USERNAME`
- `SFTP_PASSWORD` ou `SFTP_PRIVATE_KEY`
- `SFTP_PRIVATE_KEY_PASSPHRASE` si nécessaire
- `SFTP_HOST_FINGERPRINT_SHA256`
- `SFTP_REMOTE_DIR`
- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

Variables GitHub Actions :

- `KPI_SOURCE_ID=dfbb57cc-8771-4e53-b52b-38defa389b64`
- `SUPABASE_ARCHIVE_BUCKET=kpi-raw-archive`
- `SFTP_FILE_PATTERN=\\.(csv|xls|xlsx)$`

Le compte SFTP doit être limité à la lecture du répertoire d'exports. Le pont n'appelle aucune opération d'écriture, de déplacement ou de suppression sur le serveur source.

## Règles de mapping

Les règles sont stockées dans `kpi_field_mappings`. Pour une cellule Excel, `source_field` suit la forme :

```text
Nom de la feuille!B12
```

Le pont archive toujours le fichier avant de lancer les règles. Si aucune règle ne correspond, le fichier reste archivé avec le statut `archived` et peut être traité plus tard sans perdre l'original.

## Déploiement Cloudflare

Configuration : [wrangler.jsonc](wrangler.jsonc).

- Commande de build : `npm ci && npm run build`
- Commande de déploiement : `npx wrangler deploy --config wrangler.jsonc`
- Répertoire statique : `dist/client`
- Worker : `dist/server/index.js`

Le déploiement doit conserver les secrets Cloudflare existants. Les données sensibles ne figurent ni dans le code, ni dans `wrangler.jsonc`, ni dans le dépôt GitHub.
