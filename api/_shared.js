import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ADMIN_HASH = process.env.ADMIN_PIN_HASH || '246942076e3359c83467555088158cca0cff87e60f95b6cd85a6aacabf0b5ac0';
export const TRIAL_DURATION_MS = 0; // Trial event ended -> Default 0h (VIP maintained via getkey 30h)
export const DEFAULT_TRIAL_HOURS = 0;

export async function getTrialEnabled() {
  const staticCfg = loadStaticConfig();
  const staticEnabled = Boolean(staticCfg.trial_enabled ?? false);
  const kvTrial = await dbGetJson('flowly:trial_enabled', null);
  if (kvTrial !== null && typeof kvTrial !== 'undefined') {
    return Boolean(kvTrial);
  }
  return staticEnabled;
}
export const VIP_DURATION_MS = 30 * 3600 * 1000;   // 30 hours free VIP

export const BANK_CONFIG = {
  bankCode: 'TPB',
  bankName: 'TPBANK',
  accountNo: '10006503497',
  accountName: 'TRAN CHI CUONG',
};

export const PLANS = {
  '1D': { code: '1D', name: 'Gói 1 Ngày Full 5 App (24 Giờ)', days: 1, hours: 24, price: 6000, origPrice: 10000 },
  '2D': { code: '2D', name: 'Gói Trải Nghiệm (2 Ngày / 48H)', days: 2, hours: 48, price: 10000, origPrice: 15000 },
  '3D': { code: '3D', name: 'Gói Trải Nghiệm (2 Ngày / 48H)', days: 2, hours: 48, price: 10000, origPrice: 15000 },
  '7D': { code: '7D', name: 'Gói 1 Tuần Full 5 App (7 Ngày)', days: 7, hours: 168, price: 15000, origPrice: 29000 },
  '30D': { code: '30D', name: 'Gói 1 Tháng Full 5 App (30 Ngày)', days: 30, hours: 720, price: 150000, origPrice: 220000 },
  '90D': { code: '90D', name: 'Gói 3 Tháng Full 5 App (90 Ngày)', days: 90, hours: 2160, price: 300000, origPrice: 450000 },
  '365D': { code: '365D', name: 'Gói 1 Năm Full 5 App (365 Ngày)', days: 365, hours: 8760, price: 899000, origPrice: 1499000 },
  '1Y': { code: '1Y', name: 'Gói 1 Năm Full 5 App (365 Ngày)', days: 365, hours: 8760, price: 899000, origPrice: 1499000 },
  'LIFE': { code: 'LIFE', name: 'Gói Vĩnh Viễn Full 5 App Trọn Đời', days: 36500, hours: 876000, price: 99000, origPrice: 249000 },
};

export const SINGLE_PLANS = {
  '7D': { code: '7D', name: 'Gói 7 Ngày Đơn App', days: 7, hours: 168, price: 10000, origPrice: 19000 },
  '30D': { code: '30D', name: 'Gói 1 Tháng Đơn App (30 Ngày)', days: 30, hours: 720, price: 25000, origPrice: 39000 },
  '90D': { code: '90D', name: 'Gói 3 Tháng Đơn App (90 Ngày)', days: 90, hours: 2160, price: 59000, origPrice: 99000 },
  '365D': { code: '365D', name: 'Gói 12 Tháng Đơn App (365 Ngày)', days: 365, hours: 8760, price: 149000, origPrice: 299000 },
  '1Y': { code: '1Y', name: 'Gói 12 Tháng Đơn App (365 Ngày)', days: 365, hours: 8760, price: 149000, origPrice: 299000 },
  'LIFE': { code: 'LIFE', name: 'Gói Vĩnh Viễn Đơn App (Trọn Đời)', days: 36500, hours: 876000, price: 59000, origPrice: 129000 },
};

