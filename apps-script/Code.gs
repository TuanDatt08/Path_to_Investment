// Backend cho Lộ trình Chứng khoán 9 Tuần: chạy trên Google Apps Script, lưu dữ liệu vào chính Google Sheet này.
// Mật khẩu chung (tùy chọn): Project Settings → Script properties → thêm APP_PASSWORD. Không đặt thì ai có link cũng dùng được.
// Trang web gửi mọi thao tác bằng POST: { pw, op: { type, ... } } và nhận lại toàn bộ dữ liệu.

const FINE_TYPES = { "Trễ giờ": 50000, "Không chuẩn bị bài": 100000, "Không bù bài trong 24h": 200000, "Cầm điện thoại": 50000, "Dùng vé hoãn": 0 };
const PASS = "Dùng vé hoãn";
const MAX_PASS = 2;
const MAX_FINES = 500;
const MAX_DOCS = 500;
const MAX_PDF = 20 * 1024 * 1024; // 20MB mỗi file PDF tải thẳng lên
const DOCS_FOLDER = "Tài liệu chứng khoán";
let WARN = ""; // cảnh báo không chặn thao tác, gửi kèm kết quả cho trang web
// w1–w9: lộ trình Cơ bản, a1–a9: lộ trình Nâng cao.
const WEEKS = ["w1", "w2", "w3", "w4", "w5", "w6", "w7", "w8", "w9", "a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8", "a9"];
const YES = "Có";

// textCols: các cột để dạng văn bản, để Sheets không tự đổi "2026-10-15" thành ngày hay "=..." thành công thức.
const SHEETS = {
  settings: { name: "Cài đặt", head: ["Khóa", "Giá trị", "Ý nghĩa"], textCols: [1, 2, 3] },
  progress: { name: "Tiến độ", head: ["Tuần", "Bài", "Tên bài", "Tick lúc"], textCols: [1, 2, 3, 4] },
  notes: { name: "Ghi chú", head: ["Tuần", "Ghi chú"], textCols: [1, 2] },
  fines: { name: "Quỹ phạt", head: ["ID", "Ngày", "Người", "Lỗi", "Số tiền", "Đã nộp", "Tạo lúc"], textCols: [1, 2, 3, 4, 6, 7] },
  docs: { name: "Tài liệu", head: ["ID", "Tuần", "Bài", "Tên", "Link", "Người thêm", "Ngày thêm"], textCols: [1, 2, 3, 4, 5, 6, 7] },
};
const SETTINGS_ROWS = [
  ["nameA", "", "Tên người A"],
  ["nameB", "", "Tên người B"],
  ["start", "", "Ngày bắt đầu, dạng năm-tháng-ngày"],
  ["depositA", "", "Người A đã đóng quỹ 500.000đ (Có / để trống)"],
  ["depositB", "", "Người B đã đóng quỹ 500.000đ (Có / để trống)"],
];

// Chạy hàm này một lần trong trình soạn thảo (chọn authorizeDrive rồi bấm Run) để cấp quyền Google Drive.
function authorizeDrive() {
  docsFolder();
}

function doGet() {
  return ContentService.createTextOutput("Server Lộ trình Chứng khoán đang chạy.");
}

