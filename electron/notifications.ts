import { Notification } from 'electron';
import { createLinkToken, type LinkAction } from './lib/links';
import { t } from '../shared/i18n';

export { parseLink } from './lib/links';

function xml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export function actionableToast(opts: {
  title: string;
  body: string;
  icon: string;
  items: { key: string; availableVersion?: string }[];
  onClick: () => void;
}): Notification {
  const token = createLinkToken(opts.items);
  const btn = (action: LinkAction, label: string) =>
    `<action content="${xml(label)}" activationType="protocol" arguments="upkeep://action/${action}?token=${token}"/>`;
  const toastXml =
    `<toast launch="upkeep://open/updates" activationType="protocol">` +
    `<visual><binding template="ToastGeneric"><text>${xml(opts.title)}</text><text>${xml(opts.body)}</text>` +
    `<image placement="appLogoOverride" src="file:///${xml(opts.icon.replace(/\\/g, '/'))}"/></binding></visual>` +
    `<actions>${btn('install', t('Mettre à jour'))}${btn('snooze', t('Plus tard'))}${btn('ignore', t('Ignorer'))}</actions></toast>`;
  const n = new Notification({ toastXml });
  n.on('click', opts.onClick);
  n.show();
  return n;
}
