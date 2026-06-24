(() => {
  const STYLE_ID = 'public-delivery-invoice-slot-style';
  const ROOT_SELECTOR = '.public-delivery-card';
  const INVOICE_SELECTOR = '.public-delivery-invoice';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      button.public-delivery-invoice {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        font: inherit;
        text-align: left;
      }
      .public-delivery-invoice.is-disabled {
        cursor: default;
        pointer-events: none;
        opacity: .5;
        background: color-mix(in srgb, var(--soft) 30%, transparent);
        border-color: var(--line);
        border-style: dashed;
        box-shadow: none;
      }
      .public-delivery-invoice.is-disabled .public-delivery-invoice-icon,
      .public-delivery-invoice.is-disabled .public-delivery-invoice-label,
      .public-delivery-invoice.is-disabled .public-delivery-invoice-cta {
        color: var(--muted);
      }
    `;
    document.head.appendChild(style);
  }

  function createDisabledInvoiceRow() {
    const row = document.createElement('button');
    row.type = 'button';
    row.disabled = true;
    row.setAttribute('aria-disabled', 'true');
    row.className = 'public-delivery-invoice is-disabled';

    const icon = document.createElement('span');
    icon.className = 'public-delivery-invoice-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = 'INV';

    const label = document.createElement('span');
    label.className = 'public-delivery-invoice-label';
    label.textContent = 'Invoice';

    const cta = document.createElement('span');
    cta.className = 'public-delivery-invoice-cta';
    cta.textContent = 'Unavailable';

    row.append(icon, label, cta);
    return row;
  }

  function syncInvoiceSlot() {
    ensureStyle();
    const card = document.querySelector(ROOT_SELECTOR);
    if (!card || card.querySelector(INVOICE_SELECTOR)) return;
    const greeting = card.querySelector('.public-delivery-greeting');
    if (!greeting) return;
    greeting.insertAdjacentElement('afterend', createDisabledInvoiceRow());
  }

  function boot() {
    syncInvoiceSlot();
    const root = document.getElementById('root') || document.body;
    const observer = new MutationObserver(syncInvoiceSlot);
    observer.observe(root, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
