const CODES: Record<string, string> = {
  '0x8A150101': 'L’application est en cours d’utilisation : fermez-la puis relancez la mise à jour.',
  '0x8A150102': 'Une autre installation est déjà en cours. Attendez qu’elle se termine.',
  '0x8A150103': 'Un fichier est utilisé par un autre programme. Fermez l’application concernée.',
  '0x8A150104': 'Une dépendance est manquante.',
  '0x8A150105': 'Le disque est plein.',
  '0x8A150106': 'Mémoire insuffisante pour l’installation.',
  '0x8A150107': 'Pas de connexion réseau pendant l’installation.',
  '0x8A150108': 'L’installeur a échoué : l’éditeur recommande de contacter son support.',
  '0x8A150109': 'Installation réussie : un redémarrage est nécessaire pour la terminer.',
  '0x8A15010A': 'Un redémarrage est nécessaire avant de pouvoir installer.',
  '0x8A15010B': 'L’installeur a lancé un redémarrage.',
  '0x8A15010C': 'Installation annulée par l’utilisateur.',
  '0x8A15010D': 'Une autre version est déjà installée.',
  '0x8A15010E': 'Une version plus récente est déjà installée (rétrogradation refusée).',
  '0x8A15010F': 'Installation bloquée par une stratégie de l’organisation.',
  '0x8A150008': 'Le téléchargement de l’installeur a échoué (réseau ou serveur de l’éditeur).',
  '0x8A150011': 'L’empreinte de l’installeur ne correspond pas au manifeste winget : la mise à jour est bloquée par sécurité. Réessayez plus tard.',
  '0x8A15002B': 'Aucune mise à jour applicable trouvée (déjà à jour, ou installée par un autre moyen).',
  '0x80240017': 'Mise à jour non applicable à ce PC.',
  '0x80240022': 'Toutes les mises à jour du lot ont échoué.',
  '0x8024402C': 'Serveur Windows Update injoignable (proxy ou DNS).',
  '0x80244022': 'Service Windows Update temporairement indisponible.',
  '0x80070005': 'Accès refusé : droits administrateur requis.',
  '0x80070070': 'Espace disque insuffisant.',
  '0x800705B4': 'Délai dépassé.',
  '0x80073712': 'Le magasin de composants Windows est endommagé (essayez « DISM /Online /Cleanup-Image /RestoreHealth »).',
  '0x80072EE7': 'Nom de serveur introuvable : vérifiez la connexion Internet.',
  '0x80072EFD': 'Connexion au serveur impossible.',
  '0x80072EFE': 'Connexion interrompue.',
  '0x80072F8F': 'Erreur de sécurité TLS : vérifiez la date et l’heure du PC.',
  '0x800F0922': 'Échec de l’installation (partition réservée trop petite ou VPN actif).',
};

const EXIT_CODES: Record<number, string> = {
  1603: 'Erreur fatale de l’installeur MSI.',
  1618: 'Une autre installation MSI est en cours.',
  1641: 'L’installeur a lancé un redémarrage.',
  3010: 'Installation réussie : redémarrage nécessaire.',
};

export const NETWORK_ERROR_RE =
  /0x80072EE7|0x80072EFD|0x80072EFE|0x8024402C|0x80244022|0x8A150008|0x8A150107|ETIMEDOUT|ECONNRESET|ENOTFOUND|timed out|réseau|network/i;

export function explainError(log: string[] | string, exitCode?: number): string | undefined {
  const text = Array.isArray(log) ? log.join('\n') : log;
  for (const m of text.matchAll(/0x[0-9a-f]{8}/gi)) {
    const hint = CODES[m[0].toUpperCase().replace('0X', '0x')];
    if (hint) return `${m[0]} — ${hint}`;
  }
  for (const m of text.matchAll(/(?:code|exit code|code de sortie)\s*:?\s*(-?\d{3,10})/gi)) {
    let n = Number(m[1]);
    if (n < 0) n = n >>> 0;
    const hex = `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
    if (CODES[hex]) return `${hex} — ${CODES[hex]}`;
    if (EXIT_CODES[n]) return `Code ${n} — ${EXIT_CODES[n]}`;
  }
  if (exitCode !== undefined) {
    const n = exitCode >>> 0;
    const hex = `0x${n.toString(16).toUpperCase().padStart(8, '0')}`;
    if (CODES[hex]) return `${hex} — ${CODES[hex]}`;
    if (EXIT_CODES[exitCode]) return `Code ${exitCode} — ${EXIT_CODES[exitCode]}`;
  }
  return undefined;
}

export function isNetworkError(log: string[] | string): boolean {
  return NETWORK_ERROR_RE.test(Array.isArray(log) ? log.join('\n') : log);
}
