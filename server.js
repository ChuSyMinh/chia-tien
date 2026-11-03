// Chia Tiền Chung - web app chia tiền nhà, không cần cài thêm thư viện (Node.js >= 16)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SEED_FILE = path.join(ROOT, 'seed.json');
const QR_DIR = path.join(DATA_DIR, 'qr');
const BACKUP_DIR = path.join(DATA_DIR, 'backup');
const PUBLIC_DIR = path.join(ROOT, 'public');
const BANKS = require('./banks.json');

// ---------- Lưu trữ ----------
for (const d of [DATA_DIR, QR_DIR, BACKUP_DIR]) fs.mkdirSync(d, { recursive: true });

function hashPassword(pw, salt) {
  return crypto.scryptSync(String(pw), salt, 64).toString('hex');
}
function uid() { return crypto.randomBytes(6).toString('hex'); }

let db;
function loadDb() {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } else {
    db = fs.existsSync(SEED_FILE) ? JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')) : { members: [], months: {} };
    db.settings = db.settings || {};
  }
  const s = db.settings = db.settings || {};
  s.appName = s.appName || 'Tiền chung';
  s.settleMode = s.settleMode || 'direct';
  s.sessionSecret = s.sessionSecret || crypto.randomBytes(32).toString('hex');
  if (!s.adminHash) {
    const initial = process.env.ADMIN_PASSWORD || s.initialPassword || crypto.randomBytes(6).toString('base64url');
    fs.writeFileSync(path.join(DATA_DIR, 'MAT-KHAU-ADMIN.txt'), 'Mat khau admin ban dau: ' + initial + '\r\nHay doi trong trang Quan tri roi xoa file nay.\r\n');
    s.adminSalt = crypto.randomBytes(16).toString('hex');
    s.adminHash = hashPassword(initial, s.adminSalt);
    delete s.initialPassword;
    console.log('>> Mật khẩu admin ban đầu: ' + initial + '  (hãy đổi trong trang Quản trị)');
  }
  db.members = db.members || [];
  db.months = db.months || {};
  saveDb();
}
function saveDb() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}
function dailyBackup() {
  try {
    const f = path.join(BACKUP_DIR, 'db-' + new Date().toISOString().slice(0, 10) + '.json');
    if (!fs.existsSync(f)) fs.copyFileSync(DB_FILE, f);
    const files = fs.readdirSync(BACKUP_DIR).filter(x => x.startsWith('db-')).sort();
    while (files.length > 60) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) { console.error('Backup lỗi', e.message); }
}

// ---------- Phiên đăng nhập admin ----------
function sign(v) { return crypto.createHmac('sha256', db.settings.sessionSecret).update(v).digest('hex'); }
function makeToken() {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  return exp + '.' + sign(String(exp) + db.settings.adminHash.slice(0, 16));
}
function isAdmin(req) {
  const m = /(?:^|;\s*)ct_admin=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return false;
  const [exp, sig] = decodeURIComponent(m[1]).split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const good = sign(exp + db.settings.adminHash.slice(0, 16));
  return sig.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
}
const loginAttempts = new Map();

// ---------- Tính toán ----------
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
function currentMonthKey() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
function ensureMonth(key) {
  if (!db.months[key]) {
    db.months[key] = {
      members: db.members.filter(m => m.active !== false).map(m => m.id),
      expenses: [], payments: [], locked: false,
    };
    saveDb();
  }
  return db.months[key];
}