export const APPS = {
  all: {
    id: 'all',
    name: 'Combo Toàn Bộ 5 Ứng Dụng (FlowOptimize, FlowS, FlowMax, FlowZ, FlowCore)',
    prefix: 'FLOWALL',
    salt: 'FLOWLY_2026_ALL_APPS_SALT_66F0',
    package: 'all',
    scheme: 'flowly',
  },
  flowoptimize: {
    id: 'flowoptimize',
    name: 'FlowOptimize',
    prefix: 'FLOWOP',
    salt: 'FLOWLY_2026_FLOWOP_SALT_91A4',
    package: 'com.example.gameoptimizer',
    scheme: 'flowoptimize',
  },
  flows: {
    id: 'flows',
    name: 'FlowS',
    prefix: 'FLOWS',
    salt: 'FLOWLY_2026_FLOWS_SALT_73C8',
    package: 'com.flows.gaming',
    scheme: 'flows',
  },
  flowmax: {
    id: 'flowmax',
    name: 'FlowMax (Unified Hardware Suite)',
    prefix: 'FLOWMAX',
    salt: 'FLOWLY_2026_FLOWEXTRA_1412_SALT_84F1',
    package: 'com.flowextra.optimizer',
    scheme: 'flowmax',
  },
  flowextra: {
    id: 'flowextra',
    name: 'FlowMax',
    prefix: 'FLOWEXTRA',
    salt: 'FLOWLY_2026_FLOWEXTRA_1412_SALT_84F1',
    package: 'com.flowextra.optimizer',
    scheme: 'flowextra',
  },
  flowultra: {
    id: 'flowultra',
    name: 'FlowMax',
    prefix: 'FLOWULTRA',
    salt: 'FLOWLY_2026_FLOWULTRA_SALT_52E9',
    package: 'com.flowextra.optimizer',
    scheme: 'flowultra',
  },
  flowz: {
    id: 'flowz',
    name: 'FlowZ',
    prefix: 'FLOWZ',
    salt: 'FLOWLY_2026_FLOWZ_VIP_SALT_98B2',
    package: 'com.nebula.hnx',
    scheme: 'flowz',
  },
  flowcore: {
    id: 'flowcore',
    name: 'FlowCore Brain AI',
    prefix: 'FLOWCORE',
    salt: 'FLOWLY_2026_FLOWCORE_BRAIN_SALT_41D7',
    package: 'com.flowcore.brain',
    scheme: 'flowcore',
  },
};

export function normalizeAppId(raw) {
  const s = String(raw || 'all').trim().toLowerCase();
  if (s === 'all' || s === 'flowall' || s === 'combo' || s === 'all_apps' || s === 'combo_all' || s === 'combo5' || s === 'ecosystem') return 'all';
  if (s === 'flowop' || s === 'flowoptimize' || s === 'com.example.gameoptimizer') return 'flowoptimize';
  if (s === 'flows' || s === 'com.flows.gaming') return 'flows';
  if (s === 'flowmax' || s === 'flowextra' || s === 'flowultra' || s === 'com.flowextra.optimizer' || s === 'com.flows.flowultra') return 'flowmax';
  if (s === 'flowz' || s === 'com.flows.flowz' || s === 'com.nebula.hnx') return 'flowz';
  if (s === 'flowcore' || s === 'com.flowcore.brain' || s === 'com.flowengine.core') return 'flowcore';
  return 'all';
}

export function sanitizeKeyInput(raw) {
  return String(raw || '').replace(/[\s\u200B-\u200D\uFEFF]+/g, '').toUpperCase();
}

export function normalizeHwid(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex').toUpperCase();
}

export function signProKey(appId, hwid, planCode, nonce4) {
  const app = APPS[appId];
  const cleanHwid = normalizeHwid(hwid);
  const sig8 = sha256Hex(`${app.prefix}:PRO:${cleanHwid}:${planCode}:${nonce4}:${app.salt}`).slice(0, 8);
  return `${app.prefix}-PRO-${cleanHwid}-${planCode}-${nonce4}-${sig8}`;
}

export function signVipKey(appId, hwid, expirySec) {
  const app = APPS[appId];
  const cleanHwid = normalizeHwid(hwid);
  const expiryHex = Number(expirySec).toString(16).toUpperCase();
  const sig8 = sha256Hex(`${app.prefix}:VIP:${cleanHwid}:${expirySec}:${app.salt}`).slice(0, 8);
  return `${app.prefix}-VIP-${cleanHwid}-${expiryHex}-${sig8}`;
}

