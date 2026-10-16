// Backend cho Lộ trình Chứng khoán 9 Tuần: chạy trên Google Apps Script, lưu dữ liệu vào chính Google Sheet này.
// Mật khẩu chung (tùy chọn): Project Settings → Script properties → thêm APP_PASSWORD. Không đặt thì ai có link cũng dùng được.
// Trang web gửi mọi thao tác bằng POST: { pw, op: { type, ... } } và nhận lại toàn bộ dữ liệu.

const FINE_TYPES = { "Trễ giờ": 50000, "Không chuẩn bị bài": 100000, "Không bù bài trong 24h": 200000, "Cầm điện thoại": 50000, "Dùng vé hoãn": 0 };
const PASS = "Dùng vé hoãn";
const MAX_PASS = 2;
const MAX_FINES = 500;
// w1–w9: lộ trình Cơ bản, a1–a9: lộ trình Nâng cao.
const WEEKS = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
const YES = "Có";

// textCols: các cột để dạng văn bản, để Sheets không tự đổi "2026-10-15" thành ngày hay "=..." thành công thức.
const SHEETS = {
  settings: { name: "Cài đặt", head: ["Khóa", "Giá trị", "Ý nghĩa"], textCols: [1, 2, 3] },
  progress: { name: "Tiến độ", head: ["Tuần", "Bài", "Tên bài", "Tick lúc"], textCols: [1, 2, 3, 4] },
  notes: { name: "Ghi chú", head: ["Tuần", "Ghi chú"], textCols: [1, 2] },
  fines: { name: "Quỹ phạt", head: ["ID", "Ngày", "Người", "Lỗi", "Số tiền", "Đã nộp", "Tạo lúc"], textCols: [1, 2, 3, 4, 6, 7] },
};
const SETTINGS_ROWS = [
  ["nameA", "", "Tên người A"],
  ["nameB", "", "Tên người B"],
  ["start", "", "Ngày bắt đầu, dạng năm-tháng-ngày"],
  ["depositA", "", "Người A đã đóng quỹ 500.000đ (Có / để trống)"],
  ["depositB", "", "Người B đã đóng quỹ 500.000đ (Có / để trống)"],
];

function doGet() {
  return ContentService.createTextOutput("Server Lộ trình Chứng khoán đang chạy.");
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json({ error: "Dữ liệu gửi lên không hợp lệ" }); }
  // Mật khẩu là tùy chọn: chỉ kiểm tra khi đã đặt APP_PASSWORD.
  const want = PropertiesService.getScriptProperties().getProperty("APP_PASSWORD");
  if (want && (!body || body.pw !== want)) return json({ error: "Sai mật khẩu", auth: false });

  const op = (body && body.op) || {};
  if (op.type === "v") return json({ v: getV() });
  if (op.type === "state") return json(readState());

  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch (err) { return json({ error: "Máy chủ đang bận, thử lại sau vài giây" }); }
  try {
    const err = apply(op);
    if (!err) bumpV();
    const s = readState();
    if (err) s.error = err;
    return json(s);
  } finally {
    lock.releaseLock();
  }
}

/* ---------- Đọc / ghi Sheet ---------- */
function sheet(key) {
  const def = SHEETS[key], ss = SpreadsheetApp.getActive();
  let s = ss.getSheetByName(def.name);
  if (!s) {
    s = ss.insertSheet(def.name);
    def.textCols.forEach(c => s.getRange(1, c, s.getMaxRows(), 1).setNumberFormat("@"));
    s.getRange(1, 1, 1, def.head.length).setValues([def.head]).setFontWeight("bold");
    s.setFrozenRows(1);
    if (key === "settings") s.getRange(2, 1, SETTINGS_ROWS.length, 3).setValues(SETTINGS_ROWS);
  }
  return s;
}

// Các dòng dữ liệu (bỏ dòng tiêu đề). Dòng thứ i nằm ở hàng i + 2 trong Sheet.
function rows(key) {
  const s = sheet(key), n = s.getLastRow();
  return n < 2 ? [] : s.getRange(2, 1, n - 1, SHEETS[key].head.length).getValues();
}
const findRow = (key, match) => rows(key).findIndex(match);

function setSetting(k, v) {
  const i = findRow("settings", r => r[0] === k);
  if (i >= 0) sheet("settings").getRange(i + 2, 2).setValue(v);
  else sheet("settings").appendRow([k, v, ""]);
}

