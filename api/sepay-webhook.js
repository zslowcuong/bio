import {
  completeOrderWithProKey,
  dbGetJson,
  dbSetJson,
  handlePreflight,
  normalizeTextForMatch,
  parseBody,
} from './_shared.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const webhookSecret = process.env.SEPAY_WEBHOOK_SECRET || '';
    if (webhookSecret) {
      const auth = String(req.headers.authorization || '').trim();
      const expected = `Apikey ${webhookSecret}`;
      if (auth !== expected) {
        return res.status(401).json({ success: false, error: 'Unauthorized Webhook' });
      }
    } else {
      // Strictly reject unauthenticated webhook hits until SEPAY_WEBHOOK_SECRET is configured on Vercel
      return res.status(503).json({
        success: false,
        error: 'SEPAY_WEBHOOK_SECRET is not configured on Vercel yet',
      });
    }

    const tx = await parseBody(req);
    const txId = String(tx.id || tx.referenceCode || '');
    const transferType = String(tx.transferType || '').toLowerCase();
    const amountIn = Number(tx.transferAmount || tx.amount_in || 0);
    const content = String(tx.content || tx.description || '');

    if (!txId || transferType !== 'in' || amountIn <= 0) {
      return res.status(200).json({ success: true, ignored: true, reason: 'Not an incoming transfer' });
    }

    const claimedTx = (await dbGetJson('flowly:claimed_tx', {})) || {};
    if (claimedTx[txId]) {
      return res.status(200).json({ success: true, duplicate: true, orderCode: claimedTx[txId].orderCode });
    }

    const compactContent = normalizeTextForMatch(content).replace(/\s+/g, '');
    const orders = (await dbGetJson('flowly:orders', [])) || [];
    const target = orders.find((o) => {
      if (o.status === 'COMPLETED') return false;
      const memoUpper = String(o.memo || '').toUpperCase();
      return memoUpper && compactContent.includes(memoUpper) && amountIn >= Number(o.price);
    });

    if (!target) {
      return res.status(200).json({ success: true, matched: false });
    }

    claimedTx[txId] = { orderCode: target.orderCode, claimedAtUtc: Date.now() };
    await dbSetJson('flowly:claimed_tx', claimedTx);

    const completed = await completeOrderWithProKey(target, txId, 'SEPAY_WEBHOOK_VERIFIED');
    return res.status(200).json({ success: true, matched: true, orderCode: completed.orderCode, key: completed.key });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

