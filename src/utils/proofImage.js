// Client-side payment-proof upload helper for /db Subs.
//
// There is no blob-storage binding in this app (the worker only has
// Workers AI), and the `payment_proof` column is plain Postgres text.
// So — mirroring how the invoice composer stores its QR/payment
// screenshot inline as a canvas data URL — an uploaded receipt image
// is downscaled here and returned as a compact JPEG data URL that is
// saved directly in the existing `payment_proof` string field. This
// keeps the feature backward compatible: the column still holds a
// string, existing http(s) proof links keep working unchanged, and
// no new storage infrastructure is required.
//
// The image is bounded to MAX_DIM on its longest edge and re-encoded
// as JPEG so a phone screenshot lands well under the column's size
// budget (typically ~30-80 KB) instead of a multi-MB original.

const MAX_DIM = 1100;
const JPEG_QUALITY = 0.7;
// Hard ceiling that matches the worker's payment_proof slice cap, so
// we never hand the server a value it would silently truncate.
const MAX_DATA_URL_LENGTH = 800000;
const MULTI_PROOF_PREFIX = 'proofs:v1:';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve({ img, url }); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

// Read an uploaded proof File and resolve to a downscaled JPEG data
// URL string suitable for storing in `payment_proof`. Rejects for
// non-image files or if the result would exceed the column budget
// even after a quality step-down.
export async function readProofFile(file) {
  if (!file) throw new Error('No file selected.');
  if (!/^image\//i.test(file.type || '')) {
    throw new Error('Please choose an image (JPG, PNG, or WebP).');
  }
  const { img, url } = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    // Flat white matte so a transparent PNG still reads as a receipt.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let quality = JPEG_QUALITY;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    // Step the quality down a couple of times for very large images
    // so the stored string stays within the column budget.
    while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > 0.4) {
      quality -= 0.15;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    if (dataUrl.length > MAX_DATA_URL_LENGTH) {
      throw new Error('That image is too large — try a smaller screenshot.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function parseProofList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  if (raw.startsWith(MULTI_PROOF_PREFIX)) {
    try {
      const parsed = JSON.parse(raw.slice(MULTI_PROOF_PREFIX.length));
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => String(item || '').trim())
          .filter(Boolean);
      }
    } catch {}
  }
  return [raw];
}

export function serializeProofList(list = []) {
  const proofs = (Array.isArray(list) ? list : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (!proofs.length) return '';
  if (proofs.length === 1) return proofs[0];
  return `${MULTI_PROOF_PREFIX}${JSON.stringify(proofs)}`;
}

// True when a stored proof value is a displayable image: an inline
// uploaded image (data URL) or an http(s) link that points at a
// common image file extension. Pasted reference strings and
// non-image links return false.
export function isProofImage(value) {
  const v = String(value || '').trim();
  if (/^data:image\//i.test(v)) return true;
  // http(s) URL ending in an image extension, ignoring any ?query
  // or #hash suffix (e.g. ".../receipt.jpg?token=abc").
  return /^https?:\/\//i.test(v) && /\.(jpe?g|png|gif|webp|bmp|svg|avif)(?:[?#]|$)/i.test(v);
}

// True when a stored proof value is an openable URL (uploaded image
// data URL or an http(s) link). Reference strings return false.
export function isProofViewable(value) {
  const v = String(value || '').trim();
  return /^data:image\//i.test(v) || /^https?:\/\//i.test(v);
}
