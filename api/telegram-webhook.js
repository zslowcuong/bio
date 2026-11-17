import { handlePreflight, parseBody, dbGetJson, dbSetJson } from './_shared.js';

const BIO_URL = 'https://zslowcuong.github.io/bio/';
const SHOP_URL = 'https://zslowcuong.github.io/bio/shop.html';
const LOOKUP_URL = 'https://zslowcuong.github.io/bio/shop.html#lookup';
const GUIDE_URL = 'https://zslowcuong.github.io/bio/huongdan.html';
const FLOWOP_APK = 'https://zslowcuong.github.io/bio/FlowOptimize.apk';
const VOIDADB_APK = 'https://zslowcuong.github.io/bio/VOID_ADB_VIE.apk';
const ADMIN_TG = 'https://t.me/+dtVBEzwuN2Q4NmI9';

async function getBotToken(customToken = null) {
  if (customToken) return customToken;
  if (process.env.TELEGRAM_BOT_TOKEN) return process.env.TELEGRAM_BOT_TOKEN;
  try {
    const dbToken = await dbGetJson('flowly:telegram_bot_token', '');
    if (dbToken) return String(dbToken).trim();
  } catch (e) {}
  return '';
}

async function callTelegram(method, payload, explicitToken = null) {
  const token = await getBotToken(explicitToken);
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN_NOT_CONFIGURED' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function getMainMenu(name = 'Bạn') {
  const text =
    `👋 <b>XIN CHÀO ${name.toUpperCase()} ĐẾN VỚI CSKH FLOW ECOSYSTEM!</b> 🤖\n\n` +
    `Hệ thống trợ lý tự động 24/7 trực thuộc <b>Flowly Engine</b>.\n` +
    `Tôi có thể hỗ trợ bạn khắc phục lỗi máy, giải đáp thắc mắc hoặc hướng dẫn mua & nhận Key PRO tự động ngay tức thì.\n\n` +
    `👉 <i>Vui lòng chọn chủ đề bên dưới hoặc gõ trực tiếp câu hỏi:</i>`;

  const reply_markup = {
    inline_keyboard: [
      [
        { text: '🔋 Khôi Phục Pin Trắng (Redmi / HyperOS)', callback_data: 'faq_pin_white' }
      ],
      [
        { text: '🛒 Bảng Giá & Mua Key PRO', callback_data: 'faq_pricing' },
        { text: '🔄 Đổi Máy HWID / Tra Cứu Key', callback_data: 'faq_lookup' }
      ],
      [
        { text: '📦 Kho Tải 5 App Flow & VOID ADB', callback_data: 'faq_downloads' },
        { text: '🛠️ Hướng Dẫn Kích Hoạt Shizuku', callback_data: 'faq_shizuku' }
      ],
      [
        { text: '🌌 Siêu Công Cụ VOID ADB VIE (Mới)', callback_data: 'faq_voidadb' }
      ],
      [
        { text: '🌐 Mở Trang Web Bio Chính Thức', url: BIO_URL },
        { text: '👤 Nhóm Hỗ Trợ Telegram Admin', url: ADMIN_TG }
      ]
    ]
  };

  return { text, reply_markup };
}

