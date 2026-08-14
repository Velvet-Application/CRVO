# Réception e-mail des anciens flux SQL CRVO

## Périmètre

Ce canal remplace uniquement les trois flux historiques issus de SQL :

1. Data RH / présentéisme.
2. Chiffre d'affaires / reporting factures.
3. Temps de pointage dans les dossiers facturés.

Le FTP usine est indépendant et ne doit jamais être routé vers cette passerelle.

## Architecture

E-mail -> Make Custom Mailhook -> pièces jointes -> API CRVO -> archive brute -> contrôle SHA-256 -> classification -> intégration Supabase.

Endpoint CRVO :

`POST https://kpi-crvo.cyril-gay.workers.dev/api/email-import`

Authentification :

`x-crvo-ingest-token: <CLE_GENEREE_DANS_DATA_RH>`

La clé se génère depuis `Paramètre > Data RH > Connexion Make -> CRVO`. Seul son SHA-256 est conservé dans Supabase. La valeur en clair n'est affichée qu'au moment de sa création et une nouvelle génération invalide immédiatement l'ancienne.

## Corps HTTP attendu

Requête `multipart/form-data` :

- `file` : pièce jointe CSV, XLSX ou XLS (obligatoire).
- `sender` : adresse expéditeur (optionnel).
- `subject` : objet du mail (optionnel).
- `messageId` : identifiant du message (optionnel).
- `source` : `auto`, `rh`, `finance` ou `billed_time` (optionnel ; laisser `auto` si les trois fichiers arrivent dans le même mail).

Chaque pièce jointe doit être envoyée séparément à l'endpoint. Le routeur CRVO reconnaît le type de fichier à partir du nom, de l'objet et surtout des colonnes détectées.

## Scénario Make

1. Dans KPI CRVO, ouvrir `Paramètre > Data RH`, générer la clé Make et la copier.
2. Dans Make, ajouter `Webhooks > Custom mailhook` et créer l'adresse de réception.
3. Envoyer un mail de test contenant les trois exports.
4. Utiliser `Flow control > Iterator` sur les pièces jointes reçues.
5. Ajouter `HTTP > Make a request`.
6. Méthode `POST`, URL de l'endpoint CRVO ci-dessus.
7. Ajouter le header `x-crvo-ingest-token` et coller la clé générée depuis KPI CRVO.
8. Choisir `multipart/form-data` et mapper le nom + les données binaires de chaque pièce jointe dans le champ `file`.
9. Mapper l'expéditeur, l'objet et l'identifiant du message si disponibles.
10. Activer le scénario seulement après un test réussi des trois fichiers.

## Comportement de sécurité et d'intégration

- formats autorisés : CSV, XLSX, XLS ;
- taille maximale côté CRVO : 25 Mo par pièce jointe ;
- SHA-256 calculé avant intégration ;
- un fichier déjà reçu n'est pas importé deux fois ;
- l'original est archivé dans `kpi-raw-archive/email/...` ;
- un fichier inconnu est archivé puis mis en quarantaine ;
- aucune donnée FTP n'est traitée par cet endpoint ;
- les données RH remplacent uniquement les dates présentes dans le fichier reçu ;
- les factures conservent la continuité de l'historique `kpi_invoice_facts` ;
- le pointage facturé est historisé puis rapproché des factures par numéro de facture ou OR.

## Validation avant production

Pour verrouiller le mapping réel, tester un exemplaire de chacun des trois exports. Les alias de colonnes courants français et anglais sont déjà pris en charge, mais aucun format métier non observé ne doit être considéré comme validé sans ce test.
