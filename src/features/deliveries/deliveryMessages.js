export function stripMessageFormatting(text) {
  return String(text || '').replace(/[*_~`]/g, '');
}

export function buildDeliveryMessageWa(input = {}) {
  const title = String(input.title ?? 'Ms.').trim();
  const clientName = String(input.clientName || 'Client').trim() || 'Client';
  const namePart = title ? `${title} ${clientName}`.trim() : clientName;
  const link = String(input.link || '(link unavailable)').trim();
  const pass = String(input.password || '(no password)').trim();
  const folder = String(input.folderName || '').trim();
  const eventDate = String(input.eventDateLabel || '').trim();
  const lines = input.previewOnly || (!folder && !eventDate)
    ? [`• Link: ${link}`, `• Password: ${pass}`]
    : [folder ? `*Folder:* ${folder}` : '', eventDate ? `*Event Date:* ${eventDate}` : '', `*Link:* ${link}`, `*Password:* \`${pass}\``].filter(Boolean);
  const details = lines.join('\n');

  if (input.deliveryDone) {
    return `Dear *${namePart}*,\n\nYour StarShots files are now ready.\n\nYou may access them here:\n${details}\n\nThank you for your patience.\nWith love, StarShots`;
  }

  return `Dear *${namePart}*,\n\nWith sincere appreciation, your private StarShots delivery page has been prepared for your kind attention.\n\nYou may access your *Delivery Page* and *Invoice* through the details below:\n\n${details}\n\nShould you wish to use a different password, please feel free to let us know and we will be pleased to update it for you.\n\nKindly keep this link for your delivery updates. Your final files will be made available through the same page once they are ready.\n\nThank you once again for allowing StarShots ID to be part of your special moment.\n\nWarm Regards,\nStarShots ID`;
}

export function buildDeliveryMessageIg(input = {}) {
  return stripMessageFormatting(buildDeliveryMessageWa(input));
}
