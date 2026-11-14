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
      return res.status(200).json({
        success: true,
        orders,
        issuedKeys,
        revokedKeys,
        eventKeys,
        globalResets,
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
        appName: isLifeCombo ? 'Combo 4 App (FlowOp, FlowS, FlowUltra, FlowExtra)' : APPS[appId].name,
        hwid,
        planCode,
        planName: isLifeCombo ? 'Gói Vĩnh Viễn Combo Full 4 App (99K)' : plan.name,
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
      record.hwid = newHwid;
      record.hwidChanges = (Number(record.hwidChanges || 0)) + 1;
      record.hwidHistory = [
        ...(Array.isArray(record.hwidHistory) ? record.hwidHistory : []),
        { oldHwid, newHwid, changedAtUtc: Date.now(), by: 'ADMIN', reason: body.reason || 'ADMIN_OVERRIDE' },
      ];
      issuedKeys[targetIdx] = record;
      await dbSetJson('flowly:issued_keys', issuedKeys);

      const orders = (await dbGetJson('flowly:orders', [])) || [];
      const orderIdx = orders.findIndex((o) => o.key === targetKey || o.hwid === oldHwid);
      if (orderIdx >= 0) {
        orders[orderIdx].hwid = newHwid;
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
          notice: '',
        };
      }
      await dbSetJson('flowly:global_resets', currentResets);
      return res.status(200).json({ success: true, targetApps: targetIds, globalResets: currentResets });
    }

    return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

