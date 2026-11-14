import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const ADMIN_HASH = process.env.ADMIN_PIN_HASH || '246942076e3359c83467555088158cca0cff87e60f95b6cd85a6aacabf0b5ac0';
export const TRIAL_DURATION_MS = 72 * 3600 * 1000; // 3 days (72 hours)
export const VIP_DURATION_MS = 30 * 3600 * 1000;   // 30 hours free VIP

export const BANK_CONFIG = {
  bankCode: 'TPB',
  bankName: 'TPBANK',
  accountNo: '10006503497',
  accountName: 'TRAN CHI CUONG',
};

export const PLANS = {
  '7D': { code: '7D', name: 'Gói Tuần (7 Ngày)', days: 7, hours: 168, price: 15000 },
  '30D': { code: '30D', name: 'Gói Tháng (30 Ngày)', days: 30, hours: 720, price: 39000 },
  'LIFE': { code: 'LIFE', name: 'Gói Vĩnh Viễn (Trọn Đời)', days: 36500, hours: 876000, price: 99000 },
};

export const APPS = {
  all: {
    id: 'all',
    name: 'Combo Toàn Bộ 4 Ứng Dụng (FlowOp, FlowS, FlowUltra, FlowExtra)',
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
  flowultra: {
    id: 'flowultra',
    name: 'FlowUltra',
    prefix: 'FLOWULTRA',
    salt: 'FLOWLY_2026_FLOWULTRA_SALT_52E9',
    package: 'com.flows.flowultra',
    scheme: 'flowultra',
  },
  flowextra: {
    id: 'flowextra',
    name: 'FlowExtra',
    prefix: 'FLOWEXTRA',
    salt: 'FLOWLY_2026_FLOWEXTRA_1412_SALT_84F1',
    package: 'com.flowextra.optimizer',
    scheme: 'flowextra',
  },
};

export function normalizeAppId(raw) {
  const s = String(raw || 'flowoptimize').trim().toLowerCase();
  if (s === 'all' || s === 'combo' || s === 'all_apps' || s === 'combo_all') return 'all';
  const s = String(raw || 'flowoptimize').trim().toLowerCase();
  if (s === 'flowop' || s === 'flowoptimize' || s === 'com.example.gameoptimizer') return 'flowoptimize';
  if (s === 'flows' || s === 'com.flows.gaming') return 'flows';
  if (s === 'flowultra' || s === 'com.flows.flowultra') return 'flowultra';
  if (s === 'flowextra' || s === 'com.flowextra.optimizer') return 'flowextra';
  return null;
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
      if (keyHwid !== cleanHwid) {
        return { valid: false, reason: `Key Combo này gắn với thiết bị ${keyHwid}, không khớp máy ${cleanHwid}` };
      }
      const expectedSig = sha256Hex(`${allApp.prefix}:PRO:${keyHwid}:${planCode}:${nonce4}:${allApp.salt}`).slice(0, 8);
      if (sig8 === expectedSig) {
        return { valid: true, tier: 'PRO_SHOP', expiryUtcMs: 4102444800000, plan: 'LIFE', key, isLifetime: true, isAllApps: true };
      }
    }
  }

  // 2) Check if key is a LIFE key from ANY Flowly app (99K Lifetime unlocks ALL 4 apps!)
  for (const [otherId, otherApp] of Object.entries(APPS)) {
    if (key.startsWith(`${otherApp.prefix}-PRO-`)) {
      const parts = key.slice(`${otherApp.prefix}-PRO-`.length).split('-');
      if (parts.length === 4) {
        const [keyHwid, planCode, nonce4, sig8] = parts;
        if (keyHwid === cleanHwid && planCode === 'LIFE') {
          const expectedSig = sha256Hex(`${otherApp.prefix}:PRO:${keyHwid}:${planCode}:${nonce4}:${otherApp.salt}`).slice(0, 8);
          if (sig8 === expectedSig) {
            return { valid: true, tier: 'PRO_SHOP', expiryUtcMs: 4102444800000, plan: 'LIFE', key, isLifetime: true, isAllApps: true };
          }
        }
      }
    }
  }

  // Check VIP format: <PREFIX>-VIP-<HWID>-<EXPIRY_HEX>-<SIG8>
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
    return { valid: true, tier: 'VIP_FREE', expiryUtcMs, plan: 'VIP30H', key };
  }

  // Check PRO format: <PREFIX>-PRO-<HWID>-<PLAN>-<NONCE4>-<SIG8>
  const proPrefix = `${app.prefix}-PRO-`;
  if (key.startsWith(proPrefix)) {
    const rest = key.slice(proPrefix.length);
    const parts = rest.split('-');
    if (parts.length !== 4) return { valid: false, reason: 'Sai định dạng Key PRO' };
    const [keyHwid, planCode, nonce4, sig8] = parts;
    if (keyHwid !== cleanHwid) {
      return { valid: false, reason: `Key PRO này gắn với thiết bị ${keyHwid}, không khớp máy ${cleanHwid}` };
    }
    if (!PLANS[planCode]) return { valid: false, reason: 'Gói Key PRO không hợp lệ' };
    const expectedSig = sha256Hex(`${app.prefix}:PRO:${keyHwid}:${planCode}:${nonce4}:${app.salt}`).slice(0, 8);
    if (sig8 !== expectedSig) return { valid: false, reason: 'Chữ ký Key PRO không hợp lệ' };
    const plan = PLANS[planCode];
    const expiryUtcMs = planCode === 'LIFE' ? 4102444800000 : Date.now() + plan.hours * 3600 * 1000;
    return { valid: true, tier: 'PRO_SHOP', expiryUtcMs, plan: planCode, key };
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
  const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
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
  const orders = (await dbGetJson('flowly:orders', [])) || [];
  const issuedKeys = (await dbGetJson('flowly:issued_keys', [])) || [];
  const targetIdx = orders.findIndex((o) => o.orderCode === order.orderCode);
  const existing = targetIdx >= 0 ? orders[targetIdx] : order;

  if (existing.status === 'COMPLETED' && existing.key) {
    return existing;
  }

  const nonce4 = crypto.randomBytes(2).toString('hex').toUpperCase();
  const isLifeCombo = existing.planCode === 'LIFE' || existing.appId === 'all';
  const issueAppId = isLifeCombo ? 'all' : existing.appId;
  const proKey = signProKey(issueAppId, existing.hwid, existing.planCode, nonce4);
  const nowUtc = Date.now();
  const plan = PLANS[existing.planCode];
  const expiryUtcMs = existing.planCode === 'LIFE' ? 4102444800000 : nowUtc + (plan ? plan.hours * 3600 * 1000 : 7 * 86400000);

  const completed = {
    ...existing,
    status: 'COMPLETED',
    key: proKey,
    txId: txId || existing.txId || null,
    verifiedSource: source,
    completedAtUtc: nowUtc,
    expiryUtcMs,
  };

  if (targetIdx >= 0) orders[targetIdx] = completed;
  else orders.unshift(completed);
  await dbSetJson('flowly:orders', orders.slice(0, 500));

  issuedKeys.unshift({
    key: proKey,
    appId: completed.appId,
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
  });
  await dbSetJson('flowly:issued_keys', issuedKeys.slice(0, 800));

  await sendTelegram(
    `✅ <b>[FLOW SHOP] ĐÃ XÁC NHẬN THANH TOÁN & CẤP KEY PRO!</b>\n\n` +
    `📱 <b>App:</b> ${APPS[completed.appId]?.name || completed.appId}\n` +
    `📦 <b>Mã đơn:</b> <code>${completed.orderCode}</code>\n` +
    `💳 <b>Nội dung CK:</b> <code>${completed.memo}</code>\n` +
    `💰 <b>Số tiền:</b> <b>${Number(completed.price).toLocaleString('vi-VN')}đ</b>\n` +
    `🆔 <b>HWID:</b> <code>${completed.hwid}</code>\n` +
    `🔑 <b>Key PRO:</b> <code>${proKey}</code>\n` +
    `⚡ <b>Nguồn xác thực:</b> ${source}`
  );

  return completed;
}

