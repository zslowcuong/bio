# TÀI LIỆU TOÀN DIỆN DỰ ÁN: HỆ SINH THÁI FLOWLY & BROTX OPTIMIZER V8
> **Nguồn tài liệu chính thức dùng để nạp vào Google NotebookLM**  
> Bản quyền phát triển: Flowly Team (@xxd5974)  
> Trang web chính thức: https://zslowcuong.github.io/bio/  
> Nhóm hỗ trợ: https://t.me/FlowOpVip  

---

## 1. TỔNG QUAN HỆ SINH THÁI FLOWLY
Flowly là hệ sinh thái công cụ tối ưu hóa phần cứng và hiệu năng chuyên sâu cho điện thoại Android, hoạt động hoàn toàn **100% Không Cần Root (No Root)** thông qua đặc quyền máy chủ cục bộ **Shizuku ADB Shell (UID 2000)**.

### Bộ Ba Ứng Dụng Cốt Lõi:
1. **FlowS (Gamer Tuner)**:
   - Tự động nhận diện mở game (Liên Quân, Free Fire, PUBG, Tốc Chiến, Genshin Impact...).
   - Hạ độ phân giải riêng từng game (720p, 540p) giúp tăng 25 - 35 FPS, giảm tải nhiệt độ GPU và tiết kiệm pin.
   - Tự động hoàn trả độ phân giải gốc khi tắt màn hình hoặc vuốt thoát khỏi game.
   - Chế độ CRAZY Mode dồn RAM về đầu 3x / 4x (~3200MB khả dụng).
   - Nút 1-chạm sửa thanh pin trắng trên ColorOS / Realme UI.

2. **FlowOp (FlowOptimize)**:
   - Tích hợp 7 bộ Theme Anime độc quyền (Kimi no Na wa, Gojo Satoru, Naruto, One Piece, Conan...).
   - Chẩn đoán và chặn lỗi bóp xung nhiệt độ của các hãng: Xiaomi Joyose, Samsung GOS, Oppo/Realme, Vivo, Infinix.
   - Mini HUD nổi đo FPS thực tế trực tiếp từ `SurfaceFlinger` của Android (không phải FPS ảo màn hình), đo nhiệt độ Pin/CPU thời gian thực với mã màu động (Xanh <38°C, Vàng 39-42°C, Đỏ >43°C), và đo ping socket ms.
   - Low-Latency Audio Fix: Giảm độ trễ tai nghe Bluetooth/gaming không dây từ 200ms xuống dưới 38ms.
   - Edge Palm Rejection: Khóa chạm nhầm góc màn hình cong và chặn cử chỉ vuốt văng ra ngoài khi combat.
   - Smart Gaming DNS Switcher: 3 chế độ DNS (Nhà mạng ISP ping VN thấp nhất, Google Gaming DNS có ECS cho game quốc tế, AdGuard DoT chặn quảng cáo).

3. **FlowUltra (Open-Source Low-Level Suite)**:
   - Shappky 4-Stage Progressive Killer: Dọn dẹp tiến trình cứng đầu pkill -9.
   - Appzuku Greedy Restrictor: Khóa AppOps WakeLock chạy ngầm rác (TikTok, Facebook, Shopee).
   - Screen-Off Deep Doze: Ép CPU ngủ sâu force-idle khi tắt màn hình, pin đêm tụt < 1%.
   - AFK Extinguish 0-Nits: Tắt màn hình AMOLED 0-nits cày game đêm không hao pin.

---

## 2. ĐỘNG CƠ TỐI ƯU BROTX OPTIMIZER V8
BrotX v8 là công cụ can thiệp thông số hệ thống cục bộ qua Shizuku ADB, điều khiển trực tiếp các lệnh `settings put` thuộc 3 bảng `global`, `secure` và `system`.

### Các Đặc Tính Kỹ Thuật Cốt Lõi:
* **Độ an toàn tuyệt đối**: Giao tiếp qua Binder IPC (UID 2000 shell), không can thiệp phân vùng `/system`, không nhảy cờ Samsung Knox (0x0), an toàn 100% với ứng dụng ngân hàng và VNeID.
* **Cơ chế Snapshot Hoàn tác**: Tự động chụp bản sao lưu xuất xưởng vào cơ sở dữ liệu Room SQLite trước mọi can thiệp, cho phép khôi phục từng cờ hoặc toàn bộ máy bất cứ lúc nào.
* **4 Hồ sơ Cấu hình (Profiles)**:
  1. `factory_stock`: Trả toàn bộ 64 cờ về mặc định xuất xưởng ban đầu.
  2. `balanced_smooth`: Hoạt cảnh 0.5x, tần số quét mượt mà, chặn cờ telemetry, kích hoạt Speed Mode QoS = 1, tắt App Standby Buckets để thông báo không bị trễ 0ms.
  3. `gaming_boost`: Ép trần tần số quét phần cứng (lên đến 144Hz vật lý), kích hoạt DSCP Expedited Forwarding QoS mạng game, hạ 0ms độ trễ cảm ứng, can thiệp bypass GOS và RAM Plus. *Đặc biệt: Nhận diện an toàn GPU Mali (Dimensity, Exynos, Kirin) để tắt mặc định ANGLE Vulkan nhằm tránh lỗi mất icon và font đồng hồ khóa.*
  4. `ultra_battery_saver`: Khóa 60Hz, tắt quét Bluetooth/Wi-Fi ngầm, giới hạn tiến trình nền tối đa 2 app.
