import crypto from 'node:crypto';
import {
  APPS,
  BANK_CONFIG,
  TRIAL_DURATION_MS,
  getTrialEnabled,
  buildVietQrUrl,
  completeHwidChangeRequest,
  dbGetJson,
  dbSetJson,
  dbHsetJson,
  dbSetNx,
  getBackendStatus,
  getEventKeysMap,
  getGlobalResetsMap,
  getRevokedKeysList,
  handlePreflight,
  loadStaticConfig,
  normalizeAppId,
  normalizeHwid,
  normalizeTextForMatch,
  parseBody,
  sanitizeKeyInput,
  sendTelegram,
  sha256Hex,
  signProKey,
  verifySignedKeyFormat,
} from './_shared.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  try {
    const body = req.method === 'POST' ? await parseBody(req) : {};
    const action = String(req.query?.action || body.action || 'checkin').trim().toLowerCase();
    const serverNowUtc = Date.now();
    const status = getBackendStatus();

    if (action === 'mint_vip') {
      const targetAppId = normalizeAppId(req.query?.appId || req.query?.app || body.appId || body.app);
      const targetHwid = normalizeHwid(req.query?.hwid || body.hwid);
      if (!targetHwid || targetHwid.length < 4) {
        return res.status(400).json({ success: false, error: 'MISSING_HWID', serverNowUtc });
      }

      // Atomic Rate Limit: 60s per HWID
      const rateLimitKey = `flowly:mint_vip_rate:${targetHwid}`;
      const canMint = await dbSetNx(rateLimitKey, '1', 60);
      if (!canMint) {
        return res.status(429).json({
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Thao tác quá nhanh! Vui lòng đợi 60 giây trước khi nhận key tiếp theo.',
          serverNowUtc
        });
      }
      const targetApp = targetAppId === 'flowmax' ? APPS['flowextra'] : (APPS[targetAppId] || APPS['flowoptimize']);
      const expiryMs = serverNowUtc + 30 * 3600 * 1000;
      const expirySec = Math.floor(expiryMs / 1000);
      const expiryHex = expirySec.toString(16).toUpperCase();
      const sigInput = `${targetApp.prefix}:VIP:${targetHwid}:${expirySec}:${targetApp.salt}`;
      const hashHex = sha256Hex(sigInput).toUpperCase();
      const sig8 = hashHex.slice(0, 8);
      const vipKey = `${targetApp.prefix}-VIP-${targetHwid}-${expiryHex}-${sig8}`;

      return res.status(200).json({
        success: true,
        key: vipKey,
        appId: targetApp.id,
        appName: targetApp.name,
        hwid: targetHwid,
        durationHours: 30,
        expiresAtUtc: expiryMs,
        serverNowUtc,
        ...status,
      });
    }

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
    const rawAppEvent = eventKeysMap[appId] || { active: false };
    const rawAllEvent = eventKeysMap['all'] || { active: false };
    const appEvent = (rawAppEvent && rawAppEvent.active) ? rawAppEvent : ((rawAllEvent && rawAllEvent.active) ? rawAllEvent : rawAppEvent);
    const globalResetsMap = await getGlobalResetsMap();
    const rawAppReset = globalResetsMap[appId] || { active: false };
    const rawAllReset = globalResetsMap['all'] || { active: false };
    const appReset = (rawAppReset && rawAppReset.active) ? rawAppReset : ((rawAllReset && rawAllReset.active) ? rawAllReset : rawAppReset);
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

    // ==============================================================
    // 🛡️ ANTI-CRACK & MANDATORY FORCE UPDATE KILLSWITCH
    // Khóa triệt để toàn bộ bản crack ("Sikibidi Mod") & bản cũ < minVersionCode
    // ==============================================================
    const crackPattern = /sikibidi|modzzz|vip_mod|crack|hacked|modded|free_pro/i;
    const isKnownCrack = (
      crackPattern.test(activeKey) ||
      crackPattern.test(deviceModel) ||
      crackPattern.test(hwid) ||
      activeKey.toUpperCase() === 'SIKIBIDI_MOD'
    );

    const isAppClient = (action === 'checkin' || action === 'activate_key');
    const minAllowedVer = Number(appCfg.min_version_code || 1);
    const isOutdated = Boolean(
      isAppClient && (
        (appCfg.force_update && (Number(appVersionCode || 0) < minAllowedVer)) ||
        (minAllowedVer > 1 && (!appVersionCode || Number(appVersionCode) < minAllowedVer))
      )
    );

    if (isAppClient && (isKnownCrack || isOutdated)) {
      return res.status(200).json({
        success: false,
        blocked: true,
        forceUpdate: true,
        canUseSystem: false,
        error: isKnownCrack ? 'CRACK_MOD_BLOCKED' : 'OUTDATED_VERSION_BLOCKED',
        reason: isKnownCrack
          ? '⚠️ PHÁT HIỆN BẢN CRACK TRÁI PHÉP ("SIKIBIDI MOD") ĐÃ BỊ VÔ HIỆU HÓA HOÀN TOÀN!\nToàn bộ quyền truy cập và tính năng tối ưu Shizuku đã bị khóa vĩnh viễn.\nVui lòng gỡ bỏ bản crack và tải bản chính thức miễn phí tại: https://zslowcuong.github.io/bio/'
          : `⚠️ BẢN CŨ ĐÃ HẾT HẠN - BẮT BUỘC CẬP NHẬT!\nPhiên bản bạn đang sử dụng (${appVersionCode ? 'v' + appVersionCode : 'bản cũ'}) đã bị đóng để bảo vệ an toàn hệ thống.\nVui lòng cập nhật lên ${appCfg.name || 'bản mới'} (${appCfg.version || 'mới nhất'}) để tiếp tục sử dụng miễn phí!`,
        updateInfo: {
          ...updateInfo,
          forceUpdate: true,
          mustUpdateImmediately: true,
        },
        trialRemainingMs: 0,
        tier: 'BLOCKED_OUTDATED',
        serverNowUtc,
        ...status,
      });
    }

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

      // Master device slot to synchronize 3-day trial across all 5 apps (FlowS, FlowUltra, FlowExtra, FlowOp, FlowZ)
      const masterSlot = widevineHash && widevineHash.length >= 8 ? widevineHash : hwid;
      const masterTrialKey = `flowly:master_trial:${masterSlot}`;
      const masterRecord = await dbGetJson(masterTrialKey, null);

      const trialEnabled = await getTrialEnabled();
      const trialDurationMs = trialEnabled ? (TRIAL_DURATION_MS || (72 * 3600 * 1000)) : 0;

      if (!record) {
        let inheritedStart = trialEnabled
          ? (masterRecord?.trialStartUtc ? Number(masterRecord.trialStartUtc) : (wdvRecord?.trialStartUtc ? Number(wdvRecord.trialStartUtc) : serverNowUtc))
          : 0;
        let inheritedEnd = trialEnabled
          ? (masterRecord?.trialEndUtc ? Number(masterRecord.trialEndUtc) : (wdvRecord?.trialEndUtc ? Number(wdvRecord.trialEndUtc) : (inheritedStart + trialDurationMs)))
          : 0;
        if (trialEnabled && !masterRecord && !wdvRecord && validClientStart > 0) {
          inheritedStart = Math.min(inheritedStart, validClientStart);
          inheritedEnd = inheritedStart + trialDurationMs;
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
          lastResetId: masterRecord?.lastResetId || wdvRecord?.lastResetId || '',
          lastResetAtUtc: Number(masterRecord?.lastResetAtUtc || wdvRecord?.lastResetAtUtc || 0),
          appliedResetIds: Array.isArray(masterRecord?.appliedResetIds) ? [...masterRecord.appliedResetIds] : (Array.isArray(wdvRecord?.appliedResetIds) ? [...wdvRecord.appliedResetIds] : []),
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
      await dbSetJson(masterTrialKey, {
        trialStartUtc: record.trialStartUtc,
        trialEndUtc: record.trialEndUtc,
        lastResetId: record.lastResetId || '',
        lastResetAtUtc: Number(record.lastResetAtUtc || 0),
        appliedResetIds: record.appliedResetIds || [],
        lastHwid: hwid,
        lastSeenUtc: serverNowUtc,
      });
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

      // Check if this HWID (or same physical device widevineHash) has an issued non-revoked PRO key in server DB
      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const matchingPro = issuedKeys.find(
        (k) =>
          k &&
          ((k.appId === appId) ||
            (appId === 'flowmax' && (k.appId === 'flowextra' || k.appId === 'flowultra')) ||
            k.appId === 'all' ||
            k.allApps === true) &&
          (
            normalizeHwid(k.hwid) === hwid ||
            (Array.isArray(k.hwids) && k.hwids.some((h) => normalizeHwid(h) === hwid)) ||
            (widevineHash && widevineHash.length >= 8 && (
              k.widevineHash === widevineHash ||
              (Array.isArray(k.widevineHashes) && k.widevineHashes.includes(widevineHash))
            ))
          ) &&
          !k.revoked &&
          !revokedKeys.includes(String(k.key || '').toUpperCase()) &&
          (!k.expiryUtcMs || Number(k.expiryUtcMs) > serverNowUtc)
      );

      // Auto-link same physical device (widevineHash <-> hwid across different app versions)
      if (matchingPro) {
        let proDirty = false;
        if (widevineHash && widevineHash.length >= 8) {
          if (!matchingPro.widevineHash) {
            matchingPro.widevineHash = widevineHash;
            proDirty = true;
          }
          if (!Array.isArray(matchingPro.widevineHashes)) matchingPro.widevineHashes = [];
          if (!matchingPro.widevineHashes.includes(widevineHash)) {
            matchingPro.widevineHashes.push(widevineHash);
            proDirty = true;
          }
        }
        if (hwid) {
          if (!Array.isArray(matchingPro.hwids)) matchingPro.hwids = [matchingPro.hwid].filter(Boolean);
          if (!matchingPro.hwids.some((h) => normalizeHwid(h) === hwid)) {
            matchingPro.hwids.push(hwid);
            proDirty = true;
          }
        }
        if (proDirty) {
          await dbSetJson('flowly:issued_keys', issuedKeys.slice(0, 800));
        }
      }

      const effectiveTrialRemainingMs = trialEnabled ? Math.max(0, (record.trialEndUtc || 0) - serverNowUtc) : 0;

      return res.status(200).json({
        success: true,
        appId,
        hwid,
        serverNowUtc,
        trialEnabled: Boolean(trialEnabled),
        trialStartUtc: trialEnabled ? record.trialStartUtc : 0,
        trialEndUtc: trialEnabled ? record.trialEndUtc : 0,
        trialRemainingMs: effectiveTrialRemainingMs,
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

      // 2) Check cryptographically signed VIP / PRO key (allow migrated HWID verification via issued_keys)
      const verified = verifySignedKeyFormat(key, appId, hwid, { ignoreHwidMismatch: true });
      if (!verified.valid) {
        return res.status(400).json({ success: false, reason: verified.reason, serverNowUtc });
      }

      // Check server issued_keys (including migrated oldKey / oldKeys and same-device widevineHash)
      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const foundIssued = issuedKeys.find((k) => {
        if (!k) return false;
        const kKey = String(k.key || '').toUpperCase();
        const kOld = String(k.oldKey || '').toUpperCase();
        const kOlds = Array.isArray(k.oldKeys) ? k.oldKeys.map((x) => String(x || '').toUpperCase()) : [];
        return kKey === key || kOld === key || kOlds.includes(key);
      });
      if (foundIssued && (foundIssued.revoked || revokedKeys.includes(String(foundIssued.key || '').toUpperCase()))) {
        return res.status(403).json({ success: false, reason: 'Mã Key này đã bị Admin thu hồi!', revoked: true, serverNowUtc });
      }

      // If key string HWID != current app HWID, allow if server DB already migrated to this HWID or matches same physical widevineHash
      if (verified.hwidMatched === false) {
        const dbAuthorizesHwid = Boolean(
          foundIssued && (
            normalizeHwid(foundIssued.hwid) === hwid ||
            (Array.isArray(foundIssued.hwids) && foundIssued.hwids.some((h) => normalizeHwid(h) === hwid)) ||
            (widevineHash && widevineHash.length >= 8 && (
              foundIssued.widevineHash === widevineHash ||
              (Array.isArray(foundIssued.widevineHashes) && foundIssued.widevineHashes.includes(widevineHash))
            ))
          )
        );
        if (!dbAuthorizesHwid) {
          return res.status(400).json({
            success: false,
            reason: `Key này chỉ được kích hoạt trên 1 thiết bị (${verified.keyOriginHwid}), không khớp với máy hiện tại (${hwid})!`,
            serverNowUtc,
          });
        }
      }

      let finalExpiryMs = verified.expiryUtcMs;
      let resolvedKey = key;
      const isLifeComboSave = Boolean(verified.isAllApps);
      if (foundIssued) {
        if (foundIssued.expiryUtcMs) {
          finalExpiryMs = Number(foundIssued.expiryUtcMs);
        }
        if (foundIssued.key && normalizeHwid(foundIssued.hwid) === hwid) {
          resolvedKey = String(foundIssued.key).toUpperCase();
        }
        let dirty = false;
        if (!Array.isArray(foundIssued.hwids)) {
          foundIssued.hwids = [foundIssued.hwid].filter(Boolean);
          dirty = true;
        }
        if (hwid && !foundIssued.hwids.some((h) => normalizeHwid(h) === hwid)) {
          foundIssued.hwids.push(hwid);
          dirty = true;
        }
        if (widevineHash && widevineHash.length >= 8) {
          if (!foundIssued.widevineHash) {
            foundIssued.widevineHash = widevineHash;
            dirty = true;
          }
          if (!Array.isArray(foundIssued.widevineHashes)) foundIssued.widevineHashes = [];
          if (!foundIssued.widevineHashes.includes(widevineHash)) {
            foundIssued.widevineHashes.push(widevineHash);
            dirty = true;
          }
        }
        if (dirty || isLifeComboSave) {
          foundIssued.lastActivatedAtUtc = serverNowUtc;
          await dbSetJson('flowly:issued_keys', issuedKeys.slice(0, 800));
        }
      } else if (verified.tier === 'PRO_SHOP') {
        // Persist first activation of offline-minted PRO key so duration can't be extended by re-entering
        const durText = verified.plan === 'LIFE'
          ? 'Vĩnh Viễn Trọn Đời'
          : (verified.plan === '1Y' || verified.plan === '365D'
              ? '12 Tháng (365 Ngày)'
              : (verified.plan === '90D'
                  ? '3 Tháng (90 Ngày)'
                  : (verified.plan === '30D'
                      ? '30 Ngày (1 Tháng)'
                      : (verified.plan === '1D' ? '1 Ngày (24 Giờ)' : '7 Ngày'))));
        issuedKeys.unshift({
          key,
          appId: isLifeComboSave ? 'all' : appId,
          allApps: isLifeComboSave,
          hwid,
          hwids: [hwid, verified.keyOriginHwid].filter(Boolean),
          widevineHash: widevineHash || undefined,
          widevineHashes: widevineHash ? [widevineHash] : undefined,
          planCode: verified.plan,
          planName: isLifeComboSave
            ? `Gói ${durText} Combo Full 5 App`
            : `Gói ${durText} Đơn App (${APPS[appId].name})`,
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

      const isLifeCombo = Boolean(verified.isAllApps);
      let activatedMsg = 'Kích hoạt Key PRO thành công!';
      if (isLifeCombo) {
        if (verified.plan === 'LIFE') {
          activatedMsg = 'Kích hoạt thành công Gói Vĩnh Viễn Full Bảo Hành Trọn Đời (Full 5 App: FlowZ, FlowOptimize, FlowS, FlowMax, FlowCore)!';
        } else if (verified.plan === '1Y' || verified.plan === '365D') {
          activatedMsg = 'Kích hoạt thành công Gói 12 Tháng 365 Ngày (Mở khóa toàn bộ 5 App: FlowZ, FlowOptimize, FlowS, FlowMax, FlowCore)!';
        } else if (verified.plan === '90D') {
          activatedMsg = 'Kích hoạt thành công Gói 3 Tháng 90 Ngày (Mở khóa toàn bộ 5 App: FlowZ, FlowOptimize, FlowS, FlowMax, FlowCore)!';
        } else if (verified.plan === '30D') {
          activatedMsg = 'Kích hoạt thành công Gói 30 Ngày (Mở khóa toàn bộ 5 App: FlowZ, FlowOptimize, FlowS, FlowMax, FlowCore)!';
        } else if (verified.plan === '7D') {
          activatedMsg = 'Kích hoạt thành công Gói 7 Ngày (Mở khóa toàn bộ 5 App: FlowZ, FlowOptimize, FlowS, FlowMax, FlowCore)!';
        } else if (verified.plan === '1D') {
          activatedMsg = 'Kích hoạt thành công Gói 1 Ngày 24 Giờ (Mở khóa toàn bộ 5 App: FlowZ, FlowOptimize, FlowS, FlowMax, FlowCore)!';
        } else {
          activatedMsg = 'Kích hoạt thành công Key Combo Full 5 App FlowEngine!';
        }
      } else if (verified.tier === 'VIP_FREE') {
        activatedMsg = 'Kích hoạt Key VIP 30 Giờ (khóa 1 thiết bị) thành công!';
      } else if (verified.tier === 'PRO_SHOP') {
        const singleLabel = verified.plan === 'LIFE'
          ? 'Vĩnh Viễn'
          : ((verified.plan === '365D' || verified.plan === '1Y')
              ? '12 Tháng'
              : (verified.plan === '90D' ? '3 Tháng' : (verified.plan === '30D' ? '1 Tháng' : '7 Ngày')));
        activatedMsg = `Kích hoạt thành công Key ${singleLabel} Đơn App (${APPS[appId].name})!`;
      }

      return res.status(200).json({
        success: true,
        tier: verified.tier,
        appId: isLifeCombo ? 'all' : appId,
        isAllApps: isLifeCombo,
        hwid,
        key: resolvedKey,
        plan: verified.plan,
        expiryUtcMs: finalExpiryMs,
        serverNowUtc,
        message: activatedMsg,
      });
    }

    // 3) Action: verify_vip (Mở khóa tải trực tiếp 4 App không cần vượt link cho thành viên PRO)
    if (action === 'verify_vip') {
      const rawQ = String(req.query?.q || body.q || '').trim();
      const inKey = String(body.key || req.query?.key || '').trim();
      const inHwid = String(body.hwid || req.query?.hwid || '').trim();
      const inPhone = String(body.phone || req.query?.phone || '').trim();
      const inOrder = String(body.order || req.query?.order || '').trim();

      // Tập hợp tất cả các chuỗi tìm kiếm có thể người dùng nhập vào (chống trường hợp nhập nhầm ô)
      const rawCandidates = [rawQ, inKey, inHwid, inPhone, inOrder].filter(Boolean);
      const searchTokens = Array.from(new Set(rawCandidates));

      const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
      const orders = (await dbGetJson('flowly:orders', [])) || [];

      let foundRecord = null;
      let matchedOrder = null;

      // 1. Thử tìm trong issued_keys theo Key, HWID, hoặc Số điện thoại
      for (const token of searchTokens) {
        const tokenUpper = token.toUpperCase();
        const tokenKey = sanitizeKeyInput(token);
        const tokenHwid = normalizeHwid(token);
        const tokenPhone = token.replace(/[^0-9]/g, '');

        foundRecord = issuedKeys.find((k) => {
          if (!k) return false;
          if (k.revoked || revokedKeys.includes(String(k.key || '').toUpperCase())) return false;
          if (k.expiryUtcMs && Number(k.expiryUtcMs) <= serverNowUtc) return false;

          const kKey = String(k.key || '').toUpperCase();
          const kHwid = String(k.hwid || '').toUpperCase();
          const kPhone = String(k.phone || '').replace(/[^0-9]/g, '');

          if (tokenKey && (kKey === tokenKey || String(k.oldKey || '').toUpperCase() === tokenKey || (Array.isArray(k.oldKeys) && k.oldKeys.some(ok => String(ok).toUpperCase() === tokenKey)))) return true;
          if (tokenHwid && tokenHwid.length >= 4 && (kHwid === tokenHwid || String(k.oldHwid || '').toUpperCase() === tokenHwid || (Array.isArray(k.hwids) && k.hwids.includes(tokenHwid)))) return true;
          if (tokenPhone && tokenPhone.length >= 8 && (kPhone === tokenPhone || kPhone.includes(tokenPhone))) return true;
          return false;
        });

        if (foundRecord) break;
      }

      // 2. Nếu chưa thấy trong issued_keys, tìm trong flowly:orders (đơn hàng đã hoàn thành COMPLETED)
      if (!foundRecord) {
        for (const token of searchTokens) {
          const tokenUpper = token.toUpperCase();
          const tokenKey = sanitizeKeyInput(token);
          const tokenHwid = normalizeHwid(token);
          const tokenPhone = token.replace(/[^0-9]/g, '');

          matchedOrder = orders.find((o) => {
            if (!o || o.status !== 'COMPLETED') return false;
            if (o.key && revokedKeys.includes(String(o.key || '').toUpperCase())) return false;
            if (o.expiryUtcMs && Number(o.expiryUtcMs) <= serverNowUtc) return false;

            const oCode = String(o.orderCode || '').toUpperCase();
            const oMemo = String(o.memo || '').toUpperCase();
            const oKey = String(o.key || '').toUpperCase();
            const oHwid = String(o.hwid || '').toUpperCase();
            const oPhone = String(o.phone || '').replace(/[^0-9]/g, '');

            if (oCode === tokenUpper) return true;
            if (oMemo === tokenUpper) return true;
            if (tokenKey && (oKey === tokenKey || String(o.oldKey || '').toUpperCase() === tokenKey || (Array.isArray(o.oldKeys) && o.oldKeys.some(ok => String(ok).toUpperCase() === tokenKey)))) return true;
            if (tokenHwid && tokenHwid.length >= 4 && (oHwid === tokenHwid || String(o.oldHwid || '').toUpperCase() === tokenHwid || (Array.isArray(o.hwids) && o.hwids.includes(tokenHwid)))) return true;
            if (tokenPhone && tokenPhone.length >= 8 && (oPhone === tokenPhone || oPhone.includes(tokenPhone))) return true;
            return false;
          });

          if (matchedOrder) break;
        }

        if (matchedOrder) {
          // Tìm record tương ứng trong issued_keys hoặc dựng từ matchedOrder
          foundRecord = issuedKeys.find((k) => k && k.key === matchedOrder.key) || {
            key: matchedOrder.key,
            appId: matchedOrder.appId || 'all',
            planCode: matchedOrder.planCode || (matchedOrder.allApps ? 'LIFE' : 'PRO'),
            planName: matchedOrder.planName || 'Gói PRO Đã Kích Hoạt',
            hwid: matchedOrder.hwid,
            phone: matchedOrder.phone,
            hwidChanges: 0,
            allApps: matchedOrder.allApps ?? true,
            expiryUtcMs: matchedOrder.expiryUtcMs || 4102444800000,
          };
        }
      }

      // 3. Fallback chữ ký mật mã offline nếu có cả Key và HWID
      let isCryptValid = false;
      let cryptInfo = null;
      if (!foundRecord) {
        for (const tokenA of searchTokens) {
          for (const tokenB of searchTokens) {
            if (tokenA === tokenB) continue;
            const tKey = sanitizeKeyInput(tokenA);
            const tHwid = normalizeHwid(tokenB);
            if (tKey && tHwid && tHwid.length >= 4) {
              for (const testApp of ['all', 'flowz', 'flowoptimize', 'flows', 'flowmax', 'flowultra', 'flowextra', 'flowcore']) {
                const v = verifySignedKeyFormat(tKey, testApp, tHwid);
                if (v.valid && (v.tier === 'PRO_SHOP' || v.plan === 'LIFE' || v.isLifetime)) {
                  isCryptValid = true;
                  cryptInfo = { ...v, key: tKey, hwid: tHwid };
                  break;
                }
              }
              if (isCryptValid) break;
            }
          }
          if (isCryptValid) break;
        }
      }

      if (foundRecord && !foundRecord.revoked && (!foundRecord.expiryUtcMs || Number(foundRecord.expiryUtcMs) > serverNowUtc)) {
        const isComboAll = foundRecord.allApps === true || foundRecord.appId === 'all' || String(foundRecord.key || '').startsWith('FLOWALL-');
        const isLife = foundRecord.planCode === 'LIFE';
        return res.status(200).json({
          success: true,
          isVip: true,
          allApps: isComboAll,
          key: foundRecord.key,
          appId: foundRecord.appId || 'all',
          plan: foundRecord.planCode || (isLife ? 'LIFE' : 'PRO'),
          planName: foundRecord.planName || (isComboAll ? 'Gói Combo Full 5 App FlowEngine' : 'Gói PRO Đơn App'),
          hwid: foundRecord.hwid,
          phone: foundRecord.phone || '',
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
            flowz: {
              name: 'FlowZ VIP Headshot & Sensitivity Pro (Quà tặng kèm PRO)',
              directApk: 'https://zslowcuong.github.io/bio/FlowZ.apk',
              gofile: 'https://raw.githubusercontent.com/zslowcuong/bio/main/FlowZ.apk',
              giftNotice: '🎁 Tặng kèm miễn phí dành riêng cho khách hàng mua KEY PRO!'
            },
            tools: {
              shizuku: 'https://gofile.io/d/DkhZ4xaM',
              shizukunext: 'https://gofile.io/d/AdqIc0Gp',
              brotx: 'https://gofile.io/d/RaSXG0aV',
              toolpc: 'https://raw.githubusercontent.com/zslowcuong/bio/main/TU_DONG_KICH_HOAT_SHIZUKU_VA_CAI_APP.bat',
            }
          },
          message: '👑 Xác thực thành viên PRO thành công! Đã mở khóa link tải trực tiếp trọn bộ 5 app không cần vượt link (tặng kèm FlowZ VIP).',
        });
      }

      if (isCryptValid && cryptInfo) {
        return res.status(200).json({
          success: true,
          isVip: true,
          key: cryptInfo.key,
          appId: cryptInfo.isAllApps ? 'all' : (cryptInfo.appId || 'all'),
          plan: cryptInfo.plan || 'LIFE',
          planName: 'Gói PRO Đã Xác Thực Chữ Ký',
          hwid: cryptInfo.hwid,
          phone: '',
          hwidChanges: 0,
          isLifetime: cryptInfo.isLifetime || false,
          expiresAtUtc: cryptInfo.expiryUtcMs || 4102444800000,
          serverNowUtc,
          directDownloads: {
            flowoptimize: { name: 'FlowOptimize Anime Edition (v1.8.0 PRO)', directApk: 'https://zslowcuong.github.io/bio/FlowOptimize.apk', gofile: 'https://gofile.io/d/Vr3bEORd' },
            flows: { name: 'FlowS Gamer Tuner Edition (v1.4.0 PRO)', directApk: 'https://zslowcuong.github.io/bio/FlowS.apk', gofile: 'https://gofile.io/d/kzDVlE2G' },
            flowultra: { name: 'FlowUltra eSports Suite (v1.3.0 PRO)', directApk: 'https://zslowcuong.github.io/bio/FlowUltra.apk', gofile: 'https://gofile.io/d/p8GZrZNY' },
            flowextra: { name: 'FlowExtra Kaito Kid 1412 (v3.7 PRO)', directApk: 'https://zslowcuong.github.io/bio/FlowExtra.apk', gofile: 'https://raw.githubusercontent.com/zslowcuong/bio/main/FlowExtra.apk' },
            flowz: { name: 'FlowZ VIP Headshot & Sensitivity Pro (Quà tặng kèm PRO)', directApk: 'https://zslowcuong.github.io/bio/FlowZ.apk', gofile: 'https://raw.githubusercontent.com/zslowcuong/bio/main/FlowZ.apk', giftNotice: '🎁 Tặng kèm miễn phí dành riêng cho khách hàng mua KEY PRO!' },
          },
          message: '👑 Xác thực thành viên PRO thành công! Đã mở khóa link tải trực tiếp trọn bộ 5 app không cần vượt link (tặng kèm FlowZ VIP).',
        });
      }

      return res.status(200).json({
        success: false,
        isVip: false,
        reason: 'Chưa tìm thấy bản quyền PRO cho thông tin này (SĐT, HWID, Mã đơn hoặc Key). Vui lòng kiểm tra lại thông tin hoặc mua gói tại Cửa Hàng!',
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
      const qDigits = qKey.replace(/[^0-9]/g, '');
      let targetIdx = issuedKeys.findIndex((k) => {
        if (!k) return false;
        const kKey = String(k.key || '').toUpperCase();
        const kOld = String(k.oldKey || '').toUpperCase();
        const kOlds = Array.isArray(k.oldKeys) ? k.oldKeys.map((x) => String(x || '').toUpperCase()) : [];
        return kKey === qKey || kOld === qKey || kOlds.includes(qKey);
      });

      if (targetIdx < 0) {
        // Tìm thông minh nếu người dùng nhập HWID cũ, Mã đơn, hoặc SĐT
        targetIdx = issuedKeys.findIndex((k) =>
          k && (
            String(k.hwid || '').toUpperCase() === qKey ||
            String(k.oldHwid || '').toUpperCase() === qKey ||
            (Array.isArray(k.hwids) && k.hwids.some((h) => String(h || '').toUpperCase() === qKey)) ||
            String(k.orderCode || '').toUpperCase() === qKey ||
            (qDigits.length >= 8 && k.phone && k.phone.replace(/[^0-9]/g, '') === qDigits)
          )
        );
      }

      if (targetIdx < 0) {
        // Tìm trong đơn hàng flowly:orders
        const orders = (await dbGetJson('flowly:orders', [])) || [];
        const ord = orders.find((o) =>
          o && o.status === 'COMPLETED' && (
            String(o.orderCode || '').toUpperCase() === qKey ||
            String(o.memo || '').toUpperCase() === qKey ||
            String(o.key || '').toUpperCase() === qKey ||
            String(o.oldKey || '').toUpperCase() === qKey ||
            (Array.isArray(o.oldKeys) && o.oldKeys.some((ok) => String(ok || '').toUpperCase() === qKey)) ||
            String(o.hwid || '').toUpperCase() === qKey ||
            String(o.oldHwid || '').toUpperCase() === qKey ||
            (Array.isArray(o.hwids) && o.hwids.some((h) => String(h || '').toUpperCase() === qKey)) ||
            (qDigits.length >= 8 && o.phone && o.phone.replace(/[^0-9]/g, '') === qDigits)
          )
        );
        if (ord && ord.key) {
          targetIdx = issuedKeys.findIndex((k) =>
            String(k.key || '').toUpperCase() === String(ord.key).toUpperCase() ||
            (ord.oldKey && String(k.key || '').toUpperCase() === String(ord.oldKey).toUpperCase())
          );
        }
      }

      if (targetIdx < 0) {
        return res.status(404).json({ success: false, reason: 'Không tìm thấy thông tin Mã Key PRO này trên hệ thống máy chủ!' });
      }

      const record = issuedKeys[targetIdx];
      if (record.revoked) {
        return res.status(403).json({ success: false, reason: 'Mã Key này đã bị Admin thu hồi!' });
      }

      const canonicalKey = String(record.key || qKey).toUpperCase();
      const oldHwid = normalizeHwid(record.hwid || '');
      if (oldHwid === newHwid) {
        return res.status(200).json({
          success: true,
          free: true,
          alreadyMigrated: true,
          oldHwid,
          newHwid,
          key: canonicalKey,
          newKey: canonicalKey,
          hwidChanges: Math.max(Number(record.hwidChanges || 0), Number(record.changeHwidCount || 0)),
          message: `✅ Thiết bị ${newHwid} đã được gắn sẵn bản quyền PRO trên hệ thống! Hãy dùng mã Key hiện tại của bạn: ${canonicalKey}`,
        });
      }

      const changesCount = Math.max(Number(record.hwidChanges || 0), Number(record.changeHwidCount || 0));

      // ĐỔI LẦN ĐẦU TIÊN (changesCount === 0): HOÀN TOÀN MIỄN PHÍ 100%!
      if (changesCount === 0) {
        const appIdForSign = normalizeAppId(record.appId || (canonicalKey.startsWith('FLOWALL-') ? 'all' : 'all')) || 'all';
        const planCode = String(record.planCode || record.plan || 'LIFE').toUpperCase();
        const nonce4 = crypto.randomBytes(2).toString('hex').toUpperCase();
        const newKey = signProKey(appIdForSign, newHwid, planCode, nonce4);

        record.oldKey = canonicalKey;
        record.key = newKey;
        record.oldHwid = oldHwid;
        record.hwid = newHwid;
        if (!Array.isArray(record.oldKeys)) record.oldKeys = [];
        if (canonicalKey && !record.oldKeys.includes(canonicalKey)) record.oldKeys.push(canonicalKey);
        if (!Array.isArray(record.hwids)) record.hwids = [oldHwid].filter(Boolean);
        if (oldHwid && !record.hwids.includes(oldHwid)) record.hwids.push(oldHwid);
        if (!record.hwids.includes(newHwid)) record.hwids.push(newHwid);
        record.hwidChanges = 1;
        record.changeHwidCount = 1;
        record.lastChangedAtUtc = serverNowUtc;
        record.hwidHistory = [
          ...(Array.isArray(record.hwidHistory) ? record.hwidHistory : []),
          { oldHwid, newHwid, oldKey: canonicalKey, newKey, changedAtUtc: serverNowUtc, fee: 0, reason: 'FREE_FIRST_MIGRATION' },
        ];
        issuedKeys[targetIdx] = record;
        await dbSetJson('flowly:issued_keys', issuedKeys);
        await dbHsetJson('flowly:keys_map', newKey, record);
        if (canonicalKey) await dbHsetJson('flowly:keys_map', canonicalKey, record);

        // Đồng bộ đơn hàng tương ứng
        const orders = (await dbGetJson('flowly:orders', [])) || [];
        const orderIdx = orders.findIndex((o) =>
          (record.orderCode && o.orderCode === record.orderCode) ||
          String(o.key || '').toUpperCase() === canonicalKey ||
          normalizeHwid(o.hwid) === oldHwid
        );
        if (orderIdx >= 0) {
          orders[orderIdx].oldKey = canonicalKey;
          orders[orderIdx].key = newKey;
          orders[orderIdx].oldHwid = oldHwid;
          orders[orderIdx].hwid = newHwid;
          orders[orderIdx].hwidChanges = 1;
          orders[orderIdx].changeHwidCount = 1;
          if (!Array.isArray(orders[orderIdx].hwids)) orders[orderIdx].hwids = [oldHwid].filter(Boolean);
          if (oldHwid && !orders[orderIdx].hwids.includes(oldHwid)) orders[orderIdx].hwids.push(oldHwid);
          if (!orders[orderIdx].hwids.includes(newHwid)) orders[orderIdx].hwids.push(newHwid);
          if (!Array.isArray(orders[orderIdx].oldKeys)) orders[orderIdx].oldKeys = [];
          if (canonicalKey && !orders[orderIdx].oldKeys.includes(canonicalKey)) orders[orderIdx].oldKeys.push(canonicalKey);
          await dbSetJson('flowly:orders', orders);
          if (orders[orderIdx].orderCode) await dbHsetJson('flowly:orders_map', orders[orderIdx].orderCode, orders[orderIdx]);
        }

        await sendTelegram(
          `🔄 <b>[KHÁCH PRO ĐỔI HWID MIỄN PHÍ LẦN ĐẦU]</b>\n\n` +
          `🔑 <b>Key cũ:</b> <code>${canonicalKey}</code>\n` +
          `🆕 <b>Key mới:</b> <code>${newKey}</code>\n` +
          `📱 <b>App:</b> ${record.appId || 'All'}\n` +
          `📟 <b>HWID cũ:</b> <code>${oldHwid}</code>\n` +
          `📲 <b>HWID mới:</b> <code>${newHwid}</code>\n` +
          `✅ <i>Hệ thống đã tự động chuyển đổi bản quyền sang máy mới miễn phí 100%!</i>`
        );

        return res.status(200).json({
          success: true,
          free: true,
          oldHwid,
          newHwid,
          oldKey: canonicalKey,
          key: newKey,
          newKey,
          hwidChanges: 1,
          message: `🎉 Đổi thiết bị thành công miễn phí lần đầu! Bản quyền PRO đã được chuyển sang máy ${newHwid}. Key mới của bạn: ${newKey}`,
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
        key: canonicalKey,
        orderCodeRef: record.orderCode || '',
        phone: record.phone || '',
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
        `🔑 <b>Key:</b> <code>${canonicalKey}</code>\n` +
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
          key: canonicalKey,
          oldHwid,
          newHwid,
        },
      });
    }

    // 5) Action: check_hwid_change (Kiểm tra & tự động xác thực thanh toán 5.000đ qua SePay API)
    if (action === 'check_hwid_change') {
      const orderCode = String(req.query?.orderCode || body.orderCode || '').trim().toUpperCase();
      if (!orderCode) {
        return res.status(400).json({ success: false, error: 'Thiếu orderCode' });
      }
      const changeReqs = (await dbGetJson('flowly:hwid_change_requests', [])) || [];
      let targetReq = changeReqs.find((r) => r && (String(r.orderCode || '').toUpperCase() === orderCode || String(r.memo || '').toUpperCase() === orderCode));
      if (!targetReq) {
        return res.status(404).json({ success: false, error: 'Không tìm thấy yêu cầu đổi thiết bị này!' });
      }
      if (targetReq.status === 'COMPLETED') {
        return res.status(200).json({
          success: true,
          paid: true,
          request: targetReq,
          newKey: targetReq.newKey || targetReq.key,
          newHwid: targetReq.newHwid,
          message: `🎉 Đã nhận 5.000đ và chuyển bản quyền sang máy ${targetReq.newHwid} thành công!`,
          serverNowUtc,
        });
      }

      // Actively poll SePay API if configured
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
            const memoUpper = String(targetReq.memo || '').toUpperCase();
            const matched = txs.find((tx) => {
              const txId = String(tx.id || '');
              const amountIn = Number(tx.amount_in || 0);
              const compact = normalizeTextForMatch(tx.transaction_content || '').replace(/\s+/g, '');
              return txId && memoUpper && amountIn >= Number(targetReq.price || 5000) && compact.includes(memoUpper);
            });
            if (matched) {
              const txId = String(matched.id);
              const acquired = await dbSetNx(`flowly:claim_tx:${txId}`, JSON.stringify({ type: 'HWID_CHANGE', orderCode: targetReq.orderCode, claimedAtUtc: serverNowUtc }), 86400 * 30);
              if (acquired) {
                targetReq = await completeHwidChangeRequest(targetReq, txId, 'SEPAY_POLL_VERIFIED');
                return res.status(200).json({
                  success: true,
                  paid: true,
                  request: targetReq,
                  newKey: targetReq.newKey || targetReq.key,
                  newHwid: targetReq.newHwid,
                  message: `🎉 Đã nhận 5.000đ và chuyển bản quyền sang máy ${targetReq.newHwid} thành công!`,
                  serverNowUtc,
                });
              }
            }
          }
        } catch (err) {
          return res.status(200).json({
            success: true,
            paid: false,
            request: targetReq,
            message: 'Đang kiểm tra giao dịch TPBank, vui lòng đợi thêm giây lát...',
            sepayError: err.message,
            serverNowUtc,
          });
        }
      }

      return res.status(200).json({
        success: true,
        paid: false,
        request: targetReq,
        message: `Chưa thấy giao dịch ${Number(targetReq.price || 5000).toLocaleString('vi-VN')}đ kèm nội dung "${targetReq.memo}" về TPBank. Vui lòng chờ 5–10 giây sau khi chuyển khoản rồi bấm kiểm tra lại.`,
        serverNowUtc,
      });
    }

    return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION', serverNowUtc });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

