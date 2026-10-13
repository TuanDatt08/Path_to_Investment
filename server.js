// Server cho Lộ trình Chứng khoán 8 Tuần. Không dùng thư viện ngoài, cần Node >= 18.
// Dữ liệu lưu trong một file JSON (DATA_DIR/data.json).
// ponytail: một file JSON + một process; chuyển sang SQLite nếu có >2 người hoặc chạy nhiều instance.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "data.json");
const PASSWORD = process.env.APP_PASSWORD || "";
const INDEX = path.join(__dirname, "public", "index.html");

const FINE_TYPES = { "Trễ giờ": 50000, "Không chuẩn bị bài": 100000, "Không bù bài trong 24h": 200000, "Cầm điện thoại": 50000, "Dùng vé hoãn": 0 };
const MAX_PASS = 2;
const PHASE_IDS = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9"];

fs.mkdirSync(DATA_DIR, { recursive: true });
let db = { v: 0, main: { names: {}, start: "", checked: {}, owners: {}, notes: {} }, fines: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) }; } catch (e) { if (e.code !== "ENOENT") throw e; }

function persist() {
  db.v++;
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE); // ghi nguyên tử: không bao giờ để lại file hỏng giữa chừng
}

const snapshot = () => ({ v: db.v, main: db.main, fines: Object.entries(db.fines).map(([id, f]) => ({ id, ...f })) });
const str = (s, max) => typeof s === "string" && s.length <= max;
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isKey = s => typeof s === "string" && /^[a-z0-9]{1,12}$/.test(s);

// Mỗi thao tác được kiểm tra kỹ trước khi ghi: đây là ranh giới tin cậy.
function apply(op) {
  const m = db.main;
  switch (op && op.type) {
    case "name":
      if (!["A", "B"].includes(op.who) || !str(op.value, 24)) return "Tên không hợp lệ";
      m.names[op.who] = op.value.trim(); break;
    case "start":
      if (op.value !== "" && !isDate(op.value)) return "Ngày không hợp lệ";
      m.start = op.value; break;
    case "check":
      if (!PHASE_IDS.includes(op.phase) || !isKey(op.item) || typeof op.on !== "boolean") return "Mục không hợp lệ";
      m.checked[op.phase] = m.checked[op.phase] || {};
      if (op.on) m.checked[op.phase][op.item] = new Date().toISOString();
      else delete m.checked[op.phase][op.item];
      break;
    case "deposit":
      if (!["A", "B"].includes(op.who) || typeof op.value !== "boolean") return "Thông tin đóng quỹ không hợp lệ";
      m.deposits = m.deposits || {};
      m.deposits[op.who] = op.value; break;
    case "note":
      if (!PHASE_IDS.includes(op.phase) || !str(op.value, 1000)) return "Ghi chú quá dài";
      m.notes[op.phase] = op.value.trim(); break;
    case "addFine": {
      const f = op.fine || {};
      if (!["A", "B"].includes(f.who) || !(f.type in FINE_TYPES) || !isDate(f.date)) return "Thông tin lỗi không hợp lệ";
      const amount = Math.round(Number(f.amount));
      if (!Number.isFinite(amount) || amount < 0 || amount > 10000000) return "Số tiền không hợp lệ";
      if (f.type === "Dùng vé hoãn" && Object.values(db.fines).filter(x => x.who === f.who && x.type === f.type).length >= MAX_PASS)
        return "Đã dùng hết vé hoãn";
      if (Object.keys(db.fines).length >= 2000) return "Sổ phạt đã đầy";
      db.fines[crypto.randomUUID()] = { date: f.date, who: f.who, type: f.type, amount, paid: amount === 0, createdAt: Date.now() };
      break;
    }
    case "paid":
      if (!db.fines[op.id] || typeof op.value !== "boolean") return "Không tìm thấy lỗi";
      db.fines[op.id].paid = op.value; break;
    case "delFine":
      if (!db.fines[op.id]) return "Không tìm thấy lỗi";
      delete db.fines[op.id]; break;
    default:
      return "Thao tác không hợp lệ";
  }
  persist();
  return null;
}

function authorized(req) {
  if (!PASSWORD) return true;
  const [scheme, b64] = (req.headers.authorization || "").split(" ");
  if (scheme !== "Basic" || !b64) return false;
  const pass = Buffer.from(b64, "base64").toString().split(":").slice(1).join(":");
  const a = crypto.createHash("sha256").update(pass).digest();
  const b = crypto.createHash("sha256").update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function send(res, code, body, type = "application/json; charset=utf-8") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.url === "/healthz") return send(res, 200, { ok: true }); // để Railway kiểm tra, không cần mật khẩu
  if (!authorized(req)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="ck8", charset="UTF-8"' });
    return res.end("Cần mật khẩu");
  }
  const url = new URL(req.url, "http://x");

  if (req.method === "GET" && url.pathname === "/") return send(res, 200, fs.readFileSync(INDEX, "utf8"), "text/html; charset=utf-8");
  if (req.method === "GET" && url.pathname === "/api/state") return send(res, 200, snapshot());

  if (req.method === "POST" && url.pathname === "/api/op") {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", c => { body += c; if (body.length > 16384) req.destroy(); });
    req.on("end", () => {
      let op;
      try { op = JSON.parse(body); } catch { return send(res, 400, { error: "JSON không hợp lệ" }); }
      const err = apply(op);
      send(res, err ? 400 : 200, err ? { error: err, ...snapshot() } : snapshot());
    });
    return;
  }
  send(res, 404, { error: "Không tìm thấy" });
});

server.listen(PORT, () => {
  console.log(`Đang chạy tại http://localhost:${PORT}`);
  if (!PASSWORD) console.warn("CẢNH BÁO: chưa đặt APP_PASSWORD, ai có link cũng sửa được dữ liệu.");
});
