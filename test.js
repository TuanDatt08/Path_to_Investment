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
  return { data, getRange: range, getMaxRows: () => 1000, setFrozenRows() {}, getLastRow: () => data.length,
    appendRow(row) { data.push([...row]); }, deleteRow(i) { data.splice(i - 1, 1); } };
}

const sheets = {}, props = { APP_PASSWORD: "matkhau" };
const ctx = {
  SpreadsheetApp: { getActive: () => ({ getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = fakeSheet()) }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
  LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  ContentService: { MimeType: { JSON: "json" }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
  Utilities: { getUuid: () => require("node:crypto").randomUUID() },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, "apps-script", "Code.gs"), "utf8"), ctx);
const call = (op, pw = "matkhau") => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ pw, op }) } }).s);

assert.strictEqual(call({ type: "state" }, "sai").auth, false, "sai mật khẩu phải bị chặn");
assert.ok(call({ type: "check", phase: "w1", item: "m1", on: true, title: "Bài 1" }).main.checked.w1.m1);
assert.ok(call({ type: "check", phase: "w99", item: "m1", on: true }).error, "tuần lạ phải bị từ chối");
call({ type: "check", phase: "w1", item: "m2", on: true });
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

delete props.APP_PASSWORD; // không đặt mật khẩu: ai cũng dùng được
assert.strictEqual(call({ type: "state" }, "").fines.length, 2);
console.log("OK: tất cả kiểm tra đều qua");
