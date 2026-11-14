import {
  APPS,
  TRIAL_DURATION_MS,
  buildVietQrUrl,
  dbGetJson,
  dbSetJson,
  getBackendStatus,
  getEventKeysMap,
  getGlobalResetsMap,
  getRevokedKeysList,
  handlePreflight,
  loadStaticConfig,
  normalizeAppId,
  normalizeHwid,
  parseBody,
  sanitizeKeyInput,
  sendTelegram,
  sha256Hex,
  verifySignedKeyFormat,
} from './_shared.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;

  try {
    const body = req.method === 'POST' ? await parseBody(req) : {};
    const action = String(req.query?.action || body.action || 'checkin').trim().toLowerCase();
    const serverNowUtc = Date.now();
    const status = getBackendStatus();

    if (action === 'time') {
      return res.status(200).json({
        success: true,
        serverNowUtc,
        iso: new Date(serverNowUtc).toISOString(),
        ...status,
      });
    }

    const appId = normalizeAppId(req.query?.appId || req.query?.app || body.appId || body.app);
    const hwid = normalizeHwid(req.query?.hwid || body.hwid);
    const widevineHash = String(req.query?.widevineHash || body.widevineHash || '').trim().toUpperCase();
    const activeKey = sanitizeKeyInput(req.query?.activeKey || body.activeKey || body.key || '');
    const appVersionCode = Number(req.query?.versionCode || body.versionCode || 0);
    const deviceModel = String(req.query?.deviceModel || body.deviceModel || '').trim().slice(0, 80);
    const rawClientStart = Number(req.query?.clientTrialStartUtc || body.clientTrialStartUtc || 0);
    const validClientStart = rawClientStart > 1700000000000 && rawClientStart <= serverNowUtc ? rawClientStart : 0;

    if (!appId) {
      return res.status(400).json({ success: false, error: 'INVALID_APP_ID', serverNowUtc });
    }

    const staticCfg = loadStaticConfig();
    const appCfg = staticCfg[appId] || {};
    const eventKeysMap = await getEventKeysMap();
    const appEvent = eventKeysMap[appId] || { active: false };
    const globalResetsMap = await getGlobalResetsMap();
    const appReset = globalResetsMap[appId] || { active: false };
    const revokedKeys = await getRevokedKeysList();

    const eventKeyPlain = sanitizeKeyInput(appEvent.key || '');
    const eventKeySha256 = String(appEvent.key_sha256 || (eventKeyPlain ? sha256Hex(eventKeyPlain) : '')).toUpperCase();
    const sanitizedEvent = {
      active: Boolean(appEvent.active && eventKeySha256 && (!appEvent.expires_at_utc || serverNowUtc < Number(appEvent.expires_at_utc))),
      keySha256: eventKeySha256,
      durationHours: Number(appEvent.duration_hours || 72),
      expiresAtUtc: Number(appEvent.expires_at_utc || 0),
      title: String(appEvent.title || ''),
      notice: String(appEvent.notice || ''),
    };
    const sanitizedReset = {
      active: Boolean(appReset.active && appReset.resetId),
      resetId: String(appReset.resetId || ''),
      durationHours: Number(appReset.duration_hours || 72),
      title: String(appReset.title || ''),
      notice: String(appReset.notice || ''),
      triggeredAtUtc: Number(appReset.triggered_at_utc || 0),
    };

    const updateInfo = {
      version: appCfg.version || '',
      versionCode: Number(appCfg.version_code || 1),
      minVersionCode: Number(appCfg.min_version_code || 1),
      forceUpdate: Boolean(appCfg.force_update),
      updateUrl: appCfg.update_url || `https://zslowcuong.github.io/bio/?dl=${appId}#download`,
      changelog: appCfg.changelog || '',
    };

    if (action === 'checkin') {
      if (!hwid || hwid.length < 4) {
        return res.status(400).json({ success: false, error: 'MISSING_HWID', serverNowUtc });
      }

      const trialKey = `flowly:trial:${appId}:${hwid}`;
      let record = await dbGetJson(trialKey, null);
      let wdvRecord = null;
      const wdvStoreKey = widevineHash && widevineHash.length >= 8 ? `flowly:wdv:${appId}:${widevineHash}` : null;
      if (wdvStoreKey) {
        wdvRecord = await dbGetJson(wdvStoreKey, null);
      }

      if (!record) {
        let inheritedStart = wdvRecord?.trialStartUtc ? Number(wdvRecord.trialStartUtc) : serverNowUtc;
        let inheritedEnd = wdvRecord?.trialEndUtc ? Number(wdvRecord.trialEndUtc) : (inheritedStart + TRIAL_DURATION_MS);
        if (!wdvRecord && validClientStart > 0) {
          inheritedStart = Math.min(inheritedStart, validClientStart);
          inheritedEnd = inheritedStart + TRIAL_DURATION_MS;
        }
        record = {
          appId,
          hwid,
          widevineHash: widevineHash || '',
          deviceModel,
          firstVersionCode: appVersionCode || 1,
          lastVersionCode: appVersionCode || 1,
          trialStartUtc: inheritedStart,
          trialEndUtc: inheritedEnd,
          lastResetId: wdvRecord?.lastResetId || '',
          lastResetAtUtc: Number(wdvRecord?.lastResetAtUtc || 0),
          appliedResetIds: Array.isArray(wdvRecord?.appliedResetIds) ? [...wdvRecord.appliedResetIds] : [],
          firstSeenUtc: serverNowUtc,
          lastSeenUtc: serverNowUtc,
          installCount: (wdvRecord?.installCount || 0) + 1,
        };
      } else {
        const wdvResetAt = Number(wdvRecord?.lastResetAtUtc || 0);
        const recResetAt = Number(record.lastResetAtUtc || 0);
        const mergedResetIds = Array.from(new Set([
          ...(Array.isArray(record.appliedResetIds) ? record.appliedResetIds : []),
          ...(Array.isArray(wdvRecord?.appliedResetIds) ? wdvRecord.appliedResetIds : []),
        ]));

        let resolvedStart = Number(record.trialStartUtc || serverNowUtc);
        let resolvedEnd = Number(record.trialEndUtc || (resolvedStart + TRIAL_DURATION_MS));
        let resolvedResetId = record.lastResetId || '';
        let resolvedResetAt = recResetAt;

        if (wdvResetAt > recResetAt && wdvRecord?.trialStartUtc && wdvRecord?.trialEndUtc) {
          resolvedStart = Number(wdvRecord.trialStartUtc);
          resolvedEnd = Number(wdvRecord.trialEndUtc);
          resolvedResetId = wdvRecord.lastResetId || resolvedResetId;
          resolvedResetAt = wdvResetAt;
        } else if (mergedResetIds.length === 0) {
          if (wdvRecord?.trialStartUtc && Number(wdvRecord.trialStartUtc) < resolvedStart) {
            resolvedStart = Number(wdvRecord.trialStartUtc);
            resolvedEnd = Number(wdvRecord.trialEndUtc || (resolvedStart + TRIAL_DURATION_MS));
          }
          if (validClientStart > 0 && validClientStart < resolvedStart) {
            resolvedStart = validClientStart;
            resolvedEnd = validClientStart + TRIAL_DURATION_MS;
          }
        }

        record = {
          ...record,
          trialStartUtc: resolvedStart,
          trialEndUtc: resolvedEnd,
          lastResetId: resolvedResetId,
          lastResetAtUtc: resolvedResetAt,
          appliedResetIds: mergedResetIds,
          lastVersionCode: appVersionCode || record.lastVersionCode,
          deviceModel: deviceModel || record.deviceModel,
          lastSeenUtc: serverNowUtc,
        };
      }

      // Auto Reset Day: apply once per resetId across device (tracked on both hwid & widevineHash)
      let resetAppliedNow = false;
      const appliedIds = Array.isArray(record.appliedResetIds) ? [...record.appliedResetIds] : [];
      if (sanitizedReset.active && sanitizedReset.resetId && !appliedIds.includes(sanitizedReset.resetId)) {
        const resetDurMs = Math.max(1, sanitizedReset.durationHours) * 3600 * 1000;
        record.trialStartUtc = serverNowUtc;
        record.trialEndUtc = serverNowUtc + resetDurMs;
        record.lastResetId = sanitizedReset.resetId;
        record.lastResetAtUtc = serverNowUtc;
        record.lastResetHours = sanitizedReset.durationHours;
        appliedIds.push(sanitizedReset.resetId);
        record.appliedResetIds = appliedIds.slice(-30);
        resetAppliedNow = true;
      }

      await dbSetJson(trialKey, record);
      if (wdvStoreKey) {
        await dbSetJson(wdvStoreKey, {
          trialStartUtc: record.trialStartUtc,
          trialEndUtc: record.trialEndUtc,
          lastResetId: record.lastResetId || '',
          lastResetAtUtc: Number(record.lastResetAtUtc || 0),
          appliedResetIds: record.appliedResetIds || [],
          lastHwid: hwid,
          installCount: record.installCount,
          lastSeenUtc: serverNowUtc,
        });
      }

      const activeKeyRevoked = Boolean(activeKey && revokedKeys.includes(activeKey));

      // Check if this HWID has an issued non-revoked PRO key in server DB
      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const matchingPro = issuedKeys.find(
        (k) =>
          k &&
          (k.appId === appId || k.appId === 'all' || k.allApps === true || k.planCode === 'LIFE') &&
          k.hwid === hwid &&
          !k.revoked &&
          !revokedKeys.includes(String(k.key || '').toUpperCase()) &&
          (!k.expiryUtcMs || Number(k.expiryUtcMs) > serverNowUtc)
      );

      return res.status(200).json({
        success: true,
        appId,
        hwid,
        serverNowUtc,
        trialStartUtc: record.trialStartUtc,
        trialEndUtc: record.trialEndUtc,
        trialRemainingMs: Math.max(0, record.trialEndUtc - serverNowUtc),
        lastResetId: record.lastResetId || '',
        resetAppliedNow,
        activeKeyRevoked,
        revokedKeys,
        syncedProKey: matchingPro ? {
          key: matchingPro.key,
          planCode: matchingPro.planCode,
          expiryUtcMs: matchingPro.expiryUtcMs,
        } : null,
        eventConfig: sanitizedEvent,
        resetConfig: sanitizedReset,
        updateInfo,
        ...status,
      });
    }

    if (action === 'activate_key') {
      const key = activeKey;
      if (!key) {
        return res.status(400).json({ success: false, error: 'Thiếu Mã Key', reason: 'Vui lòng nhập Mã Key', serverNowUtc });
      }
      if (revokedKeys.includes(key)) {
        return res.status(403).json({ success: false, reason: 'Mã Key này đã bị Admin thu hồi!', revoked: true, serverNowUtc });
      }

      // 1) Check Per-App Event Key first (ZERO HWID lock — works on EVERY device)
      if (sanitizedEvent.active && sha256Hex(key) === sanitizedEvent.keySha256) {
        const deviceSlot = hwid || widevineHash || 'GLOBAL_DEVICE';
        const trialKey = `flowly:trial:${appId}:${deviceSlot}`;
        const existingRec = (await dbGetJson(trialKey, {})) || {};
        const prevEventClaims = existingRec.eventClaims || {};
        let expiryUtcMs = Number(prevEventClaims[sanitizedEvent.keySha256] || 0);
        if (!expiryUtcMs) {
          const durMs = Math.max(1, sanitizedEvent.durationHours) * 3600 * 1000;
          expiryUtcMs = serverNowUtc + durMs;
          if (sanitizedEvent.expiresAtUtc > 0) {
            expiryUtcMs = Math.min(expiryUtcMs, sanitizedEvent.expiresAtUtc);
          }
          prevEventClaims[sanitizedEvent.keySha256] = expiryUtcMs;
          await dbSetJson(trialKey, { ...existingRec, appId, hwid: deviceSlot, eventClaims: prevEventClaims, lastSeenUtc: serverNowUtc });
        }
        if (expiryUtcMs <= serverNowUtc) {
          return res.status(400).json({ success: false, reason: 'Thời gian sử dụng Key Sự Kiện này đã hết hạn trên thiết bị của bạn!', serverNowUtc });
        }
        return res.status(200).json({
          success: true,
          tier: 'PRO_EVENT',
          appId,
          hwid: deviceSlot,
          key,
          plan: `EVENT_${sanitizedEvent.durationHours}H`,
          expiryUtcMs,
          serverNowUtc,
          message: `Kích hoạt Key Sự Kiện PRO cho ${APPS[appId].name} (${sanitizedEvent.durationHours}h) thành công trên mọi thiết bị!`,
        });
      }

      if (!hwid) {
        return res.status(400).json({ success: false, error: 'Thiếu HWID thiết bị', reason: 'Thiếu HWID thiết bị', serverNowUtc });
      }

      // 2) Check cryptographically signed VIP / PRO key
      const verified = verifySignedKeyFormat(key, appId, hwid);
      if (!verified.valid) {
        return res.status(400).json({ success: false, reason: verified.reason, serverNowUtc });
      }

      // Also check if server issued_keys has authoritative expiry / revocation for PRO keys
      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const foundIssued = issuedKeys.find((k) => String(k.key || '').toUpperCase() === key);
      if (foundIssued && foundIssued.revoked) {
        return res.status(403).json({ success: false, reason: 'Mã Key này đã bị Admin thu hồi!', revoked: true, serverNowUtc });
      }

      let finalExpiryMs = verified.expiryUtcMs;
      if (foundIssued && foundIssued.expiryUtcMs) {
        finalExpiryMs = Number(foundIssued.expiryUtcMs);
      } else if (verified.tier === 'PRO_SHOP') {
        // Persist first activation of offline-minted PRO key so duration can't be extended by re-entering
        const isLifeComboSave = verified.isAllApps || verified.plan === 'LIFE';
        issuedKeys.unshift({
          key,
          appId: isLifeComboSave ? 'all' : appId,
          allApps: isLifeComboSave,
          hwid,
          planCode: verified.plan,
          planName: isLifeComboSave ? 'Gói Vĩnh Viễn Combo Full 4 App (99K)' : verified.plan,
          source: 'KEY_ACTIVATED',
          createdAtUtc: serverNowUtc,
          expiryUtcMs: finalExpiryMs,
          revoked: false,
        });
        await dbSetJson('flowly:issued_keys', issuedKeys.slice(0, 800));
      }

      if (finalExpiryMs <= serverNowUtc) {
        return res.status(400).json({ success: false, reason: 'Mã Key đã hết hạn!', serverNowUtc });
      }

      const isLifeCombo = verified.isAllApps || verified.plan === 'LIFE';
      return res.status(200).json({
        success: true,
        tier: verified.tier,
        appId: isLifeCombo ? 'all' : appId,
        isAllApps: isLifeCombo,
        hwid,
        key,
        plan: verified.plan,
        expiryUtcMs: finalExpiryMs,
        serverNowUtc,
        message: isLifeCombo
          ? 'Kích hoạt thành công Gói Vĩnh Viễn 99K (Mở khóa toàn bộ 4 app: FlowS, FlowUltra, FlowOp, FlowExtra)!'
          : (verified.tier === 'VIP_FREE'
              ? 'Kích hoạt Key VIP 30 Giờ (khóa 1 thiết bị) thành công!'
              : 'Kích hoạt Key PRO thành công!'),
      });
    }

        // 3) Action: verify_vip (Mở khóa tải trực tiếp 4 App không cần vượt link cho thành viên PRO)
    if (action === 'verify_vip') {
      const qKey = sanitizeKeyInput(body.key || req.query?.key || '');
      const qHwid = normalizeHwid(body.hwid || req.query?.hwid || '');

      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      let foundRecord = null;

      if (qKey) {
        foundRecord = issuedKeys.find((k) => String(k.key || '').toUpperCase() === qKey);
      }
      if (!foundRecord && qHwid) {
        foundRecord = issuedKeys.find(
          (k) =>
            k &&
            k.hwid === qHwid &&
            !k.revoked &&
            !revokedKeys.includes(String(k.key || '').toUpperCase()) &&
            (!k.expiryUtcMs || Number(k.expiryUtcMs) > serverNowUtc)
        );
      }

      // Check offline cryptographic signature if not in DB yet
      let isCryptValid = false;
      let cryptInfo = null;
      if (!foundRecord && qKey && qHwid) {
        for (const testApp of ['all', 'flowoptimize', 'flows', 'flowultra', 'flowextra']) {
          const v = verifySignedKeyFormat(qKey, testApp, qHwid);
          if (v.valid && (v.tier === 'PRO_SHOP' || v.plan === 'LIFE' || v.isLifetime)) {
            isCryptValid = true;
            cryptInfo = v;
            break;
          }
        }
      }

      if (foundRecord && !foundRecord.revoked && (!foundRecord.expiryUtcMs || Number(foundRecord.expiryUtcMs) > serverNowUtc)) {
        const isLife = foundRecord.planCode === 'LIFE' || foundRecord.allApps === true || foundRecord.appId === 'all';
        return res.status(200).json({
          success: true,
          isVip: true,
          key: foundRecord.key,
          appId: foundRecord.appId || 'all',
          plan: foundRecord.planCode || (isLife ? 'LIFE' : 'PRO'),
          planName: foundRecord.planName || (isLife ? 'Gói Vĩnh Viễn Combo Full 4 App (99K)' : 'Gói PRO'),
          hwid: foundRecord.hwid,
          hwidChanges: Number(foundRecord.hwidChanges || 0),
          isLifetime: isLife,
          expiresAtUtc: Number(foundRecord.expiryUtcMs || 4102444800000),
          serverNowUtc,
          directDownloads: {
            flowoptimize: {
              name: 'FlowOptimize Anime Edition (v1.8.0 PRO Suite)',
              directApk: 'https://zslowcuong.github.io/bio/FlowOptimize.apk',
              gofile: 'https://gofile.io/d/Vr3bEORd',
            },
            flows: {
              name: 'FlowS Gamer Tuner Edition (v1.4.0 PRO)',
              directApk: 'https://zslowcuong.github.io/bio/FlowS.apk',
              gofile: 'https://gofile.io/d/kzDVlE2G',
            },
            flowultra: {
              name: 'FlowUltra eSports Suite (v1.3.0 PRO)',
              directApk: 'https://zslowcuong.github.io/bio/FlowUltra.apk',
              gofile: 'https://gofile.io/d/p8GZrZNY',
            },
            flowextra: {
              name: 'FlowExtra Kaito Kid 1412 (v3.7 PRO Edition)',
              directApk: 'https://zslowcuong.github.io/bio/FlowExtra.apk',
              gofile: 'https://raw.githubusercontent.com/zslowcuong/bio/main/FlowExtra.apk',
            },
            tools: {
              shizuku: 'https://gofile.io/d/DkhZ4xaM',
              shizukunext: 'https://gofile.io/d/AdqIc0Gp',
              brotx: 'https://gofile.io/d/RaSXG0aV',
              toolpc: 'https://raw.githubusercontent.com/zslowcuong/bio/main/TU_DONG_KICH_HOAT_SHIZUKU_VA_CAI_APP.bat',
            }
          },
          message: '👑 Xác thực thành viên PRO thành công! Đã mở khóa link tải trực tiếp 4 app không cần vượt link.',
        });
      }

      if (isCryptValid && cryptInfo) {
        return res.status(200).json({
          success: true,
          isVip: true,
          key: qKey,
          appId: cryptInfo.isAllApps ? 'all' : (cryptInfo.appId || 'all'),
          plan: cryptInfo.plan || 'LIFE',
          planName: 'Gói PRO Đã Xác Thực Chữ Ký',
          hwid: qHwid,
          hwidChanges: 0,
          isLifetime: cryptInfo.isLifetime || false,
          expiresAtUtc: cryptInfo.expiryUtcMs || 4102444800000,
          serverNowUtc,
          directDownloads: {
            flowoptimize: { name: 'FlowOptimize', directApk: 'https://zslowcuong.github.io/bio/FlowOptimize.apk', gofile: 'https://gofile.io/d/Vr3bEORd' },
            flows: { name: 'FlowS', directApk: 'https://zslowcuong.github.io/bio/FlowS.apk', gofile: 'https://gofile.io/d/kzDVlE2G' },
            flowultra: { name: 'FlowUltra', directApk: 'https://zslowcuong.github.io/bio/FlowUltra.apk', gofile: 'https://gofile.io/d/p8GZrZNY' },
            flowextra: { name: 'FlowExtra', directApk: 'https://zslowcuong.github.io/bio/FlowExtra.apk', gofile: 'https://raw.githubusercontent.com/zslowcuong/bio/main/FlowExtra.apk' },
          },
          message: '👑 Xác thực thành viên PRO thành công!',
        });
      }

      return res.status(200).json({
        success: false,
        isVip: false,
        reason: 'Chưa tìm thấy bản quyền PRO cho Key hoặc Thiết bị này. Vui lòng nhập mã Key PRO hợp lệ hoặc mua gói tại Cửa Hàng!',
        serverNowUtc,
      });
    }

    // 4) Action: change_hwid (Hệ thống chuyển đổi HWID cho khách PRO: Miễn phí lần đầu, từ lần 2 thu 5.000đ bảo trì)
    if (action === 'change_hwid') {
      const qKey = sanitizeKeyInput(body.key || req.query?.key || '');
      const newHwid = normalizeHwid(body.newHwid || req.query?.newHwid || '');
      if (!qKey || !newHwid || newHwid.length < 4) {
        return res.status(400).json({ success: false, reason: 'Vui lòng cung cấp Mã Key PRO và HWID máy mới (tối thiểu 4 ký tự)!' });
      }

      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const targetIdx = issuedKeys.findIndex((k) => String(k.key || '').toUpperCase() === qKey);

      if (targetIdx < 0) {
        return res.status(404).json({ success: false, reason: 'Không tìm thấy thông tin Mã Key PRO này trên hệ thống máy chủ!' });
      }

      const record = issuedKeys[targetIdx];
      if (record.revoked) {
        return res.status(403).json({ success: false, reason: 'Mã Key này đã bị Admin thu hồi!' });
      }

      const oldHwid = record.hwid;
      if (oldHwid === newHwid) {
        return res.status(400).json({ success: false, reason: 'Mã HWID mới trùng với HWID hiện tại của máy!' });
      }

      const changesCount = Number(record.hwidChanges || 0);

      // ĐỔI LẦN ĐẦU TIÊN (changesCount === 0): HOÀN TOÀN MIỄN PHÍ 100%!
      if (changesCount === 0) {
        record.hwid = newHwid;
        record.hwidChanges = 1;
        record.hwidHistory = [
          ...(Array.isArray(record.hwidHistory) ? record.hwidHistory : []),
          { oldHwid, newHwid, changedAtUtc: serverNowUtc, fee: 0, reason: 'FREE_FIRST_MIGRATION' },
        ];
        issuedKeys[targetIdx] = record;
        await dbSetJson('flowly:issued_keys', issuedKeys);

        // Đồng bộ đơn hàng tương ứng
        const orders = (await dbGetJson('flowly:orders', [])) || [];
        const orderIdx = orders.findIndex((o) => o.key === qKey || o.hwid === oldHwid);
        if (orderIdx >= 0) {
          orders[orderIdx].hwid = newHwid;
          await dbSetJson('flowly:orders', orders);
        }

        await sendTelegram(
          `🔄 <b>[KHÁCH PRO ĐỔI HWID MIỄN PHÍ LẦN ĐẦU]</b>\n\n` +
          `🔑 <b>Key:</b> <code>${qKey}</code>\n` +
          `📱 <b>App:</b> ${record.appId || 'All'}\n` +
          `📟 <b>HWID cũ:</b> <code>${oldHwid}</code>\n` +
          `🆕 <b>HWID mới:</b> <code>${newHwid}</code>\n` +
          `✅ <i>Hệ thống đã tự động chuyển đổi bản quyền sang máy mới miễn phí 100%!</i>`
        );

        return res.status(200).json({
          success: true,
          free: true,
          oldHwid,
          newHwid,
          hwidChanges: 1,
          message: `🎉 Đổi thiết bị thành công miễn phí lần đầu! Bản quyền PRO đã được chuyển sang máy ${newHwid}.`,
        });
      }

      // TỪ LẦN THỨ 2 TRỞ ĐI: THU PHÍ BẢO TRÌ 5.000đ (THEO CAM KẾT VỚI ADMIN)
      const num6 = String(Math.floor(100000 + Math.random() * 900000));
      const changeOrderCode = `CHG${num6}`;
      const changeMemo = `FLOW${num6}`;
      const qrUrl = buildVietQrUrl(5000, changeMemo);

      const changeReqs = (await dbGetJson('flowly:hwid_change_requests', [])) || [];
      const newReq = {
        orderCode: changeOrderCode,
        memo: changeMemo,
        key: qKey,
        oldHwid,
        newHwid,
        price: 5000,
        status: 'PENDING',
        createdAtUtc: serverNowUtc,
        createdAt: new Date(serverNowUtc).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      };
      changeReqs.unshift(newReq);
      await dbSetJson('flowly:hwid_change_requests', changeReqs.slice(0, 300));

      await sendTelegram(
        `💳 <b>[YÊU CẦU ĐỔI HWID LẦN THỨ ${changesCount + 1}]</b>\n\n` +
        `📦 <b>Mã đơn:</b> <code>${changeOrderCode}</code>\n` +
        `💬 <b>Nội dung CK:</b> <code>${changeMemo}</code>\n` +
        `💰 <b>Phí bảo trì:</b> <b>5.000đ</b>\n` +
        `🔑 <b>Key:</b> <code>${qKey}</code>\n` +
        `📟 <b>Cũ:</b> <code>${oldHwid}</code> ➔ 🆕 <b>Mới:</b> <code>${newHwid}</code>`
      );

      return res.status(200).json({
        success: false,
        requiresFee: true,
        fee: 5000,
        changesCount,
        message: 'Bạn đã sử dụng lượt đổi thiết bị miễn phí lần đầu. Phí bảo trì chuyển đổi thiết bị từ lần thứ 2 là 5.000đ/lần.',
        order: {
          orderCode: changeOrderCode,
          memo: changeMemo,
          price: 5000,
          qrUrl,
          key: qKey,
          oldHwid,
          newHwid,
        },
      });
    }

    return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION', serverNowUtc });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

