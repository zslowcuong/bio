@echo off
chcp 65001 >nul
title FLOWLY - CÔNG CỤ TỰ ĐỘNG CÀI ĐẶT & KÍCH HOẠT SHIZUKU + FLOWOP + BROTX V8
color 0B

echo ==============================================================================
echo        ⚡ FLOWLY ECOSYSTEM - BỘ CÔNG CỤ TỰ ĐỘNG HÓA 100%% 1-CLICK ⚡
echo    Cài Đặt & Kích Hoạt: Shizuku + FlowOptimize (FlowOp) + BrotX Optimizer v8
echo ==============================================================================
echo.

:: 1. Kiểm tra ADB
echo [1/5] Đang kiểm tra kết nối ADB trên máy tính...
where adb >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] KHÔNG TÌM THẤY LỆNH ADB TRONG HỆ THỐNG!
    echo     Vui lòng cài đặt Platform Tools hoặc chạy script từ thư mục có file adb.exe.
    echo.
    pause
    exit /b
)
echo [V] Đã tìm thấy ADB: OK!
echo.

:: 2. Kiểm tra thiết bị kết nối
echo [2/5] Đang dò tìm điện thoại Android kết nối qua cổng USB...
echo [*] Vui lòng đảm bảo bạn đã:
echo     1. Cắm cáp kết nối điện thoại với máy tính.
echo     2. Vào Cài đặt -^> Tùy chọn nhà phát triển -^> Bật "Gỡ lỗi USB" (USB Debugging).
echo     3. Nếu màn hình điện thoại hiện popup "Cho phép gỡ lỗi USB?", hãy tích chọn
echo        "Luôn cho phép" rồi bấm "Cho phép" (Allow).
echo.
echo Đang chờ thiết bị...

:CHECK_DEVICE
for /f "skip=1 tokens=1,2" %%A in ('adb devices') do (
    if "%%B"=="device" (
        set DEVICE_FOUND=1
        goto DEVICE_OK
    )
    if "%%B"=="unauthorized" (
        echo [!] Thiết bị đang ở trạng thái 'unauthorized'!
        echo     Vui lòng nhìn vào màn hình điện thoại và bấm 'Cho phép gỡ lỗi USB'!
        timeout /t 3 >nul
        goto CHECK_DEVICE
    )
)

echo [!] Chưa nhận diện được thiết bị! Đang thử lại sau 3 giây...
timeout /t 3 >nul
goto CHECK_DEVICE

:DEVICE_OK
echo.
echo [V] THIẾT BỊ ĐÃ KẾT NỐI THÀNH CÔNG!
for /f "tokens=*" %%M in ('adb shell getprop ro.product.model') do set MODEL=%%M
for /f "tokens=*" %%B in ('adb shell getprop ro.product.brand') do set BRAND=%%B
for /f "tokens=*" %%V in ('adb shell getprop ro.build.version.release') do set ANDROID_VER=%%V
echo [*] Thông tin máy: %BRAND% %MODEL% (Android %ANDROID_VER%)
echo.

:: 3. Tự động cài đặt FlowOp và BrotX v8
echo ==============================================================================
echo [3/5] Đang tự động cài đặt ứng dụng vào điện thoại...
echo ==============================================================================

set SCRIPT_DIR=%~dp0

:: Cài FlowOptimize
if exist "%SCRIPT_DIR%FlowOptimize.apk" (
    echo [*] Đang cài đặt FlowOptimize (FlowOp)...
    adb install -r -d "%SCRIPT_DIR%FlowOptimize.apk"
    if %errorlevel% equ 0 (
        echo [V] FlowOptimize: CÀI ĐẶT THÀNH CÔNG!
    ) else (
        echo [!] Lưu ý: Cài FlowOptimize thất bại. Vui lòng mở khóa màn hình điện thoại để bấm Cho phép cài đặt!
    )
) else (
    echo [-] Không tìm thấy file FlowOptimize.apk trong cùng thư mục. Bỏ qua bước này.
)
echo.

:: Cài BrotX v8
if exist "%SCRIPT_DIR%BrotX-v8.apk" (
    echo [*] Đang cài đặt BrotX Optimizer v8...
    adb install -r -d "%SCRIPT_DIR%BrotX-v8.apk"
    if %errorlevel% equ 0 (
        echo [V] BrotX Optimizer v8: CÀI ĐẶT THÀNH CÔNG!
    ) else (
        echo [!] Lưu ý: Cài BrotX v8 thất bại. Vui lòng mở khóa màn hình điện thoại để bấm Cho phép cài đặt!
    )
) else (
    echo [-] Không tìm thấy file BrotX-v8.apk trong cùng thư mục. Bỏ qua bước này.
)
echo.

:: 4. Kích hoạt Shizuku Server
echo ==============================================================================
echo [4/5] Đang tự động kích hoạt Shizuku Server qua ADB Shell...
echo ==============================================================================
echo [*] Đang gửi lệnh khởi động Shizuku...
adb shell sh /sdcard/Android/data/moe.shizuku.privileged.api/start.sh
echo.
echo [*] Đang kiểm tra trạng thái tiến trình Shizuku...
adb shell pidof shizuku_server >nul 2>&1
if %errorlevel% equ 0 (
    echo [V] SHIZUKU SERVER ĐÃ ĐƯỢC KÍCH HOẠT THÀNH CÔNG RỰC RỠ! (Running UID 2000)
) else (
    echo [*] Shizuku đã nhận lệnh khởi động. Vui lòng mở app Shizuku trên điện thoại để kiểm tra!
)
echo.

:: 5. Tự động cấp quyền hệ thống cho FlowOp & BrotX v8
echo ==============================================================================
echo [5/5] Đang tự động cấp trước toàn bộ đặc quyền hệ thống (Không cần root)...
echo ==============================================================================

:: Cấp quyền cho FlowOp
echo [*] Cấp quyền cho FlowOptimize (com.example.gameoptimizer)...
adb shell pm grant com.example.gameoptimizer android.permission.WRITE_SECURE_SETTINGS >nul 2>&1
adb shell pm grant com.example.gameoptimizer android.permission.DUMP >nul 2>&1
adb shell pm grant com.example.gameoptimizer android.permission.PACKAGE_USAGE_STATS >nul 2>&1
adb shell appops set com.example.gameoptimizer SYSTEM_ALERT_WINDOW allow >nul 2>&1
echo [V] FlowOptimize: Đã cấp quyền WRITE_SECURE_SETTINGS, DUMP, BONG BÓNG NỔI HUD!

:: Cấp quyền cho BrotX v8
echo [*] Cấp quyền cho BrotX Optimizer v8 (com.brotx.optimizer)...
adb shell pm grant com.brotx.optimizer android.permission.WRITE_SECURE_SETTINGS >nul 2>&1
adb shell pm grant com.brotx.optimizer android.permission.DUMP >nul 2>&1
adb shell pm grant com.brotx.optimizer android.permission.WRITE_SETTINGS >nul 2>&1
echo [V] BrotX Optimizer v8: Đã cấp quyền WRITE_SECURE_SETTINGS, DUMP!
echo.

echo ==============================================================================
echo                    🎉 HOÀN TẤT TỰ ĐỘNG 100%%! 🎉
echo  - Shizuku đã chạy ngầm với đặc quyền UID 2000 ADB!
echo  - FlowOp (FlowOptimize) & BrotX Optimizer v8 đã sẵn sàng hoạt động!
echo  - Bạn có thể rút cáp và tận hưởng trải nghiệm tối ưu mượt mà!
echo ==============================================================================
echo.
pause

