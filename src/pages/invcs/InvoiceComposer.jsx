import { useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';
import { toTitleCase, maybeTitleCase, onBlurTitleCase } from '../../utils/titleCase.js';

// Hardcoded fallback catalogue. The catalogue is normally fetched
// from the Supabase-backed /api/packages endpoint (see _worker.js
// handlePackagesGet) and these values are kept as a safety net so
// /inv keeps working when the API returns empty, fails, or is
// unreachable. Same shape as the API rows: { id, name, price, note,
// is_default }.
const DEFAULT_PACKAGES = [
  { id: 'school-basic',         name: 'School without Magician', price: 800000,  note: 'school celebration without magician',                is_default: true },
  { id: 'school-magician',      name: 'School with Magician',    price: 1000000, note: 'school celebration with magician',                   is_default: true },
  { id: 'studio-special',       name: 'Studio Special',          price: 800000,  note: 'up to 1 hour',                                       is_default: true },
  { id: 'intimate-party',       name: 'Intimate Party',          price: 1300000, note: 'up to 2 hours, suitable for family celebration',     is_default: true },
  { id: 'birthday-celebration', name: 'Birthday Celebration',    price: 1650000, note: 'up to 3.5 hours, suitable for Birthday Celebration', is_default: true },
];

// Title-case rules (small-words set, preserve list, regex token
// matcher) live in `src/utils/titleCase.js` so /subs and /inv share
// the exact same display normalisation. The composer used to carry
// a local `titleCasePackageText` helper here; that has been removed
// in favour of `toTitleCase` from the shared utility.

const today = new Date().toISOString().slice(0, 10);

// Deposit defaults: 20% of grand total, but never less than IDR
// 200,000. The 200K floor is the operator's invoicing minimum;
// it is capped at the grand total so a tiny invoice (smaller than
// the floor itself) cannot ask for more than 100% deposit. The
// preset ladder is the short list of common ratios; "custom" lets
// the operator type a raw IDR override that bypasses the percent
// calculation entirely (still capped at the grand total).
const DEPOSIT_PRESETS = [20, 30, 50, 100];
const DEPOSIT_MIN_IDR = 200000;

function computeDepositDue(grandTotal, mode, customAmount) {
  const total = Math.max(0, Math.round(Number(grandTotal) || 0));
  if (total <= 0) return 0;
  if (mode === 'custom') {
    const raw = Math.max(0, Math.round(Number(customAmount) || 0));
    return Math.min(total, raw);
  }
  const percent = Number(mode) || 0;
  const fromPercent = Math.round((total * percent) / 100);
  // Apply the IDR floor only when the percent calculation falls
  // below it. Higher presets (30/50/100) skip the floor naturally
  // since they already exceed it for any realistic invoice.
  const floored = Math.max(fromPercent, DEPOSIT_MIN_IDR);
  return Math.min(total, floored);
}

// Inverse of computeDepositDue: for older invoice rows that only
// stored a flat deposit_amount, infer the matching preset (or fall
// back to 'custom') so the deposit selector hydrates predictably.
// Tolerance is ±1% of the grand total to absorb prior rounding.
function inferDepositMode(grandTotal, depositAmount) {
  const total = Math.max(0, Math.round(Number(grandTotal) || 0));
  const amount = Math.max(0, Math.round(Number(depositAmount) || 0));
  if (total <= 0 || amount <= 0) return { mode: '20', customAmount: '' };
  const tolerance = Math.max(1, Math.round(total * 0.01));
  for (const preset of DEPOSIT_PRESETS) {
    const expected = computeDepositDue(total, String(preset), '');
    if (Math.abs(expected - amount) <= tolerance) {
      return { mode: String(preset), customAmount: '' };
    }
  }
  return { mode: 'custom', customAmount: String(amount) };
}

function rupiah(value) {
  const number = Number(value) || 0;
  return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
}

function prettyDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function emptyItem(packages) {
  const option = (packages && packages[0]) || DEFAULT_PACKAGES[0];
  return {
    id: crypto.randomUUID(),
    name: option.name,
    note: option.note || '',
    qty: 1,
    price: Number(option.price) || 0,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

function cropBoundsToSquare(bounds, width, height, marginRatio = 0.04) {
  const side = Math.max(bounds.width, bounds.height);
  const margin = side * marginRatio;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const cropSide = clamp(side + margin * 2, 24, Math.min(width, height));
  const x = clamp(centerX - cropSide / 2, 0, width - cropSide);
  const y = clamp(centerY - cropSide / 2, 0, height - cropSide);
  return { x, y, width: cropSide, height: cropSide };
}

function findDenseSquare(ctx, width, height) {
  const maxSide = 640;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * scale));
  const sampleHeight = Math.max(1, Math.round(height * scale));
  const sample = document.createElement('canvas');
  sample.width = sampleWidth;
  sample.height = sampleHeight;
  const sampleCtx = sample.getContext('2d', { willReadFrequently: true });
  sampleCtx.drawImage(ctx.canvas, 0, 0, sampleWidth, sampleHeight);
  const pixels = sampleCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const integral = new Uint32Array((sampleWidth + 1) * (sampleHeight + 1));

  for (let y = 0; y < sampleHeight; y += 1) {
    let row = 0;
    for (let x = 0; x < sampleWidth; x += 1) {
      const index = (y * sampleWidth + x) * 4;
      const dark = pixels[index + 3] > 24 && pixels[index] + pixels[index + 1] + pixels[index + 2] < 390 ? 1 : 0;
      row += dark;
      integral[(y + 1) * (sampleWidth + 1) + x + 1] = integral[y * (sampleWidth + 1) + x + 1] + row;
    }
  }

  function sum(x, y, side) {
    const stride = sampleWidth + 1;
    const x2 = x + side;
    const y2 = y + side;
    return integral[y2 * stride + x2] - integral[y * stride + x2] - integral[y2 * stride + x] + integral[y * stride + x];
  }

  let best = null;
  const minDimension = Math.min(sampleWidth, sampleHeight);
  const minSide = Math.max(80, Math.round(minDimension * 0.22));
  const maxQrSide = Math.round(minDimension * 0.78);
  const sideStep = Math.max(10, Math.round(minDimension / 34));

  for (let side = maxQrSide; side >= minSide; side -= sideStep) {
    const stride = Math.max(8, Math.round(side / 12));
    for (let y = 0; y <= sampleHeight - side; y += stride) {
      for (let x = 0; x <= sampleWidth - side; x += stride) {
        const density = sum(x, y, side) / (side * side);
        if (density < 0.28 || density > 0.68) continue;
        const centerBias = 1 - Math.abs((x + side / 2) / sampleWidth - 0.5) * 0.18;
        const score = side * density * centerBias;
        if (!best || score > best.score) best = { x, y, width: side, height: side, score };
      }
    }
  }

  if (!best) return null;
  return {
    x: best.x / scale,
    y: best.y / scale,
    width: best.width / scale,
    height: best.height / scale,
  };
}

async function cropQrImage(file) {
  const image = await imageFromFile(file);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);

  let bounds = null;
  if ('BarcodeDetector' in window) {
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const [barcode] = await detector.detect(image);
      if (barcode?.boundingBox) bounds = barcode.boundingBox;
    } catch {}
  }

  bounds ||= findDenseSquare(ctx, canvas.width, canvas.height);
  const crop = bounds ? cropBoundsToSquare(bounds, canvas.width, canvas.height) : { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const output = document.createElement('canvas');
  output.width = 720;
  output.height = 720;
  const outputCtx = output.getContext('2d');
  outputCtx.imageSmoothingEnabled = false;
  outputCtx.fillStyle = '#fff';
  outputCtx.fillRect(0, 0, output.width, output.height);
  outputCtx.drawImage(canvas, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
  URL.revokeObjectURL(image.src);
  return output.toDataURL('image/png');
}

// Read the URL search params once on mount. Two flows:
//   1. invoiceId=<id> -> fetch /api/invoices-get and hydrate the
//      whole composer (title/name/contact/venue/dates/items/discount/
//      deposit/QR) from the row + invoice_data blob.
//   2. title/name/contact/eventDate (no invoiceId) -> just pre-fill
//      Bill-To / Details for a fresh invoice draft created from /db.
//
// `eventDate` is sanitised to a bare YYYY-MM-DD; older /db builds
// occasionally passed a created_at/updated_at timestamp here, which
// the <input type="date"> binding silently rejects (rendering the
// field blank instead of the typed date). Anything that isn't a
// pure YYYY-MM-DD string is dropped so the form falls back to the
// empty default the operator can edit.
function readInitialQuery() {
  if (typeof window === 'undefined') return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const rawEventDate = (params.get('eventDate') || '').trim();
    const eventDate = /^\d{4}-\d{2}-\d{2}$/.test(rawEventDate) ? rawEventDate : '';
    return {
      invoiceId: (params.get('invoiceId') || '').trim(),
      title: (params.get('title') || '').trim(),
      name: (params.get('name') || '').trim(),
      contact: (params.get('contact') || '').trim(),
      eventDate,
    };
  } catch {
    return {};
  }
}