export function verifySignedKeyFormat(keyStr, expectedAppId, expectedHwid) {
  const key = sanitizeKeyInput(keyStr);
  const app = APPS[expectedAppId];
  if (!app || !key) return { valid: false, reason: 'Thiếu thông tin ứng dụng hoặc mã key' };

  const cleanHwid = normalizeHwid(expectedHwid);

  // 1) Universal ALL-APPS Combo Key (FLOWALL-PRO-<HWID>-<PLAN>-<NONCE4>-<SIG8>)
  const allApp = APPS.all;
  if (allApp && key.startsWith(`${allApp.prefix}-PRO-`)) {
    const parts = key.slice(`${allApp.prefix}-PRO-`.length).split('-');
    if (parts.length === 4) {
      const [keyHwid, planCode, nonce4, sig8] = parts;
      const expectedSig = sha256Hex(`${allApp.prefix}:PRO:${keyHwid}:${planCode}:${nonce4}:${allApp.salt}`).slice(0, 8);
      if (sig8 !== expectedSig) {
        return { valid: false, reason: 'Chữ ký Key Combo không hợp lệ hoặc đã bị chỉnh sửa' };
      }

      // Check 1 device restriction
      if (cleanHwid && keyHwid && cleanHwid !== keyHwid) {
        return {
          valid: false,
          reason: `Key này chỉ được kích hoạt trên 1 thiết bị (${keyHwid}), không khớp với máy hiện tại (${cleanHwid})!`
        };
      }

      // Tất cả các gói (7D, 30D, LIFE) của mã Combo FLOWALL đều mở khóa trọn bộ 5 app (bao gồm FlowZ VIP)
      const plan = PLANS[planCode] || { hours: 168 };
      const isLifetime = planCode === 'LIFE';
      const expiryUtcMs = isLifetime ? 4102444800000 : Date.now() + plan.hours * 3600 * 1000;

      return {
        valid: true,
        tier: 'PRO_SHOP',
        expiryUtcMs,
        plan: planCode,
        key,
        isLifetime,
        isAllApps: true, // Trọn bộ 5 app!
        keyOriginHwid: keyHwid
      };
    }
  }

  // 2) Check Single-App VIP format: <PREFIX>-VIP-<HWID>-<EXPIRY_HEX>-<SIG8>
  const vipPrefix = `${app.prefix}-VIP-`;
  if (key.startsWith(vipPrefix)) {
    const rest = key.slice(vipPrefix.length);
    const parts = rest.split('-');
    if (parts.length !== 3) return { valid: false, reason: 'Sai định dạng Key VIP' };
    const [keyHwid, expiryHex, sig8] = parts;
    if (keyHwid !== cleanHwid) {
      return { valid: false, reason: `Key VIP này khóa cứng cho thiết bị ${keyHwid}, không thể dùng trên máy ${cleanHwid}` };
    }
    const expirySec = parseInt(expiryHex, 16);
    if (!Number.isFinite(expirySec) || expirySec <= 0) return { valid: false, reason: 'Thời hạn Key VIP không hợp lệ' };
    const expectedSig = sha256Hex(`${app.prefix}:VIP:${keyHwid}:${expirySec}:${app.salt}`).slice(0, 8);
    if (sig8 !== expectedSig) return { valid: false, reason: 'Chữ ký Key VIP không hợp lệ' };
    const expiryUtcMs = expirySec * 1000;
    if (Date.now() > expiryUtcMs) return { valid: false, reason: 'Key VIP đã hết hạn 30 giờ, vui lòng vượt link lấy key mới' };
    return { valid: true, tier: 'VIP_FREE', expiryUtcMs, plan: 'VIP30H', key, isAllApps: false, isLifetime: false };
  }

  // 3) Check Single-App PRO format: <PREFIX>-PRO-<HWID>-<PLAN>-<NONCE4>-<SIG8> (KHÔNG dùng chung app khác)
  const allowedApps = expectedAppId === 'flowmax' ? [app, APPS.flowextra, APPS.flowultra].filter(Boolean) : [app];
  for (const targetApp of allowedApps) {
    const proPrefix = `${targetApp.prefix}-PRO-`;
    if (key.startsWith(proPrefix)) {
      const rest = key.slice(proPrefix.length);
      const parts = rest.split('-');
      if (parts.length !== 4) return { valid: false, reason: 'Sai định dạng Key PRO' };
      const [keyHwid, planCode, nonce4, sig8] = parts;
      if (keyHwid !== cleanHwid) {
        return { valid: false, reason: `Key PRO này gắn với thiết bị ${keyHwid}, không khớp máy ${cleanHwid}` };
      }
      const plan = SINGLE_PLANS[planCode] || PLANS[planCode];
      if (!plan) return { valid: false, reason: 'Gói Key PRO không hợp lệ' };
      const expectedSig = sha256Hex(`${targetApp.prefix}:PRO:${keyHwid}:${planCode}:${nonce4}:${targetApp.salt}`).slice(0, 8);
      if (sig8 !== expectedSig) return { valid: false, reason: 'Chữ ký Key PRO không hợp lệ' };
      const isLifetime = planCode === 'LIFE';
      const expiryUtcMs = isLifetime ? 4102444800000 : Date.now() + plan.hours * 3600 * 1000;
      return { valid: true, tier: 'PRO_SHOP', expiryUtcMs, plan: planCode, key, isLifetime, isAllApps: false, keyOriginHwid: keyHwid };
    }
  }

  for (const [otherId, otherApp] of Object.entries(APPS)) {
    if (otherId !== expectedAppId && (key.startsWith(`${otherApp.prefix}-VIP-`) || key.startsWith(`${otherApp.prefix}-PRO-`))) {
      return { valid: false, reason: `Key này thuộc ứng dụng ${otherApp.name}, không thể dùng cho ${app.name}` };
    }
  }

  return { valid: false, reason: 'Mã Key không đúng định dạng' };
}

