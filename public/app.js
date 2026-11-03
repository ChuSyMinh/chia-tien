'use strict';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

let B = null;       // bootstrap
let M = null;       // tháng đang xem
let editingId = null;

// ---------- helpers ----------
async function api(path, opts = {}) {
  const r = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || ('Lỗi ' + r.status));
  return data;
}
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2600);
}
const fmtK = n => { const v = Math.round(n * 10) / 10; return v.toLocaleString('vi-VN', { maximumFractionDigits: 1 }); };
const fmtVnd = k => Math.round(k * 1000).toLocaleString('vi-VN') + ' đ';
const mem = id => B.members.find(m => m.id === id) || { id, name: '(đã xoá)' };
const monthLabel = k => { const [y, m] = k.split('-'); return `Tháng ${+m}/${y}`; };
const shortMonth = k => { const [y, m] = k.split('-'); return `T${+m}/${y}`; };
const noAccent = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
function transferNote(fromId) {
  const tpl = B.transferTemplate || 'TIEN CHUNG {thang} {ten}';
  return noAccent(tpl.replace('{thang}', shortMonth(M.key)).replace('{ten}', mem(fromId).name)).toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50);
}
function qrUrl(m, amountK, note) {
  if (m.qrMode === 'none') return null;
  if (m.qrMode === 'image' && m.qrImage) return m.qrImage;
  if (!m.bankBin || !m.accountNo) return m.qrImage || null;
  const q = new URLSearchParams();
  if (amountK) q.set('amount', Math.round(amountK * 1000));
  if (note) q.set('addInfo', note);
  if (m.accountName) q.set('accountName', m.accountName);
  return `https://img.vietqr.io/image/${m.bankBin}-${m.accountNo}-compact2.png?${q}`;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); }
  toast('Đã sao chép: ' + text);
}

// ---------- load ----------
async function boot(keepMonth) {
  B = await api('/bootstrap');
  document.title = B.appName; $('#appName').textContent = B.appName;
  const sel = $('#monthSel');
  const want = keepMonth || (M && M.key) || store.get('month') || B.current;
  sel.innerHTML = B.months.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join('');
  sel.value = B.months.includes(want) ? want : B.current;
  const me = $('#meSel'), cur = store.get('me') || '';
  me.innerHTML = '<option value="">— chọn —</option>' + B.members.filter(m => m.active).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  me.value = B.members.some(m => m.id === cur) ? cur : '';
  await loadMonth(sel.value);
}
async function loadMonth(key) {
  M = await api('/months/' + key);
  store.set('month', key);
  render();
}
function render() {
  $('#lockBanner').hidden = !M.locked;
  renderBalances(); renderExpForm(); renderExpenses(); renderPay(); renderPeople(); renderAdmin();
}

