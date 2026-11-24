import crypto from 'crypto';
import {
  APPS,
  BANK_CONFIG,
  PLANS,
  SINGLE_PLANS,
  buildVietQrUrl,
  completeOrderWithProKey,
  getLifetimePricingTier,
  dbGetJson,
  dbSetJson,
  dbHgetJson,
  dbHsetJson,
  dbHgetAllJson,
  dbSetNx,
  getBackendStatus,
  handlePreflight,
  makePaymentMemo,
  normalizeAppId,
  normalizeHwid,
  normalizeTextForMatch,
  parseBody,
  sendTelegram,
  signProKey,
  sanitizeKeyInput,
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
        singlePlans: SINGLE_PLANS,
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
        singlePlans: SINGLE_PLANS,
        apps: Object.values(APPS).map((a) => ({ id: a.id, name: a.name, prefix: a.prefix })),
        ...backendStatus,
      });
    }

    if (action === 'create_order') {
      const appId = normalizeAppId(body.appId || body.app || 'all') || 'all';
      const hwid = normalizeHwid(body.hwid);
      const planCode = String(body.planCode || body.plan || '7D').trim().toUpperCase();
      const phone = String(body.phone || '').trim().slice(0, 32);
      const isComboAll = appId === 'all';
      const selectedPlan = isComboAll ? PLANS[planCode] : (SINGLE_PLANS[planCode] || PLANS[planCode]);

      if (!appId || !APPS[appId] || !selectedPlan) {
        return res.status(400).json({ success: false, error: 'Ứng dụng hoặc gói không hợp lệ' });
      }
      if (!hwid || hwid.length < 4) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập Mã Thiết Bị (HWID) hợp lệ' });
      }
      if (!phone || phone.length < 8) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập SĐT hoặc Zalo để bảo hành & tra cứu đơn' });
      }

      let finalPrice = selectedPlan.price;
      if (isComboAll && planCode === 'LIFE') {
        const lifeTier = await getLifetimePricingTier();
        finalPrice = lifeTier.currentPrice || 99000;
      }

      const num6 = String(Math.floor(100000 + Math.random() * 900000));
      const orderCode = `ORD${num6}`;
      const memo = makePaymentMemo(num6);
      const qrUrl = buildVietQrUrl(finalPrice, memo);
      const nowUtc = Date.now();

      const finalAppId = appId;
      const appDisplayName = isComboAll
        ? 'Combo Full 5 App (FlowZ, FlowOptimize, FlowS, FlowMax, FlowCore)'
        : `${APPS[appId].name} (Đơn App)`;
      const priceTagK = `${Math.round(finalPrice / 1000)}K`;
      const planTitle = isComboAll
        ? ((planCode === '2D' || planCode === '3D')
            ? `Gói Trải Nghiệm 48H Combo Full 5 App (${priceTagK})`
            : (planCode === '7D'
                ? `Gói 1 Tuần (7 Ngày) Combo Full 5 App (${priceTagK})`
                : (planCode === '30D'
                    ? `Gói 1 Tháng (30 Ngày) Combo Full 5 App (${priceTagK})`
                    : (planCode === 'LIFE'
                        ? `Gói Vĩnh Viễn Full 5 App Trọn Đời (${priceTagK})`
                        : `${selectedPlan.name} (${priceTagK})`))))
        : (planCode === '7D'
            ? `Gói 7 Ngày Đơn App • ${APPS[appId].name} (${priceTagK})`
            : (planCode === '30D'
                ? `Gói 1 Tháng Đơn App • ${APPS[appId].name} (${priceTagK})`
                : (planCode === 'LIFE'
                    ? `Gói Vĩnh Viễn Đơn App • ${APPS[appId].name} (${priceTagK})`
                    : `${selectedPlan.name} • ${APPS[appId].name} (${priceTagK})`)));

      const order = {
        orderCode,
        memo,
        appId: finalAppId,
        appName: appDisplayName,
        hwid,
        planCode,
        planName: planTitle,
        price: finalPrice,
        phone,
        allApps: isComboAll,
        method: 'VIETQR_TPB',
        qrUrl,
        status: 'PENDING',
        key: null,
        createdAtUtc: nowUtc,
        createdAt: new Date(nowUtc).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      };

      // 1. Atomic write to orders map
      await dbHsetJson('flowly:orders_map', order.orderCode, order);
      const orders = (await dbGetJson('flowly:orders', [])) || [];
      orders.unshift(order);
      await dbSetJson('flowly:orders', orders.slice(0, 500));

      const tgTitle = `🔔 [FLOW SHOP] ĐƠN HÀNG MỚI (${planTitle})`;
      const tgAppName = isComboAll
        ? 'Full 5 App: FlowZ + FlowOptimize + FlowS + FlowMax + FlowCore'
        : `Đơn App: ${APPS[appId].name} (${APPS[appId].prefix})`;
      const tgPlanName = planTitle;

      await sendTelegram(
        `<b>${tgTitle}</b>

` +
        `📦 <b>Mã đơn:</b> <code>${orderCode}</code>
` +
        `💬 <b>Nội dung CK:</b> <code>${memo}</code>
` +
        `💰 <b>Số tiền:</b> <b>${finalPrice.toLocaleString('vi-VN')}đ</b>
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

      // Check atomic hash map first
      let order = await dbHgetJson('flowly:orders_map', orderCode);
      if (!order) {
        const orders = (await dbGetJson('flowly:orders', [])) || [];
        order = orders.find((o) => o.orderCode === orderCode);
      }
      if (!order) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' });
      }

      if (order.status === 'COMPLETED' && order.key) {
        return res.status(200).json({ success: true, paid: true, order, ...backendStatus });
      }

      // Real bank verification via SePay API ONLY if SEPAY_API_KEY is configured
      const sepayApiKey = process.env.SEPAY_API_KEY || process.env.SEPAY_WEBHOOK_SECRET || '';
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

            const matched = txs.find((tx) => {
              const txId = String(tx.id || '');
              const amountIn = Number(tx.amount_in || 0);
              const content = tx.transaction_content || '';
              return (
                txId &&
                amountIn >= Number(order.price) &&
                memoMatchesTransaction(content, order.memo)
              );
            });

            if (matched) {
              const txId = String(matched.id);
              // Atomic claim via SETNX
              const acquired = await dbSetNx(`flowly:claim_tx:${txId}`, JSON.stringify({ orderCode: order.orderCode, claimedAtUtc: Date.now() }), 86400 * 30);
              if (acquired) {
                order = await completeOrderWithProKey(order, txId, 'SEPAY_POLL_VERIFIED');
                return res.status(200).json({
                  success: true,
                  paid: true,
                  order,
                  ...backendStatus,
                });
              }
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

    if (action === 'support_message') {
      const orderCode = String(body.orderCode || '').trim().toUpperCase();
      const hwid = normalizeHwid(body.hwid);
      const phone = String(body.phone || '').trim();
      const message = String(body.message || '').trim().slice(0, 500);
      if (!message) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập nội dung cần hỗ trợ' });
      }

      await sendTelegram(
        `💬 <b>[HỖ TRỢ THANH TOÁN & KEY PRO]</b>\n\n` +
        `📦 <b>Mã đơn:</b> <code>${orderCode || 'CHƯA_CÓ'}</code>\n` +
        `🆔 <b>HWID:</b> <code>${hwid || 'N/A'}</code>\n` +
        `📞 <b>SĐT/Zalo:</b> <code>${phone || 'N/A'}</code>\n` +
        `📩 <b>Tin nhắn khách gửi:</b>\n"<i>${message}</i>"\n\n` +
        `👉 <i>Bấm để trò chuyện hỗ trợ khách ngay:</i> <a href="https://t.me/zslowcuong">@zslowcuong</a>`
      );
      return res.status(200).json({
        success: true,
        message: 'Đã gửi tin nhắn đến Admin! Admin sẽ phản hồi hỗ trợ bạn ngay qua Telegram / Zalo.'
      });
    }

    if (action === 'change_hwid') {
      const keyInput = sanitizeKeyInput(body.key || '');
      const newHwidInput = normalizeHwid(body.newHwid);
      if (!keyInput || !newHwidInput) {
        return res.status(400).json({ success: false, error: 'Vui lòng nhập Mã Key và HWID mới' });
      }
      const orders = (await dbGetJson('flowly:orders', [])) || [];
      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];

      let targetOrder = orders.find((o) => o.key === keyInput);
      let targetKeyRec = issuedKeys.find((k) => k.key === keyInput);

      if (!targetOrder && !targetKeyRec) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy thông tin Key này trên hệ thống!' });
      }

      const currentHwid = targetOrder?.hwid || targetKeyRec?.hwid || '';
      const planCode = targetOrder?.planCode || targetKeyRec?.planCode || 'LIFE';
      const appId = targetOrder?.appId || targetKeyRec?.appId || 'all';
      let changeCount = Number(targetOrder?.changeHwidCount || targetKeyRec?.changeHwidCount || 0);

      if (currentHwid === newHwidInput) {
        return res.status(400).json({ success: false, error: 'HWID mới trùng khớp với HWID hiện tại của máy!' });
      }

      const isComboAllOrder = appId === 'all' || targetOrder?.allApps === true || targetKeyRec?.allApps === true || keyInput.startsWith('FLOWALL-');
      let maxFreeChanges = 1;
      if (planCode === 'LIFE') {
        maxFreeChanges = isComboAllOrder ? 3 : 2;
      } else if (planCode === '1Y' || planCode === '365D') {
        maxFreeChanges = 2;
      } else {
        maxFreeChanges = 1;
      }

      if (changeCount >= maxFreeChanges) {
        return res.status(400).json({
          success: false,
          needFee: true,
          changeCount,
          maxFreeChanges,
          fee: 10000,
          message: `Bạn đã sử dụng hết ${maxFreeChanges} lần đổi thiết bị miễn phí (${changeCount}/${maxFreeChanges}). Phí đổi máy từ lượt tiếp theo là 10.000đ/lượt. Vui lòng liên hệ Admin Telegram @zslowcuong để được hỗ trợ chuyển máy nhanh chóng!`
        });
      }

      // Free transfer (1st or 2nd time)
      changeCount += 1;
      const nonce4 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const newKey = signProKey(appId, newHwidInput, planCode, nonce4);

      if (targetOrder) {
        targetOrder.oldHwid = currentHwid;
        targetOrder.oldKey = keyInput;
        if (!Array.isArray(targetOrder.hwids)) targetOrder.hwids = [currentHwid].filter(Boolean);
        if (!targetOrder.hwids.includes(newHwidInput)) targetOrder.hwids.push(newHwidInput);
        if (!Array.isArray(targetOrder.oldKeys)) targetOrder.oldKeys = [];
        if (!targetOrder.oldKeys.includes(keyInput)) targetOrder.oldKeys.push(keyInput);
        targetOrder.hwid = newHwidInput;
        targetOrder.key = newKey;
        targetOrder.changeHwidCount = changeCount;
        targetOrder.lastChangedAtUtc = Date.now();
        await dbSetJson('flowly:orders', orders);
      }
      if (targetKeyRec) {
        targetKeyRec.oldHwid = currentHwid;
        targetKeyRec.oldKey = keyInput;
        if (!Array.isArray(targetKeyRec.hwids)) targetKeyRec.hwids = [currentHwid].filter(Boolean);
        if (!targetKeyRec.hwids.includes(newHwidInput)) targetKeyRec.hwids.push(newHwidInput);
        if (!Array.isArray(targetKeyRec.oldKeys)) targetKeyRec.oldKeys = [];
        if (!targetKeyRec.oldKeys.includes(keyInput)) targetKeyRec.oldKeys.push(keyInput);
        targetKeyRec.hwid = newHwidInput;
        targetKeyRec.key = newKey;
        targetKeyRec.changeHwidCount = changeCount;
        targetKeyRec.lastChangedAtUtc = Date.now();
        await dbSetJson('flowly:issued_keys', issuedKeys);
      }

      await sendTelegram(
        `🔄 <b>[ĐỔI THIẾT BỊ MIỄN PHÍ (${changeCount}/${maxFreeChanges})]</b>\n\n` +
        `📦 <b>Gói:</b> ${planCode}\n` +
        `📱 <b>HWID cũ:</b> <code>${currentHwid}</code>\n` +
        `📲 <b>HWID mới:</b> <code>${newHwidInput}</code>\n` +
        `🔑 <b>Key mới:</b> <code>${newKey}</code>\n` +
        `🎁 <b>Số lần đổi miễn phí còn lại:</b> ${Math.max(0, maxFreeChanges - changeCount)} lần`
      );

      return res.status(200).json({
        success: true,
        newKey,
        oldKey: keyInput,
        newHwid: newHwidInput,
        changeCount,
        maxFreeChanges,
        remainingFree: Math.max(0, maxFreeChanges - changeCount),
        message: `Đổi thiết bị thành công! Key mới của bạn: ${newKey}. Bạn còn ${Math.max(0, maxFreeChanges - changeCount)} lần đổi máy miễn phí.`
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
          String(o.key || '').toUpperCase().includes(q) ||
          String(o.oldKey || '').toUpperCase().includes(q) ||
          (Array.isArray(o.oldKeys) && o.oldKeys.some((ok) => String(ok).toUpperCase().includes(q))) ||
          String(o.hwid || '').toUpperCase().includes(q) ||
          String(o.oldHwid || '').toUpperCase().includes(q) ||
          (Array.isArray(o.hwids) && o.hwids.some((h) => String(h).toUpperCase().includes(q))) ||
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