export function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Admin-Pin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
}

export function handlePreflight(req, res) {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

export async function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

function getKvCredentials() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  return url && token ? { url: url.replace(/\/+$/, ''), token } : null;
}

function getMemoryStore() {
  if (!globalThis.__FLOWLY_MEM_DB__) {
    globalThis.__FLOWLY_MEM_DB__ = {
      trials: {},
      orders: [],
      issuedKeys: [],
      revokedKeys: [],
      claimedTxIds: {},
      eventKeys: null,
      globalResets: null,
    };
  }
  return globalThis.__FLOWLY_MEM_DB__;
}

export function getBackendStatus() {
  const kv = getKvCredentials();
  return {
    dbMode: kv ? 'UPSTASH_KV' : 'MEMORY_FALLBACK',
    kvConfigured: Boolean(kv),
    sepayConfigured: Boolean(process.env.SEPAY_API_KEY),
    sepayWebhookConfigured: Boolean(process.env.SEPAY_WEBHOOK_SECRET),
  };
}

async function kvCommand(cmdArray) {
  const kv = getKvCredentials();
  if (!kv) return null;
  const r = await fetch(kv.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${kv.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cmdArray),
  });
  if (!r.ok) throw new Error(`KV HTTP ${r.status}`);
  const data = await r.json();
  return data?.result ?? null;
}

export async function dbHsetJson(hashKey, field, val) {
  const kv = getKvCredentials();
  if (kv) {
    try {
      await kvCommand(['HSET', hashKey, String(field), JSON.stringify(val)]);
      return true;
    } catch {
      return false;
    }
  }
  const mem = getMemoryStore();
  if (!mem[hashKey]) mem[hashKey] = {};
  mem[hashKey][field] = val;
  return true;
}

export async function dbHgetJson(hashKey, field, defaultVal = null) {
  const kv = getKvCredentials();
  if (kv) {
    try {
      const raw = await kvCommand(['HGET', hashKey, String(field)]);
      if (raw == null) return defaultVal;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return defaultVal;
    }
  }
  const mem = getMemoryStore();
  return mem[hashKey]?.[field] ?? defaultVal;
}

export async function dbHgetAllJson(hashKey) {
  const kv = getKvCredentials();
  if (kv) {
    try {
      const raw = await kvCommand(['HGETALL', hashKey]);
      if (!raw) return {};
      const result = {};
      if (Array.isArray(raw)) {
        for (let i = 0; i < raw.length; i += 2) {
          const k = raw[i];
          const v = raw[i + 1];
          try {
            result[k] = typeof v === 'string' ? JSON.parse(v) : v;
          } catch {
            result[k] = v;
          }
        }
      } else if (typeof raw === 'object') {
        for (const [k, v] of Object.entries(raw)) {
          try {
            result[k] = typeof v === 'string' ? JSON.parse(v) : v;
          } catch {
            result[k] = v;
          }
        }
      }
      return result;
    } catch {
      return {};
    }
  }
  const mem = getMemoryStore();
  return mem[hashKey] || {};
}

