const STYLE_ID = 'public-payment-proof-inject-style';
const MAX_IMAGES = 3;
const MAX_DIM = 1100;
const JPEG_QUALITY = 0.7;
const MAX_DATA_URL_LENGTH = 790000;
const DELETABLE_STATUSES = new Set(['pending', 'rejected']);

const proofStore = {
  proofs: [],
  locked: false,
  loaded: false,
  loading: null,
  busy: false,
  error: '',
  modal: null,
  previousFocus: null,
};

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
      position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;align-items:center;gap:14px;
      width:100%;min-height:64px;margin-top:14px;padding:10px 16px;border:1px solid color-mix(in srgb,var(--accent) 34%,transparent);
      border-radius:18px;background:linear-gradient(180deg,color-mix(in srgb,var(--accent) 17%,transparent),color-mix(in srgb,var(--accent) 10%,transparent));
      box-shadow:inset 0 1px 0 color-mix(in srgb,#fff 52%,transparent),0 12px 26px -18px color-mix(in srgb,var(--accent) 58%,transparent);
      color:var(--ink);font:inherit;text-align:left;cursor:pointer;appearance:none;
      transition:transform .15s ease,box-shadow .15s ease,background .15s ease,border-color .15s ease;
    }
    .public-payment-proof-card:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--accent) 50%,transparent)}
    .public-payment-proof-card:active{transform:translateY(0) scale(.995)}
    .public-payment-proof-card:focus-visible,.public-payment-proof-button:focus-visible,.public-payment-proof-close:focus-visible,.public-payment-proof-thumb:focus-visible{outline:3px solid color-mix(in srgb,var(--accent) 62%,transparent);outline-offset:2px}
    .public-payment-proof-card.is-confirmed{border-color:color-mix(in srgb,var(--sub-active) 36%,transparent);background:linear-gradient(180deg,color-mix(in srgb,var(--sub-active) 18%,transparent),color-mix(in srgb,var(--sub-active) 11%,transparent))}
    .public-payment-proof-card.is-pending,.public-payment-proof-card.is-rejected{border-color:color-mix(in srgb,var(--line) 78%,transparent);background:color-mix(in srgb,var(--soft) 14%,transparent)}
    .public-payment-proof-icon{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:12px;background:color-mix(in srgb,var(--accent) 30%,transparent);color:color-mix(in srgb,var(--accent) 78%,var(--ink));font-size:11px;font-weight:900;letter-spacing:.06em}
    .public-payment-proof-card.is-confirmed .public-payment-proof-icon{background:color-mix(in srgb,var(--sub-active) 30%,transparent);color:color-mix(in srgb,var(--sub-active) 82%,var(--ink))}
    .public-payment-proof-card.is-pending .public-payment-proof-icon,.public-payment-proof-card.is-rejected .public-payment-proof-icon{background:color-mix(in srgb,var(--field) 55%,transparent);color:var(--muted)}
    .public-payment-proof-copy{min-width:0}.public-payment-proof-label{display:block;font-size:15px;font-weight:900}.public-payment-proof-note{display:block;margin-top:2px;color:var(--muted);font-size:12px;font-weight:500;line-height:1.35}
    .public-payment-proof-action{color:color-mix(in srgb,var(--accent) 82%,var(--ink));font-size:11px;font-weight:900;line-height:1;letter-spacing:.18em;text-transform:uppercase;white-space:nowrap}
    .public-payment-proof-card.is-confirmed .public-payment-proof-action{color:color-mix(in srgb,var(--sub-active) 84%,var(--ink))}
    .public-payment-proof-input{display:none}
    .public-payment-proof-overlay{position:fixed;inset:0;z-index:1200;display:grid;place-items:center;padding:20px;background:rgba(8,13,25,.64);backdrop-filter:blur(10px)}
    .public-payment-proof-sheet{width:min(680px,100%);max-height:min(780px,calc(100dvh - 40px));display:flex;flex-direction:column;overflow:hidden;border:1px solid color-mix(in srgb,var(--line) 78%,transparent);border-radius:24px;background:var(--panel);box-shadow:0 30px 90px rgba(0,0,0,.32);color:var(--ink)}
    .public-payment-proof-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px 20px;border-bottom:1px solid var(--line)}
    .public-payment-proof-head p{margin:0 0 3px;color:var(--muted);font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.public-payment-proof-head strong{font-size:20px}
    .public-payment-proof-close{display:grid;place-items:center;width:40px;height:40px;border:1px solid var(--line);border-radius:12px;background:var(--field);color:var(--ink);font:inherit;font-size:22px;cursor:pointer}
    .public-payment-proof-body{display:grid;gap:14px;padding:18px 20px;overflow:auto}.public-payment-proof-empty{margin:18px 0;text-align:center;color:var(--muted)}
    .public-payment-proof-entry{display:grid;grid-template-columns:112px minmax(0,1fr) auto;align-items:center;gap:14px;padding:12px;border:1px solid var(--line);border-radius:16px;background:color-mix(in srgb,var(--field) 52%,transparent)}
    .public-payment-proof-thumb{width:112px;height:82px;padding:0;overflow:hidden;border:0;border-radius:12px;background:var(--soft);cursor:zoom-in}.public-payment-proof-thumb img{width:100%;height:100%;display:block;object-fit:cover}
    .public-payment-proof-meta{min-width:0}.public-payment-proof-meta strong{display:block;margin-bottom:5px}.public-payment-proof-meta time{display:block;margin-top:7px;color:var(--muted);font-size:12px;line-height:1.4}
    .public-payment-proof-status{display:inline-flex;padding:5px 8px;border-radius:999px;background:var(--soft);color:var(--muted);font-size:10px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
    .public-payment-proof-status.is-confirmed{background:color-mix(in srgb,var(--sub-active) 20%,transparent);color:color-mix(in srgb,var(--sub-active) 78%,var(--ink))}.public-payment-proof-status.is-rejected{background:rgba(190,58,68,.12);color:#b32939}
    .public-payment-proof-button{min-height:40px;padding:0 14px;border:1px solid var(--line);border-radius:12px;background:var(--field);color:var(--ink);font:inherit;font-size:12px;font-weight:900;cursor:pointer}.public-payment-proof-button.is-danger{border-color:rgba(190,58,68,.25);color:#b32939}.public-payment-proof-button.is-primary{border-color:transparent;background:var(--ink);color:var(--panel)}.public-payment-proof-button:disabled{opacity:.55;cursor:wait}
    .public-payment-proof-actions{display:flex;justify-content:flex-end;gap:10px;padding:0 20px 20px}.public-payment-proof-error{margin:0 20px 16px;color:#b32939;font-size:12px;font-weight:700}
    .public-payment-proof-lightbox{position:absolute;inset:0;z-index:2;display:grid;grid-template-rows:auto minmax(0,1fr);padding:18px;background:rgba(4,7,14,.94)}.public-payment-proof-lightbox-head{display:flex;justify-content:flex-end;padding-bottom:12px}.public-payment-proof-lightbox-image{width:100%;height:100%;min-height:0;object-fit:contain}
    .public-payment-proof-confirm{position:absolute;inset:0;z-index:3;display:grid;place-items:center;padding:20px;background:rgba(4,7,14,.7)}.public-payment-proof-confirm-card{width:min(430px,100%);padding:22px;border-radius:20px;background:var(--panel);color:var(--ink);box-shadow:0 24px 70px rgba(0,0,0,.35)}.public-payment-proof-confirm-card h2{margin:0 0 10px;font-size:20px}.public-payment-proof-confirm-card p{margin:0;color:var(--muted);line-height:1.55}.public-payment-proof-confirm-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
    @media(max-width:1023px){.public-payment-proof-card{grid-template-columns:40px minmax(0,1fr) auto;gap:12px;min-height:60px;padding:10px 14px}.public-payment-proof-icon{width:32px;height:32px;border-radius:10px;font-size:10px}.public-payment-proof-label{font-size:14px}.public-payment-proof-action{font-size:10px;letter-spacing:.14em}}
    @media(max-width:600px){.public-payment-proof-overlay{place-items:end center;padding:0}.public-payment-proof-sheet{max-height:88dvh;border-radius:24px 24px 0 0}.public-payment-proof-entry{grid-template-columns:88px minmax(0,1fr);align-items:start}.public-payment-proof-thumb{width:88px;height:76px}.public-payment-proof-entry>.public-payment-proof-button{grid-column:1/-1;width:100%}.public-payment-proof-actions{display:grid;grid-template-columns:1fr}.public-payment-proof-actions .public-payment-proof-button{width:100%}}
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

function imageUrl(proof) {
  return `/api/public-payment-proof-image?slug=${encodeURIComponent(slugFromPath())}&id=${encodeURIComponent(proof.id)}`;
}

function statusLabel(status = '') {
  const clean = String(status || '').toLowerCase();
  if (clean === 'pending') return 'Pending';
  if (clean === 'confirmed') return 'Confirmed';
  if (clean === 'rejected') return 'Rejected';
  if (clean === 'partial') return 'Partial';
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : 'Processed';
}

function uploadedLabel(value = '') {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Upload time unavailable';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  }).format(date);
}

function cardMode() {
  const statuses = proofStore.proofs.map((proof) => String(proof.status || '').toLowerCase());
  if (proofStore.locked || statuses.includes('confirmed')) {
    return { className: 'is-confirmed', note: 'Payment confirmed', action: 'View' };
  }
  if (statuses.some((status) => !DELETABLE_STATUSES.has(status))) {
    return { className: 'is-confirmed', note: 'Payment processed', action: 'View' };
  }
  if (statuses.includes('pending')) return { className: 'is-pending', note: 'Waiting for review', action: 'Manage' };
  if (statuses.includes('rejected')) return { className: 'is-rejected', note: 'Proof rejected. Upload a replacement.', action: 'Replace' };
  return { className: '', note: 'Upload up to 3 transfer screenshots.', action: 'Upload' };
}

function updateCard(row) {
  if (!row) return;
  const mode = cardMode();
  row.classList.remove('is-pending', 'is-rejected', 'is-confirmed');
  if (mode.className) row.classList.add(mode.className);
  const note = proofStore.loading
    ? 'Loading payment proofs…'
    : (proofStore.error || mode.note);
  const action = proofStore.loading ? 'Wait' : mode.action;
  const noteElement = row.querySelector('.public-payment-proof-note');
  const actionElement = row.querySelector('.public-payment-proof-action');
  if (noteElement.textContent !== note) noteElement.textContent = note;
  if (actionElement.textContent !== action) actionElement.textContent = action;
  const disabled = !!proofStore.loading || proofStore.busy;
  if (row.disabled !== disabled) row.disabled = disabled;
}

function updateAllCards() {
  document.querySelectorAll('.public-payment-proof-card').forEach(updateCard);
}

async function fetchProofs({ force = false } = {}) {
  if (proofStore.loading) return proofStore.loading;
  if (proofStore.loaded && !force) return proofStore.proofs;
  proofStore.error = '';
  proofStore.loading = fetch(`/api/public-payment-proofs?slug=${encodeURIComponent(slugFromPath())}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  })
    .then(async (response) => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not load payment proofs.');
      proofStore.proofs = Array.isArray(data.proofs) ? data.proofs : [];
      proofStore.locked = !!data.locked;
      proofStore.loaded = true;
      return proofStore.proofs;
    })
    .catch((error) => {
      proofStore.error = error?.message || 'Could not load payment proofs.';
      throw error;
    })
    .finally(() => {
      proofStore.loading = null;
      updateAllCards();
      if (proofStore.modal) renderModal();
    });
  updateAllCards();
  return proofStore.loading;
}

function chooseFiles() {
  if (proofStore.busy || proofStore.locked) return;
  const input = document.createElement('input');
  input.className = 'public-payment-proof-input';
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.addEventListener('change', () => {
    uploadProof(input.files);
    input.remove();
  }, { once: true });
  window.addEventListener('focus', () => {
    setTimeout(() => { if (!input.files?.length) input.remove(); }, 0);
  }, { once: true });
  document.body.appendChild(input);
  input.click();
}

async function uploadProof(files) {
  const selected = Array.from(files || []).slice(0, MAX_IMAGES);
  if (!selected.length || proofStore.busy) return;
  proofStore.busy = true;
  proofStore.error = '';
  updateAllCards();
  if (proofStore.modal) renderModal();
  try {
    const images = [];
    for (const file of selected) images.push(await readProofFile(file));
    const response = await fetch('/api/payment-proof-submit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: slugFromPath(), images }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || 'Could not upload proof.');
    await fetchProofs({ force: true });
  } catch (error) {
    proofStore.error = error?.message || 'Could not upload proof.';
  } finally {
    proofStore.busy = false;
    updateAllCards();
    if (proofStore.modal) renderModal();
  }
}

function createButton(label, className = '', onClick = null) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `public-payment-proof-button${className ? ` ${className}` : ''}`;
  button.textContent = label;
  if (onClick) button.addEventListener('click', onClick);
  return button;
}

function closeModal() {
  if (!proofStore.modal) return;
  proofStore.modal.remove();
  proofStore.modal = null;
  document.body.style.removeProperty('overflow');
  proofStore.previousFocus?.focus?.();
  proofStore.previousFocus = null;
}

function openLightbox(proof) {
  if (!proofStore.modal) return;
  const overlay = document.createElement('div');
  overlay.className = 'public-payment-proof-lightbox';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Payment proof image');
  const head = document.createElement('div');
  head.className = 'public-payment-proof-lightbox-head';
  const close = createButton('Close', '', () => overlay.remove());
  head.appendChild(close);
  const image = document.createElement('img');
  image.className = 'public-payment-proof-lightbox-image';
  image.src = imageUrl(proof);
  image.alt = 'Payment proof full preview';
  overlay.append(head, image);
  proofStore.modal.querySelector('.public-payment-proof-sheet').appendChild(overlay);
  close.focus();
}

function showDeleteConfirmation(proof) {
  if (!proofStore.modal) return;
  const overlay = document.createElement('div');
  overlay.className = 'public-payment-proof-confirm';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'public-proof-delete-title');
  overlay.setAttribute('aria-describedby', 'public-proof-delete-message');
  const card = document.createElement('div');
  card.className = 'public-payment-proof-confirm-card';
  const title = document.createElement('h2');
  title.id = 'public-proof-delete-title';
  title.textContent = 'Delete payment proof?';
  const message = document.createElement('p');
  message.id = 'public-proof-delete-message';
  message.textContent = 'This proof will be permanently removed. You can upload a replacement afterward.';
  const actions = document.createElement('div');
  actions.className = 'public-payment-proof-confirm-actions';
  const cancel = createButton('Cancel', '', () => overlay.remove());
  const remove = createButton('Delete', 'is-danger', async () => {
    cancel.disabled = true;
    remove.disabled = true;
    remove.textContent = 'Deleting…';
    proofStore.error = '';
    try {
      const response = await fetch('/api/public-payment-proof-delete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: slugFromPath(), proofId: proof.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Could not delete payment proof.');
      overlay.remove();
      await fetchProofs({ force: true });
      if (!proofStore.proofs.length) closeModal();
      else renderModal();
    } catch (error) {
      proofStore.error = error?.message || 'Could not delete payment proof.';
      overlay.remove();
      renderModal();
    }
  });
  actions.append(cancel, remove);
  card.append(title, message, actions);
  overlay.appendChild(card);
  proofStore.modal.querySelector('.public-payment-proof-sheet').appendChild(overlay);
  cancel.focus();
}

function renderModal() {
  const overlay = proofStore.modal;
  if (!overlay) return;
  const sheet = overlay.querySelector('.public-payment-proof-sheet');
  sheet.replaceChildren();

  const head = document.createElement('header');
  head.className = 'public-payment-proof-head';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.textContent = proofStore.locked ? 'View' : 'Manage';
  const title = document.createElement('strong');
  title.textContent = 'Payment Proof';
  heading.append(eyebrow, title);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'public-payment-proof-close';
  close.setAttribute('aria-label', 'Close payment proof');
  close.textContent = '×';
  close.addEventListener('click', closeModal);
  head.append(heading, close);

  const body = document.createElement('div');
  body.className = 'public-payment-proof-body';
  if (!proofStore.proofs.length) {
    const empty = document.createElement('p');
    empty.className = 'public-payment-proof-empty';
    empty.textContent = proofStore.locked ? 'No payment proof is available.' : 'No payment proof uploaded yet.';
    body.appendChild(empty);
  } else {
    proofStore.proofs.forEach((proof, index) => {
      const entry = document.createElement('article');
      entry.className = 'public-payment-proof-entry';
      const thumb = document.createElement('button');
      thumb.type = 'button';
      thumb.className = 'public-payment-proof-thumb';
      thumb.setAttribute('aria-label', `View payment proof ${index + 1}`);
      thumb.addEventListener('click', () => openLightbox(proof));
      const image = document.createElement('img');
      image.src = imageUrl(proof);
      image.alt = `Payment proof ${index + 1}`;
      image.loading = 'lazy';
      thumb.appendChild(image);

      const meta = document.createElement('div');
      meta.className = 'public-payment-proof-meta';
      const name = document.createElement('strong');
      name.textContent = `Proof ${index + 1}`;
      const status = document.createElement('span');
      status.className = `public-payment-proof-status is-${String(proof.status || 'processed').toLowerCase()}`;
      status.textContent = statusLabel(proof.status);
      const uploaded = document.createElement('time');
      uploaded.dateTime = proof.uploaded_at || '';
      uploaded.textContent = `Uploaded ${uploadedLabel(proof.uploaded_at)}`;
      meta.append(name, status, uploaded);
      entry.append(thumb, meta);

      if (!proofStore.locked && DELETABLE_STATUSES.has(String(proof.status || '').toLowerCase())) {
        entry.appendChild(createButton('Delete', 'is-danger', () => showDeleteConfirmation(proof)));
      }
      body.appendChild(entry);
    });
  }

  sheet.append(head, body);
  if (proofStore.error) {
    const error = document.createElement('p');
    error.className = 'public-payment-proof-error';
    error.setAttribute('role', 'alert');
    error.textContent = proofStore.error;
    sheet.appendChild(error);
  }

  const hasPending = proofStore.proofs.some((proof) => String(proof.status || '').toLowerCase() === 'pending');
  const hasRejected = proofStore.proofs.some((proof) => String(proof.status || '').toLowerCase() === 'rejected');
  if (!proofStore.locked && hasRejected && !hasPending) {
    const actions = document.createElement('footer');
    actions.className = 'public-payment-proof-actions';
    const replace = createButton(proofStore.busy ? 'Uploading…' : 'Upload replacement', 'is-primary', chooseFiles);
    replace.disabled = proofStore.busy;
    actions.appendChild(replace);
    sheet.appendChild(actions);
  }
}

function trapModalFocus(event) {
  if (!proofStore.modal) return;
  if (event.key === 'Escape') {
    const transient = proofStore.modal.querySelector('.public-payment-proof-confirm,.public-payment-proof-lightbox');
    if (transient) transient.remove();
    else closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const transient = proofStore.modal.querySelector('.public-payment-proof-confirm,.public-payment-proof-lightbox');
  const focusable = [...(transient || proofStore.modal).querySelectorAll('button:not(:disabled),[href],input:not(:disabled),[tabindex]:not([tabindex="-1"])')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function openModal(trigger) {
  if (proofStore.modal) return;
  proofStore.previousFocus = trigger || document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'public-payment-proof-overlay';
  overlay.setAttribute('role', 'presentation');
  const sheet = document.createElement('section');
  sheet.className = 'public-payment-proof-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Payment Proof');
  overlay.appendChild(sheet);
  overlay.addEventListener('mousedown', (event) => {
    if (event.target === overlay) closeModal();
  });
  overlay.addEventListener('keydown', trapModalFocus);
  proofStore.modal = overlay;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  renderModal();
  overlay.querySelector('.public-payment-proof-close')?.focus();
  fetchProofs({ force: true }).catch(() => {});
}

function createProofCard() {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'public-payment-proof-card';
  row.setAttribute('aria-label', 'Payment Proof');

  const icon = document.createElement('span');
  icon.className = 'public-payment-proof-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = 'PAY';
  const copy = document.createElement('span');
  copy.className = 'public-payment-proof-copy';
  const label = document.createElement('span');
  label.className = 'public-payment-proof-label';
  label.textContent = 'Payment Proof';
  const note = document.createElement('span');
  note.className = 'public-payment-proof-note';
  copy.append(label, note);
  const action = document.createElement('span');
  action.className = 'public-payment-proof-action';
  row.append(icon, copy, action);
  row.addEventListener('click', () => {
    if (proofStore.error && !proofStore.loaded) {
      fetchProofs({ force: true }).catch(() => {});
      return;
    }
    const mode = cardMode();
    if (mode.action === 'Upload') chooseFiles();
    else openModal(row);
  });

  updateCard(row);
  return row;
}

function sync() {
  ensureStyle();
  const invoiceRow = document.querySelector('.public-delivery-card .public-delivery-invoice');
  if (!invoiceRow) return;
  let proofCard = document.querySelector('.public-delivery-card .public-payment-proof-card');
  if (!proofCard) {
    proofCard = createProofCard();
    invoiceRow.insertAdjacentElement('afterend', proofCard);
  }
  if (!proofStore.loaded && !proofStore.loading) fetchProofs().catch(() => {});
}

function boot() {
  sync();
  const root = document.getElementById('root') || document.body;
  const observer = new MutationObserver(sync);
  observer.observe(root, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
