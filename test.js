// Kiểm tra nhanh apps-script/Code.gs trên máy: `npm test`.
// Giả lập SpreadsheetApp, PropertiesService... bằng bảng trong bộ nhớ.
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function fakeSheet() {
  const data = [];
  const range = (r, c, nr = 1, nc = 1) => ({
    setNumberFormat() { return this; },
    setFontWeight() { return this; },
    setValue(v) { (data[r - 1] = data[r - 1] || [])[c - 1] = v; return this; },
    setValues(vals) { vals.forEach((row, i) => row.forEach((v, j) => { (data[r - 1 + i] = data[r - 1 + i] || [])[c - 1 + j] = v; })); return this; },
    getValues() { return Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (data[r - 1 + i] || [])[c - 1 + j] ?? "")); },
  });
  return { data, getRange: range, getMaxRows: () => 1000, setFrozenRows() {}, getLastRow: () => data.length, getLastColumn: () => (data[0] || []).length,
    appendRow(row) { data.push([...row]); }, deleteRow(i) { data.splice(i - 1, 1); } };
}

const sheets = {}, props = { APP_PASSWORD: "matkhau" }, folders = {}, files = [], cache = new Map();
const ctx = {
  Session: { getScriptTimeZone: () => "Asia/Ho_Chi_Minh" },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet()) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  Utilities: {
    getUuid: () => require("node:crypto").randomUUID(),
    base64Decode: s => [...Buffer.from(s, "base64")].map(b => (b > 127 ? b - 256 : b)), // Apps Script trả byte có dấu
    newBlob: (bytes, type, name) => ({ bytes, type, name }),
    formatDate: (d, tz, fmt) => {
      const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(d).map(x => [x.type, x.value]));
      return fmt.includes("HH") ? `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}` : `${p.year}-${p.month}-${p.day}`;
    },
  },
  DriveApp: {
    Access: { ANYONE_WITH_LINK: "ANYONE_WITH_LINK" }, Permission: { VIEW: "VIEW" },
    getFolderById: id => { if (!folders[id]) throw new Error("not found"); return folders[id]; },
    getFileById: id => { const f = files.find(x => x.getId() === id); if (!f) throw new Error("No item with the given ID could be found"); return f; },
    createFolder: name => {
      const id = "fd" + Object.keys(folders).length;
      return (folders[id] = { name, files, getId: () => id, isTrashed: () => false,
        createFile: blob => {
          const fid = "file" + String(files.length).padStart(20, "0");
          const f = { blob, trashed: false, sharing: null, setSharing(a, p) { this.sharing = a + ":" + p; }, getId: () => fid, getName() { return this.blob.name; },
            isTrashed() { return this.trashed; }, getUrl: () => `https://drive.google.com/file/d/${fid}/view` };
          files.push(f); return f;
        } });
    },
  },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), ctx);
const call = (op, pw = "matkhau") => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ pw, op }) } }).s);

assert.strictEqual(call({ type: "state" }, "sai").auth, false, "sai mật khẩu phải bị chặn");
assert.ok(call({ type: "check", phase: "w1", item: "m1", on: true, title: "Bài 1" }).main.checked.w1.m1);
assert.ok(call({ type: "check", phase: "w99", item: "m1", on: true }).error, "tuần lạ phải bị từ chối");
call({ type: "check", phase: "w1", item: "m2", on: true });
assert.ok(call({ type: "check", phase: "a3", item: "m1", on: true }).main.checked.a3.m1, "tuần Nâng cao phải lưu được");
assert.strictEqual(call({ type: "check", phase: "w1", item: "m1", on: false }).main.checked.w1.m1, undefined, "bỏ tick phải xóa dòng");
call({ type: "name", who: "A", value: "  An " });
call({ type: "start", value: "2026-10-12" });
call({ type: "deposit", who: "B", value: true });
call({ type: "note", phase: "w1", value: "=SUM(1)" });
assert.ok(call({ type: "addFine", fine: { who: "C", type: "Trễ giờ", date: "2026-10-15", amount: 1 } }).error);
let s = call({ type: "addFine", fine: { who: "A", type: "Trễ giờ", date: "2026-10-15", amount: 50000 } });
const id = s.fines[0].id;
for (let i = 0; i < 2; i++) call({ type: "addFine", fine: { who: "B", type: "Dùng vé hoãn", date: "2026-10-15", amount: 0 } });
assert.strictEqual(call({ type: "addFine", fine: { who: "B", type: "Dùng vé hoãn", date: "2026-10-15", amount: 0 } }).error, "Đã dùng hết vé hoãn");
call({ type: "paid", id, value: true });

