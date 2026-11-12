import { handlePreflight, parseBody, sendTelegram } from './_shared.js';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { orderCode, phone, hwid, appName, plan, price, method, createdAt, eventType } = await parseBody(req);
    if (!orderCode) {
      return res.status(400).json({ error: 'Missing orderCode' });
    }

    const title = eventType === 'CONFIRM_PAID'
      ? `🚨 <b>[FLOW SHOP] KHÁCH BÁO ĐÃ CHUYỂN TIỀN TPBANK!</b>`
      : `🔔 <b>[FLOW SHOP] CÓ ĐƠN HÀNG VIETQR MỚI!</b>`;

    const priceText = typeof price === 'number' ? price.toLocaleString('vi-VN') + ' VNĐ' : price;

    const message = `${title}\n\n` +
      `📱 <b>App:</b> ${appName || 'Flow Ecosystem'}\n` +
      `📦 <b>Mã Đơn / Nội Dung CK:</b> <code>${orderCode}</code>\n` +
      `👤 <b>Khách Hàng (SĐT/Zalo):</b> <code>${phone || 'Chưa cung cấp'}</code>\n` +
      `💎 <b>Gói Đặt Mua:</b> ${plan || 'Chưa rõ'}\n` +
      `💰 <b>Số Tiền:</b> <b>${priceText}</b>\n` +
      `📱 <b>Mã Máy HWID:</b> <code>${hwid || 'CHƯA_CÓ'}</code>\n` +
      `🏦 <b>Hình Thức:</b> ${method || 'VIETQR_TPB'}\n` +
      `⏰ <b>Thời Gian:</b> ${createdAt || new Date().toLocaleString('vi-VN')}\n\n` +
      `👉 <i>Kiểm tra App TPBank (10006503497) rồi bấm Duyệt trên Admin Dashboard nếu chưa bật SePay tự động!</i>`;

    const tgData = await sendTelegram(message);
    return res.status(200).json({ success: true, telegram: tgData });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}