function computeMonth(key) {
  const mo = db.months[key];
  const ids = new Set(mo.members);
  for (const e of mo.expenses) { ids.add(e.buyerId); e.participants.forEach(p => ids.add(p)); }
  const bal = {}; const paid = {}; const used = {};
  ids.forEach(id => { bal[id] = 0; paid[id] = 0; used[id] = 0; });
  let total = 0;
  for (const e of mo.expenses) {
    const amt = Number(e.amount) || 0;
    total += amt;
    paid[e.buyerId] += amt; bal[e.buyerId] += amt;
    const n = e.participants.length;
    if (n) {
      const share = amt / n;
      e.participants.forEach(p => { bal[p] -= share; used[p] += share; });
    }
  }
  // Số dư trước thanh toán (đơn vị nghìn đồng, giống sheet)
  const before = {}; ids.forEach(id => { before[id] = bal[id]; bal[id] = roundK(bal[id]); });
  // Trừ các khoản đã chuyển
  for (const p of mo.payments) {
    if (bal[p.from] === undefined) bal[p.from] = 0;
    if (bal[p.to] === undefined) bal[p.to] = 0;
    bal[p.from] += p.amount; bal[p.to] -= p.amount;
  }
  const transfers = settle(bal, key);
  return {
    total,
    people: [...ids].map(id => ({
      id, paid: round2(paid[id]), used: round2(used[id] || 0),
      balance: round2(before[id]), rounded: roundK(before[id]), remaining: round2(bal[id]),
    })),
    transfers,
  };
}
function round2(x) { return Math.round(x * 100) / 100; }
// làm tròn giống hàm ROUND của Google Sheets (0,5 làm tròn ra xa số 0)
function roundK(x) { return Math.sign(x) * Math.round(Math.abs(x) + 1e-7) || 0; }

// Tạo danh sách chuyển khoản (đơn vị nghìn đồng, làm tròn đến 1 nghìn như sheet)
function settle(balances, key) {
  const entries = Object.entries(balances).map(([id, v]) => [id, roundK(v)]);
  // khử sai số làm tròn để tổng = 0
  let drift = entries.reduce((s, e) => s + e[1], 0);
  entries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  for (let i = 0; drift !== 0 && i < entries.length; i++) {
    const step = drift > 0 ? -1 : 1; entries[i][1] += step; drift += step;
  }
  const debtors = entries.filter(e => e[1] < 0).map(e => ({ id: e[0], v: -e[1] }));
  const creditors = entries.filter(e => e[1] > 0).map(e => ({ id: e[0], v: e[1] }));
  const out = [];
  const t = db.settings.treasurerId;
  if (db.settings.settleMode === 'treasurer' && t && balances[t] !== undefined) {
    // Mọi người chuyển về thủ quỹ, thủ quỹ trả lại cho người được nhận
    for (const d of debtors) if (d.id !== t) out.push({ from: d.id, to: t, amount: d.v });
    for (const c of creditors) if (c.id !== t) out.push({ from: t, to: c.id, amount: c.v });
    return out;
  }
  debtors.sort((a, b) => b.v - a.v); creditors.sort((a, b) => b.v - a.v);
  let i = 0, j = 0;
  while (i < debtors.length && j < creditors.length) {
    const x = Math.min(debtors[i].v, creditors[j].v);
    if (x > 0) out.push({ from: debtors[i].id, to: creditors[j].id, amount: x });
    debtors[i].v -= x; creditors[j].v -= x;
    if (debtors[i].v === 0) i++;
    if (creditors[j].v === 0) j++;
  }
  return out;
}

// ---------- Tiện ích HTTP ----------
function send(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Dữ liệu quá lớn')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON không hợp lệ')); }
    });
    req.on('error', reject);
  });
}
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const need = (cond, msg, code = 400) => { if (!cond) throw new HttpError(code, msg); };
const str = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);

function publicMember(m, admin) {
  const o = {
    id: m.id, name: m.name, active: m.active !== false,
    bankBin: m.bankBin || '', bankName: m.bankName || bankNameOf(m.bankBin),
    accountNo: m.accountNo || '', accountName: m.accountName || '', phone: m.phone || '',
    qrMode: m.qrMode || 'auto', qrImage: m.qrImage ? '/qr/' + m.qrImage + '?v=' + (m.qrVersion || 1) : null,
  };
  return o;
}
function bankNameOf(bin) { const b = BANKS.find(x => x.bin === bin); return b ? b.short : ''; }
function memberExists(id) { return db.members.some(m => m.id === id); }