export function InvoiceComposer() {
  const initial = useMemo(() => readInitialQuery(), []);

  const [mobileView, setMobileView] = useState('edit');
  const [mode, setMode] = useState('invoice');
  const [title, setTitle] = useState(initial.title || 'Ms.');
  const [clientName, setClientName] = useState(initial.name || '');
  const [contact, setContact] = useState(initial.contact || '');
  const [venue, setVenue] = useState('TBA');
  const [eventDate, setEventDate] = useState(initial.eventDate || '');
  const [issuedDate, setIssuedDate] = useState(today);
  // Discount defaults to 0 — never auto-prefill a value. If the
  // operator wants a discount they type it; loaded invoices restore
  // whatever was saved on the row.
  const [discount, setDiscount] = useState(0);
  // Deposit mode is one of '20' | '30' | '50' | '100' | 'custom'.
  // Default '20' picks the 20% preset; computeDepositDue() then
  // applies the IDR-200,000 floor (capped at the grand total) so
  // small invoices never silently produce a 0 deposit.
  const [depositMode, setDepositMode] = useState('20');
  const [depositCustomAmount, setDepositCustomAmount] = useState('');
  const [packages, setPackages] = useState(DEFAULT_PACKAGES);
  const [items, setItems] = useState(() => [emptyItem(DEFAULT_PACKAGES)]);
  const [qrSrc, setQrSrc] = useState('/payment-qr.png');
  const [qrFileName, setQrFileName] = useState('');
  const [status, setStatus] = useState('');
  const [hydrating, setHydrating] = useState(Boolean(initial.invoiceId));
  const documentRef = useRef(null);

  // Load the package catalogue from Supabase on mount. If the API
  // returns at least one row we use it; otherwise we keep the
  // hardcoded defaults already in state. Network or schema errors
  // are swallowed so a momentary outage never blanks the dropdown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/packages', { credentials: 'same-origin' });
        if (!response.ok) return;
        const json = await response.json().catch(() => null);
        const rows = Array.isArray(json?.packages) ? json.packages : [];
        if (cancelled) return;
        const cleaned = rows
          .map((row) => ({
            id: String(row.id || ''),
            name: String(row.name || '').trim(),
            note: String(row.note || '').trim(),
            price: Math.max(0, Math.round(Number(row.price) || 0)),
            is_default: !!row.is_default,
          }))
          .filter((row) => row.name);
        if (cleaned.length) setPackages(cleaned);
      } catch {
        // Keep DEFAULT_PACKAGES already in state.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Hydrate from /api/invoices-get when ?invoiceId= is present. We
  // read both the typed columns (client_title/name/contact/...) and
  // the loose invoice_data blob, since older rows may only have the
  // typed columns. Items default to a single line containing the
  // grand_total when the blob has no item array. Deposit hydration
  // prefers an explicit invoice_data.depositMode; otherwise it
  // reverse-engineers the closest preset from deposit_amount via
  // inferDepositMode().
  useEffect(() => {
    if (!initial.invoiceId) return;
    let cancelled = false;
    (async () => {
      try {
        setHydrating(true);
        const response = await fetch(
          `/api/invoices-get?id=${encodeURIComponent(initial.invoiceId)}`,
          { credentials: 'same-origin' },
        );
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        const row = payload?.invoice;
        if (!row || cancelled) return;
        const data = (row.invoice_data && typeof row.invoice_data === 'object') ? row.invoice_data : {};

        if (row.client_title) setTitle(String(row.client_title));
        if (row.client_name != null) setClientName(String(row.client_name || ''));
        if (row.client_contact != null) setContact(String(row.client_contact || ''));
        if (data.venue != null || row.venue != null) setVenue(String(data.venue ?? row.venue ?? 'TBA'));
        if (row.event_date != null) setEventDate(String(row.event_date || ''));
        if (row.invoice_date) setIssuedDate(String(row.invoice_date));
        if (row.status === 'invoice' || row.status === 'deposit' || row.status === 'paid') setMode(row.status);

        // Discount: explicit blob value wins; otherwise stay at 0.
        const blobDiscount = Number(data.discount);
        if (Number.isFinite(blobDiscount) && blobDiscount >= 0) setDiscount(blobDiscount);

        // Items: the blob is the source of truth when present; fall
        // back to a single synthetic line carrying the row's
        // grand_total so the preview never renders empty.
        const blobItems = Array.isArray(data.items) ? data.items : null;
        if (blobItems && blobItems.length) {
          setItems(blobItems.map((item) => ({
            id: String(item.id || crypto.randomUUID()),
            name: String(item.name || ''),
            note: String(item.note || ''),
            qty: Number(item.qty) || 1,
            price: Math.max(0, Math.round(Number(item.price) || 0)),
          })));
        } else if (Number.isFinite(Number(row.grand_total)) && Number(row.grand_total) > 0) {
          const fallbackPrice = Math.max(0, Math.round(Number(row.grand_total) + (Number.isFinite(blobDiscount) ? blobDiscount : 0)));
          setItems([{
            id: crypto.randomUUID(),
            name: 'Package',
            note: '',
            qty: 1,
            price: fallbackPrice,
          }]);
        }

        // Deposit: trust the explicit blob mode if it looks valid,
        // otherwise reverse-engineer from the stored deposit_amount.
        const blobMode = String(data.depositMode || '');
        const validBlobMode = blobMode === 'custom'
          || DEPOSIT_PRESETS.some((preset) => String(preset) === blobMode);
        if (validBlobMode) {
          setDepositMode(blobMode);
          setDepositCustomAmount(String(data.depositCustomAmount || ''));
        } else {
          const inferred = inferDepositMode(row.grand_total, row.deposit_amount);
          setDepositMode(inferred.mode);
          setDepositCustomAmount(inferred.customAmount);
        }

        if (typeof data.qrSrc === 'string' && data.qrSrc) setQrSrc(data.qrSrc);
        if (typeof data.qrFileName === 'string' && data.qrFileName) setQrFileName(data.qrFileName);
      } catch (error) {
        // Silently keep blank/defaults; the user can always re-fill.
        if (!cancelled) console.warn('[inv] hydrate failed:', error);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
  }, [initial.invoiceId]);

  const totals = useMemo(() => {
    const subtotal = items.reduce((sum, item) => sum + (Number(item.qty) || 0) * (Number(item.price) || 0), 0);
    const grandTotal = Math.max(0, subtotal - (Number(discount) || 0));
    const depositDue = computeDepositDue(grandTotal, depositMode, depositCustomAmount);
    return { subtotal, grandTotal, depositDue };
  }, [discount, depositMode, depositCustomAmount, items]);

  function updateItem(id, patch) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function applyPackage(id, packageName) {
    const option = packages.find((pkg) => pkg.name === packageName);
    updateItem(id, option ? { name: option.name, note: option.note || '', price: Number(option.price) || 0 } : { name: packageName });
  }

  function addItem() {
    setItems((current) => [...current, emptyItem(packages)]);
  }

  function removeItem(id) {
    setItems((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));
  }

  async function uploadQr(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setQrFileName(file.name);
    setStatus('Cropping QR...');
    try {
      setQrSrc(await cropQrImage(file));
      setStatus('QR ready.');
    } catch {
      const reader = new FileReader();
      reader.onload = () => {
        setQrSrc(String(reader.result || '/payment-qr.png'));
        setStatus('QR ready.');
      };
      reader.readAsDataURL(file);
    }
  }

  async function downloadJpg() {
    if (!documentRef.current) return;
    setStatus('Rendering JPG...');
    if (document.fonts?.ready) {
      try { await document.fonts.ready; } catch {}
    }
    const exportHost = document.createElement('div');
    exportHost.className = 'invoice-export-host';
    const exportSheet = documentRef.current.cloneNode(true);
    exportHost.appendChild(exportSheet);
    document.body.appendChild(exportHost);
    try {
      const canvas = await html2canvas(exportSheet, {
        backgroundColor: '#ffffff',
        scale: Math.max(3, Math.min(4, (window.devicePixelRatio || 2) * 2)),
        useCORS: true,
        allowTaint: true,
        imageTimeout: 0,
        logging: false,
        windowWidth: 1280,
        windowHeight: 1200,
      });
      const link = document.createElement('a');
      const safeClient = (clientName || 'Client').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
      link.download = `${new Date().toISOString().slice(0, 10)}_${safeClient}_${mode}.jpg`;
      link.href = canvas.toDataURL('image/jpeg', 1.0);
      link.click();
      setStatus('JPG ready.');
    } catch (error) {
      setStatus(error.message || 'Failed to render JPG.');
    } finally {
      exportHost.remove();
    }
  }

  return (
    <main className="composer-page">
      <GlobalBackground />
      <section className={`composer-shell ${mobileView === 'preview' ? 'show-preview' : ''}`}>
        <EditorPanel
          mode={mode}
          setMode={setMode}
          title={title}
          setTitle={setTitle}
          clientName={clientName}
          setClientName={setClientName}
          contact={contact}
          setContact={setContact}
          venue={venue}
          setVenue={setVenue}
          eventDate={eventDate}
          setEventDate={setEventDate}
          issuedDate={issuedDate}
          setIssuedDate={setIssuedDate}
          items={items}
          packages={packages}
          applyPackage={applyPackage}
          updateItem={updateItem}
          addItem={addItem}
          removeItem={removeItem}
          discount={discount}
          setDiscount={setDiscount}
          depositMode={depositMode}
          setDepositMode={setDepositMode}
          depositCustomAmount={depositCustomAmount}
          setDepositCustomAmount={setDepositCustomAmount}
          totals={totals}
          uploadQr={uploadQr}
          qrFileName={qrFileName}
          hydrating={hydrating}
        />
        <PreviewPanel
          mode={mode}
          clientName={clientName}
          title={title}
          contact={contact}
          venue={venue}
          eventDate={eventDate}
          issuedDate={issuedDate}
          items={items}
          totals={totals}
          qrSrc={qrSrc}
          status={status}
          documentRef={documentRef}
          downloadJpg={downloadJpg}
        />
      </section>
      <nav className="mobile-tabs" aria-label="Invoice view">
        <button className={mobileView === 'edit' ? 'active' : ''} type="button" onClick={() => setMobileView('edit')}>Edit Details</button>
        <button className={mobileView === 'preview' ? 'active' : ''} type="button" onClick={() => setMobileView('preview')}>Preview Invoice</button>
      </nav>
    </main>
  );
}

function EditorPanel(props) {
  return (
    <aside className="editor-panel panel">
      <header className="panel-header">
        <img src="/logo-hero.png" alt="StarShots" />
        <div className="mode-switch">
          {['invoice', 'deposit', 'paid'].map((value) => (
            <button key={value} className={props.mode === value ? 'active' : ''} type="button" onClick={() => props.setMode(value)}>
              {value}
            </button>
          ))}
        </div>
      </header>

      <Fieldset title="Bill To">
        <div className="field-stack">
          <div className="two-col">
            <label>Title<select value={props.title} onChange={(event) => props.setTitle(event.target.value)}><option>Ms.</option><option>Mr.</option><option>Mrs.</option><option>Family</option></select></label>
            <label>Client name<input value={props.clientName} onChange={(event) => props.setClientName(event.target.value)} onBlur={onBlurTitleCase(props.setClientName)} placeholder="Client Name" /></label>
          </div>
          <label>Contact<input value={props.contact} onChange={(event) => props.setContact(event.target.value)} onBlur={onBlurTitleCase(props.setContact)} placeholder="Instagram / Phone / Email" /></label>
        </div>
      </Fieldset>

      <Fieldset title="Details">
        <div className="field-stack">
          <label>Venue<input value={props.venue} onChange={(event) => props.setVenue(event.target.value)} onBlur={onBlurTitleCase(props.setVenue)} placeholder="Venue" /></label>
          <div className="two-col">
            <label>Event date<input type="date" value={props.eventDate} onChange={(event) => props.setEventDate(event.target.value)} /></label>
            <label>Issued<input type="date" value={props.issuedDate} onChange={(event) => props.setIssuedDate(event.target.value)} /></label>
          </div>
        </div>
      </Fieldset>

      <Fieldset title="Packages">
        <div className="item-list">
          {props.items.map((item) => (
            <div className="item-editor" key={item.id}>
              <label>Package<select value={item.name} onChange={(event) => props.applyPackage(item.id, event.target.value)}>
                {/* Allow custom package names loaded from saved invoices to remain visible
                    in the dropdown even if the catalogue doesn't include them anymore. */}
                {!props.packages.some((pkg) => pkg.name === item.name) && item.name ? (
                  <option value={item.name}>{toTitleCase(item.name)}</option>
                ) : null}
                {props.packages.map((pkg) => <option key={pkg.id || pkg.name} value={pkg.name}>{toTitleCase(pkg.name)}</option>)}
              </select></label>
              <label>Note<input value={item.note} onChange={(event) => props.updateItem(item.id, { note: event.target.value })} onBlur={(event) => {
                const next = maybeTitleCase(event.target.value.trim());
                if (next !== item.note) props.updateItem(item.id, { note: next });
              }} placeholder="Optional note" /></label>
              <div className="three-col">
                <label>Qty<input type="number" min="1" value={item.qty} onChange={(event) => props.updateItem(item.id, { qty: event.target.value })} /></label>
                <label>Amount<input type="number" min="0" value={item.price} onChange={(event) => props.updateItem(item.id, { price: event.target.value })} /></label>
                <button className="remove" type="button" onClick={() => props.removeItem(item.id)}>Remove</button>
              </div>
            </div>
          ))}
        </div>
        <button className="ghost-button" type="button" onClick={props.addItem}>Add package</button>
      </Fieldset>

      <Fieldset title="Payment">
        <div className="field-stack">
          <label>Discount<input type="number" min="0" value={props.discount} onChange={(event) => props.setDiscount(event.target.value)} placeholder="0" /></label>
          <div className="deposit-block">
            <span className="deposit-label">Deposit</span>
            <div className="deposit-presets" role="radiogroup" aria-label="Deposit preset">
              {DEPOSIT_PRESETS.map((preset) => {
                const value = String(preset);
                const active = props.depositMode === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'active' : ''}
                    onClick={() => props.setDepositMode(value)}
                  >
                    {preset}%
                  </button>
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={props.depositMode === 'custom'}
                className={props.depositMode === 'custom' ? 'active' : ''}
                onClick={() => props.setDepositMode('custom')}
              >
                Custom
              </button>
            </div>
            {props.depositMode === 'custom' ? (
              <label className="deposit-custom">
                Custom amount (IDR)
                <input
                  type="number"
                  min="0"
                  value={props.depositCustomAmount}
                  onChange={(event) => props.setDepositCustomAmount(event.target.value)}
                  placeholder="e.g. 500000"
                />
              </label>
            ) : null}
          </div>
          <QrUploadField onChange={props.uploadQr} fileName={props.qrFileName} />
          <div className="total-card"><span>Grand Total</span><strong>{rupiah(props.totals.grandTotal)}</strong></div>
          <div className="total-card"><span>Deposit Due</span><strong>{rupiah(props.totals.depositDue)}</strong></div>
        </div>
      </Fieldset>
    </aside>
  );
}

// Modern upload pill that hides the native browser file input. The
// label wraps a visually-hidden <input type="file"> so a click on
// the pill, or a keyboard activation on the input itself, both
// trigger the picker. On selection the filename is shown subtly
// underneath so the operator has feedback without affecting the
// invoice JPG layout (the QR image inside the sheet is the only
// thing that visually changes on export).
function QrUploadField({ onChange, fileName }) {
  return (
    <div className="qr-upload">
      <span className="qr-upload-label">Custom QR</span>
      <label className="qr-upload-control">
        <input type="file" accept="image/*" onChange={onChange} />
        <span className="qr-upload-pill">
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="qr-upload-text">Click to upload QR</span>
        </span>
      </label>
      {fileName ? <span className="qr-upload-filename" title={fileName}>{fileName}</span> : null}
    </div>
  );
}

function PreviewPanel({ mode, clientName, title, contact, venue, eventDate, issuedDate, items, totals, qrSrc, status, documentRef, downloadJpg }) {
  return (
    <section className="preview-panel panel">
      <header className="preview-toolbar">
        <div>
          <p className="eyebrow">Live Preview</p>
          <h2>{mode === 'paid' ? 'Receipt' : mode === 'deposit' ? 'Deposit Invoice' : 'Draft Invoice'}</h2>
        </div>
        <button className="primary-button" type="button" onClick={downloadJpg}>Generate JPG</button>
      </header>
      <div className="preview-canvas">
        <article className="invoice-sheet" ref={documentRef}>
          <header className="sheet-top"><img src="/logo-hero.png" alt="StarShots" /></header>
          <section className="sheet-grid">
            <div className="sheet-box">
              <p className="eyebrow">Bill To</p>
              <dl className="meta-list">
                <div className="meta-row"><dt>Client</dt><dd>{title} {clientName ? toTitleCase(clientName) : 'Client'}</dd></div>
                <div className="meta-row"><dt>Contact</dt><dd>{contact ? maybeTitleCase(contact) : '-'}</dd></div>
              </dl>
            </div>
            <div className="sheet-box">
              <p className="eyebrow">Details</p>
              <dl className="meta-list">
                <div className="meta-row"><dt>Venue</dt><dd>{venue ? toTitleCase(venue) : 'TBA'}</dd></div>
                <div className="meta-row"><dt>Event Date</dt><dd>{prettyDate(eventDate)}</dd></div>
                <div className="meta-row"><dt>Issued</dt><dd>{prettyDate(issuedDate)}</dd></div>
              </dl>
            </div>
          </section>
          <section className="sheet-box line-table">
            <div className="line-head"><span>Package</span><span>Qty</span><span>Amount</span></div>
            {items.map((item) => (
              <div key={item.id} className="line-row">
                <div><strong>{toTitleCase(item.name)}</strong><small>{toTitleCase(item.note)}</small></div>
                <span>{item.qty || 1}</span>
                <span>{rupiah((Number(item.qty) || 0) * (Number(item.price) || 0))}</span>
              </div>
            ))}
          </section>
          <section className="summary-box">
            <p><span>Subtotal</span><strong>{rupiah(totals.subtotal)}</strong></p>
            <p><span>Discount</span><strong>{rupiah(Number(totals.subtotal) - Number(totals.grandTotal))}</strong></p>
            <p className="grand"><span>Grand Total</span><strong>{rupiah(totals.grandTotal)}</strong></p>
          </section>
          <section className="bottom-grid">
            <div className="sheet-box payment-box">
              <p className="eyebrow">Payment</p>
              <img src={qrSrc} alt="Payment QR" />
              <div className="deposit-due"><span>Deposit Due</span><strong>{rupiah(totals.depositDue)}</strong></div>
            </div>
            <div className="sheet-box terms-box">
              <p className="eyebrow">Terms & Conditions</p>
              <p>All final edited files will be uploaded to <strong>Google Drive</strong> or <strong>Dropbox</strong> and shared via a secure link within 2 to 5 working days after session.</p>
              <p>Physical deliverables such as <strong>albums</strong> or <strong>USB</strong> flash drives are optional and available upon request at an additional cost.</p>
              <p>For rescheduling, notice must be given <strong>at least 7 days (H-7)</strong> prior to the original session date. Rescheduled sessions must take place <strong>within 30 days</strong>.</p>
              <p>In the event of <strong>late arrival</strong>, the session may only be extended by a maximum of 10 minutes.</p>
            </div>
          </section>
          <footer>This invoice is automatically generated and valid without signature. <strong>@starshots.id</strong></footer>
        </article>
      </div>
      <p className="download-status">{status}</p>
    </section>
  );
}

function Fieldset({ title, children }) {
  return <section className="form-section"><h2>{title}</h2>{children}</section>;
}