function getFaqContent(topic) {
  switch (topic) {
    case 'faq_pin_white':
      return {
        text:
          `🔋 <b>HƯỚNG DẪN KHÔI PHỤC PIN TRẮNG (REDMI 12 / XIAOMI / HYPEROS)</b>\n\n` +
          `<b>1. Tại sao pin lại biến thành màu xanh biển / xanh ngọc?</b>\n` +
          `• Trên Xiaomi HyperOS / MIUI, hệ thống có 3 chế độ hiển thị pin:\n` +
          `  - <i>Tiết kiệm pin</i>: Màu Vàng / Cam\n` +
          `  - <i>Cân bằng (Mặc định gốc)</i>: <b>MÀU TRẮNG</b>\n` +
          `  - <i>Hiệu năng cao</i>: <b>MÀU XANH BIỂN</b>\n` +
          `• Khi kích hoạt tính năng hiệu năng trong app, máy lưu cài đặt vào hệ điều hành. Dù có xoá app thì Android vẫn giữ màu xanh này!\n\n` +
          `<b>2. Cách xử lý cực nhanh trong 3 giây (Làm bằng tay):</b>\n` +
          `• <b>Bước 1:</b> Mở <b>Cài đặt (Settings)</b> trên điện thoại.\n` +
          `• <b>Bước 2:</b> Chọn mục <b>Pin (Battery)</b>.\n` +
          `• <b>Bước 3:</b> Gạt thanh trượt 3 nấc về nấc ở giữa: <b>"Cân bằng" (Balanced)</b>.\n` +
          `👉 <i>Ngay lập tức viên pin sẽ đổi lại thành <b>MÀU TRẮNG</b> nguyên bản!</i>\n\n` +
          `<b>3. Hoặc dùng tính năng cứu hộ trong App:</b>\n` +
          `Bản cập nhật <b>FlowOptimize v1.8.1</b> mới nhất đã tích hợp nút <b>🔋 [KHÔI PHỤC PIN TRẮNG]</b> 1-chạm giúp tự động khôi phục chế độ cân bằng và driver pin chuẩn.`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 Tải Bản Cập Nhật FlowOptimize v1.8.1', url: FLOWOP_APK }],
            [{ text: '↩️ Quay Lại Menu Chính', callback_data: 'menu_main' }]
          ]
        }
      };

    case 'faq_pricing':
      return {
        text:
          `🛒 <b>BẢNG GIÁ KEY PRO TRỌN BỘ HỆ SINH THÁI FLOW</b>\n\n` +
          `Duy nhất 1 Mã Key PRO kích hoạt dùng được <b>TRỌN BỘ 5 APP</b> (FlowOptimize, FlowS Gamer, FlowUltra, FlowExtra & FlowZ VIP):\n\n` +
          `💎 <b>Gói Tuần (7 Ngày):</b> <code>29.000đ</code>\n` +
          `💎 <b>Gói Tháng (30 Ngày):</b> <code>59.000đ</code>\n` +
          `👑 <b>Gói Vĩnh Viễn (LifeTime):</b> <code>149.000đ</code>\n` +
          `<i>(Đặc quyền Gói Vĩnh Viễn: Dùng full 5 app vĩnh viễn, miễn phí 2 lần đổi máy HWID tự động).</i>\n\n` +
          `⚡ <b>HỆ THỐNG DUYỆT TIỀN & CẤP KEY TỰ ĐỘNG 24/7 (SEPAY):</b>\n` +
          `1. Truy cập Shop: ${SHOP_URL}\n` +
          `2. Nhập Số điện thoại & Mã HWID máy của bạn ➔ Bấm <b>Tạo Đơn Thanh Toán</b>.\n` +
          `3. Quét mã VietQR chuyển khoản ➔ Hệ thống tự động nhận tiền và bung Key PRO trên màn hình trong 3 giây!`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Mở Cổng Shop Mua Key Tự Động', url: SHOP_URL }],
            [{ text: '↩️ Quay Lại Menu Chính', callback_data: 'menu_main' }]
          ]
        }
      };

    case 'faq_downloads':
      return {
        text:
          `📦 <b>KHO TẢI ỨNG DỤNG FLOW ECOSYSTEM & VOID ADB VIE</b>\n\n` +
          `Tất cả ứng dụng hoạt động tối ưu 100% qua Shizuku (Không cần Root):\n\n` +
          `1. 🚀 <b>FlowOptimize v1.8.1:</b> Tối ưu GPU, hạ độ phân giải riêng từng game & cứu hộ pin trắng.\n` +
          `2. ⚡ <b>FlowS Gamer v1.4.0:</b> Tối ưu hóa FPS, ổn định combat mượt mà.\n` +
          `3. 🎮 <b>FlowUltra eSports v1.3.0:</b> Ép xung phần cứng, gia tốc cảm ứng siêu nhạy.\n` +
          `4. 🃏 <b>FlowExtra 1412 (Kaito Kid):</b> Tinh chỉnh UI & giải phóng RAM trống tối đa.\n` +
          `5. 🎯 <b>FlowZ VIP:</b> Chỉnh độ nhạy & kéo tâm chuẩn xác.\n` +
          `6. 🌌 <b>VOID ADB VIE (Mới):</b> Bản Việt Hóa 100%, ép xung GPU & Mod By FlowEngine.\n\n` +
          `👉 <i>Bạn có thể truy cập kho tải tổng hợp bên dưới:</i>`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🌐 Mở Kho Tải Web Bio', url: BIO_URL }],
            [{ text: '🌌 Tải Ngay VOID ADB VIE (APK)', url: VOIDADB_APK }],
            [{ text: '↩️ Quay Lại Menu Chính', callback_data: 'menu_main' }]
          ]
        }
      };

    case 'faq_shizuku':
      return {
        text:
          `🛠️ <b>HƯỚNG DẪN KÍCH HOẠT SHIZUKU (100% KHÔNG CẦN ROOT)</b>\n\n` +
          `<b>Cách 1: Kích hoạt trực tiếp qua Wi-Fi (Android 11 trở lên)</b>\n` +
          `1. Cài đặt <b>Shizuku</b> từ trang Bio.\n` +
          `2. Vào <b>Cài đặt máy ➔ Tuỳ chọn nhà phát triển ➔ Bật Gỡ lỗi không dây (Wireless Debugging)</b>.\n` +
          `3. Mở Shizuku bấm <b>Ghép nối (Pairing)</b> ➔ Nhập 6 số mã ghép nối từ thanh thông báo.\n` +
          `4. Quay lại Shizuku bấm <b>Khởi động (Start)</b> ➔ Màn hình báo <i>"Shizuku đang chạy"</i> là xong!\n\n` +
          `<b>Cách 2: Kích hoạt bằng máy tính PC (Mọi phiên bản Android)</b>\n` +
          `1. Bật Gỡ lỗi USB trên điện thoại, cắm cáp kết nối vào máy tính.\n` +
          `2. Tải file <code>TU_DONG_KICH_HOAT_SHIZUKU_VA_CAI_APP.bat</code> trên web Bio về máy tính và nhấp đúp chuột.\n` +
          `3. Tool tự động nhận diện và kích hoạt Shizuku sau 5 giây!`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '📖 Xem Hướng Dẫn Chi Tiết Kèm Ảnh', url: GUIDE_URL }],
            [{ text: '↩️ Quay Lại Menu Chính', callback_data: 'menu_main' }]
          ]
        }
      };

    case 'faq_lookup':
      return {
        text:
          `🔄 <b>TRA CỨU ĐƠN HÀNG & ĐỔI THIẾT BỊ (HWID)</b>\n\n` +
          `• <b>Quên / Mất mã Key:</b> Nhập Số điện thoại hoặc Mã đơn hàng (ORD...) tại trang tra cứu để lấy lại mã Key PRO.\n` +
          `• <b>Đổi sang điện thoại mới:</b>\n` +
          `  - Khách hàng sở hữu <b>Gói Vĩnh Viễn</b> được hỗ trợ chuyển Key sang máy mới <b>2 Lần Miễn Phí</b> trực tiếp trên hệ thống.\n` +
          `  - Chỉ cần nhập Mã Key cũ và Mã HWID máy mới, hệ thống sẽ tự động cập nhật ngay lập tức!`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔍 Mở Cổng Tra Cứu & Đổi HWID', url: LOOKUP_URL }],
            [{ text: '↩️ Quay Lại Menu Chính', callback_data: 'menu_main' }]
          ]
        }
      };

    case 'faq_voidadb':
      return {
        text:
          `🌌 <b>SIÊU CÔNG CỤ VOID ADB VIE (MOD BY FLOWENGINE)</b>\n\n` +
          `• <b>Bản Việt Hóa 100%:</b> Toàn bộ giao diện & tính năng được dịch chuẩn Tiếng Việt.\n` +
          `• <b>Ép xung GPU Vulkan UI:</b> Tối ưu hóa hiệu năng và độ mượt khi combat.\n` +
          `• <b>Triệt tiêu lỗi Anti-Tamper:</b> Đã gỡ bỏ vĩnh viễn thông báo <i>"Bản sao này đã được sửa đổi"</i>, chạy mượt mà trên mọi máy.\n` +
          `• <b>Hoạt động qua Shizuku:</b> An toàn tuyệt đối không cần can thiệp Root máy.\n\n` +
          `👉 <i>Tải xuống bản APK chính thức tại link bên dưới:</i>`,
        reply_markup: {
          inline_keyboard: [
            [{ text: '📥 Tải Xuống VOID ADB VIE APK', url: VOIDADB_APK }],
            [{ text: '↩️ Quay Lại Menu Chính', callback_data: 'menu_main' }]
          ]
        }
      };

    default:
      return null;
  }
}

