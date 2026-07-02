const STYLE_ID = 'public-payment-proof-inject-style';
const MAX_IMAGES = 3;
const MAX_DIM = 1100;
const JPEG_QUALITY = 0.7;
const MAX_DATA_URL_LENGTH = 790000;

function slugFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts[0]?.toLowerCase() === 'g') return parts[1] || '';
  return parts[0] || '';
}

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .public-payment-proof-card{
      position:relative;
      display:grid;
      grid-template-columns:44px minmax(0,1fr) auto;
      align-items:center;
      gap:14px;
      min-height:64px;
      margin-top:14px;
      padding:10px 16px;
      border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);
      border-radius:18px;
      background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 17%,transparent),color-mix(in srgb,var(--accent) 10%,transparent));
      box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 52%,transparent),0 12px 26px -18px color-mix(in srgb,var(--accent) 58%,transparent);
      color:var(--ink);
      cursor:pointer;
      transition:transform .15s ease,box-shadow .15s ease,background .15s ease,border-color .15s ease;
    }
    .public-payment-proof-card:hover{
      transform:translateY(-1px);
      border-color:color-mix(in srgb,var(--accent) 50%,transparent);
      background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 23%,transparent),color-mix(in srgb,var(--accent) 14%,transparent));
      box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 56%,transparent),0 16px 34px -18px color-mix(in srgb,var(--accent) 64%,transparent);
    }
    .public-payment-proof-card:active{transform:translateY(0) scale(.995)}
    .public-payment-proof-card.is-pending,
    .public-payment-proof-card.is-locked{
      cursor:default;
      border-color:color-mix(in srgb,var(--line) 78%,transparent);
      background:color-mix(in srgb,var(--soft) 14%,transparent);
      box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 36%,transparent);
    }
    .public-payment-proof-card.is-confirmed{
      cursor:default;
      border-color:color-mix(in srgb,var(--sub-active) 36%,transparent);
      background:linear-gradient(180deg,color-mix(in srgb,var(--sub-active) 18%,transparent),color-mix(in srgb,var(--sub-active) 11%,transparent));
      box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 52%,transparent),0 12px 26px -18px color-mix(in srgb,var(--sub-active) 50%,transparent);
    }
    .public-payment-proof-icon{
      display:inline-grid;
      place-items:center;
      width:36px;
      height:36px;
      border-radius:12px;
      background:color-mix(in srgb,var(--accent) 30%,transparent);
      color:color-mix(in srgb,var(--accent) 78%,var(--ink));
      font-size:11px;
      font-weight:900;
      letter-spacing:.06em;
    }
    .public-payment-proof-card.is-confirmed .public-payment-proof-icon{background:color-mix(in srgb,var(--sub-active) 30%,transparent);color:color-mix(in srgb,var(--sub-active) 82%,var(--ink))}
    .public-payment-proof-card.is-pending .public-payment-proof-icon,
    .public-payment-proof-card.is-locked .public-payment-proof-icon{background:color-mix(in srgb,var(--field) 55%,transparent);color:var(--muted)}
    .public-payment-proof-copy{min-width:0}
    .public-payment-proof-label{display:block;font-size:15px;font-weight:900}
    .public-payment-proof-note{display:block;margin-top:2px;color:var(--muted);font-size:12px;font-weight:500;line-height:1.35}
    .public-payment-proof-action{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      min-height:34px;
      padding:0;
      border:0;
      border-radius:0;
      background:transparent;
      color:color-mix(in srgb,var(--accent) 82%,var(--ink));
      font-size:11px;
      font-weight:900;
      line-height:1;
      letter-spacing:.18em;
      text-transform:uppercase;
      white-space:nowrap;
      pointer-events:none;
    }
    .public-payment-proof-input{
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      opacity:0;
      cursor:pointer;
    }
    .public-payment-proof-card.is-pending .public-payment-proof-input,
    .public-payment-proof-card.is-locked .public-payment-proof-input,
    .public-payment-proof-card.is-confirmed .public-payment-proof-input{
      pointer-events:none;
    }
    .public-payment-proof-card.is-pending .public-payment-proof-action,
    .public-payment-proof-card.is-locked .public-payment-proof-action{color:var(--muted)}
    .public-payment-proof-card.is-confirmed .public-payment-proof-action{color:color-mix(in srgb,var(--sub-active) 84%,var(--ink))}
    @media(max-width:1023px){
      .public-payment-proof-card{grid-template-columns:40px minmax(0,1fr) auto;gap:12px;min-height:60px;padding:10px 14px}
      .public-payment-proof-icon{width:32px;height:32px;border-radius:10px;font-size:10px}
      .public-payment-proof-label{font-size:14px}
      .public-payment-proof-action{font-size:10px;letter-spacing:.14em}
    }
  `;
  document.head.appendChild(style);
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

async function readProofFile(file) {
  if (!file || !/^image\//i.test(file.type || '')) throw new Error('Please choose an image.');
  const { img, url } = await loadImage(file);
  try {
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    let quality = JPEG_QUALITY;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > MAX_DATA_URL_LENGTH && quality > 0.4) {
      quality -= 0.15;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    if (dataUrl.length > MAX_DATA_URL_LENGTH) throw new Error('That image is too large — try a smaller screenshot.');
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function setProofState(row, state, note, actionText) {
  row.classList.remove('is-pending', 'is-locked', 'is-confirmed');
  if (state) row.classList.add(state);
  row.querySelector('.public-payment-proof-note').textContent = note;
  row.querySelector('.public-payment-proof-action-text').textContent = actionText;
}

function syncAllProofRows(note, actionText, state) {
  document.querySelectorAll('.public-payment-proof-card').forEach((row) => setProofState(row, state, note, actionText));
}

async function uploadProof(row, files) {
  const selected = Array.from(files || []).slice(0, MAX_IMAGES);
  if (!selected.length || row.dataset.busy === '1') return;
  row.dataset.busy = '1';
  setProofState(row, '', 'Preparing upload…', 'Wait');
  try {
    const images = [];
    for (const file of selected) images.push(await readProofFile(file));
    setProofState(row, '', 'Uploading proof…', 'Wait');
    const response = await fetch('/api/payment-proof-submit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slugFromPath(), images }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not upload proof.');
    syncAllProofRows('Proof received. Waiting for admin review.', 'Pending', 'is-pending');
  } catch (error) {
    setProofState(row, '', error?.message || 'Could not upload proof.', 'Upload');
  } finally {
    row.dataset.busy = '0';
    const input = row.querySelector('input');
    if (input) input.value = '';
  }
}

function createProofCard({ compact = false, paid = false } = {}) {
  const row = document.createElement('div');
  row.className = 'public-payment-proof-card';

  const icon = document.createElement('span');
  icon.className = 'public-payment-proof-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'PAY';

  const copy = document.createElement('span');
  copy.className = 'public-payment-proof-copy';
  const label = document.createElement('span');
  label.className = 'public-payment-proof-label';
  label.textContent = compact ? 'Payment Proof' : 'Upload Transfer Proof';
  const note = document.createElement('span');
  note.className = 'public-payment-proof-note';
  copy.append(label, note);

  const action = document.createElement('span');
  action.className = 'public-payment-proof-action';
  const actionText = document.createElement('span');
  actionText.className = 'public-payment-proof-action-text';
  action.append(actionText);

  const input = document.createElement('input');
  input.className = 'public-payment-proof-input';
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', () => uploadProof(row, input.files));

  row.append(icon, copy, action, input);
  if (paid) {
    setProofState(row, 'is-confirmed', 'Payment confirmed. Upload is closed.', 'Done');
  } else {
    setProofState(row, '', 'Upload up to 3 transfer screenshots.', 'Upload');
  }
  return row;
}

function syncDeliveryProof() {
  const invoiceRow = document.querySelector('.public-delivery-card .public-delivery-invoice');
  if (!invoiceRow || document.querySelector('.public-delivery-card .public-payment-proof-card')) return;
  invoiceRow.insertAdjacentElement('afterend', createProofCard({ compact: true, paid: invoiceRow.classList.contains('is-paid') }));
}

function syncInvoiceProof() {
  const pay = document.querySelector('.public-invoice-viewer .public-pay');
  if (!pay || document.querySelector('.public-invoice-viewer .public-payment-proof-card')) return;
  pay.insertAdjacentElement('afterend', createProofCard({ compact: false, paid: false }));
}

function sync() {
  ensureStyle();
  syncDeliveryProof();
  syncInvoiceProof();
}

function boot() {
  sync();
  const root = document.getElementById('root') || document.body;
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