function validateExpense(b, mo) {
  const desc = str(b.desc, 200);
  const amount = Number(String(b.amount).replace(',', '.'));
  need(desc, 'Thiếu tên món hàng');
  need(isFinite(amount) && amount > 0 && amount < 1e9, 'Giá không hợp lệ');
  need(memberExists(b.buyerId), 'Người mua không hợp lệ');
  const parts = [...new Set(Array.isArray(b.participants) ? b.participants : [])].filter(memberExists);
  need(parts.length > 0, 'Chọn ít nhất 1 người dùng chung');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : '';
  return { desc, amount: Math.round(amount * 1000) / 1000, buyerId: b.buyerId, participants: parts, date, note: str(b.note, 300) };
}

// ---------- Router ----------
async function api(req, res, url) {
  const p = url.pathname.split('/').filter(Boolean).slice(1); // bỏ 'api'
  const M = req.method;
  const admin = isAdmin(req);
  const requireAdmin = () => need(admin, 'Cần đăng nhập quản trị', 401);

  if (M === 'GET' && p[0] === 'bootstrap') {
    ensureMonth(currentMonthKey());
    return send(res, 200, {
      appName: db.settings.appName, isAdmin: admin,
      settleMode: db.settings.settleMode, treasurerId: db.settings.treasurerId || null,
      transferTemplate: db.settings.transferTemplate || 'TIEN CHUNG {thang} {ten}',
      members: db.members.map(m => publicMember(m, admin)),
      months: Object.keys(db.months).sort().reverse(), current: currentMonthKey(), banks: BANKS,
    });
  }
  if (M === 'POST' && p[0] === 'login') {
    const ip = req.socket.remoteAddress;
    const a = loginAttempts.get(ip) || { n: 0, t: Date.now() };
    if (Date.now() - a.t > 15 * 60e3) { a.n = 0; a.t = Date.now(); }
    need(a.n < 10, 'Thử sai quá nhiều, đợi 15 phút', 429);
    const b = await readBody(req);
    const ok = hashPassword(b.password || '', db.settings.adminSalt) === db.settings.adminHash;
    if (!ok) { a.n++; loginAttempts.set(ip, a); throw new HttpError(401, 'Sai mật khẩu'); }
    loginAttempts.delete(ip);
    return send(res, 200, { ok: true }, { 'Set-Cookie': `ct_admin=${encodeURIComponent(makeToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}` });
  }
  if (M === 'POST' && p[0] === 'logout') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'ct_admin=; Path=/; Max-Age=0' });
  }

  // ----- Tháng -----
  if (p[0] === 'months') {
    if (M === 'POST' && p.length === 1) {
      const b = await readBody(req);
      need(MONTH_RE.test(b.key || ''), 'Tháng không hợp lệ');
      ensureMonth(b.key);
      return send(res, 200, { ok: true });
    }
    const key = p[1];
    need(MONTH_RE.test(key || '') && db.months[key], 'Không tìm thấy tháng', 404);
    const mo = db.months[key];
    const editable = () => need(!mo.locked || admin, 'Tháng đã khoá, chỉ quản trị mới sửa được', 403);

    if (M === 'GET' && p.length === 2) {
      return send(res, 200, { key, ...mo, summary: computeMonth(key) });
    }
    if (M === 'DELETE' && p.length === 2) {
      requireAdmin();
      need(!mo.expenses.length && !mo.payments.length, 'Chỉ xoá được tháng trống');
      delete db.months[key]; saveDb();
      return send(res, 200, { ok: true });
    }
    if (p[2] === 'expenses') {
      editable();
      if (M === 'POST') {
        const e = validateExpense(await readBody(req), mo);
        e.id = uid(); e.createdAt = new Date().toISOString();
        mo.expenses.push(e); saveDb();
        return send(res, 200, e);
      }
      const idx = mo.expenses.findIndex(e => e.id === p[3]);
      need(idx >= 0, 'Không tìm thấy khoản chi', 404);
      if (M === 'PUT') {
        const e = validateExpense(await readBody(req), mo);
        mo.expenses[idx] = { ...mo.expenses[idx], ...e, updatedAt: new Date().toISOString() };
        saveDb(); return send(res, 200, mo.expenses[idx]);
      }
      if (M === 'DELETE') { mo.expenses.splice(idx, 1); saveDb(); return send(res, 200, { ok: true }); }
    }
    if (p[2] === 'payments') {
      if (M === 'POST') {
        const b = await readBody(req);
        need(memberExists(b.from) && memberExists(b.to) && b.from !== b.to, 'Người chuyển/nhận không hợp lệ');
        const amount = Number(b.amount);
        need(isFinite(amount) && amount > 0, 'Số tiền không hợp lệ');
        const pay = { id: uid(), from: b.from, to: b.to, amount: Math.round(amount * 1000) / 1000, at: new Date().toISOString(), confirmed: admin };
        mo.payments.push(pay); saveDb();
        return send(res, 200, pay);
      }
      const pay = mo.payments.find(x => x.id === p[3]);
      need(pay, 'Không tìm thấy', 404);
      requireAdmin();
      if (M === 'PUT') { const b = await readBody(req); pay.confirmed = !!b.confirmed; saveDb(); return send(res, 200, pay); }
      if (M === 'DELETE') { mo.payments = mo.payments.filter(x => x !== pay); saveDb(); return send(res, 200, { ok: true }); }
    }
    if (p[2] === 'settings' && M === 'PUT') {
      requireAdmin();
      const b = await readBody(req);
      if (Array.isArray(b.members)) mo.members = [...new Set(b.members)].filter(memberExists);
      if (typeof b.locked === 'boolean') mo.locked = b.locked;
      saveDb(); return send(res, 200, { ok: true });
    }
  }

  // ----- Quản trị -----
  if (p[0] === 'admin') {
    requireAdmin();
    if (p[1] === 'settings' && M === 'PUT') {
      const b = await readBody(req);
      if (b.appName !== undefined) db.settings.appName = str(b.appName, 60) || 'Tiền chung';
      if (['direct', 'treasurer'].includes(b.settleMode)) db.settings.settleMode = b.settleMode;
      if (b.treasurerId !== undefined) db.settings.treasurerId = memberExists(b.treasurerId) ? b.treasurerId : null;
      if (b.transferTemplate !== undefined) db.settings.transferTemplate = str(b.transferTemplate, 80);
      saveDb(); return send(res, 200, { ok: true });
    }
    if (p[1] === 'password' && M === 'POST') {
      const b = await readBody(req);
      need(hashPassword(b.oldPassword || '', db.settings.adminSalt) === db.settings.adminHash, 'Mật khẩu cũ không đúng');
      need(String(b.newPassword || '').length >= 6, 'Mật khẩu mới tối thiểu 6 ký tự');
      db.settings.adminSalt = crypto.randomBytes(16).toString('hex');
      db.settings.adminHash = hashPassword(b.newPassword, db.settings.adminSalt);
      saveDb();
      return send(res, 200, { ok: true }, { 'Set-Cookie': `ct_admin=${encodeURIComponent(makeToken())}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}` });
    }
    if (p[1] === 'members') {
      const fill = (m, b) => {
        if (b.name !== undefined) { const n = str(b.name, 50); need(n, 'Thiếu tên'); need(!db.members.some(x => x.id !== m.id && x.name.toLowerCase() === n.toLowerCase()), 'Tên đã tồn tại'); m.name = n; }
        if (b.bankBin !== undefined) { need(!b.bankBin || BANKS.some(x => x.bin === b.bankBin), 'Ngân hàng không hợp lệ'); m.bankBin = b.bankBin; m.bankName = bankNameOf(b.bankBin); }
        if (b.accountNo !== undefined) { const a = str(b.accountNo, 30).replace(/\s/g, ''); need(!a || /^[0-9A-Za-z]{4,30}$/.test(a), 'Số tài khoản không hợp lệ'); m.accountNo = a; }
        if (b.accountName !== undefined) m.accountName = str(b.accountName, 60).toUpperCase();
        if (b.phone !== undefined) m.phone = str(b.phone, 20);
        if (b.qrMode !== undefined) m.qrMode = ['auto', 'image', 'none'].includes(b.qrMode) ? b.qrMode : 'auto';
        if (b.active !== undefined) m.active = !!b.active;
      };
      if (M === 'POST' && p.length === 2) {
        const b = await readBody(req);
        const m = { id: uid(), name: '', active: true };
        fill(m, b); need(m.name, 'Thiếu tên');
        db.members.push(m);
        if (b.addToMonth && db.months[b.addToMonth] && !db.months[b.addToMonth].members.includes(m.id)) db.months[b.addToMonth].members.push(m.id);
        saveDb(); return send(res, 200, publicMember(m, true));
      }
      const m = db.members.find(x => x.id === p[2]);
      need(m, 'Không tìm thấy thành viên', 404);
      if (M === 'PUT' && p.length === 3) { fill(m, await readBody(req)); saveDb(); return send(res, 200, publicMember(m, true)); }
      if (M === 'DELETE' && p.length === 3) {
        const used = Object.values(db.months).some(mo => mo.expenses.some(e => e.buyerId === m.id || e.participants.includes(m.id)) || mo.payments.some(x => x.from === m.id || x.to === m.id));
        if (used) { m.active = false; saveDb(); return send(res, 200, { ok: true, deactivated: true }); }
        db.members = db.members.filter(x => x !== m);
        Object.values(db.months).forEach(mo => mo.members = mo.members.filter(x => x !== m.id));
        if (m.qrImage) fs.rmSync(path.join(QR_DIR, m.qrImage), { force: true });
        saveDb(); return send(res, 200, { ok: true });
      }
      if (p[3] === 'qr' && M === 'POST') {
        const b = await readBody(req);
        const mm = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.dataUrl || '');
        need(mm, 'Ảnh QR phải là PNG/JPG/WEBP');
        const buf = Buffer.from(mm[2], 'base64');
        need(buf.length < 2.5 * 1024 * 1024, 'Ảnh tối đa 2.5MB');
        if (m.qrImage) fs.rmSync(path.join(QR_DIR, m.qrImage), { force: true });
        m.qrImage = m.id + '.' + (mm[1] === 'jpeg' ? 'jpg' : mm[1]);
        m.qrVersion = Date.now(); m.qrMode = 'image';
        fs.writeFileSync(path.join(QR_DIR, m.qrImage), buf);
        saveDb(); return send(res, 200, publicMember(m, true));
      }
      if (p[3] === 'qr' && M === 'DELETE') {
        if (m.qrImage) fs.rmSync(path.join(QR_DIR, m.qrImage), { force: true });
        m.qrImage = null; if (m.qrMode === 'image') m.qrMode = 'auto';
        saveDb(); return send(res, 200, publicMember(m, true));
      }
    }
    if (p[1] === 'export' && M === 'GET') {
      const safe = JSON.parse(JSON.stringify(db));
      delete safe.settings.adminHash; delete safe.settings.adminSalt; delete safe.settings.sessionSecret;
      return send(res, 200, safe, { 'Content-Disposition': 'attachment; filename="chia-tien-backup.json"' });
    }
  }
  throw new HttpError(404, 'Không tìm thấy API');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
function serveFile(res, base, rel) {
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base + path.sep) && file !== base) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Không tìm thấy'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      // chống CSRF đơn giản: các request ghi phải là JSON từ cùng origin
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Origin không hợp lệ');
      }
      return await api(req, res, url);
    }
    if (url.pathname.startsWith('/qr/')) return serveFile(res, QR_DIR, decodeURIComponent(url.pathname.slice(4)));
    const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
    return serveFile(res, PUBLIC_DIR, rel);
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (!res.headersSent) send(res, e.code || 500, { error: e instanceof HttpError ? e.message : 'Lỗi máy chủ' });
  }
});

loadDb();
dailyBackup();
setInterval(dailyBackup, 6 * 3600 * 1000);
server.listen(PORT, HOST, () => {
  console.log(`\n== ${db.settings.appName} đang chạy ==`);
  console.log(`Trên máy này:   http://localhost:${PORT}`);
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`Trong mạng LAN: http://${a.address}:${PORT}   (${name})`);
  }
});
