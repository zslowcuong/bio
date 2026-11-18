import crypto from 'node:crypto';
import {
  APPS,
  PLANS,
  completeOrderWithProKey,
  dbGetJson,
  dbSetJson,
  getBackendStatus,
  getEventKeysMap,
  getGlobalResetsMap,
  getTrialEnabled,
  getRevokedKeysList,
  handlePreflight,
  isAdminAuthorized,
  normalizeAppId,
  normalizeHwid,
  parseBody,
  sanitizeKeyInput,
  sha256Hex,
  signProKey,
} from './_shared.js';

function formatDurationLabel(hours) {
  const h = Number(hours || 24);
  if (h >= 720 && h % 720 === 0) return `${h / 720} Tháng`;
  if (h >= 168 && h % 168 === 0) return `${h / 168} Tuần`;
  if (h >= 24 && h % 24 === 0) return `${h / 24} Ngày`;
  return `${h} Giờ`;
}

function resolveTargetAppIds(body) {
  if (Array.isArray(body.appIds) && body.appIds.length > 0) {
    const valid = body.appIds.map((x) => normalizeAppId(x)).filter(Boolean);
    if (valid.length > 0) return Array.from(new Set(valid));
  }
  const raw = String(body.appId || '').trim().toLowerCase();
  if (raw === 'all' || raw === '*') return Object.keys(APPS);
  const single = normalizeAppId(raw);
  return single ? [single] : [];
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;

  try {
    const body = req.method === 'POST' ? await parseBody(req) : {};
    if (!isAdminAuthorized(req, body)) {
      return res.status(401).json({ success: false, error: 'Sai mã PIN Admin!' });
    }

    const action = String(req.query?.action || body.action || 'dashboard').trim().toLowerCase();
    const backendStatus = getBackendStatus();

    if (action === 'dashboard') {
      const orders = (await dbGetJson('flowly:orders', [])) || [];
      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const revokedKeys = await getRevokedKeysList();
      const eventKeys = await getEventKeysMap();
      const globalResets = await getGlobalResetsMap();
      const trialEnabled = await getTrialEnabled();
      return res.status(200).json({
        success: true,
        orders,
        issuedKeys,
        revokedKeys,
        eventKeys,
        globalResets,
        trialEnabled,
        ...backendStatus,
      });
    }

    if (action === 'approve_order') {
      const orderCode = String(body.orderCode || '').trim().toUpperCase();
      const orders = (await dbGetJson('flowly:orders', [])) || [];
      const target = orders.find((o) => o.orderCode === orderCode);
      if (!target) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' });
      }
      const completed = await completeOrderWithProKey(target, body.txId || `ADMIN_${Date.now()}`, 'ADMIN_VERIFIED_TCB');
      return res.status(200).json({ success: true, order: completed });
    }

    if (action === 'delete_order') {
      const orderCode = String(body.orderCode || '').trim().toUpperCase();
      let orders = (await dbGetJson('flowly:orders', [])) || [];
      const target = orders.find((o) => o.orderCode === orderCode);
      if (target && target.status === 'COMPLETED' && !body.force) {
        return res.status(400).json({ success: false, error: 'Không thể xóa đơn hàng đã mua và cấp key!' });
      }
      const beforeLen = orders.length;
      orders = orders.filter((o) => o.orderCode !== orderCode);
      await dbSetJson('flowly:orders', orders);
      return res.status(200).json({ success: true, deleted: beforeLen !== orders.length, orderCode });
    }

    if (action === 'sync_order_record') {
      const orderCode = String(body.orderCode || '').trim().toUpperCase();
      const orders = (await dbGetJson('flowly:orders', [])) || [];
      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const ordIdx = orders.findIndex(o => o.orderCode === orderCode);
      if (ordIdx < 0) return res.status(404).json({ success: false, error: 'Không tìm thấy đơn hàng' });
      
      const ord = orders[ordIdx];
      if (body.hwid) ord.hwid = normalizeHwid(body.hwid);
      if (body.key) ord.key = String(body.key).trim().toUpperCase();
      if (Array.isArray(body.hwids)) ord.hwids = body.hwids;
      if (Array.isArray(body.oldKeys)) ord.oldKeys = body.oldKeys;
      if (body.oldKey) ord.oldKey = String(body.oldKey).trim().toUpperCase();
      if (body.oldHwid) ord.oldHwid = normalizeHwid(body.oldHwid);
      if (body.phone) ord.phone = String(body.phone).trim();
      if (body.changeHwidCount !== undefined) ord.changeHwidCount = Number(body.changeHwidCount);
      orders[ordIdx] = ord;
      await dbSetJson('flowly:orders', orders);

      const keyIdx = issuedKeys.findIndex(k => k.orderCode === orderCode || k.key === ord.key || k.key === ord.oldKey);
      if (keyIdx >= 0) {
        issuedKeys[keyIdx] = { ...issuedKeys[keyIdx], ...ord };
        await dbSetJson('flowly:issued_keys', issuedKeys);
      }
      return res.status(200).json({ success: true, order: ord });
    }

    if (action === 'create_manual_key') {
      const appId = normalizeAppId(body.appId || 'flowoptimize');
      const hwid = normalizeHwid(body.hwid);
      const planCode = String(body.planCode || '7D').trim().toUpperCase();
      const phone = String(body.phone || 'Khách Mua Trực Tiếp').trim();
      if (!appId || !hwid || !PLANS[planCode]) {
        return res.status(400).json({ success: false, error: 'Thiếu App ID, HWID hoặc Gói hợp lệ' });
      }

      const plan = PLANS[planCode];
      const nonce4 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const key = signProKey(appId, hwid, planCode, nonce4);
      const nowUtc = Date.now();
      const expiryUtcMs = planCode === 'LIFE' ? 4102444800000 : nowUtc + plan.hours * 3600 * 1000;
      const orderCode = `ADM${Math.floor(100000 + Math.random() * 900000)}`;
      const isLifeCombo = appId === 'all' || planCode === 'LIFE';

      const order = {
        orderCode,
        memo: orderCode,
        appId,
        appName: isLifeCombo ? 'Combo Full 5 App (FlowOp, FlowS, FlowUltra, FlowExtra, FlowZ VIP)' : APPS[appId].name,
        hwid,
        planCode,
        planName: planCode === 'LIFE'
          ? 'Gói Vĩnh Viễn Full Bảo Hành Trọn Đời Hệ Thống App FlowEngine'
          : (planCode === '1Y' || planCode === '365D'
              ? 'Gói 1 Năm Combo 5 App (365 Ngày)'
              : plan.name),
        price: plan.price,
        phone,
        allApps: isLifeCombo,
        method: 'ADMIN_MANUAL',
        status: 'COMPLETED',
        key,
        createdAtUtc: nowUtc,
        completedAtUtc: nowUtc,
        expiryUtcMs,
        createdAt: new Date(nowUtc).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      };

      const orders = (await dbGetJson('flowly:orders', [])) || [];
      orders.unshift(order);
      await dbSetJson('flowly:orders', orders.slice(0, 500));

      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      issuedKeys.unshift({
        key,
        appId,
        allApps: isLifeCombo,
        hwid,
        planCode,
        planName: plan.name,
        phone,
        price: plan.price,
        orderCode,
        source: 'ADMIN_MANUAL',
        createdAtUtc: nowUtc,
        expiryUtcMs,
        revoked: false,
      });
      await dbSetJson('flowly:issued_keys', issuedKeys.slice(0, 800));

      return res.status(200).json({ success: true, key, order });
    }

    if (action === 'revoke_key' || action === 'unrevoke_key') {
      const targetKey = String(body.key || '').trim().toUpperCase();
      const shouldRevoke = action === 'revoke_key';
      if (!targetKey) {
        return res.status(400).json({ success: false, error: 'Thiếu mã key' });
      }
      let revokedList = (await dbGetJson('flowly:revoked_keys', [])) || [];
      revokedList = revokedList.map((k) => String(k).trim().toUpperCase()).filter(Boolean);
      if (shouldRevoke) {
        if (!revokedList.includes(targetKey)) revokedList.push(targetKey);
      } else {
        revokedList = revokedList.filter((k) => k !== targetKey);
      }
      await dbSetJson('flowly:revoked_keys', revokedList);

      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const updatedIssued = issuedKeys.map((item) =>
        String(item.key || '').toUpperCase() === targetKey ? { ...item, revoked: shouldRevoke } : item
      );
      await dbSetJson('flowly:issued_keys', updatedIssued);

      return res.status(200).json({ success: true, revokedKeys: revokedList, key: targetKey, revoked: shouldRevoke });
    }

    if (action === 'delete_issued_key') {
      const targetKey = String(body.key || '').trim().toUpperCase();
      if (!targetKey) {
        return res.status(400).json({ success: false, error: 'Thiếu mã key' });
      }
      let issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const beforeLen = issuedKeys.length;
      issuedKeys = issuedKeys.filter((item) => String(item.key || '').toUpperCase() !== targetKey);
      await dbSetJson('flowly:issued_keys', issuedKeys);
      return res.status(200).json({ success: true, deleted: beforeLen !== issuedKeys.length, key: targetKey });
    }

    if (action === 'change_hwid') {
      const targetKey = String(body.key || '').trim().toUpperCase();
      const newHwid = normalizeHwid(body.newHwid || '');
      if (!targetKey || !newHwid || newHwid.length < 4) {
        return res.status(400).json({ success: false, error: 'Thiếu mã Key hoặc HWID mới không hợp lệ' });
      }

      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const targetIdx = issuedKeys.findIndex((k) => String(k.key || '').toUpperCase() === targetKey);
      if (targetIdx < 0) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy mã key này trong danh sách đã cấp' });
      }

      const record = issuedKeys[targetIdx];
      const oldHwid = record.hwid;
      const appId = record.appId || 'all';
      const planCode = record.planCode || 'LIFE';
      const nonce4 = crypto.randomBytes(2).toString('hex').toUpperCase();
      const newKey = signProKey(appId, newHwid, planCode, nonce4);

      record.oldKey = targetKey;
      record.key = newKey;
      record.hwid = newHwid;
      if (!Array.isArray(record.oldKeys)) record.oldKeys = [];
      if (!record.oldKeys.includes(targetKey)) record.oldKeys.push(targetKey);
      if (!Array.isArray(record.hwids)) record.hwids = [oldHwid].filter(Boolean);
      if (!record.hwids.includes(newHwid)) record.hwids.push(newHwid);

      record.hwidChanges = (Number(record.hwidChanges || 0)) + 1;
      record.hwidHistory = [
        ...(Array.isArray(record.hwidHistory) ? record.hwidHistory : []),
        { oldHwid, newHwid, oldKey: targetKey, newKey, changedAtUtc: Date.now(), by: 'ADMIN', reason: body.reason || 'ADMIN_OVERRIDE' },
      ];
      issuedKeys[targetIdx] = record;
      await dbSetJson('flowly:issued_keys', issuedKeys);

      const orders = (await dbGetJson('flowly:orders', [])) || [];
      const orderIdx = orders.findIndex((o) => o.key === targetKey || o.hwid === oldHwid);
      if (orderIdx >= 0) {
        orders[orderIdx].oldKey = targetKey;
        orders[orderIdx].key = newKey;
        orders[orderIdx].oldHwid = oldHwid;
        orders[orderIdx].hwid = newHwid;
        if (!Array.isArray(orders[orderIdx].hwids)) orders[orderIdx].hwids = [oldHwid].filter(Boolean);
        if (!orders[orderIdx].hwids.includes(newHwid)) orders[orderIdx].hwids.push(newHwid);
        if (!Array.isArray(orders[orderIdx].oldKeys)) orders[orderIdx].oldKeys = [];
        if (!orders[orderIdx].oldKeys.includes(targetKey)) orders[orderIdx].oldKeys.push(targetKey);
        await dbSetJson('flowly:orders', orders);
      }

      await sendTelegram(
        `👑 <b>[ADMIN ĐỔI HWID THÀNH CÔNG]</b>\n\n` +
        `🔑 <b>Key:</b> <code>${targetKey}</code>\n` +
        `📟 <b>Cũ:</b> <code>${oldHwid}</code>\n` +
        `🆕 <b>Mới:</b> <code>${newHwid}</code>\n` +
        `📝 <b>Lý do:</b> ${body.reason || 'Admin duyệt'}`
      );

      return res.status(200).json({ success: true, oldHwid, newHwid, key: targetKey, message: `Đã đổi HWID thành công sang ${newHwid}` });
    }

    if (action === 'save_event_key') {
      const targetIds = resolveTargetAppIds(body);
      if (targetIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Sai appId (chọn 1 app hoặc all)' });
      }
      const active = Boolean(body.active);
      const rawKey = sanitizeKeyInput(body.key || '');
      const durationHours = Math.max(1, Number(body.duration_hours || body.durationHours || 72));
      // Mặc định expires_at_utc = 0 để mọi thiết bị dán key vào đều được hưởng trọn durationHours (3 ngày / tuần / tháng) tính từ lúc nhập
      const expiresAtUtc = Number(body.expires_at_utc || body.expiresAtUtc || 0);
      const durLabel = formatDurationLabel(durationHours);

      if (active && rawKey.length < 4) {
        return res.status(400).json({ success: false, error: 'Mã Key Event phải từ 4 ký tự trở lên' });
      }

      const currentMap = await getEventKeysMap();
      for (const id of targetIds) {
        const appName = APPS[id].name;
        const customTitle = String(body.title || '').trim();
        const customNotice = String(body.notice || '').trim();
        currentMap[id] = {
          active,
          key: rawKey,
          key_sha256: rawKey ? sha256Hex(rawKey) : '',
          duration_hours: durationHours,
          expires_at_utc: expiresAtUtc,
          title: customTitle || `🎁 Free Key PRO ${durLabel} • ${appName}`,
          notice: customNotice || (active ? `🎉 Sự Kiện Free Key PRO ${durLabel} (${appName})! Dán mã event để kích hoạt mọi thiết bị.` : ''),
          updated_at_utc: Date.now(),
        };
      }
      await dbSetJson('flowly:event_keys', currentMap);

      return res.status(200).json({
        success: true,
        targetApps: targetIds,
        appId: targetIds.length === 1 ? targetIds[0] : 'all',
        eventConfig: currentMap[targetIds[0]],
        eventKeys: currentMap,
      });
    }

    if (action === 'trigger_trial_reset') {
      const targetIds = resolveTargetAppIds(body);
      if (targetIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Sai appId (chọn 1 app hoặc all)' });
      }
      const durationHours = Math.max(1, Number(body.duration_hours || body.durationHours || 72));
      const durLabel = formatDurationLabel(durationHours);
      const nowUtc = Date.now();
      const resetId = `RST_${nowUtc.toString(36).toUpperCase()}_${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const windowExpiresUtc = Number(body.window_expires_at_utc || 0);
      const customTitle = String(body.title || '').trim();
      const customNotice = String(body.notice || '').trim();

      const currentResets = await getGlobalResetsMap();
      for (const id of targetIds) {
        const appName = APPS[id].name;
        currentResets[id] = {
          active: true,
          resetId,
          duration_hours: durationHours,
          title: customTitle || `🔄 Reset Day Free PRO ${durLabel} • ${appName}`,
          notice: customNotice || `🎁 Admin đã Reset Day tặng Free PRO ${durLabel} trên mọi thiết bị dùng ${appName}!`,
          triggered_at_utc: nowUtc,
          window_expires_at_utc: windowExpiresUtc,
        };
      }
      await dbSetJson('flowly:global_resets', currentResets);

      return res.status(200).json({
        success: true,
        resetId,
        targetApps: targetIds,
        durationHours,
        globalResets: currentResets,
      });
    }

    if (action === 'clear_trial_reset') {
      const targetIds = resolveTargetAppIds(body);
      if (targetIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Sai appId' });
      }
      const currentResets = await getGlobalResetsMap();
      for (const id of targetIds) {
        currentResets[id] = {
          ...(currentResets[id] || {}),
          active: false,
          resetId: '',
          notice: '',
        };
      }
      await dbSetJson('flowly:global_resets', currentResets);
      return res.status(200).json({ success: true, targetApps: targetIds, globalResets: currentResets });
    }

    if (action === 'toggle_trial_system') {
      const enabled = Boolean(body.enabled);
      await dbSetJson('flowly:trial_enabled', enabled);
      let currentResets = await getGlobalResetsMap();
      let currentEvents = await getEventKeysMap();
      if (!enabled) {
        for (const id of Object.keys(APPS)) {
          currentResets[id] = {
            ...(currentResets[id] || {}),
            active: false,
            resetId: '',
            notice: '',
          };
          currentEvents[id] = {
            ...(currentEvents[id] || {}),
            active: false,
            notice: '',
          };
        }
        await dbSetJson('flowly:global_resets', currentResets);
        await dbSetJson('flowly:event_keys', currentEvents);
      }
      return res.status(200).json({
        success: true,
        trialEnabled: enabled,
        globalResets: currentResets,
        eventKeys: currentEvents,
        message: enabled ? 'Đã bật Sự kiện Dùng Thử (Trial 72h)!' : 'Đã TẮT TOÀN BỘ Sự kiện Dùng Thử (Trial = 0h) và Reset Day!'
      });
    }

    if (action === 'disable_all_events') {
      await dbSetJson('flowly:trial_enabled', false);
      let currentResets = await getGlobalResetsMap();
      let currentEvents = await getEventKeysMap();
      for (const id of Object.keys(APPS)) {
        currentResets[id] = {
          ...(currentResets[id] || {}),
          active: false,
          resetId: '',
          notice: '',
        };
        currentEvents[id] = {
          ...(currentEvents[id] || {}),
          active: false,
          notice: '',
        };
      }
      await dbSetJson('flowly:global_resets', currentResets);
      await dbSetJson('flowly:event_keys', currentEvents);
      return res.status(200).json({
        success: true,
        trialEnabled: false,
        globalResets: currentResets,
        eventKeys: currentEvents,
        message: 'Đã tắt toàn bộ Key Event, Dùng Thử & Reset Day trên tất cả ứng dụng!'
      });
    }

    return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

