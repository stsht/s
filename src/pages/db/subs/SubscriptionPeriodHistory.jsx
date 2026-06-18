import { applySubscriptionExtension, subscriptionTone } from '../dbHelpers.js';
import { dateLabel } from './subscriptionFormatting.js';
import { fmtSubsTime } from '../../../features/subscriptions/subscriptionUtils.js';
import { rupiah } from '../../../utils/rupiah.js';
import { toTitleCase } from '../../../utils/titleCase.js';
import { isProofViewable } from '../../../utils/proofImage.js';
import { EditIcon, PrintIcon } from '../dbIcons.jsx';
import { DeleteIcon } from '../RecordRow.jsx';

// Newest-first period/extension history list for the Subs detail view.
//
// Extracted verbatim from SubscriptionDetail. The current/active
// period is filtered out by the parent (visiblePeriods); this renders
// the remaining periods with their inline expand/collapse detail and
// per-row Print / Edit / Delete actions. The base "Initial" row gets
// Print + Edit (but no Delete — deleting the base means deleting the
// whole subscription via the top trash action).
//
//   onRequestPrint    — print a specific period's effective receipt
//   onEditBase        — edit the base/initial subscription
//   onEditExtension   — edit a renewal extension row
//   onDeleteExtension — delete a renewal extension row
export function SubscriptionPeriodHistory({
  subscription,
  visiblePeriods,
  expandedPeriodId,
  setExpandedPeriodId,
  extensionFormOpen,
  onRequestPrint,
  onEditBase,
  onEditExtension,
  onDeleteExtension,
}) {
  if (!visiblePeriods.length) {
    return !extensionFormOpen
      ? <p className="empty-state subs-extensions-empty">No extensions yet.</p>
      : null;
  }
  return (
    <div className="list-stack subs-extension-list">
      {visiblePeriods.map((ext) => {
        const extEffective = applySubscriptionExtension(subscription, ext);
        const extToneCls = subscriptionTone(extEffective);
        const startLabel = ext.start_date ? `${dateLabel(ext.start_date)}${ext.start_time ? ` \u00b7 ${fmtSubsTime(ext.start_time)}` : ''}` : '';
        const expiryLabel = ext.expiry_date ? `${dateLabel(ext.expiry_date)}${ext.expiry_time ? ` \u00b7 ${fmtSubsTime(ext.expiry_time)}` : ''}` : '';
        const periodLabel = Number(ext.access_period) > 0 ? `${ext.access_period} Days` : '';
        const priceLabelExt = Number(ext.price) > 0 ? rupiah(ext.price) : '';
        const statusLabelExt = ext.status ? toTitleCase(ext.status) : '';
        // Bonus segment: only render when > 0 so the row stays
        // clean when no bonus was applied. Singular "Day" for
        // 1, plural "Days" otherwise.
        const bonusDaysExt = Number(ext.bonus);
        const bonusLabelExt = Number.isFinite(bonusDaysExt) && bonusDaysExt > 0
          ? `Bonus ${bonusDaysExt} ${bonusDaysExt === 1 ? 'Day' : 'Days'}`
          : '';
        // Base subscription gets a trailing "Initial" chip so
        // the bottom row of the timeline reads as the original
        // purchase rather than a renewal.
        const baseTag = ext.isBase ? 'Initial' : '';
        const meta = [ext.service, statusLabelExt, periodLabel, bonusLabelExt, priceLabelExt, baseTag]
          .filter(Boolean)
          .join(' \u00b7 ');
        const noRange = !startLabel && !expiryLabel;
        const expanded = String(expandedPeriodId) === String(ext.id);
        const toggleExpand = () => setExpandedPeriodId((cur) => (String(cur) === String(ext.id) ? '' : String(ext.id)));
        const paymentLabelExt = ext.payment_date
          ? `${dateLabel(ext.payment_date)}${ext.payment_time ? ` \u00b7 ${fmtSubsTime(ext.payment_time)}` : ''}`
          : '';
        const proofExt = String(ext.payment_proof || '').trim();
        const proofViewableExt = isProofViewable(proofExt);
        const bonusDetailExt = Number.isFinite(bonusDaysExt) && bonusDaysExt > 0
          ? `${bonusDaysExt} ${bonusDaysExt === 1 ? 'Day' : 'Days'}`
          : '0 Days';
        return (
          <article
            className={`list-row subs-extension-row sub-${extToneCls}${ext.isBase ? ' subs-period-base' : ''}${expanded ? ' is-expanded' : ''}`}
            key={ext.id}
          >
            <div
              className="subs-extension-body"
              role="button"
              tabIndex={0}
              aria-expanded={expanded}
              onClick={toggleExpand}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(); }
              }}
            >
              {/* Clean Start / Expiry pair — two columns on
                  desktop, stacked on mobile. No "->" arrow on
                  any surface; the labelled rows carry the range
                  so it reads on a phone without horizontal cram. */}
              {noRange ? (
                <div className="subs-extension-dates">
                  <span className="subs-extension-date-value">
                    {ext.isBase ? 'Initial Purchase' : 'Extension'}
                  </span>
                </div>
              ) : (
                <div className="subs-extension-dates">
                  <span className="subs-extension-date">
                    <span className="subs-extension-date-label">Start</span>
                    <span className="subs-extension-date-value">{startLabel || '\u2014'}</span>
                  </span>
                  <span className="subs-extension-date">
                    <span className="subs-extension-date-label">Expiry</span>
                    <span className="subs-extension-date-value">{expiryLabel || '\u2014'}</span>
                  </span>
                </div>
              )}
              {meta ? <span className="subs-extension-meta">{meta}</span> : null}
              <span className="subs-extension-toggle">
                {expanded ? 'Hide details' : 'View details'}
                {!expanded && proofExt ? (
                  <span className="subs-extension-toggle-dot" aria-hidden="true" />
                ) : null}
              </span>
            </div>
            {/* Action column is rendered on EVERY row so the
                Start/Expiry grid and right edge line up across
                the whole list. Every row gets its OWN Print
                button so the operator can re-issue the receipt
                for that exact period (the row's effective
                subscription). The top "Edit" button edits the
                CURRENT/active period (the latest extension when
                present), so the base/"Initial" row carries its
                own Edit button to keep the base subscription
                editable. The base exposes Print + Edit but no
                Delete — removing the base means deleting the
                whole subscription via the top trash action.
                Actions are icon-only and vertically centered. */}
            <div className="subs-extension-row-actions">
              <button
                type="button"
                className="row-icon-btn"
                onClick={() => onRequestPrint(extEffective)}
                aria-label={ext.isBase ? 'Print initial receipt' : 'Print extension receipt'}
                title="Print"
              >
                <PrintIcon />
              </button>
              {ext.isBase ? (
                <button
                  type="button"
                  className="row-icon-btn"
                  onClick={() => onEditBase(subscription)}
                  aria-label="Edit initial subscription"
                  title="Edit"
                >
                  <EditIcon />
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="row-icon-btn"
                    onClick={() => onEditExtension(ext)}
                    aria-label="Edit extension"
                    title="Edit"
                  >
                    <EditIcon />
                  </button>
                  <button
                    type="button"
                    className="row-delete-x"
                    onClick={() => onDeleteExtension(ext)}
                    aria-label="Delete extension"
                    title="Delete"
                  >
                    <DeleteIcon />
                  </button>
                </>
              )}
            </div>
            {expanded ? (
              <div className="subs-extension-detail">
                {paymentLabelExt ? (
                  <div className="subs-extension-detail-row"><span>Payment</span><strong>{paymentLabelExt}</strong></div>
                ) : null}
                {startLabel ? (
                  <div className="subs-extension-detail-row"><span>Start</span><strong>{startLabel}</strong></div>
                ) : null}
                {expiryLabel ? (
                  <div className="subs-extension-detail-row"><span>Expiry</span><strong>{expiryLabel}</strong></div>
                ) : null}
                {priceLabelExt ? (
                  <div className="subs-extension-detail-row"><span>Price</span><strong>{priceLabelExt}</strong></div>
                ) : null}
                <div className="subs-extension-detail-row"><span>Access Period</span><strong>{periodLabel || '0 Days'}</strong></div>
                <div className="subs-extension-detail-row"><span>Bonus</span><strong>{bonusDetailExt}</strong></div>
                {statusLabelExt ? (
                  <div className="subs-extension-detail-row"><span>Status</span><strong>{statusLabelExt}</strong></div>
                ) : null}
                {ext.service ? (
                  <div className="subs-extension-detail-row"><span>Service</span><strong>{toTitleCase(ext.service)}</strong></div>
                ) : null}
                {proofExt ? (
                  <div className="subs-extension-detail-row">
                    <span>Payment Proof</span>
                    {proofViewableExt ? (
                      <a className="subs-proof-link" href={proofExt} target="_blank" rel="noopener noreferrer">View proof</a>
                    ) : (
                      <strong className="subs-extension-detail-proof-text">{proofExt}</strong>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}