function getV() { return Number(PropertiesService.getScriptProperties().getProperty("v")) || 0; }
function bumpV() { PropertiesService.getScriptProperties().setProperty("v", String(getV() + 1)); }

function readState() {
  const set = {};
  rows("settings").forEach(r => { set[r[0]] = String(r[1]); });
  const main = {
    names: { A: set.nameA || "", B: set.nameB || "" },
    start: set.start || "",
    deposits: { A: set.depositA === YES, B: set.depositB === YES },
    checked: {},
    notes: {},
  };
  rows("progress").forEach(r => { (main.checked[r[0]] = main.checked[r[0]] || {})[r[1]] = String(r[3]) || true; });
  rows("notes").forEach(r => { main.notes[r[0]] = String(r[1]); });
  const fines = rows("fines").filter(r => r[0]).map(r => ({
    id: String(r[0]), date: String(r[1]), who: String(r[2]), type: String(r[3]),
    amount: Number(r[4]) || 0, paid: r[5] === YES, createdAt: Number(r[6]) || 0,
  }));
  return { v: getV(), main, fines };
}

/* ---------- Thao tác (kiểm tra kỹ vì đây là ranh giới tin cậy) ---------- */
const str = (s, max) => typeof s === "string" && s.length <= max;
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isKey = s => typeof s === "string" && /^[a-z0-9]{1,12}$/.test(s);
const isWho = w => w === "A" || w === "B";

function apply(op) {
  switch (op.type) {
    case "name":
      if (!isWho(op.who) || !str(op.value, 24)) return "Tên không hợp lệ";
      setSetting("name" + op.who, op.value.trim()); return null;
    case "start":
      if (op.value !== "" && !isDate(op.value)) return "Ngày không hợp lệ";
      setSetting("start", op.value); return null;
    case "deposit":
      if (!isWho(op.who) || typeof op.value !== "boolean") return "Thông tin đóng quỹ không hợp lệ";
      setSetting("deposit" + op.who, op.value ? YES : ""); return null;
    case "check": {
      if (WEEKS.indexOf(op.phase) < 0 || !isKey(op.item) || typeof op.on !== "boolean") return "Mục không hợp lệ";
      const i = findRow("progress", r => r[0] === op.phase && r[1] === op.item);
      if (op.on && i < 0) sheet("progress").appendRow([op.phase, op.item, str(op.title, 200) ? op.title : "", new Date().toISOString()]);
      if (!op.on && i >= 0) sheet("progress").deleteRow(i + 2);
      return null;
    }
    case "note": {
      if (WEEKS.indexOf(op.phase) < 0 || !str(op.value, 1000)) return "Ghi chú quá dài";
      const i = findRow("notes", r => r[0] === op.phase);
      if (i >= 0) sheet("notes").getRange(i + 2, 2).setValue(op.value.trim());
      else sheet("notes").appendRow([op.phase, op.value.trim()]);
      return null;
    }
    case "addFine": {
      const f = op.fine || {};
      if (!isWho(f.who) || !(f.type in FINE_TYPES) || !isDate(f.date)) return "Thông tin lỗi không hợp lệ";
      const amount = Math.round(Number(f.amount));
      if (!isFinite(amount) || amount < 0 || amount > 10000000) return "Số tiền không hợp lệ";
      const all = rows("fines");
      if (f.type === PASS && all.filter(r => r[2] === f.who && r[3] === PASS).length >= MAX_PASS) return "Đã dùng hết vé hoãn";
      if (all.length >= MAX_FINES) return "Sổ phạt đã đầy";
      sheet("fines").appendRow([Utilities.getUuid(), f.date, f.who, f.type, amount, amount === 0 ? YES : "", String(Date.now())]);
      return null;
    }
    case "paid": {
      const i = findRow("fines", r => r[0] === op.id);
      if (i < 0 || typeof op.value !== "boolean") return "Không tìm thấy lỗi";
      sheet("fines").getRange(i + 2, 6).setValue(op.value ? YES : "");
      return null;
    }
    case "delFine": {
      const i = findRow("fines", r => r[0] === op.id);
      if (i < 0) return "Không tìm thấy lỗi";
      sheet("fines").deleteRow(i + 2);
      return null;
    }
    default:
      return "Thao tác không hợp lệ";
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
