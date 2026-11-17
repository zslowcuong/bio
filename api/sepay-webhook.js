import {
  completeOrderWithProKey,
  dbGetJson,
  dbSetJson,
  handlePreflight,
  normalizeTextForMatch,
  parseBody,
  BANK_CONFIG,
} from './_shared.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const webhookSecret = process.env.SEPAY_WEBHOOK_SECRET || process.env.SEPAY_API_KEY || '';
    if (webhookSecret) {
      const auth = String(req.headers.authorization || req.headers['x-api-key'] || req.query?.token || '').trim();
      const cleanAuth = auth.replace(/^(Apikey|Bearer)\s+/i, '').trim();
      if (cleanAuth !== webhookSecret && auth !== `Apikey ${webhookSecret}` && auth !== `Bearer ${webhookSecret}`) {
        return res.status(401).json({ success: false, error: 'Unauthorized Webhook' });
      }
    }

    const tx = await parseBody(req);
    const txId = String(tx.id || tx.referenceCode || tx.transaction_id || '');
    const transferType = String(tx.transferType || tx.type || 'in').toLowerCase();
    const amountIn = Number(tx.transferAmount || tx.amount_in || tx.amount || 0);
    const content = String(tx.content || tx.description || tx.transaction_content || '');
    const accNo = String(tx.accountNumber || tx.account_number || '').trim();

    // Verify incoming transfer
    if (!txId || (transferType && transferType !== 'in') || amountIn <= 0) {
      return res.status(200).json({ success: true, ignored: true, reason: 'Not an incoming transfer' });
    }

    // Check account number if present in webhook payload
    if (accNo && accNo !== BANK_CONFIG.accountNo) {
      return res.status(200).json({ success: true, ignored: true, reason: 'Account number mismatch' });
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
      return res.status(200).json({ success: true, matched: false, reason: 'No matching pending order found' });
    }

    claimedTx[txId] = { orderCode: target.orderCode, claimedAtUtc: Date.now() };
    await dbSetJson('flowly:claimed_tx', claimedTx);

    // AUTO APPROVE & ISSUE KEY IMMEDIATELY
    const completed = await completeOrderWithProKey(target, txId, 'SEPAY_WEBHOOK_VERIFIED');
    return res.status(200).json({
      success: true,
      matched: true,
      autoApproved: true,
      orderCode: completed.orderCode,
      key: completed.key,
      hwid: completed.hwid,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
