import { cleanLinkText } from './linkHelpers.js';

export function buildPreviewMessage(title, clientName, info) {
  const link = info.shortLink || info.directUrl;
  const t = cleanLinkText(title);
  const c = cleanLinkText(clientName);
  const namePart = t ? `${t} ${c}` : c;
  return `Dear ${namePart},

With sincere appreciation, your StarShots delivery files have been prepared and are now ready for your kind attention.

Your Delivery Files and Invoice may be accessed through the details below:

\u2022 Link: ${link}
\u2022 Password: ${info.pass}

Should you prefer a different password, please let us know and we will update it for you.

Kindly download the files within the stated availability period.

It has been our pleasure to serve you, and we look forward to welcoming you again.

Warm Regards,
StarShots ID`;
}
