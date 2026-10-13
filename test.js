// Kiểm tra nhanh: chạy `npm test`. Khởi động server trên thư mục dữ liệu tạm rồi gọi API.
const { spawn } = require("node:child_process");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ck8-"));
const PORT = 3999, base = `http://localhost:${PORT}`;
const auth = { Authorization: "Basic " + Buffer.from("x:matkhau").toString("base64") };
const start = () => spawn(process.execPath, [path.join(__dirname, "server.js")], {
  env: { ...process.env, PORT, DATA_DIR: dir, APP_PASSWORD: "matkhau" }, stdio: "ignore",
});
const wait = ms => new Promise(r => setTimeout(r, ms));
const op = body => fetch(base + "/api/op", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });

(async () => {
  let srv = start();
  try {
    await wait(500);
    assert.strictEqual((await fetch(base + "/api/state")).status, 401, "thiếu mật khẩu phải bị chặn");

    assert.strictEqual((await op({ type: "check", phase: "w1", item: "m1", on: true })).status, 200);
    assert.strictEqual((await op({ type: "check", phase: "w99", item: "m1", on: true })).status, 400, "giai đoạn lạ phải bị từ chối");
    assert.strictEqual((await op({ type: "deposit", who: "A", value: true })).status, 200);
    assert.strictEqual((await op({ type: "deposit", who: "C", value: true })).status, 400);
    assert.strictEqual((await op({ type: "addFine", fine: { who: "A", type: "Trễ giờ", date: "2026-10-15", amount: 50000 } })).status, 200);
    assert.strictEqual((await op({ type: "addFine", fine: { who: "C", type: "Trễ giờ", date: "2026-10-15", amount: 1 } })).status, 400);
    for (let i = 0; i < 2; i++) await op({ type: "addFine", fine: { who: "B", type: "Dùng vé hoãn", date: "2026-10-15", amount: 0 } });
    assert.strictEqual((await op({ type: "addFine", fine: { who: "B", type: "Dùng vé hoãn", date: "2026-10-15", amount: 0 } })).status, 400, "quá 2 vé hoãn");

    // Dữ liệu còn sau khi khởi động lại server
    srv.kill(); await wait(300); srv = start(); await wait(500);
    const s = await (await fetch(base + "/api/state", { headers: auth })).json();
    assert.ok(s.main.checked.w1.m1);
    assert.strictEqual(s.main.deposits.A, true);
    assert.strictEqual(s.fines.length, 3);
    assert.strictEqual(s.fines.find(f => f.who === "A").paid, false);
    console.log("OK: tất cả kiểm tra đều qua");
  } finally {
    srv.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(e => { console.error("FAIL:", e.message); process.exitCode = 1; });