s = call({ type: "state" });
assert.deepStrictEqual(s.main.names, { A: "An", B: "" });
assert.strictEqual(s.main.start, "2026-10-12");
assert.deepStrictEqual(s.main.deposits, { A: false, B: true });
assert.strictEqual(s.main.notes.w1, "=SUM(1)");
assert.ok(s.main.checked.w1.m2 && !s.main.checked.w1.m1);
assert.strictEqual(s.fines.length, 3);
assert.strictEqual(s.fines.find(f => f.id === id).paid, true);
assert.strictEqual(call({ type: "v" }).v, s.v);
assert.strictEqual(call({ type: "delFine", id }).fines.length, 2);

// Tài liệu: chỉ nhận link https, tên không rỗng, đúng tuần/người; xóa được
assert.ok(call({ type: "addDoc", doc: { phase: "w2", item: "m1", name: "Lạm phát", url: "javascript:alert(1)", who: "A" } }).error, "chặn link javascript:");
assert.ok(call({ type: "addDoc", doc: { phase: "w2", item: "m1", name: "Lạm phát", url: "http://abc.com", who: "A" } }).error, "chặn link http");
assert.ok(call({ type: "addDoc", doc: { phase: "w2", item: "m1", name: "   ", url: "https://abc.com", who: "A" } }).error, "chặn tên rỗng");
assert.ok(call({ type: "addDoc", doc: { phase: "x1", item: "m1", name: "a", url: "https://abc.com", who: "A" } }).error, "chặn tuần lạ");
s = call({ type: "addDoc", doc: { phase: "w2", item: "m1", name: " Video lạm phát ", url: "https://youtu.be/abc", who: "B" } });
assert.strictEqual(s.docs.length, 1);
assert.deepStrictEqual([s.docs[0].phase, s.docs[0].item, s.docs[0].name, s.docs[0].who], ["w2", "m1", "Video lạm phát", "B"]);
assert.strictEqual(call({ type: "delDoc", id: s.docs[0].id }).docs.length, 0);

// Tải PDF thẳng lên: lưu vào thư mục Drive (tạo 1 lần, dùng lại), bật chia sẻ bằng link, gắn link vào bài
const pdf = Buffer.from("%PDF-1.4\n%test\n").toString("base64");
const doc = { phase: "w7", item: "m1", name: "Báo cáo tài chính FPT", who: "A" };
assert.ok(call({ type: "uploadDoc", doc, file: { name: "a.pdf", type: "text/plain", data: pdf } }).error, "chặn file không khai báo PDF");
assert.strictEqual(call({ type: "uploadDoc", doc, file: { name: "a.pdf", type: "application/pdf", data: Buffer.from("hello").toString("base64") } }).error, "File này không phải PDF");
assert.strictEqual(call({ type: "uploadDoc", doc, file: { name: "a.pdf", type: "application/pdf", data: "A".repeat(Math.ceil(20 * 1024 * 1024 / 3) * 4 + 4) } }).error, "File quá lớn, tối đa 20MB");
s = call({ type: "uploadDoc", doc, file: { name: "FPT 2025.pdf", type: "application/pdf", data: pdf } });
assert.ok(!s.error, s.error);
assert.strictEqual(s.docs.length, 1);
assert.ok(s.docs[0].url.startsWith("https://drive.google.com/file/d/"), s.docs[0].url);
assert.strictEqual(s.docs[0].fid, files[0].getId(), "lưu Drive ID khi tải PDF lên");
assert.strictEqual(s.docs[0].file, "FPT 2025.pdf", "trả về tên file Drive");
assert.deepStrictEqual([s.docs[0].phase, s.docs[0].item, s.docs[0].name], ["w7", "m1", "Báo cáo tài chính FPT"]);
assert.strictEqual(files[0].blob.name, "FPT 2025.pdf");
assert.strictEqual(files[0].sharing, "ANYONE_WITH_LINK:VIEW");
call({ type: "uploadDoc", doc, file: { name: "b/c.pdf", type: "application/pdf", data: pdf } });
assert.strictEqual(Object.keys(folders).length, 1, "dùng lại thư mục cũ");
assert.strictEqual(files[1].blob.name, "b_c.pdf", "bỏ ký tự không hợp lệ trong tên file");

