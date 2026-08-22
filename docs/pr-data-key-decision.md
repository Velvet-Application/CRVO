# Décision de clé métier PR

La clé catalogue retenue est `(Référence normalisée, Marque normalisée)`.

Motif : le fichier métier réel contient des références identiques sous plusieurs marques pour des désignations et tarifs différents. Les mouvements, réservations et forfaits doivent utiliser l'`itemId` dès qu'une référence brute est ambiguë.
