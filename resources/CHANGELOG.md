1.0.1 — 08/10/2026

Corrections
- Lenovo (LSUClient) : les versions des mises à jour arrivaient dans l'interface sous forme d'objets et laissaient la fenêtre vide (erreur React #31). Elles sont désormais lues comme du texte ; une version illisible (0.0.0.0) est affichée comme inconnue. Les résultats en cache touchés sont ignorés au démarrage.
- Une erreur d'affichage, y compris dans la fenêtre réduite de la zone de notification, affiche maintenant un message avec « Réessayer » et « Recharger l'interface » au lieu d'une fenêtre vide.

1.0.0 — 07/10/2026 — première version publique

Sources
- WinGet (module Microsoft.WinGet.Client si présent), Scoop, Chocolatey, Microsoft Store, navigateurs, extensions VS Code, images Docker
- Windows Update (cumulatives, Defender, .NET…), mises à jour de fonctionnalités Windows, WSL et paquets des distributions WSL
- Pilotes et firmware Windows Update, NVIDIA (Game Ready / Studio), Intel (graphique et DSA), AMD (information), Lenovo, Dell, HP, BIOS ASUS
- npm, pnpm, Yarn, Bun, pip, pipx, cargo, outils .NET, PowerShell Gallery ; programmes hors gestionnaire associables à winget

Détection
- Comparaison de versions fiable, préversions masquées, doublons fusionnés, dates des pilotes
- Pilotes de périphériques absents masqués et oubliables, pilotes facultatifs distingués
- Délai et fréquence par source, cache, nouvelle tentative, journal de diagnostic
- Stratégies de l'organisation respectées (WSUS, exclusion des pilotes, Intune)

Sécurité
- Page Sécurité : fins de support, failles activement exploitées (CISA KEV), vulnérabilités (OSV, NVD), état du poste
- Opérations administrateur en liste fermée, une seule fenêtre UAC par lot, script élevé vérifié en mémoire
- Assistant administrateur facultatif sans UAC, à empreinte contrôlée
- Installeurs vérifiés (SHA-256, signature, éditeur), interface verrouillée, journaux expurgés

Installation
- Point de restauration, contrôle batterie/secteur, Secure Boot, TPM et suspension BitLocker avant un BIOS
- Mode simulation, version précise, retour arrière, restauration de pilote, téléchargement seul
- Annuler, interrompre, réordonner, installations parallèles, reprise après fermeture, contrôle de l'espace disque
- Fermeture/relance des applications, codes d'erreur expliqués, nouvelle tentative réseau, redémarrage à la carte

Automatisation
- Mises à jour automatiques par source/paquet, plage horaire, connexion limitée, batterie, plein écran, mode Focus
- Quarantaine des nouvelles versions, épinglage de version majeure, règles à jokers, profils
- Tâche planifiée Windows, notifications actionnables, résumé hebdomadaire

Interface
- Tableau de bord, recherche globale (Ctrl+K), raccourcis clavier, vue compacte, colonnes configurables
- Inventaire, fiche matériel, maintenance, historique avec export CSV et graphique mensuel
- Notes de version depuis la version installée, zone de notification, mini-fenêtre, pastille sur la barre des tâches
- Français, anglais, allemand, espagnol ; thèmes clair et sombre ; accessibilité WCAG 2.1 AA
- Export / import des paquets et des paramètres, version portable, ligne de commande upkeep-cli
