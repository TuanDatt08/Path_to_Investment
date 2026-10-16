# VN-HỌC: Lộ trình Chứng khoán 9 Tuần

Web app cho 2 người cùng theo dõi lộ trình học: checklist từng bài nhỏ, lịch tuần và sổ quỹ phạt.

Có hai lộ trình, chuyển qua lại bằng tab:
- **Cơ bản (9 tuần, 41 bài):** cho người mới, tên bài là câu hỏi đời thường, có ví dụ gần gũi. Mã tuần `w1`–`w9`.
- **Nâng cao (học sau):** chi tiết hơn, nhiều thuật ngữ hơn. Mã tuần `a1`–`a9`, tuần 9 là tùy chọn.

```
Trang web (Netlify)  ──►  Google Apps Script  ──►  Google Sheet
public/index.html         apps-script/Code.gs      4 tab: Cài đặt, Tiến độ, Ghi chú, Quỹ phạt
```

- Miễn phí, không cần máy chủ riêng.
- Mở Google Sheet là thấy dữ liệu dạng bảng. Google tự lưu lịch sử phiên bản (File → Lịch sử phiên bản).
- Mật khẩu chung (tùy chọn, nên đặt) nằm trong Apps Script. Nếu có, trang web hỏi một lần rồi nhớ trong trình duyệt.

```
Path_to_Investment/
├── public/index.html     # toàn bộ giao diện (Netlify phục vụ thư mục này)
├── apps-script/Code.gs   # code dán vào Google Apps Script
├── test.js               # kiểm tra Code.gs trên máy: npm test
└── netlify.toml
```

## Cài đặt (làm một lần)

### 1. Tạo Google Sheet

Vào https://sheets.new, đặt tên file, ví dụ "Lộ trình chứng khoán". Không cần tạo tab nào, script sẽ tự tạo.

### 2. Dán code Apps Script

1. Trong Sheet: **Tiện ích mở rộng → Apps Script** (Extensions → Apps Script).
2. Xóa hết code mẫu trong `Code.gs`, dán toàn bộ nội dung file `apps-script/Code.gs` vào, bấm **Lưu** (Ctrl + S).

### 3. Đặt mật khẩu (tùy chọn, nên làm)

Trong Apps Script: biểu tượng bánh răng **Cài đặt dự án (Project Settings)** → kéo xuống **Thuộc tính tập lệnh (Script properties)** → **Thêm thuộc tính**:

| Thuộc tính | Giá trị |
|---|---|
| `APP_PASSWORD` | mật khẩu chung của hai bạn |

Không đặt mật khẩu thì ai có link Apps Script cũng đọc và sửa được dữ liệu. Link này nằm sẵn trong `public/index.html`, nên nếu repo để public thì hãy đặt mật khẩu.

### 4. Deploy thành Web App

1. Bấm **Triển khai (Deploy) → Tùy chọn triển khai mới (New deployment)**.
2. Bánh răng cạnh "Chọn loại" → **Ứng dụng web (Web app)**.
3. **Thực thi dưới dạng (Execute as):** Tôi (Me).
   **Người có quyền truy cập (Who has access):** Bất kỳ ai (Anyone).
4. Bấm **Triển khai**, rồi **Cấp quyền truy cập**, chọn tài khoản Google của bạn.
   Google sẽ báo "Google chưa xác minh ứng dụng này". Đây là bình thường vì script do chính bạn viết: bấm **Nâng cao → Đi tới ... (không an toàn)** → **Cho phép**.
5. Copy **URL ứng dụng web**, dạng `https://script.google.com/macros/s/.../exec`.

"Bất kỳ ai" nghĩa là trang web gọi được script mà không cần đăng nhập Google. Dữ liệu chỉ được bảo vệ khi đã đặt `APP_PASSWORD`.

### 5. Dán link vào trang web

Mở `public/index.html`, tìm dòng:

```js
const API_URL = "DÁN_LINK_APPS_SCRIPT_VÀO_ĐÂY";
```

Thay bằng link vừa copy, rồi đẩy lên GitHub:

```
git add .
git commit -m "Chuyển sang Google Sheets"
git push
```

### 6. Đưa trang lên Netlify

1. Vào https://app.netlify.com → **Add new site → Import an existing project → GitHub** → chọn repo.
2. Netlify tự đọc `netlify.toml` (thư mục xuất bản `public`, không có lệnh build). Bấm **Deploy**.
3. Bạn sẽ có link dạng `ten-gi-do.netlify.app`. Đổi tên ở **Site configuration → Change site name** nếu muốn.

Gửi link và mật khẩu cho bạn của bạn là xong.

## Sửa code về sau

- **Sửa giao diện** (`public/index.html`): `git push` là Netlify tự cập nhật.
- **Sửa `Code.gs`:** dán code mới vào Apps Script, rồi **Triển khai → Quản lý các bản triển khai → biểu tượng bút chì → Phiên bản: Phiên bản mới → Triển khai**.
  Phải làm đúng cách này thì link `/exec` mới giữ nguyên. Tạo "New deployment" sẽ ra link mới, khi đó phải dán lại vào `API_URL`.

Kiểm tra `Code.gs` trên máy trước khi dán: `npm test`.

## Lưu ý

- **Đừng sửa cấu trúc Sheet:** không xóa hay đổi tên tab, không xóa hay đổi thứ tự cột, không đổi cột `Khóa`, `ID`. Xem và lọc thoải mái. Sửa tay nội dung (ví dụ gõ lại tên) thì trang web cần F5 mới thấy.
- **Tốc độ:** mỗi thao tác mất khoảng 1–2 giây để lưu. Góc trên phải hiện "Đang lưu…" rồi "Đã lưu".
- **Đồng bộ:** trang hỏi Sheet mỗi 10 giây, nên thay đổi của người kia hiện ra sau vài giây.
- **Giới hạn của Google:** Apps Script có hạn mức sử dụng mỗi ngày. Với 2 người thì thường không chạm tới, nhưng nên xem lại quota hiện hành nếu thấy lỗi lạ.
- **Đổi hoặc bỏ mật khẩu:** sửa hoặc xóa `APP_PASSWORD` trong Script properties. Đổi mật khẩu thì lần mở tới trang sẽ hỏi lại.
