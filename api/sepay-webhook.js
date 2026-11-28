import crypto from 'node:crypto';
import {
  completeOrderWithProKey,
  completeHwidChangeRequest,
  dbGetJson,
  dbSetJson,
  dbHgetAllJson,
  dbSetNx,
  handlePreflight,
  normalizeTextForMatch,
  parseBody,
  BANK_CONFIG,
} from './_shared.js';

function safeSecretEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');
  if (!bufA.length || bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

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
      if (!safeSecretEqual(cleanAuth, webhookSecret) && !safeSecretEqual(auth, webhookSecret)) {
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

    const claimKey = `flowly:claim_tx:${txId}`;
    const alreadyClaimed = await dbGetJson(claimKey, null);
    if (alreadyClaimed) {
      return res.status(200).json({ success: true, duplicate: true, reason: 'Transaction already claimed' });
    }

    const compactContent = normalizeTextForMatch(content).replace(/\s+/g, '');

    // 1. Query Atomic Orders Map First (New PRO orders)
    const ordersMap = (await dbHgetAllJson('flowly:orders_map')) || {};
    let target = Object.values(ordersMap).find((o) => {
      if (!o || o.status === 'COMPLETED') return false;
      const memoUpper = String(o.memo || '').toUpperCase();
      return memoUpper && compactContent.includes(memoUpper) && amountIn >= Number(o.price);
    });

    if (!target) {
      const orders = (await dbGetJson('flowly:orders', [])) || [];
      target = orders.find((o) => {
        if (!o || o.status === 'COMPLETED') return false;
        const memoUpper = String(o.memo || '').toUpperCase();
        return memoUpper && compactContent.includes(memoUpper) && amountIn >= Number(o.price);
      });
    }

    if (target) {
      const acquired = await dbSetNx(claimKey, JSON.stringify({ txId, type: 'ORDER', orderCode: target.orderCode, amountIn, time: Date.now() }), 86400 * 30);
      if (!acquired) {
        return res.status(200).json({ success: true, duplicate: true, reason: 'Transaction already claimed' });
      }
      const completed = await completeOrderWithProKey(target, txId, 'SEPAY_WEBHOOK_VERIFIED');
      return res.status(200).json({
        success: true,
        matched: true,
        type: 'ORDER',
        autoApproved: true,
        orderCode: completed.orderCode,
        key: completed.key,
        hwid: completed.hwid,
      });
    }

    // 2. Check Paid HWID Migration Requests (flowly:hwid_change_requests - 5.000đ)
    const changeReqs = (await dbGetJson('flowly:hwid_change_requests', [])) || [];
    const targetChange = changeReqs.find((r) => {
      if (!r || r.status === 'COMPLETED') return false;
      const memoUpper = String(r.memo || '').toUpperCase();
      return memoUpper && compactContent.includes(memoUpper) && amountIn >= Number(r.price || 5000);
    });

    if (targetChange) {
      const acquired = await dbSetNx(claimKey, JSON.stringify({ txId, type: 'HWID_CHANGE', orderCode: targetChange.orderCode, amountIn, time: Date.now() }), 86400 * 30);
      if (!acquired) {
        return res.status(200).json({ success: true, duplicate: true, reason: 'Transaction already claimed' });
      }
      const completedChange = await completeHwidChangeRequest(targetChange, txId, 'SEPAY_WEBHOOK_VERIFIED');
      return res.status(200).json({
        success: true,
        matched: true,
        type: 'HWID_CHANGE',
        autoApproved: !completedChange.error,
        orderCode: completedChange.orderCode,
        newKey: completedChange.newKey || null,
        newHwid: completedChange.newHwid || null,
        error: completedChange.error || undefined,
      });
    }

    // Do NOT claim txId when unmatched so retries or delayed order creation still work
    return res.status(200).json({ success: true, matched: false, reason: 'No matching pending order or HWID migration request found' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}