export async function dbSetNx(key, val, exSec = 86400) {
  const kv = getKvCredentials();
  if (kv) {
    try {
      const res = await kvCommand(['SET', key, typeof val === 'string' ? val : JSON.stringify(val), 'EX', String(exSec), 'NX']);
      return res === 'OK' || res === 1 || res === true;
    } catch {
      return false;
    }
  }
  const mem = getMemoryStore();
  if (!mem.nxLocks) mem.nxLocks = {};
  if (mem.nxLocks[key] && mem.nxLocks[key].exp > Date.now()) return false;
  mem.nxLocks[key] = { val, exp: Date.now() + exSec * 1000 };
  return true;
}

export async function dbGetJson(key, defaultVal = null) {
  const kv = getKvCredentials();
  if (kv) {
    try {
      const raw = await kvCommand(['GET', key]);
      if (raw == null) return defaultVal;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return defaultVal;
    }
  }
  const mem = getMemoryStore();
  if (key.startsWith('flowly:trial:') || key.startsWith('flowly:wdv:')) return mem.trials[key] ?? defaultVal;
  if (key === 'flowly:orders') return mem.orders;
  if (key === 'flowly:issued_keys') return mem.issuedKeys;
  if (key === 'flowly:revoked_keys') return mem.revokedKeys;
  if (key === 'flowly:claimed_tx') return mem.claimedTxIds;
  if (key === 'flowly:event_keys') return mem.eventKeys ?? defaultVal;
  if (key === 'flowly:global_resets') return mem.globalResets ?? defaultVal;
  return defaultVal;
}

export async function dbSetJson(key, val) {
  const kv = getKvCredentials();
  if (kv) {
    await kvCommand(['SET', key, JSON.stringify(val)]);
    return true;
  }
  const mem = getMemoryStore();
  if (key.startsWith('flowly:trial:') || key.startsWith('flowly:wdv:')) mem.trials[key] = val;
  else if (key === 'flowly:orders') mem.orders = val;
  else if (key === 'flowly:issued_keys') mem.issuedKeys = val;
  else if (key === 'flowly:revoked_keys') mem.revokedKeys = val;
  else if (key === 'flowly:claimed_tx') mem.claimedTxIds = val;
  else if (key === 'flowly:event_keys') mem.eventKeys = val;
  else if (key === 'flowly:global_resets') mem.globalResets = val;
  return false;
}

