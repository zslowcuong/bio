import {
  APPS,
  TRIAL_DURATION_MS,
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
          k.appId === appId &&
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
        issuedKeys.unshift({
          key,
          appId,
          hwid,
          planCode: verified.plan,
          planName: verified.plan,
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

      return res.status(200).json({
        success: true,
        tier: verified.tier,
        appId,
        hwid,
        key,
        plan: verified.plan,
        expiryUtcMs: finalExpiryMs,
        serverNowUtc,
        message: verified.tier === 'VIP_FREE'
          ? 'Kích hoạt Key VIP 30 Giờ (khóa 1 thiết bị) thành công!'
          : 'Kích hoạt Key PRO thành công!',
      });
    }

    return res.status(400).json({ success: false, error: 'UNKNOWN_ACTION', serverNowUtc });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

