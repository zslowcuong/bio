import {
  APPS,
  TRIAL_DURATION_MS,
  dbGetJson,
  dbSetJson,
  getBackendStatus,
  getEventKeysMap,
  getRevokedKeysList,
  handlePreflight,
  loadStaticConfig,
  normalizeAppId,
  normalizeHwid,
  parseBody,
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
    const activeKey = String(req.query?.activeKey || body.activeKey || body.key || '').trim().toUpperCase();
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
    const revokedKeys = await getRevokedKeysList();

    const eventKeyPlain = String(appEvent.key || '').trim().toUpperCase();
    const eventKeySha256 = String(appEvent.key_sha256 || (eventKeyPlain ? sha256Hex(eventKeyPlain) : '')).toUpperCase();
    const sanitizedEvent = {
      active: Boolean(appEvent.active && eventKeySha256 && (!appEvent.expires_at_utc || serverNowUtc < Number(appEvent.expires_at_utc))),
      keySha256: eventKeySha256,
      durationHours: Number(appEvent.duration_hours || 24),
      expiresAtUtc: Number(appEvent.expires_at_utc || 0),
      title: String(appEvent.title || ''),
      notice: String(appEvent.notice || ''),
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
        if (validClientStart > 0) inheritedStart = Math.min(inheritedStart, validClientStart);
        record = {
          appId,
          hwid,
          widevineHash: widevineHash || '',
          deviceModel,
          firstVersionCode: appVersionCode || 1,
          lastVersionCode: appVersionCode || 1,
          trialStartUtc: inheritedStart,
          trialEndUtc: inheritedStart + TRIAL_DURATION_MS,
          firstSeenUtc: serverNowUtc,
          lastSeenUtc: serverNowUtc,
          installCount: (wdvRecord?.installCount || 0) + 1,
        };
      } else {
        let earliestStart = wdvRecord?.trialStartUtc
          ? Math.min(Number(record.trialStartUtc), Number(wdvRecord.trialStartUtc))
          : Number(record.trialStartUtc);
        if (validClientStart > 0) earliestStart = Math.min(earliestStart, validClientStart);
        record = {
          ...record,
          trialStartUtc: earliestStart,
          trialEndUtc: earliestStart + TRIAL_DURATION_MS,
          lastVersionCode: appVersionCode || record.lastVersionCode,
          deviceModel: deviceModel || record.deviceModel,
          lastSeenUtc: serverNowUtc,
        };
      }

      await dbSetJson(trialKey, record);
      if (wdvStoreKey) {
        await dbSetJson(wdvStoreKey, {
          trialStartUtc: record.trialStartUtc,
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
        activeKeyRevoked,
        revokedKeys,
        syncedProKey: matchingPro ? {
          key: matchingPro.key,
          planCode: matchingPro.planCode,
          expiryUtcMs: matchingPro.expiryUtcMs,
        } : null,
        eventConfig: sanitizedEvent,
        updateInfo,
        ...status,
      });
    }

    if (action === 'activate_key') {
      const key = activeKey;
      if (!hwid || !key) {
        return res.status(400).json({ success: false, error: 'Thiếu HWID hoặc Mã Key', serverNowUtc });
      }
      if (revokedKeys.includes(key)) {
        return res.status(403).json({ success: false, reason: 'Mã Key này đã bị Admin thu hồi!', revoked: true, serverNowUtc });
      }

      // 1) Check Per-App Event Key first
      if (sanitizedEvent.active && sha256Hex(key) === sanitizedEvent.keySha256) {
        const trialKey = `flowly:trial:${appId}:${hwid}`;
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
          await dbSetJson(trialKey, { ...existingRec, appId, hwid, eventClaims: prevEventClaims, lastSeenUtc: serverNowUtc });
        }
        if (expiryUtcMs <= serverNowUtc) {
          return res.status(400).json({ success: false, reason: 'Thời gian sử dụng Key Sự Kiện này đã hết hạn trên thiết bị của bạn!', serverNowUtc });
        }
        return res.status(200).json({
          success: true,
          tier: 'PRO_EVENT',
          appId,
          hwid,
          key,
          plan: `EVENT_${sanitizedEvent.durationHours}H`,
          expiryUtcMs,
          serverNowUtc,
          message: `Kích hoạt Key Sự Kiện PRO cho ${APPS[appId].name} thành công!`,
        });
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

