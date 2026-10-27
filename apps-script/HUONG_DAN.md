# Hướng dẫn triển khai máy chủ (Google Apps Script)

## 1. Cài đặt trên Google Sheet
1. Mở Google Sheet dùng cho cuộc thi → vào **Tiện ích mở rộng → Apps Script**.
2. Tạo 2 file mã nguồn:
   - `Code.gs`: sao chép toàn bộ nội dung từ file `apps-script/Code.gs`.
   - `QuestionBank.gs`: sao chép toàn bộ nội dung từ file `apps-script/QuestionBank.gs`.
3. Chọn hàm **`setupSheets`** ở thanh công cụ và bấm **Chạy** (cấp quyền truy cập nếu Google yêu cầu) → Hệ thống sẽ tự động tạo 2 sheet:
   - `PhienThi`: Quản lý các phiên đang làm bài, đề thi riêng của từng người và thời điểm bắt đầu.
   - `KetQua`: Lưu kết quả nộp bài, điểm số, thời gian làm bài, số điện thoại, đơn vị, dự đoán...
4. **Triển khai ứng dụng Web**:
   - Bấm **Triển khai → Quản lý các bản triển khai → Chỉnh sửa (biểu tượng bút chì)**.
   - Mục *Phiên bản*: Chọn **Phiên bản mới**.
   - Mục *Thực thi với tư cách*: **Tôi (địa chỉ email của bạn)**.
   - Mục *Ai có quyền truy cập*: **Bất kỳ ai (Anyone)**.
   - Bấm **Triển khai**. (Nếu đây là lần đầu tạo bản triển khai mới, hãy copy URL Web App và dán vào `SCRIPT_URL` trong `index.html`).

---

## 2. Cơ chế đăng nhập và làm bài
- **Không cần tạo trước danh sách thí sinh hay cấp mã PIN**: Thí sinh truy cập link trang web, chỉ cần nhập đúng 3 thông tin:
  1. **Họ và tên thí sinh**
  2. **Đơn vị công tác** (cơ quan / đơn vị / chi đoàn)
  3. **Số điện thoại**
- **Định danh duy nhất bằng Số điện thoại**:
  - Mỗi số điện thoại chỉ được tham gia thi **01 lần duy nhất**. Nếu số điện thoại này đã hoàn thành bài thi trước đó, hệ thống sẽ từ chối và hiển thị thông báo.
  - Khi thí sinh bị rớt mạng, vô tình đóng trình duyệt hoặc tải lại trang: Nếu chưa hết 15 phút, khi nhập lại đúng số điện thoại đó, hệ thống sẽ **khôi phục lại đúng đề thi cũ** với thời gian còn lại được tính chuẩn xác theo đồng hồ máy chủ.

---

## 3. Cấu hình (`CONFIG` trong Code.gs)
Bạn có thể tùy chỉnh các thông số trong `Code.gs` theo yêu cầu cuộc thi:

| Tham số | Giá trị mặc định | Ý nghĩa |
|---|---|---|
| `SPREADSHEET_ID` | `'1YboqDWLjtHjr355fqE5RbXvWkqfn8QDchehS0Il-qHo'` | ID của Google Sheet cuộc thi, giúp script luôn tìm chính xác file trang tính |
| `DURATION_SEC` | `15 * 60` (900s) | Thời gian làm bài (15 phút, phải khớp với `DURATION_MINUTES` ở `index.html`) |
| `GRACE_SEC` | `60` | Độ trễ bù trừ mạng chậm khi nộp bài (60 giây). Nộp quá thời gian này sẽ ghi nhận nộp trễ và 0 điểm |
| `QUESTION_COUNT` | `30` | Số lượng câu hỏi ngẫu nhiên bốc cho mỗi đề thi |
| `MIN_FOR_LEADERBOARD` | `5` | Số thí sinh hoàn thành tối thiểu để tự động mở Bảng xếp hạng |

---

## 4. Bảo mật & Chấm điểm
- Toàn bộ ngân hàng câu hỏi và đáp án chỉ lưu trên máy chủ Google (`QuestionBank.gs`). Front-end hoàn toàn không có câu hỏi hay đáp án trong mã nguồn.
- Khi bấm đăng nhập, máy chủ mới bốc ngẫu nhiên 30 câu hỏi (đã xáo trộn thứ tự các đáp án A/B/C/D) và gửi về cho người dùng (chỉ gồm câu hỏi và nội dung các lựa chọn, không kèm đáp án đúng).
- Thời gian làm bài được tính trực tiếp trên Server: `Thời gian làm = Thời điểm nộp (submitTime) - Thời điểm bắt đầu (startTime)`. Máy người dùng không thể gian lận thời gian.
- Khi nộp bài, Client chỉ gửi lên lựa chọn của thí sinh. Việc so sánh đáp án và tính điểm được thực hiện hoàn toàn trên máy chủ.

---

## 5. Quản trị: Xóa dữ liệu & Cho thi lại
- **Xóa toàn bộ dữ liệu (Làm sạch bảng để mở cuộc thi chính thức)**:
  - Trong Apps Script, chọn hàm **`clearAllData`** trên thanh công cụ và bấm **Chạy**.
  - Hệ thống sẽ xóa sạch toàn bộ các dòng bài thi từ dòng 2 trở đi ở cả 2 bảng `PhienThi` và `KetQua`, giữ lại đúng dòng tiêu đề chuẩn.
- **Cho phép 1 thí sinh thi lại (Reset theo Số điện thoại)**:
  - Mở file `Code.gs`, tìm dòng `const PHONE_RESET = '...';` (khoảng dòng 400).
  - Điền số điện thoại cần reset vào đó, ví dụ: `const PHONE_RESET = '0912345678';`.
  - Chọn hàm **`resetCandidate`** trên thanh công cụ và bấm **Chạy**.
- **Hoặc xóa thủ công trên Google Sheet**: Bạn chỉ cần xóa dòng của thí sinh đó trong cả 2 sheet `PhienThi` và `KetQua`.

---

## 6. Rà soát đáp án
Ngân hàng gồm 60 câu hỏi nằm trong file `QuestionBank.gs`. Trường `correct` là chỉ số đáp án đúng (từ `0` đến `3` tương ứng với vị trí lựa chọn).
> **Lưu ý:** Vui lòng kiểm tra lại tính chính xác của các đáp án trong `QuestionBank.gs` trước khi chính thức mở thi.
