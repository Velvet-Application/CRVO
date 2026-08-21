# CRVO Qualité Réseau — iOS

Projet SwiftUI natif destiné aux concessions / utilisateurs Réseau.

## Ouvrir dans Xcode

Ouvrir directement :

`ios/CRVOQualiteReseau/CRVOQualiteReseau.xcodeproj`

Le target `CRVOQualiteReseau` est configuré pour iOS 17+.

Avant une archive App Store / TestFlight, sélectionner l'équipe Apple dans Signing & Capabilities et remplacer si nécessaire le bundle ID `com.crvo.qualitereseau` par l'identifiant validé dans Apple Developer.

## Connexion

L'app n'embarque aucun secret ni URL serveur en dur. L'utilisateur colle le lien sécurisé / QR fourni depuis la Toolbox. L'app en extrait le domaine et le token réseau puis appelle les mêmes API que le Web mobile.

## Fonctionnalités V1

- accueil et KPI Réseau ;
- historique des réclamations ;
- recherche véhicule par immatriculation ;
- déclaration d'une anomalie ;
- photos depuis la photothèque / caméra système ;
- consultation du statut et de la réponse comité ;
- chat avec le CRVO dans chaque dossier ;
- consultation plein écran des pièces image ;
- bandeau temporaire lorsqu'un dossier est mis à jour ou lorsqu'un nouveau message CRVO est détecté.

Les notifications push système hors application nécessitent ensuite l'activation APNs sur le compte Apple Developer et la fourniture des credentials APNs côté serveur. Aucun secret APNs ne doit être commité dans GitHub.