// ---------- chi tiêu ----------
function monthPeople() {
  const ids = new Set(M.members);
  M.summary.people.forEach(p => ids.add(p.id));
  return [...ids].map(mem);
}
function renderBalances() {
  const me = $('#meSel').value;
  $('#balances').innerHTML = M.summary.people.map(p => {
    const v = p.rounded;
    const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    return `<div class="bal ${cls} ${p.id === me ? 'me' : ''}" title="Đã trả ${fmtK(p.paid)}k · Phần dùng ${fmtK(p.used)}k">
      <span class="who">${esc(mem(p.id).name)}</span><b>${v > 0 ? '+' : ''}${v}</b>
      <span class="hint">${v > 0 ? 'được nhận' : v < 0 ? 'phải trả' : 'hoà'}</span></div>`;
  }).join('') || '<p class="muted">Chưa có thành viên.</p>';
}
function renderExpForm() {
  const f = $('#expForm'), people = monthPeople();
  const buyer = f.buyerId.value || $('#meSel').value;
  f.buyerId.innerHTML = people.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  if (buyer && people.some(m => m.id === buyer)) f.buyerId.value = buyer;
  const checked = new Set($$('#partBox input:checked').map(i => i.value));
  const fresh = !$('#partBox').children.length || $('#partBox').dataset.month !== M.key;
  $('#partBox').dataset.month = M.key;
  $('#partBox').innerHTML = people.map(m => `<label class="chip"><input type="checkbox" value="${m.id}" ${fresh || checked.has(m.id) ? 'checked' : ''}><span>${esc(m.name)}</span></label>`).join('');
  $$('input,select,button', f).forEach(el => el.disabled = M.locked && !B.isAdmin);
  updateSharePreview();
}
function updateSharePreview() {
  const f = $('#expForm'); const a = parseFloat(String(f.amount.value).replace(',', '.'));
  const n = $$('#partBox input:checked').length;
  $('#sharePreview').textContent = a > 0 && n ? `Mỗi người: ${fmtK(a / n)}k (${n} người)` : '';
}
function renderExpenses() {
  const people = monthPeople(); const t = $('#expTable');
  $('#totalLbl').textContent = `Tổng: ${fmtK(M.summary.total)}k · ${M.expenses.length} khoản`;
  $('#expEmpty').hidden = M.expenses.length > 0;
  if (!M.expenses.length) { t.innerHTML = ''; return; }
  const can = !M.locked || B.isAdmin;
  t.innerHTML = `<thead><tr><th>Ngày</th><th>Mua hàng</th><th>Người mua</th><th class="num">Giá</th>
    ${people.map(m => `<th class="c">${esc(m.name)}</th>`).join('')}<th class="num">Lẻ</th><th></th></tr></thead>
    <tbody>${M.expenses.map(e => {
      const share = e.amount / (e.participants.length || 1);
      const d = e.date ? e.date.slice(8, 10) + '/' + e.date.slice(5, 7) : '';
      return `<tr data-id="${e.id}"><td class="muted">${d}</td><td>${esc(e.desc)}</td><td>${esc(mem(e.buyerId).name)}</td><td class="num">${fmtK(e.amount)}</td>
      ${people.map(m => `<td class="c"><input type="checkbox" class="tog" data-p="${m.id}" ${e.participants.includes(m.id) ? 'checked' : ''} ${can ? '' : 'disabled'} aria-label="${esc(m.name)}"></td>`).join('')}
      <td class="num muted">${fmtK(share)}</td>
      <td class="act">${can ? `<button class="icon edit" title="Sửa">✎</button><button class="icon del" title="Xoá">✕</button>` : ''}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr><td></td><td colspan="3"><b>Số dư (+ nhận / − trả)</b></td>${people.map(m => {
      const p = M.summary.people.find(x => x.id === m.id); const v = p ? p.rounded : 0;
      return `<td class="c ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}"><b>${v}</b></td>`; }).join('')}<td></td><td></td></tr></tfoot>`;
}
function expBody(f) {
  return { desc: f.desc.value, amount: f.amount.value, buyerId: f.buyerId.value, date: f.date.value, participants: $$('#partBox input:checked').map(i => i.value) };
}
function resetExpForm() {
  editingId = null; const f = $('#expForm');
  f.desc.value = ''; f.amount.value = ''; f.date.value = new Date().toISOString().slice(0, 10);
  $('#expFormTitle').textContent = 'Thêm khoản chi'; $('#expSubmit').textContent = 'Thêm'; $('#expCancel').hidden = true;
  $$('#partBox input').forEach(i => i.checked = true); updateSharePreview();
}

// ---------- thanh toán ----------
function payInfoHtml(t, withActions) {
  const from = mem(t.from), to = mem(t.to);
  return `<div class="tr"><div class="trMain"><span class="who">${esc(from.name)}</span><span class="arrow">→</span><span class="who">${esc(to.name)}</span>
    <b class="amt">${fmtVnd(t.amount)}</b></div>
    ${withActions ? `<div class="trAct"><button class="btn sm primary showQr" data-from="${t.from}" data-to="${t.to}" data-amt="${t.amount}">Thông tin CK / QR</button>
    <button class="btn sm ghost markPaid" data-from="${t.from}" data-to="${t.to}" data-amt="${t.amount}">Đã chuyển</button></div>` : ''}</div>`;
}
function renderPay() {
  const me = $('#meSel').value, tr = M.summary.transfers;
  $('#modeLbl').textContent = B.settleMode === 'treasurer' && B.treasurerId ? `Qua thủ quỹ: ${mem(B.treasurerId).name}` : 'Chuyển trực tiếp, ít giao dịch nhất';
  if (me) {
    const out = tr.filter(t => t.from === me), inn = tr.filter(t => t.to === me);
    const mine = M.summary.people.find(p => p.id === me);
    $('#myPay').innerHTML = `<div class="card mine"><h2>Của bạn — ${esc(mem(me).name)}</h2>
      ${mine ? `<p class="muted">Đã trả ${fmtK(mine.paid)}k · Phần dùng ${fmtK(mine.used)}k · Số dư ${mine.rounded > 0 ? '+' : ''}${mine.rounded}k</p>` : ''}
      ${out.length ? `<h3>Bạn cần chuyển</h3>${out.map(t => payInfoHtml(t, true)).join('')}` : ''}
      ${inn.length ? `<h3>Bạn sẽ nhận</h3>${inn.map(t => payInfoHtml(t, false)).join('')}` : ''}
      ${!out.length && !inn.length ? '<p class="ok">✓ Bạn không còn khoản nào cần thanh toán tháng này.</p>' : ''}</div>`;
  } else {
    $('#myPay').innerHTML = `<div class="card hintCard">Chọn <b>“Tôi là”</b> ở trên để xem bạn cần chuyển cho ai, bao nhiêu.</div>`;
  }
  $('#transferList').innerHTML = tr.length ? tr.map(t => payInfoHtml(t, true)).join('') : '<p class="ok">✓ Đã thanh toán xong, không ai nợ ai.</p>';
  $('#paymentList').innerHTML = M.payments.length ? M.payments.slice().reverse().map(p => `<div class="tr paid"><div class="trMain">
      <span class="who">${esc(mem(p.from).name)}</span><span class="arrow">→</span><span class="who">${esc(mem(p.to).name)}</span><b class="amt">${fmtVnd(p.amount)}</b></div>
      <div class="trAct"><span class="muted small">${new Date(p.at).toLocaleString('vi-VN')}</span>
      ${p.confirmed ? '<span class="tag ok">Đã xác nhận</span>' : '<span class="tag">Chờ xác nhận</span>'}
      ${B.isAdmin ? `${p.confirmed ? '' : `<button class="btn sm ghost confirmPay" data-id="${p.id}">Xác nhận</button>`}<button class="btn sm danger ghost delPay" data-id="${p.id}">Huỷ</button>` : ''}</div></div>`).join('')
    : '<p class="muted">Chưa có giao dịch nào được ghi nhận.</p>';
}
function openQr(fromId, toId, amt) {
  const to = mem(toId), note = transferNote(fromId), url = qrUrl(to, amt, note);
  const hasBank = to.accountNo;
  $('#qrBody').innerHTML = `<h2>${esc(mem(fromId).name)} chuyển cho ${esc(to.name)}</h2>
    <div class="qrBig">${url ? `<img src="${esc(url)}" alt="Mã QR chuyển khoản" onerror="this.replaceWith(Object.assign(document.createElement('p'),{className:'muted',textContent:'Không tải được ảnh QR (cần Internet). Dùng thông tin bên dưới.'}))">` : '<p class="muted">Chưa có mã QR.</p>'}</div>
    ${to.qrMode === 'image' && to.qrImage ? '<p class="muted small">Ảnh QR tải lên không kèm số tiền — hãy nhập số tiền khi chuyển.</p>' : ''}
    ${hasBank ? `<dl class="kv">
      <dt>Ngân hàng</dt><dd>${esc(to.bankName)}</dd>
      <dt>Số TK</dt><dd><b>${esc(to.accountNo)}</b> <button class="icon cp" data-c="${esc(to.accountNo)}">⧉</button></dd>
      ${to.accountName ? `<dt>Chủ TK</dt><dd>${esc(to.accountName)}</dd>` : ''}
      <dt>Số tiền</dt><dd><b>${fmtVnd(amt)}</b> <button class="icon cp" data-c="${Math.round(amt * 1000)}">⧉</button></dd>
      <dt>Nội dung</dt><dd>${esc(note)} <button class="icon cp" data-c="${esc(note)}">⧉</button></dd></dl>`
    : `<p class="warn">${esc(to.name)} chưa có thông tin tài khoản. Nhờ quản trị viên cập nhật.</p>`}
    <button class="btn primary full markPaid" data-from="${fromId}" data-to="${toId}" data-amt="${amt}">Tôi đã chuyển ${fmtVnd(amt)}</button>`;
  $('#qrDlg').showModal();
}

// ---------- thành viên ----------
function renderPeople() {
  $('#peopleList').innerHTML = B.members.filter(m => m.active).map(m => {
    const url = qrUrl(m, 0, '');
    return `<div class="card person"><div class="pHead"><h3>${esc(m.name)}</h3>${m.phone ? `<span class="muted">${esc(m.phone)}</span>` : ''}</div>
      ${m.accountNo ? `<dl class="kv"><dt>Ngân hàng</dt><dd>${esc(m.bankName)}</dd><dt>Số TK</dt><dd><b>${esc(m.accountNo)}</b> <button class="icon cp" data-c="${esc(m.accountNo)}">⧉</button></dd>
      ${m.accountName ? `<dt>Chủ TK</dt><dd>${esc(m.accountName)}</dd>` : ''}</dl>` : '<p class="muted">Chưa có thông tin tài khoản.</p>'}
      ${url ? `<img class="qrSmall" loading="lazy" src="${esc(url)}" alt="QR ${esc(m.name)}" onerror="this.remove()">` : ''}</div>`;
  }).join('');
}

// ---------- quản trị ----------
function bankOptions(sel) {
  return '<option value="">— chọn ngân hàng —</option>' + B.banks.map(b => `<option value="${b.bin}" ${b.bin === sel ? 'selected' : ''}>${esc(b.short)}</option>`).join('');
}
function renderAdmin() {
  $('#loginForm').hidden = B.isAdmin; $('#adminArea').hidden = !B.isAdmin;
  if (!B.isAdmin) return;
  const box = $('#memberEditors');
  box.innerHTML = '';
  B.members.forEach(m => box.appendChild(memberEditor(m)));
  $('#monthMembers').innerHTML = B.members.map(m => `<label class="chip"><input type="checkbox" value="${m.id}" ${M.members.includes(m.id) ? 'checked' : ''}><span>${esc(m.name)}${m.active ? '' : ' (đã rời)'}</span></label>`).join('');
  $('#monthLocked').checked = !!M.locked;
  const f = $('#settingsForm');
  f.appName.value = B.appName; f.settleMode.value = B.settleMode; f.transferTemplate.value = B.transferTemplate || '';
  f.treasurerId.innerHTML = '<option value="">— không —</option>' + B.members.filter(m => m.active).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('');
  f.treasurerId.value = B.treasurerId || '';
}
function memberEditor(m) {
  const f = $('#memberTpl').content.firstElementChild.cloneNode(true);
  f.dataset.id = m.id || '';
  f.name.value = m.name || ''; f.active.checked = m.active !== false;
  f.bankBin.innerHTML = bankOptions(m.bankBin); f.accountNo.value = m.accountNo || '';
  f.accountName.value = m.accountName || ''; f.phone.value = m.phone || '';
  $$('input[type=radio]', f).forEach(r => { r.name = 'qrMode'; r.checked = r.value === (m.qrMode || 'auto'); });
  const prev = () => {
    const tmp = { ...m, bankBin: f.bankBin.value, accountNo: f.accountNo.value.trim(), accountName: f.accountName.value.trim().toUpperCase(), qrMode: f.qrMode.value };
    const url = qrUrl(tmp, 0, '');
    $('.qrPrev', f).innerHTML = url ? `<img src="${esc(url)}" alt="QR" onerror="this.replaceWith('Không tải được QR')">` : '<span class="muted small">Không có QR</span>';
  };
  prev();
  ['change'].forEach(ev => f.addEventListener(ev, prev));
  $('.delQr', f).hidden = !m.qrImage;
  if (!m.id) { $('.delMem', f).hidden = true; $('.upl', f).title = 'Lưu thành viên trước rồi tải ảnh'; }
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const body = { name: f.name.value, active: f.active.checked, bankBin: f.bankBin.value, accountNo: f.accountNo.value, accountName: f.accountName.value, phone: f.phone.value, qrMode: f.qrMode.value };
    try {
      if (m.id) await api('/admin/members/' + m.id, { method: 'PUT', body });
      else await api('/admin/members', { method: 'POST', body: { ...body, addToMonth: M.key } });
      toast('Đã lưu ' + body.name); await boot();
    } catch (err) { toast(err.message, true); }
  });
  $('input[type=file]', f).addEventListener('change', async ev => {
    const file = ev.target.files[0]; if (!file) return;
    if (!m.id) return toast('Hãy lưu thành viên trước', true);
    if (file.size > 2.5 * 1024 * 1024) return toast('Ảnh tối đa 2.5MB', true);
    const dataUrl = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    try { await api(`/admin/members/${m.id}/qr`, { method: 'POST', body: { dataUrl } }); toast('Đã tải ảnh QR'); await boot(); }
    catch (err) { toast(err.message, true); }
  });
  $('.delQr', f).addEventListener('click', async () => {
    try { await api(`/admin/members/${m.id}/qr`, { method: 'DELETE' }); toast('Đã xoá ảnh QR'); await boot(); } catch (err) { toast(err.message, true); }
  });
  $('.delMem', f).addEventListener('click', async () => {
    if (!confirm(`Xoá ${m.name}? Nếu đã có dữ liệu, thành viên sẽ chỉ bị ẩn (đánh dấu đã rời).`)) return;
    try { const r = await api('/admin/members/' + m.id, { method: 'DELETE' }); toast(r.deactivated ? 'Đã ẩn (vẫn giữ lịch sử)' : 'Đã xoá'); await boot(); } catch (err) { toast(err.message, true); }
  });
  return f;
}

// ---------- sự kiện ----------
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('button[data-tab]'); if (!b) return;
  $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
  $$('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + b.dataset.tab));
  store.set('tab', b.dataset.tab);
});
$('#monthSel').addEventListener('change', e => { editingId = null; loadMonth(e.target.value).catch(err => toast(err.message, true)); });
$('#meSel').addEventListener('change', e => { store.set('me', e.target.value); render(); });
$('#newMonthBtn').addEventListener('click', async () => {
  const d = new Date(); const def = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  const v = prompt('Tạo tháng (định dạng YYYY-MM):', def); if (!v) return;
  try { await api('/months', { method: 'POST', body: { key: v.trim() } }); await boot(v.trim()); toast('Đã tạo ' + monthLabel(v.trim())); } catch (err) { toast(err.message, true); }
});
$('#selAll').addEventListener('click', e => { e.preventDefault(); $$('#partBox input').forEach(i => i.checked = true); updateSharePreview(); });
$('#selNone').addEventListener('click', e => { e.preventDefault(); $$('#partBox input').forEach(i => i.checked = false); updateSharePreview(); });
$('#expForm').addEventListener('input', updateSharePreview);
$('#expForm').addEventListener('submit', async e => {
  e.preventDefault();
  const body = expBody(e.target);
  try {
    if (editingId) await api(`/months/${M.key}/expenses/${editingId}`, { method: 'PUT', body });
    else await api(`/months/${M.key}/expenses`, { method: 'POST', body });
    toast(editingId ? 'Đã cập nhật' : 'Đã thêm “' + body.desc + '”');
    resetExpForm(); await loadMonth(M.key);
  } catch (err) { toast(err.message, true); }
});
$('#expCancel').addEventListener('click', resetExpForm);
$('#expTable').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  const ex = M.expenses.find(x => x.id === tr.dataset.id);
  if (e.target.classList.contains('tog')) {
    const parts = $$('.tog', tr).filter(i => i.checked).map(i => i.dataset.p);
    if (!parts.length) { e.target.checked = true; return toast('Cần ít nhất 1 người', true); }
    try { await api(`/months/${M.key}/expenses/${ex.id}`, { method: 'PUT', body: { ...ex, participants: parts } }); await loadMonth(M.key); }
    catch (err) { toast(err.message, true); e.target.checked = !e.target.checked; }
  } else if (e.target.classList.contains('del')) {
    if (!confirm(`Xoá “${ex.desc}”?`)) return;
    try { await api(`/months/${M.key}/expenses/${ex.id}`, { method: 'DELETE' }); toast('Đã xoá'); await loadMonth(M.key); } catch (err) { toast(err.message, true); }
  } else if (e.target.classList.contains('edit')) {
    editingId = ex.id; const f = $('#expForm');
    f.desc.value = ex.desc; f.amount.value = ex.amount; f.buyerId.value = ex.buyerId; f.date.value = ex.date || '';
    $$('#partBox input').forEach(i => i.checked = ex.participants.includes(i.value));
    $('#expFormTitle').textContent = 'Sửa khoản chi'; $('#expSubmit').textContent = 'Lưu'; $('#expCancel').hidden = false;
    updateSharePreview(); f.scrollIntoView({ behavior: 'smooth' }); f.desc.focus();
  }
});
document.addEventListener('click', async e => {
  const cp = e.target.closest('.cp'); if (cp) return copy(cp.dataset.c);
  const q = e.target.closest('.showQr'); if (q) return openQr(q.dataset.from, q.dataset.to, +q.dataset.amt);
  const mp = e.target.closest('.markPaid');
  if (mp) {
    const amt = +mp.dataset.amt;
    if (!confirm(`Ghi nhận ${mem(mp.dataset.from).name} đã chuyển ${fmtVnd(amt)} cho ${mem(mp.dataset.to).name}?`)) return;
    try { await api(`/months/${M.key}/payments`, { method: 'POST', body: { from: mp.dataset.from, to: mp.dataset.to, amount: amt } });
      $('#qrDlg').open && $('#qrDlg').close(); toast('Đã ghi nhận thanh toán'); await loadMonth(M.key); } catch (err) { toast(err.message, true); }
    return;
  }
  const cf = e.target.closest('.confirmPay');
  if (cf) { try { await api(`/months/${M.key}/payments/${cf.dataset.id}`, { method: 'PUT', body: { confirmed: true } }); await loadMonth(M.key); } catch (err) { toast(err.message, true); } return; }
  const dp = e.target.closest('.delPay');
  if (dp) { if (!confirm('Huỷ giao dịch này?')) return; try { await api(`/months/${M.key}/payments/${dp.dataset.id}`, { method: 'DELETE' }); await loadMonth(M.key); } catch (err) { toast(err.message, true); } }
});
$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  try { await api('/login', { method: 'POST', body: { password: e.target.password.value } }); e.target.reset(); toast('Đăng nhập thành công'); await boot(); }
  catch (err) { toast(err.message, true); }
});
$('#logoutBtn').addEventListener('click', async () => { await api('/logout', { method: 'POST' }); await boot(); });
$('#addMemberBtn').addEventListener('click', () => {
  const ed = memberEditor({ name: '', active: true, qrMode: 'auto' });
  $('#memberEditors').prepend(ed); ed.name.focus();
});
$('#saveMonthBtn').addEventListener('click', async () => {
  try { await api(`/months/${M.key}/settings`, { method: 'PUT', body: { members: $$('#monthMembers input:checked').map(i => i.value), locked: $('#monthLocked').checked } });
    toast('Đã lưu tháng'); await loadMonth(M.key); } catch (err) { toast(err.message, true); }
});
$('#delMonthBtn').addEventListener('click', async () => {
  if (!confirm('Xoá ' + monthLabel(M.key) + '?')) return;
  try { await api('/months/' + M.key, { method: 'DELETE' }); toast('Đã xoá tháng'); M = null; store.set('month', ''); await boot(); } catch (err) { toast(err.message, true); }
});
$('#settingsForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  try { await api('/admin/settings', { method: 'PUT', body: { appName: f.appName.value, settleMode: f.settleMode.value, treasurerId: f.treasurerId.value, transferTemplate: f.transferTemplate.value } });
    toast('Đã lưu cài đặt'); await boot(); } catch (err) { toast(err.message, true); }
});
$('#pwForm').addEventListener('submit', async e => {
  e.preventDefault(); const f = e.target;
  try { await api('/admin/password', { method: 'POST', body: { oldPassword: f.oldPassword.value, newPassword: f.newPassword.value } }); f.reset(); toast('Đã đổi mật khẩu'); }
  catch (err) { toast(err.message, true); }
});

(async () => {
  const t = store.get('tab'); if (t) { const b = $(`#tabs button[data-tab="${t}"]`); b && b.click(); }
  try { await boot(); resetExpForm(); } catch (err) { toast('Không kết nối được máy chủ: ' + err.message, true); }
  setInterval(() => { if (!document.hidden && !editingId && !$('#qrDlg').open && !$('#tab-admin').classList.contains('active') && !['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) loadMonth(M.key).catch(() => {}); }, 20000);
})();