* **6 Cờ Tinh Chỉnh Mới Của V8**:
  - `global.speed_mode = 1`: QoS hàng đợi socket game.
  - `global.app_standby_enabled = 0`: Tắt đóng băng app ngầm.
  - `global.verifier_verify_adb_installs = 0`: Bỏ qua quét ADB, cài APK tức thì.
  - `global.device_config_sync_disabled = 1`: Chặn Google Play Services tự sync đè cờ tối ưu.
  - `secure.navigation_gestures_vibrate = 0`: Tắt rung cử chỉ vuốt bảo vệ motor rung.
  - `secure.charging_vibration_enabled = 0`: Tắt rung cắm sạc yên tĩnh ban đêm.
* **UAD Debloater 3 Lớp An Toàn**:
  - Phân vùng `/system/`: Dùng `pm uninstall -k --user 0`.
  - Phân vùng `/data/app/`: Dùng `pm disable-user --user 0` để giữ lại file APK trên đĩa, cho phép khôi phục 1 chạm mà không bị mất app.

---

## 3. CẨM NANG HƯỚNG DẪN KÍCH HOẠT SHIZUKU TỪNG HÃNG MÁY

### Cách 1: Tự Động 1-Click Bằng Máy Tính (Khuyên Dùng Nhất)
* Cắm cáp điện thoại vào máy tính (đã bật Gỡ lỗi USB).
* Chạy file `TU_DONG_KICH_HOAT_SHIZUKU_VA_CAI_APP.bat` trên Desktop.
* Máy tính tự cài đặt FlowOptimize.apk, BrotX-v8.apk, tự kích hoạt Shizuku Server và tự cấp trước toàn bộ đặc quyền hệ thống trong 5 giây!

### Cách 2: Ghép Đôi Không Dây Qua Wi-Fi Trên Điện Thoại
1. **Xiaomi / POCO / HyperOS / MIUI (Bắt buộc 3 công tắc)**:
   - Vào Tùy chọn nhà phát triển: Gạt bật cả 3 mục: *Gỡ lỗi USB*, *Cài đặt qua USB*, và *Gỡ lỗi USB (Cài đặt bảo mật)*.
   - *Lưu ý sống còn*: Mục bảo mật yêu cầu phải lắp SIM có mạng 4G/5G và đăng nhập tài khoản Mi Account.
2. **Samsung Galaxy (One UI 4 - 7)**:
   - Bật *Gỡ lỗi không dây* trong Cài đặt cho người phát triển.
   - *Mẹo vàng*: Mở **Chia đôi màn hình (Split Screen)** hoặc **Cửa sổ nổi**, đặt Shizuku nửa trên và Cài đặt nửa dưới để nhập mã 6 số mà không bị hệ thống reset cổng Port!
3. **OPPO / Realme / OnePlus (ColorOS / Realme UI)**:
   - Tắt mục *"Tự động tắt gỡ lỗi sau 10 phút"*.
   - Bật mục *"Vô hiệu hóa giám sát quyền"*.
   - Sau khi kết nối, dùng nút *Sửa Thanh Pin Trắng* trong FlowOp để sửa lỗi thanh pin xanh.
4. **Vivo / iQOO / Google Pixel / Android thuần**:
   - Bật Gỡ lỗi không dây, lấy mã 6 số từ thông báo Shizuku và bấm Start.

---

## 4. BỘ CÂU HỎI THƯỜNG GẶP (FAQ)
* **Hỏi: Dùng Shizuku và FlowOp có bị mất bảo hành hoặc cấm nick game không?**  
  *Trả lời*: Hoàn toàn không. Shizuku chỉ sử dụng giao diện lập trình ADB chính thức của Android cấp quyền UID 2000, không sửa đổi file hệ thống gốc, không nhảy Knox 0x0 và không can thiệp bộ nhớ game nên 100% an toàn, không bị cấm nick.
* **Hỏi: Đổi DNS Gaming có làm tăng ping không?**  
  *Trả lời*: Nếu ép cứng Cloudflare 1.1.1.1 có thể bị tăng ping do thiếu EDNS Client Subnet (ECS) khiến bị điều hướng sang server Singapore. FlowOp giải quyết bằng cách cung cấp chế độ DNS Nhà Mạng ISP (ping 10-15ms nội địa), Google DNS (có ECS) và tích hợp sẵn nút đo ping ms thực tế.
* **Hỏi: Khi khởi động lại máy có bị mất Shizuku không?**  
  *Trả lời*: Khi điện thoại khởi động lại, dịch vụ Shizuku cần được bật lại qua Wi-Fi (chỉ cần bấm Start, không cần nhập lại mã) hoặc cắm cáp chạy file `.bat` 1-click trong 3 giây.
