# VN-HỌC: Lộ trình Chứng khoán 8 Tuần

Web app cho 2 người cùng theo dõi lộ trình học: checklist từng giai đoạn, lịch tuần và sổ quỹ phạt.

- Không cần cài thư viện, chỉ cần **Node.js 18 trở lên**.
- Dữ liệu lưu trong `data/data.json`.
- Có mật khẩu chung (biến `APP_PASSWORD`). Trình duyệt sẽ hỏi mật khẩu khi mở trang; ô tên đăng nhập gõ gì cũng được.

```
ck8/
├── server.js          # server + API, lưu file JSON
├── public/index.html  # toàn bộ giao diện
├── test.js            # kiểm tra nhanh: npm test
└── package.json
```

## Chạy trên máy

```bash
cd ck8
npm start                         # http://localhost:3000, không có mật khẩu
```

Đặt mật khẩu (PowerShell):

```powershell
$env:APP_PASSWORD="mat-khau-chung"; npm start
```

Kiểm tra code: `npm test`.

## Biến môi trường

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3000` | Cổng server. Hầu hết nền tảng hosting tự đặt biến này. |
| `APP_PASSWORD` | trống | Mật khẩu chung. **Bắt buộc đặt khi đưa lên internet.** |
| `DATA_DIR` | `./data` | Thư mục chứa `data.json`. Trên hosting phải trỏ vào ổ lưu trữ bền (volume). |

## Deploy

Điểm quan trọng nhất: **dữ liệu nằm trong một file, nên nơi deploy phải có ổ đĩa không bị xóa khi khởi động lại.** Các gói miễn phí kiểu Render Free có ổ đĩa tạm: mỗi lần redeploy hoặc server ngủ dậy, toàn bộ tick và tiền phạt sẽ mất.

### Cách 1: Railway (dễ nhất, có volume)

Kiểm tra giá trên trang Railway trước khi dùng. Thường có gói dùng thử, sau đó tính phí theo tháng.

1. Đẩy thư mục `ck8` lên một repo GitHub (để private cũng được).
2. Railway → **New Project** → **Deploy from GitHub repo** → chọn repo. Railway tự nhận diện Node và chạy `npm start`.
3. Tab **Variables**: thêm `APP_PASSWORD=<mật khẩu>` và `DATA_DIR=/data`.
4. Chuột phải vào service → **Attach Volume**, mount path `/data`.
5. **Settings → Networking → Generate Domain** để có link dạng `xxx.up.railway.app`. Gửi link và mật khẩu cho bạn của bạn.

### Cách 2: Chạy trên máy mình + Cloudflare Tunnel (miễn phí)

Máy phải bật thì bạn của bạn mới vào được.

1. Cài `cloudflared`: `winget install Cloudflare.cloudflared`
2. Chạy app: `$env:APP_PASSWORD="mat-khau-chung"; npm start`
3. Mở một terminal khác: `cloudflared tunnel --url http://localhost:3000`
4. Copy link `https://....trycloudflare.com` hiện ra và gửi cho bạn của bạn.

Link này đổi mỗi lần chạy lại `cloudflared`. Muốn link cố định thì tạo named tunnel với tài khoản Cloudflare và một tên miền.

### Cách 3: VPS (Oracle Cloud Free Tier, DigitalOcean, ...)

```bash
git clone <repo> && cd ck8
APP_PASSWORD=mat-khau-chung PORT=3000 node server.js
```

Để server tự chạy lại khi reboot, dùng `systemd` hoặc `pm2` (`npm i -g pm2 && APP_PASSWORD=... pm2 start server.js && pm2 save && pm2 startup`). Nên đặt Caddy hoặc Nginx phía trước để có HTTPS. Basic auth qua HTTP thường sẽ gửi mật khẩu dạng gần như văn bản thuần.

## Sao lưu

Toàn bộ dữ liệu là file `DATA_DIR/data.json`. Thỉnh thoảng copy file này ra ngoài là đủ.

## Giới hạn

- Thiết kế cho 2 người và 1 server. Chạy nhiều bản cùng lúc sẽ ghi đè dữ liệu của nhau.
- Hai máy đồng bộ bằng cách tải lại dữ liệu mỗi 5 giây, nên thay đổi của người kia có thể hiện chậm vài giây.
