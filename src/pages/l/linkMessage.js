import { cleanLinkText } from './linkHelpers.js';
import { buildDeliveryMessageIg } from '../../features/deliveries/deliveryMessages.js';

export function buildPreviewMessage(title, clientName, info) {
  return buildDeliveryMessageIg({
    title: cleanLinkText(title),
    clientName: cleanLinkText(clientName),
    link: info.shortLink || info.directUrl,
    password: info.pass,
    previewOnly: true,
  });
}
