import {
  APPS,
  BANK_CONFIG,
  PLANS,
  buildVietQrUrl,
  completeOrderWithProKey,
  getLifetimePricingTier,
  dbGetJson,
  dbSetJson,
  getBackendStatus,
  handlePreflight,
  makePaymentMemo,
  normalizeAppId,
  normalizeHwid,
  normalizeTextForMatch,
  parseBody,
  sendTelegram,
} from './_shared.js';

function memoMatchesTransaction(contentRaw, orderMemo) {
  const norm = normalizeTextForMatch(contentRaw);
  const compact = norm.replace(/\s+/g, '');
  const memoUpper = String(orderMemo || '').toUpperCase();
  if (!memoUpper) return false;
  return compact.includes(memoUpper);
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;

  try {
    const body = req.method === 'POST' ? await parseBody(req) : {};
    const action = String(req.query?.action || body.action || 'status').trim().toLowerCase();
    const backendStatus = getBackendStatus();
    const serverNowUtc = Date.now();

    if (action === 'pricing') {
      const pricing = await getLifetimePricingTier();
      return res.status(200).json({
        success: true,
        pricing,
        plans: PLANS,
        bank: BANK_CONFIG,
        serverNowUtc,
        ...backendStatus,
      });
    }

    if (action === 'status') {
      return res.status(200).json({
        success: true,
        bank: BANK_CONFIG,
        plans: PLANS,
        apps: Object.values(APPS).map((a) => ({ id: a.id, name: a.name, prefix: a.prefix })),
        ...backendStatus,
      });
    }

    if (action === 'create_order') {
      const appId = normalizeAppId(body.appId || body.app || 'flowoptimize');
      const hwid = normalizeHwid(body.hwid);
      const planCode = String(body.planCode || body.plan || '7D').trim().toUpperCase();
      const phone = String(body.phone || '').trim().slice(0, 32);

      if (!appId || !PLANS[planCode]) {
        return res.status(400).json({ success: false, error: 'Ứng dụng hoặc gói không hợp lệ' });
      }
      if (!hwid || hwid.length < 4) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập Mã Thiết Bị (HWID) hợp lệ' });
      }
      if (!phone || phone.length < 8) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập SĐT hoặc Zalo để bảo hành & tra cứu đơn' });
      }

      const plan = PLANS[planCode];
      const isLifeCombo = planCode === 'LIFE' || appId === 'all';
      let finalPrice = plan.price;
      let pricingTierInfo = null;
      if (isLifeCombo) {
        pricingTierInfo = await getLifetimePricingTier();
        finalPrice = pricingTierInfo.currentPrice;
      }
      const num6 = String(Math.floor(100000 + Math.random() * 900000));
      const orderCode = `ORD${num6}`;
      const memo = makePaymentMemo(num6);
      const qrUrl = buildVietQrUrl(finalPrice, memo);
      const nowUtc = Date.now();

      const finalAppId = isLifeCombo ? 'all' : appId;
      const order = {
        orderCode,
        memo,
        appId: finalAppId,
        appName: isLifeCombo ? 'Combo 4 App (FlowOp, FlowS, FlowUltra, FlowExtra)' : APPS[appId].name,
        hwid,
        planCode,
        planName: isLifeCombo ? 'Gói Vĩnh Viễn Combo Full 4 App (99K)' : plan.name,
        price: finalPrice,
        phone,
        allApps: isLifeCombo,
        method: 'VIETQR_TPB',
        qrUrl,
        status: 'PENDING',
        key: null,
        createdAtUtc: nowUtc,
        createdAt: new Date(nowUtc).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      };

      const orders = (await dbGetJson('flowly:orders', [])) || [];
      orders.unshift(order);
      await dbSetJson('flowly:orders', orders.slice(0, 500));

      const tgTitle = isLifeCombo
        ? '👑 [FLOW SHOP] ĐƠN HÀNG COMBO VĨNH VIỄN 99K (FULL 4 APP)'
        : `🔔 [FLOW SHOP] ĐƠN HÀNG VIETQR MỚI (${APPS[appId].name})`;
      const tgAppName = isLifeCombo
        ? 'Full 4 App: FlowOptimize + FlowS + FlowUltra + FlowExtra'
        : APPS[appId].name;
      const tgPlanName = isLifeCombo
        ? 'Gói Vĩnh Viễn Combo Full 4 App (99K)'
        : plan.name;

      await sendTelegram(
        `<b>${tgTitle}</b>

` +
        `📦 <b>Mã đơn:</b> <code>${orderCode}</code>
` +
        `💬 <b>Nội dung CK:</b> <code>${memo}</code>
` +
        `💰 <b>Số tiền:</b> <b>${plan.price.toLocaleString('vi-VN')}đ</b>
` +
        `💎 <b>Gói:</b> ${tgPlanName}
` +
        `📱 <b>App:</b> ${tgAppName}
` +
        `🆔 <b>HWID:</b> <code>${hwid}</code>\n` +
        `👤 <b>SĐT/Zalo:</b> <code>${phone}</code>\n\n` +
        `🏦 <i>Chờ tiền thực về 10006503497 TPBANK trước khi cấp Key!</i>`
      );

      return res.status(200).json({
        success: true,
        order,
        bank: BANK_CONFIG,
        ...backendStatus,
      });
    }

    if (action === 'check_order') {
      const orderCode = String(req.query?.orderCode || body.orderCode || '').trim().toUpperCase();
      if (!orderCode) {
        return res.status(400).json({ success: false, error: 'Thiếu orderCode' });
      }

      const orders = (await dbGetJson('flowly:orders', [])) || [];
      let order = orders.find((o) => o.orderCode === orderCode);
      if (!order) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' });
      }

      if (order.status === 'COMPLETED' && order.key) {
        return res.status(200).json({ success: true, paid: true, order, ...backendStatus });
      }

      // Real bank verification via SePay API ONLY if SEPAY_API_KEY is configured
      const sepayApiKey = process.env.SEPAY_API_KEY || '';
      if (sepayApiKey) {
        try {
          const sepayUrl = `https://my.sepay.vn/userapi/transactions/list?account_number=${encodeURIComponent(BANK_CONFIG.accountNo)}&limit=30`;
          const spRes = await fetch(sepayUrl, {
            headers: {
              Authorization: `Bearer ${sepayApiKey}`,
              'Content-Type': 'application/json',
            },
          });
          if (spRes.ok) {
            const spData = await spRes.json();
            const txs = Array.isArray(spData?.transactions) ? spData.transactions : [];
            const claimedTx = (await dbGetJson('flowly:claimed_tx', {})) || {};

            const matched = txs.find((tx) => {
              const txId = String(tx.id || '');
              const amountIn = Number(tx.amount_in || 0);
              const content = tx.transaction_content || '';
              return (
                txId &&
                !claimedTx[txId] &&
                amountIn >= Number(order.price) &&
                memoMatchesTransaction(content, order.memo)
              );
            });

            if (matched) {
              const txId = String(matched.id);
              claimedTx[txId] = { orderCode: order.orderCode, claimedAtUtc: Date.now() };
              await dbSetJson('flowly:claimed_tx', claimedTx);
              order = await completeOrderWithProKey(order, txId, 'SEPAY_POLL_VERIFIED');
              return res.status(200).json({
                success: true,
                paid: true,
                order,
                ...backendStatus,
              });
            }
          }
        } catch (err) {
          return res.status(200).json({
            success: true,
            paid: false,
            order,
            sepayError: err.message,
            message: 'Đang kiểm tra giao dịch TPBank, vui lòng đợi thêm giây lát...',
            ...backendStatus,
          });
        }
      }

      return res.status(200).json({
        success: true,
        paid: false,
        order,
        message: sepayApiKey
          ? `Chưa thấy giao dịch ${Number(order.price).toLocaleString('vi-VN')}đ kèm nội dung "${order.memo}" về TPBank. Vui lòng chuyển khoản đúng QR rồi bấm kiểm tra lại.`
          : 'Đơn đang chờ xác nhận biến động số dư TPBank (Chưa gắn SEPAY_API_KEY trên Vercel — Admin sẽ duyệt tay ngay khi thấy tiền về).',
        ...backendStatus,
      });
    }

    if (action === 'notify_paid') {
      const orderCode = String(body.orderCode || '').trim().toUpperCase();
      const appName = String(body.appName || 'Flowly').trim();
      const phone = String(body.phone || '').trim();
      const hwid = normalizeHwid(body.hwid);
      const plan = String(body.plan || '').trim();
      const price = Number(body.price || 0);

      await sendTelegram(
        `📢 <b>[KHÁCH BÁO ĐÃ CHUYỂN KHOẢN]</b>\n\n` +
        `📱 <b>App:</b> ${appName}\n` +
        `📦 <b>Mã đơn / CK:</b> <code>${orderCode}</code>\n` +
        `💎 <b>Gói:</b> ${plan} (<b>${price.toLocaleString('vi-VN')}đ</b>)\n` +
        `🆔 <b>HWID:</b> <code>${hwid}</code>\n` +
        `📞 <b>SĐT/Zalo:</b> <code>${phone}</code>\n\n` +
        `👉 <i>Admin kiểm tra TPBank và bấm Duyệt Đơn trên Dashboard!</i>`
      );
      return res.status(200).json({ success: true });
    }

    if (action === 'lookup') {
      const q = String(req.query?.q || body.q || '').trim().toUpperCase();
      if (!q || q.length < 4) {
        return res.status(400).json({ success: false, error: 'Nhập Mã Đơn, Nội dung CK, HWID hoặc SĐT (>= 4 ký tự)' });
      }
      const orders = (await dbGetJson('flowly:orders', [])) || [];
      const matches = orders
        .filter((o) =>
          String(o.orderCode || '').toUpperCase() === q ||
          String(o.memo || '').toUpperCase() === q ||
          String(o.hwid || '').toUpperCase().includes(q) ||
          String(o.phone || '').toUpperCase().includes(q)
        )
        .slice(0, 15);
      return res.status(200).json({ success: true, orders: matches, ...backendStatus });
    }

    return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