function doPost(e) {
  WARN = "";
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
    if (WARN) s.warn = WARN;
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

// Ghi một dòng mới: đặt dạng văn bản cho các cột chữ trước rồi mới ghi, để Sheets không tự đổi "2026-10-16" thành ngày tháng.
function addRow(key, row) {
  const s = sheet(key), r = s.getLastRow() + 1;
  SHEETS[key].textCols.forEach(c => s.getRange(r, c).setNumberFormat("@"));
  s.getRange(r, 1, 1, row.length).setValues([row]);
}

// Đọc ô: nếu Sheets đã lỡ đổi thành ngày tháng thì đổi lại về chuỗi "yyyy-MM-dd" (hoặc kèm giờ).
const isDateObj = v => Object.prototype.toString.call(v) === "[object Date]";
function txt(v, withTime) {
  if (!isDateObj(v)) return String(v);
  return Utilities.formatDate(v, Session.getScriptTimeZone(), withTime ? "yyyy-MM-dd'T'HH:mm:ss" : "yyyy-MM-dd");
}

function setSetting(k, v) {
  const i = findRow("settings", r => r[0] === k);
  if (i >= 0) sheet("settings").getRange(i + 2, 2).setValue(v);
  else addRow("settings", [k, v, ""]);
}

function getV() { return Number(PropertiesService.getScriptProperties().getProperty("v")) || 0; }
function bumpV() { PropertiesService.getScriptProperties().setProperty("v", String(getV() + 1)); }

function readState() {
  const set = {};
  rows("settings").forEach(r => { set[r[0]] = txt(r[1]); });
  const main = {
    names: { A: set.nameA || "", B: set.nameB || "" },
    start: set.start || "",
    deposits: { A: set.depositA === YES, B: set.depositB === YES },
    checked: {},
    notes: {},
  };
  rows("progress").forEach(r => { (main.checked[r[0]] = main.checked[r[0]] || {})[r[1]] = txt(r[3], true) || true; });
  rows("notes").forEach(r => { main.notes[r[0]] = txt(r[1]); });
  const fines = rows("fines").filter(r => r[0]).map(r => ({
    id: String(r[0]), date: txt(r[1]), who: String(r[2]), type: String(r[3]),
    amount: Number(r[4]) || 0, paid: r[5] === YES, createdAt: Number(r[6]) || 0,
  }));
  const docs = rows("docs").filter(r => r[0]).map(r => ({
    id: String(r[0]), phase: String(r[1]), item: String(r[2]), name: txt(r[3]), url: String(r[4]), who: String(r[5]), at: txt(r[6]),
  }));
  return { v: getV(), main, fines, docs };
}

/* ---------- Thao tác (kiểm tra kỹ vì đây là ranh giới tin cậy) ---------- */
const str = (s, max) => typeof s === "string" && s.length <= max;
const isDate = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isKey = s => typeof s === "string" && /^[a-z0-9]{1,12}$/.test(s);
const isWho = w => w === "A" || w === "B";
// Chỉ nhận link https:// để trang web không bao giờ mở link kiểu javascript:...
const isUrl = s => typeof s === "string" && s.length <= 500 && /^https:\/\/[^\s<>"]+$/i.test(s);

// Thư mục Drive chứa PDF tải lên; mất hoặc bị xóa thì tạo lại.
function docsFolder() {
  const props = PropertiesService.getScriptProperties(), id = props.getProperty("docsFolder");
  if (id) {
    try { const f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {}
  }
  const f = DriveApp.createFolder(DOCS_FOLDER);
  props.setProperty("docsFolder", f.getId());
  return f;
}

function checkDoc(d) {
  const name = typeof d.name === "string" ? d.name.trim() : "";
  if (WEEKS.indexOf(d.phase) < 0 || !isKey(d.item) || !isWho(d.who)) return "Thông tin tài liệu không hợp lệ";
  if (!name || name.length > 120) return "Tên tài liệu phải có từ 1 đến 120 ký tự";
  if (rows("docs").length >= MAX_DOCS) return "Đã đủ " + MAX_DOCS + " tài liệu, xóa bớt rồi thêm tiếp";
  return null;
}
const addDocRow = (d, url) => addRow("docs", [Utilities.getUuid(), d.phase, d.item, d.name.trim(), url, d.who, new Date().toISOString().slice(0, 10)]);

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
      if (op.on && i < 0) addRow("progress", [op.phase, op.item, str(op.title, 200) ? op.title : "", new Date().toISOString()]);
      if (!op.on && i >= 0) sheet("progress").deleteRow(i + 2);
      return null;
    }
    case "note": {
      if (WEEKS.indexOf(op.phase) < 0 || !str(op.value, 1000)) return "Ghi chú quá dài";
      const i = findRow("notes", r => r[0] === op.phase);
      if (i >= 0) sheet("notes").getRange(i + 2, 2).setValue(op.value.trim());
      else addRow("notes", [op.phase, op.value.trim()]);
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
      addRow("fines", [Utilities.getUuid(), f.date, f.who, f.type, amount, amount === 0 ? YES : "", String(Date.now())]);
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
    case "addDoc": {
      const d = op.doc || {};
      const bad = checkDoc(d) || (!isUrl(d.url) && "Link phải bắt đầu bằng https://");
      if (bad) return bad;
      addDocRow(d, d.url);
      return null;
    }
    case "uploadDoc": {
      const d = op.doc || {}, f = op.file || {};
      const bad = checkDoc(d);
      if (bad) return bad;
      if (f.type !== "application/pdf" || typeof f.data !== "string" || !f.data) return "Chỉ nhận file PDF";
      if (f.data.length > Math.ceil(MAX_PDF / 3) * 4) return "File quá lớn, tối đa 20MB";
      let bytes;
      try { bytes = Utilities.base64Decode(f.data); } catch (e) { return "File bị lỗi, thử chọn lại"; }
      if (bytes.length < 5 || String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) !== "%PDF") return "File này không phải PDF";
      const fname = (str(f.name, 200) && f.name ? f.name : d.name.trim() + ".pdf").replace(/[\\/:*?"<>|]/g, "_");
      const file = docsFolder().createFile(Utilities.newBlob(bytes, "application/pdf", fname));
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
      catch (e) { WARN = "Đã lưu file nhưng chưa bật được chia sẻ bằng link. Người kia có thể phải xin quyền xem trên Drive."; }
      addDocRow(d, file.getUrl());
      return null;
    }
    case "delDoc": {
      const i = findRow("docs", r => r[0] === op.id);
      if (i < 0) return "Không tìm thấy tài liệu";
      sheet("docs").deleteRow(i + 2);
      return null;
    }
    default:
      return "Thao tác không hợp lệ";
  }
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
