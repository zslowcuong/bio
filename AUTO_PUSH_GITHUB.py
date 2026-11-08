import os
import sys
import subprocess

sys.stdout.reconfigure(encoding='utf-8')

print("=" * 70)
print("     ⚡ FLOW ECOSYSTEM - TỰ ĐỘNG ĐẨY MÃ NGUỒN LÊN GITHUB PAGES")
print("=" * 70)

bio_dir = r"C:\Users\Admin\Desktop\Upload_Len_GitHub_Bio"
git_exe = r"C:\Program Files\Git\cmd\git.exe"

if not os.path.exists(git_exe):
    git_exe = "git"

print("\n[1/3] Đang kiểm tra và thêm tất cả file thay đổi...")
subprocess.run([git_exe, "add", "-A"], cwd=bio_dir)

print("\n[2/3] Đang tạo Commit lưu trữ phiên bản mới...")
p_commit = subprocess.run([git_exe, "commit", "-m", "Auto deploy: FlowOptimize v1.4.0, Magic Tuner Premium & Fix Real FPS"], cwd=bio_dir, capture_output=True, text=True, encoding='utf-8', errors='replace')
if "nothing to commit" in p_commit.stdout or "nothing to commit" in p_commit.stderr:
    print("  -> Mã nguồn hiện tại đã đồng bộ sẵn sàng, tiếp tục đẩy lên GitHub...")
else:
    print("  ✅ Đã tạo Commit thành công!")

print("\n[3/3] Đang kết nối và đẩy (Push) lên GitHub: https://github.com/zslowcuong/bio.git ...")
print("  (Nếu có cửa sổ đăng nhập trình duyệt hiện lên, vui lòng bấm Authorize 1 lần)")
print("-" * 70)

p_push = subprocess.run([git_exe, "push", "origin", "main"], cwd=bio_dir)

print("-" * 70)
if p_push.returncode == 0:
    print("\n🎉 CHÚC MỪNG! ĐÃ PUSH THÀNH CÔNG LÊN GITHUB 100%!")
    print("👉 Trang Bio Live: https://zslowcuong.github.io/bio/")
    print("👉 GitHub Repo:    https://github.com/zslowcuong/bio")
    print("Web sẽ tự động cập nhật sau 5 - 10 giây.")
else:
    print("\n❌ Quá trình Push chưa hoàn tất (Exit code: " + str(p_push.returncode) + ")")
    print("Nếu cần đăng nhập, vui lòng kiểm tra cửa sổ trình duyệt.")

print("=" * 70)
