import { useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import { GlobalBackground } from '../../components/GlobalBackground.jsx';

const packageOptions = [
  { name: 'School without Magician', note: 'school celebration without magician', price: 800000 },
  { name: 'School with Magician', note: 'school celebration with magician', price: 1000000 },
  { name: 'Studio Special', note: 'up to 1 hour', price: 800000 },
  { name: 'Intimate Party', note: 'up to 2 hours, suitable for family celebration', price: 1300000 },
  { name: 'Birthday Celebration', note: 'up to 3.5 hours, suitable for Birthday Celebration', price: 1650000 },
];

// Small words that stay lowercase when not the first word. Anything else is
// Title-cased per word. Acronyms / intentional ALL-CAPS tokens (USB, QR, IDR)
// are detected and preserved as typed.
const TITLE_CASE_SMALL_WORDS = new Set([
  'to', 'of', 'in', 'at', 'on', 'with', 'without', 'for', 'and', 'or',
]);

function titleCasePackageText(value) {
  if (typeof value !== 'string' || !value) return value;
  const parts = value.split(/(\s+)/);
  let seenWord = false;
  return parts
    .map((part) => {
      if (!part || /^\s+$/.test(part)) return part;
      const isFirst = !seenWord;
      seenWord = true;
      const match = part.match(/^(\W*)([\w'.\-]+?)(\W*)$/);
      if (!match) return part;
      const [, lead, core, trail] = match;
      // Preserve acronyms / intentional ALL CAPS (>= 2 letters, all uppercase).
      const letters = core.replace(/[^A-Za-z]/g, '');
      if (letters.length >= 2 && letters === letters.toUpperCase()) {
        return part;
      }
      const lowered = core.toLowerCase();
      if (!isFirst && TITLE_CASE_SMALL_WORDS.has(lowered)) {
        return `${lead}${lowered}${trail}`;
      }
      const firstLetterIndex = core.search(/[A-Za-z]/);
      if (firstLetterIndex === -1) return part; // pure number / punct token
      const formatted =
        core.slice(0, firstLetterIndex) +
        core.charAt(firstLetterIndex).toUpperCase() +
        core.slice(firstLetterIndex + 1).toLowerCase();
      return `${lead}${formatted}${trail}`;
    })
    .join('');
}

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

function rupiah(value) {
  const number = Number(value) || 0;
  return `Rp ${Math.round(number).toLocaleString('id-ID')}`;
}

function prettyDate(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
}

function emptyItem() {
  const option = packageOptions[0];
  return { id: crypto.randomUUID(), name: option.name, note: option.note, qty: 1, price: option.price };
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

export function InvoiceComposer() {
  const [mobileView, setMobileView] = useState('edit');
  const [mode, setMode] = useState('invoice');
  const [title, setTitle] = useState('Ms.');
  const [clientName, setClientName] = useState('');
  const [contact, setContact] = useState('');
  const [venue, setVenue] = useState('TBA');
  const [eventDate, setEventDate] = useState('');
  const [issuedDate, setIssuedDate] = useState(today);
  const [discount, setDiscount] = useState(250000);
  // Deposit mode is one of '20' | '30' | '50' | '100' | 'custom'.
  // Default '20' picks the 20% preset; computeDepositDue() then
  // applies the IDR-200,000 floor (capped at the grand total) so
  // small invoices never silently produce a 0 deposit.
  const [depositMode, setDepositMode] = useState('20');
  const [depositCustomAmount, setDepositCustomAmount] = useState('');
  const [items, setItems] = useState(() => [emptyItem()]);
  const [qrSrc, setQrSrc] = useState('/payment-qr.png');
  const [status, setStatus] = useState('');
  const documentRef = useRef(null);

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
    const option = packageOptions.find((pkg) => pkg.name === packageName);
    updateItem(id, option ? { name: option.name, note: option.note, price: option.price } : { name: packageName });
  }

  function addItem() {
    setItems((current) => [...current, emptyItem()]);
  }

  function removeItem(id) {
    setItems((current) => current.length === 1 ? current : current.filter((item) => item.id !== id));
  }

  async function uploadQr(event) {
    const file = event.target.files?.[0];
    if (!file) return;
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
        <div className="two-col">
          <label>Title<select value={props.title} onChange={(event) => props.setTitle(event.target.value)}><option>Ms.</option><option>Mr.</option><option>Mrs.</option><option>Family</option></select></label>
          <label>Client name<input value={props.clientName} onChange={(event) => props.setClientName(event.target.value)} placeholder="Client name" /></label>
        </div>
        <label>Contact<input value={props.contact} onChange={(event) => props.setContact(event.target.value)} placeholder="Instagram / phone / email" /></label>
      </Fieldset>

      <Fieldset title="Details">
        <label>Venue<input value={props.venue} onChange={(event) => props.setVenue(event.target.value)} /></label>
        <div className="two-col">
          <label>Event date<input type="date" value={props.eventDate} onChange={(event) => props.setEventDate(event.target.value)} /></label>
          <label>Issued<input type="date" value={props.issuedDate} onChange={(event) => props.setIssuedDate(event.target.value)} /></label>
        </div>
      </Fieldset>

      <Fieldset title="Packages">
        <div className="item-list">
          {props.items.map((item) => (
            <div className="item-editor" key={item.id}>
              <label>Package<select value={item.name} onChange={(event) => props.applyPackage(item.id, event.target.value)}>{packageOptions.map((pkg) => <option key={pkg.name} value={pkg.name}>{titleCasePackageText(pkg.name)}</option>)}</select></label>
              <label>Note<input value={item.note} onChange={(event) => props.updateItem(item.id, { note: event.target.value })} /></label>
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
        <label>Discount<input type="number" min="0" value={props.discount} onChange={(event) => props.setDiscount(event.target.value)} /></label>
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
        <label>Custom QR<input type="file" accept="image/*" onChange={props.uploadQr} /></label>
        <div className="total-card"><span>Grand Total</span><strong>{rupiah(props.totals.grandTotal)}</strong></div>
        <div className="total-card"><span>Deposit Due</span><strong>{rupiah(props.totals.depositDue)}</strong></div>
      </Fieldset>
    </aside>
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
              <dl><dt>Client</dt><dd>{title} {clientName || 'Client'}</dd><dt>Contact</dt><dd>{contact || '-'}</dd></dl>
            </div>
            <div className="sheet-box">
              <p className="eyebrow">Details</p>
              <dl><dt>Venue</dt><dd>{venue || 'TBA'}</dd><dt>Event Date</dt><dd>{prettyDate(eventDate)}</dd><dt>Issued</dt><dd>{prettyDate(issuedDate)}</dd></dl>
            </div>
          </section>
          <section className="sheet-box line-table">
            <div className="line-head"><span>Package</span><span>Qty</span><span>Amount</span></div>
            {items.map((item) => (
              <div key={item.id} className="line-row">
                <div><strong>{titleCasePackageText(item.name)}</strong><small>{titleCasePackageText(item.note)}</small></div>
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
