const HONORIFIC_RE = /^(?:Mr|Ms|Mrs|Miss|Dr|Kak|Pak|Bu|Ko|Ci)\.?$/i;

function formatDeliveryEventDate(value) {
  const raw = String(value || '').trim();
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(raw)) return 'TBA';
  const date = new Date(`${raw}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return 'TBA';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function stripMessageFormatting(text) {
  return String(text || '').replace(/[*_~`]/g, '');
}

export function toUnicodeBold(text) {
  return String(text ?? '').replace(/[A-Za-z0-9]/g, (character) => {
    const code = character.charCodeAt(0);
    if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D5D4 + code - 65);
    if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D5EE + code - 97);
    return String.fromCodePoint(0x1D7EC + code - 48);
  });
}

export function formatClientSalutation(rawName, useLastName = false) {
  const parts = String(rawName ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Client';

  const honorific = HONORIFIC_RE.test(parts[0]) ? parts.shift() : '';
  if (!parts.length) return honorific || 'Client';

  const selectedName = parts.length === 1
    ? parts[0]
    : (useLastName ? parts[parts.length - 1] : parts[0]);

  return [honorific, selectedName].filter(Boolean).join(' ');
}

export function buildDeliveryMessage(input = {}) {
  const title = String(input.title ?? 'Ms.').trim();
  const clientName = String(input.clientName || 'Client').trim() || 'Client';
  const firstClientToken = clientName.split(/\s+/)[0] || '';
  const rawSalutation = HONORIFIC_RE.test(firstClientToken)
    ? clientName
    : [title, clientName].filter(Boolean).join(' ');
  const salutation = formatClientSalutation(rawSalutation, input.useLastName === true);
  const link = String(input.link || '(link unavailable)').trim();
  const pass = String(input.password || '(no password)').trim();
  const folder = String(input.folderName || '').trim();
  const eventDate = input.eventDateLabel !== undefined
    ? String(input.eventDateLabel || '').trim()
    : formatDeliveryEventDate(input.eventDate);

  const lines = input.previewOnly || (!folder && !eventDate)
    ? [`• Link: ${link}`, `• Password: ${pass}`]
    : [
        folder ? `${toUnicodeBold('Folder:')} ${folder}` : '',
        eventDate ? `${toUnicodeBold('Event Date:')} ${eventDate}` : '',
        `${toUnicodeBold('Link:')} ${link}`,
        `${toUnicodeBold('Password:')} ${pass}`,
      ].filter(Boolean);
  const details = lines.join('\n');

  if (input.deliveryDone) {
    return `Dear ${toUnicodeBold(salutation)},\n\nYour StarShots files are now ready.\n\nYou may access them here:\n${details}\n\nThank you for your patience.\nWith love, StarShots`;
  }

  return `Dear ${toUnicodeBold(salutation)},\n\nWith sincere appreciation, your private StarShots delivery page has been prepared for your kind attention.\n\nYou may access your ${toUnicodeBold('Delivery Page')} and ${toUnicodeBold('Invoice')} through the details below:\n\n${details}\n\nShould you wish to use a different password, please feel free to let us know and we will be pleased to update it for you.\n\nKindly keep this link for your delivery updates. Your final files will be made available through the same page once they are ready.\n\nThank you once again for allowing StarShots ID to be part of your special moment.\n\nWarm Regards,\nStarShots ID`;
}

// Keep the previous exports so the /l preview and any legacy callers
// continue to resolve without a route or API change. Both now share
// the same text format; previewOnly remains plain link/password text.
export const buildDeliveryMessageWa = buildDeliveryMessage;
export const buildDeliveryMessageIg = buildDeliveryMessage;
