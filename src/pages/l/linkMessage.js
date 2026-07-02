import { cleanLinkText } from './linkHelpers.js';

export function buildPreviewMessage(title, clientName, info) {
  const link = info.shortLink || info.directUrl;
  const t = cleanLinkText(title);
  const c = cleanLinkText(clientName);
  const namePart = t ? `${t} ${c}` : c;
  return `Dear ${namePart},

With sincere appreciation, your private StarShots delivery page has been prepared for your kind attention.

You may access your Delivery Page and Invoice through the details below:

• Link: ${link}
• Password: ${info.pass}

Should you wish to use a different password, please feel free to let us know and we will be pleased to update it for you.

Kindly keep this link for your delivery updates. Your final files will be made available through the same page once they are ready.

Thank you once again for allowing StarShots ID to be part of your special moment.

Warm Regards,
StarShots ID`;
}