// Sheets có khi tự đổi chuỗi ngày thành Date: đọc ra phải về lại "yyyy-MM-dd"
call({ type: "addFine", fine: { who: "A", type: "Trễ giờ", date: "2026-10-16", amount: 50000 } });
const fineRow = sheets["Quỹ phạt"].data.length - 1, docRow = 1;
sheets["Quỹ phạt"].data[fineRow][1] = new Date("2026-10-16T00:00:00+07:00");
sheets["Tài liệu"].data[docRow][6] = new Date("2026-10-16T00:00:00+07:00");
sheets["Cài đặt"].data[3][1] = new Date("2026-10-12T00:00:00+07:00");
s = call({ type: "state" });
assert.strictEqual(s.fines.find(f => f.amount === 50000 && f.who === "A" && f.date.startsWith("2026-10-16")).date, "2026-10-16");
assert.strictEqual(s.docs[0].at, "2026-10-16");
assert.strictEqual(s.main.start, "2026-10-12");

// Dán link Drive: nhận ra file mở được thì lưu Drive ID; link tới file không mở được thì không lưu (không bao giờ bị ẩn)
s = call({ type: "addDoc", doc: { phase: "w6", item: "m1", name: "Sách bảng giá", url: files[0].getUrl().replace("/view", "/view?usp=sharing"), who: "B" } });
assert.strictEqual(s.docs.find(d => d.name === "Sách bảng giá").fid, files[0].getId());
s = call({ type: "addDoc", doc: { phase: "w6", item: "m2", name: "File người khác", url: "https://drive.google.com/file/d/AAAAAAAAAAAAAAAAAAAAAAAA/view", who: "B" } });
assert.strictEqual(s.docs.find(d => d.name === "File người khác").fid, "");

// Câu hỏi trắc nghiệm
const q1 = { phase: "w7", item: "m1", q: "Báo cáo tài chính gồm mấy báo cáo chính?", opts: ["1", "2", "3", "5"], ans: "C", why: "Cân đối, kết quả kinh doanh, lưu chuyển tiền tệ", src: "Sách A–Z", fid: files[0].getId() };
const q2 = { phase: "w5", item: "m1", q: "Mua cổ phiếu là?", opts: ["Cho vay", "Làm chủ một phần", "Gửi tiết kiệm", "Mua vàng"], ans: "B", why: "", src: "" };
assert.ok(call({ type: "addQuestions", items: [{ ...q1, ans: "E" }] }).error, "chặn đáp án ngoài A–D");
assert.ok(call({ type: "addQuestions", items: [{ ...q1, opts: ["1", "2", "3"] }] }).error, "chặn thiếu lựa chọn");
assert.ok(call({ type: "addQuestions", items: [{ ...q1, phase: "x1" }] }).error, "chặn tuần lạ");
assert.ok(call({ type: "addQuestions", items: [] }).error, "chặn danh sách rỗng");
s = call({ type: "addQuestions", items: [q1, q2] });
assert.ok(!s.error, s.error);
assert.strictEqual(s.questions.length, 2);
assert.deepStrictEqual(s.questions[0].opts, ["1", "2", "3", "5"]);
assert.strictEqual(s.questions[0].ans, "C");

// Xóa file trên Drive (vào Thùng rác): ẩn mọi link và câu hỏi của file đó; khôi phục thì hiện lại
const before = s.docs.filter(d => d.fid === files[0].getId()).length;
assert.ok(before >= 2);
files[0].trashed = true; cache.clear();
s = call({ type: "state" });
assert.strictEqual(s.docs.filter(d => d.fid === files[0].getId()).length, 0, "ẩn link của file đã xóa");
assert.ok(s.docs.some(d => d.name === "File người khác"), "không ẩn link tới file không kiểm tra được");
assert.strictEqual(s.questions.length, 1, "ẩn câu hỏi của file đã xóa");
files[0].trashed = false; cache.clear();
s = call({ type: "state" });
assert.strictEqual(s.docs.filter(d => d.fid === files[0].getId()).length, before, "khôi phục file thì hiện lại");
assert.strictEqual(s.questions.length, 2);
assert.strictEqual(call({ type: "delQuestion", id: s.questions[1].id }).questions.length, 1);

// Bảng "Tài liệu" tạo từ bản cũ (7 cột): tự thêm cột "Drive ID"
sheets["Tài liệu"].data[0].length = 7;
call({ type: "state" });
assert.strictEqual(sheets["Tài liệu"].data[0][7], "Drive ID");

delete props.APP_PASSWORD; // không đặt mật khẩu: ai cũng dùng được
assert.strictEqual(call({ type: "state" }, "").fines.length, 3);
assert.strictEqual(call({ type: "state" }, "").docs.length, 4);
console.log("OK: tất cả kiểm tra đều qua");