export function loadStaticConfig() {
  try {
    const p = path.join(process.cwd(), 'config.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch {
    // ignore
  }
  return {};
}

export async function getEventKeysMap() {
  const staticCfg = loadStaticConfig();
  const staticEvents = staticCfg.event_keys || {};
  const kvEvents = await dbGetJson('flowly:event_keys', null);
  const merged = {};
  for (const appId of Object.keys(APPS)) {
    const src = (kvEvents && kvEvents[appId]) ? kvEvents[appId] : (staticEvents[appId] || { active: false });
    merged[appId] = { ...src };
  }
  return merged;
}

export async function getGlobalResetsMap() {
  const staticCfg = loadStaticConfig();
  const staticResets = staticCfg.global_resets || {};
  const kvResets = await dbGetJson('flowly:global_resets', null);
  const nowUtc = Date.now();
  const merged = {};
  for (const appId of Object.keys(APPS)) {
    const src = (kvResets && kvResets[appId]) ? kvResets[appId] : (staticResets[appId] || { active: false });
    const winExp = Number(src.window_expires_at_utc || 0);
    const active = Boolean(src.active && src.resetId && (!winExp || nowUtc < winExp));
    merged[appId] = {
      active,
      resetId: String(src.resetId || ''),
      duration_hours: Math.max(1, Number(src.duration_hours || 72)),
      title: String(src.title || ''),
      notice: String(src.notice || ''),
      triggered_at_utc: Number(src.triggered_at_utc || 0),
      window_expires_at_utc: winExp,
    };
  }
  return merged;
}

export async function getRevokedKeysList() {
  const staticCfg = loadStaticConfig();
  const staticRevoked = Array.isArray(staticCfg.revoked_keys) ? staticCfg.revoked_keys : [];
  const kvRevoked = await dbGetJson('flowly:revoked_keys', []);
  return Array.from(new Set([...staticRevoked, ...(Array.isArray(kvRevoked) ? kvRevoked : [])].map((k) => String(k).trim().toUpperCase()).filter(Boolean)));
}

export async function sendTelegram(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID || '';
  if (!botToken || !chatId) {
    return { ok: false, error: 'TELEGRAM_ENV_NOT_CONFIGURED' };
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function isAdminAuthorized(req, body = {}) {
  const rawPin = String(req.headers['x-admin-pin'] || body.pin || req.query?.pin || '').trim();
  if (!rawPin || rawPin.length === 64) return false;
  const candidateHash = sha256Hex(rawPin).toLowerCase();
  const targetHash = ADMIN_HASH.toLowerCase();
  if (candidateHash.length !== targetHash.length) return false;
  return crypto.timingSafeEqual(Buffer.from(candidateHash, 'utf8'), Buffer.from(targetHash, 'utf8'));
}

export function makePaymentMemo(num6) {
  return `FLOW${String(num6)}`;
}

export function buildVietQrUrl(price, memo) {
  return `https://img.vietqr.io/image/${BANK_CONFIG.bankCode}-${BANK_CONFIG.accountNo}-compact2.png?amount=${Number(price)}&addInfo=${encodeURIComponent(memo)}&accountName=${encodeURIComponent(BANK_CONFIG.accountName)}`;
}

export function normalizeTextForMatch(str) {
  return String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, ' ');
}

export async function completeOrderWithProKey(order, txId = null, source = 'SEPAY_AUTO') {
  // SETNX atomic deduplication lock for transaction ID
  if (txId) {
    const lockKey = `flowly:claim_tx:${txId}`;
    const acquired = await dbSetNx(lockKey, order.orderCode || '1', 86400 * 7);
    if (!acquired) {
      // Transaction already claimed by another request, retrieve existing order
      const existingMapOrder = await dbHgetJson('flowly:orders_map', order.orderCode);
      if (existingMapOrder && existingMapOrder.status === 'COMPLETED' && existingMapOrder.key) {
        return existingMapOrder;
      }
    }
  }

  // Check atomic hash map first
  const existingMapOrder = await dbHgetJson('flowly:orders_map', order.orderCode);
  if (existingMapOrder && existingMapOrder.status === 'COMPLETED' && existingMapOrder.key) {
    return existingMapOrder;
  }

  const orders = (await dbGetJson('flowly:orders', [])) || [];
  const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
  const targetIdx = orders.findIndex((o) => o.orderCode === order.orderCode);
  const existing = targetIdx >= 0 ? orders[targetIdx] : (existingMapOrder || order);

  if (existing.status === 'COMPLETED' && existing.key) {
    return existing;
  }

  const nonce4 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const issueAppId = normalizeAppId(existing.appId || 'all') || 'all';
  const isComboAll = issueAppId === 'all';
  const proKey = signProKey(issueAppId, existing.hwid, existing.planCode, nonce4);
  const nowUtc = Date.now();
  const plan = isComboAll ? PLANS[existing.planCode] : (SINGLE_PLANS[existing.planCode] || PLANS[existing.planCode]);
  const expiryUtcMs = existing.planCode === 'LIFE' ? 4102444800000 : nowUtc + (plan ? plan.hours * 3600 * 1000 : 7 * 86400000);

  const completed = {
    ...existing,
    appId: issueAppId,
    allApps: isComboAll,
    status: 'COMPLETED',
    key: proKey,
    txId: txId || existing.txId || null,
    verifiedSource: source,
    completedAtUtc: nowUtc,
    expiryUtcMs,
  };

  // 1. Atomic write to orders map
  await dbHsetJson('flowly:orders_map', completed.orderCode, completed);

  // 2. Backward compatibility: update orders list
  if (targetIdx >= 0) orders[targetIdx] = completed;
  else orders.unshift(completed);
  await dbSetJson('flowly:orders', orders.slice(0, 500));

  const keyRecord = {
    key: proKey,
    appId: completed.appId,
    allApps: isComboAll,
    hwid: completed.hwid,
    planCode: completed.planCode,
    planName: completed.planName,
    phone: completed.phone || '',
    price: completed.price,
    orderCode: completed.orderCode,
    source,
    createdAtUtc: nowUtc,
    expiryUtcMs,
    revoked: false,
  };

  // 3. Atomic write to keys map
  await dbHsetJson('flowly:keys_map', proKey, keyRecord);

  // 4. Backward compatibility: update issued_keys list
  issuedKeys.unshift(keyRecord);
  await dbSetJson('flowly:issued_keys', issuedKeys.slice(0, 800));

  await sendTelegram(
    `✅ <b>[FLOW SHOP] ĐÃ XÁC NHẬN THANH TOÁN & CẤP KEY PRO!</b>

` +
    `📱 <b>App:</b> ${APPS[completed.appId]?.name || completed.appId}
` +
    `📦 <b>Mã đơn:</b> <code>${completed.orderCode}</code>
` +
    `💳 <b>Nội dung CK:</b> <code>${completed.memo}</code>
` +
    `💰 <b>Số tiền:</b> <b>${Number(completed.price).toLocaleString('vi-VN')}đ</b>
` +
    `💎 <b>Gói:</b> ${completed.planName || completed.planCode}
` +
    `🆔 <b>HWID:</b> <code>${completed.hwid}</code>
` +
    `🔑 <b>Key PRO:</b> <code>${proKey}</code>
` +
    `⚡ <b>Nguồn xác thực:</b> ${source}`
  );

  return completed;
}


export async function getLifetimePricingTier() {
  const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
  
  // Tính số lượng key LIFE mới bán ra từ mốc khuyến mãi mới
  const PROMO_START_UTC = 1795418000000; // Mốc chiến dịch 23/11/2026
  const newLifeCount = Array.isArray(issuedKeys)
    ? issuedKeys.filter(k => (Number(k.createdAtUtc || 0) >= PROMO_START_UTC) && (k.planCode === 'LIFE' || k.plan === 'LIFE' || (k.key && k.key.includes('-LIFE-'))) && (k.appId === 'all' || k.allApps === true || (k.key && k.key.startsWith('FLOWALL-')))).length
    : 0;

  // Khởi điểm đã có 2 lượt, còn chính xác 13/15 suất cho đợt 1 giá 99.000đ
  const INITIAL_SOLD = 2;
  const effectiveCount = INITIAL_SOLD + newLifeCount;

  const TIER_SIZE = 15;
  let tierNumber = 1;
  let currentPrice = 99000;
  let nextTierPrice = 149000;
  let slotsLeft = 13;
  let soldInTier = 2;

  if (effectiveCount < 15) {
    tierNumber = 1;
    currentPrice = 99000;
    nextTierPrice = 149000;
    slotsLeft = 15 - effectiveCount;
    soldInTier = effectiveCount;
  } else if (effectiveCount < 30) {
    tierNumber = 2;
    currentPrice = 149000;
    nextTierPrice = 199000;
    slotsLeft = 30 - effectiveCount;
    soldInTier = effectiveCount - 15;
  } else if (effectiveCount < 45) {
    tierNumber = 3;
    currentPrice = 199000;
    nextTierPrice = 249000;
    slotsLeft = 45 - effectiveCount;
    soldInTier = effectiveCount - 30;
  } else {
    tierNumber = 4;
    currentPrice = 249000;
    nextTierPrice = 249000;
    slotsLeft = 0;
    soldInTier = 15;
  }

  const tierBadge = tierNumber === 1
    ? `👑 VĨNH VIỄN • ĐỢT 1 (99K)`
    : (tierNumber === 2 ? `👑 VĨNH VIỄN • ĐỢT 2 (149K)` : (tierNumber === 3 ? `👑 VĨNH VIỄN • ĐỢT 3 (199K)` : `👑 VĨNH VIỄN • GIÁ GỐC (249K)`));

  const tierHint = tierNumber < 4
    ? `Còn ${slotsLeft}/15 suất ưu đãi ${currentPrice.toLocaleString('vi-VN')}đ, hết lượt sẽ tăng lên ${nextTierPrice.toLocaleString('vi-VN')}đ cho đến giá gốc 249.000đ!`
    : 'Đã về giá niêm yết gốc 249.000đ trọn đời!';

  return {
    lifeCount: effectiveCount,
    tierNumber,
    currentPrice,
    nextTierPrice,
    slotsLeft,
    totalSlotsInTier: TIER_SIZE,
    soldInTier,
    originalPrice: 249000,
    tierBadge,
    tierHint,
  };
}

export const getYearlyPricingTier = getLifetimePricingTier;