function matchSmartAnswer(userMsg = '') {
  const msg = userMsg.toLowerCase().trim();

  // 1. Pin xanh / Redmi / Xiaomi
  if (/(pin\s*xanh|pin\s*trắng|màu\s*xanh|xanh\s*biển|redmi|xiaomi|hyperos|cứu\s*pin)/i.test(msg)) {
    return {
      topic: 'faq_pin_white',
      lead: `🔋 <b>Tôi thấy bạn đang hỏi về lỗi PIN XANH trên Redmi / Xiaomi!</b>\n\n`
    };
  }

  // 2. Giá / Mua key / Thanh toán
  if (/(giá|bao\s*nhiêu|mua\s*key|bảng\s*giá|chuyển\s*khoản|stk|thanh\s*toán|sepay|gói|nạp)/i.test(msg)) {
    return {
      topic: 'faq_pricing',
      lead: `🛒 <b>Thông tin bảng giá & hướng dẫn mua Key PRO tự động 24/7:</b>\n\n`
    };
  }

  // 3. VOID ADB
  if (/(void|void\s*adb|bản\s*sửa\s*đổi|bản\s*sao)/i.test(msg)) {
    return {
      topic: 'faq_voidadb',
      lead: `🌌 <b>Thông tin về siêu công cụ VOID ADB VIE (Mod By FlowEngine):</b>\n\n`
    };
  }

  // 4. Shizuku
  if (/(shizuku|ghép\s*nối|pairing|mã\s*ghép|không\s*kết\s*nối|lỗi\s*shizuku)/i.test(msg)) {
    return {
      topic: 'faq_shizuku',
      lead: `🛠️ <b>Hướng dẫn cài đặt & kích hoạt Shizuku:</b>\n\n`
    };
  }

  // 5. Đổi máy / HWID
  if (/(đổi\s*máy|hwid|máy\s*mới|mất\s*key|tra\s*cứu|đơn\s*hàng)/i.test(msg)) {
    return {
      topic: 'faq_lookup',
      lead: `🔄 <b>Hướng dẫn tra cứu đơn hàng & đổi thiết bị HWID:</b>\n\n`
    };
  }

  // 6. Tải app / Link
  if (/(tải|link|download|cài\s*đặt|file\s*apk|apk)/i.test(msg)) {
    return {
      topic: 'faq_downloads',
      lead: `📦 <b>Danh sách kho tải ứng dụng Flow Ecosystem:</b>\n\n`
    };
  }

  // 7. Gặp Admin / Hỗ trợ
  if (/(admin|ad\s*ơi|alo|hỗ\s*trợ|cứu|giúp|tư\s*vấn)/i.test(msg)) {
    return {
      custom: true,
      text:
        `👤 <b>LIÊN HỆ TRỰC TIẾP ADMIN FLOWLY</b>\n\n` +
        `Yêu cầu của bạn đã được ghi nhận! Bạn có thể nhắn tin trực tiếp trong nhóm hỗ trợ hoặc liên hệ Admin để được giải quyết nhanh nhất:\n\n` +
        `👉 <b>Nhóm Hỗ Trợ Telegram:</b> ${ADMIN_TG}\n` +
        `👉 <b>Kênh TikTok:</b> https://www.tiktok.com/@xxd5974\n\n` +
        `<i>Nếu có câu hỏi về lỗi pin hoặc mua key, bạn có thể chọn menu bên dưới để được giải đáp tự động ngay lập tức:</i>`,
      reply_markup: {
        inline_keyboard: [
          [{ text: '👤 Vào Nhóm Hỗ Trợ Admin', url: ADMIN_TG }],
          [{ text: '↩️ Xem Menu Hỗ Trợ Tự Động', callback_data: 'menu_main' }]
        ]
      }
    };
  }

  return null;
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;

  const url = new URL(req.url, `https://${req.headers.host || 'bio-seven-nu.vercel.app'}`);
  const passedToken = String(url.searchParams.get('token') || '').trim();
  if (passedToken) {
    try {
      await dbSetJson('flowly:telegram_bot_token', passedToken);
    } catch (e) {}
  }

  const token = await getBotToken(passedToken);

  // GET request: Diagnostics & Set Webhook helper
  if (req.method === 'GET') {
    const host = req.headers.host || 'bio-seven-nu.vercel.app';
    const webhookUrl = `https://${host}/api/telegram-webhook`;

    if (url.searchParams.get('set_webhook') === '1') {
      if (!token) {
        return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN is not configured. Pass ?token=YOUR_BOT_TOKEN to configure it.' });
      }
      const setRes = await callTelegram('setWebhook', { url: webhookUrl }, token);
      const meRes = await callTelegram('getMe', {}, token);
      return res.status(200).json({
        success: setRes.ok === true,
        webhookUrl,
        telegramResult: setRes,
        botInfo: meRes
      });
    }

    if (url.searchParams.get('info') === '1') {
      if (!token) {
        return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN is not configured' });
      }
      const infoRes = await callTelegram('getWebhookInfo', {}, token);
      const meRes = await callTelegram('getMe', {}, token);
      return res.status(200).json({ webhookInfo: infoRes, bot: meRes });
    }

    return res.status(200).json({
      status: 'ready',
      message: 'Flow Telegram CSKH Webhook is active 24/7',
      tokenConfigured: Boolean(token),
      webhookEndpoint: webhookUrl,
      instructions: 'Open /api/telegram-webhook?set_webhook=1 (hoặc thêm &token=YOUR_TOKEN) để kích hoạt webhook.'
    });
  }

  // POST request: Telegram webhook event
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const update = await parseBody(req);
    if (!update) {
      return res.status(200).json({ ok: true, note: 'Empty update' });
    }

    // 1. Handle Callback Query (Button clicks)
    if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = cq.message?.chat?.id;
      const messageId = cq.message?.message_id;
      const data = cq.data || '';

      await callTelegram('answerCallbackQuery', { callback_query_id: cq.id });

      if (data === 'menu_main') {
        const menu = getMainMenu(cq.from?.first_name || 'Bạn');
        if (chatId && messageId) {
          await callTelegram('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: menu.text,
            parse_mode: 'HTML',
            reply_markup: menu.reply_markup,
            disable_web_page_preview: true
          });
        }
      } else {
        const faq = getFaqContent(data);
        if (faq && chatId && messageId) {
          await callTelegram('editMessageText', {
            chat_id: chatId,
            message_id: messageId,
            text: faq.text,
            parse_mode: 'HTML',
            reply_markup: faq.reply_markup,
            disable_web_page_preview: true
          });
        }
      }
      return res.status(200).json({ ok: true });
    }

    // 2. Handle Message
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat?.id;
      const text = String(msg.text || '').trim();
      const senderName = msg.from?.first_name || 'Bạn';

      if (!chatId || !text) {
        return res.status(200).json({ ok: true });
      }

      // /start or /menu command
      if (/^\/(start|menu|help)/i.test(text)) {
        const menu = getMainMenu(senderName);
        await callTelegram('sendMessage', {
          chat_id: chatId,
          text: menu.text,
          parse_mode: 'HTML',
          reply_markup: menu.reply_markup,
          disable_web_page_preview: true
        });
        return res.status(200).json({ ok: true });
      }

      // Check smart NLP match
      const matched = matchSmartAnswer(text);
      if (matched) {
        if (matched.custom) {
          await callTelegram('sendMessage', {
            chat_id: chatId,
            text: matched.text,
            parse_mode: 'HTML',
            reply_markup: matched.reply_markup,
            disable_web_page_preview: true
          });
        } else {
          const faq = getFaqContent(matched.topic);
          if (faq) {
            await callTelegram('sendMessage', {
              chat_id: chatId,
              text: (matched.lead || '') + faq.text,
              parse_mode: 'HTML',
              reply_markup: faq.reply_markup,
              disable_web_page_preview: true
            });
          }
        }
        return res.status(200).json({ ok: true });
      }

      // Default fallback for unmatched messages
      const fallbackText =
        `👋 Cảm ơn <b>${senderName}</b> đã gửi tin nhắn!\n\n` +
        `Tôi là trợ lý tự động của <b>Flowly Engine</b>. Câu hỏi của bạn đã được ghi nhận.\n` +
        `Dưới đây là các chủ đề thường gặp nhất, bạn hãy chạm vào nút tương ứng để nhận câu trả lời ngay nhé:`;

      const menu = getMainMenu(senderName);
      await callTelegram('sendMessage', {
        chat_id: chatId,
        text: fallbackText,
        parse_mode: 'HTML',
        reply_markup: menu.reply_markup,
        disable_web_page_preview: true
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
