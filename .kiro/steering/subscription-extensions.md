---
inclusion: fileMatch
fileMatchPattern: ['src/pages/db/DatabasePage.jsx', '_worker.js']
---

# Subscription extension defaults

When the operator opens "Add Extension" on a subscription, the new
extension's **Start Date/Time** must always continue from the latest
known expiry of that subscription — including any prior extensions.

## Default chain (in priority order)

1. **Latest extension expiry** — sort all existing extensions for the
   subscription and take the one with the latest `expiry_date` +
   `expiry_time`. The new extension's Start Date/Time = that expiry.
2. **Base subscription expiry** — only when no extensions exist, fall
   back to the base subscription's `expiry_date` / `expiry_time`.
3. **Current date/time** — only when no expiry is recorded anywhere
   (neither extensions nor the base subscription have one).

The operator must never see a new extension defaulting to "today" if a
later expiry already exists somewhere in the chain.

## Example

```
Base subscription
  Start  : 12 Apr
  Expiry : 12 May

Extension 1 (+30 days)
  Start  defaults to : 12 May          (= base expiry)
  Expiry computed to : 11 Jun

Extension 2 (+30 days)
  Start  defaults to : 11 Jun          (= ext 1 expiry, NOT base expiry)
  Expiry computed to : 11 Jul          (or whatever addDays(start, 30) yields)
```

## Field-level rules

- **Start Date/Time**: stays editable. Default per the chain above.
- **Access Period Days**: stays editable. Default = base subscription's
  `access_period` (or 30 if missing).
- **Expiry Date/Time**: auto-calculated from `Start + Access Period`.
  - Recompute when the operator edits Start.
  - Recompute when the operator edits Access Period.
  - **Do not** recompute once the operator has manually edited Expiry —
    treat it as locked until Start or Period change again.

## Sorting

When picking the latest extension, sort by a combined date+time key:

```
expiry_date + 'T' + (expiry_time || '00:00:00')
```

Fall back to `start_date + 'T' + (start_time || '00:00:00')` only when
the extension has no expiry, and to `created_at` only when it has
neither. Mixing plain `YYYY-MM-DD` strings with ISO timestamps in the
same sort key produces incorrect tie-breaks and must be avoided.

## Where this is enforced

- `s/src/pages/db/DatabasePage.jsx` —
  `pickLatestSubscriptionExtension`, `openAddExtension`,
  `setExtensionField`.
- `s/_worker.js` — `pickLatestExtension` (server-side `latest_extension`
  attached to each subscription row by `/api/db`).
