import crypto from 'node:crypto';
import {
  APPS,
  PLANS,
  completeOrderWithProKey,
  dbGetJson,
  dbSetJson,
  getBackendStatus,
  getEventKeysMap,
  getRevokedKeysList,
  handlePreflight,
  isAdminAuthorized,
  normalizeAppId,
  normalizeHwid,
  parseBody,
  sha256Hex,
  signProKey,
} from './_shared.js';

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
      return res.status(200).json({
        success: true,
        orders,
        issuedKeys,
        revokedKeys,
        eventKeys,
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

      const order = {
        orderCode,
        memo: orderCode,
        appId,
        appName: APPS[appId].name,
        hwid,
        planCode,
        planName: plan.name,
        price: plan.price,
        phone,
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

    if (action === 'save_event_key') {
      const appId = normalizeAppId(body.appId);
      if (!appId) {
        return res.status(400).json({ success: false, error: 'Sai appId' });
      }
      const active = Boolean(body.active);
      const rawKey = String(body.key || '').trim().toUpperCase();
      const durationHours = Math.max(1, Number(body.duration_hours || body.durationHours || 24));
      const expiresAtUtc = Number(body.expires_at_utc || body.expiresAtUtc || (active ? Date.now() + durationHours * 3600 * 1000 : 0));
      const title = String(body.title || `🎁 Sự Kiện PRO ${APPS[appId].name}`).trim();
      const notice = String(body.notice || '').trim();

      if (active && rawKey.length < 6) {
        return res.status(400).json({ success: false, error: 'Mã Key Sự Kiện phải từ 6 ký tự trở lên' });
      }

      const currentMap = await getEventKeysMap();
      currentMap[appId] = {
        active,
        key: rawKey,
        key_sha256: rawKey ? sha256Hex(rawKey) : '',
        duration_hours: durationHours,
        expires_at_utc: expiresAtUtc,
        title,
        notice,
        updated_at_utc: Date.now(),
      };
      await dbSetJson('flowly:event_keys', currentMap);

      return res.status(200).json({ success: true, appId, eventConfig: currentMap[appId], eventKeys: currentMap });
    }

    return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION' });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

