# Payment proof worker patch

Run:

```bash
node scripts/patch-payment-proof-worker.mjs
git add _worker.js
git commit -m "Add public payment proof submit route"
git push
```

This patches `_worker.js` with `/api/payment-proof-submit`.
