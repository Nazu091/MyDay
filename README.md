# MyDay – Personal Productivity PWA (v1.0.1)

Ứng dụng web tiến bộ (PWA) quản lý công việc, lịch trình, thói quen và ghi chú cá nhân, thiết kế theo phong cách **Modern Minimalist**, hoạt động **100% Offline** bằng IndexedDB, tối ưu riêng cho **iPhone (Safari)** và phát triển thuận tiện trên **Windows**.

## Tính năng hoàn chỉnh
1. **Dashboard – Tổng quan:** Ngày hiện tại, lời chào theo buổi, vòng tròn SVG tỷ lệ hoàn thành trong ngày, công việc ưu tiên cao và danh sách công việc sắp tới.
2. **Quản lý công việc (CRUD):** Thêm/Sửa/Xóa có xác nhận, 4 trạng thái (`Chưa thực hiện`, `Đang thực hiện`, `Hoàn thành`, `Quá hạn`), ngày/giờ bắt đầu–kết thúc, 3 mức ưu tiên, quản lý danh mục màu, tìm kiếm, lọc đa điều kiện, sắp xếp và tự động tạo kỳ lặp lại (`Hằng ngày`, `Hằng tuần`, `Hằng tháng`).
3. **Lịch (Calendar):** Chế độ xem **Ngày / Tuần / Tháng**, chấm màu đánh dấu ngày có việc, chuyển nhanh ngày, xem/sửa công việc trực tiếp và thêm việc gắn sẵn ngày.
4. **Habit Tracker:** Thêm/Sửa/Xóa thói quen, check-in 1 chạm hôm nay & 7 ngày gần nhất, tính chuỗi **Current Streak** & **Best Streak**, tỷ lệ duy trì và **Lịch sử 30 ngày**.
5. **Ghi chú (Notes):** CRUD ghi chú, tìm kiếm tức thời, ghim ghi chú quan trọng lên đầu, hiển thị thời điểm tạo và cập nhật.
6. **Thống kê (Statistics):** Lọc theo Ngày / Tuần / Tháng, biểu đồ cột SVG thuần (chạy Offline), phân bổ 4 trạng thái, thống kê thói quen và lịch sử công việc hoàn thành.
7. **Cài đặt & Dữ liệu (Settings):** Giao diện Sáng / Tối / Theo hệ thống, cấu hình nhắc nhở, **Sao lưu & Khôi phục JSON** nguyên tử, hướng dẫn bảo vệ file sao lưu, xóa toàn bộ dữ liệu xác nhận 2 bước, xem phiên bản & kiểm tra cập nhật PWA.

---

## Chạy thử trên Windows (Môi trường phát triển)
> Không nhấp đúp mở trực tiếp file `index.html` (`file://`), hãy chạy qua máy chủ cục bộ:
- **VS Code:** Cài extension **Live Server** → chuột phải `index.html` → **Open with Live Server**.
- **Python:** Mở PowerShell trong thư mục `MyDay` và chạy:
  ```powershell
  python -m http.server 5500
  ```
  Truy cập `http://localhost:5500`.

---

## Triển khai HTTPS miễn phí (Giai đoạn 10)
iPhone Safari **bắt buộc dùng HTTPS** mới kích hoạt Service Worker và chạy Offline ổn định.

### Cách 1: GitHub Pages (Miễn phí, dễ cập nhật nhất)
1. Tạo tài khoản tại [github.com](https://github.com) và tạo repository mới (ví dụ: `myday-pwa`).
2. Tải toàn bộ các file **bên trong** thư mục `MyDay/` (`index.html`, `manifest.json`, `sw.js`, `assets/...`) lên nhánh `main`.
3. Vào **Settings → Pages → Build and deployment**:
   - Source: **Deploy from a branch**
   - Branch: **`main`** / thư mục **`/ (root)`** → nhấn **Save**.
4. Đợi 1–2 phút, truy cập địa chỉ HTTPS: `https://<ten-github>.github.io/myday-pwa/`

### Cách 2: Cloudflare Pages / Netlify Drop (Không cần dùng Git)
- Truy cập [app.netlify.com/drop](https://app.netlify.com/drop) (hoặc Cloudflare Pages → Direct Upload), kéo thả thẳng thư mục `MyDay` vào trình duyệt để nhận ngay đường link `https://...` trong 30 giây.

---

## Cài đặt lên màn hình chính iPhone (Safari)
1. Mở **Safari** trên iPhone (không dùng Chrome/Cốc Cốc vì iOS yêu cầu Safari để cài PWA đầy đủ).
2. Truy cập đường link HTTPS vừa triển khai ở trên và đợi trang tải hoàn tất lần đầu.
3. Nhấn nút **Chia sẻ (Share)** (biểu tượng hình vuông có mũi tên hướng lên ở thanh dưới Safari).
4. Cuộn xuống chọn **Thêm vào MH chính (Add to Home Screen)** → nhấn **Thêm (Add)**.
5. Mở biểu tượng **MyDay** vừa xuất hiện trên màn hình chính: ứng dụng chạy toàn màn hình không thanh địa chỉ, hỗ trợ tai thỏ/Dynamic Island và hoạt động bình thường ngay cả khi bật **Chế độ máy bay**.

## Lưu ý bảo vệ dữ liệu trên iPhone
- Dữ liệu cá nhân chỉ lưu trong IndexedDB trên thiết bị, không gửi ra Internet.
- Nên vào **Cá nhân → Cài đặt → Sao lưu JSON** định kỳ (ví dụ mỗi tuần) và lưu file vào **iCloud Drive (Tệp)** để đề phòng khi đổi máy hoặc xóa dữ liệu trình duyệt.
