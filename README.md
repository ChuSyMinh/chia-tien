# Chia Tiền Chung

Web app chia tiền chung (thay cho Google Sheet "Tiền chung.final"). Chạy bằng Node.js, không cần `npm install`.

## Cách hoạt động (giống sheet)
- Mỗi tháng là một trang riêng. Mỗi khoản chi: **Mua gì – Người mua – Giá (nghìn đ)** + tick **ai dùng chung**.
- Cột **Lẻ** = Giá ÷ số người được tick.
- **Số dư** mỗi người = tổng đã mua − tổng phần dùng (làm tròn như hàm `ROUND` của Sheets). `+` = được nhận, `−` = phải trả.
- Tab **Thanh toán**: tự tính ai chuyển cho ai, bao nhiêu (ít giao dịch nhất, hoặc gom qua thủ quỹ). Mỗi khoản có nút **Thông tin CK / QR**: số TK, ngân hàng, số tiền, nội dung và mã VietQR có sẵn số tiền. Bấm **Đã chuyển** để ghi nhận; số còn phải trả tự cập nhật.

## Quản trị (tab Quản trị)
- Cấu hình cho từng thành viên: tên, ngân hàng, số tài khoản, tên chủ TK, SĐT, mã QR (tự tạo VietQR / tải ảnh QR lên / ẩn).
- Thêm/ẩn thành viên, chọn ai tham gia tháng, khoá tháng, cách thanh toán, thủ quỹ, mẫu nội dung chuyển khoản, đổi mật khẩu, tải bản sao lưu.
- Người thường (không đăng nhập) vẫn thêm/sửa khoản chi như trên sheet, trừ khi tháng đã bị khoá.

## Chạy
- Lần đầu: nhấp đúp **install.bat** (cài Node.js nếu thiếu, mở firewall cổng 3000 cho mạng LAN, tự chạy cùng Windows, khởi động server).
- Chạy tay có cửa sổ: **start.bat**. Dừng: **stop.bat**. Gỡ tự khởi động/firewall: **uninstall.bat**.
- Truy cập: `http://localhost:3000` trên máy này; người khác cùng wifi dùng `http://<IP-máy-này>:3000`.
- Đổi cổng: đặt biến môi trường `PORT` trước khi chạy.

## Dữ liệu
- `data/db.json` — toàn bộ dữ liệu; `data/qr/` — ảnh QR; `data/backup/` — sao lưu tự động mỗi ngày (giữ 60 bản).
- Xoá `data/db.json` sẽ khởi tạo lại từ `seed.json` (dữ liệu tháng 9–11/2026 nhập từ sheet).
- Ảnh VietQR tự tạo lấy từ img.vietqr.io nên điện thoại người xem cần có Internet.
