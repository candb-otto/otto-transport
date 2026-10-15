(function () {
  'use strict';

  var S = { token: null, user: null, menu: [], page: 'dashboard', units: [], users: [] };
  var ROLE = { SUPER_ADMIN: 'Super Admin', ADMIN: 'Admin', PROD_ADMIN: 'Production Admin', PM: 'PM', DEPT_USER: 'Department User' };
  var DEPT = { FABRIC: 'Fabric', CUTTING: 'Cutting', SEWING: 'Sewing', SEWING_QC: 'Sewing QC', WASHING: 'Washing',
    WASHING_QC: 'Washing QC', IRONING: 'Ironing', IRONING_QC: 'Ironing QC', STICKERING: 'Stickering', PACKING: 'Packing', HR: 'HR' };

  /* ---------- tiny helpers ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function store(k, v) {
    try {
      if (v === undefined) return sessionStorage.getItem(k);
      if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v);
    } catch (e) { /* storage blocked: token stays in memory only */ }
    return null;
  }
  var busy = 0;
  function loading(on) { busy = Math.max(0, busy + (on ? 1 : -1)); $('#loader').hidden = busy === 0; }
  function toast(msg, kind) {
    var d = document.createElement('div');
    d.className = 'toast ' + (kind || '');
    d.textContent = dtext(msg);
    $('#toasts').appendChild(d);
    setTimeout(function () { d.remove(); }, 3800);
  }
  function fail(e) { toast((e && e.message) || 'Something went wrong', 'bad'); }

  /* ---------- API ---------- */
  var API_URL = 'https://production-api.candb-otto.workers.dev';
  // reads may be retried silently; writes are sent once (a retry could save an entry twice)
  var READ = /(List|Report|Info|Check|Detail|Home|Defs|Capacity|Efficiency|Dash|View|Search|Balance|Summary|Data)$|^(me|forecastReport|capEffDetail)$/;
  function post_(body, tries) {
    return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) { return res.json(); })
      .then(function (r) {
        if (r && r.code === 'SERVER' && tries > 0) return new Promise(function (ok) { setTimeout(ok, 700); }).then(function () { return post_(body, tries - 1); });
        return r;
      }, function (e) {
        if (tries > 0) return new Promise(function (ok) { setTimeout(ok, 700); }).then(function () { return post_(body, tries - 1); });
        throw e;
      });
  }
  function api(action, payload, quiet) {
    if (!quiet) loading(true);
    var body = { action: action, token: S.token, payload: withRange(action, payload) };
    return post_(body, READ.test(action) ? 3 : 0).then(function (r) {
      if (!quiet) loading(false);
      if (r && r.ok) { if (r.data && r.data._lm) S.lm = r.data._lm; return r.data; }
      var err = new Error((r && r.error) || 'Request failed');
      err.code = r && r.code;
      if (err.code === 'AUTH' && S.token) endSession(err.message || 'Your session has expired. Please sign in again.');
      throw err;
    }, function () { if (!quiet) loading(false); throw new Error('Cannot reach the server. Check your internet and try again.'); });
  }
  function withRange(action, payload) {
    payload = payload || {};
    if (S.range && /List$/.test(action) && payload.from === undefined && payload.to === undefined) {
      payload = Object.assign({}, payload, { from: S.range.from || '', to: S.range.to || '' });
    }
    return payload;
  }

  /* ---------- modal ---------- */
  function openModal(html, onMount) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="modal-bg"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    root.firstChild.addEventListener('mousedown', function (e) { if (e.target === root.firstChild) closeModal(); });
    if (onMount) onMount($('.modal', root));
    var first = $('.modal input, .modal select', root); if (first) first.focus();
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }
  function confirmBox(title, msg, okLabel, danger) {
    return new Promise(function (resolve) {
      openModal('<h3>' + esc(title) + '</h3><p>' + esc(msg) + '</p><div class="row">' +
        '<button class="btn ghost" data-x="0">Cancel</button>' +
        '<button class="btn ' + (danger ? 'danger' : '') + '" data-x="1">' + esc(okLabel || 'OK') + '</button></div>',
        function (m) {
          m.addEventListener('click', function (e) {
            var x = e.target.getAttribute && e.target.getAttribute('data-x');
            if (x === null || x === undefined) return;
            closeModal(); resolve(x === '1');
          });
        });
    });
  }

  /* ---------- session ---------- */
  function endSession(msg) {
    S.token = null; S.user = null; S.menu = []; clearInterval(NOTIF.timer); NOTIF.open = false; S.rp = null; S.rr = null;
    store('pt_token', null);
    document.body.classList.remove('nav-open');
    renderLogin(msg);
  }
  function startSession(d) {
    S.token = d.token || S.token; S.user = d.user; S.menu = d.menu; S.page = 'dashboard';
    if (d.token) store('pt_token', d.token);
    renderShell();
  }

  /* ---------- login ---------- */
  function renderLogin(msg) {
    $('#app').innerHTML =
      '<div class="login-wrap"><form class="login" id="lf" autocomplete="on">' +
      logoImg(LOGO_CLIENT, 'lg-client', 'Company logo') +
      '<div class="brand"><div class="logo">PT</div><h1>Production Tracking</h1></div>' +
      '<p class="cellsub">Sign in with your employee code</p>' +
      '<label for="lc">Employee code</label><input id="lc" name="username" autocomplete="username" autocapitalize="off" required>' +
      '<label for="lp">Password</label><input id="lp" name="password" type="password" autocomplete="current-password" required>' +
      '<div class="err" id="le" ' + (msg ? '' : 'hidden') + '>' + esc(msg || '') + '</div>' +
      '<button class="btn block" type="submit">Sign in</button>' + poweredBy() + '</form></div>';
    $('#lf').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var code = $('#lc').value, pw = $('#lp').value;
      api('login', { code: code, password: pw }).then(startSession).catch(function (e) {
        $('#lp').value = '';
        var el = $('#le'); el.textContent = e.message; el.hidden = false;
      });
    });
    $('#lc').focus();
  }

  /* ---------- shell ---------- */
  function renderShell() {
    var groups = [], seen = {};
    S.menu.forEach(function (m) { if (!seen[m.group]) { seen[m.group] = 1; groups.push(m.group); } });
    var nav = groups.map(function (g) {
      return '<div class="gw" data-g="' + esc(g) + '"><button class="grp" data-gt="' + esc(g) + '" aria-expanded="false"><span class="chev">&#9656;</span> ' + esc(g) + '</button><div class="gb">' +
        S.menu.filter(function (m) { return m.group === g; }).map(function (m) {
          return '<button class="nav" data-p="' + esc(m.key) + '">' + esc(m.label) + '</button>';
        }).join('') + '</div></div>';
    }).join('');
    try { document.body.classList.toggle('side-off', localStorage.getItem('pt_side') === 'off'); } catch (e) { /* ignore */ }
    $('#app').innerHTML =
      '<header class="top"><button class="burger" id="bg" aria-label="Menu">&#9776;</button>' + logoImg(LOGO_CLIENT, 'lg-top', 'Company logo') +
      '<div class="title">Production Tracking</div><div class="chip">' + esc(S.user.name) + ' &middot; ' + esc(S.user.sa ? 'Super Admin' : (ROLE[S.user.role] || S.user.role)) + '</div>' +
      '<button class="bell" id="bell" type="button" aria-label="Notifications"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg><span class="nb" hidden>0</span></button>' +
      (S.user.role === 'ADMIN' ? '<button class="btn sm ghost" id="rl" title="Re-read the Google Sheet after editing it by hand">Reload data</button>' : '') +
      '<button class="btn sm ghost" id="lo">Sign out</button></header>' +
      '<div class="shell"><nav class="side" id="sd">' + nav + poweredBy('side-p') + '</nav><main class="main" id="view"></main></div><div class="scrim" id="sc"></div><div class="npanel" id="np" hidden></div>';
    initBell();
    $('#bg').onclick = function () {
      if (window.matchMedia('(max-width:820px)').matches) { document.body.classList.toggle('nav-open'); return; }
      var off = document.body.classList.toggle('side-off');
      try { localStorage.setItem('pt_side', off ? 'off' : 'on'); } catch (e) { /* ignore */ }
    };
    $('#sc').onclick = function () { document.body.classList.remove('nav-open'); };
    if ($('#rl')) $('#rl').onclick = function () { api('reloadData').then(function (r) { toast('Data reloaded from the sheet (' + r.sheets + ' sheets)', 'ok'); go(S.page); }).catch(fail); };
    $('#lo').onclick = function () { api('logout').catch(function () {}).then(function () { endSession(); }); };
    $('#sd').addEventListener('click', function (e) {
      var t = e.target.closest ? (e.target.closest('[data-gt]') || e.target) : e.target;
      var g = t.getAttribute && t.getAttribute('data-gt');
      if (g) { setGroup(g, !isGroupOpen(g)); return; }
      var p = e.target.getAttribute && e.target.getAttribute('data-p');
      if (p) { document.body.classList.remove('nav-open'); go(p); }
    });
    initGroups();
    go(S.page);
  }
  /* sidebar groups: open / closed state is remembered per browser */
  function groupState() { try { return JSON.parse(localStorage.getItem('pt_groups') || '{}'); } catch (e) { return {}; } }
  function groupEl(g) { return Array.prototype.filter.call(document.querySelectorAll('.gw'), function (w) { return w.getAttribute('data-g') === g; })[0]; }
  function isGroupOpen(g) { var w = groupEl(g); return !!w && w.classList.contains('open'); }
  function setGroup(g, open, noSave) {
    var w = groupEl(g); if (!w) return;
    w.classList.toggle('open', open);
    w.querySelector('.grp').setAttribute('aria-expanded', open ? 'true' : 'false');
    if (noSave) return;
    var st = groupState(); st[g] = open ? 1 : 0;
    try { localStorage.setItem('pt_groups', JSON.stringify(st)); } catch (e) { /* ignore */ }
  }
  function initGroups() {
    var st = groupState();
    Array.prototype.forEach.call(document.querySelectorAll('.gw'), function (w) {
      var g = w.getAttribute('data-g');
      setGroup(g, st[g] === 1, true);
    });
  }
  function go(page, keepRange) {
    if (!S.menu.some(function (m) { return m.key === page; })) page = 'dashboard';
    if (!keepRange) { S.range = null; S.tf = {}; }
    S.page = page;
    var cur = S.menu.filter(function (m) { return m.key === page; })[0];
    if (cur && !isGroupOpen(cur.group)) setGroup(cur.group, true, true);
    Array.prototype.forEach.call(document.querySelectorAll('.nav'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-p') === page);
    });
    var v = { dashboard: viewDashboard, mgmt: viewMgmt, reports: viewReports, wipdays: viewWipDays, cycle: viewCycle, alertset: viewAlertSet, users: viewUsers, access: viewAccess, password: viewPassword, masters: function (el) { viewMasters(el, false); }, settings: viewSettings, planning: viewPlanning, fabric: viewFabric, lots: viewLots, conversion: viewConversion, layering: viewLayering, cutting: viewCutting, sewout: viewSewOut, sewqc: viewSewQc, sewfinal: viewSewFinal, washing: viewWashing, washmove: viewWashMove, ironing: viewIron, ironqc: viewIronQc, stickering: viewStick, packsend: viewPackSend, packrecv: viewPackRecv, tracking: viewTracking, wip: viewWip, manpower: viewManpower, efficiency: viewEfficiency, capacity: viewCapacity, forecast: viewForecast, orders: viewOrders, ironlots: viewIronLots, jwinward: viewJwInward, audit: viewAudit }[page];
    if (typeof v !== 'function') { $('#view').innerHTML = '<div class="card empty">This page needs the latest screens. Press Ctrl+F5 to load them; if it still shows this, upload the newest app.js to the production-tracking repo.</div>'; return; }
    v($('#view'));
  }

  /* ---------- dashboard (Phase 14) ---------- */
  var DASH_GO = { FORECAST: 'forecast', CUTOFF: 'planning', AGING: 'tracking', MANPOWER: 'manpower', EFFICIENCY: 'efficiency' };
  var DASH_SEV = { LATE: ['Late', 'off'], AT_RISK: ['At risk', 'warn'], WARN: ['Attention', 'warn'], INFO: ['Info', ''] };
  var FSTG = { FABRIC: 'Fabric', CUTTING: 'Cutting', SEWING: 'Sewing', JOBWORK: 'FG inward', IRONING: 'Ironing', PACKING: 'Sent to Packing' };
  function csvDownload(name, rows) {
    var txt = rows.map(function (r) { return r.map(function (c) { c = c == null ? '' : String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\r\n');
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv;charset=utf-8' }));
      a.download = name; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { toast('Download is not supported in this browser', 'err'); }
  }

  /* ---------- Revision D: search / date filter / CSV on transaction tables ---------- */
  var TF_SKIP = { password: 1, reports: 1, alertset: 1, mgmt: 1 };
  var TXN_PAGES = { fabric: 1, lots: 1, conversion: 1, layering: 1, cutting: 1, sewout: 1, sewqc: 1, sewfinal: 1, washing: 1, washmove: 1, ironing: 1, ironqc: 1, stickering: 1, packsend: 1, packrecv: 1, ironlots: 1, jwinward: 1 };   /* every other page gets search / filters / CSV on its tables */
  function dIso(t) {
    var m = /(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(t || ''); if (!m) return '';
    var i = MON.map(function (x) { return x.toLowerCase(); }).indexOf(m[2].toLowerCase()); if (i < 0) return '';
    return m[3] + '-' + (i + 1 < 10 ? '0' : '') + (i + 1) + '-' + (m[1].length < 2 ? '0' : '') + m[1];
  }
  /* multi-select filter: a button that opens a list of tick boxes ("All units" / "Unit 1, Unit 2" / "3 units") */
  function msText(label, sel) { return !sel.length ? 'All ' + label.toLowerCase() : (sel.length <= 2 ? sel.join(', ') : sel.length + ' ' + label.toLowerCase() + ' selected'); }
  /* a search box above a long <select>: typing narrows the options (all words must match); one match is picked at once */
  function searchSelect(sel, ph) {
    if (!sel || sel.getAttribute('data-ss')) return;
    sel.setAttribute('data-ss', '1');
    var all = Array.prototype.map.call(sel.options, function (o) { return { v: o.value, t: o.textContent, d: o.disabled }; });
    var q = document.createElement('input'); q.type = 'search'; q.className = 'ss-q'; q.placeholder = ph || 'Type to search…'; q.setAttribute('autocomplete', 'off'); q.setAttribute('aria-label', ph || 'Search');
    var n = document.createElement('div'); n.className = 'hint ss-n';
    sel.parentNode.insertBefore(q, sel); sel.parentNode.insertBefore(n, sel.nextSibling);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') e.preventDefault(); });
    q.addEventListener('input', function () {
      var words = q.value.toLowerCase().split(/\s+/).filter(Boolean), cur = sel.value, hit = [];
      var keep = all.filter(function (o, i) {
        if (i === 0 && o.v === '') return true;
        var ok = !words.length || words.every(function (w) { return o.t.toLowerCase().indexOf(w) >= 0; });
        if (ok) hit.push(o); return ok || o.v === cur;
      });
      sel.innerHTML = keep.map(function (o) { return '<option value="' + esc(o.v) + '"' + (o.d ? ' disabled' : '') + '>' + esc(o.t) + '</option>'; }).join('');
      sel.value = cur;
      n.textContent = words.length ? (hit.length ? hit.length + ' match' + (hit.length === 1 ? '' : 'es') : 'No match') : '';
      if (words.length && hit.length === 1 && !hit[0].d && sel.value !== hit[0].v) { sel.value = hit[0].v; sel.dispatchEvent(new Event('change')); }
    });
    return q;
  }
  function msHtml(k, label, vals, sel) {
    return '<div class="tf-s ms" data-k="' + k + '" data-l="' + esc(label) + '"><button type="button" class="ms-b" aria-haspopup="true" aria-label="' + esc(label) + '">' + esc(msText(label, sel)) + '</button>' +
      '<div class="ms-p" hidden><div class="ms-a"><button type="button" class="ms-all">Select all</button><button type="button" class="ms-none">Clear</button></div>' +
      vals.map(function (v) { return '<label class="ms-o"><input type="checkbox" value="' + esc(v) + '"' + (sel.indexOf(v) >= 0 ? ' checked' : '') + '> <span>' + esc(v) + '</span></label>'; }).join('') + '</div></div>';
  }
  function msWire(root, onChange) {
    Array.prototype.forEach.call(root.querySelectorAll('.ms'), function (m) {
      var b = m.querySelector('.ms-b'), pnl = m.querySelector('.ms-p'), k = m.getAttribute('data-k'), lab = m.getAttribute('data-l');
      var vals = function () { return [].slice.call(pnl.querySelectorAll('input:checked')).map(function (i) { return i.value; }); };
      var fire = function () { var v = vals(); b.textContent = msText(lab, v); m.classList.toggle('on', v.length > 0); onChange(k, v); };
      m.classList.toggle('on', vals().length > 0);
      b.addEventListener('click', function (e) { e.stopPropagation(); var open = pnl.hidden; Array.prototype.forEach.call(document.querySelectorAll('.ms-p'), function (x) { x.hidden = true; }); pnl.hidden = !open; });
      pnl.addEventListener('click', function (e) { e.stopPropagation(); });
      pnl.addEventListener('change', fire);
      m.querySelector('.ms-all').onclick = function () { Array.prototype.forEach.call(pnl.querySelectorAll('input'), function (i) { i.checked = true; }); fire(); };
      m.querySelector('.ms-none').onclick = function () { Array.prototype.forEach.call(pnl.querySelectorAll('input'), function (i) { i.checked = false; }); fire(); };
    });
  }
  function msClear(root, each) {
    Array.prototype.forEach.call(root.querySelectorAll('.ms'), function (m) {
      Array.prototype.forEach.call(m.querySelectorAll('input'), function (i) { i.checked = false; });
      m.querySelector('.ms-b').textContent = msText(m.getAttribute('data-l'), []); m.classList.remove('on'); each(m.getAttribute('data-k'));
    });
  }
  document.addEventListener('click', function () { Array.prototype.forEach.call(document.querySelectorAll('.ms-p'), function (x) { x.hidden = true; }); });
  function enhanceTables() {
    if (TF_SKIP[S.page]) return;
    var root = document.getElementById('view'); if (!root) return;
    Array.prototype.forEach.call(root.querySelectorAll('table'), function (tb, ti) {
      if (tb.getAttribute('data-tf') || tb.closest('.modal') || tb.classList.contains('nocsv')) return;
      var ths = Array.prototype.map.call(tb.tHead ? tb.tHead.rows[0].cells : [], function (c) { return c.textContent.trim(); });
      var body = tb.tBodies[0]; if (!body || !body.rows.length) return;
      if (S.page === 'dashboard' && body.rows.length < 4) return;
      tb.setAttribute('data-tf', '1');
      var dcol = -1;
      ths.forEach(function (t, i) { if (dcol < 0 && /^(date|started|completed)$/i.test(t)) dcol = i; });
      if (dcol < 0) ths.forEach(function (t, i) { if (dcol < 0 && /(date|since|when|created|updated|last login|time)/i.test(t) && !/(cut-?off|per|hours?|std|standard|sam)/i.test(t)) dcol = i; });
      /* drop-down filters for short, repeating columns (status, unit, season, category, stage ...) */
      var fcols = [], PAGE = 10;
      var cellTxt = function (tr, i) { var c = tr.cells[i]; return c ? c.textContent.replace(/\s+/g, ' ').trim() : ''; };
      /* Unit filter first, on every table that has a unit: a unit column, a "Category / Unit" column, or rows tagged with data-unit */
      var unitAttr = Array.prototype.some.call(body.rows, function (tr) { return tr.hasAttribute('data-unit'); }), unitCol = -1;
      if (!unitAttr) ths.forEach(function (t, i) { if (unitCol < 0 && i !== dcol && /\bunit\b/i.test(t) && !/^(units|unit\s*(id|code))$/i.test(t)) unitCol = i; });
      var unitGet = unitAttr ? function (tr) { return tr.getAttribute('data-unit') || ''; } : (unitCol >= 0 ? function (tr) {
        var c = tr.cells[unitCol]; if (!c) return '';
        if (/^unit$/i.test(ths[unitCol])) return c.textContent.replace(/\s+/g, ' ').trim();
        var sub = c.querySelector('.cellsub'); return (sub || c).textContent.replace(/\s+/g, ' ').trim();
      } : null);
      if (unitGet) {
        var useen = {}; Array.prototype.forEach.call(body.rows, function (tr) { var v = unitGet(tr); if (v) useen[v] = 1; });
        if (Object.keys(useen).length >= 1) fcols.push({ i: unitCol, label: 'Unit', vals: Object.keys(useen).sort(), get: unitGet });
      }
      /* Season and Category filters on transaction pages: taken from the lot (or plan) of each row, so only the seasons and
         categories that are on this page are offered */
      if (TXN_PAGES[S.page] && S.lm) {
        var lotCol = -1, planCol = -1;
        ths.forEach(function (t, i) { if (lotCol < 0 && /^lot\b/i.test(t) && !/^lots\b/i.test(t)) lotCol = i; if (planCol < 0 && /^plan\b/i.test(t)) planCol = i; });
        var first = function (c) { if (!c) return ''; var n = c.querySelector('b') || c.firstChild; return n ? n.textContent.replace(/\s+/g, ' ').trim().toLowerCase() : ''; };
        var look = function (m, t) { return t ? (m[t] || m[t.split(/[\s·]+/)[0]] || null) : null; };
        var lmOf = function (tr) {
          if (tr._lmv !== undefined) return tr._lmv;
          var v = lotCol >= 0 ? look(S.lm.l, first(tr.cells[lotCol])) : null;
          if (!v && planCol >= 0) v = look(S.lm.p, first(tr.cells[planCol]));
          if (!v) { var m = /PLN-\d+/i.exec(tr.textContent); if (m) v = S.lm.p[m[0].toLowerCase()] || null; }
          return (tr._lmv = v);
        };
        [['Season', 0, /^season\b/i], ['Category', 1, /^categor/i]].forEach(function (d) {
          if (ths.some(function (t) { return d[2].test(t) && !/unit/i.test(t); })) return;
          var seen = {}; Array.prototype.forEach.call(body.rows, function (tr) { var v = lmOf(tr); if (v && v[d[1]]) seen[v[d[1]]] = 1; });
          if (Object.keys(seen).length) fcols.push({ i: -1, label: d[0], vals: Object.keys(seen).sort(), get: function (tr) { var v = lmOf(tr); return v ? v[d[1]] : ''; } });
        });
      }
      ths.forEach(function (t, i) {
        if (i === unitCol || (unitAttr && /unit/i.test(t))) return;
        if (/^(to|from)\s/i.test(t)) return;
        if (i === dcol || !/^(status|unit|season|section|category|stage|process|dept|department|type|role|active|buyer|shift|action|entity|module|from|to|style|brand|line)\b/i.test(t) || fcols.length >= 6) return;
        var seen = {}, n = 0, long = false;
        Array.prototype.forEach.call(body.rows, function (tr) { var v = cellTxt(tr, i); if (v.length > 40) long = true; if (v && !seen[v]) { seen[v] = 1; n++; } });
        if (!long && (n >= 2 || (n === 1 && /^(season|categor)/i.test(t))) && n <= 40) fcols.push({ i: i, label: t, vals: Object.keys(seen).sort(), get: (function (ci) { return function (tr) { return cellTxt(tr, ci); }; })(i) });
      });
      var prev = tb.previousElementSibling, title = (prev && /^H3$/.test(prev.tagName) ? prev.textContent : 'table') + '#' + ti;
      S.tf = S.tf || {}; var st = S.tf[title] = S.tf[title] || { q: '' };
      var bar = document.createElement('div'); bar.className = 'fbar tfbar';
      var R = S.range || {};
      bar.innerHTML = '<input type="search" class="tf-q" placeholder="Search…" value="' + esc(st.q) + '" aria-label="Search">' +
        fcols.map(function (f, k) { var cur = st['f' + k]; st['f' + k] = Array.isArray(cur) ? cur.filter(function (v) { return f.vals.indexOf(v) >= 0; }) : (cur ? [cur] : []); return msHtml(k, f.label, f.vals, st['f' + k]); }).join('') +
        (dcol >= 0 ? '<label class="tf-l">From <input type="date" class="tf-f" value="' + esc(R.from || '') + '"></label><label class="tf-l">To <input type="date" class="tf-t" value="' + esc(R.to || '') + '"></label><button class="btn sm ghost tf-c" type="button">Clear</button>' : '') +
        '<span class="tf-n"></span><button class="btn sm ghost tf-x" type="button">Export CSV</button>';
      tb.parentNode.insertBefore(bar, tb);
      var qi = bar.querySelector('.tf-q'), nEl = bar.querySelector('.tf-n');
      var pg = document.createElement('div'); pg.className = 'pager'; tb.parentNode.insertBefore(pg, tb.nextSibling);
      function apply(keep) {
        var q = qi.value.trim().toLowerCase(), f = (S.range && S.range.from) || '', t = (S.range && S.range.to) || '', all = body.rows.length, ms = [];
        st.q = qi.value;
        if (keep !== true) st.p = 0;
        Array.prototype.forEach.call(body.rows, function (tr) {
          var ok = !q || tr.textContent.toLowerCase().indexOf(q) >= 0;
          fcols.forEach(function (f, k) { var w = st['f' + k]; if (ok && w && w.length && w.indexOf(f.get(tr)) < 0) ok = false; });
          if (ok && dcol >= 0 && (f || t)) {
            var d = dIso(tr.cells[dcol] && tr.cells[dcol].textContent);
            if (d && ((f && d < f) || (t && d > t))) ok = false;
          }
          tr._m = ok; if (ok) ms.push(tr);
        });
        var shown = ms.length, pages = Math.max(1, Math.ceil(shown / PAGE));
        st.p = Math.min(Math.max(0, st.p || 0), pages - 1);
        var from = st.p * PAGE, to = from + PAGE;
        Array.prototype.forEach.call(body.rows, function (tr) { tr.style.display = 'none'; });
        ms.forEach(function (tr, i) { if (i >= from && i < to) tr.style.display = ''; });
        nEl.textContent = shown === all ? all + (all === 1 ? ' row' : ' rows') : shown + ' of ' + all + ' rows';
        paintPager(pages, shown);
      }
      function paintPager(pages, shown) {
        if (pages < 2) { pg.innerHTML = ''; return; }
        var cur = st.p, set = {}, h = '';
        [0, 1, 2, pages - 1, cur - 1, cur, cur + 1].forEach(function (n) { if (n >= 0 && n < pages) set[n] = 1; });
        if (pages <= 9) for (var z = 0; z < pages; z++) set[z] = 1;
        var list = Object.keys(set).map(Number).sort(function (a, b) { return a - b; }), last = -1;
        h += '<button type="button" class="pg-b" data-pg="' + (cur - 1) + '"' + (cur === 0 ? ' disabled' : '') + '>&lsaquo; Prev</button>';
        list.forEach(function (n) {
          if (last >= 0 && n - last > 1) h += '<span class="pg-e">&hellip;</span>';
          h += '<button type="button" class="pg-b' + (n === cur ? ' on' : '') + '" data-pg="' + n + '"' + (n === cur ? ' aria-current="page"' : '') + '>' + (n + 1) + '</button>';
          last = n;
        });
        h += '<button type="button" class="pg-b" data-pg="' + (cur + 1) + '"' + (cur === pages - 1 ? ' disabled' : '') + '>Next &rsaquo;</button>';
        h += '<span class="pg-i">Showing ' + (cur * PAGE + 1) + '–' + Math.min(shown, (cur + 1) * PAGE) + ' of ' + shown + '</span>';
        pg.innerHTML = h;
      }
      pg.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.pg-b') : null; if (!b || b.disabled) return;
        st.p = Number(b.getAttribute('data-pg')); apply(true);
        if (bar.scrollIntoView) bar.scrollIntoView({ block: 'nearest' });
      });
      qi.addEventListener('input', function () { apply(); });
      /* sorting: the server sends the newest transaction ID first; clicking a column heading sorts by it
         (1st click A → Z / low → high, 2nd click Z → A / high → low, 3rd click back to the original order) */
      Array.prototype.forEach.call(body.rows, function (tr, i) { tr._i0 = i; });
      function sortKey(tr, c) {
        var t = ((tr.cells[c] && tr.cells[c].textContent) || '').replace(/\s+/g, ' ').trim(), iso = dIso(t), n = Number(t.replace(/[,%\s]/g, ''));
        if (iso && /^\d{1,2}-[A-Za-z]{3}-\d{4}/.test(t)) return { k: iso + t.slice(11), t: 's' };
        if (t !== '' && isFinite(n) && /^[\d.,%\s-]+$/.test(t)) return { k: n, t: 'n' };
        return { k: t.toLowerCase(), t: 's' };
      }
      function doSort(v) {
        st.o = v || '';
        var rows = Array.prototype.slice.call(body.rows), m = /^(\d+):([ad])$/.exec(st.o);
        if (!m) rows.sort(function (a, b) { return a._i0 - b._i0; });
        else {
          var c = Number(m[1]), dir = m[2] === 'a' ? 1 : -1;
          rows.sort(function (a, b) {
            var x = sortKey(a, c), y = sortKey(b, c), r;
            if (x.t === 'n' && y.t === 'n') r = x.k - y.k; else r = String(x.k).localeCompare(String(y.k), undefined, { numeric: true });
            return (r * dir) || (a._i0 - b._i0);
          });
        }
        rows.forEach(function (tr) { body.appendChild(tr); });
        apply();
        Array.prototype.forEach.call(tb.tHead ? tb.tHead.rows[0].cells : [], function (th, i) { th.classList.remove('s-a', 's-d'); if (m && Number(m[1]) === i) th.classList.add(m[2] === 'a' ? 's-a' : 's-d'); });
      }
      Array.prototype.forEach.call(tb.tHead ? tb.tHead.rows[0].cells : [], function (th, i) {
        if (!ths[i]) return;
        th.classList.add('sortable'); th.title = 'Click to sort'; th.tabIndex = 0;
        var click = function () { var m = /^(\d+):([ad])$/.exec(st.o || ''), same = m && Number(m[1]) === i; doSort(!same ? i + ':a' : (m[2] === 'a' ? i + ':d' : '')); };
        th.addEventListener('click', click);
        th.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); click(); } });
      });
      if (st.o) doSort(st.o);
      msWire(bar, function (k, vals) { st['f' + k] = vals; apply(); });
      if (dcol < 0) { var cb = document.createElement('button'); cb.className = 'btn sm ghost tf-c'; cb.type = 'button'; cb.textContent = 'Clear'; bar.insertBefore(cb, bar.querySelector('.tf-n')); cb.addEventListener('click', function () { qi.value = ''; st.q = ''; msClear(bar, function (k) { st['f' + k] = []; }); apply(); }); }
      if (dcol >= 0) {
        var fi = bar.querySelector('.tf-f'), ti2 = bar.querySelector('.tf-t');
        var reload = function () {
          if (fi.value && ti2.value && fi.value > ti2.value) { toast('From date is after To date', 'bad'); return; }
          S.range = (fi.value || ti2.value) ? { from: fi.value, to: ti2.value } : null;
          go(S.page, true);
        };
        fi.addEventListener('change', reload); ti2.addEventListener('change', reload);
        bar.querySelector('.tf-c').addEventListener('click', function () { qi.value = ''; st.q = ''; msClear(bar, function (k) { st['f' + k] = []; }); if (S.range) { S.range = null; go(S.page, true); } else apply(); });
      }
      bar.querySelector('.tf-x').addEventListener('click', function () {
        var keep = []; ths.forEach(function (t, i) { if (t) keep.push(i); });
        var acts = tb.tHead.rows[0].cells.length; var rows = [keep.map(function (i) { return ths[i]; })];
        Array.prototype.forEach.call(body.rows, function (tr) {
          if (tr._m === false) return;
          rows.push(keep.map(function (i) {
            var c = tr.cells[i]; if (!c || c.classList.contains('acts-td')) return '';
            return Array.prototype.map.call(c.childNodes, function (n) { return (n.nodeType === 1 && /^(DIV|BR)$/.test(n.tagName) ? ' | ' : '') + n.textContent; }).join('').replace(/\s*\n\s*/g, ' | ').replace(/\s+/g, ' ').trim();
          }));
        });
        if (rows.length < 2) return toast('Nothing to export', 'bad');
        var nm = (cur_() || S.page) + (S.range ? '_' + (S.range.from || 'start') + '_to_' + (S.range.to || 'now') : '') + (qi.value.trim() ? '_filtered' : '');
        csvDownload(nm.replace(/[^A-Za-z0-9_\-]+/g, '_') + '.csv', rows);
      });
      if (st.o) doSort(st.o);
      apply(true);
    });
  }
  /* page access from the server menu: 'E' edit, 'V' view only */
  function pageEdit(k) { var m = S.menu.filter(function (x) { return x.key === k; })[0]; return !!m && (m.lv ? m.lv === 'E' : true); }
  function deptNames(v) { var a = Array.isArray(v) ? v : String(v || '').split(','); return a.map(function (d) { d = String(d).trim(); return DEPT[d] || d; }).filter(Boolean).join(', '); }
  function cur_() { var m = S.menu.filter(function (x) { return x.key === S.page; })[0]; return m ? (m.label || m.title || m.key) : ''; }
  (function () {
    /* watch the whole page (not just #view): signing out and in builds a new #view, and the bars must come back every time */
    var pend = false;
    function run() { pend = false; try { enhanceTables(); } catch (e) { if (window.console) console.error('table tools', e); } }
    new MutationObserver(function () { if (!pend) { pend = true; setTimeout(run, 30); } }).observe(document.body, { childList: true, subtree: true });
  })();

  /* ---------- Revision E: logos, DD-MMM-YYYY date boxes, Reports, notification bell ---------- */
  var LOGO_CLIENT = 'assets/client-logo.png', LOGO_POWER = 'assets/powered-by.png';
  function logoImg(src, cls, alt, hideParent) {
    return '<img class="' + cls + '" src="' + src + '" alt="' + esc(alt) + '" onerror="' + (hideParent ? 'this.parentNode.style.display=\'none\'' : 'this.style.display=\'none\'') + '">';
  }
  function poweredBy(extra) { return '<div class="powered ' + (extra || '') + '"><span>Powered by</span>' + logoImg(LOGO_POWER, 'lg-pw', 'Powered by', true) + '</div>'; }
  /* any yyyy-mm-dd inside a sentence from the server -> dd-MMM-yyyy */
  function dtext(s) { return String(s == null ? '' : s).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, function (m) { return dfmt(m); }); }

  /* a read-only text box in front of every date input shows 06-Nov-2026; the real input stays behind it and keeps the yyyy-mm-dd value the code uses */
  var VALD = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  function wrapDate(inp) {
    if (inp._dw || inp.type !== 'date' || !inp.parentNode) return;
    inp._dw = 1;
    var blk = getComputedStyle(inp).display === 'block' || /^(modal|login)/.test(inp.parentNode.className || '') || !!inp.closest('.modal, form.login');
    var wrap = document.createElement('span'), box = document.createElement('input');
    wrap.className = 'dwrap' + (blk ? ' blk' : '');
    box.type = 'text'; box.readOnly = true; box.className = 'dbox'; box.placeholder = 'DD-MMM-YYYY';
    box.setAttribute('autocomplete', 'off');
    if (inp.title) box.title = inp.title;
    inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(box); wrap.appendChild(inp);
    inp.className = (inp.className ? inp.className + ' ' : '') + 'dnat'; inp.tabIndex = -1;
    function show() { box.value = inp.value ? dfmt(inp.value) : ''; }
    function state() { wrap.hidden = inp.hidden; box.disabled = inp.disabled; box.required = inp.required; }
    Object.defineProperty(inp, 'value', { configurable: true, get: function () { return VALD.get.call(inp); }, set: function (v) { VALD.set.call(inp, v); show(); } });
    function open() { if (inp.disabled) return; try { inp.showPicker(); } catch (e) { try { inp.focus(); inp.click(); } catch (e2) { /* ignore */ } } }
    box.addEventListener('click', open);
    box.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); open(); } else if ((e.key === 'Backspace' || e.key === 'Delete') && !inp.required) { inp.value = ''; inp.dispatchEvent(new Event('change', { bubbles: true })); } });
    inp.addEventListener('input', show); inp.addEventListener('change', show);
    inp.addEventListener('focus', function () { box.focus(); });
    new MutationObserver(state).observe(inp, { attributes: true, attributeFilter: ['hidden', 'disabled', 'required'] });
    show(); state();
  }
  function wrapDates() { Array.prototype.forEach.call(document.querySelectorAll('input[type=date]'), wrapDate); }
  (function () {
    var pend = false;
    new MutationObserver(function () { if (!pend) { pend = true; setTimeout(function () { pend = false; try { wrapDates(); } catch (e) { /* ignore */ } }, 15); } })
      .observe(document.body, { childList: true, subtree: true });
  })();

  /* ---------- notification bell ---------- */
  var NOTIF = { items: [], count: 0, open: false, timer: null };
  var NSEV = { LATE: 'bad', AT_RISK: 'warn', WARN: 'warn', INFO: 'info' };
  function loadNotifs() {
    if (!S.token) return Promise.resolve();
    return api('notifList', {}, true).then(function (r) { NOTIF.items = r.items || []; NOTIF.count = r.count || 0; paintBell(); }).catch(function () { /* the bell is optional: stay quiet */ });
  }
  function paintBell() {
    var b = document.querySelector('#bell .nb');
    if (b) { b.textContent = NOTIF.count > 99 ? '99+' : String(NOTIF.count); b.hidden = !NOTIF.count; }
    var bt = $('#bell'); if (bt) bt.setAttribute('aria-label', 'Notifications' + (NOTIF.count ? ' (' + NOTIF.count + ' new)' : ''));
    if (NOTIF.open) paintNotifPanel();
  }
  function paintNotifPanel() {
    var p = $('#np'); if (!p) return;
    p.innerHTML = '<div class="nph"><b>Notifications</b>' + (NOTIF.count ? '<span class="cellsub">' + NOTIF.count + '</span>' : '') +
      '<button class="btn sm ghost" id="nclr"' + (NOTIF.count ? '' : ' disabled') + '>Clear all</button></div>' +
      '<div class="npl">' + (NOTIF.items.length ? NOTIF.items.map(function (n, i) {
        return '<button class="ni ' + (NSEV[n.sev] || '') + '" data-i="' + i + '"><span class="nd"></span><span class="nt"><b>' + esc(n.title) + '</b><span>' + esc(dtext(n.text)) + '</span>' +
          (n.when ? '<em>' + esc(dfmt(n.when)) + '</em>' : '') + '</span></button>';
      }).join('') : '<div class="empty">You are all caught up.</div>') + '</div>';
  }
  function toggleNotif(on) {
    NOTIF.open = on === undefined ? !NOTIF.open : on;
    var p = $('#np'); if (!p) return;
    p.hidden = !NOTIF.open;
    if (NOTIF.open) { paintNotifPanel(); loadNotifs(); }
  }
  function initBell() {
    var bt = $('#bell'), p = $('#np'); if (!bt || !p) return;
    bt.onclick = function (e) { e.stopPropagation(); toggleNotif(); };
    p.addEventListener('click', function (e) {
      e.stopPropagation();
      var clr = e.target.closest ? e.target.closest('#nclr') : null;
      if (clr) { api('notifClear', {}, true).then(function () { NOTIF.items = []; NOTIF.count = 0; paintBell(); }).catch(fail); return; }
      var it = e.target.closest ? e.target.closest('.ni') : null;
      if (it) { var n = NOTIF.items[Number(it.getAttribute('data-i'))]; toggleNotif(false); if (n && n.go) go(n.go); }
    });
    if (!document._nbind) { document._nbind = 1; document.addEventListener('click', function () { if (NOTIF.open) toggleNotif(false); }); }
    clearInterval(NOTIF.timer); NOTIF.timer = setInterval(loadNotifs, 180000);
    NOTIF.items = []; NOTIF.count = 0; loadNotifs();
  }

  /* ---------- Reports ---------- */
  var CHART = '#2a78d6';
  function dAgo(n) { var t = new Date(todayStr() + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - n); return t.toISOString().slice(0, 10); }
  function fmtK(n) { var a = Math.abs(n); return a >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : a >= 1e3 ? +(n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : String(n); }
  function bucketLabel(k, by, full) {
    if (by === 'month') return MON[Number(k.slice(5, 7)) - 1] + '-' + k.slice(0, 4);
    var d = dfmt(k); return full ? (by === 'week' ? 'Week of ' + d : d) : d.slice(0, 6);
  }
  function barSvg(data, by, what) {
    if (!data.length) return '<div class="empty">No entries for this selection.</div>';
    var W = 480, H = 210, L = 40, R = 8, T = 12, B = 30, max = 0, i;
    data.forEach(function (x) { if (x.v > max) max = x.v; });
    var raw = (max || 1) / 4, mag = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(function (m) { return m * mag; }).filter(function (s) { return s >= raw; })[0];
    var top = step * 4, n = data.length, cw = (W - L - R) / n, bw = Math.max(2, Math.min(34, cw - Math.min(4, cw * 0.25))), ph = H - T - B;
    var g = '';
    for (i = 0; i <= 4; i++) {
      var y = T + ph - (i * step / top) * ph;
      g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '" class="gl' + (i ? '' : ' base') + '"/><text x="' + (L - 6) + '" y="' + (y + 4) + '" text-anchor="end" class="ax">' + fmtK(i * step) + '</text>';
    }
    var every = Math.ceil(n / 8);
    data.forEach(function (x, j) {
      var cx = L + cw * j + cw / 2, h = Math.max(0, (x.v / top) * ph), bx = cx - bw / 2, by0 = T + ph - h, r = Math.min(4, bw / 2, h);
      if (x.v > 0) g += '<path d="M' + bx + ',' + (T + ph) + ' L' + bx + ',' + (by0 + r) + ' Q' + bx + ',' + by0 + ' ' + (bx + r) + ',' + by0 + ' L' + (bx + bw - r) + ',' + by0 + ' Q' + (bx + bw) + ',' + by0 + ' ' + (bx + bw) + ',' + (by0 + r) + ' L' + (bx + bw) + ',' + (T + ph) + ' Z" fill="' + CHART + '"/>';
      g += '<rect x="' + (cx - cw / 2) + '" y="' + T + '" width="' + cw + '" height="' + ph + '" fill="transparent" data-tip="' + esc(bucketLabel(x.k, by, true) + ': ' + fmtNum(x.v) + (what ? ' ' + what : '')) + '"/>';
      if (j % every === 0) g += '<text x="' + cx + '" y="' + (H - 10) + '" text-anchor="middle" class="ax">' + esc(bucketLabel(x.k, by)) + '</text>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="chart" role="img" aria-label="Bar chart">' + g + '</svg>';
  }
  function hbars(items, unit) {
    items = items.filter(function (x) { return x.v > 0; });
    if (!items.length) return '<div class="empty">No entries for this selection.</div>';
    var max = items[0].v;
    items.forEach(function (x) { if (x.v > max) max = x.v; });
    return '<div class="hb">' + items.map(function (x) {
      return '<div class="hbr"><div class="hbl" title="' + esc(x.n) + '">' + esc(x.n) + '</div><div class="hbt"><i style="width:' + Math.max(1, Math.round(x.v / max * 100)) + '%"></i></div><div class="hbv">' + fmtNum(x.v) + (unit ? ' <small>' + esc(unit) + '</small>' : '') + '</div></div>';
    }).join('') + '</div>';
  }
  function kpiCards(list) {
    return '<div class="rk">' + list.map(function (k) {
      return '<div class="rkc"><div class="rkl">' + esc(k.l) + '</div><div class="rkv' + (k.text ? ' t' : '') + '">' + (k.text ? esc(k.v) : fmtNum(k.v)) + '</div><div class="rks">' + esc(k.sub || '') + '</div></div>';
    }).join('') + '</div>';
  }
  function viewReports(el) {
    S.rp = S.rp || { module: 'ALL', seasonId: '', unitId: '', categoryId: '', from: dAgo(29), to: '', q: '' };
    el.innerHTML = '<div class="page-h"><h2>Reports</h2><button class="btn sm ghost" id="rp_x" type="button">Export CSV</button></div>' + repLinks('reports') +
      '<div class="mhelp">Every transaction in one place: pick a module, narrow it by season, unit, category and date, and export what you see. Cancelled entries are not counted.</div>' +
      '<div id="rpf"></div><div id="rpv"><div class="empty">Loading…</div></div>';
    S.rpBar = false; bindRepLinks(el);
    $('#rp_x').onclick = exportReport;
    var tip = $('#tip'); if (!tip) { tip = document.createElement('div'); tip.id = 'tip'; tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip); }
    var v = $('#rpv');
    function at(e) { var t = e.target.closest ? e.target.closest('[data-tip]') : null; if (!t) { tip.hidden = true; return; } tip.textContent = t.getAttribute('data-tip'); tip.hidden = false; var x = (e.clientX || 0) + 12, y = (e.clientY || 0) - 34; tip.style.left = Math.min(x, window.innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = Math.max(4, y) + 'px'; }
    v.addEventListener('mousemove', at); v.addEventListener('click', at); v.addEventListener('mouseleave', function () { tip.hidden = true; });
    loadReports();
  }
  var rpSeq = 0;
  function loadReports() {
    var my = ++rpSeq;
    return api('reportData', S.rp).then(function (r) {
      if (my !== rpSeq || S.page !== 'reports') return;
      S.rr = r; if (!S.rpBar) paintReportBar(r); paintReport(r);
    }).catch(function (e) { if (my === rpSeq) { var v = $('#rpv'); if (v) v.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; } });
  }
  function paintReportBar(r) {
    S.rpBar = true;
    function opts(list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join(''); }
    var f = S.rp;
    $('#rpf').innerHTML = '<div class="fbar rpbar">' +
      '<select id="rp_m" aria-label="Module"><option value="ALL"' + (f.module === 'ALL' ? ' selected' : '') + '>All modules (overview)</option>' + r.modules.map(function (m) { return '<option value="' + m.k + '"' + (m.k === f.module ? ' selected' : '') + '>' + esc(m.l) + '</option>'; }).join('') + '</select>' +
      '<select id="rp_s" aria-label="Season">' + opts(r.filters.seasons, f.seasonId, 'All seasons') + '</select>' +
      '<select id="rp_u" aria-label="Unit">' + opts(r.filters.units, f.unitId, 'All units') + '</select>' +
      '<select id="rp_c" aria-label="Category">' + opts(r.filters.categories, f.categoryId, 'All categories') + '</select>' +
      '<label class="tf-l">From <input type="date" id="rp_f" value="' + esc(f.from) + '"></label><label class="tf-l">To <input type="date" id="rp_t" value="' + esc(f.to) + '"></label>' +
      '<span class="presets"><button class="btn sm ghost" type="button" data-d="7">7 days</button><button class="btn sm ghost" type="button" data-d="30">30 days</button><button class="btn sm ghost" type="button" data-d="90">90 days</button><button class="btn sm ghost" type="button" data-d="0">All dates</button></span>' +
      '<input type="search" id="rp_q" placeholder="Search lot, plan, category, unit, remarks…" value="' + esc(f.q) + '" aria-label="Search"></div>';
    function bind(id, key) { $(id).addEventListener('change', function () { S.rp[key] = this.value; loadReports(); }); }
    bind('#rp_m', 'module'); bind('#rp_s', 'seasonId'); bind('#rp_u', 'unitId'); bind('#rp_c', 'categoryId');
    function dates() { var a = $('#rp_f').value, b = $('#rp_t').value; if (a && b && a > b) { toast('From date is after To date', 'bad'); return; } S.rp.from = a; S.rp.to = b; loadReports(); }
    $('#rp_f').addEventListener('change', dates); $('#rp_t').addEventListener('change', dates);
    Array.prototype.forEach.call(document.querySelectorAll('.presets [data-d]'), function (b) {
      b.addEventListener('click', function () { var d = Number(b.getAttribute('data-d')); S.rp.from = d ? dAgo(d - 1) : ''; S.rp.to = ''; $('#rp_f').value = S.rp.from; $('#rp_t').value = ''; loadReports(); });
    });
    var tmr; $('#rp_q').addEventListener('input', function () { var q = this.value; clearTimeout(tmr); tmr = setTimeout(function () { S.rp.q = q; loadReports(); }, 350); });
  }
  function periodName(by) { return by === 'month' ? 'month' : by === 'week' ? 'week' : 'day'; }
  function paintReport(r) {
    var h = (r.warnings && r.warnings.length ? '<div class="rwarn">' + r.warnings.map(function (w) { return esc(w); }).join('<br>') + '</div>' : '') + kpiCards(r.kpi);
    if (r.mode === 'ALL') {
      h += '<div class="rg"><div class="card"><h3>Pieces through the factory</h3><div class="cellsub">Pass quantity at each stage in this period</div>' +
        hbars(r.flow.map(function (s) { return { n: s.l, v: s.qty }; }), 'pcs') + '</div>' +
        '<div class="card"><h3>Entries per ' + periodName(r.by) + '</h3><div class="cellsub">All modules together</div>' + barSvg(r.daily, r.by, 'entries') + '</div></div>';
      h += '<h3 class="rt">All modules</h3><div class="tw"><table><thead><tr><th>Module</th><th class="num">Entries</th><th>Measure</th><th class="num">Total</th><th>Other totals</th></tr></thead><tbody>' +
        r.stages.map(function (s) {
          return '<tr><td data-l="Module"><button class="lnk" data-m="' + s.k + '">' + esc(s.l) + '</button></td><td data-l="Entries" class="num">' + fmtNum(s.entries) + '</td><td data-l="Measure">' + esc(s.ql) + '</td><td data-l="Total" class="num">' + fmtNum(s.qty) + '</td><td data-l="Other totals">' +
            (s.extraTotals.length ? esc(s.extraTotals.map(function (e) { return e.l + ' ' + fmtNum(e.v); }).join(' · ')) : '–') + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    } else {
      var unit = r.module === 'manpower' ? 'people' : (r.module === 'fabric' ? '' : 'pcs');
      h += '<div class="rg"><div class="card"><h3>' + esc(r.qtyLabel) + ' per ' + periodName(r.by) + '</h3>' + barSvg(r.daily, r.by, unit) + '</div>' +
        '<div class="card"><h3>By category</h3>' + hbars(r.byCategory, unit) + '</div>' +
        '<div class="card"><h3>By unit</h3>' + hbars(r.byUnit, unit) + '</div>' +
        (r.bySeason.length > 1 || (r.bySeason[0] && r.bySeason[0].n !== '(none)') ? '<div class="card"><h3>By season</h3>' + hbars(r.bySeason, unit) + '</div>' : '') + '</div>';
      h += '<h3 class="rt">' + esc(r.label) + ' entries</h3><div class="cellsub" style="margin:0 0 8px">' + fmtNum(r.total) + (r.total === 1 ? ' entry' : ' entries') + (r.capped ? ' – showing the latest ' + fmtNum(r.rows.length) + '. Narrow the dates to see the rest.' : '') + '</div>';
      h += r.rows.length ? '<div class="tw"><table><thead><tr>' + r.cols.map(function (c) { return '<th' + (c.t === 'num' ? ' class="num"' : '') + '>' + esc(c.l) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        r.rows.map(function (x) {
          return '<tr>' + r.cols.map(function (c) { var v = x[c.k]; return '<td data-l="' + esc(c.l) + '"' + (c.t === 'num' ? ' class="num"' : '') + '>' + (c.t === 'date' ? esc(dfmt(v)) : c.t === 'num' ? fmtNum(v) : esc(v == null ? '' : v)) + '</td>'; }).join('') + '</tr>';
        }).join('') + '</tbody></table></div>' : '<div class="card empty">No entries for this selection. Try a wider date range.</div>';
    }
    $('#rpv').innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll('#rpv .lnk'), function (b) {
      b.addEventListener('click', function () { S.rp.module = b.getAttribute('data-m'); $('#rp_m').value = S.rp.module; loadReports(); });
    });
  }
  function exportReport() {
    var r = S.rr; if (!r) return toast('Nothing to export yet', 'bad');
    var rows;
    if (r.mode === 'ALL') {
      rows = [['Module', 'Entries', 'Measure', 'Total', 'Other totals']].concat(r.stages.map(function (s) { return [s.l, s.entries, s.ql, s.qty, s.extraTotals.map(function (e) { return e.l + ' ' + e.v; }).join(' | ')]; }));
    } else {
      if (!r.rows.length) return toast('Nothing to export', 'bad');
      rows = [r.cols.map(function (c) { return c.l; })].concat(r.rows.map(function (x) { return r.cols.map(function (c) { return c.t === 'date' ? dfmt(x[c.k]) : x[c.k]; }); }));
    }
    var f = S.rp, nm = 'Report_' + (r.mode === 'ALL' ? 'Overview' : r.label) + '_' + (f.from ? dfmt(f.from) : 'start') + '_to_' + (f.to ? dfmt(f.to) : 'today');
    csvDownload(nm.replace(/[^A-Za-z0-9_\-]+/g, '_') + '.csv', rows);
  }

  /* ---------- Audit trail (Phase 15) ---------- */
  function viewAudit(el) {
    S.af = S.af || { module: '', action: '', user: '' };
    el.innerHTML = '<div class="page-h"><h2>Audit Trail</h2></div><div class="mhelp">Every change, cancellation, reopen and master change is recorded here with who did it and the old / new values. Use the date range and search above the table; the filters below narrow the list on the server.</div><div id="av"></div>';
    loadAudit();
  }
  function loadAudit() {
    return api('auditList', S.af).then(function (r) { S.au = r; paintAudit(); }).catch(fail);
  }
  function paintAudit() {
    var r = S.au, f = S.af;
    function opts(list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (x) { var v = x.id !== undefined ? x.id : x, t = x.name !== undefined ? x.name : x; return '<option value="' + esc(v) + '"' + (v === cur ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join(''); }
    var h = '<div class="fbar"><select id="au_m">' + opts(r.modules, f.module, 'All modules') + '</select><select id="au_a">' + opts(r.actions, f.action, 'All actions') + '</select><select id="au_u">' + opts(r.users, f.user, 'All users') + '</select></div>';
    h += '<div class="cellsub" style="margin:4px 0 8px">' + fmtNum(r.total) + ' matching entries' + (r.capped ? ' – showing the latest ' + fmtNum(r.rows.length) + '. Pick a date range to see older ones.' : '') + '</div>';
    h += r.rows.length ? '<table><thead><tr><th>Date</th><th>User</th><th>Action</th><th>Module</th><th>Record</th><th>Change</th></tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="User">' + esc(x.User) + '</td><td data-l="Action"><span class="badge' + (x.Action === 'CANCEL' ? ' warn' : '') + '">' + esc(x.Action) + '</span></td><td data-l="Module">' + esc(x.Module) + '</td><td data-l="Record"><b>' + esc(x.Record_ID) + '</b></td><td data-l="Change" style="white-space:normal;word-break:break-word">' + esc(x.Change) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No audit entries for this filter.</div>';
    $('#av').innerHTML = h;
    ['m:module', 'a:action', 'u:user'].forEach(function (p) {
      var k = p.split(':'); $('#au_' + k[0]).onchange = function () { S.af[k[1]] = this.value; loadAudit(); };
    });
  }

  /* ---------- Phase 15b: correct a wrong entry (Admin / Production Admin) ---------- */
  var CF = {
    IRON: [['date', 'Date', 'date', 'Date'], ['qty', 'Qty', 'num', 'Qty'], ['remarks', 'Remarks', 'text', 'Remarks']],
    STK: [['date', 'Date', 'date', 'Date'], ['qty', 'Qty', 'num', 'Qty'], ['remarks', 'Remarks', 'text', 'Remarks']],
    PRECV: [['date', 'Date', 'date', 'Date'], ['qty', 'Qty', 'num', 'Qty'], ['remarks', 'Remarks', 'text', 'Remarks']],
    WRECV: [['date', 'Date', 'date', 'Date'], ['qty', 'Qty', 'num', 'Qty'], ['remarks', 'Remarks', 'text', 'Remarks']],
    WSEND: [['date', 'Date', 'date', 'Date'], ['qty', 'Qty', 'num', 'Qty'], ['washUnit', 'Washing unit', 'text', 'WashUnit'], ['remarks', 'Remarks', 'text', 'Remarks']],
    CUT: [['date', 'Date', 'date', 'Cut_Date'], ['qty', 'Cut qty', 'num', 'Cut_Qty'], ['remarks', 'Remarks', 'text', 'Remarks']],
    IQC: [['date', 'Date', 'date', 'Date'], ['pass', 'Pass', 'num', 'Pass'], ['fabric', 'Fabric defect', 'num', 'Fabric'], ['unitDefect', 'Unit defect', 'num', 'Unit'], ['cancel', 'Cancel', 'num', 'Cancel'], ['alteration', 'Alteration', 'num', 'Alter'], ['remarks', 'Remarks', 'text', 'Remarks']],
    PSEND: [['date', 'Date', 'date', 'Date'], ['pass', 'Pass', 'num', 'Pass'], ['damage', 'Damage', 'num', 'Damage'], ['cancel', 'Cancel', 'num', 'Cancel'], ['remarks', 'Remarks', 'text', 'Remarks']],
    WMOVE: [['date', 'Date', 'date', 'Date'], ['pass', 'Pass', 'num', 'Pass'], ['damage', 'Damage', 'num', 'Damage'], ['cancel', 'Cancel', 'num', 'Cancel'], ['remarks', 'Remarks', 'text', 'Remarks']],
    SFIN: [['date', 'Date', 'date', 'Date'], ['pass', 'Pass', 'num', 'Pass'], ['damage', 'Damage', 'num', 'Damage'], ['cancel', 'Cancel', 'num', 'Cancel'], ['remarks', 'Remarks', 'text', 'Remarks']],
    SQC: [['date', 'Date', 'date', 'Date'], ['pass', 'Pass', 'num', 'Pass'], ['damage', 'Damage', 'num', 'Damage'], ['cancel', 'Cancel', 'num', 'Cancel'], ['alteration', 'Alteration', 'num', 'Alter'], ['remarks', 'Remarks', 'text', 'Remarks']]
  };
  var CORR_ROWS = {};
  function corrBtn(mod, x) {
    if (!S.user || (S.user.role !== 'ADMIN' && S.user.role !== 'PROD_ADMIN') || !CF[mod] || !pageEdit(S.page)) return '';
    CORR_ROWS[mod + '|' + x._id] = x;
    return '<button class="btn sm ghost" data-corr="' + mod + '|' + esc(x._id) + '">Correct</button>';
  }
  function corrForm(key) {
    var mod = key.split('|')[0], id = key.slice(mod.length + 1), x = CORR_ROWS[key], spec = CF[mod]; if (!x || !spec) return;
    var h = '<h3>Correct entry ' + esc(id) + '</h3><div class="hint">Lot ' + esc(x.Lot_No || '') + '. The old entry is cancelled and a corrected one is saved (same quantity checks as a new entry). If the correction is refused, nothing changes.</div><form id="cr_f">' +
      spec.map(function (f) {
        var v = x[f[3]]; v = v == null ? '' : v;
        return '<label for="cr_' + f[0] + '">' + esc(f[1]) + '</label><input id="cr_' + f[0] + '" data-k="' + f[0] + '" type="' + (f[2] === 'date' ? 'date' : f[2] === 'num' ? 'number' : 'text') + '"' + (f[2] === 'num' ? ' min="0" step="1"' : '') + (f[2] === 'date' ? ' max="' + todayStr() + '"' : '') + ' value="' + esc(v) + '">';
      }).join('') + '<label for="cr_reason">Reason for correction</label><input id="cr_reason" type="text" maxlength="150" placeholder="e.g. typed 1500 instead of 150">' +
      '<div class="acts" style="margin-top:14px"><button class="btn" type="submit">Save correction</button><button class="btn ghost" type="button" id="cr_x">Close</button></div></form>';
    openModal(h, function (m) {
      m.querySelector('#cr_x').onclick = closeModal;
      m.querySelector('#cr_f').onsubmit = function (e) {
        e.preventDefault();
        var fields = {}; Array.prototype.forEach.call(m.querySelectorAll('input[data-k]'), function (i) { fields[i.getAttribute('data-k')] = i.value; });
        var reason = m.querySelector('#cr_reason').value.trim();
        var send = function (ov) {
          return api('entryCorrect', { module: mod, id: id, fields: fields, reason: reason, confirmOver: ov }).then(function () { closeModal(); toast('Entry corrected', 'ok'); go(S.page, true); });
        };
        send(false).catch(function (er) {
          if (er.code === 'OVER') return confirmBox('Confirm correction', er.message, 'Confirm', false).then(function (ok) { if (ok) return send(true).catch(fail); });
          fail(er);
        });
      };
    });
  }
  document.addEventListener('click', function (e) {
    var t = e.target; if (t && t.getAttribute && t.getAttribute('data-corr')) { e.preventDefault(); corrForm(t.getAttribute('data-corr')); }
  });
  function viewDashboard(el) {
    var t0 = todayStr();
    S.df = S.df || { from: t0, to: t0, unitIds: [] };
    var u = S.user;
    el.innerHTML = '<div class="page-h"><h2>Welcome, ' + esc(u.name) + '</h2></div>' +
      '<div class="grid"><div class="card kv">Role<b>' + esc(u.sa ? 'Super Admin' : (ROLE[u.role] || u.role)) + '</b></div>' +
      '<div class="card kv">Unit<b>' + esc(u.unit ? (u.unitName || u.unit) : 'All units') + '</b></div>' +
      '<div class="card kv">Department<b>' + esc(deptNames(u.depts || u.dept) || 'All') + '</b></div></div><div id="dh"></div>';
    loadDash();
  }
  function loadDash() {
    $('#dh').innerHTML = '<div class="card empty">Loading…</div>';
    return api('dashHome', S.df).then(function (r) { S.dr = r; paintDash(); }).catch(fail);
  }
  function kpiRow(b) {
    return '<div class="jr dk">' + b.kpi.map(function (k) {
      var cls = (k.kind === 'late' || k.kind === 'alert') && k.v ? 'bad' : (k.kind === 'wip' ? 'IN_PROGRESS' : '');
      return '<div class="jc ' + cls + '"><h4>' + esc(k.l) + '</h4><div style="font-size:26px;font-weight:700">' + fmtNum(k.v) + '</div><div class="sub">' + esc(k.sub) + '</div></div>';
    }).join('') + '</div>';
  }
  function paintDash() {
    var r = S.dr, f = S.df, h = '', range = r.from === r.to ? dfmt(r.to) : dfmt(r.from) + ' – ' + dfmt(r.to);
    var uName = {}, uId = {}; r.unitsList.forEach(function (x) { uName[x.id.toLowerCase()] = x.name; uId[x.name] = x.id; });
    var selNames = (r.unitIds || []).map(function (id) { return uName[id.toLowerCase()]; }).filter(Boolean);
    h += '<form class="fbar" id="df" style="margin-top:14px"><label for="df_f" class="inl">From</label><input type="date" id="df_f" value="' + esc(r.from) + '" max="' + esc(r.today) + '">' +
      '<label for="df_t" class="inl">To</label><input type="date" id="df_t" value="' + esc(r.to) + '" max="' + esc(r.today) + '">' +
      (r.unitsList.length > 1 ? msHtml('u', 'Unit', r.unitsList.map(function (x) { return x.name; }), selNames) : '') +
      '<button class="btn" type="submit">Show</button></form>';
    /* KPIs: managers get the overall block (department blocks folded below it); department users get their own departments */
    if (r.overview) h += '<h3 class="sec">Overview – ' + esc(range) + '</h3>' + kpiRow(r.overview);
    var depHtml = r.blocks.map(function (b) { return '<h3 class="sec">' + esc(b.title) + '</h3>' + kpiRow(b); }).join('');
    if (r.overview && r.blocks.length) h += '<details class="dk-more" id="dkm"' + (S.dkOpen ? ' open' : '') + '><summary>Department KPIs</summary>' + depHtml + '</details>';
    else if (r.blocks.length) h += depHtml;
    h += '<div class="hint" style="margin-top:6px">Quantities are for the selected dates; WIP is the WIP now.</div>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h3 class="sec">Daily production – ' + esc(range) + '</h3><button class="btn sm ghost" type="button" id="dcsv1">Download CSV</button></div>';
    h += r.daily.length ? '<table><thead><tr><th>Unit</th>' + r.procs.map(function (p) { return '<th>' + esc(STAGE[p] || p) + '</th>'; }).join('') + '<th>Present</th><th>Absent</th><th>Sewing eff.</th></tr></thead><tbody>' +
      r.daily.map(function (d) {
        var c = d.Eff == null ? '' : (d.EffAlert ? 'bad' : (d.Eff >= 85 ? '' : 'warn'));
        return '<tr><td data-l="Unit"><b>' + esc(d.Unit) + '</b></td>' + r.procs.map(function (p) { return '<td data-l="' + esc(STAGE[p] || p) + '">' + (d.By[p] ? fmtNum(d.By[p]) : '-') + '</td>'; }).join('') +
          '<td data-l="Present">' + (d.Present || '-') + '</td><td data-l="Absent">' + (d.AbsentPct == null ? '-' : d.AbsentPct + '%') + '</td>' +
          '<td data-l="Sewing eff.">' + (d.Eff == null ? '-' : '<div class="ebar ' + c + '"><i style="width:' + Math.min(100, d.Eff) + '%"></i></div><b>' + d.Eff + '%</b>') + '</td></tr>';
      }).join('') + (r.daily.length > 1 ? '<tr><td data-l="Unit"><b>Total</b></td>' + r.procs.map(function (p) { return '<td data-l="' + esc(STAGE[p] || p) + '"><b>' + (r.totals[p] ? fmtNum(r.totals[p]) : '-') + '</b></td>'; }).join('') + '<td></td><td></td><td></td></tr>' : '') + '</tbody></table>' : '<div class="card empty">No units.</div>';

    h += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><h3 class="sec">Season progress</h3><button class="btn sm ghost" type="button" id="dcsv2">Download CSV</button></div>';
    h += r.progress.length ? '<table><thead><tr><th>Season</th><th>Plans</th><th>Planned qty</th>' + r.stageKeys.map(function (s) { return '<th>' + esc(FSTG[s]) + '</th>'; }).join('') + '<th>Late / at risk</th></tr></thead><tbody>' +
      r.progress.map(function (s) {
        return '<tr><td data-l="Season"><b>' + esc(s.Season) + '</b></td><td data-l="Plans">' + s.Plans + '</td><td data-l="Plan qty">' + fmtNum(s.Plan_Qty) + '</td>' +
          s.Stages.filter(function (z) { return r.stageKeys.indexOf(z.k) >= 0; }).map(function (z) { return !z.Applies ? '<td data-l="' + esc(FSTG[z.k]) + '">-</td>' : '<td data-l="' + esc(FSTG[z.k]) + '"><div class="ebar"><i style="width:' + Math.min(100, z.Pct || 0) + '%"></i></div><b>' + fmtNum(z.Done) + '</b> <span class="cellsub">(' + (z.Pct == null ? '–' : z.Pct + '%') + ')</span><div class="cellsub">' + (z.k === 'FABRIC' ? 'of planned' : (z.PctIssued == null ? '–' : z.PctIssued + '%') + ' of issued') + '</div></td>'; }).join('') +
          '<td data-l="Late / at risk">' + (s.Late ? '<span class="badge off">' + s.Late + ' late</span> ' : '') + (s.AtRisk ? '<span class="badge warn">' + s.AtRisk + ' at risk</span>' : '') + (!s.Late && !s.AtRisk ? '-' : '') + '</td></tr>';
      }).join('') + '</tbody></table><div class="hint">Each stage: qty (% of planned qty); below = % of fabric issued. Same figures as Season Production Status on the Management Dashboard.</div>' : '<div class="card empty">No active plans in an open season.</div>';

    h += '<h3 class="sec">Alerts' + (r.alertsTotal > r.alerts.length ? ' (top ' + r.alerts.length + ' of ' + r.alertsTotal + ')' : '') + '</h3>';
    var canGo = function (k) { return S.menu.some(function (m) { return m.key === k; }); };
    h += r.alerts.length ? '<table><thead><tr><th>Level</th><th>Alert</th><th>Details</th><th></th></tr></thead><tbody>' + r.alerts.map(function (a) {
      var sv = DASH_SEV[a.Sev] || ['', ''], g = a.Go || DASH_GO[a.Type] || '';
      return '<tr><td data-l="Level"><span class="badge ' + sv[1] + '">' + esc(sv[0]) + '</span></td><td data-l="Alert"><b>' + esc(a.Title) + '</b></td><td data-l="Details">' + esc(a.Text) + '</td>' +
        '<td class="acts-td"><div class="acts">' + (g && canGo(g) ? '<button class="btn sm ghost" type="button" data-go="' + esc(g) + '">Open</button>' : '') + '</div></td></tr>';
    }).join('') + '</tbody></table>' : '<div class="card empty">No alerts. Everything is on track.</div>';

    $('#dh').innerHTML = h;
    var uSel = selNames.slice();
    if ($('#df .ms')) msWire($('#df'), function (k, vals) { uSel = vals; });
    if ($('#dkm')) $('#dkm').addEventListener('toggle', function () { S.dkOpen = this.open; });
    $('#df').onsubmit = function (e) {
      e.preventDefault();
      var fr = $('#df_f').value || r.today, to = $('#df_t').value || r.today;
      if (fr > to) return toast('From date is after To date', 'bad');
      S.df = { from: fr, to: to, unitIds: uSel.map(function (n) { return uId[n]; }).filter(Boolean) }; loadDash();
    };
    $('#dh').onclick = function (e) { var g = e.target.getAttribute && e.target.getAttribute('data-go'); if (g) go(g); };
    $('#dcsv1').onclick = function () {
      csvDownload('daily-production-' + r.from + (r.from === r.to ? '' : '_' + r.to) + '.csv', [['Unit'].concat(r.procs.map(function (p) { return STAGE[p] || p; }), ['Present', 'Absent %', 'Sewing efficiency %'])].concat(
        r.daily.map(function (d) { return [d.Unit].concat(r.procs.map(function (p) { return d.By[p]; }), [d.Present, d.AbsentPct, d.Eff]); }),
        [['Total'].concat(r.procs.map(function (p) { return r.totals[p]; }))]));
    };
    $('#dcsv2').onclick = function () {
      csvDownload('season-progress-' + r.today + '.csv', [['Season', 'Plans', 'Planned qty'].concat(r.stageKeys.map(function (s) { return FSTG[s] + ' pcs'; }), r.stageKeys.map(function (s) { return FSTG[s] + ' % of planned'; }), r.stageKeys.map(function (s) { return FSTG[s] + ' % of issued'; }), ['Late', 'At risk'])].concat(
        r.progress.map(function (s) { var by = {}; s.Stages.forEach(function (z) { by[z.k] = z; }); return [s.Season, s.Plans, s.Plan_Qty].concat(r.stageKeys.map(function (k) { return by[k] ? by[k].Done : ''; }), r.stageKeys.map(function (k) { return by[k] ? by[k].Pct : ''; }), r.stageKeys.map(function (k) { return by[k] && by[k].PctIssued != null ? by[k].PctIssued : ''; }), [s.Late, s.AtRisk]); })));
    };
  }

  /* ---------- change password ---------- */
  function viewPassword(el) {
    el.innerHTML = '<div class="page-h"><h2>Change password</h2></div><form class="card" id="pf" style="max-width:420px">' +
      '<label for="p0">Current password</label><input id="p0" type="password" autocomplete="current-password" required>' +
      '<label for="p1">New password</label><input id="p1" type="password" autocomplete="new-password" required minlength="6">' +
      '<div class="hint">At least 6 characters.</div>' +
      '<label for="p2">Confirm new password</label><input id="p2" type="password" autocomplete="new-password" required>' +
      '<button class="btn block" type="submit">Update password</button></form>';
    $('#pf').addEventListener('submit', function (ev) {
      ev.preventDefault();
      if ($('#p1').value !== $('#p2').value) return toast('New passwords do not match', 'bad');
      api('changePassword', { oldPassword: $('#p0').value, newPassword: $('#p1').value })
        .then(function () { endSession('Password changed. Please sign in again.'); }).catch(fail);
    });
  }

  /* ---------- users (admin) ---------- */
  function viewUsers(el) {
    el.innerHTML = '<div class="page-h"><h2>Users</h2><button class="btn" id="ua">+ Add user</button></div>' +
      '<div class="tools"><input id="uq" type="search" placeholder="Search code or name"><select id="ur"><option value="">All roles</option>' +
      Object.keys(ROLE).map(function (k) { return '<option value="' + k + '">' + ROLE[k] + '</option>'; }).join('') + '</select></div>' +
      '<div id="ul"></div>';
    $('#ua').onclick = function () { userForm(null); };
    $('#uq').oninput = paintUsers; $('#ur').onchange = paintUsers;
    Promise.all([api('listUsers'), api('listUnits')]).then(function (r) {
      S.users = r[0]; S.units = r[1]; paintUsers();
    }).catch(fail);
  }
  function unitText(id, role) {
    if (!id) return (role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'PROD_ADMIN') ? 'All' : '-';
    return String(id).split(',').map(function (one) {
      one = one.trim();
      var hit = S.units.filter(function (x) { return x.Unit_ID === one; })[0];
      return hit ? hit.Unit_Name : one;
    }).join(', ');
  }
  function paintUsers() {
    var q = ($('#uq').value || '').toLowerCase(), role = $('#ur').value;
    var rows = S.users.filter(function (u) {
      return (!role || u.Role === role) && (!q || (u.Employee_Code + ' ' + u.Employee_Name).toLowerCase().indexOf(q) >= 0);
    });
    if (!rows.length) { $('#ul').innerHTML = '<div class="card empty">No users found</div>'; return; }
    $('#ul').innerHTML = '<table><thead><tr><th>Code</th><th>Name</th><th>Role</th><th>Department</th><th>Unit</th><th>Status</th><th>Last login</th><th></th></tr></thead><tbody>' +
      rows.map(function (u) {
        return '<tr><td data-l="Code"><b>' + esc(u.Employee_Code) + '</b></td><td data-l="Name">' + esc(u.Employee_Name) + '</td>' +
          '<td data-l="Role"><span class="badge">' + esc(ROLE[u.Role] || u.Role) + '</span></td>' +
          '<td data-l="Department">' + esc(deptNames(u.Department) || '-') + '</td><td data-l="Unit">' + esc(unitText(u.Unit_ID, u.Role)) + '</td>' +
          '<td data-l="Status"><span class="badge ' + (u.Active ? 'ok' : 'off') + '">' + (u.Active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td data-l="Last login">' + esc(dfmt(u.Last_Login) || '-') + '</td>' +
          '<td class="acts-td"><div class="acts"><button class="btn sm ghost" data-a="edit" data-id="' + esc(u.User_ID) + '">Edit</button>' +
          '<button class="btn sm ghost" data-a="pw" data-id="' + esc(u.User_ID) + '">Reset password</button>' +
          '<button class="btn sm ghost" data-a="tg" data-id="' + esc(u.User_ID) + '">' + (u.Active ? 'Deactivate' : 'Activate') + '</button></div></td></tr>';
      }).join('') + '</tbody></table>';
    $('#ul').onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var u = S.users.filter(function (x) { return x.User_ID === e.target.getAttribute('data-id'); })[0]; if (!u) return;
      if (a === 'edit') userForm(u); else if (a === 'pw') resetForm(u); else toggleUser(u);
    };
  }
  function refreshUsers() { return api('listUsers').then(function (u) { S.users = u; paintUsers(); }); }

  function userForm(u) {
    var isNew = !u; u = u || { Role: 'DEPT_USER', Active: true };
    var roleOpts = Object.keys(ROLE).filter(function (k) { return k !== 'SUPER_ADMIN' || S.user.sa || u.Role === 'SUPER_ADMIN'; }).map(function (k) { return '<option value="' + k + '"' + (u.Role === k ? ' selected' : '') + '>' + ROLE[k] + '</option>'; }).join('');
    var myD = String(u.Department || '').split(',').map(function (x) { return x.trim(); });
    var deptOpts = Object.keys(DEPT).map(function (k) { return '<label class="chk"><input type="checkbox" class="f_d" value="' + k + '"' + (myD.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(DEPT[k]) + '</label>'; }).join('');
    var mine = String(u.Unit_ID || '').split(',').map(function (x) { return x.trim(); });
    var unitOpts = S.units.map(function (x) { return '<label class="chk"><input type="checkbox" class="f_u" value="' + esc(x.Unit_ID) + '"' + (mine.indexOf(x.Unit_ID) >= 0 ? ' checked' : '') + '> ' + esc(x.Unit_Name) + '</label>'; }).join('');
    openModal('<h3>' + (isNew ? 'Add user' : 'Edit user') + '</h3><form id="uf">' +
      '<label>Employee code</label><input id="f_c" value="' + esc(u.Employee_Code || '') + '" required maxlength="20" autocomplete="off">' +
      '<label>Name</label><input id="f_n" value="' + esc(u.Employee_Name || '') + '" required maxlength="60" autocomplete="off">' +
      '<label>Email (optional)</label><input id="f_e" type="email" value="' + esc(u.Email || '') + '" autocomplete="off">' +
      '<label>Role</label><select id="f_r">' + roleOpts + '</select>' +
      '<div id="f_dw"><label>Department(s)</label><div class="chkbox">' + deptOpts + '</div><div class="hint">Tick every department this user records for. Page-by-page access is set on the User Access page.</div></div>' +
      '<div id="f_uw"><label>Unit(s)</label><div class="chkbox">' + unitOpts + '</div><div class="hint">Tick every unit this user works for, e.g. A1 and A2 for a shared Cutting or Ironing team.</div>' +
      (S.units.length ? '' : '<div class="hint">No units yet. Add a row in the Unit_Master sheet first.</div>') + '</div>' +
      (isNew ? '<label>Password</label><input id="f_p" type="password" autocomplete="new-password" minlength="6" required><div class="hint">At least 6 characters. The user can change it after signing in.</div>' : '') +
      '<div class="row"><button type="button" class="btn ghost" id="f_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>',
      function () {
        function sync() {
          var r = $('#f_r').value;
          $('#f_dw').hidden = r !== 'DEPT_USER';
          $('#f_uw').hidden = !(r === 'PM' || r === 'DEPT_USER');
        }
        $('#f_r').onchange = sync; sync();
        $('#f_x').onclick = closeModal;
        $('#uf').onsubmit = function (ev) {
          ev.preventDefault();
          var fields = { Employee_Code: $('#f_c').value, Employee_Name: $('#f_n').value, Email: $('#f_e').value,
            Role: $('#f_r').value, Department: [].slice.call(document.querySelectorAll('.f_d')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }).join(','),
            Unit_ID: [].slice.call(document.querySelectorAll('.f_u')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }).join(',') };
          var call = isNew ? api('createUser', { fields: fields, password: $('#f_p').value })
                           : api('updateUser', { userId: u.User_ID, fields: fields });
          call.then(function () { closeModal(); toast(isNew ? 'User created' : 'User updated', 'ok'); return refreshUsers(); }).catch(fail);
        };
      });
  }
  function resetForm(u) {
    openModal('<h3>Reset password</h3><p>' + esc(u.Employee_Name) + ' (' + esc(u.Employee_Code) + ')</p><form id="rf">' +
      '<label>New password</label><input id="r_p" type="password" autocomplete="new-password" minlength="6" required>' +
      '<div class="hint">Share it with the user privately. Their active sessions are ended.</div>' +
      '<div class="row"><button type="button" class="btn ghost" id="r_x">Cancel</button><button class="btn" type="submit">Reset</button></div></form>',
      function () {
        $('#r_x').onclick = closeModal;
        $('#rf').onsubmit = function (ev) {
          ev.preventDefault();
          api('resetUserPassword', { userId: u.User_ID, newPassword: $('#r_p').value })
            .then(function () { closeModal(); toast('Password reset', 'ok'); }).catch(fail);
        };
      });
  }
  function toggleUser(u) {
    var next = !u.Active;
    confirmBox(next ? 'Activate user?' : 'Deactivate user?',
      next ? u.Employee_Name + ' will be able to sign in again.' : u.Employee_Name + ' will be signed out and blocked immediately.',
      next ? 'Activate' : 'Deactivate', !next).then(function (ok) {
      if (!ok) return;
      api('setUserActive', { userId: u.User_ID, active: next })
        .then(function () { toast(next ? 'User activated' : 'User deactivated', 'ok'); return refreshUsers(); }).catch(fail);
    });
  }


  /* ---------- Management Dashboard (Super Admin) ---------- */
  var MG_ST = { OK: ['Balanced', 'ok'], OVER: ['Over WIP', 'bad'], CONSTRAINT: ['Constraint', 'warn'], NONE: ['No WIP', ''] };
  var MG_SS = { DONE: ['Completed', 'ok'], ON_TRACK: ['On track', 'ok'], AT_RISK: ['At risk', 'warn'], LATE: ['Late', 'bad'], OVERDUE: ['Past cutoff', 'bad'] };
  var MG_LV = { CRITICAL: 'bad', HIGH: 'warn', WATCH: 'info', GOOD: 'ok' };
  var MG_SK = { FABRIC: 'Fabric', CUTTING: 'Cutting', SEWING: 'Sewing', JOBWORK: 'Job work', IRONING: 'Ironing', PACKING: 'Sent to Packing' };
  function mgN(n) { return n == null ? '–' : fmtNum(Math.round(n)); }
  function mgP(n) { return n == null ? '–' : n + '%'; }
  /* change vs previous period: arrow + % (or points); good = the direction that is good news */
  function mgD(chg, good, pts, extra) {
    if (chg == null) return '<span class="mg-d flat">new</span>';
    if (chg === 0 && extra === 'zero') return '<span class="mg-d flat">–</span>';
    var c = chg === 0 ? 'flat' : ((chg > 0) === (good !== 'down') ? 'up' : 'down');
    return '<span class="mg-d ' + c + '">' + (chg > 0 ? '▲ ' : (chg < 0 ? '▼ ' : '')) + (chg > 0 ? '+' : '') + chg + (pts ? ' pts' : '%') + (extra ? ' <i>' + extra + '</i>' : '') + '</span>';
  }
  function mgPts(a, b) { return a == null || b == null ? null : Math.round((a - b) * 10) / 10; }
  function mgRange(r) { return dfmt(r.from) + (r.from !== r.to ? ' to ' + dfmt(r.to) : ''); }
  function mgPrev(r) { return dfmt(r.prevFrom) + (r.prevFrom !== r.prevTo ? ' to ' + dfmt(r.prevTo) : ''); }
  function viewMgmt(el) {
    var t = todayStr();
    S.mg = S.mg || { from: t, to: t, unitId: '', seasonId: '' };
    el.innerHTML = '<div class="mg">' +
      '<div class="mg-top"><div><h2>Management Dashboard</h2><div class="mg-sub" id="mg_sub">Factory production status</div></div>' +
      '<div class="mg-act"><button class="btn ghost" id="mg_csv">Export CSV</button><button class="btn" id="mg_pdf">Export PDF</button></div></div>' +
      '<div class="mg-filters card"><div class="mg-f"><label>From<input type="date" id="mg_f"></label><label>To<input type="date" id="mg_t"></label></div>' +
      '<div class="mg-q"><button type="button" class="chipb" data-q="today">Today</button><button type="button" class="chipb" data-q="yday">Yesterday</button><button type="button" class="chipb" data-q="7">Last 7 days</button><button type="button" class="chipb" data-q="month">This month</button></div>' +
      '<div class="mg-f"><label>Unit<select id="mg_u"><option value="">All units</option></select></label><label>Season<select id="mg_s"><option value="">All open seasons</option></select></label></div></div>' +
      '<div id="mgb"><div class="card empty">Loading…</div></div></div>';
    $('#mg_f').value = S.mg.from; $('#mg_t').value = S.mg.to;
    var reload = function () { S.mg.from = $('#mg_f').value || todayStr(); S.mg.to = $('#mg_t').value || S.mg.from; if (S.mg.from > S.mg.to) { toast('From date is after To date', 'bad'); return; } S.mg.unitId = $('#mg_u').value; S.mg.seasonId = $('#mg_s').value; loadMgmt(); };
    $('#mg_f').onchange = reload; $('#mg_t').onchange = reload; $('#mg_u').onchange = reload; $('#mg_s').onchange = reload;
    $('.mg-q').onclick = function (e) {
      var q = e.target.getAttribute && e.target.getAttribute('data-q'); if (!q) return;
      var td = todayStr(), f = td, to = td;
      if (q === 'yday') { f = to = dAgo(1); } else if (q === '7') { f = dAgo(6); } else if (q === 'month') { f = td.slice(0, 8) + '01'; }
      $('#mg_f').value = f; $('#mg_t').value = to; reload();
    };
    $('#mg_csv').onclick = mgCsv; $('#mg_pdf').onclick = mgPdf;
    loadMgmt();
  }
  var mgSeq = 0;
  function loadMgmt() {
    var my = ++mgSeq;
    return api('mgmtDash', { from: S.mg.from, to: S.mg.to, unitId: S.mg.unitId, seasonId: S.mg.seasonId }).then(function (r) {
      if (my !== mgSeq || S.page !== 'mgmt') return;
      S.mgr = r; S.mg.from = r.from; S.mg.to = r.to; $('#mg_f').value = r.from; $('#mg_t').value = r.to;
      $('#mg_u').innerHTML = '<option value="">All units</option>' + r.filters.units.map(function (u) { return '<option value="' + esc(u.id) + '"' + (S.mg.unitId === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('');
      $('#mg_s').innerHTML = '<option value="">All open seasons</option>' + r.filters.seasons.map(function (s) { return '<option value="' + esc(s.id) + '"' + (S.mg.seasonId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('');
      var td = todayStr();
      Array.prototype.forEach.call(document.querySelectorAll('.mg-q .chipb'), function (b) {
        var q = b.getAttribute('data-q'), on = (q === 'today' && r.from === td && r.to === td) || (q === 'yday' && r.from === dAgo(1) && r.to === dAgo(1)) || (q === '7' && r.from === dAgo(6) && r.to === td) || (q === 'month' && r.from === td.slice(0, 8) + '01' && r.to === td);
        b.classList.toggle('on', on);
      });
      $('#mg_sub').textContent = mgRange(r) + ' · ' + r.len + ' day(s) · compared with ' + mgPrev(r);
      paintMgmt(r);
    }).catch(function (e) { if (my === mgSeq) { var b = $('#mgb'); if (b) b.innerHTML = '<div class="card empty">' + esc(e.message) + '</div>'; } });
  }
  function mgSec(n, title, sub, body, cls) {
    return '<section class="mg-sec ' + (cls || '') + '"><div class="mg-h"><h3>' + esc(title) + '</h3>' + (sub ? '<span class="mg-hs">' + sub + '</span>' : '') + '</div>' + body + '</section>';
  }
  function paintMgmt(r) {
    var h = '<div class="mg-p1">';
    /* print header (PDF only) */
    h += '<div class="mg-ph"><div class="mg-ph1"><div class="mg-pl">' + logoImg(LOGO_CLIENT, 'mg-logo mg-logo-c', 'Company logo') + '</div><div class="mg-pc">Otto Clothing Pvt Ltd</div><div class="mg-pr">' + logoImg(LOGO_POWER, 'mg-logo mg-logo-p', 'Powered by') + '</div></div>' +
      '<div class="mg-pt">Factory Production Status Report</div>' +
      '<div class="mg-pf"><span><b>Date range:</b> ' + esc(mgRange(r)) + '</span><span>' + esc(r.unit ? 'Unit - ' + r.unit.name : 'All Units') + '</span><span>' + esc(r.season ? r.season.name : 'All Open Seasons') + '</span></div>' +
      '<div class="mg-pcmp">Compared with the previous period ' + esc(mgPrev(r)) + '</div></div>';
    /* stage output with the change vs the previous period */
    h += mgSec(1, 'Stage Output', esc(mgRange(r)) + ' · change vs ' + esc(mgPrev(r)), '<div class="mg-kpis">' + r.kpi.map(function (k) {
      return '<div class="mg-kpi"><div class="mg-kl">' + esc(k.l) + '</div><div class="mg-kv">' + mgN(k.Qty) + '</div>' +
        (r.len > 1 ? '<div class="mg-ks">Avg ' + mgN(k.PerDay) + ' pcs / day</div>' : '') +
        '<div class="mg-kc">' + (k.Qty || k.Prev ? mgD(k.Chg, 'up', false) + ' <span class="mg-ks">vs previous (' + mgN(k.Prev) + ')</span>' : '<span class="mg-d flat">No output</span>') + '</div></div>';
    }).join('') + '</div>');
    /* 3. seasons */
    var sk = []; r.seasons.forEach(function (s) { s.Stages.forEach(function (x) { if (sk.indexOf(x.k) < 0) sk.push(x.k); }); });
    sk = ['FABRIC', 'CUTTING', 'SEWING', 'JOBWORK', 'IRONING', 'PACKING'].filter(function (k) { return sk.indexOf(k) >= 0; });
    h += mgSec(3, 'Season Production Status', 'days left as on ' + esc(dfmt(r.to)), r.seasons.length ? '<div class="mg-tw"><table class="mg-t"><thead><tr><th>Season</th><th class="n">Planned qty</th>' + sk.map(function (k) { return '<th>' + esc(MG_SK[k]) + '</th>'; }).join('') + '<th>Sewing cutoff</th><th class="n">Days left</th><th class="n">Sewing need / pace per day</th><th>Status</th></tr></thead><tbody>' +
      r.seasons.map(function (s) {
        var by = {}; s.Stages.forEach(function (x) { by[x.k] = x; }); var st = MG_SS[s.Status] || [s.Status, ''];
        return '<tr><td data-l="Season"><b>' + esc(s.Season) + '</b><div class="mg-sm">' + s.Plans + ' plan(s)</div></td><td class="n" data-l="Plan qty">' + mgN(s.Qty) + '</td>' +
          sk.map(function (k) { return '<td data-l="' + esc(MG_SK[k]) + '">' + mgStageCell(by[k]) + '</td>'; }).join('') +
          '<td data-l="Sewing cutoff">' + esc(dfmt(s.Cutoff) || '–') + '</td><td class="n" data-l="Days left"><b class="' + (s.DaysLeft != null && s.DaysLeft < 0 ? 'mg-neg' : '') + '">' + (s.DaysLeft == null ? '–' : s.DaysLeft) + '</b>' + (s.DaysLeft != null ? '<div class="mg-sm">' + s.WorkDaysLeft + ' working</div>' : '') + '</td>' +
          '<td class="n" data-l="Need / pace">' + (s.SewRemaining > 0 ? '<b>' + mgN(s.NeedPerDay) + '</b> / ' + mgN(s.PacePerDay) + '<div class="mg-sm">' + mgN(s.SewRemaining) + ' pcs to sew</div>' : '<span class="mg-sm">sewing done</span>') + '</td>' +
          '<td data-l="Status"><span class="mg-chip ' + st[1] + '">' + esc(st[0]) + '</span></td></tr>';
      }).join('') + '</tbody></table></div><div class="mg-note">Each stage: qty (% of planned qty); the line below = % of fabric issued.</div>' + mgCatTable(r, sk) : '<div class="card empty">No open season' + (r.season ? '' : 's') + ' with plans for this filter.</div>');
    /* 4 + 5. charts */
    h += '<div class="mg-two">' + mgSec(4, r.chart.title, esc(mgRange(r)) + ' · vs previous period', '<div class="mg-ch">' + mgColumns(r.chart.bars) + '</div>', 'mg-half') +
      mgSec(5, 'WIP by Stage – Days of Work Held', 'as on today · days = WIP ÷ avg output of last ' + r.wipAvgDays + ' working days', '<div class="mg-ch">' + mgWipBars(r.funnel) + '</div>', 'mg-half') + '</div>';
    h += '</div><div class="mg-p2">';
    /* 6. gauges */
    var g = r.gauge;
    h += mgSec(6, 'Sewing Manpower & Capacity', esc(mgRange(r)) + ' · vs previous period', '<div class="mg-gs">' +
      mgGauge('Sewing Dept Absent %', g.Absent.Cur, g.Absent.Prev, 'down', [5, 10], 'Strength ' + mgN(g.Absent.Strength) + ' · Present ' + mgN(g.Absent.Present) + ' · Absent ' + mgN(g.Absent.Absent) + ' (avg / day)') +
      mgGauge('Machine Utilization %', g.Machine.Cur, g.Machine.Prev, 'up', [75, 90], 'Present ' + mgN(g.Machine.Present) + ' on ' + mgN(g.Machine.Machines) + ' machines (avg / day)') +
      mgGauge('Capacity Utilization %', g.Capacity.Cur, g.Capacity.Prev, 'up', [70, 85], 'Equivalent output ' + mgN(g.Capacity.EqOut) + ' of capacity ' + mgN(g.Capacity.Capacity) + ' · OT ' + g.Capacity.OtManDays + ' man-days') +
      '</div><div class="mg-note">Capacity = (machine-days on working days + OT man-hours ÷ ' + r.shiftHours + ') × ' + r.stdPerMachine + ' equivalent pcs per machine. Manpower and capacity are for the whole unit (not per season).</div>');
    /* 7. unit table */
    var cols = r.stages;
    var cell = function (x) { return '<b>' + mgN(x.Qty) + '</b><div>' + (x.Qty || x.Prev ? mgD(x.Chg, 'up') : '<span class="mg-d flat">–</span>') + '</div>'; };
    var SH = { FABRIC: 'Fabric issued', CUTTING: 'Cutting out', SEWING: 'Sewing out', IRONING: 'Ironing out', STICKERING: 'Sticker. out', PACKING: 'Packing recv.' };
    var row = function (u, tot) {
      return '<tr' + (tot ? ' class="mg-tot"' : '') + '><td data-l="Unit"><b>' + esc(u.Unit) + '</b></td>' + cols.map(function (c) { return '<td class="n" data-l="' + esc(c.l) + '">' + cell(u.Stages[c.k]) + '</td>'; }).join('') +
        '<td class="n" data-l="Total qty">' + cell({ Qty: u.Total, Prev: u.TotalPrev, Chg: u.TotalChg }) + '</td>' +
        '<td class="n" data-l="Sewing present">' + mgN(u.Cur.Present) + '<div>' + mgD(u.Prev.Present ? Math.round((u.Cur.Present - u.Prev.Present) / u.Prev.Present * 1000) / 10 : null, 'up') + '</div></td>' +
        '<td class="n" data-l="Absent">' + mgN(u.Cur.Absent) + ' · ' + mgP(u.Cur.AbsentPct) + '<div>' + (u.Cur.AbsentPct == null ? '' : mgD(mgPts(u.Cur.AbsentPct, u.Prev.AbsentPct), 'down', true)) + '</div></td>' +
        '<td class="n" data-l="Machine util.">' + mgP(u.Cur.MachUtil) + '<div>' + (u.Cur.MachUtil == null ? '' : mgD(mgPts(u.Cur.MachUtil, u.Prev.MachUtil), 'up', true)) + '</div></td>' +
        '<td class="n" data-l="Capacity util.">' + mgP(u.Cur.CapUtil) + '<div>' + (u.Cur.CapUtil == null ? '' : mgD(mgPts(u.Cur.CapUtil, u.Prev.CapUtil), 'up', true)) + '</div></td></tr>';
    };
    h += mgSec(7, 'Unit-wise Performance', esc(mgRange(r)) + ' · small figures = change vs previous period', r.units.length ? '<div class="mg-tw"><table class="mg-t mg-ut"><thead><tr><th>Unit</th>' + cols.map(function (c) { return '<th class="n">' + esc(SH[c.k] || c.l) + '</th>'; }).join('') +
      '<th class="n">Total qty</th><th class="n">Sewing present</th><th class="n">Absent no · %</th><th class="n">Machine util.</th><th class="n">Capacity util.</th></tr></thead><tbody>' +
      r.units.map(function (u) { return row(u, false); }).join('') + (r.units.length > 1 ? row(r.total, true) : '') + '</tbody></table></div>' : '<div class="card empty">No unit.</div>');
    /* 8. insights */
    h += mgSec(8, 'Key Insights', 'where to focus', r.insights.length ? '<ol class="mg-ins">' + r.insights.map(function (x) {
      return '<li><span class="mg-chip ' + (MG_LV[x.Level] || '') + '">' + esc(x.Level.charAt(0) + x.Level.slice(1).toLowerCase()) + '</span><span class="mg-ia">' + esc(x.Area) + '</span><span class="mg-it">' + esc(x.Text) + '</span></li>';
    }).join('') + '</ol>' : '<div class="card empty">Nothing stands out for this period.</div>');
    h += '</div>';
    $('#mgb').innerHTML = h;
  }
  function mgStageCell(x) {
    if (!x) return '<span class="mg-sm">–</span>';
    var p = x.Pct == null ? 0 : Math.min(100, x.Pct);
    return '<div class="mg-pb"><i class="' + (x.Pct >= 100 ? 'ok' : '') + '" style="width:' + p + '%"></i></div><div class="mg-pv">' + mgN(x.Done) + ' <span class="mg-pp">(' + mgP(x.Pct) + ')</span></div>' +
      (x.k === 'FABRIC' ? '<div class="mg-sm">of planned</div>' : '<div class="mg-sm">' + mgP(x.PctIssued) + ' of issued</div>');
  }
  /* category-wise status of the same open-season plans: qty and % per stage, grouped by season when there is more than one */
  function mgCatTable(r, sk) {
    var cats = r.categories || []; if (!cats.length) return '';
    var names = []; cats.forEach(function (c) { if (names.indexOf(c.Season) < 0) names.push(c.Season); });
    var multi = names.length > 1, span = sk.length + 2;
    var cell = function (x) { return x ? '<b>' + mgN(x.Done) + '</b> <span class="mg-sm">(' + mgP(x.Pct) + (x.k === 'FABRIC' ? '' : ' · ' + mgP(x.PctIssued)) + ')</span>' : '<span class="mg-sm">–</span>'; };
    var pc = function (a, b) { return b > 0 ? Math.round(a / b * 1000) / 10 : null; };
    /* product-type subtotal (Shirt / Trouser ...) worked out from its categories */
    var sum = function (list) {
      var o = { Qty: 0, by: {} };
      list.forEach(function (c) { o.Qty += c.Qty; c.Stages.forEach(function (x) { var t = o.by[x.k] || (o.by[x.k] = { k: x.k, Done: 0, Base: 0, Issued: 0 }); t.Done += x.Done; t.Base += x.Base; t.Issued += x.Issued || 0; }); });
      Object.keys(o.by).forEach(function (k) { var t = o.by[k]; t.Pct = pc(t.Done, t.Base); t.PctIssued = k === 'FABRIC' ? null : pc(t.Done, t.Issued); });
      return o;
    };
    var row = function (c) {
      var by = {}; c.Stages.forEach(function (x) { by[x.k] = x; });
      return '<tr><td data-l="Category" class="mg-ci">' + esc(c.Category) + '</td><td class="n" data-l="Planned qty">' + mgN(c.Qty) + '</td>' +
        sk.map(function (k) { return '<td class="n" data-l="' + esc(MG_SK[k]) + '">' + cell(by[k]) + '</td>'; }).join('') + '</tr>';
    };
    var h = '';
    names.forEach(function (sn) {
      var inS = cats.filter(function (c) { return c.Season === sn; }), types = [];
      inS.forEach(function (c) { if (types.indexOf(c.Type) < 0) types.push(c.Type); });
      if (multi) h += '<tr class="mg-grp"><td colspan="' + span + '">' + esc(sn) + '</td></tr>';
      types.forEach(function (t) {
        var list = inS.filter(function (c) { return c.Type === t; }), tt = sum(list);
        h += '<tr class="mg-typ"><td data-l="Type">' + esc(t) + ' <span class="mg-sm">· ' + list.length + ' categor' + (list.length === 1 ? 'y' : 'ies') + '</span></td><td class="n" data-l="Planned qty">' + mgN(tt.Qty) + '</td>' +
          sk.map(function (k) { return '<td class="n" data-l="' + esc(MG_SK[k]) + '">' + cell(tt.by[k]) + '</td>'; }).join('') + '</tr>';
        h += list.map(row).join('');
      });
    });
    return '<div class="mg-sub2">Category wise Status' + (multi ? '' : ' - ' + esc(names[0])) + '</div><div class="mg-tw"><table class="mg-t mg-ct"><thead><tr><th>Category</th><th class="n">Planned qty</th>' +
      sk.map(function (k) { return '<th class="n">' + esc(MG_SK[k]) + '</th>'; }).join('') + '</tr></thead><tbody>' + h +
      '</tbody></table></div><div class="mg-note">Grouped by product type (Shirt, Trouser …) with its total. Qty (% of planned qty · % of fabric issued).</div>';
  }
  /* column chart: current (blue) and previous period (grey) per unit or per stage */
  function mgColumns(bars) {
    if (!bars.length) return '<div class="card empty">No data.</div>';
    var W = 560, H = MG_CH, L = 46, R = 8, T = 18, B = 34, pw = W - L - R, ph = H - T - B;
    var mx = Math.max.apply(null, bars.map(function (b) { return Math.max(b.v, b.p); }).concat([1]));
    var step = Math.pow(10, Math.floor(Math.log10(mx))), top = Math.ceil(mx / step) * step; if (top / step < 4) { step /= 2; top = Math.ceil(mx / step) * step; }
    var y = function (v) { return T + ph - v / top * ph; }, gw = pw / bars.length, bw = Math.max(6, Math.min(34, gw * 0.32));
    var s = '<svg class="mg-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Column chart">';
    for (var v = 0; v <= top + 0.001; v += step) s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="mg-grid"/><text x="' + (L - 6) + '" y="' + (y(v) + 3.5) + '" class="mg-ax" text-anchor="end">' + fmtK(v) + '</text>';
    bars.forEach(function (b, i) {
      var cx = L + gw * i + gw / 2, x1 = cx - bw - 1, x2 = cx + 1;
      s += '<g><title>' + esc(b.l) + ': ' + fmtNum(b.v) + ' pcs (previous ' + fmtNum(b.p) + ')</title>' +
        '<path class="mg-bc" d="' + mgBar(x1, y(b.v), bw, T + ph - y(b.v)) + '"/><path class="mg-bp" d="' + mgBar(x2, y(b.p), bw, T + ph - y(b.p)) + '"/>' +
        (b.v > 0 ? '<text x="' + (x1 + bw / 2) + '" y="' + (y(b.v) - 4) + '" class="mg-vl" text-anchor="middle">' + fmtK(b.v) + '</text>' : '') +
        '<rect x="' + (cx - gw / 2) + '" y="' + T + '" width="' + gw + '" height="' + ph + '" fill="transparent"/></g>' +
        '<text x="' + cx + '" y="' + (H - B + 16) + '" class="mg-xl" text-anchor="middle">' + esc(b.l.length > 12 ? b.l.slice(0, 11) + '…' : b.l) + '</text>';
    });
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + (T + ph) + '" y2="' + (T + ph) + '" class="mg-base"/></svg>';
    return s + '<div class="mg-lg"><span><i class="c"></i>Selected period</span><span><i class="p"></i>Previous period</span></div>';
  }
  function mgBar(x, yy, w, h) { if (h <= 0) return ''; var r = Math.min(4, w / 2, h); return 'M' + x + ',' + (yy + h) + 'V' + (yy + r) + 'Q' + x + ',' + yy + ' ' + (x + r) + ',' + yy + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + yy + ' ' + (x + w) + ',' + (yy + r) + 'V' + (yy + h) + 'Z'; }
  var MG_CH = 290;   /* both charts share this height (viewBox 560 x 290) */
  /* WIP by stage: horizontal bars (length = WIP pcs), with the days of work it holds and its status */
  function mgWipBars(rows) {
    if (!rows.length) return '<div class="card empty">No WIP.</div>';
    var W = 560, H = MG_CH, L = 150, Rw = 132, T = 6, bw = W - L - Rw - 58, n = rows.length, slot = (H - T) / n, bh = Math.min(30, slot * 0.62);
    var mx = Math.max.apply(null, rows.map(function (r) { return r.Wip; }).concat([1]));
    var s = '<svg class="mg-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="WIP by stage">';
    s += '<line x1="' + L + '" x2="' + L + '" y1="' + T + '" y2="' + H + '" class="mg-base"/>';
    rows.forEach(function (r, i) {
      var w = r.Wip > 0 ? Math.max(3, r.Wip / mx * bw) : 0, y0 = T + i * slot + (slot - bh) / 2, cy = y0 + bh / 2, st = MG_ST[r.Status] || ['', ''];
      s += '<g><title>' + esc(r.l) + ': ' + fmtNum(r.Wip) + ' pcs WIP in ' + r.Lots + ' lot(s) · ' + (r.Days == null ? 'no recent output' : r.Days + ' days of output') + ' · ' + st[0] + '</title>' +
        '<text x="' + (L - 8) + '" y="' + (cy + 4) + '" class="mg-fl" text-anchor="end">' + esc(r.l) + '</text>' +
        (w ? '<path class="mg-fb ' + st[1] + '" d="' + mgHBar(L, y0, w, bh) + '"/>' : '') +
        '<text x="' + (L + w + 6) + '" y="' + (cy + 4) + '" class="mg-vl">' + fmtNum(r.Wip) + '</text>' +
        '<text x="' + (W - Rw + 8) + '" y="' + (cy - 2) + '" class="mg-fd">' + (r.Days == null ? '–' : r.Days + ' days') + '</text>' +
        '<text x="' + (W - Rw + 8) + '" y="' + (cy + 12) + '" class="mg-fs ' + st[1] + '">' + esc(st[0]) + (r.Max || r.Min ? ' (' + (r.Min || 0) + '–' + (r.Max || '∞') + ' d)' : '') + '</text>' +
        '<rect x="0" y="' + (T + i * slot) + '" width="' + W + '" height="' + slot + '" fill="transparent"/></g>';
    });
    return s + '</svg><div class="mg-lg"><span><i class="ok"></i>Balanced</span><span><i class="warn"></i>Constraint (too little WIP)</span><span><i class="bad"></i>Over WIP (pile-up)</span></div>';
  }
  function mgHBar(x, y, w, h) { var r = Math.min(4, h / 2, w); return 'M' + x + ',' + y + 'H' + (x + w - r) + 'Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + 'V' + (y + h - r) + 'Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) + 'H' + x + 'Z'; }
  /* semicircle gauge 0-100% (over 100 shows full); band colour from the thresholds */
  function mgGauge(title, cur, prev, good, th, foot) {
    var v = cur == null ? 0 : Math.max(0, Math.min(100, cur)), cls = cur == null ? '' : (good === 'down' ? (cur <= th[0] ? 'ok' : (cur <= th[1] ? 'warn' : 'bad')) : (cur >= th[1] ? 'ok' : (cur >= th[0] ? 'warn' : 'bad')));
    var R = 78, cx = 100, cy = 92, pt = function (p) { var a = Math.PI * (1 - p / 100); return (cx + R * Math.cos(a)).toFixed(2) + ',' + (cy - R * Math.sin(a)).toFixed(2); };
    var arc = function (a, b) { return 'M' + pt(a) + ' A' + R + ',' + R + ' 0 0 1 ' + pt(b); };
    var s = '<svg class="mg-gv" viewBox="0 0 200 118" role="img" aria-label="' + esc(title) + '"><path d="' + arc(0, 100) + '" class="mg-gt"/>' + (v > 0 ? '<path d="' + arc(0, Math.max(v, 0.5)) + '" class="mg-ga ' + cls + '"/>' : '') +
      '<text x="100" y="86" text-anchor="middle" class="mg-gn">' + (cur == null ? '–' : cur + '%') + '</text><text x="22" y="115" class="mg-ax" text-anchor="middle">0%</text><text x="178" y="115" class="mg-ax" text-anchor="middle">100%</text></svg>';
    return '<div class="mg-g"><div class="mg-gh">' + esc(title) + '</div>' + s + '<div class="mg-gc">Previous ' + mgP(prev) + ' · ' + (cur == null ? '' : mgD(mgPts(cur, prev), good, true)) + '</div><div class="mg-gf">' + esc(foot) + '</div></div>';
  }
  function mgCsv() {
    var r = S.mgr; if (!r) return;
    var rows = [['Factory Production Status Report'], ['Date range', mgRange(r)], ['Unit', r.unit ? 'Unit - ' + r.unit.name : 'All Units'], ['Season', r.season ? r.season.name : 'All Open Seasons'], ['Compared with', mgPrev(r)], [],
      ['Stage output', 'Qty', 'Previous', 'Change qty', 'Change %', 'Avg per day']];
    r.kpi.forEach(function (k) { rows.push([k.l, k.Qty, k.Prev, k.Diff, k.Chg == null ? '' : k.Chg, k.PerDay]); });
    var SK6 = ['FABRIC', 'CUTTING', 'SEWING', 'JOBWORK', 'IRONING', 'PACKING'];
    var stHead = []; SK6.forEach(function (k) { stHead.push(MG_SK[k] + ' qty', MG_SK[k] + ' % of planned'); if (k !== 'FABRIC') stHead.push(MG_SK[k] + ' % of issued'); });
    var stVals = function (list) { var by = {}, o = []; list.forEach(function (x) { by[x.k] = x; }); SK6.forEach(function (k) { var x = by[k]; o.push(x ? x.Done : '', x && x.Pct != null ? x.Pct : ''); if (k !== 'FABRIC') o.push(x && x.PctIssued != null ? x.PctIssued : ''); }); return o; };
    rows.push([], ['Season production status', 'Plans', 'Planned qty'].concat(stHead).concat(['Sewing cutoff', 'Days left', 'Working days left', 'Need per day', 'Pace per day', 'Status']));
    r.seasons.forEach(function (s) { rows.push([s.Season, s.Plans, s.Qty].concat(stVals(s.Stages)).concat([dfmt(s.Cutoff), s.DaysLeft, s.WorkDaysLeft, s.NeedPerDay, s.PacePerDay, (MG_SS[s.Status] || [s.Status])[0]])); });
    rows.push([], ['Category wise status', 'Season', 'Type', 'Plans', 'Planned qty'].concat(stHead));
    (r.categories || []).forEach(function (c) { rows.push([c.Category, c.Season, c.Type, c.Plans, c.Qty].concat(stVals(c.Stages))); });
    rows.push([], [r.chart.title, 'Qty', 'Previous']); r.chart.bars.forEach(function (b) { rows.push([b.l, b.v, b.p]); });
    rows.push([], ['WIP by stage (today)', 'WIP pcs', 'Lots', 'Avg output / day', 'Days of WIP', 'Min days', 'Max days', 'Status']);
    r.funnel.forEach(function (f) { rows.push([f.l, f.Wip, f.Lots, f.AvgOut, f.Days == null ? '' : f.Days, f.Min || '', f.Max || '', (MG_ST[f.Status] || [f.Status])[0]]); });
    var g = r.gauge; rows.push([], ['Sewing manpower & capacity', 'Current %', 'Previous %'], ['Absent %', g.Absent.Cur, g.Absent.Prev], ['Machine utilization %', g.Machine.Cur, g.Machine.Prev], ['Capacity utilization %', g.Capacity.Cur, g.Capacity.Prev]);
    rows.push([], ['Unit-wise performance'].concat(r.stages.map(function (c) { return c.l; })).concat(['Total qty', 'Sewing present (avg/day)', 'Absent no (avg/day)', 'Absent %', 'Machine util %', 'Capacity util %', 'Prev total qty', 'Prev absent %', 'Prev machine util %', 'Prev capacity util %']));
    r.units.concat(r.units.length > 1 ? [r.total] : []).forEach(function (u) {
      rows.push([u.Unit].concat(r.stages.map(function (c) { return u.Stages[c.k].Qty; })).concat([u.Total, u.Cur.Present, u.Cur.Absent, u.Cur.AbsentPct, u.Cur.MachUtil, u.Cur.CapUtil, u.TotalPrev, u.Prev.AbsentPct, u.Prev.MachUtil, u.Prev.CapUtil]));
    });
    rows.push([], ['Key insights', 'Area', 'Level']); r.insights.forEach(function (x) { rows.push([x.Text, x.Area, x.Level]); });
    csvDownload('Factory_Production_Status_' + r.from + (r.from !== r.to ? '_to_' + r.to : '') + '.csv', rows);
  }
  /* PDF: the browser's print → "Save as PDF", laid out on two A4 portrait pages (each page is scaled down if it would overflow) */
  function mgPdf() {
    var r = S.mgr; if (!r) return;
    var b = document.body, p1 = $('.mg-p1'), p2 = $('.mg-p2'), title = document.title;
    b.classList.add('mg-print'); b.classList.remove('mg-flow');
    if (p1.scrollHeight > 1150) b.classList.add('mg-flow');   /* page 1 runs over: no forced page break before the manpower section */
    [p1, p2].forEach(function (p) {
      p.style.zoom = ''; var hgt = p.scrollHeight, max = 1000;   /* A4 printable height at the print width */
      if (hgt > max && hgt <= max * 1.15) p.style.zoom = String(Math.floor(max / hgt * 100) / 100);   /* a little over: shrink to one page; much more (several seasons): let it run onto more pages */
    });
    document.title = 'Factory Production Status ' + mgRange(r) + (r.unit ? ' - ' + r.unit.name : '');
    var done = function () { b.classList.remove('mg-print'); b.classList.remove('mg-flow'); p1.style.zoom = ''; p2.style.zoom = ''; document.title = title; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); setTimeout(function () { if (b.classList.contains('mg-print') && !window.matchMedia('print').matches) done(); }, 1500); }, 60);
  }

  /* ---------- User Access (Admin): role, departments, units and page-by-page view / edit ---------- */
  var LVN = { E: 'Edit', V: 'View', '': 'No access' };
  function acCanEdit(role, depts, m) {
    if (role === 'SUPER_ADMIN') return m.wroles.length > 0;
    if (role === 'PM' || m.wroles.indexOf(role) < 0) return false;
    if (role === 'DEPT_USER') return !m.wd || m.wd.some(function (d) { return depts.indexOf(d) >= 0; });
    return true;
  }
  function acDefault(role, depts, m) {
    if (role === 'SUPER_ADMIN') return acCanEdit(role, depts, m) ? 'E' : 'V';
    if (m.saOnly || m.roles.indexOf(role) < 0) return '';
    if (role === 'DEPT_USER' && !(m.depts ? m.depts.some(function (d) { return depts.indexOf(d) >= 0; }) : (m.always || depts.some(function (d) { return d !== 'HR'; })))) return '';
    return acCanEdit(role, depts, m) ? 'E' : 'V';
  }
  function acMax(role, depts, m) {
    if (role === 'SUPER_ADMIN') return acDefault(role, depts, m);
    if (m.saOnly) return '';
    if (m.admin) return acDefault(role, depts, m);
    return acCanEdit(role, depts, m) ? 'E' : 'V';
  }
  function acSummary(u) {
    if (u.Role === 'SUPER_ADMIN') return 'Every page';
    if (!u.Pages) return 'Default for role' + (u.Role === 'DEPT_USER' ? ' & department' : '');
    var e = 0, v = 0; Object.keys(u.Pages).forEach(function (k) { if (u.Pages[k] === 'E') e++; else if (u.Pages[k] === 'V') v++; });
    return 'Custom: ' + (e + v) + ' page(s) · ' + e + ' edit, ' + v + ' view';
  }
  function viewAccess(el) {
    el.innerHTML = '<div class="page-h"><h2>User Access</h2></div><div class="mhelp">Set each user\'s role, department(s), unit(s) and the pages they can open – <b>view only</b> or <b>edit</b>. Changes apply at once: the user is signed out and signs in again with the new access.</div><div id="ab"></div>';
    loadAccess();
  }
  function loadAccess() { return api('accessInfo').then(function (r) { S.ac = r; paintAccess(); }).catch(fail); }
  function paintAccess() {
    var r = S.ac, h = '';
    if (!r.setup.pageCol) h += '<div class="card" style="border-left:4px solid var(--warn);margin:0 0 12px"><b>One-time setup:</b> add a column named <b>Page_Access</b> to the <b>Users</b> sheet (row 1, any free column), then press Reload data. Until then you can change role, departments and units, but not page access.</div>';
    h += '<table><thead><tr><th>Code</th><th>Name</th><th>Role</th><th>Department(s)</th><th>Unit(s)</th><th>Page access</th><th>Status</th><th></th></tr></thead><tbody>' +
      r.users.map(function (u) {
        return '<tr><td data-l="Code"><b>' + esc(u.Employee_Code) + '</b></td><td data-l="Name">' + esc(u.Employee_Name) + '</td>' +
          '<td data-l="Role"><span class="badge">' + esc(ROLE[u.Role] || u.Role) + '</span></td>' +
          '<td data-l="Department(s)">' + esc(u.Role === 'DEPT_USER' ? deptNames(u.Depts) : '-') + '</td>' +
          '<td data-l="Unit(s)">' + esc(acUnits(u)) + '</td>' +
          '<td data-l="Page access">' + esc(acSummary(u)) + '</td>' +
          '<td data-l="Status"><span class="badge ' + (u.Active ? 'ok' : 'off') + '">' + (u.Active ? 'Active' : 'Inactive') + '</span></td>' +
          '<td class="acts-td"><div class="acts"><button class="btn sm" style="white-space:nowrap" data-ac="' + esc(u.User_ID) + '">Edit access</button></div></td></tr>';
      }).join('') + '</tbody></table>';
    $('#ab').innerHTML = h;
    $('#ab').onclick = function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-ac'); if (!id) return;
      var u = S.ac.users.filter(function (x) { return x.User_ID === id; })[0]; if (u) accessForm(u);
    };
  }
  function acUnits(u) {
    if (u.Role === 'SUPER_ADMIN' || u.Role === 'ADMIN' || u.Role === 'PROD_ADMIN') return 'All units';
    return String(u.Unit_ID || '').split(',').map(function (one) { one = one.trim(); var hit = S.ac.units.filter(function (x) { return x.Unit_ID === one; })[0]; return hit ? hit.Unit_Name : one; }).filter(Boolean).join(', ') || '-';
  }
  function accessForm(u) {
    var r = S.ac, st = { role: u.Role, depts: (u.Depts || []).slice(), custom: !!u.Pages, pages: Object.assign({}, u.Pages || {}) };
    var myU = String(u.Unit_ID || '').split(',').map(function (x) { return x.trim(); });
    openModal('<h3>Access – ' + esc(u.Employee_Name) + ' (' + esc(u.Employee_Code) + ')</h3><form id="acf">' +
      '<div class="mgf"><label>Role<select id="ac_r">' + r.roles.map(function (k) { return '<option value="' + k + '"' + (u.Role === k ? ' selected' : '') + '>' + esc(ROLE[k] || k) + '</option>'; }).join('') + '</select></label></div>' +
      '<div id="ac_dw"><label>Department(s)</label><div class="chkbox">' + r.depts.map(function (k) { return '<label class="chk"><input type="checkbox" class="ac_d" value="' + k + '"' + (st.depts.indexOf(k) >= 0 ? ' checked' : '') + '> ' + esc(DEPT[k] || k) + '</label>'; }).join('') + '</div><div class="hint">The departments this user records for (Edit is possible only on pages of these departments).</div></div>' +
      '<div id="ac_uw"><label>Unit(s)</label><div class="chkbox">' + r.units.map(function (x) { return '<label class="chk"><input type="checkbox" class="ac_u" value="' + esc(x.Unit_ID) + '"' + (myU.indexOf(x.Unit_ID) >= 0 ? ' checked' : '') + '> ' + esc(x.Unit_Name) + '</label>'; }).join('') + '</div></div>' +
      '<div id="ac_ua" class="hint" style="margin:8px 0">Admin and Production Admin see all units.</div>' +
      '<label style="margin-top:12px">Pages</label><div id="ac_m" class="chkbox"><label class="chk"><input type="radio" name="ac_m" value="d"' + (st.custom ? '' : ' checked') + '> Default for the role and department(s)</label>' +
      '<label class="chk"><input type="radio" name="ac_m" value="c"' + (st.custom ? ' checked' : '') + (r.setup.pageCol ? '' : ' disabled') + '> Choose pages</label></div>' +
      (r.setup.pageCol ? '' : '<div class="hint">Add the Page_Access column to the Users sheet to choose pages.</div>') +
      '<div id="ac_tools" class="rlinks" style="margin-top:8px"><button type="button" class="btn sm ghost" data-fill="def">Fill with defaults</button><button type="button" class="btn sm ghost" data-fill="view">All view</button><button type="button" class="btn sm ghost" data-fill="max">All allowed (edit where possible)</button><button type="button" class="btn sm ghost" data-fill="none">Clear all</button></div>' +
      '<div id="ac_g"></div>' +
      '<div class="row"><button type="button" class="btn ghost" id="ac_x">Cancel</button><button class="btn" type="submit">Save access</button></div></form>',
      function (mo) {
        mo.style.maxWidth = '720px';
        function depts() { return [].slice.call(document.querySelectorAll('.ac_d')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }); }
        function grid() {
          var role = st.role, ds = st.depts, h = '';
          $('#ac_dw').hidden = role !== 'DEPT_USER';
          $('#ac_uw').hidden = !(role === 'PM' || role === 'DEPT_USER');
          $('#ac_ua').hidden = !(role === 'SUPER_ADMIN' || role === 'ADMIN' || role === 'PROD_ADMIN');
          $('#ac_m').hidden = role === 'SUPER_ADMIN';
          var custom = st.custom && role !== 'SUPER_ADMIN';
          $('#ac_tools').hidden = !custom;
          if (role === 'SUPER_ADMIN') { $('#ac_g').innerHTML = '<div class="hint" style="margin:8px 0">A Super Admin can open and edit every page, including User Access.</div>'; return; }
          var groups = [], seen = {};
          r.pages.forEach(function (m) { if (!seen[m.group]) { seen[m.group] = 1; groups.push(m.group); } });
          h += '<table class="mgt acg nocsv"><thead><tr><th>Page</th><th>No access</th><th>View</th><th>Edit</th></tr></thead><tbody>';
          groups.forEach(function (g) {
            var list = r.pages.filter(function (m) { return m.group === g && !m.saOnly; });
            if (!list.length) return;
            h += '<tr><td colspan="4" style="background:#F7F9FC;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em">' + esc(g) + '</td></tr>';
            list.forEach(function (m) {
              var max = acMax(role, ds, m), def = acDefault(role, ds, m);
              if (m.always) { h += '<tr><td>' + esc(m.label) + '</td><td colspan="3" class="hint">Always available</td></tr>'; return; }
              var cur = custom ? (st.pages[m.key] || '') : def;
              if (cur === 'E' && max !== 'E') cur = max ? 'V' : '';
              if (cur && !max) cur = '';
              h += '<tr><td>' + esc(m.label) + (custom && def !== cur ? ' <span class="badge">changed</span>' : '') + '</td>' + ['', 'V', 'E'].map(function (lv) {
                var ok = custom && (lv === '' || (lv === 'V' && max) || (lv === 'E' && max === 'E'));
                return '<td data-l="' + ({ '': 'None', V: 'View', E: 'Edit' })[lv] + '"><label class="chk" title="' + (ok || !custom ? '' : 'Not possible for this role / department') + '"><input type="radio" name="pa_' + m.key + '" value="' + lv + '"' + (cur === lv ? ' checked' : '') + (ok ? '' : ' disabled') + '></label></td>';
              }).join('') + '</tr>';
            });
          });
          h += '</tbody></table>';
          if (!custom) h = '<div class="hint" style="margin:6px 0">These are the pages the role' + (role === 'DEPT_USER' ? ' and department(s)' : '') + ' give. Choose “Choose pages” to change them.</div>' + h;
          else h = '<div class="hint" style="margin:6px 0">Dashboard and Change password are always available. View lets the user open the page and export; Edit also lets them add, change and cancel entries.</div>' + h;
          $('#ac_g').innerHTML = h;
        }
        function readGrid() {
          if (!st.custom) return;
          r.pages.forEach(function (m) { var c = document.querySelector('input[name="pa_' + m.key + '"]:checked'); if (c) { if (c.value) st.pages[m.key] = c.value; else delete st.pages[m.key]; } });
        }
        function fill(kind) {
          st.pages = {};
          r.pages.forEach(function (m) {
            if (m.always || m.saOnly) return;
            var max = acMax(st.role, st.depts, m), v = kind === 'def' ? acDefault(st.role, st.depts, m) : kind === 'view' ? (max ? 'V' : '') : kind === 'max' ? max : '';
            if (v) st.pages[m.key] = v;
          });
          grid();
        }
        $('#ac_r').onchange = function () { readGrid(); st.role = $('#ac_r').value; grid(); };
        Array.prototype.forEach.call(document.querySelectorAll('.ac_d'), function (c) { c.onchange = function () { readGrid(); st.depts = depts(); grid(); }; });
        Array.prototype.forEach.call(document.querySelectorAll('input[name=ac_m]'), function (c) {
          c.onchange = function () {
            var was = st.custom; st.custom = $('input[name=ac_m]:checked').value === 'c';
            if (st.custom && !was && !Object.keys(st.pages).length) { fill('def'); return; }
            grid();
          };
        });
        $('#ac_tools').onclick = function (e) { var k = e.target.getAttribute && e.target.getAttribute('data-fill'); if (k) fill(k); };
        $('#ac_g').onchange = function () { readGrid(); grid(); };
        $('#ac_x').onclick = closeModal;
        grid();
        $('#acf').onsubmit = function (ev) {
          ev.preventDefault(); readGrid();
          var pages = null;
          if (st.custom && st.role !== 'SUPER_ADMIN') {
            pages = {};
            r.pages.forEach(function (m) { var v = st.pages[m.key]; var max = acMax(st.role, st.depts, m); if (!v || !max || m.always || m.saOnly) return; pages[m.key] = v === 'E' && max === 'E' ? 'E' : 'V'; });
          }
          var units = [].slice.call(document.querySelectorAll('.ac_u')).filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
          api('accessSave', { userId: u.User_ID, role: st.role, depts: st.role === 'DEPT_USER' ? st.depts : [], units: units, pages: pages }).then(function (res) {
            closeModal(); toast(res.changed ? 'Access saved – ' + u.Employee_Name + ' signs in again to use it' : 'No change', 'ok');
            if (u.User_ID === S.user.id && res.changed) { endSession('Your access changed. Please sign in again.'); return; }
            return loadAccess();
          }).catch(fail);
        };
      });
  }

  /* ---------- masters (generic, driven by server definitions) ---------- */
  function viewSettings(el) { viewMasters(el, true); }
  function viewMasters(el, settings) {
    S.mset = !!settings;
    el.innerHTML = '<div class="page-h"><h2>' + (settings ? 'Settings' : 'Masters') + '</h2></div><div class="tabs" id="mt"' + (settings ? ' hidden' : '') + '></div><div id="mh"></div><div id="mb"></div>';
    api(settings ? 'settingsDefs' : 'masterDefs').then(function (defs) {
      S.mdefs = defs;
      if (!S.mcur || !defs.some(function (d) { return d.name === S.mcur; })) S.mcur = defs[0].name;
      paintTabs(); loadMaster();
    }).catch(fail);
  }
  function mdef() { return S.mdefs.filter(function (d) { return d.name === S.mcur; })[0]; }
  function paintTabs() {
    $('#mt').innerHTML = S.mdefs.map(function (d) {
      return '<button class="tab' + (d.name === S.mcur ? ' on' : '') + '" data-m="' + esc(d.name) + '">' + esc(d.label) + '</button>';
    }).join('');
    $('#mt').onclick = function (e) {
      var m = e.target.getAttribute && e.target.getAttribute('data-m');
      if (m && m !== S.mcur) { S.mcur = m; paintTabs(); loadMaster(); }
    };
  }
  function loadMaster() {
    var name = S.mcur;
    $('#mb').innerHTML = ''; $('#mh').innerHTML = '';
    return api(S.mset ? 'settingsList' : 'masterList', { name: name }).then(function (r) {
      if (name !== S.mcur) return;
      S.mrows = r.rows; S.mrefs = r.refs; paintMaster();
    }).catch(fail);
  }
  function colLabel(d, c) {
    var f = d.fields.filter(function (x) { return x.n === c; })[0];
    return f ? f.l : c.replace(/_/g, ' ');
  }
  function refText(d, c, v) {
    if (!v) return '';
    var f = d.fields.filter(function (x) { return x.n === c && x.t === 'ref'; })[0];
    if (!f) return v;
    var hit = (S.mrefs[c] || []).filter(function (o) { return o.id.toLowerCase() === String(v).toLowerCase(); })[0];
    return hit && hit.label ? hit.label + ' (' + v + ')' : v;
  }
  function paintMaster() {
    var d = mdef(), write = S.user.role === 'ADMIN' && pageEdit(S.mset ? 'settings' : 'masters');
    var head = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">' + esc(d.help) + '</div>' +
      (write && !d.editOnly ? '<button class="btn" id="madd">+ Add</button>' : '') + '</div>';
    $('#mh').innerHTML = head;
    if (!S.mrows.length) {
      $('#mb').innerHTML = '<div class="card empty">Nothing here yet' + (write && !d.editOnly ? '. Click “+ Add”.' : '.') + '</div>';
    } else {
      $('#mb').innerHTML = '<table><thead><tr>' + d.cols.map(function (c) { return '<th>' + esc(colLabel(d, c)) + '</th>'; }).join('') +
        (write ? '<th></th>' : '') + '</tr></thead><tbody>' +
        S.mrows.map(function (r) {
          return '<tr>' + d.cols.map(function (c) {
            var v = r[c], cell;
            if (c === 'Active') cell = '<span class="badge ' + (v ? 'ok' : 'off') + '">' + (v ? 'Active' : 'Inactive') + '</span>';
            else if (c === 'Day_Type') cell = '<span class="badge ' + (v === 'WORKING' ? 'ok' : '') + '">' + esc(v) + '</span>';
            else cell = esc(dfmt(refText(d, c, v)) || (c === 'Unit_ID' && d.name === 'Calendar_Overrides' ? 'All units' : '-'));
            return '<td data-l="' + esc(colLabel(d, c)) + '">' + cell + '</td>';
          }).join('') + (write ? '<td class="acts-td"><div class="acts">' +
            (d.canDelete ? '' : '<button class="btn sm ghost" data-a="edit" data-id="' + esc(r._id) + '">Edit</button>') +
            (d.hasActive ? '<button class="btn sm ghost" data-a="tg" data-id="' + esc(r._id) + '">' + (r.Active ? 'Deactivate' : 'Activate') + '</button>' : '') +
            (d.canDelete ? '<button class="btn sm ghost" data-a="del" data-id="' + esc(r._id) + '">Delete</button>' : '') +
            '</div></td>' : '') + '</tr>';
        }).join('') + '</tbody></table>';
      $('#mb').onclick = function (e) {
        var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
        var id = e.target.getAttribute('data-id');
        var row = S.mrows.filter(function (x) { return x._id === id; })[0]; if (!row) return;
        if (a === 'edit') masterForm(d, row); else if (a === 'tg') masterToggle(d, row); else masterDelete(d, row);
      };
    }
    var add = $('#madd'); if (add) add.onclick = function () { masterForm(d, null); };
  }
  function masterForm(d, row) {
    var isNew = !row, html = '<h3>' + (isNew ? 'Add' : 'Edit') + ' – ' + esc(d.label) + '</h3><form id="mf">';
    d.fields.forEach(function (f) {
      var id = 'mf_' + f.n, val = row ? row[f.n] : '', locked = !isNew && f.key;
      if (f.readonly) { html += '<label>' + esc(f.l) + '</label><div class="ro">' + esc(val) + '</div>'; return; }
      html += '<label for="' + id + '">' + esc(f.l) + (f.req ? '' : ' (optional)') + '</label>';
      if (f.t === 'enum' || f.t === 'ref') {
        var opts = f.t === 'enum' ? f.opts.map(function (o) { return { id: o, label: o }; }) : (S.mrefs[f.n] || []).map(function (o) { return { id: o.id, label: (o.label || o.id) + (o.label ? ' (' + o.id + ')' : '') }; });
        html += '<select id="' + id + '"' + (locked ? ' disabled' : '') + '><option value="">' + (f.req ? 'Select…' : 'None / all') + '</option>' +
          opts.map(function (o) { return '<option value="' + esc(o.id) + '"' + (String(val).toLowerCase() === o.id.toLowerCase() ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
        if (f.t === 'ref' && !opts.length) html += '<div class="hint">Nothing to choose yet. Add it in its own list first.</div>';
      } else {
        var type = f.t === 'date' ? 'date' : (f.t === 'number' || f.t === 'int' ? 'number' : 'text');
        html += '<input id="' + id + '" type="' + type + '"' + (type === 'number' ? ' step="' + (f.t === 'int' ? '1' : 'any') + '" inputmode="decimal"' : '') +
          ' value="' + esc(val) + '"' + (locked ? ' disabled' : '') + (f.max && type === 'text' ? ' maxlength="' + f.max + '"' : '') + ' autocomplete="off">';
      }
      if (f.help && !locked) html += '<div class="hint">' + esc(f.help) + '</div>';
    });
    html += '<div class="row"><button type="button" class="btn ghost" id="mf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>';
    openModal(html, function () {
      $('#mf_x').onclick = closeModal;
      $('#mf').onsubmit = function (ev) {
        ev.preventDefault();
        var fields = {};
        d.fields.forEach(function (f) { var el = $('#mf_' + f.n); if (el && !f.readonly) fields[f.n] = el.value; });
        api(S.mset ? 'settingsSave' : 'masterSave', { name: d.name, id: row ? row._id : null, fields: fields })
          .then(function () { closeModal(); toast('Saved', 'ok'); return loadMaster(); }).catch(fail);
      };
    });
  }
  function masterToggle(d, row) {
    var next = !row.Active;
    confirmBox(next ? 'Activate?' : 'Deactivate?', next ? 'This entry will appear in lists again.' : 'This entry will be hidden from new selections. Existing records keep it.',
      next ? 'Activate' : 'Deactivate', !next).then(function (ok) {
      if (!ok) return;
      api('masterSetActive', { name: d.name, id: row._id, active: next })
        .then(function () { toast(next ? 'Activated' : 'Deactivated', 'ok'); return loadMaster(); }).catch(fail);
    });
  }
  function masterDelete(d, row) {
    confirmBox('Delete this entry?', 'This cannot be undone.', 'Delete', true).then(function (ok) {
      if (!ok) return;
      api('masterDelete', { name: d.name, id: row._id })
        .then(function () { toast('Deleted', 'ok'); return loadMaster(); }).catch(fail);
    });
  }

  /* ---------- planning (seasons & plans) ---------- */
  var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  /* display only: 2026-10-03 -> 03-Oct-2026 ; 2026-10-03 13:30 -> 03-Oct-2026 01:30 PM */
  function dfmt(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(s == null ? '' : s));
    if (!m) return s == null ? '' : String(s);
    var out = m[3] + '-' + MON[Number(m[2]) - 1] + '-' + m[1];
    if (m[4] !== undefined) { var h = Number(m[4]), ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; out += ' ' + (h < 10 ? '0' : '') + h + ':' + m[5] + ' ' + ap; }
    return out;
  }
  function fmtNum(n) { return Number(n || 0).toLocaleString('en-IN'); }
  function daysBadge(days, alert) {
    if (days == null) return '';
    if (days < 0) return '<span class="badge off">' + Math.abs(days) + ' day' + (days === -1 ? '' : 's') + ' overdue</span>';
    if (days === 0) return '<span class="badge warn">Due today</span>';
    return '<span class="badge ' + (days <= alert ? 'warn' : 'ok') + '">' + days + ' day' + (days === 1 ? '' : 's') + ' left</span>';
  }
  function srcName(x) { return x === 'JOB_WORKER' ? 'Job worker' : (x === 'WAREHOUSE' ? 'Warehouse (re-ironing)' : (x || '')); }
  function ltName(t, src) { if (t === 'JOB_WORK') return 'job work'; return t === 'IRON_ONLY' ? 'ironing only' + (src ? ' · ' + srcName(src) : '') : String(t || '').toLowerCase(); }
  function viewPlanning(el) {
    var canWrite = (S.user.role === 'ADMIN' || S.user.role === 'PROD_ADMIN') && pageEdit('planning');
    S.ptab = canWrite ? (S.ptab || 'plans') : 'plans';
    el.innerHTML = '<div class="page-h"><h2>Planning</h2></div>' +
      (canWrite ? '<div class="tabs" id="pt"><button class="tab" data-t="plans">Plans</button><button class="tab" data-t="grid">Plan grid</button><button class="tab" data-t="seasons">Seasons</button></div>' : '') +
      '<div id="ph"></div><div id="pb"></div>';
    if (canWrite) {
      $('#pt').onclick = function (e) {
        var t = e.target.getAttribute && e.target.getAttribute('data-t');
        if (t && t !== S.ptab) { S.ptab = t; loadPlanning(); }
      };
    }
    loadPlanning();
  }
  function loadPlanning() {
    var canWrite = (S.user.role === 'ADMIN' || S.user.role === 'PROD_ADMIN') && pageEdit('planning');
    if (canWrite) Array.prototype.forEach.call(document.querySelectorAll('#pt .tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-t') === S.ptab); });
    $('#ph').innerHTML = ''; $('#pb').innerHTML = '';
    var tab = S.ptab;
    if (tab === 'grid') return loadGrid();
    if (tab === 'seasons') {
      return api('seasonList').then(function (r) { if (S.ptab !== 'seasons') return; S.seasons = r; paintSeasons(); }).catch(fail);
    }
    return api('planList', { seasonId: S.pseason || '' }).then(function (r) {
      if (S.ptab !== 'plans') return;
      S.plans = r;
      if (!canWrite && !S.seasonNames) S.seasonNames = null;
      paintPlans();
    }).catch(fail);
  }
  function paintSeasons() {
    var r = S.seasons, rows = r.rows;
    $('#ph').innerHTML = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">A season groups plans. Completing a season closes its active plans and makes it read-only.</div><button class="btn" id="sadd">+ Add season</button></div>';
    $('#sadd').onclick = function () { seasonForm(null); };
    if (!rows.length) { $('#pb').innerHTML = '<div class="card empty">No seasons yet. Click “+ Add season”.</div>'; return; }
    var SC = [['Fabric_Cutoff_Date', 'Fabric'], ['Cutting_Cutoff_Date', 'Cutting'], ['Sewing_Cutoff_Date', 'Sewing'], ['Iron_Cutoff_Date', 'Ironing'], ['Pack_Cutoff_Date', 'Packing recv.']];
    $('#pb').innerHTML = '<table><thead><tr><th>Season</th><th>Status</th><th>Default cutoffs (set at creation)</th><th>Plans (active/total)</th><th>Total qty</th><th>Latest sewing cutoff</th><th></th></tr></thead><tbody>' +
      rows.map(function (s) {
        var open = s.Status === 'IN_PROGRESS';
        var cuts = SC.filter(function (c) { return s[c[0]]; }).map(function (c) { return '<div class="cellsub"><b>' + esc(c[1]) + '</b> ' + esc(dfmt(s[c[0]])) + '</div>'; }).join('');
        return '<tr><td data-l="Season"><b>' + esc(s.Season_Name) + '</b><div class="cellsub">' + esc(s.Season_ID) + (s.Created ? ' · created ' + esc(dfmt(s.Created)) : '') + '</div></td>' +
          '<td data-l="Status"><span class="badge ' + (open ? 'ok' : 'off') + '">' + (open ? 'In progress' : 'Completed') + '</span></td>' +
          '<td data-l="Default cutoffs">' + (cuts || '-') + '</td><td data-l="Plans">' + s.ActivePlans + ' / ' + s.Plans + '</td>' +
          '<td data-l="Total qty">' + fmtNum(s.Plan_Qty) + '</td>' +
          '<td data-l="Latest cutoff">' + (s.Cutoff ? esc(dfmt(s.Cutoff)) + ' ' + daysBadge(s.DaysLeft, r.alertDays) + (s.Changed ? '<div class="cellsub">changed on the plans</div>' : '') : '-') + '</td>' +
          '<td class="acts-td"><div class="acts">' +
          (open ? '<button class="btn sm ghost" data-a="edit" data-id="' + esc(s._id) + '">Edit</button><button class="btn sm ghost" data-a="done" data-id="' + esc(s._id) + '">Complete</button>'
                : (S.user.role === 'ADMIN' ? '<button class="btn sm ghost" data-a="reopen" data-id="' + esc(s._id) + '">Reopen</button>' : '')) +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
    $('#pb').onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var id = e.target.getAttribute('data-id');
      var s = rows.filter(function (x) { return x._id === id; })[0]; if (!s) return;
      if (a === 'edit') seasonForm(s);
      else if (a === 'done') {
        confirmBox('Complete season “' + s.Season_Name + '”?', s.ActivePlans + ' active plan(s) will be closed and the season becomes read-only. Only an Admin can reopen it.', 'Complete', true).then(function (ok) {
          if (!ok) return;
          api('seasonSetStatus', { id: id, status: 'COMPLETED' }).then(function (x) { toast('Season completed' + (x.closedPlans ? ' – ' + x.closedPlans + ' plan(s) closed' : ''), 'ok'); return loadPlanning(); }).catch(fail);
        });
      } else if (a === 'reopen') {
        confirmBox('Reopen season “' + s.Season_Name + '”?', 'The season becomes editable again. Closed plans stay closed until you reopen them.', 'Reopen').then(function (ok) {
          if (!ok) return;
          api('seasonSetStatus', { id: id, status: 'IN_PROGRESS' }).then(function () { toast('Season reopened', 'ok'); return loadPlanning(); }).catch(fail);
        });
      }
    };
  }
  function seasonForm(s) {
    var isNew = !s, cols = (S.seasons && S.seasons.cutCols) || [], lock = s && !s.canEditCuts;
    openModal('<h3>' + (isNew ? 'Add season' : 'Edit season') + '</h3><form id="sf">' +
      '<label for="sf_n">Season name</label><input id="sf_n" maxlength="60" autocomplete="off" value="' + esc(s ? s.Season_Name : '') + '">' +
      '<label style="margin-top:12px">Default cutoff dates</label><div class="mgf">' + cols.map(function (c) {
        return '<label>' + esc(c.l) + (c.k === 'Sewing_Cutoff_Date' ? ' (main)' : '') + '<input type="date" class="sf_cut" data-k="' + c.k + '" value="' + esc(s ? (s[c.k] || '') : '') + '"' + (lock || !c.ok ? ' disabled' : '') + '></label>';
      }).join('') + '</div>' +
      (cols.some(function (c) { return !c.ok; }) ? '<div class="hint">To use the greyed dates, add these columns to the Seasons sheet (row 1): ' + esc(cols.filter(function (c) { return !c.ok; }).map(function (c) { return c.k; }).join(', ')) + '.</div>' : '') +
      '<div class="hint">' + (lock ? 'This season already has plans, so its default cutoffs are fixed. Change the dates on the plans instead.' : 'Every new plan of this season starts with these dates; you can change them on a plan.') + '</div>' +
      '<div class="row"><button type="button" class="btn ghost" id="sf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>',
      function () {
        $('#sf_x').onclick = closeModal;
        $('#sf').onsubmit = function (ev) {
          ev.preventDefault();
          var f = { Season_Name: $('#sf_n').value };
          Array.prototype.forEach.call(document.querySelectorAll('.sf_cut'), function (i) { if (!i.disabled) f[i.getAttribute('data-k')] = i.value; });
          api('seasonSave', { id: s ? s._id : '', fields: f })
            .then(function () { closeModal(); toast('Saved', 'ok'); return loadPlanning(); }).catch(fail);
        };
      });
  }
  var PLAN_DISP = { ACTIVE: ['Active', 'ok'], FABRIC_DONE: ['Fabric issue completed', ''], COMPLETED: ['Completed', 'ok'], SEASON_DONE: ['Season completed', 'off'], CANCELLED: ['Cancelled', 'off'] };
  function paintPlans() {
    var r = S.plans, rows = r.rows, canWrite = !!r.refs;
    var seasonOpts = '';
    if (canWrite) {
      // filter list: all seasons seen in rows plus open ones
      var seen = {}, list = [];
      r.refs.Season_ID.concat(rows.map(function (x) { return { id: x.Season_ID, label: x.Season }; })).forEach(function (o) { if (!seen[o.id]) { seen[o.id] = 1; list.push(o); } });
      seasonOpts = '<select id="pf_s" style="max-width:220px"><option value="">All seasons</option>' + list.map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (S.pseason === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
    }
    $('#ph').innerHTML = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">Season plans by category and unit. The main cutoff is the <b>sewing</b> cutoff (alerts use the “CUTOFF_ALERT_DAYS” setting); fabric, cutting and ironing &amp; packing cutoffs are optional and used by the Forecast.</div>' + seasonOpts +
      (canWrite ? '<button class="btn" id="padd">+ Add plan</button>' : '') + '</div>';
    if (canWrite) {
      $('#pf_s').onchange = function () { S.pseason = this.value; loadPlanning(); };
      $('#padd').onclick = function () { planForm(null); };
    }
    if (!rows.length) { $('#pb').innerHTML = '<div class="card empty">No plans' + (canWrite ? ' yet. Click “+ Add plan”.' : ' for your unit yet.') + '</div>'; return; }
    var total = rows.reduce(function (a, x) { return a + (x.Status === 'ACTIVE' ? x.Plan_Qty : 0); }, 0);
    $('#pb').innerHTML = '<table><thead><tr><th>Plan</th><th>Season</th><th>Section</th><th>Category</th><th>Sub type</th><th>Unit</th><th>Qty (pcs)</th><th>Issued (order)</th><th>Cutoffs</th><th>Status</th>' + (canWrite ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (p) {
        var act = p.Status === 'ACTIVE';
        return '<tr data-unit="' + esc(p.Unit) + '"><td data-l="Plan" style="white-space:nowrap"><b>' + esc(p.Plan_ID) + '</b>' + (p.Remarks ? '<div class="cellsub">' + esc(p.Remarks) + '</div>' : '') + '</td>' +
          '<td data-l="Season">' + esc(p.Season) + '</td><td data-l="Section">' + esc(p.Section) + '</td><td data-l="Category">' + esc(p.Category) + '</td><td data-l="Sub type">' + esc(p.Sub_Type || '') + '</td><td data-l="Unit">' + esc(p.Unit) + '</td>' +
          '<td data-l="Qty (pcs)">' + fmtNum(p.Plan_Qty) + '</td><td data-l="Issued">' + fmtNum(p.Issued) + '</td>' +
          '<td data-l="Cutoffs">' + (p.Plan_Type === 'IRON_ONLY' ? '<span class="badge">Ironing only</span> ' + esc(dfmt(p.IronPack_Cutoff_Date)) + ' ' + daysBadge(p.DaysLeft, r.alertDays) + '<div class="cellsub">iron &amp; pack cutoff</div></td>' : esc(dfmt(p.Cutoff_Date)) + ' ' + daysBadge(p.DaysLeft, r.alertDays) + '<div class="cellsub">' + (p.Plan_Type === 'JOB_WORK' ? '<span class="badge">Job work</span> FG inward' : 'sewing') + [['Fabric', p.Fabric_Cutoff_Date], ['Cutting', p.Cutting_Cutoff_Date], ['Ironing', p.Iron_Cutoff_Date], ['Packing recv.', p.IronPack_Cutoff_Date]].filter(function (c) { return c[1]; }).map(function (c) { return ' · ' + c[0] + ' ' + esc(dfmt(c[1])); }).join('') + '</div></td>') +
          '<td data-l="Status"><span class="badge ' + (PLAN_DISP[p.Display] || ['', ''])[1] + '">' + esc((PLAN_DISP[p.Display] || [p.Status])[0]) + '</span>' + (p.Lots ? '<div class="cellsub">' + p.LotsPacked + ' of ' + p.Lots + ' lot(s) packed</div>' : '') + (p.Fit_Status === 'OVER' ? ' <span class="badge warn" title="' + esc(p.Fit_Reason) + '">Over capacity</span><div class="cellsub" style="white-space:normal">' + esc(p.Fit_Reason) + '</div>' : '') + (p.Order_ID ? '<div class="cellsub">' + esc(p.Order_ID) + '</div>' : '') + '</td>' +
          (canWrite ? '<td class="acts-td"><div class="acts">' +
            (p.canEdit ? '<button class="btn sm ghost" data-a="edit" data-id="' + esc(p._id) + '">Edit</button>' : '') +
            (p.SeasonOpen && p.Status !== 'CANCELLED' ? '<button class="btn sm ghost" data-a="tg" data-id="' + esc(p._id) + '"' + (act ? ' title="Mark fabric issue as complete for this plan"' : '') + '>' + (act ? 'Issue complete' : 'Reopen') + '</button>' : '') +
            (p.canCancel ? '<button class="btn sm ghost" data-a="cx" data-id="' + esc(p._id) + '">Cancel</button>' : '') +
            '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table><div class="hint" style="margin-top:8px">Active plan quantity shown: <b>' + fmtNum(total) + '</b> pcs</div>';
    $('#pb').onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var id = e.target.getAttribute('data-id');
      var p = rows.filter(function (x) { return x._id === id; })[0]; if (!p) return;
      if (a === 'edit') planForm(p);
      else if (a === 'cx') {
        confirmBox('Cancel plan ' + p.Plan_ID + '?', 'No fabric is issued against this plan. A cancelled plan is removed from the planned quantities and cannot be used again.', 'Cancel plan', true).then(function (ok) {
          if (!ok) return;
          api('planSetStatus', { id: id, status: 'CANCELLED' }).then(function () { toast('Plan cancelled', 'ok'); return loadPlanning(); }).catch(fail);
        });
      } else {
        var next = p.Status === 'ACTIVE' ? 'CLOSED' : 'ACTIVE';
        confirmBox(next === 'CLOSED' ? 'Fabric issue complete for plan ' + p.Plan_ID + '?' : 'Reopen plan ' + p.Plan_ID + '?',
          next === 'CLOSED' ? 'No more fabric can be issued against this plan. Its lots keep moving through production; the plan shows "Completed" when every lot reaches packing.' : 'The plan becomes active and editable again.',
          next === 'CLOSED' ? 'Fabric issue complete' : 'Reopen', false).then(function (ok) {
          if (!ok) return;
          api('planSetStatus', { id: id, status: next }).then(function () { toast(next === 'CLOSED' ? 'Fabric issue completed' : 'Plan reopened', 'ok'); return loadPlanning(); }).catch(fail);
        });
      }
    };
  }
  function fitHtml(r) {
    var cls = { FIT: 'ok', TIGHT: 'warn', OVER: 'off', NO_RATE: '' }[r.Verdict] || '';
    var lbl = { FIT: 'Fits', TIGHT: 'Tight', OVER: 'Does not fit', NO_RATE: 'Cannot check', NA: 'Not checked' }[r.Verdict] || r.Verdict;
    var h = '<div class="card" style="padding:10px 12px;margin:10px 0"><div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>Capacity check · ' + esc(r.Unit) + '</b><span class="badge ' + cls + '">' + lbl + '</span></div>' +
      '<div class="cellsub" style="margin:4px 0 6px;white-space:normal">' + esc(r.Message) + '</div>';
    if (r.Rate > 0) {
      h += '<div class="kv"><span>Sewing output per day</span><b>' + fmtNum(r.Rate) + (r.Factor !== 1 ? ' eq. pcs' : ' pcs') + '</b></div>' +
        '<div class="cellsub">' + esc(r.Basis) + (r.MachineCap ? ' · machine capacity ' + fmtNum(r.MachineCap) + '/day' : '') + '</div>' +
        '<div class="kv"><span>Existing plans (earlier or same cutoff) still to sew</span><b>' + fmtNum(r.Ahead) + '</b></div>' +
        '<div class="kv"><span>Existing plans clear on</span><b>' + esc(dfmt(r.FreeFrom)) + '</b></div>' +
        '<div class="kv"><span>This plan' + (r.Factor !== 1 ? ' (× ' + r.Factor + ')' : '') + '</span><b>' + fmtNum(r.NewEq) + '</b></div>' +
        '<div class="kv"><span>Working days needed / available</span><b>' + r.Needed + ' / ' + r.Available + '</b></div>' +
        '<div class="kv"><span>Earliest finish</span><b>' + (r.Finish ? esc(dfmt(r.Finish)) : 'beyond 4 years') + '</b></div>';
      if (r.Verdict === 'OVER') h += '<div class="kv"><span>Largest qty that fits by ' + esc(dfmt(r.Cutoff)) + '</span><b>' + fmtNum(r.MaxQty) + ' pcs</b></div>';
    }
    if (r.Queue.length) h += '<div class="cellsub" style="margin-top:6px;white-space:normal">Ahead of it: ' + r.Queue.map(function (q) { return esc(q.Plan_ID) + ' (' + esc(q.Category) + ', cutoff ' + esc(dfmt(q.Cutoff)) + ', ' + fmtNum(q.Remaining) + ' left)'; }).join('; ') + '</div>';
    if (r.Later.length) h += '<div class="cellsub" style="margin-top:6px;color:var(--bad);white-space:normal">Would push past their cutoff: ' + r.Later.map(function (q) { return esc(q.Plan_ID) + ' (' + esc(q.Category) + ', cutoff ' + esc(dfmt(q.Cutoff)) + ')'; }).join('; ') + '</div>';
    return h + '</div>';
  }
  function planForm(p, pre) {
    var refs = S.plans.refs, isNew = !p, orders = S.plans.orders || [];
    pre = pre || {};
    function sel(id, list, cur, ph, locked) {
      var has = list.some(function (o) { return o.id === cur; });
      var l = has || !cur ? list : list.concat([{ id: cur, label: cur + ' (inactive)' }]);
      return '<select id="' + id + '"' + (locked ? ' disabled' : '') + '><option value="">' + ph + '</option>' + l.map(function (o) {
        return '<option value="' + esc(o.id) + '"' + (cur === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>';
    }
    var curSeason = p ? p.Season_ID : (pre.seasonId || S.pseason || '');
    if (!p && !refs.Season_ID.length) { toast('Add a season first (Seasons tab).', 'bad'); return; }
    var seasonLabel = p ? p.Season : '';
    var curOrder = p ? p.Order_ID : (pre.orderId || '');
    var needReason = false, lastFit = null, timer = null, curIO = p ? p.Plan_Type === 'IRON_ONLY' : false;
    var seEdit = isNew || !!(p && p.canMoveSeason);   /* the season of a plan can be changed until fabric is issued */
    openModal('<h3>' + (isNew ? 'Add plan' : 'Edit plan ' + esc(p.Plan_ID)) + '</h3><form id="pf">' +
      '<label for="pf_se">Season</label>' + (seEdit ? sel('pf_se', refs.Season_ID, curSeason, 'Select…') + (isNew ? '' : '<div class="hint">The season can be changed until fabric is issued against this plan.</div>') : '<div class="ro">' + esc(seasonLabel) + '</div><div class="hint">Fabric is issued against this plan, so the season cannot change.</div>') +
      (isNew ? '<label for="pf_t">Plan type</label><select id="pf_t"><option value="">Normal (fabric to packing)</option><option value="IRON_ONLY">Ironing-only (job worker / warehouse re-ironing)</option></select><div class="hint" id="pf_th" hidden>Lots of this plan are added in <b>Ironing-only Lots</b> and only go through ironing, stickering and packing.</div>' : (curIO ? '<div class="hint"><span class="badge">Ironing only</span> The plan type cannot be changed.</div>' : '')) +
      '<div id="pf_g1"><label for="pf_o">Season order (optional)</label><select id="pf_o"></select></div>' +
      '<label for="pf_c">Category</label>' + sel('pf_c', refs.Category_ID, p ? p.Category_ID : (pre.categoryId || ''), 'Select…') +
      (S.plans.subTypeCol ? '<label for="pf_sub">Sub type (optional)</label><input id="pf_sub" maxlength="40" autocomplete="off" placeholder="e.g. Customer B" value="' + esc(p ? p.Sub_Type : '') + '"><div class="hint">Use it when the same category is planned twice in a unit, for example one plan for one customer and another plan for the rest.</div>' : '') +
      '<label for="pf_u">Unit</label>' + sel('pf_u', refs.Unit_ID, p ? p.Unit_ID : '', 'Select…') +
      '<label for="pf_q">Plan quantity (pcs)</label><input id="pf_q" type="number" min="1" step="1" inputmode="numeric" value="' + esc(p ? p.Plan_Qty : (pre.qty || '')) + '">' +
      '<div class="hint" id="pf_oh"></div>' +
      '<div id="pf_g2"><label for="pf_fc">Fabric cutoff date (optional)</label><input id="pf_fc" type="date" value="' + esc(p ? p.Fabric_Cutoff_Date : '') + '">' +
      '<div id="pf_cg"><label for="pf_cc">Cutting cutoff date (optional)</label><input id="pf_cc" type="date" value="' + esc(p ? p.Cutting_Cutoff_Date : '') + '"></div>' +
      '<label for="pf_d" id="pf_dl">Sewing cutoff date</label><input id="pf_d" type="date" value="' + esc(p ? p.Cutoff_Date : '') + '"></div>' +
      (S.plans.ironCol ? '<label for="pf_irc">Ironing out cutoff date (optional)</label><input id="pf_irc" type="date" value="' + esc(p ? p.Iron_Cutoff_Date : '') + '">' : '') +
      '<label for="pf_ic" id="pf_icl">Packing receive cutoff date (optional)</label><input id="pf_ic" type="date" value="' + esc(p ? p.IronPack_Cutoff_Date : '') + '">' +
      (isNew ? '<div class="hint">Blank dates take the season\'s default cutoffs.</div>' : '') +
      '<div id="pf_g3"><div id="pf_fit"><div class="hint">Select unit, category, quantity and sewing cutoff to check the capacity.</div></div></div>' +
      '<div id="pf_rw" hidden><label for="pf_rs">Reason for confirming a plan that does not fit</label><input id="pf_rs" maxlength="200" autocomplete="off" value="' + esc(p && p.Fit_Status === 'OVER' ? p.Fit_Reason : '') + '"></div>' +
      '<label for="pf_r">Remarks (optional)</label><input id="pf_r" maxlength="200" autocomplete="off" value="' + esc(p ? p.Remarks : '') + '">' +
      '<div class="row"><button type="button" class="btn ghost" id="pf_x">Cancel</button><button class="btn" type="submit">Confirm plan</button></div></form>',
      function () {
        function fillOrders() {
          var se = seEdit ? $('#pf_se').value : p.Season_ID, cat = $('#pf_c').value, cur = $('#pf_o').value || curOrder;
          var list = orders.filter(function (o) { return o.seasonId === se && (!cat || o.categoryId === cat); });
          $('#pf_o').innerHTML = '<option value="">No order (direct plan)</option>' + list.map(function (o) {
            return '<option value="' + esc(o.id) + '"' + (cur === o.id ? ' selected' : '') + '>' + esc(o.label + ' · planned ' + o.planned + ' · to plan ' + o.balance) + '</option>'; }).join('');
          showOrderHint();
        }
        function showOrderHint() {
          var o = orders.filter(function (x) { return x.id === $('#pf_o').value; })[0], q = Number($('#pf_q').value) || 0;
          if (!o) { $('#pf_oh').innerHTML = ''; return; }
          var bal = o.balance + (p && p.Order_ID === o.id ? p.Plan_Qty : 0), after = bal - q;
          $('#pf_oh').innerHTML = 'Order ' + fmtNum(o.qty) + ' pcs · still to plan ' + fmtNum(bal) + (q ? ' · after this plan ' + (after < 0 ? '<b style="color:var(--bad)">' + fmtNum(-after) + ' pcs over the order</b>' : fmtNum(after)) : '');
        }
        function isJW() { var u = refs.Unit_ID.filter(function (x) { return x.id === $('#pf_u').value; })[0]; return !!(u && u.jobWork); }
        function isIO() { return isNew ? $('#pf_t').value === 'IRON_ONLY' : curIO; }
        function applyType() {
          var io = isIO();
          $('#pf_g1').hidden = io; $('#pf_g2').hidden = io; $('#pf_g3').hidden = io; $('#pf_oh').hidden = io;
          if (io) { needReason = false; $('#pf_rw').hidden = true; }
          if (isNew) $('#pf_th').hidden = !io;
          $('#pf_icl').innerHTML = io ? 'Packing receive cutoff date' : 'Packing receive cutoff date (optional)';
          var jw = !io && isJW();
          $('#pf_dl').textContent = jw ? 'FG inward cutoff date (job work unit)' : 'Sewing cutoff date'; $('#pf_cg').hidden = jw;
          if (jw) { needReason = false; $('#pf_rw').hidden = true; }
        }
        function check() {
          if (isIO()) return;
          var c = $('#pf_c').value, u = $('#pf_u').value, q = $('#pf_q').value, d = $('#pf_d').value;
          if (!c || !u || !(Number(q) >= 1) || !d) { lastFit = null; needReason = false; $('#pf_rw').hidden = true; $('#pf_fit').innerHTML = '<div class="hint">Select unit, category, quantity and sewing cutoff to check the capacity.</div>'; return; }
          var mine = ++check.n;
          api('planFit', { unitId: u, categoryId: c, qty: Number(q), cutoff: d, planId: p ? p._id : '' }).then(function (r) {
            if (mine !== check.n || !$('#pf_fit')) return;
            lastFit = r; needReason = r.Verdict === 'OVER';
            $('#pf_fit').innerHTML = fitHtml(r); $('#pf_rw').hidden = !needReason;
          }).catch(function (e) { if (mine === check.n && $('#pf_fit')) $('#pf_fit').innerHTML = '<div class="hint">' + esc(e.message) + '</div>'; });
        }
        check.n = 0;
        function later() { clearTimeout(timer); timer = setTimeout(check, 400); }
        function defCut() {
          var o = orders.filter(function (x) { return x.id === $('#pf_o').value; })[0], se = seEdit ? $('#pf_se').value : p.Season_ID;
          var sc = refs.Season_ID.filter(function (x) { return x.id === se; })[0];
          var v = (o && o.cutoff) || (sc && sc.cutoff) || '';
          if (v && !$('#pf_d').value) $('#pf_d').value = v;
          /* other stage dates: the season defaults */
          if (sc && isNew) [['#pf_fc', 'Fabric_Cutoff_Date'], ['#pf_cc', 'Cutting_Cutoff_Date'], ['#pf_irc', 'Iron_Cutoff_Date'], ['#pf_ic', 'IronPack_Cutoff_Date']].forEach(function (x) { var el = $(x[0]); if (el && !el.value && sc[x[1]]) el.value = sc[x[1]]; });
        }
        fillOrders(); defCut(); applyType();
        if (isNew) $('#pf_t').onchange = function () { applyType(); if (!isIO()) later(); };
        if (pre.categoryId || p) later();
        $('#pf_x').onclick = closeModal;
        if (seEdit) $('#pf_se').onchange = function () { $('#pf_o').value = ''; curOrder = ''; fillOrders(); defCut(); later(); };
        $('#pf_c').onchange = function () { $('#pf_o').value = ''; curOrder = ''; fillOrders(); later(); };
        $('#pf_o').onchange = function () {
          var o = orders.filter(function (x) { return x.id === $('#pf_o').value; })[0];
          if (o) { $('#pf_c').value = o.categoryId; if (!$('#pf_q').value && o.balance > 0) $('#pf_q').value = o.balance; }
          showOrderHint(); defCut(); later();
        };
        $('#pf_u').onchange = function () { applyType(); later(); };
        $('#pf_q').oninput = function () { showOrderHint(); later(); };
        $('#pf_d').onchange = later;
        $('#pf').onsubmit = function (ev) {
          ev.preventDefault();
          var f = { Category_ID: $('#pf_c').value, Unit_ID: $('#pf_u').value, Plan_Qty: $('#pf_q').value, Cutoff_Date: $('#pf_d').value, Fabric_Cutoff_Date: $('#pf_fc').value, Cutting_Cutoff_Date: $('#pf_cc').value, IronPack_Cutoff_Date: $('#pf_ic').value, Iron_Cutoff_Date: $('#pf_irc') ? $('#pf_irc').value : '', Remarks: $('#pf_r').value, Order_ID: $('#pf_o').value };
          if ($('#pf_sub')) f.Sub_Type = $('#pf_sub').value;
          if (seEdit) f.Season_ID = $('#pf_se').value;
          if (isNew) f.Plan_Type = $('#pf_t').value;
          if (isIO()) { f.Cutoff_Date = ''; f.Fabric_Cutoff_Date = ''; f.Cutting_Cutoff_Date = ''; f.Order_ID = ''; }
          if (!isIO() && isJW()) f.Cutting_Cutoff_Date = '';
          function send() {
            api('planSave', { id: p ? p._id : '', fields: f, fitReason: $('#pf_rs').value })
              .then(function (r) { closeModal(); toast(r && r.Fit_Status === 'OVER' ? 'Plan confirmed with a reason (does not fit the capacity)' : 'Plan confirmed', r && r.Fit_Status === 'OVER' ? 'warn' : 'ok'); return loadPlanning(); })
              .catch(function (e) { if (e.code === 'FIT') { $('#pf_rw').hidden = false; $('#pf_rs').focus(); } fail(e); });
          }
          if (!isIO() && !isJW() && needReason && $('#pf_rs').value.trim().length < 5) { $('#pf_rw').hidden = false; $('#pf_rs').focus(); toast('This plan does not fit the capacity. Enter a reason (at least 5 characters) to confirm it.', 'bad'); return; }
          send();
        };
      });
  }


  /* ---------- plan grid (categories x units) ---------- */
  function loadGrid() {
    var se = S.gseason || '';
    return api('gridInfo', { seasonId: se }).then(function (r) {
      if (S.ptab !== 'grid') return;
      if (!se && r.seasons.length === 1) { S.gseason = r.seasons[0].id; return loadGrid(); }
      S.gi = r; paintGrid();
    }).catch(fail);
  }
  function paintGrid() {
    var r = S.gi, se = r.seasonId;
    var head = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">Plan a season in one view: <b>Plan Qty</b> is the order per category, the unit columns are the quantity given to each unit. Grey numbers are plans that already exist. Every plan needs a <b>sewing cutoff</b> (the category cutoff here, or the season default); all other cutoffs can be edited on each plan after it is created. Units are checked against their sewing output before you confirm.</div>' +
      '<select id="g_s" style="max-width:240px"><option value="">Select season…</option>' + r.seasons.map(function (o) { return '<option value="' + esc(o.id) + '"' + (se === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select></div>';
    $('#ph').innerHTML = head;
    $('#g_s').onchange = function () { S.gseason = this.value; loadGrid(); };
    if (!se) { $('#pb').innerHTML = '<div class="card empty">' + (r.seasons.length ? 'Select a season.' : 'Add a season first (Seasons tab).') + '</div>'; return; }
    if (!r.units.length || !r.categories.length) { $('#pb').innerHTML = '<div class="card empty">Add categories and units in Masters first.</div>'; return; }
    var h = '<div style="overflow-x:auto"><table class="gridt"><thead><tr><th>Category</th><th>Plan Qty</th><th>Sewing cutoff</th>' +
      r.units.map(function (u) { return '<th>' + esc(u.label) + (u.jobWork ? '<div class="cellsub">job work</div>' : '') + '</th>'; }).join('') + '<th>Total</th><th>Left</th></tr></thead><tbody>';
    r.categories.forEach(function (c) {
      var ck = c.id.toLowerCase();
      h += '<tr data-c="' + esc(c.id) + '"><td data-l="Category"><b>' + esc(c.label) + '</b>' + (c.factor !== 1 ? '<div class="cellsub">× ' + c.factor + '</div>' : '') + '</td>' +
        '<td><input class="g_pq" type="number" min="1" step="1" inputmode="numeric" data-c="' + esc(c.id) + '" value="' + (r.orders[ck] != null ? r.orders[ck] : '') + '" style="width:92px"></td>' +
        '<td><input class="g_cut" type="date" data-c="' + esc(c.id) + '" value="' + esc(r.cutoffs[ck] || '') + '" style="width:138px"></td>' +
        r.units.map(function (u) {
          var ex = r.existing[ck + '|' + u.id.toLowerCase()] || 0;
          return '<td class="gcell">' + (ex ? '<div class="gex">' + fmtNum(ex) + '</div>' : '') + '<input class="g_in" type="number" min="1" step="1" inputmode="numeric" data-c="' + esc(c.id) + '" data-u="' + esc(u.id) + '" data-ex="' + ex + '" placeholder="+" style="width:84px"></td>';
        }).join('') + '<td class="gtot" data-t="' + esc(c.id) + '"><b>0</b></td><td class="gleft" data-l2="' + esc(c.id) + '"></td></tr>';
    });
    h += '</tbody><tfoot><tr><td><b>Total</b></td><td class="gpq"></td><td></td>' + r.units.map(function (u) { return '<td class="gut" data-ut="' + esc(u.id) + '"><b>0</b></td>'; }).join('') + '<td class="ggt"><b>0</b></td><td></td></tr>' +
      '<tr><td><b>Capacity check</b></td><td></td><td></td>' + r.units.map(function (u) { return '<td class="gfit" data-uf="' + esc(u.id) + '"></td>'; }).join('') + '<td></td><td></td></tr></tfoot></table></div>' +
      '<div class="hint" style="margin-top:6px">Season default sewing cutoff: <b>' + (r.seasonCutoff ? esc(dfmt(r.seasonCutoff)) : 'not set') + '</b>. A blank category cutoff uses its order cutoff, then this default.</div>' +
      '<div id="g_msg"></div><div id="g_rw" hidden><label for="g_rs">Reason for confirming plans that do not fit the capacity</label><input id="g_rs" maxlength="200" autocomplete="off"></div>' +
      '<div class="row" style="margin-top:12px"><button class="btn ghost" type="button" id="g_clr">Clear entries</button><button class="btn" type="button" id="g_ok" disabled>Confirm plans</button></div>';
    $('#pb').innerHTML = h;
    var timer = null, seq = 0, last = null;
    function collect() {
      var cells = [], orders = {}, cutoffs = {};
      Array.prototype.forEach.call(document.querySelectorAll('.g_in'), function (i) { if (i.value !== '') cells.push({ categoryId: i.getAttribute('data-c'), unitId: i.getAttribute('data-u'), qty: i.value }); });
      Array.prototype.forEach.call(document.querySelectorAll('.g_pq'), function (i) { orders[i.getAttribute('data-c')] = i.value; });
      Array.prototype.forEach.call(document.querySelectorAll('.g_cut'), function (i) { if (i.value) cutoffs[i.getAttribute('data-c')] = i.value; });
      return { seasonId: se, cells: cells, orders: orders, cutoffs: cutoffs };
    }
    function totals() {
      var catT = {}, unitT = {}, grand = 0, any = false;
      r.categories.forEach(function (c) { catT[c.id] = 0; });
      r.units.forEach(function (u) { unitT[u.id] = 0; });
      Array.prototype.forEach.call(document.querySelectorAll('.g_in'), function (i) {
        var c = i.getAttribute('data-c'), u = i.getAttribute('data-u'), ex = Number(i.getAttribute('data-ex')) || 0, v = Number(i.value) || 0;
        if (v > 0) any = true;
        catT[c] += ex + v; unitT[u] += ex + v; grand += ex + v;
      });
      r.categories.forEach(function (c) {
        var cell = document.querySelector('[data-t="' + c.id + '"]'), pq = Number(document.querySelector('.g_pq[data-c="' + c.id + '"]').value) || 0, left = document.querySelector('[data-l2="' + c.id + '"]');
        cell.innerHTML = '<b>' + fmtNum(catT[c.id]) + '</b>';
        left.innerHTML = pq ? (pq - catT[c.id] < 0 ? '<b style="color:var(--bad)">' + fmtNum(catT[c.id] - pq) + ' over</b>' : fmtNum(pq - catT[c.id])) : '';
      });
      r.units.forEach(function (u) { document.querySelector('[data-ut="' + u.id + '"]').innerHTML = '<b>' + fmtNum(unitT[u.id]) + '</b>'; });
      document.querySelector('.ggt').innerHTML = '<b>' + fmtNum(grand) + '</b>';
      document.querySelector('.gpq').innerHTML = '<b>' + fmtNum(Array.prototype.reduce.call(document.querySelectorAll('.g_pq'), function (t, i) { return t + (Number(i.value) || 0); }, 0)) + '</b>';
      $('#g_ok').disabled = !any;
      return any;
    }
    function check() {
      var any = totals();
      Array.prototype.forEach.call(document.querySelectorAll('.gfit'), function (c) { c.innerHTML = ''; });
      $('#g_msg').innerHTML = ''; $('#g_rw').hidden = true; last = null;
      if (!any) return;
      var mine = ++seq;
      api('gridCheck', collect()).then(function (x) {
        if (mine !== seq || !$('#g_msg')) return;
        last = x;
        var msgs = [];
        Object.keys(x.units).forEach(function (uid) {
          var u = x.units[uid], cls = { FIT: 'ok', TIGHT: 'warn', OVER: 'off' }[u.Verdict] || '', lbl = { FIT: 'Fits', TIGHT: 'Tight', OVER: 'Over', NO_RATE: 'No data', NO_CUTOFF: 'No cutoff', NA: 'Job work' }[u.Verdict] || u.Verdict;
          var cell = document.querySelector('[data-uf="' + uid + '"]');
          if (cell) cell.innerHTML = '<span class="badge ' + cls + '">' + lbl + '</span><div class="cellsub">' + (u.Needed != null ? u.Needed + (u.Available != null ? ' / ' + u.Available : '') + ' days' : '') + '</div>';
          if (u.Verdict === 'NA') { msgs.push('<div class="kv" style="display:block;margin:3px 0"><b>' + esc(u.Unit) + '</b><div class="cellsub" style="white-space:normal">' + esc(u.Message) + '</div></div>'); return; }
          msgs.push('<div class="kv" style="display:block;margin:3px 0"><b>' + esc(u.Unit) + '</b> · ' + fmtNum(u.Rate) + ' eq. pcs/day (' + esc(u.Basis || 'no data') + ') · existing plans clear ' + esc(dfmt(u.FreeFrom)) + '<div class="cellsub" style="white-space:normal;' + (u.Verdict === 'OVER' ? 'color:var(--bad)' : '') + '">' + esc(u.Message) + '</div></div>');
        });
        var errs = x.orderErrors.map(function (e) { return '<div style="color:var(--bad);margin:3px 0">' + esc(e) + '</div>'; }).join('');
        $('#g_msg').innerHTML = '<div class="card" style="padding:10px 12px;margin:10px 0">' + errs + msgs.join('') + '</div>';
        $('#g_rw').hidden = !x.over.length;
      }).catch(function (e) { if (mine === seq && $('#g_msg')) $('#g_msg').innerHTML = '<div class="hint" style="color:var(--bad)">' + esc(e.message) + '</div>'; });
    }
    function later() { totals(); clearTimeout(timer); timer = setTimeout(check, 500); }
    Array.prototype.forEach.call(document.querySelectorAll('.g_in,.g_pq,.g_cut'), function (i) { i.oninput = later; i.onchange = later; });
    totals();
    $('#g_clr').onclick = function () { Array.prototype.forEach.call(document.querySelectorAll('.g_in'), function (i) { i.value = ''; }); later(); };
    $('#g_ok').onclick = function () {
      var p = collect();
      if (last && last.over.length && $('#g_rs').value.trim().length < 5) { $('#g_rw').hidden = false; $('#g_rs').focus(); toast('Some units do not fit their capacity. Enter a reason (at least 5 characters) to confirm.', 'bad'); return; }
      if (last && last.orderErrors.length) { toast(last.orderErrors[0], 'bad'); return; }
      p.fitReason = $('#g_rs').value;
      api('gridSave', p).then(function (x) {
        toast(x.count + ' plan(s) created' + (x.over.length ? ' – over capacity: ' + x.over.join(', ') : ''), x.over.length ? 'warn' : 'ok');
        return loadGrid();
      }).catch(function (e) { if (e.code === 'FIT') { $('#g_rw').hidden = false; $('#g_rs').focus(); } fail(e); });
    };
  }

  /* ---------- season orders ---------- */
  function viewOrders(el) {
    S.of = S.of || { seasonId: '' };
    el.innerHTML = '<div class="page-h"><h2>Season Orders</h2></div><div id="oh"></div><div id="ob"></div>';
    loadOrders();
  }
  function loadOrders() { return api('orderList', S.of).then(function (r) { S.or = r; paintOrders(); }).catch(fail); }
  function paintOrders() {
    var r = S.or, rows = r.rows;
    $('#oh').innerHTML = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">Enter the order quantity per category for each season, then use <b>Plan this</b> to split it into plans for units. Each plan is checked against the unit\'s capacity before it is confirmed. A plan can also be added directly in Planning without an order.</div>' +
      '<select id="of_s" style="max-width:220px"><option value="">All seasons</option>' + r.refs.Season_ID.map(function (o) { return '<option value="' + esc(o.id) + '"' + (S.of.seasonId === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>' +
      (pageEdit('orders') ? '<button class="btn" id="oadd">+ Add order</button>' : '') + '</div>';
    $('#of_s').onchange = function () { S.of.seasonId = this.value; loadOrders(); };
    if ($('#oadd')) $('#oadd').onclick = function () { orderForm(null); };
    if (!rows.length) { $('#ob').innerHTML = '<div class="card empty">No orders yet. Click “+ Add order”.</div>'; return; }
    $('#ob').innerHTML = '<table><thead><tr><th>Season</th><th>Category</th><th>Order qty</th><th>Sewing cutoff</th><th>Planned</th><th>Still to plan</th><th>Plans</th><th></th></tr></thead><tbody>' +
      rows.map(function (o) {
        var act = o.Status === 'ACTIVE', pct = o.Order_Qty ? Math.min(100, Math.round(o.Planned / o.Order_Qty * 100)) : 0;
        return '<tr' + (act ? '' : ' style="opacity:.55"') + '><td data-l="Season">' + esc(o.Season) + '</td><td data-l="Category"><b>' + esc(o.Category) + '</b>' + (o.Remarks ? '<div class="cellsub">' + esc(o.Remarks) + '</div>' : '') + (act ? '' : ' <span class="badge off">Cancelled</span>') + '</td>' +
          '<td data-l="Order qty">' + fmtNum(o.Order_Qty) + '</td><td data-l="Sewing cutoff">' + (o.Sewing_Cutoff_Date ? esc(dfmt(o.Sewing_Cutoff_Date)) : '-') + '</td><td data-l="Planned"><div class="ebar ' + (o.Balance < 0 ? 'bad' : '') + '"><i style="width:' + pct + '%"></i></div>' + fmtNum(o.Planned) + '</td>' +
          '<td data-l="Still to plan">' + (o.Balance < 0 ? '<b style="color:var(--bad)">' + fmtNum(-o.Balance) + ' over</b>' : '<b>' + fmtNum(o.Balance) + '</b>') + '</td>' +
          '<td data-l="Plans">' + (o.Plans.length ? esc(o.Plans.join(', ')) : '-') + '</td>' +
          '<td class="acts-td"><div class="acts">' +
          (o.canEdit ? '<button class="btn sm" data-a="plan" data-id="' + esc(o._id) + '">Plan this</button><button class="btn sm ghost" data-a="edit" data-id="' + esc(o._id) + '">Edit</button>' : '') +
          (o.canCancel ? '<button class="btn sm ghost" data-a="cancel" data-id="' + esc(o._id) + '">Cancel</button>' : '') + '</div></td></tr>';
      }).join('') + '</tbody></table>';
    $('#ob').onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var id = e.target.getAttribute('data-id'), o = rows.filter(function (x) { return x._id === id; })[0]; if (!o) return;
      if (a === 'edit') orderForm(o);
      else if (a === 'cancel') {
        confirmBox('Cancel order for ' + o.Category + '?', 'The order has no plans. It will be marked cancelled.', 'Cancel order', true).then(function (ok) {
          if (!ok) return;
          api('orderCancel', { id: id }).then(function () { toast('Order cancelled', 'ok'); return loadOrders(); }).catch(fail);
        });
      } else if (a === 'plan') {
        S.ptab = 'grid'; S.gseason = o.Season_ID; S.pseason = o.Season_ID; go('planning');
      }
    };
  }
  function orderForm(o) {
    var isNew = !o, refs = S.or.refs;
    function opts(list, cur) { return '<option value="">Select…</option>' + list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (cur === x.id ? ' selected' : '') + '>' + esc(x.label) + '</option>'; }).join(''); }
    openModal('<h3>' + (isNew ? 'Add order' : 'Edit order') + '</h3><form id="of">' +
      '<label for="of_se">Season</label>' + (isNew ? '<select id="of_se">' + opts(refs.Season_ID, S.of.seasonId) + '</select>' : '<div class="ro">' + esc(o.Season) + '</div>') +
      '<label for="of_c">Category</label>' + (isNew ? '<select id="of_c">' + opts(refs.Category_ID, '') + '</select>' : '<div class="ro">' + esc(o.Category) + '</div>') +
      '<label for="of_q">Order quantity (pcs)</label><input id="of_q" type="number" min="1" step="1" inputmode="numeric" value="' + esc(o ? o.Order_Qty : '') + '">' +
      (o && o.Planned ? '<div class="hint">Already planned: ' + fmtNum(o.Planned) + ' pcs (the order cannot go below this).</div>' : '') +
      '<label for="of_cd">Sewing cutoff date (optional, falls back to the season default)</label><input id="of_cd" type="date" value="' + esc(o ? o.Sewing_Cutoff_Date : '') + '">' +
      '<label for="of_r">Remarks (optional)</label><input id="of_r" maxlength="200" autocomplete="off" value="' + esc(o ? o.Remarks : '') + '">' +
      '<div class="row"><button type="button" class="btn ghost" id="of_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>',
      function () {
        $('#of_x').onclick = closeModal;
        $('#of').onsubmit = function (ev) {
          ev.preventDefault();
          var f = { Order_Qty: $('#of_q').value, Sewing_Cutoff_Date: $('#of_cd').value, Remarks: $('#of_r').value };
          if (isNew) { f.Season_ID = $('#of_se').value; f.Category_ID = $('#of_c').value; }
          api('orderSave', { id: o ? o._id : '', fields: f }).then(function () { closeModal(); toast('Saved', 'ok'); return loadOrders(); }).catch(fail);
        };
      });
  }

  /* ---------- job work: FG inward ---------- */
  function viewJwInward(el) {
    el.innerHTML = '<div class="page-h"><h2>Job Work Inward</h2></div><div id="jw_h"></div><div id="jw_b"></div>';
    loadJw();
  }
  function loadJw() { return api('jwList').then(function (r) { S.jw = r; paintJw(); }).catch(fail); }
  function paintJw() {
    var r = S.jw, h = '';
    $('#jw_h').innerHTML = '<div class="mhelp">Fabric is sent to the job worker from <b>Fabric Issue</b> (plan on a job work unit). Record the finished goods that come back here, lot by lot. Tick <b>last inward</b> to close a lot that will not come back in full – the pieces still pending are stored as short. Lots marked <i>in-house finish</i> can be ironed, stickered and packed in the factory as the pieces arrive.</div>';
    h += '<h3 class="sec">Pending at the job worker</h3>';
    h += r.lots.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category / Unit</th><th>Sent out</th><th>Inward</th><th>Pending</th><th>Cutoff</th><th>Finish</th>' + (r.canWrite ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.lots.map(function (x) {
        var pct = x.Sent ? Math.min(100, Math.round(x.Inward / x.Sent * 100)) : 0;
        return '<tr><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b></td><td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Season) + '</div></td>' +
          '<td data-l="Category / Unit">' + esc(x.Category) + '<div class="cellsub">' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Sent out">' + fmtNum(x.Sent) + '</td><td data-l="Inward"><div class="ebar"><i style="width:' + pct + '%"></i></div>' + fmtNum(x.Inward) + '</td><td data-l="Pending"><b>' + fmtNum(x.Pending) + '</b></td>' +
          '<td data-l="Cutoff">' + (x.Cutoff ? esc(dfmt(x.Cutoff)) : '-') + '</td><td data-l="Finish">' + (x.Inhouse ? '<span class="badge">In-house</span>' : '-') + '</td>' +
          (r.canWrite ? '<td class="acts-td"><div class="acts"><button class="btn sm" data-a="in" data-id="' + esc(x._id) + '">Record inward</button></div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table><div class="hint">Total pending: <b>' + fmtNum(r.totals.Pending) + '</b> of ' + fmtNum(r.totals.Sent) + ' pcs sent</div>' : '<div class="card empty">Nothing pending at a job worker.</div>';
    h += '<h3 class="sec">Inward entries</h3>';
    h += r.entries.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Qty</th><th>Closing</th><th>Status</th>' + (r.canWrite ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.entries.map(function (x) {
        var live = x.Status === 'ACTIVE';
        return '<tr' + (live ? '' : ' style="opacity:.55"') + '><td data-l="Entry">' + esc(x.Inward_ID) + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b></td><td data-l="Category">' + esc(x.Category) + '</td><td data-l="Unit">' + esc(x.Unit) + '</td>' +
          '<td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="Qty"><b>' + fmtNum(x.Qty) + '</b></td><td data-l="Closing">' + (x.Is_Final ? '<span class="badge ' + (x.Balance ? 'warn' : 'ok') + '">Last' + (x.Balance ? ' · short ' + fmtNum(x.Balance) : '') + '</span>' : '-') + '</td>' +
          '<td data-l="Status"><span class="badge ' + (live ? 'ok' : 'off') + '">' + (live ? 'Active' : 'Cancelled') + '</span></td>' +
          (r.canWrite ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? '<button class="btn sm ghost" data-a="cancel" data-id="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No inward entries yet.</div>';
    $('#jw_b').innerHTML = h;
    $('#jw_b').onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var id = e.target.getAttribute('data-id');
      if (a === 'in') { var l = r.lots.filter(function (z) { return z._id === id; })[0]; if (l) jwForm(l); }
      else confirmBox('Cancel inward entry ' + id + '?', 'The pieces go back to pending at the job worker.', 'Cancel entry', true).then(function (ok) {
        if (!ok) return;
        api('jwCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadJw(); }).catch(fail);
      });
    };
  }
  function jwForm(l) {
    var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    openModal('<h3>FG inward · lot ' + esc(l.Lot_No) + '</h3><form id="jwf">' +
      '<div class="hint">' + esc(l.Plan_ID + ' · ' + l.Category + ' · ' + l.Unit) + '<br>Sent out ' + fmtNum(l.Sent) + ' · inward so far ' + fmtNum(l.Inward) + ' · <b>pending ' + fmtNum(l.Pending) + '</b></div>' +
      '<label for="jwf_d">Inward date</label><input id="jwf_d" type="date" max="' + today + '" value="' + today + '">' +
      '<label for="jwf_q">Quantity received (pieces)</label><input id="jwf_q" type="number" min="0" step="1" inputmode="numeric" max="' + l.Pending + '">' +
      '<label class="chk"><input type="checkbox" id="jwf_f"> Last inward – close this lot (nothing more will come)</label>' +
      '<label for="jwf_r">Remarks (optional)</label><input id="jwf_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="jwf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>',
      function () {
        $('#jwf_x').onclick = closeModal;
        $('#jwf').onsubmit = function (ev) {
          ev.preventDefault();
          var f = { Lot_ID: l._id, Inward_Date: $('#jwf_d').value, Inward_Qty: $('#jwf_q').value, Is_Final: $('#jwf_f').checked, Remarks: $('#jwf_r').value };
          function send(ov) {
            api('jwSave', { fields: f, confirmOver: ov === true }).then(function (res) { closeModal(); toast(res.closed ? 'Saved – job work closed' + (res.Short ? ' (short ' + fmtNum(res.Short) + ')' : '') : 'Saved', 'ok'); return loadJw(); })
              .catch(function (e) {
                if (e.code === 'OVER') confirmBox('Close with pending pieces?', e.message, 'Close anyway', true).then(function (ok) { if (ok) send(true); });
                else fail(e);
              });
          }
          send(false);
        };
      });
  }

  /* ---------- ironing-only lots ---------- */
  function viewIronLots(el) {
    el.innerHTML = '<div class="page-h"><h2>Ironing-only Lots</h2></div><div id="il_h"></div><div id="il_b"></div>';
    loadIronLots();
  }
  function loadIronLots() { return api('ironLotList').then(function (r) { S.il = r; paintIronLots(); }).catch(fail); }
  function paintIronLots() {
    var r = S.il, q = (S.ilq || '').toLowerCase();
    $('#il_h').innerHTML = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">Lots that come back from a job worker or from the warehouse (re-ironing) and only go through <b>ironing, stickering and packing</b>. Create the plan first (Planning → Add plan → type <i>Ironing-only</i>), then add its lots here. The quantity is typed directly. A lot can be edited or cancelled until ironing starts on it.</div>' +
      '<input id="il_q" placeholder="Search lot, plan…" style="max-width:200px" value="' + esc(S.ilq || '') + '">' + (pageEdit('ironlots') ? '<button class="btn" id="il_add">+ Add lot</button>' : '') + '</div>';
    if ($('#il_add')) $('#il_add').onclick = function () { ironLotForm(null); };
    $('#il_q').oninput = function () { S.ilq = this.value; paintIronLotRows(); };
    paintIronLotRows();
    var f = $('#il_q'); f.focus(); f.setSelectionRange(f.value.length, f.value.length);
  }
  function paintIronLotRows() {
    var r = S.il, q = (S.ilq || '').toLowerCase();
    var rows = r.rows.filter(function (x) { return !q || [x.Lot_No, x.Lot_ID, x.Plan_ID, x.Season, x.Category, x.Unit, x.Source].join(' ').toLowerCase().indexOf(q) >= 0; });
    var ph = r.plans.length ? '<div class="hint" style="margin-bottom:8px">Open ironing-only plans: ' + r.plans.map(function (p) { return '<b>' + esc(p.id) + '</b> (' + fmtNum(p.entered) + ' of ' + fmtNum(p.qty) + ' entered)'; }).join(' · ') + '</div>' : '<div class="hint" style="margin-bottom:8px">No open ironing-only plan. Add one in Planning first.</div>';
    if (!rows.length) { $('#il_b').innerHTML = ph + '<div class="card empty">' + (r.rows.length ? 'No match.' : 'No ironing-only lots yet. Click “+ Add lot”.') + '</div>'; return; }
    $('#il_b').innerHTML = ph + '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category / Unit</th><th>Source</th><th>Qty (pcs)</th><th>Received</th><th>Stage</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) {
        var live = x.Lot_Status === 'ACTIVE';
        return '<tr data-unit="' + esc(x.Unit) + '"' + (live ? '' : ' style="opacity:.6"') + '><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b><div class="cellsub">' + esc(x.Lot_ID) + (x.Lot_Remarks ? ' · ' + esc(x.Lot_Remarks) : '') + '</div></td>' +
          '<td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Season) + '</div></td>' +
          '<td data-l="Category / Unit">' + esc(x.Category) + '<div class="cellsub">' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Source">' + esc(x.Source) + '</td><td data-l="Qty (pcs)"><b>' + fmtNum(x.Lot_Qty) + '</b></td><td data-l="Received">' + esc(dfmt(x.Received_Date)) + '</td>' +
          '<td data-l="Stage"><span class="badge ' + (live ? (x.Locked ? '' : 'ok') : 'off') + '">' + (live ? (x.Locked ? 'In production' : 'Waiting for ironing') : 'Cancelled') + '</span></td>' +
          '<td class="acts-td"><div class="acts">' + (x.canEdit ? '<button class="btn sm ghost" data-a="edit" data-id="' + esc(x._id) + '">Edit</button>' : '') +
          (x.canCancel ? '<button class="btn sm ghost" data-a="cancel" data-id="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td></tr>';
      }).join('') + '</tbody></table>';
    $('#il_b').onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var id = e.target.getAttribute('data-id'), x = r.rows.filter(function (z) { return z._id === id; })[0]; if (!x) return;
      if (a === 'edit') ironLotForm(x);
      else confirmBox('Cancel lot ' + x.Lot_No + '?', fmtNum(x.Lot_Qty) + ' pcs will return to the plan balance. This cannot be undone.', 'Cancel lot', true).then(function (ok) {
        if (!ok) return;
        api('ironLotCancel', { id: id }).then(function () { toast('Lot cancelled', 'ok'); return loadIronLots(); }).catch(fail);
      });
    };
  }
  function ironLotForm(x) {
    var isNew = !x, plans = S.il.plans || [];
    if (isNew && !plans.length) { toast('No open ironing-only plan. Add one in Planning first.', 'bad'); return; }
    var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    openModal('<h3>' + (isNew ? 'Add ironing-only lot' : 'Edit lot ' + esc(x.Lot_No)) + '</h3><form id="ilf">' +
      (isNew ? '<label for="ilf_p">Plan</label><select id="ilf_p"><option value="">Select…</option>' + plans.map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.label + ' · to enter ' + fmtNum(p.balance)) + '</option>'; }).join('') + '</select>'
             : '<label>Plan</label><div class="ro">' + esc(x.Plan_ID + ' · ' + x.Season + ' · ' + x.Category) + '</div>') +
      '<label for="ilf_n">ERP lot number</label><input id="ilf_n" maxlength="30" autocomplete="off" value="' + esc(x ? x.Lot_No : '') + '">' +
      '<label for="ilf_s">Source</label><select id="ilf_s"><option value="">Select…</option>' + S.il.sources.map(function (o) { return '<option value="' + esc(o.id) + '"' + (x && x.Lot_Source === o.id ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') + '</select>' +
      '<label for="ilf_d">Received date</label><input id="ilf_d" type="date" max="' + today + '" value="' + esc(x ? x.Received_Date : today) + '">' +
      '<label for="ilf_q">Lot quantity (pcs)</label><input id="ilf_q" type="number" min="1" step="1" inputmode="numeric" value="' + esc(x ? x.Lot_Qty : '') + '">' +
      '<label for="ilf_r">Remarks (optional)</label><input id="ilf_r" maxlength="200" autocomplete="off" value="' + esc(x ? x.Lot_Remarks : '') + '">' +
      '<div class="row"><button type="button" class="btn ghost" id="ilf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>',
      function () {
        $('#ilf_x').onclick = closeModal;
        $('#ilf').onsubmit = function (ev) {
          ev.preventDefault();
          var f = { Lot_No: $('#ilf_n').value, Lot_Source: $('#ilf_s').value, Received_Date: $('#ilf_d').value, Lot_Qty: $('#ilf_q').value, Lot_Remarks: $('#ilf_r').value };
          if (isNew) f.Plan_ID = $('#ilf_p').value;
          function send(confirmOver) {
            api('ironLotSave', { id: x ? x._id : '', fields: f, confirmOver: confirmOver === true })
              .then(function () { closeModal(); toast('Saved', 'ok'); return loadIronLots(); })
              .catch(function (e) {
                if (e.code === 'OVER') confirmBox('Over the plan quantity', e.message, 'Save anyway', true).then(function (ok) { if (ok) send(true); });
                else fail(e);
              });
          }
          send(false);
        };
      });
  }

  /* ---------- fabric issue & lots ---------- */
  function viewFabric(el) {
    el.innerHTML = '<div class="page-h"><h2>Fabric Issue</h2></div><div id="fh"></div><div id="fb"></div>';
    loadFabric();
  }
  function loadFabric() {
    return api('fabricList').then(function (r) { S.fab = r; paintFabric(); }).catch(fail);
  }
  function paintFabric() {
    var r = S.fab;
    $('#fh').innerHTML = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">Each issue creates one original lot. You can edit an issue (including its plan, if the wrong plan was picked) or cancel it until the lot is used in production. Click a column heading to sort.</div>' +
      (r.canWrite ? '<button class="btn" id="fadd">+ Issue fabric</button>' : '') + '</div>';
    if (r.canWrite) $('#fadd').onclick = function () { fabricForm(null); };
    paintFabricRows();
  }
  function paintFabricRows() {
    var r = S.fab, rows = r.rows;
    if (!rows.length) { $('#fb').innerHTML = '<div class="card empty">No fabric issued yet' + (r.canWrite ? '. Click “+ Issue fabric”.' : '.') + '</div>'; return; }
    var anyAct = r.canWrite;
    $('#fb').innerHTML = '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category / Unit</th><th>Sub type</th><th>Fabric</th><th>Qty (pcs)</th><th>Date</th><th>Flags</th><th>Status</th>' + (anyAct ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (x) {
        var live = x.Status === 'ACTIVE';
        return '<tr data-unit="' + esc(x.Unit) + '"' + (live ? '' : ' style="opacity:.6"') + '><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b><div class="cellsub">' + esc(x.Lot_ID) + ' · ' + esc(x.Fabric_Issue_ID) + '</div></td>' +
          '<td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Season) + '</div></td>' +
          '<td data-l="Category / Unit">' + esc(x.Category) + '<div class="cellsub">' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Sub type">' + (x.Sub_Type ? esc(x.Sub_Type) : '-') + '</td>' +
          '<td data-l="Fabric">' + esc(x.Fabric_Type) + (x.Fabric_Width ? '<div class="cellsub">' + esc(x.Fabric_Width) + '</div>' : '') + '</td>' +
          '<td data-l="Qty (pcs)">' + fmtNum(x.Issue_Qty) + '<div class="cellsub">Order ' + fmtNum(x.Order_Qty) + (x.Extra_Qty ? ' · Extra ' + fmtNum(x.Extra_Qty) : '') + (x.Adj_Qty ? ' · <span style="color:var(--bad)">Adjusted −' + fmtNum(x.Adj_Qty) + '</span>' : '') + '</div></td><td data-l="Date">' + esc(dfmt(x.Issue_Date)) + '</td>' +
          '<td data-l="Flags">' + (x.JobWork ? '<span class="badge">Job work</span>' + (x.Inhouse_Finish ? ' <span class="badge">In-house finish</span>' : '') : (x.Washing_Required ? '<span class="badge">Wash</span>' : '-')) + '</td>' +
          '<td data-l="Status"><span class="badge ' + (live ? 'ok' : 'off') + '">' + (live ? (x.Locked ? 'In production' : 'Issued') : 'Cancelled') + '</span></td>' +
          (anyAct ? '<td class="acts-td"><div class="acts">' + (x.canEdit ? '<button class="btn sm ghost" data-a="edit" data-id="' + esc(x._id) + '">Edit</button>' : '') +
            (x.canCancel ? '<button class="btn sm ghost" data-a="cancel" data-id="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
    $('#fb').onclick = function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (!a) return;
      var id = e.target.getAttribute('data-id'), x = r.rows.filter(function (z) { return z._id === id; })[0]; if (!x) return;
      if (a === 'edit') fabricForm(x);
      else confirmBox('Cancel issue ' + x.Fabric_Issue_ID + '?', 'Lot ' + x.Lot_No + ' (' + fmtNum(x.Issue_Qty) + ' pcs) will be cancelled and ' + fmtNum(x.Order_Qty) + ' pcs return to the plan balance. This cannot be undone.', 'Cancel issue', true).then(function (ok) {
        if (!ok) return;
        api('fabricCancel', { id: id }).then(function () { toast('Issue cancelled', 'ok'); return loadFabric(); }).catch(fail);
      });
    };
  }
  function fabricForm(x) {
    var isNew = !x, plans = S.fab.plans || [];
    if (isNew && !plans.length) { toast('No active plan available. Create a plan first.', 'bad'); return; }
    var today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    /* on edit the plan can be changed (wrong plan picked) – only to a plan of the same kind (job work / normal) */
    var plist = isNew ? plans : plans.filter(function (p) { return !!p.jobWork === !!x.JobWork; });
    if (!isNew && !plist.some(function (p) { return p.id === x.Plan_ID; })) plist = [{ id: x.Plan_ID, label: x.Plan_ID + ' · ' + x.Season + ' · ' + x.Category + ' · ' + x.Unit, jobWork: x.JobWork }].concat(plist);
    var planHtml = '<label for="ff_p">Plan</label><select id="ff_p"><option value="">Select…</option>' + plist.map(function (p) {
      return '<option value="' + esc(p.id) + '"' + (!isNew && p.id === x.Plan_ID ? ' selected' : '') + '>' + esc(p.label) + '</option>'; }).join('') + '</select><div class="hint" id="ff_ph"></div>';
    openModal('<h3>' + (isNew ? 'Issue fabric' : 'Edit issue ' + esc(x.Fabric_Issue_ID)) + '</h3><form id="ff">' + planHtml +
      '<label for="ff_l">ERP lot number</label><input id="ff_l" maxlength="30" autocomplete="off" placeholder="Lot number from ERP" value="' + esc(x ? x.Lot_No : '') + '">' +
      '<label for="ff_d">Issue date</label><input id="ff_d" type="date" max="' + today + '" value="' + esc(x ? x.Issue_Date : today) + '">' +
      '<label for="ff_t">Fabric type</label>' + (function () {
        var L = ['Plain', 'Print', 'Check', 'Strips', 'Panel'], cur = x ? x.Fabric_Type : '';
        if (cur && L.indexOf(cur) < 0) L = L.concat([cur]);   /* an older entry keeps its own value */
        return '<select id="ff_t"><option value="">Select…</option>' + L.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      })() +
      '<label for="ff_w">Fabric width (optional)</label><input id="ff_w" maxlength="30" autocomplete="off" value="' + esc(x ? x.Fabric_Width : '') + '">' +
      '<label for="ff_q">Total quantity issued (pieces) – becomes the lot quantity</label><input id="ff_q" type="number" min="1" step="1" inputmode="numeric" value="' + esc(x ? x.Issue_Qty : '') + '">' +
      '<label for="ff_e">Extra quantity (optional)</label><input id="ff_e" type="number" min="0" step="1" inputmode="numeric" value="' + esc(x && x.Extra_Qty ? x.Extra_Qty : '') + '"><div class="hint" id="ff_oh"></div>' +
      '<label class="chk" id="ff_wrl"><input type="checkbox" id="ff_wr"' + (x && x.Washing_Required ? ' checked' : '') + '> Washing required</label>' +
      '<label class="chk" id="ff_ihl" hidden><input type="checkbox" id="ff_ih"' + (x ? (x.Inhouse_Finish ? ' checked' : '') : ' checked') + '> In-house ironing, stickering &amp; packing after FG inward</label>' +
      '<div class="hint" id="ff_jh" hidden>Job work plan: this is the fabric sent out to the job worker. The finished goods are recorded in <b>Job Work Inward</b>.</div>' +
      '<label for="ff_r">Remarks (optional)</label><input id="ff_r" maxlength="200" autocomplete="off" value="' + esc(x ? x.Remarks : '') + '">' +
      '<div class="row"><button type="button" class="btn ghost" id="ff_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>',
      function () {
        $('#ff_x').onclick = closeModal;
        var split = function () {
          var q = Number($('#ff_q').value) || 0, e = Number($('#ff_e').value) || 0;
          $('#ff_oh').textContent = q ? 'Against order: ' + fmtNum(Math.max(q - e, 0)) + ' pcs · Extra: ' + fmtNum(e) + ' pcs' : '';
        };
        $('#ff_q').oninput = split; $('#ff_e').oninput = split; split();
        function applyJw() {
          var pp = plist.filter(function (z) { return z.id === $('#ff_p').value; })[0], jw = isNew ? !!(pp && pp.jobWork) : !!x.JobWork;
          $('#ff_wrl').hidden = jw; $('#ff_ihl').hidden = !jw; $('#ff_jh').hidden = !jw;
        }
        applyJw();
        $('#ff_p').onchange = function () {
          applyJw();
          var p = plist.filter(function (z) { return z.id === $('#ff_p').value; })[0];
          $('#ff_ph').textContent = p && p.qty != null ? 'Plan ' + fmtNum(p.qty) + ' · issued ' + fmtNum(p.issued) + (p.balance < 0 ? ' · over by ' + fmtNum(-p.balance) : ' · balance ' + fmtNum(p.balance)) + ' pcs' + (!isNew && p.id !== x.Plan_ID ? ' · the lot moves to this plan' : '') : '';
        };
        searchSelect($('#ff_p'), 'Search plan, season, category or unit…');
        $('#ff').onsubmit = function (ev) {
          ev.preventDefault();
          if (!$('#ff_l').value.trim()) { $('#ff_l').focus(); return toast('ERP lot number is required', 'bad'); }
          var f = { Issue_Date: $('#ff_d').value, Fabric_Type: $('#ff_t').value, Fabric_Width: $('#ff_w').value, Issue_Qty: $('#ff_q').value, Extra_Qty: $('#ff_e').value,
            Lot_No: $('#ff_l').value, Washing_Required: $('#ff_wr').checked, Inhouse_Finish: $('#ff_ih').checked, Remarks: $('#ff_r').value };
          f.Plan_ID = $('#ff_p').value;
          var send = function (over) {
            return api('fabricSave', { id: x ? x._id : '', fields: f, confirmOver: over }).then(function (res) {
              closeModal(); toast(isNew ? 'Issued – lot ' + res.Lot_No + ' created' : 'Saved', 'ok'); return loadFabric();
            });
          };
          send(false).catch(function (e) {
            if (e.code !== 'OVER') return fail(e);
            confirmBox('Over plan quantity', e.message.replace(' Confirm to continue.', '') + ' Issue anyway?', 'Issue anyway', true)
              .then(function (ok) { if (ok) send(true).catch(fail); });
          });
        };
      });
  }
  var STAGE = { LAYERING: 'Layering', CUTTING: 'Cutting', SEWING: 'Sewing', JOBWORK: 'Job work', WASHING: 'Washing', IRONING: 'Ironing', STICKERING: 'Stickering', PACKING: 'Sent to Packing', PACKED: 'Packed' };
  // ---------------- Phase 7: Sewing ----------------
  function pctTxt(n) { return (n || 0) + '%'; }
  function lotHead(x) {
    return '<td data-l="Lot"><b>' + esc(x.Lot_No) + '</b>' + (x.Washing ? ' <span class="badge">Washing</span>' : '') + (x.JobWork ? ' <span class="badge" title="Job work lot, in-house finishing">Job work</span>' : (x.IronOnly ? ' <span class="badge" title="Ironing-only lot">' + esc(srcName(x.Source) || 'Ironing only') + '</span>' : '')) + '</td><td data-l="Plan">' + esc(x.Plan_ID) + '</td><td data-l="Category">' + esc(x.Category) + '</td><td data-l="Unit">' + esc(x.Unit) + '</td>';
  }
  function chain(x) {
    return '<div class="cellsub">Cut ' + fmtNum(x.Cut) + ' → Output ' + fmtNum(x.Out) + ' → QC pass ' + fmtNum(x.QcPass) + ' → Moved ' + fmtNum(x.Moved) + '</div>';
  }
  /* ---- hourly output ---- */
  function viewSewOut(el) {
    el.innerHTML = '<div class="page-h"><h2>Sewing – Hourly Output</h2></div><div id="vh"></div><div id="vb"></div>';
    loadSewOut();
  }
  function loadSewOut() { return api('sewOutList').then(function (r) { S.so = r; paintSewOut(); }).catch(fail); }
  function paintSewOut() {
    var r = S.so, w = r.canWrite, h = '', open = r.lots.filter(function (x) { return x.InLine > 0; });
    $('#vh').innerHTML = '<div class="mhelp">Pick a lot, then an hour slot, and enter the output count. Total output cannot exceed the cut quantity. An hour can be changed or removed only until the next hour is entered.</div>';
    h += '<h3 class="sec">Lots in sewing</h3>';
    h += open.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th><th>Cut qty</th><th>Output</th><th>In line</th><th>Days</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      open.map(function (x) {
        return '<tr>' + lotHead(x) + '<td data-l="Cut qty">' + fmtNum(x.Cut) + '</td><td data-l="Output"><b>' + fmtNum(x.Out) + '</b></td><td data-l="In line"><b>' + fmtNum(x.InLine) + '</b></td>' +
          '<td data-l="Days">' + (x.Days == null ? '-' : x.Days) + '</td>' +
          (w ? '<td class="acts-td"><div class="acts"><button class="btn sm" data-lot="' + esc(x.Lot_ID) + '"' + (x.InLine <= 0 ? ' disabled' : '') + '>Enter output</button></div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lot has pieces in line. A lot appears here after cutting is marked complete and until all its cut pieces have output.</div>';
    h += '<h3 class="sec">Recent hourly output</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Date</th><th>Hour</th><th>Lot</th><th>Category</th><th>Unit</th><th>Output</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="Hour">' + esc(x.HourLabel) + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Output"><b>' + fmtNum(x.Qty) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canEdit ? '<button class="btn sm ghost" data-ed="' + esc(x._id) + '">Edit</button><button class="btn sm ghost" data-xo="' + esc(x._id) + '">Remove</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No output entered yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-lot')) return outForm(t.getAttribute('data-lot'), null);
      if (t.getAttribute('data-ed')) { var row = r.rows.filter(function (z) { return z._id === t.getAttribute('data-ed'); })[0]; if (row) outForm(row.Lot_ID, row); return; }
      var id = t.getAttribute('data-xo');
      if (id) confirmBox('Remove this hour?', 'The output entry will be removed.', 'Remove', true).then(function (ok) {
        if (ok) api('sewOutCancel', { id: id }).then(function () { toast('Entry removed', 'ok'); return loadSewOut(); }).catch(fail);
      });
    };
  }
  function outForm(lotId, edit) {
    var lot = S.so.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    var slots = S.so.slots, day = edit ? edit.Date : todayStr();
    openModal('<h3>' + (edit ? 'Change output' : 'Hourly output') + ' – ' + esc(lot.Lot_No) + '</h3><div class="hint" id="oh_i"></div>' +
      '<form id="oh"><label for="oh_d">Date</label><input id="oh_d" type="date" max="' + todayStr() + '" value="' + esc(day) + '"' + (edit ? ' disabled' : '') + '>' +
      '<label for="oh_h">Hour slot</label><select id="oh_h"' + (edit ? ' disabled' : '') + '></select>' +
      '<label for="oh_q">Output (pieces)</label><input id="oh_q" type="number" min="1" step="1" inputmode="numeric" value="' + (edit ? edit.Qty : '') + '">' +
      '<div class="row"><button type="button" class="btn ghost" id="oh_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function used() { var d = $('#oh_d').value; return S.so.rows.filter(function (x) { return x.Lot_ID === lotId && x.Date === d; }); }
      function slotsFill() {
        if (edit) { $('#oh_h').innerHTML = '<option value="' + edit.Hour + '">' + esc(edit.HourLabel) + '</option>'; return; }
        var u = {}; used().forEach(function (x) { u[x.Hour] = 1; });
        var free = slots.filter(function (s) { return !u[s.h]; });
        $('#oh_h').innerHTML = free.length ? free.map(function (s) { return '<option value="' + s.h + '">' + esc(s.label) + '</option>'; }).join('') : '<option value="">No free slot on this date</option>';
      }
      function info() {
        var add = Number($('#oh_q').value) || 0, base = edit ? edit.Qty : 0, out = lot.Out + add - base;
        $('#oh_i').innerHTML = 'Cut ' + fmtNum(lot.Cut) + ' · output so far ' + fmtNum(lot.Out) + ' · after saving <b>' + fmtNum(out) + '</b> · in line <b>' + fmtNum(lot.Cut - out) + '</b>' + (out > lot.Cut ? ' <span style="color:var(--bad)">· over cut qty</span>' : '');
      }
      slotsFill(); info();
      $('#oh_d').onchange = slotsFill; $('#oh_q').oninput = info; $('#oh_x').onclick = closeModal;
      $('#oh').onsubmit = function (ev) {
        ev.preventDefault();
        if (!$('#oh_h').value) return toast('Select an hour slot', 'bad');
        api('sewOutSave', { lotId: lotId, date: $('#oh_d').value, hour: $('#oh_h').value, qty: $('#oh_q').value }).then(function () { closeModal(); toast('Output saved', 'ok'); return loadSewOut(); }).catch(fail);
      };
    });
  }
  /* ---- sewing QC ---- */
  function viewSewQc(el) {
    el.innerHTML = '<div class="page-h"><h2>Sewing QC</h2></div><div id="vh"></div><div id="vb"></div>';
    loadSewQc();
  }
  function loadSewQc() { return api('sewQcList').then(function (r) { S.sq = r; paintSewQc(); }).catch(fail); }
  function paintSewQc() {
    var r = S.sq, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">Enter QC results for a lot as many times as needed: pass, damage, cancel (fabric parts missing) and alteration pieces. Checked = pass + damage + cancel, and it cannot exceed the hourly output. Balance = hourly output − checked. Percentages are of the cut quantity.</div>';
    var open = r.lots.filter(function (x) { return x.ToQC > 0; }), done = r.lots.filter(function (x) { return x.ToQC <= 0 && x.Out > 0; });
    function qcRow(x, btn) {
      return '<tr>' + lotHead(x) + '<td data-l="Cut qty">' + fmtNum(x.Cut) + '</td><td data-l="Output">' + fmtNum(x.Out) + '</td><td data-l="Checked">' + fmtNum(x.QcTotal) + '</td><td data-l="Balance"><b>' + fmtNum(x.ToQC) + '</b></td>' +
        '<td data-l="Pass">' + fmtNum(x.QcPass) + '<div class="cellsub">' + pctTxt(x.PassPct) + '</div></td><td data-l="Damage">' + fmtNum(x.QcDamage) + '<div class="cellsub">' + pctTxt(x.DamagePct) + '</div></td>' +
        '<td data-l="Cancel">' + fmtNum(x.QcCancel) + '<div class="cellsub">' + pctTxt(x.CancelPct) + '</div></td><td data-l="Alteration">' + fmtNum(x.QcAlter) + '<div class="cellsub">' + pctTxt(x.AlterPct) + '</div></td>' +
        (w ? '<td class="acts-td"><div class="acts">' + (btn ? '<button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">Add QC</button>' : '') + '</div></td>' : '') + '</tr>';
    }
    var head = '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th><th>Cut qty</th><th>Output</th><th>Checked</th><th>Balance</th><th>Pass</th><th>Damage</th><th>Cancel</th><th>Alteration</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>';
    h += '<h3 class="sec">Lots in sewing – QC balance pending</h3>';
    h += open.length ? head + open.map(function (x) { return qcRow(x, true); }).join('') + '</tbody></table>' : '<div class="card empty">No lot has output waiting for QC.</div>';
    h += '<h3 class="sec">Lot summary – no balance</h3>';
    h += done.length ? head + done.map(function (x) { return qcRow(x, false); }).join('') + '</tbody></table>' : '<div class="card empty">No lot with output and no balance.</div>';
    h += '<h3 class="sec">QC entries</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Total</th><th>Pass</th><th>Damage</th><th>Cancel</th><th>Alteration</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x.QC_ID) + '</b>' + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td>' +
          '<td data-l="Total"><b>' + fmtNum(x.Pass + x.Damage + x.Cancel) + '</b></td><td data-l="Pass">' + fmtNum(x.Pass) + '</td><td data-l="Damage">' + fmtNum(x.Damage) + '</td><td data-l="Cancel">' + fmtNum(x.Cancel) + '</td><td data-l="Alteration">' + fmtNum(x.Alter) + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('SQC', x) + '<button class="btn sm ghost" data-xq="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No QC entered yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-lot')) return qcForm(t.getAttribute('data-lot'));
      var id = t.getAttribute('data-xq');
      if (id) confirmBox('Cancel ' + id + '?', 'This QC entry will be cancelled.', 'Cancel entry', true).then(function (ok) {
        if (ok) api('sewQcCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadSewQc(); }).catch(fail);
      });
    };
  }
  function qcForm(lotId) {
    var lot = S.sq.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    var wait = Math.max(0, lot.ToQC);
    openModal('<h3>Sewing QC – ' + esc(lot.Lot_No) + '</h3><div class="hint">Cut ' + fmtNum(lot.Cut) + ' · hourly output ' + fmtNum(lot.Out) + ' · checked ' + fmtNum(lot.QcTotal) + ' · balance <b>' + fmtNum(wait) + '</b></div>' +
      '<form id="qf"><label for="qf_d">Date</label><input id="qf_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="qf_p">Pass pieces</label><input id="qf_p" type="number" min="0" step="1" inputmode="numeric" value="' + wait + '">' +
      '<label for="qf_g">Damage pieces</label><input id="qf_g" type="number" min="0" step="1" inputmode="numeric" value="0">' +
      '<label for="qf_c">Cancel pieces (fabric parts missing)</label><input id="qf_c" type="number" min="0" step="1" inputmode="numeric" value="0">' +
      '<label for="qf_a">Alteration pieces</label><input id="qf_a" type="number" min="0" step="1" inputmode="numeric" value="0">' +
      '<div class="hint" id="qf_s" style="margin-top:8px"></div>' +
      '<label for="qf_r">Remarks (optional)</label><input id="qf_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="qf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function n(id) { return Number($(id).value) || 0; }
      function calc() {
        var pd = n('#qf_p') + n('#qf_g') + n('#qf_c');
        $('#qf_s').innerHTML = 'After saving: pass <b>' + fmtNum(lot.QcPass + n('#qf_p')) + '</b> (' + pctTxt(Math.round((lot.QcPass + n('#qf_p')) / lot.Cut * 1000) / 10) + ') · damage <b>' + fmtNum(lot.QcDamage + n('#qf_g')) + '</b> (' + pctTxt(Math.round((lot.QcDamage + n('#qf_g')) / lot.Cut * 1000) / 10) + ') · alteration <b>' +
          fmtNum(lot.QcAlter + n('#qf_a')) + '</b> (' + pctTxt(Math.round((lot.QcAlter + n('#qf_a')) / lot.Cut * 1000) / 10) + ')' +
          '<br>Total this entry <b>' + fmtNum(pd) + '</b> · balance after <b>' + fmtNum(wait - pd) + '</b>' + (pd > wait ? ' <span style="color:var(--bad)">· more than the output not yet checked</span>' : '');
      }
      calc(); $('#qf').oninput = calc; $('#qf_x').onclick = closeModal;
      $('#qf').onsubmit = function (ev) {
        ev.preventDefault();
        api('sewQcSave', { lotId: lotId, date: $('#qf_d').value, pass: $('#qf_p').value, damage: $('#qf_g').value, cancel: $('#qf_c').value, alteration: $('#qf_a').value, remarks: $('#qf_r').value })
          .then(function () { closeModal(); toast('QC saved', 'ok'); return loadSewQc(); }).catch(fail);
      };
    });
  }
  /* ---- sewing: move to next process ---- */
  function viewSewFinal(el) {
    el.innerHTML = '<div class="page-h"><h2>Sewing – Move to Next Process</h2></div><div id="vh"></div><div id="vb"></div>';
    loadSewFin();
  }
  function loadSewFin() { return api('sewFinList').then(function (r) { S.sf = r; paintSewFin(); }).catch(fail); }
  function paintSewFin() {
    var r = S.sf, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">Move QC-checked pieces to the next process – pass, damage and cancel are recorded separately, each limited to what QC checked (washing if the lot needs it, otherwise ironing) in as many entries as needed. Sewing closes by itself once cutting is closed and everything cut has been moved; pieces lost in sewing are entered as damage or cancel.</div>';
    h += '<h3 class="sec">Lots in sewing</h3>';
    h += r.lots.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th><th>Cut qty</th><th>Output</th><th>QC checked</th><th>Moved</th><th>Ready to move</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.lots.map(function (x) {
        return '<tr>' + lotHead(x) + '<td data-l="Cut qty">' + fmtNum(x.Cut) + '</td><td data-l="Output">' + fmtNum(x.Out) + '</td><td data-l="QC checked">' + fmtNum(x.QcTotal) + '<div class="cellsub">Pass ' + fmtNum(x.QcPass) + '</div></td><td data-l="Moved">' + fmtNum(x.Moved) + '</td><td data-l="Ready to move"><b>' + fmtNum(Math.max(0, x.ToMove)) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.ToMove > 0 ? '<button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">Move</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lot is in sewing.</div>';
    h += '<h3 class="sec">Moved to next process</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Pass</th><th>Damage</th><th>Cancel</th><th>Total</th><th>Next</th><th>Left behind</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x.Sewing_ID) + '</b>' + (x.Is_Final ? ' <span class="badge ok">Sewing closed</span>' : '') + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '<div class="cellsub">Cut ' + fmtNum(x.Cut) + '</div></td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td>' +
          '<td data-l="Pass">' + fmtNum(x.Pass) + '</td><td data-l="Damage">' + fmtNum(x.Damage) + '</td><td data-l="Cancel">' + fmtNum(x.Cancel) + '</td><td data-l="Total"><b>' + fmtNum(x.Qty) + '</b></td><td data-l="Next">' + (x.Washing ? 'Washing' : 'Ironing') + '</td><td data-l="Left behind">' + (x.Is_Final && x.Balance ? '<span class="badge warn">' + fmtNum(x.Balance) + '</span>' : '-') + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('SFIN', x) + '<button class="btn sm ghost" data-xf="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">Nothing moved yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-lot')) return finForm(t.getAttribute('data-lot'));
      var id = t.getAttribute('data-xf');
      if (id) confirmBox('Cancel ' + id + '?', 'This move entry will be cancelled (and sewing reopened if it had closed).', 'Cancel entry', true).then(function (ok) {
        if (ok) api('sewFinCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadSewFin(); }).catch(fail);
      });
    };
  }
  function finForm(lotId) {
    var lot = S.sf.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    var ready = Math.max(0, lot.ToMove);
    openModal('<h3>Move – ' + esc(lot.Lot_No) + '</h3><div class="hint">Cut ' + fmtNum(lot.Cut) + ' · output ' + fmtNum(lot.Out) + ' · QC checked ' + fmtNum(lot.QcTotal) + ' (pass ' + fmtNum(lot.QcPass) + ') · moved ' + fmtNum(lot.Moved) + ' · ready to move <b>' + fmtNum(ready) + '</b></div>' +
      '<form id="ff"><label for="ff_d">Date</label><input id="ff_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="ff_p">Pass pieces (ready ' + fmtNum(Math.max(0, lot.ToMovePass)) + ')</label><input id="ff_p" type="number" min="0" step="1" inputmode="numeric" value="' + Math.max(0, lot.ToMovePass) + '">' +
      '<label for="ff_g">Damage pieces (ready ' + fmtNum(Math.max(0, lot.ToMoveDamage)) + ')</label><input id="ff_g" type="number" min="0" step="1" inputmode="numeric" value="' + Math.max(0, lot.ToMoveDamage) + '">' +
      '<label for="ff_c">Cancel pieces (ready ' + fmtNum(Math.max(0, lot.ToMoveCancel)) + ')</label><input id="ff_c" type="number" min="0" step="1" inputmode="numeric" value="' + Math.max(0, lot.ToMoveCancel) + '">' +
      '<div class="hint" id="ff_s" style="margin-top:8px"></div>' +
      '<label for="ff_r">Remarks (optional)</label><input id="ff_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="ff_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function calc() { $('#ff_s').innerHTML = 'Total moving <b>' + fmtNum((Number($('#ff_p').value) || 0) + (Number($('#ff_g').value) || 0) + (Number($('#ff_c').value) || 0)) + '</b>'; }
      calc(); $('#ff').oninput = calc;
      $('#ff_x').onclick = closeModal;
      $('#ff').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { lotId: lotId, date: $('#ff_d').value, pass: $('#ff_p').value, damage: $('#ff_g').value, cancel: $('#ff_c').value, remarks: $('#ff_r').value };
        api('sewFinSave', pay).then(function (res) { closeModal(); toast(res.closed ? 'Moved – sewing closed' : 'Moved', 'ok'); return loadSewFin(); }).catch(fail);
      };
    });
  }
  /* ---- washing: send / receive ---- */
  function viewWashing(el) {
    el.innerHTML = '<div class="page-h"><h2>Washing – Send / Receive</h2></div><div id="vh"></div><div id="vb"></div>';
    loadWash();
  }
  function loadWash() { return api('washList').then(function (r) { S.wl = r; paintWash(); }).catch(fail); }
  function paintWash() {
    var r = S.wl, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">As soon as sewing moves pieces, send them to the washing unit in as many entries as needed (name of the outside unit, date, qty). Record each receive from washing; tick <b>last receive</b> when nothing more is coming back.</div>';
    h += '<h3 class="sec">Lots for washing</h3>';
    h += r.lots.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th><th>Sewing moved</th><th>Sent</th><th>To send</th><th>At washing unit</th><th>Received</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.lots.map(function (x) {
        return '<tr>' + lotHead(x) + '<td data-l="Sewing moved">' + fmtNum(x.SewMoved) + '</td><td data-l="Sent">' + fmtNum(x.Sent) + '</td><td data-l="To send"><b>' + fmtNum(Math.max(0, x.ToSend)) + '</b></td><td data-l="At washing unit"><b>' + fmtNum(Math.max(0, x.AtWash)) + '</b></td><td data-l="Received">' + fmtNum(x.Received) + (x.RecvClosed ? ' <span class="badge ok">Closed</span>' : '') + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (!x.RecvClosed && x.ToSend > 0 ? '<button class="btn sm" data-send="' + esc(x.Lot_ID) + '">Send</button>' : '') + (!x.RecvClosed && x.AtWash > 0 ? '<button class="btn sm" data-recv="' + esc(x.Lot_ID) + '">Receive</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lot is waiting for washing.</div>';
    h += '<h3 class="sec">Sent to washing</h3>';
    h += r.sends.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Washing unit</th><th>Qty</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.sends.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x._id) + '</b>' + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="Washing unit">' + esc(x.WashUnit) + '</td><td data-l="Qty"><b>' + fmtNum(x.Qty) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('WSEND', x) + '<button class="btn sm ghost" data-xs="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">Nothing sent yet.</div>';
    h += '<h3 class="sec">Received from washing</h3>';
    h += r.recvs.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Qty</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.recvs.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x._id) + '</b>' + (x.Is_Final ? ' <span class="badge ok">Last receive</span>' : '') + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="Qty"><b>' + fmtNum(x.Qty) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('WRECV', x) + '<button class="btn sm ghost" data-xr="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">Nothing received yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-send')) return sendForm(t.getAttribute('data-send'));
      if (t.getAttribute('data-recv')) return recvForm(t.getAttribute('data-recv'));
      var xs = t.getAttribute('data-xs'), xr = t.getAttribute('data-xr'), id = xs || xr;
      if (id) confirmBox('Cancel ' + id + '?', 'This entry will be cancelled.', 'Cancel entry', true).then(function (ok) {
        if (ok) api(xs ? 'washSendCancel' : 'washRecvCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadWash(); }).catch(fail);
      });
    };
  }
  function sendForm(lotId) {
    var lot = S.wl.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    openModal('<h3>Send to washing – ' + esc(lot.Lot_No) + '</h3><div class="hint">Moved from sewing ' + fmtNum(lot.SewMoved) + ' · already sent ' + fmtNum(lot.Sent) + ' · can send <b>' + fmtNum(Math.max(0, lot.ToSend)) + '</b></div>' +
      '<form id="sf"><label for="sf_d">Date</label><input id="sf_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="sf_u">Washing unit</label><input id="sf_u" maxlength="40" autocomplete="off">' +
      '<label for="sf_q">Qty sent</label><input id="sf_q" type="number" min="1" step="1" inputmode="numeric" value="' + Math.max(0, lot.ToSend) + '">' +
      '<label for="sf_r">Remarks (optional)</label><input id="sf_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="sf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      $('#sf_x').onclick = closeModal;
      $('#sf').onsubmit = function (ev) {
        ev.preventDefault();
        api('washSendSave', { lotId: lotId, date: $('#sf_d').value, washUnit: $('#sf_u').value, qty: $('#sf_q').value, remarks: $('#sf_r').value })
          .then(function () { closeModal(); toast('Sent', 'ok'); return loadWash(); }).catch(fail);
      };
    });
  }
  function recvForm(lotId) {
    var lot = S.wl.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    openModal('<h3>Receive from washing – ' + esc(lot.Lot_No) + '</h3><div class="hint">Sent ' + fmtNum(lot.Sent) + ' · received ' + fmtNum(lot.Received) + ' · at washing unit <b>' + fmtNum(Math.max(0, lot.AtWash)) + '</b></div>' +
      '<form id="rf"><label for="rf_d">Date</label><input id="rf_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="rf_q">Qty received</label><input id="rf_q" type="number" min="1" step="1" inputmode="numeric" value="' + Math.max(0, lot.AtWash) + '">' +
      '<label class="chk"><input type="checkbox" id="rf_f"> <span>Last receive – nothing more is coming back</span></label>' +
      '<label for="rf_r">Remarks (optional)</label><input id="rf_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="rf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      $('#rf_x').onclick = closeModal;
      $('#rf').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { lotId: lotId, date: $('#rf_d').value, qty: $('#rf_q').value, final: $('#rf_f').checked, remarks: $('#rf_r').value };
        var send = function (ov) { return api('washRecvSave', Object.assign({ confirmOver: ov }, pay)).then(function () { closeModal(); toast('Received', 'ok'); return loadWash(); }); };
        send(false).catch(function (e) {
          if (e.code !== 'OVER') return fail(e);
          confirmBox('Close receiving?', e.message.replace(' Confirm to continue.', '') + ' Close anyway?', 'Close receiving', true).then(function (ok) { if (ok) send(true).catch(fail); });
        });
      };
    });
  }
  /* ---- washing: move to ironing ---- */
  function viewWashMove(el) {
    el.innerHTML = '<div class="page-h"><h2>Washing – Move to Ironing</h2></div><div id="vh"></div><div id="vb"></div>';
    loadWashMv();
  }
  function loadWashMv() { return api('washMvList').then(function (r) { S.wm = r; paintWashMv(); }).catch(fail); }
  function paintWashMv() {
    var r = S.wm, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">Move pieces received from washing to ironing. Record pass, damage and cancel pieces separately – this is the washing quality result. Total moved cannot exceed the qty received, in as many entries as needed. Washing closes by itself once receiving is closed and everything received has been moved.</div>';
    h += '<h3 class="sec">Lots in washing</h3>';
    h += r.lots.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th><th>Received</th><th>Moved</th><th>Pass</th><th>Damage</th><th>Cancel</th><th>Ready to move</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.lots.map(function (x) {
        return '<tr>' + lotHead(x) + '<td data-l="Received">' + fmtNum(x.Received) + '</td><td data-l="Moved">' + fmtNum(x.Moved) + '</td><td data-l="Pass">' + fmtNum(x.MovedPass) + '<div class="cellsub">' + pctTxt(x.PassPct) + '</div></td><td data-l="Damage">' + fmtNum(x.MovedDamage) + '<div class="cellsub">' + pctTxt(x.DamagePct) + '</div></td><td data-l="Cancel">' + fmtNum(x.MovedCancel) + '<div class="cellsub">' + pctTxt(x.CancelPct) + '</div></td><td data-l="Ready to move"><b>' + fmtNum(Math.max(0, x.ToMove)) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts"><button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">Move</button></div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lot is in washing.</div>';
    h += '<h3 class="sec">Moved to ironing</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Pass</th><th>Damage</th><th>Cancel</th><th>Total</th><th>Left behind</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x.Move_ID) + '</b>' + (x.Is_Final ? ' <span class="badge ok">Washing closed</span>' : '') + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td>' +
          '<td data-l="Pass">' + fmtNum(x.Pass) + '</td><td data-l="Damage">' + fmtNum(x.Damage) + '</td><td data-l="Cancel">' + fmtNum(x.Cancel) + '</td><td data-l="Total"><b>' + fmtNum(x.Qty) + '</b></td><td data-l="Left behind">' + (x.Is_Final && x.Balance ? '<span class="badge warn">' + fmtNum(x.Balance) + '</span>' : '-') + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('WMOVE', x) + '<button class="btn sm ghost" data-xm="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">Nothing moved yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-lot')) return washMvForm(t.getAttribute('data-lot'));
      var id = t.getAttribute('data-xm');
      if (id) confirmBox('Cancel ' + id + '?', 'This move entry will be cancelled (and washing reopened if it had closed).', 'Cancel entry', true).then(function (ok) {
        if (ok) api('washMvCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadWashMv(); }).catch(fail);
      });
    };
  }
  function washMvForm(lotId) {
    var lot = S.wm.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    var ready = Math.max(0, lot.ToMove);
    var wd = Math.min(ready, Math.max(0, lot.SewDamage - lot.MovedDamage)), wc = Math.min(ready - wd, Math.max(0, lot.SewCancel - lot.MovedCancel));
    openModal('<h3>Move to ironing – ' + esc(lot.Lot_No) + '</h3><div class="hint">Received ' + fmtNum(lot.Received) + ' · moved ' + fmtNum(lot.Moved) + ' · ready to move <b>' + fmtNum(ready) + '</b></div>' +
      '<form id="ff"><label for="ff_d">Date</label><input id="ff_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="ff_p">Pass pieces</label><input id="ff_p" type="number" min="0" step="1" inputmode="numeric" value="' + (ready - wd - wc) + '">' +
      '<label for="ff_g">Damage pieces (carried from sewing: ' + fmtNum(lot.SewDamage) + ')</label><input id="ff_g" type="number" min="0" step="1" inputmode="numeric" value="' + wd + '">' +
      '<label for="ff_c">Cancel pieces (carried from sewing: ' + fmtNum(lot.SewCancel) + ')</label><input id="ff_c" type="number" min="0" step="1" inputmode="numeric" value="' + wc + '">' +
      '<div class="hint" id="ff_s" style="margin-top:8px"></div>' +
      '<label for="ff_r">Remarks (optional)</label><input id="ff_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="ff_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function calc() { var t = (Number($('#ff_p').value) || 0) + (Number($('#ff_g').value) || 0) + (Number($('#ff_c').value) || 0); $('#ff_s').innerHTML = 'Total moving <b>' + fmtNum(t) + '</b> · left after <b>' + fmtNum(ready - t) + '</b>' + (t > ready ? ' <span style="color:var(--bad)">· more than received</span>' : ''); }
      calc(); $('#ff').oninput = calc; $('#ff_x').onclick = closeModal;
      $('#ff').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { lotId: lotId, date: $('#ff_d').value, pass: $('#ff_p').value, damage: $('#ff_g').value, cancel: $('#ff_c').value, remarks: $('#ff_r').value };
        api('washMvSave', pay).then(function (res) { closeModal(); toast(res.closed ? 'Moved – washing closed' : 'Moved', 'ok'); return loadWashMv(); }).catch(fail);
      };
    });
  }
  /* ---- finishing: shared helper for single-quantity screens (ironing, stickering, packing receive) ---- */
  function qtyScreen(c) {
    function load(el) { return api(c.list).then(function (r) { S[c.key] = r; paint(); }).catch(fail); }
    function paint() {
      var r = S[c.key], w = r.canWrite, h = '';
      $('#vh').innerHTML = '<div class="mhelp">' + c.help + '</div>';
      var pend = r.lots.filter(function (x) { return c.avail(x) > 0; }), none = r.lots.filter(function (x) { return c.avail(x) <= 0; });
      function lrow(x, btn) {
        return '<tr>' + lotHead(x) + c.cols.map(function (k) { return '<td data-l="' + k[0] + '">' + (k[2] ? '<b>' : '') + fmtNum(Math.max(0, k[1](x))) + (k[2] ? '</b>' : '') + '</td>'; }).join('') +
          (w ? '<td class="acts-td"><div class="acts">' + (btn ? '<button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">' + c.btn + '</button>' : '') + '</div></td>' : '') + '</tr>';
      }
      var lhead = '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th>' + c.cols.map(function (k) { return '<th>' + k[0] + '</th>'; }).join('') + (w ? '<th></th>' : '') + '</tr></thead><tbody>';
      h += '<h3 class="sec">' + c.lotsTitle + '</h3>';
      h += pend.length ? lhead + pend.map(function (x) { return lrow(x, true); }).join('') + '</tbody></table>' : '<div class="card empty">' + c.emptyLots + '</div>';
      h += '<h3 class="sec">Lot summary – no balance</h3>';
      h += none.length ? lhead + none.map(function (x) { return lrow(x, false); }).join('') + '</tbody></table>' : '<div class="card empty">No lot without balance.</div>';
      h += '<h3 class="sec">' + c.rowsTitle + '</h3>';
      h += r.rows.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Qty</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
        r.rows.map(function (x) {
          return '<tr><td data-l="Entry"><b>' + esc(x._id) + '</b>' + (x.Is_Final ? ' <span class="badge ok">' + c.finalBadge + '</span>' : '') + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="Qty"><b>' + fmtNum(x.Qty) + '</b></td>' +
            (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn(({ ir: 'IRON', sk: 'STK', pr: 'PRECV' }[c.key]), x) + '<button class="btn sm ghost" data-x="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
        }).join('') + '</tbody></table>' : '<div class="card empty">Nothing entered yet.</div>';
      $('#vb').innerHTML = h;
      $('#vb').onclick = function (e) {
        var t = e.target; if (!t.getAttribute) return;
        if (t.getAttribute('data-lot')) return form(t.getAttribute('data-lot'));
        var id = t.getAttribute('data-x');
        if (id) confirmBox('Cancel ' + id + '?', 'This entry will be cancelled.', 'Cancel entry', true).then(function (ok) {
          if (ok) api(c.cancel, { id: id }).then(function () { toast('Entry cancelled', 'ok'); return load(); }).catch(fail);
        });
      };
    }
    function form(lotId) {
      var lot = S[c.key].lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
      var avail = Math.max(0, c.avail(lot));
      openModal('<h3>' + c.formTitle + ' – ' + esc(lot.Lot_No) + '</h3><div class="hint">' + c.hint(lot) + ' · can enter <b>' + fmtNum(avail) + '</b></div>' +
        '<form id="qf"><label for="qf_d">Date</label><input id="qf_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
        '<label for="qf_q">' + c.qtyLabel + '</label><input id="qf_q" type="number" min="1" step="1" inputmode="numeric" value="' + avail + '">' +
        '<label for="qf_r">Remarks (optional)</label><input id="qf_r" maxlength="200" autocomplete="off">' +
        '<div class="row"><button type="button" class="btn ghost" id="qf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
        $('#qf_x').onclick = closeModal;
        $('#qf').onsubmit = function (ev) {
          ev.preventDefault();
          var pay = { lotId: lotId, date: $('#qf_d').value, qty: $('#qf_q').value, remarks: $('#qf_r').value };
          api(c.save, pay).then(function (r) { closeModal(); toast(r && r.closed ? 'Saved – ' + (c.closedMsg || 'closed') : 'Saved', 'ok'); return load(); }).catch(fail);
        };
      });
    }
    return function (el) {
      el.innerHTML = '<div class="page-h"><h2>' + c.title + '</h2></div><div id="vh"></div><div id="vb"></div>';
      load();
    };
  }
  var viewIron = qtyScreen({
    title: 'Ironing Output', key: 'ir', list: 'ironList', save: 'ironSave', cancel: 'ironCancel', btn: 'Add output', formTitle: 'Ironing output', qtyLabel: 'Ironing output qty',
    help: 'Enter ironed pieces as many times as needed. The total cannot exceed the pieces received from the previous process (washing, or sewing when the lot has no washing).',
    lotsTitle: 'Lots in ironing – balance pending', emptyLots: 'No lot has balance to iron.', rowsTitle: 'Ironing entries', finalBadge: '',
    cols: [['Received', function (x) { return x.Src; }], ['Ironed', function (x) { return x.Ironed; }], ['To iron', function (x) { return x.ToIron; }, 1]],
    avail: function (x) { return x.ToIron; }, hint: function (x) { return 'Received ' + fmtNum(x.Src) + ' · ironed ' + fmtNum(x.Ironed); }
  });
  var viewStick = qtyScreen({
    title: 'Stickering Output', key: 'sk', list: 'stickList', save: 'stickSave', cancel: 'stickCancel', btn: 'Add output', formTitle: 'Stickering output', qtyLabel: 'Stickering output qty',
    help: 'Stickering handles pass pieces only. Enter stickered pieces as many times as needed; the total cannot exceed the pieces that passed ironing QC. Use <b>Sent to Packing</b> to hand over pass, damage and cancel pieces.',
    lotsTitle: 'Lots in stickering – balance pending', emptyLots: 'No lot has balance to sticker (pieces must pass ironing QC first).', rowsTitle: 'Stickering entries', finalBadge: '',
    cols: [['QC pass', function (x) { return x.QcPass; }], ['Stickered', function (x) { return x.Stickered; }], ['To sticker', function (x) { return x.ToSticker; }, 1]],
    avail: function (x) { return x.ToSticker; }, hint: function (x) { return 'Ironing QC pass ' + fmtNum(x.QcPass) + ' · stickered ' + fmtNum(x.Stickered); }
  });
  var viewPackRecv = qtyScreen({
    title: 'Packing – Received', key: 'pr', list: 'packRecvList', save: 'packRecvSave', cancel: 'packRecvCancel', btn: 'Receive', formTitle: 'Receive in packing', qtyLabel: 'Qty received',
    help: 'Record the pieces received from stickering, as many times as needed. Packing closes by itself once stickering is closed and everything sent has been received – the lot is then PACKED.',
    lotsTitle: 'Lots in packing – balance pending', emptyLots: 'No lot is waiting to be received.', rowsTitle: 'Received entries', finalBadge: 'Last receive',
    cols: [['Sent', function (x) { return x.Sent; }], ['Received', function (x) { return x.Received; }], ['To receive', function (x) { return x.ToRecv; }, 1]],
    avail: function (x) { return x.ToRecv; }, hint: function (x) { return 'Sent ' + fmtNum(x.Sent) + ' · received ' + fmtNum(x.Received); },
    closedMsg: 'lot packed'
  });
  /* ---- ironing QC ---- */
  function viewIronQc(el) {
    el.innerHTML = '<div class="page-h"><h2>Ironing QC</h2></div><div id="vh"></div><div id="vb"></div>';
    loadIronQc();
  }
  function loadIronQc() { return api('ironQcList').then(function (r) { S.iq = r; paintIronQc(); }).catch(fail); }
  function paintIronQc() {
    var r = S.iq, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">Enter QC results for ironed pieces as many times as needed: pass, damage (fabric defect / unit defect), cancel and alteration. Checked = pass + damage + cancel, limited to the ironing output. Pass pieces can be stickered right away. Ironing closes by itself once the previous process is closed and every piece received has been checked.</div>';
    var open = r.lots.filter(function (x) { return x.ToQC > 0; }), done = r.lots.filter(function (x) { return x.ToQC <= 0 && x.Ironed > 0; });
    function row(x, btn) {
      return '<tr>' + lotHead(x) + '<td data-l="Received">' + fmtNum(x.Src) + '</td><td data-l="Ironed">' + fmtNum(x.Ironed) + '</td><td data-l="Checked">' + fmtNum(x.QcTotal) + '</td><td data-l="Balance"><b>' + fmtNum(Math.max(0, x.ToQC)) + '</b></td>' +
        '<td data-l="Pass">' + fmtNum(x.QcPass) + '<div class="cellsub">' + pctTxt(x.PassPct) + '</div></td><td data-l="Damage">' + fmtNum(x.QcDamage) + '<div class="cellsub">Fabric ' + fmtNum(x.QcFabric) + ' · Unit ' + fmtNum(x.QcUnit) + ' · ' + pctTxt(x.DamagePct) + '</div></td>' +
        '<td data-l="Cancel">' + fmtNum(x.QcCancel) + '<div class="cellsub">' + pctTxt(x.CancelPct) + '</div></td><td data-l="Alteration">' + fmtNum(x.QcAlter) + '<div class="cellsub">' + pctTxt(x.AlterPct) + '</div></td>' +
        (w ? '<td class="acts-td"><div class="acts">' + (btn || (x.Ironed > 0) ? '<button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">' + (btn ? 'Add QC' : 'Close / add') + '</button>' : '') + '</div></td>' : '') + '</tr>';
    }
    var head = '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th><th>Received</th><th>Ironed</th><th>Checked</th><th>Balance</th><th>Pass</th><th>Damage</th><th>Cancel</th><th>Alteration</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>';
    h += '<h3 class="sec">Lots in ironing – QC balance pending</h3>';
    h += open.length ? head + open.map(function (x) { return row(x, true); }).join('') + '</tbody></table>' : '<div class="card empty">No lot has ironed pieces waiting for QC.</div>';
    h += '<h3 class="sec">Lot summary – no balance</h3>';
    h += done.length ? head + done.map(function (x) { return row(x, false); }).join('') + '</tbody></table>' : '<div class="card empty">No lot with ironing output and no balance.</div>';
    h += '<h3 class="sec">QC entries</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Total</th><th>Pass</th><th>Fabric defect</th><th>Unit defect</th><th>Cancel</th><th>Alteration</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x.QC_ID) + '</b>' + (x.Is_Final ? ' <span class="badge ok">Ironing closed</span>' : '') + (x.Is_Final && x.Balance ? ' <span class="badge warn">Left ' + fmtNum(x.Balance) + '</span>' : '') + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td>' +
          '<td data-l="Total"><b>' + fmtNum(x.Total) + '</b></td><td data-l="Pass">' + fmtNum(x.Pass) + '</td><td data-l="Fabric defect">' + fmtNum(x.Fabric) + '</td><td data-l="Unit defect">' + fmtNum(x.Unit) + '</td><td data-l="Cancel">' + fmtNum(x.Cancel) + '</td><td data-l="Alteration">' + fmtNum(x.Alter) + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('IQC', x) + '<button class="btn sm ghost" data-xq="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No QC entered yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-lot')) return ironQcForm(t.getAttribute('data-lot'));
      var id = t.getAttribute('data-xq');
      if (id) confirmBox('Cancel ' + id + '?', 'This QC entry will be cancelled (and ironing reopened if it had closed).', 'Cancel entry', true).then(function (ok) {
        if (ok) api('ironQcCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadIronQc(); }).catch(fail);
      });
    };
  }
  function ironQcForm(lotId) {
    var lot = S.iq.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    var wait = Math.max(0, lot.ToQC), carryC = Math.min(wait, Math.max(0, lot.PrevCancel - lot.QcCancel));
    openModal('<h3>Ironing QC – ' + esc(lot.Lot_No) + '</h3><div class="hint">Ironed ' + fmtNum(lot.Ironed) + ' · checked ' + fmtNum(lot.QcTotal) + ' · balance <b>' + fmtNum(wait) + '</b></div>' +
      '<form id="qf"><label for="qf_d">Date</label><input id="qf_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="qf_p">Pass pieces</label><input id="qf_p" type="number" min="0" step="1" inputmode="numeric" value="' + (wait - carryC) + '">' +
      '<label for="qf_g">Damage – fabric defect</label><input id="qf_g" type="number" min="0" step="1" inputmode="numeric" value="0">' +
      '<label for="qf_u">Damage – unit defect</label><input id="qf_u" type="number" min="0" step="1" inputmode="numeric" value="0">' +
      '<label for="qf_c">Cancel pieces (carried from ' + (lot.Washing ? 'washing' : 'sewing') + ': ' + fmtNum(lot.PrevCancel) + ')</label><input id="qf_c" type="number" min="0" step="1" inputmode="numeric" value="' + carryC + '">' +
      '<label for="qf_a">Alteration pieces</label><input id="qf_a" type="number" min="0" step="1" inputmode="numeric" value="0">' +
      '<div class="hint" id="qf_s" style="margin-top:8px"></div>' +
      '<label for="qf_r">Remarks (optional)</label><input id="qf_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="qf_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function n(id) { return Number($(id).value) || 0; }
      function calc() {
        var pd = n('#qf_p') + n('#qf_g') + n('#qf_u') + n('#qf_c');
        $('#qf_s').innerHTML = 'Total this entry <b>' + fmtNum(pd) + '</b> · balance after <b>' + fmtNum(wait - pd) + '</b>' + (pd > wait ? ' <span style="color:var(--bad)">· more than the ironed qty not yet checked</span>' : '');
      }
      calc(); $('#qf').oninput = calc; $('#qf_x').onclick = closeModal;
      $('#qf').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { lotId: lotId, date: $('#qf_d').value, pass: $('#qf_p').value, fabric: $('#qf_g').value, unitDefect: $('#qf_u').value, cancel: $('#qf_c').value, alteration: $('#qf_a').value, remarks: $('#qf_r').value };
        api('ironQcSave', pay).then(function (res) { closeModal(); toast(res.closed ? 'QC saved – ironing closed' : 'QC saved', 'ok'); return loadIronQc(); }).catch(fail);
      };
    });
  }
  /* ---- sent to packing ---- */
  function viewPackSend(el) {
    el.innerHTML = '<div class="page-h"><h2>Stickering – Sent to Packing</h2></div><div id="vh"></div><div id="vb"></div>';
    loadPackSend();
  }
  function loadPackSend() { return api('packSendList').then(function (r) { S.ps = r; paintPackSend(); }).catch(fail); }
  function paintPackSend() {
    var r = S.ps, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">Send pieces to packing – pass, damage and cancel are recorded separately, in as many entries as needed. Pass is limited to the stickered qty; damage (fabric + unit defects) and cancel are limited to the ironing QC results, so the total matches the ironing QC. Stickering closes by itself once ironing is closed and everything checked has been sent.</div>';
    var pend = r.lots.filter(function (x) { return x.ToSend > 0; }), none = r.lots.filter(function (x) { return x.ToSend <= 0; });
    function lrow(x, btn) {
      return '<tr>' + lotHead(x) + '<td data-l="IQC checked">' + fmtNum(x.QcTotal) + '<div class="cellsub">Pass ' + fmtNum(x.QcPass) + ' · Damage ' + fmtNum(x.QcDamage) + ' · Cancel ' + fmtNum(x.QcCancel) + '</div></td><td data-l="Stickered (pass)">' + fmtNum(x.Stickered) + '</td><td data-l="Sent">' + fmtNum(x.Sent) + '<div class="cellsub">Pass ' + fmtNum(x.SentPass) + ' · Damage ' + fmtNum(x.SentDamage) + ' · Cancel ' + fmtNum(x.SentCancel) + '</div></td><td data-l="Ready to send"><b>' + fmtNum(Math.max(0, x.ToSend)) + '</b></td>' +
        (w ? '<td class="acts-td"><div class="acts">' + (btn ? '<button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">Send</button>' : '') + '</div></td>' : '') + '</tr>';
    }
    var lhead = '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category</th><th>Unit</th><th>Ironing QC checked</th><th>Stickered (pass)</th><th>Sent</th><th>Ready to send</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>';
    h += '<h3 class="sec">Lots in stickering – balance pending</h3>';
    h += pend.length ? lhead + pend.map(function (x) { return lrow(x, true); }).join('') + '</tbody></table>' : '<div class="card empty">No lot has balance to send.</div>';
    h += '<h3 class="sec">Lot summary – no balance</h3>';
    h += none.length ? lhead + none.map(function (x) { return lrow(x, false); }).join('') + '</tbody></table>' : '<div class="card empty">No lot without balance.</div>';
    h += '<h3 class="sec">Sent to packing</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Pass</th><th>Damage</th><th>Cancel</th><th>Total</th><th>Left behind</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x.Pack_ID) + '</b>' + (x.Is_Final ? ' <span class="badge ok">Stickering closed</span>' : '') + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Date)) + '</td>' +
          '<td data-l="Pass">' + fmtNum(x.Pass) + '</td><td data-l="Damage">' + fmtNum(x.Damage) + '</td><td data-l="Cancel">' + fmtNum(x.Cancel) + '</td><td data-l="Total"><b>' + fmtNum(x.Qty) + '</b></td><td data-l="Left behind">' + (x.Is_Final && x.Balance ? '<span class="badge warn">' + fmtNum(x.Balance) + '</span>' : '-') + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('PSEND', x) + '<button class="btn sm ghost" data-x="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">Nothing sent yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-lot')) return packSendForm(t.getAttribute('data-lot'));
      var id = t.getAttribute('data-x');
      if (id) confirmBox('Cancel ' + id + '?', 'This entry will be cancelled (and stickering reopened if it had closed).', 'Cancel entry', true).then(function (ok) {
        if (ok) api('packSendCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadPackSend(); }).catch(fail);
      });
    };
  }
  function packSendForm(lotId) {
    var lot = S.ps.lots.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    var ready = Math.max(0, lot.ToSend), rp = Math.max(0, lot.ToSendPass), rd = Math.max(0, lot.ToSendDamage), rc = Math.max(0, lot.ToSendCancel);
    openModal('<h3>Send to packing – ' + esc(lot.Lot_No) + '</h3><div class="hint">Ironing QC: pass ' + fmtNum(lot.QcPass) + ' (stickered ' + fmtNum(lot.Stickered) + '), damage ' + fmtNum(lot.QcDamage) + ' (fabric ' + fmtNum(lot.QcFabric) + ' · unit ' + fmtNum(lot.QcUnit) + '), cancel ' + fmtNum(lot.QcCancel) + ' · already sent ' + fmtNum(lot.Sent) + ' · ready <b>' + fmtNum(ready) + '</b></div>' +
      '<form id="ff"><label for="ff_d">Date</label><input id="ff_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="ff_p">Pass pieces (stickered, ready ' + fmtNum(rp) + ')</label><input id="ff_p" type="number" min="0" step="1" inputmode="numeric" value="' + rp + '">' +
      '<label for="ff_g">Damage pieces (fabric + unit defects from ironing QC, ready ' + fmtNum(rd) + ')</label><input id="ff_g" type="number" min="0" step="1" inputmode="numeric" value="' + rd + '">' +
      '<label for="ff_c">Cancel pieces (from ironing QC, ready ' + fmtNum(rc) + ')</label><input id="ff_c" type="number" min="0" step="1" inputmode="numeric" value="' + rc + '">' +
      '<div class="hint" id="ff_s" style="margin-top:8px"></div>' +
      '<label for="ff_r">Remarks (optional)</label><input id="ff_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="ff_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function calc() { var t = (Number($('#ff_p').value) || 0) + (Number($('#ff_g').value) || 0) + (Number($('#ff_c').value) || 0); $('#ff_s').innerHTML = 'Total sending <b>' + fmtNum(t) + '</b> · left after <b>' + fmtNum(ready - t) + '</b>' + ((Number($('#ff_p').value) || 0) > rp || (Number($('#ff_g').value) || 0) > rd || (Number($('#ff_c').value) || 0) > rc ? ' <span style="color:var(--bad)">· more than available for a type</span>' : ''); }
      calc(); $('#ff').oninput = calc; $('#ff_x').onclick = closeModal;
      $('#ff').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { lotId: lotId, date: $('#ff_d').value, pass: $('#ff_p').value, damage: $('#ff_g').value, cancel: $('#ff_c').value, remarks: $('#ff_r').value };
        api('packSendSave', pay).then(function (res) { closeModal(); toast(res.closed ? 'Sent – stickering closed' : 'Sent', 'ok'); return loadPackSend(); }).catch(fail);
      };
    });
  }
  /* ---- Phase 10: lot tracking & search ---- */
  function viewTracking(el) {
    S.tk = S.tk || { q: '', stage: '', seasonId: '', unitId: '', status: 'ACTIVE' };
    el.innerHTML = '<div class="page-h"><h2>Lot Tracking</h2></div><div id="vh"></div><div id="vb"></div>';
    $('#vh').innerHTML = '<div class="mhelp">Search a lot by lot no or plan no, or click a stage to see the lots in it. Open a lot to see its full journey – every stage with dates, days and quantities – and every entry made for it.</div>';
    searchTrack();
  }
  function searchTrack() {
    return api('trackSearch', S.tk).then(function (r) { S.tkr = r; paintTrack(); }).catch(fail);
  }
  function paintTrack() {
    var r = S.tkr, f = S.tk, h = '';
    var stOpts = ['', 'LAYERING', 'CUTTING', 'SEWING', 'JOBWORK', 'WASHING', 'IRONING', 'STICKERING', 'PACKING', 'PACKED'];
    h += '<form class="fbar" id="tf"><input id="tf_q" placeholder="Lot no / plan no" value="' + esc(f.q) + '" autocomplete="off">' +
      '<select id="tf_s"><option value="">All seasons</option>' + r.seasons.map(function (s) { return '<option value="' + esc(s.id) + '"' + (f.seasonId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<select id="tf_u"><option value="">All units</option>' + r.units.map(function (s) { return '<option value="' + esc(s.id) + '"' + (f.unitId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<select id="tf_t"><option value="">All status</option>' + r.statuses.map(function (s) { return '<option value="' + esc(s) + '"' + (f.status === s ? ' selected' : '') + '>' + esc(s.charAt(0) + s.slice(1).toLowerCase()) + '</option>'; }).join('') + '</select>' +
      '<button class="btn" type="submit">Search</button></form>';
    h += '<div class="chips"><button class="chipb' + (f.stage === '' ? ' on' : '') + '" data-st="">All stages</button>' + stOpts.slice(1).filter(function (s) { return s !== 'JOBWORK' || (r.counts.JOBWORK || f.stage === 'JOBWORK'); }).map(function (s) {
      return '<button class="chipb' + (f.stage === s ? ' on' : '') + '" data-st="' + s + '">' + esc(STAGE[s] || s) + ' · ' + (r.counts[s] || 0) + '</button>';
    }).join('') + '</div>';
    h += '<div class="hint" style="margin-bottom:8px">' + r.total + ' lot(s)' + (r.total > r.rows.length ? ' – showing the latest ' + r.rows.length : '') + ' · WIP in these lots <b>' + fmtNum(r.wipTotal) + '</b> pcs. Stage counts are for active lots. WIP = pieces held in the lot\'s current department.</div>';
    h += r.rows.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Stage</th><th>Lot qty</th><th>Cut</th><th>Sewing moved</th><th>Washing moved</th><th>Ironing QC pass</th><th>Stickered</th><th>Packed</th><th>WIP qty</th><th></th></tr></thead><tbody>' +
      r.rows.map(function (x) {
        var live = x.Lot_Status === 'ACTIVE';
        return '<tr><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b>' + (x.Washing ? ' <span class="badge">Washing</span>' : '') + (live ? '' : ' <span class="badge warn">' + esc(x.Lot_Status.toLowerCase()) + '</span>') + '</td>' +
          '<td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Season) + ' · ' + esc(x.Category) + ' · ' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Stage">' + (live ? '<b>' + esc(STAGE[x.Stage] || x.Stage || '-') + '</b>' + (x.Days != null ? '<div class="cellsub">' + x.Days + ' day(s)' + (x.Since ? ' · since ' + esc(dfmt(x.Since)) : '') + '</div>' : '') : '-') + '</td>' +
          '<td data-l="Lot qty">' + fmtNum(x.Lot_Qty) + '</td><td data-l="Cut">' + fmtNum(x.Cut) + '</td><td data-l="Sewing moved">' + fmtNum(x.SewMoved) + '</td><td data-l="Washing moved">' + (x.Washing ? fmtNum(x.WashMoved) : '-') + '</td>' +
          '<td data-l="Ironing QC pass">' + fmtNum(x.IronPass) + '</td><td data-l="Stickered">' + fmtNum(x.Stickered) + '</td><td data-l="Packed">' + fmtNum(x.PackRecv) + '</td><td data-l="WIP qty"><b>' + fmtNum(x.Wip) + '</b></td>' +
          '<td class="acts-td"><div class="acts"><button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">Open</button></div></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lot found.</div>';
    $('#vb').innerHTML = h;
    $('#tf').onsubmit = function (e) {
      e.preventDefault();
      S.tk.q = $('#tf_q').value; S.tk.seasonId = $('#tf_s').value; S.tk.unitId = $('#tf_u').value; S.tk.status = $('#tf_t').value; searchTrack();
    };
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-st') !== null && t.classList.contains('chipb')) { S.tk.q = $('#tf_q').value; S.tk.seasonId = $('#tf_s').value; S.tk.unitId = $('#tf_u').value; S.tk.status = $('#tf_t').value; S.tk.stage = t.getAttribute('data-st'); return searchTrack(); }
      if (t.getAttribute('data-lot')) return openTrack(t.getAttribute('data-lot'));
    };
  }
  function openTrack(lotId) {
    api('trackDetail', { lotId: lotId }).then(function (d) { paintTrackDetail(d); }).catch(fail);
  }
  function paintTrackDetail(d) {
    var hd = d.head, h = '';
    var SM = { CLOSED: 'Closed', IN_PROGRESS: 'In progress', NOT_STARTED: 'Not started', SKIPPED: 'Not required' };
    h += '<p><button class="btn ghost sm" id="tk_back">&larr; Back to search</button></p>';
    h += '<div class="card"><h3 style="margin:0 0 4px">Lot ' + esc(hd.Lot_No) + (hd.Washing ? ' <span class="badge">Washing</span>' : '') + '</h3>' +
      '<div class="cellsub">' + esc(hd.Plan_ID) + ' · ' + esc(hd.Season) + ' · ' + esc(hd.Category) + ' · ' + esc(hd.Unit) + ' · ' + esc(ltName(hd.Lot_Type, hd.Lot_Source)) + (hd.Fabric_Width ? ' · width ' + esc(hd.Fabric_Width) : '') + '</div>' +
      '<div style="margin-top:8px">Lot qty <b>' + fmtNum(hd.Lot_Qty) + '</b> · fabric issued <b>' + fmtNum(hd.Issued) + '</b> · WIP now <b>' + fmtNum(hd.Wip) + '</b> · status <b>' + esc(hd.Lot_Status.toLowerCase()) + '</b>' +
      (hd.Lot_Status === 'ACTIVE' ? ' · now in <b>' + esc(STAGE[hd.Stage] || hd.Stage) + '</b>' + (hd.Days != null ? ' for <b>' + hd.Days + '</b> day(s)' : '') : '') + '</div></div>';
    h += '<h3 class="sec">Journey</h3><div class="jr">' + d.stages.map(function (s) {
      return '<div class="jc ' + s.status + '"><h4>' + esc(s.name) + '</h4><div class="sub">' + SM[s.status] +
        (s.start ? ' · ' + esc(dfmt(s.start)) + (s.end ? ' → ' + esc(dfmt(s.end)) : ' → …') : '') + (s.days != null ? ' · ' + s.days + ' day(s)' : '') + '</div>' +
        (s.status === 'SKIPPED' ? '' : s.metrics.map(function (m) { return '<div class="kv"><span>' + esc(m.l) + '</span><b>' + fmtNum(m.v) + '</b></div>'; }).join('')) + '</div>';
    }).join('') + '</div>';
    if (d.parents.length || d.children.length) {
      h += '<h3 class="sec">Split / club</h3>';
      if (d.parents.length) h += '<div class="hint">Made from: ' + d.parents.map(function (p) { return esc(p.Lot_No) + ' (' + fmtNum(p.Qty) + ' pcs, ' + esc(dfmt(p.Date)) + ')'; }).join(' · ') + '</div>';
      if (d.children.length) h += '<div class="hint">Moved to: ' + d.children.map(function (p) { return esc(p.Lot_No) + ' (' + fmtNum(p.Qty) + ' pcs, ' + esc(dfmt(p.Date)) + ')'; }).join(' · ') + '</div>';
    }
    h += '<h3 class="sec">Timeline</h3>';
    h += d.timeline.length ? '<table><thead><tr><th>Date</th><th>Stage</th><th>Entry</th><th>Details</th><th>By</th></tr></thead><tbody>' + d.timeline.map(function (e) {
      return '<tr><td data-l="Date">' + esc(dfmt(e.Date)) + '</td><td data-l="Stage">' + esc(e.Stage) + '</td><td data-l="Entry"><b>' + esc(e.Type) + '</b><div class="cellsub">' + esc(e.Id) + '</div></td><td data-l="Details">' + esc(e.Text) + '</td><td data-l="By">' + esc(e.By) + '</td></tr>';
    }).join('') + '</tbody></table>' : '<div class="card empty">No entries yet.</div>';
    $('#vb').innerHTML = h;
    $('#tk_back').onclick = function () { paintTrack(); };
  }
  /* ---- Phase 11: WIP & aging ---- */
  /* ---------- Revision G: WIP days by unit, lot cycle time, alert limits ---------- */
  function optList(list, cur, all) { return '<option value="">' + all + '</option>' + list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === cur ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join(''); }
  function repLinks(active) {
    return '<div class="rlinks">' + [['reports', 'Transactions'], ['wipdays', 'WIP days by unit'], ['cycle', 'Lot cycle time']].filter(function (x) { return S.menu.some(function (m) { return m.key === x[0]; }); }).map(function (x) {
      return '<button class="btn sm ' + (x[0] === active ? '' : 'ghost') + '" type="button" data-go="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
  }
  function bindRepLinks(el) { Array.prototype.forEach.call(el.querySelectorAll('[data-go]'), function (b) { b.onclick = function () { go(b.getAttribute('data-go')); }; }); }

  function viewWipDays(el) {
    S.wd = S.wd || { unitId: '', seasonId: '' };
    el.innerHTML = '<div class="page-h"><h2>WIP Days by Unit</h2></div>' + repLinks('wipdays') +
      '<div class="mhelp"><b>Days of WIP</b> = pieces held in a process ÷ the average daily output of that process in that unit (last working days; set in <b>FORECAST_AVG_DAYS</b>). ' +
      '<span class="badge warn">Constraint</span> means the WIP is below the minimum days you set, so the process will run out of work. <span class="badge off">Over WIP</span> means it is above the maximum days. Set the limits in <b>Alert Settings</b>.</div>' +
      '<div id="wdf"></div><div id="wdb"><div class="empty">Loading…</div></div>';
    bindRepLinks(el); loadWipDays();
  }
  function loadWipDays() { return api('wipDaysReport', S.wd).then(function (r) { if (S.page !== 'wipdays') return; S.wdr = r; paintWipDays(r); }).catch(function (e) { var b = $('#wdb'); if (b) b.innerHTML = '<div class="card empty">' + esc(e.message) + '</div>'; }); }
  function wdBadge(st) { return st === 'OVER' ? ' <span class="badge off">Over WIP</span>' : st === 'CONSTRAINT' ? ' <span class="badge warn">Constraint</span>' : ''; }
  function paintWipDays(r) {
    var f = S.wd, h = '';
    h += '<form class="fbar" id="wdform"><select id="wd_u" aria-label="Unit">' + optList(r.unitsList.map(function (u) { return { id: u.id, name: u.name }; }), f.unitId, 'All units') + '</select>' +
      '<select id="wd_s" aria-label="Season">' + optList(r.seasons, f.seasonId, 'All seasons') + '</select><button class="btn" type="submit">Show</button></form>';
    h += kpiCards([{ l: 'Total WIP', v: r.totalWip, sub: 'pieces in all processes' }, { l: 'Constraints', v: r.counts.CONSTRAINT, sub: 'WIP below the minimum days' }, { l: 'Over WIP', v: r.counts.OVER, sub: 'WIP above the maximum days' },
      { l: 'Average output of', v: r.avgDays + ' days', text: 1, sub: 'working days before today' }]);
    var byUnit = {}, order = [];
    r.rows.forEach(function (x) { if (!byUnit[x.Unit_ID]) { byUnit[x.Unit_ID] = { name: x.Unit, by: {} }; order.push(x.Unit_ID); } byUnit[x.Unit_ID].by[x.Proc] = x; });
    h += '<h3 class="rt">Days of WIP by unit and process</h3>';
    h += order.length ? '<div class="tw"><table class="nocsv"><thead><tr><th>Unit</th>' + r.procs.map(function (p) { return '<th>' + esc(p.l) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      order.map(function (id) {
        var u = byUnit[id];
        return '<tr><td data-l="Unit"><b>' + esc(u.name) + '</b></td>' + r.procs.map(function (p) {
          var c = u.by[p.k]; if (!c || c.Status === 'NONE') return '<td data-l="' + esc(p.l) + '">–</td>';
          return '<td data-l="' + esc(p.l) + '"><b>' + (c.Days == null ? 'no output' : c.Days + ' d') + '</b>' + wdBadge(c.Status) + '<div class="cellsub">' + fmtNum(c.Wip) + ' pcs</div></td>';
        }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' : '<div class="card empty">No units.</div>';
    h += '<h3 class="rt">Details</h3><div class="tw"><table><thead><tr><th>Unit</th><th>Process</th><th class="num">Lots</th><th class="num">WIP pcs</th><th class="num">Avg output / day</th><th class="num">Days of WIP</th><th>Limits (days)</th><th>Status</th></tr></thead><tbody>' +
      r.rows.filter(function (x) { return x.Status !== 'NONE'; }).map(function (x) {
        return '<tr><td data-l="Unit">' + esc(x.Unit) + '</td><td data-l="Process">' + esc(x.Process) + '</td><td data-l="Lots" class="num">' + x.Lots + '</td><td data-l="WIP pcs" class="num"><b>' + fmtNum(x.Wip) + '</b></td>' +
          '<td data-l="Avg output / day" class="num">' + fmtNum(x.AvgOut) + '</td><td data-l="Days of WIP" class="num"><b>' + (x.Days == null ? '–' : x.Days) + '</b></td>' +
          '<td data-l="Limits">' + (x.Min || x.Max ? 'min ' + (x.Min || '–') + ' · max ' + (x.Max || '–') : 'not set') + '</td><td data-l="Status">' + (x.Status === 'OVER' ? '<span class="badge off">Over WIP</span>' : x.Status === 'CONSTRAINT' ? '<span class="badge warn">Constraint</span>' : '<span class="badge ok">OK</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('#wdb').innerHTML = h;
    $('#wdform').onsubmit = function (e) { e.preventDefault(); S.wd.unitId = $('#wd_u').value; S.wd.seasonId = $('#wd_s').value; loadWipDays(); };
  }

  var CYC_COLS = [['WAIT', 'Fabric → layering (waiting)'], ['LAY', 'Layering'], ['CUT', 'Cutting'], ['CUT_TOTAL', 'Fabric → cutting out'], ['SEW_HOURLY', 'Sewing hourly (from cutting out)'], ['SEW_QC', 'Sewing QC'], ['SEW_FINAL', 'Sewing final'],
    ['SEW_CYCLE', 'Sewing cycle (cut out → sew out)'], ['JOBWORK', 'Job work'], ['WASH', 'Washing'], ['IRON', 'Ironing'], ['IRON_CYCLE', 'Ironing cycle'], ['STICK', 'Stickering'], ['STICK_CYCLE', 'Stickering cycle'], ['PACK', 'Packing'], ['TOTAL', 'Total (fabric → packing)']];
  function viewCycle(el) {
    S.cy = S.cy || { unitId: '', seasonId: '', categoryId: '', status: 'ALL', q: '' };
    el.innerHTML = '<div class="page-h"><h2>Lot Cycle Time</h2></div>' + repLinks('cycle') +
      '<div class="mhelp">Calendar days for every lot, from <b>fabric issue</b> to <b>packing receive</b>: the wait before layering, then the time in each process, and the cycle times (fabric → cutting out, cutting out → sewing out, and so on). A number followed by <b>…</b> is still running (counted up to today). ' +
      'Red means the limit set in <b>Alert Settings</b> is exceeded.</div><div id="cyf"></div><div id="cyb"><div class="empty">Loading…</div></div>';
    bindRepLinks(el); loadCycle();
  }
  var cySeq = 0;
  function loadCycle() { var my = ++cySeq; return api('cycleReport', S.cy).then(function (r) { if (my !== cySeq || S.page !== 'cycle') return; S.cyr = r; paintCycle(r); }).catch(function (e) { var b = $('#cyb'); if (b) b.innerHTML = '<div class="card empty">' + esc(e.message) + '</div>'; }); }
  function cyCell(z, over) {
    if (!z || z.d == null) return '<td class="num">–</td>';
    return '<td class="num' + (over ? ' cyover' : '') + '">' + (over ? '<b>' + z.d + '</b>' : z.d) + (z.o ? '…' : '') + '</td>';
  }
  function paintCycle(r) {
    var f = S.cy, h = '';
    if (!$('#cy_s')) {
      $('#cyf').innerHTML = '<form class="fbar" id="cyform"><select id="cy_s" aria-label="Season"></select><select id="cy_u" aria-label="Unit"></select><select id="cy_c" aria-label="Category"></select>' +
        '<select id="cy_t" aria-label="Status"><option value="ALL">All lots</option><option value="RUNNING">Running lots</option><option value="DONE">Finished lots</option></select>' +
        '<input type="search" id="cy_q" placeholder="Search lot or plan…" aria-label="Search"><button class="btn" type="submit">Show</button></form>';
      $('#cyform').onsubmit = function (e) { e.preventDefault(); S.cy.seasonId = $('#cy_s').value; S.cy.unitId = $('#cy_u').value; S.cy.categoryId = $('#cy_c').value; S.cy.status = $('#cy_t').value; S.cy.q = $('#cy_q').value; loadCycle(); };
      $('#cy_t').value = f.status; $('#cy_q').value = f.q;
    }
    $('#cy_s').innerHTML = optList(r.seasons, f.seasonId, 'All seasons'); $('#cy_u').innerHTML = optList(r.units, f.unitId, 'All units'); $('#cy_c').innerHTML = optList(r.cats, f.categoryId, 'All categories');
    var tot = r.summary.filter(function (z) { return z.k === 'TOTAL'; })[0], over = r.rows.filter(function (x) { return x.Flags.length; }).length;
    h += kpiCards([{ l: 'Lots', v: r.total, sub: 'in this selection' }, { l: 'Finished lots', v: tot ? tot.n : 0, sub: 'fabric issue to packing' }, { l: 'Average total', v: tot && tot.avg != null ? tot.avg + ' days' : '–', text: 1, sub: 'finished lots' },
      { l: 'Longest total', v: tot && tot.max != null ? tot.max + ' days' : '–', text: 1, sub: 'finished lots' }, { l: 'Over a limit', v: over, sub: 'lots with a process over its limit' }]);
    h += '<div class="rg"><div class="card"><h3>Average days per process</h3><div class="cellsub">Finished stages only</div>' +
      hbars(r.summary.filter(function (z) { return z.avg != null && z.k !== 'TOTAL'; }).map(function (z) { return { n: z.l, v: z.avg }; }), 'days') + '</div>' +
      '<div class="card"><h3>Summary</h3><div class="tw"><table class="nocsv"><thead><tr><th>Process</th><th class="num">Lots</th><th class="num">Average</th><th class="num">Longest</th><th class="num">Over limit</th></tr></thead><tbody>' +
      r.summary.map(function (z) { return '<tr><td data-l="Process">' + esc(z.l) + '</td><td data-l="Lots" class="num">' + z.n + '</td><td data-l="Average" class="num">' + (z.avg == null ? '–' : z.avg) + '</td><td data-l="Longest" class="num">' + (z.max == null ? '–' : z.max) + '</td><td data-l="Over limit" class="num">' + (z.over || '–') + '</td></tr>'; }).join('') +
      '</tbody></table></div></div></div>';
    var LIM = { WAIT: 'FABRIC', LAY: 'LAYERING', CUT: 'CUTTING', SEW_CYCLE: 'SEWING', WASH: 'WASHING', IRON_CYCLE: 'IRONING', STICK_CYCLE: 'STICKERING', PACK: 'PACKING' };
    h += '<h3 class="rt">Lots' + (r.total > r.rows.length ? ' (first ' + r.rows.length + ' of ' + r.total + ')' : '') + '</h3>';
    h += r.rows.length ? '<div class="tw"><table class="cyt"><thead><tr><th>Lot</th><th>Category</th><th>Unit</th><th>Stage</th><th>Fabric issued</th>' + CYC_COLS.map(function (c) { return '<th class="num">' + esc(c[1]) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        var fl = {}; x.Flags.forEach(function (z) { fl[z.k] = 1; });
        return '<tr><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b><div class="cellsub">' + esc(x.Plan_ID) + (x.Done ? ' · finished' : '') + '</div></td><td data-l="Category">' + esc(x.Category) + '</td><td data-l="Unit">' + esc(x.Unit) + '</td><td data-l="Stage">' + esc(STAGE[x.Stage] || x.Stage) + '</td><td data-l="Fabric issued">' + esc(dfmt(x.Issued)) + '</td>' +
          CYC_COLS.map(function (c) { var z = x.S[c[0]], ov = LIM[c[0]] && fl[LIM[c[0]]]; return cyCell(z, ov).replace('<td ', '<td data-l="' + esc(c[1]) + '" '); }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' : '<div class="card empty">No lots for this selection.</div>';
    $('#cyb').innerHTML = h;
  }

  function viewAlertSet(el) {
    el.innerHTML = '<div class="page-h"><h2>Alert Settings</h2></div>' +
      '<div class="mhelp">Limits that raise a notification (the bell) and a flag on the WIP Days and Lot Cycle Time pages. Leave a box empty or enter <b>0</b> for no limit.</div><div id="asb"><div class="empty">Loading…</div></div>';
    api('alertSettingsInfo').then(function (r) {
      if (S.page !== 'alertset') return;
      var h = '<div class="card"><h3>WIP limits (days of WIP)</h3><div class="cellsub" style="white-space:normal">Days of WIP = WIP pieces ÷ average daily output of the process in that unit. <b>Constraint</b>: alert when WIP is below the minimum. <b>Over WIP</b>: alert when WIP is above the maximum. Average output uses the last ' + r.avgDays + ' working days (setting FORECAST_AVG_DAYS).</div>' +
        '<div class="tw"><table class="nocsv"><thead><tr><th>Process</th><th>Constraint: below (days)</th><th>Over WIP: above (days)</th></tr></thead><tbody>' +
        r.procs.map(function (p) { return '<tr><td data-l="Process"><b>' + esc(p.l) + '</b></td><td data-l="Constraint: below"><input class="as" data-k="WIP_MIN_' + p.k + '" inputmode="decimal" value="' + (p.min || '') + '" placeholder="no limit"></td><td data-l="Over WIP: above"><input class="as" data-k="WIP_MAX_' + p.k + '" inputmode="decimal" value="' + (p.max || '') + '" placeholder="no limit"></td></tr>'; }).join('') +
        '</tbody></table></div></div>' +
        '<div class="card"><h3>Cycle time limits (days)</h3><div class="cellsub" style="white-space:normal">Alert when a lot has been in a process longer than this many days.</div>' +
        '<div class="tw"><table class="nocsv"><thead><tr><th>Process</th><th>Measured as</th><th>Maximum days</th></tr></thead><tbody>' +
        r.cycle.map(function (c) { return '<tr><td data-l="Process"><b>' + esc(c.l) + '</b></td><td data-l="Measured as">' + esc(c.h) + '</td><td data-l="Maximum days"><input class="as" data-k="CYC_MAX_' + c.k + '" inputmode="decimal" value="' + (c.max || '') + '" placeholder="no limit"></td></tr>'; }).join('') +
        '</tbody></table></div></div><div class="row"><button class="btn" id="as_save" type="button">Save limits</button></div>';
      $('#asb').innerHTML = h;
      $('#as_save').onclick = function () {
        var v = {}; Array.prototype.forEach.call(document.querySelectorAll('#asb .as'), function (i) { v[i.getAttribute('data-k')] = i.value; });
        api('alertSettingsSave', { values: v }).then(function (x) { toast(x.changed ? 'Limits saved' : 'Nothing changed', 'ok'); loadNotifs(); }).catch(fail);
      };
    }).catch(function (e) { $('#asb').innerHTML = '<div class="card empty">' + esc(e.message) + '</div>'; });
  }

  function viewWip(el) {
    S.wf = S.wf || { unitId: '', seasonId: '' };
    el.innerHTML = '<div class="page-h"><h2>WIP &amp; Aging</h2></div><div id="vh"></div><div id="vb"></div>';
    $('#vh').innerHTML = '<div class="mhelp">WIP qty = pieces held in the lot\'s <b>current department</b> (not yet moved on): fabric/cutting = lot balance; sewing = cut − moved; washing = sewing moved − washing moved; ironing = received − ironing QC checked; stickering = QC checked − sent to packing; packing = sent − received. Aging = days since the lot entered its current stage.</div>';
    loadWip();
  }
  function loadWip() { return api('wipReport', S.wf).then(function (r) { S.wr = r; paintWip(); }).catch(fail); }
  function paintWip() {
    var r = S.wr, f = S.wf, h = '';
    var ST = ['LAYERING', 'CUTTING', 'SEWING', 'JOBWORK', 'WASHING', 'IRONING', 'STICKERING', 'PACKING'];
    h += '<form class="fbar" id="wf"><select id="wf_u"><option value="">All units</option>' + r.unitsList.map(function (s) { return '<option value="' + esc(s.id) + '"' + (f.unitId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<select id="wf_s"><option value="">All seasons</option>' + r.seasons.map(function (s) { return '<option value="' + esc(s.id) + '"' + (f.seasonId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<button class="btn" type="submit">Show</button></form>';
    h += '<div class="jr"><div class="jc IN_PROGRESS"><h4>Total WIP</h4><div style="font-size:26px;font-weight:700">' + fmtNum(r.totalWip) + '</div><div class="sub">pieces in ' + r.totalLots + ' active lot(s)</div></div>' +
      r.buckets.map(function (b) { return '<div class="jc"><h4>' + esc(b.name) + '</h4><div class="kv"><span>Lots</span><b>' + b.lots + '</b></div><div class="kv"><span>WIP pcs</span><b>' + fmtNum(b.wip) + '</b></div></div>'; }).join('') + '</div>';
    h += '<h3 class="sec">WIP by stage</h3><table><thead><tr><th>Stage</th><th>Lots</th><th>WIP pcs</th><th>Avg days in stage</th><th>Oldest (days)</th></tr></thead><tbody>' +
      r.stages.map(function (s) { return '<tr><td data-l="Stage"><b>' + esc(STAGE[s.Stage] || s.Stage) + '</b></td><td data-l="Lots">' + s.Lots + '</td><td data-l="WIP pcs"><b>' + fmtNum(s.Wip) + '</b></td><td data-l="Avg days">' + s.AvgDays + '</td><td data-l="Oldest">' + s.MaxDays + '</td></tr>'; }).join('') + '</tbody></table>';
    h += '<h3 class="sec">WIP by unit</h3>';
    var ST2 = ST.filter(function (s) { return s !== 'JOBWORK' || r.stages.some(function (z) { return z.Stage === 'JOBWORK'; }); });
    h += r.units.length ? '<table><thead><tr><th>Unit</th><th>Lots</th>' + ST2.map(function (s) { return '<th>' + esc(STAGE[s]) + '</th>'; }).join('') + '<th>Total</th></tr></thead><tbody>' +
      r.units.map(function (u) { return '<tr><td data-l="Unit"><b>' + esc(u.Unit) + '</b></td><td data-l="Lots">' + u.Lots + '</td>' + ST2.map(function (s) { return '<td data-l="' + esc(STAGE[s]) + '">' + (u.By[s] ? fmtNum(u.By[s]) : '-') + '</td>'; }).join('') + '<td data-l="Total"><b>' + fmtNum(u.Total) + '</b></td></tr>'; }).join('') + '</tbody></table>' : '<div class="card empty">No active lots.</div>';
    h += '<h3 class="sec">Average days per stage (stages closed so far)</h3><table><thead><tr><th>Stage</th><th>Lots</th><th>Average days</th><th>Longest (days)</th></tr></thead><tbody>' +
      r.cycle.map(function (c) { return '<tr><td data-l="Stage"><b>' + esc(c.Stage) + '</b></td><td data-l="Lots">' + c.Lots + '</td><td data-l="Average days">' + (c.Lots ? c.AvgDays : '-') + '</td><td data-l="Longest">' + (c.Lots ? c.MaxDays : '-') + '</td></tr>'; }).join('') + '</tbody></table>';
    h += '<h3 class="sec">Oldest lots in WIP' + (r.rowsTotal > r.rows.length ? ' (top ' + r.rows.length + ' of ' + r.rowsTotal + ')' : '') + '</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Stage</th><th>Days in stage</th><th>WIP pcs</th><th>Lot qty</th><th></th></tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b>' + (x.Washing ? ' <span class="badge">Washing</span>' : '') + (x.JobWork ? ' <span class="badge" title="Job work lot, in-house finishing">Job work</span>' : (x.IronOnly ? ' <span class="badge" title="Ironing-only lot">' + esc(srcName(x.Source) || 'Ironing only') + '</span>' : '')) + '</td><td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Category) + ' · ' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Stage">' + esc(STAGE[x.Stage] || x.Stage) + (x.Since ? '<div class="cellsub">since ' + esc(dfmt(x.Since)) + '</div>' : '') + '</td><td data-l="Days">' + (x.Days == null ? '-' : '<b>' + x.Days + '</b>') + '</td><td data-l="WIP pcs"><b>' + fmtNum(x.Wip) + '</b></td><td data-l="Lot qty">' + fmtNum(x.Lot_Qty) + '</td>' +
          '<td class="acts-td"><div class="acts"><button class="btn sm" data-lot="' + esc(x.Lot_ID) + '">Open</button></div></td></tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No active lots.</div>';
    $('#vb').innerHTML = h;
    $('#wf').onsubmit = function (e) { e.preventDefault(); S.wf.unitId = $('#wf_u').value; S.wf.seasonId = $('#wf_s').value; loadWip(); };
    $('#vb').onclick = function (e) {
      var t = e.target;
      if (t.getAttribute && t.getAttribute('data-lot')) {
        api('trackDetail', { lotId: t.getAttribute('data-lot') }).then(function (d) { paintTrackDetail(d); $('#tk_back').onclick = function () { paintWip(); }; }).catch(fail);
      }
    };
  }
  /* ---- Phase 12: manpower, efficiency, capacity ---- */
  var PROC = { CUTTING: 'Cutting', SEWING: 'Sewing', WASHING: 'Washing', IRONING: 'Ironing', STICKERING: 'Stickering', PACKING: 'Packing' };
  function unitSel(id, units, cur, all) {
    return '<select id="' + id + '">' + (all ? '<option value="">All units</option>' : '') + units.map(function (u) { return '<option value="' + esc(u.id) + '"' + (cur === u.id ? ' selected' : '') + '>' + esc(u.name) + '</option>'; }).join('') + '</select>';
  }
  function hrLabel(h) { var x = h % 24, m = (h % 1) ? ':30' : ':00', hh = Math.floor(x); return ((hh % 12) || 12) + m + (hh >= 12 ? ' PM' : ' AM'); }
  function pctOrDash(v) { return v == null ? '-' : v + '%'; }
  function viewManpower(el) {
    el.innerHTML = '<div class="page-h"><h2>Daily Manpower</h2></div><div id="vh"></div><div id="vb"></div>';
    loadMan();
  }
  function loadMan() { return api('manList').then(function (r) { S.mp = r; paintMan(); }).catch(fail); }
  function procOpts(r, cur, writeOnly) {
    return r.procs.filter(function (p) { return !writeOnly || p.canWrite; }).map(function (p) { return '<option value="' + p.k + '"' + (cur === p.k ? ' selected' : '') + '>' + esc(p.l) + '</option>'; }).join('');
  }
  function paintMan() {
    var r = S.mp, w = r.canWrite, h = '';
    if (!r.setup || !r.procs) { $('#vh').innerHTML = ''; $('#vb').innerHTML = '<div class="card" style="border-left:4px solid var(--warn)"><b>The server has not been updated yet.</b><div>This page needs the latest <b>production-tracking-api</b> version. Upload it to the production-tracking-api repo, wait for the deployment to finish, then press Reload data.</div><div class="hint">Server answered with: ' + esc(Object.keys(r || {}).join(', ')) + '</div></div>'; return; }
    $('#vh').innerHTML = '<div class="mhelp">Enter manpower for <b>Cutting, Sewing, Ironing and Stickering</b>. <b>Normal working time</b> (9 AM – 6 PM): strength and present for every unit in one grid. <b>OT working time</b>: pick the slot (8–9 AM, or 6 PM – 12 AM in 30-minute steps) and the number of OT employees per unit. Every entry stays in the lists below – search, filter, sort, export, edit or remove any of them.</div>' +
      (r.setup.process && r.setup.otSheet ? '' : '<div class="card" style="border-left:4px solid var(--warn);margin:8px 0"><b>One-time setup needed in your Google Sheet:</b>' +
        (r.setup.process ? '' : '<div>Add a column named <b>Process</b> (capital P, exactly) to the <b>Manpower</b> sheet (row 1).</div>') +
        (r.setup.otSheet ? '' : '<div>Create a sheet named <b>Manpower_OT</b> with these headers in row 1: <code>' + esc(r.otCols.join(', ')) + '</code></div>') + '</div>') +
      (w ? '<p><button class="btn" id="mp_new">+ Normal working time</button> <button class="btn" id="ot_new">+ OT working time</button></p>' : '');
    if (r.absent.length) h += '<div class="jr">' + r.absent.map(function (a) { return '<div class="jc"><h4>' + esc(a.Unit) + '</h4><div class="kv"><span>Sewing absentee (30 days)</span><b>' + a.Pct + '%</b></div><div class="kv"><span>Days counted</span><b>' + a.Days + '</b></div></div>'; }).join('') + '</div>';
    var canP = {}; r.procs.forEach(function (p) { canP[p.k] = p.canWrite; });
    if (r.missing.length) h += '<h3 class="sec">Normal working time not entered (working days, last 14)</h3><div class="chips">' + r.missing.map(function (m) {
      return '<button class="chipb" data-mu="' + esc(m.Unit_ID) + '" data-md="' + esc(m.Date) + '" data-mp="' + esc(m.Process) + '"' + (canP[m.Process] ? '' : ' disabled') + '>' + esc(dfmt(m.Date)) + ' · ' + esc(PROC[m.Process] || m.Process) + (r.units.length > 1 ? ' · ' + esc(m.Unit) : '') + '</button>';
    }).join('') + '</div>';
    h += '<h3 class="sec">Normal working time (9 AM – 6 PM)</h3>';
    h += r.rows.length ? '<table><thead><tr><th>Date</th><th>Process</th><th>Unit</th><th>Strength</th><th>Present</th><th>Absent</th><th>Hours</th><th>Man-hours</th><th>Remarks</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr data-unit="' + esc(x.Unit) + '"><td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="Process">' + esc(PROC[x.Process] || x.Process) + '</td><td data-l="Unit">' + esc(x.Unit) + '</td><td data-l="Strength">' + (x.Strength == null ? '-' : fmtNum(x.Strength)) + '</td><td data-l="Present"><b>' + fmtNum(x.Present) + '</b></td>' +
          '<td data-l="Absent">' + (x.Absent == null ? '-' : x.Absent + ' · ' + x.AbsentPct + '%') + '</td><td data-l="Hours">' + x.Hours + '</td><td data-l="Man-hours">' + fmtNum(x.ManHoursNormal) + '</td><td data-l="Remarks">' + esc(x.Remarks) + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canEdit ? '<button class="btn sm ghost" data-ed="' + esc(x._id) + '">Edit</button><button class="btn sm ghost" data-xo="' + esc(x._id) + '">Remove</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No normal working time entered yet.</div>';
    h += '<h3 class="sec">OT working time</h3>';
    h += r.ot.length ? '<table><thead><tr><th>Date</th><th>Process</th><th>Unit</th><th>OT slot</th><th>OT hours</th><th>Employees</th><th>Man-hours</th><th>Remarks</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.ot.map(function (x) {
        return '<tr data-unit="' + esc(x.Unit) + '"><td data-l="Date">' + esc(dfmt(x.Date)) + '</td><td data-l="Process">' + esc(PROC[x.Process] || x.Process) + '</td><td data-l="Unit">' + esc(x.Unit) + '</td><td data-l="OT slot">' + esc(x.Slot) + (x.Legacy ? ' <span class="badge" title="Entered with the older form">older entry</span>' : '') + '</td><td data-l="OT hours">' + x.Hours + '</td>' +
          '<td data-l="Employees"><b>' + fmtNum(x.Count) + '</b></td><td data-l="Man-hours">' + fmtNum(x.ManHours) + '</td><td data-l="Remarks">' + esc(x.Remarks) + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canEdit ? '<button class="btn sm ghost" data-oed="' + esc(x._id) + '">Edit</button><button class="btn sm ghost" data-oxo="' + esc(x._id) + '">Remove</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No OT working time entered yet.</div>';
    $('#vb').innerHTML = h;
    if ($('#mp_new')) $('#mp_new').onclick = function () { manGrid({}); };
    if ($('#ot_new')) $('#ot_new').onclick = function () { otGrid({}); };
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-mu')) return manGrid({ date: t.getAttribute('data-md'), process: t.getAttribute('data-mp') });
      var id;
      if ((id = t.getAttribute('data-ed'))) { var row = r.rows.filter(function (z) { return z._id === id; })[0]; if (row) manGrid({ date: row.Date, process: row.Process }); return; }
      if ((id = t.getAttribute('data-oed'))) { var o = r.ot.filter(function (z) { return z._id === id; })[0]; if (o) otGrid({ date: o.Date, process: o.Process, from: o.From, to: o.To }); return; }
      if ((id = t.getAttribute('data-xo'))) return confirmBox('Remove this entry?', 'The normal working time entry will be removed.', 'Remove', true).then(function (ok) {
        if (ok) api('manCancel', { id: id }).then(function () { toast('Entry removed', 'ok'); return loadMan(); }).catch(fail);
      });
      if ((id = t.getAttribute('data-oxo'))) return confirmBox('Remove this OT entry?', 'The OT entry will be removed.', 'Remove', true).then(function (ok) {
        if (ok) api('otCancel', { id: id }).then(function () { toast('OT entry removed', 'ok'); return loadMan(); }).catch(fail);
      });
    };
  }
  /* normal working time: Date + Process, then one row per unit (Strength / Present) – the same layout as the paper grid */
  function manGrid(o) {
    var r = S.mp, writable = r.procs.filter(function (p) { return p.canWrite; });
    if (!writable.length) return toast('You cannot enter manpower', 'bad');
    var proc = o.process && writable.some(function (p) { return p.k === o.process; }) ? o.process : writable[0].k, day = o.date || todayStr();
    openModal('<h3>Regular working time (9 AM – 6 PM)</h3><form id="mg">' +
      '<div class="mgf"><label>Date <input id="mg_d" type="date" max="' + todayStr() + '" value="' + esc(day) + '"></label>' +
      '<label class="tf-l">Process <select id="mg_p">' + procOpts(r, proc, true) + '</select></label>' +
      '<label class="tf-l">Working hours <input id="mg_h" type="number" min="0.5" max="24" step="0.5" inputmode="decimal" value="' + r.shiftHours + '"></label></div>' +
      '<table class="nocsv mgt"><thead><tr><th>Unit</th><th>Strength</th><th>Present</th></tr></thead><tbody>' +
      r.units.map(function (u, i) { return '<tr><td><b>' + esc(u.name) + '</b></td><td><input class="mg_s" data-u="' + esc(u.id) + '" type="number" min="0" step="1" inputmode="numeric"></td><td><input class="mg_p" data-u="' + esc(u.id) + '" type="number" min="0" step="1" inputmode="numeric"></td></tr>'; }).join('') +
      '</tbody></table><div class="hint" id="mg_i"></div>' +
      '<label for="mg_r">Remarks (optional, applied to the units you fill in)</label><input id="mg_r" maxlength="100">' +
      '<div class="row"><button type="button" class="btn ghost" id="mg_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function fill() {
        var d = $('#mg_d').value, p = $('#mg_p').value, n = 0, hrs = null;
        Array.prototype.forEach.call(document.querySelectorAll('.mg_s'), function (si) {
          var u = si.getAttribute('data-u'), pi = document.querySelector('.mg_p[data-u="' + u + '"]');
          var ex = r.rows.filter(function (x) { return x.Unit_ID === u && x.Date === d && x.Process === p; })[0];
          if (ex) { si.value = ex.Strength == null ? '' : ex.Strength; pi.value = ex.Present; n++; hrs = ex.Hours; }
          else {
            var last = r.rows.filter(function (x) { return x.Unit_ID === u && x.Process === p && x.Date < d && x.Strength; })[0];   /* newest earlier entry: strength carries over */
            si.value = last ? last.Strength : ''; pi.value = '';
          }
        });
        if (hrs != null) $('#mg_h').value = hrs;
        $('#mg_i').innerHTML = n ? 'Existing entries for this date and process are filled in – change them and save.' : 'Strength is copied from the last entry of each unit. Leave a unit empty to skip it.';
      }
      var mm = document.querySelector('.modal'); if (mm) mm.style.maxWidth = '560px';
      $('#mg_d').onchange = fill; $('#mg_p').onchange = fill; fill();
      $('#mg_x').onclick = closeModal;
      $('#mg').onsubmit = function (ev) {
        ev.preventDefault();
        var rows = [];
        Array.prototype.forEach.call(document.querySelectorAll('.mg_p'), function (pi) {
          var u = pi.getAttribute('data-u'), si = document.querySelector('.mg_s[data-u="' + u + '"]');
          if (pi.value !== '') rows.push({ unitId: u, strength: si.value, present: pi.value });
        });
        api('manGridSave', { date: $('#mg_d').value, process: $('#mg_p').value, hours: $('#mg_h').value, remarks: $('#mg_r').value, rows: rows }).then(function (d) {
          closeModal(); toast('Saved · ' + d.created + ' new, ' + d.updated + ' changed' + (d.unchanged ? ', ' + d.unchanged + ' unchanged' : ''), 'ok'); return loadMan();
        }).catch(fail);
      };
    });
  }
  /* OT working time: Date + Process + slot From / To, then one row per unit (employees) */
  function otGrid(o) {
    var r = S.mp, writable = r.procs.filter(function (p) { return p.canWrite; });
    if (!writable.length) return toast('You cannot enter manpower', 'bad');
    var proc = o.process && writable.some(function (p) { return p.k === o.process; }) ? o.process : writable[0].k, day = o.date || todayStr();
    var froms = [8, 8.5]; for (var f = 18; f < 24; f += 0.5) froms.push(f);
    var from0 = o.from != null ? o.from : 18, to0 = o.to != null ? o.to : 19.5;
    function toOpts(from, cur) {
      var end = from < 9 ? 9 : 24, h = '';
      for (var t = from + 0.5; t <= end; t += 0.5) h += '<option value="' + t + '"' + (t === cur ? ' selected' : '') + '>' + hrLabel(t) + '</option>';
      return h;
    }
    openModal('<h3>OT working time</h3><form id="og">' +
      '<div class="mgf"><label>Date <input id="og_d" type="date" max="' + todayStr() + '" value="' + esc(day) + '"></label>' +
      '<label class="tf-l">Process <select id="og_p">' + procOpts(r, proc, true) + '</select></label>' +
      '<label class="tf-l">Slot from <select id="og_f">' + froms.map(function (v) { return '<option value="' + v + '"' + (v === from0 ? ' selected' : '') + '>' + hrLabel(v) + '</option>'; }).join('') + '</select></label>' +
      '<label class="tf-l">Slot to <select id="og_t">' + toOpts(from0, to0) + '</select></label></div>' +
      '<div class="hint" id="og_h"></div>' +
      '<table class="nocsv mgt"><thead><tr><th>Unit</th><th>OT employees</th></tr></thead><tbody>' +
      r.units.map(function (u) { return '<tr><td><b>' + esc(u.name) + '</b></td><td><input class="og_c" data-u="' + esc(u.id) + '" type="number" min="0" step="1" inputmode="numeric"></td></tr>'; }).join('') +
      '</tbody></table>' +
      '<label for="og_r">Remarks (optional, applied to the units you fill in)</label><input id="og_r" maxlength="100">' +
      '<div class="row"><button type="button" class="btn ghost" id="og_x">Cancel</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function info() { var hrs = Number($('#og_t').value) - Number($('#og_f').value); $('#og_h').innerHTML = 'OT hours for this slot: <b>' + hrs + '</b> · man-hours = employees × ' + hrs; }
      function fill() {
        var d = $('#og_d').value, p = $('#og_p').value, fr = Number($('#og_f').value), to = Number($('#og_t').value), n = 0;
        Array.prototype.forEach.call(document.querySelectorAll('.og_c'), function (ci) {
          var u = ci.getAttribute('data-u'), ex = r.ot.filter(function (x) { return !x.Legacy && x.Unit_ID === u && x.Date === d && x.Process === p && x.From === fr && x.To === to; })[0];
          ci.value = ex ? ex.Count : ''; if (ex) n++;
        });
        info();
      }
      var mo = document.querySelector('.modal'); if (mo) mo.style.maxWidth = '560px';
      $('#og_f').onchange = function () { var fr = Number(this.value), cur = Number($('#og_t').value); $('#og_t').innerHTML = toOpts(fr, cur > fr ? cur : fr + 0.5); fill(); };
      $('#og_t').onchange = fill; $('#og_d').onchange = fill; $('#og_p').onchange = fill; fill();
      $('#og_x').onclick = closeModal;
      $('#og').onsubmit = function (ev) {
        ev.preventDefault();
        var rows = [];
        Array.prototype.forEach.call(document.querySelectorAll('.og_c'), function (ci) { if (ci.value !== '') rows.push({ unitId: ci.getAttribute('data-u'), count: ci.value }); });
        api('otGridSave', { date: $('#og_d').value, process: $('#og_p').value, from: $('#og_f').value, to: $('#og_t').value, remarks: $('#og_r').value, rows: rows }).then(function (d) {
          closeModal(); toast('OT saved · ' + d.created + ' new, ' + d.updated + ' changed' + (d.unchanged ? ', ' + d.unchanged + ' unchanged' : ''), 'ok'); return loadMan();
        }).catch(fail);
      };
    });
  }
  function effClass(e, alert) { return e == null ? '' : (e < alert ? 'bad' : (e < alert + 15 ? 'warn' : 'ok')); }
  function cmpTxt(cur, prev, unit, good) {
    if (cur == null || prev == null) return '<div class="sub">Previous: ' + (prev == null ? '-' : prev + unit) + '</div>';
    var d = Math.round((cur - prev) * 10) / 10, up = d > 0, ok = good === 'low' ? !up : up;
    return '<div class="sub">Previous: ' + prev + unit + ' · <b style="color:' + (d === 0 ? 'var(--muted)' : (ok ? 'var(--ok)' : 'var(--bad)')) + '">' + (d > 0 ? '▲ +' : (d < 0 ? '▼ ' : '')) + d + (unit === '%' ? ' pts' : unit) + '</b></div>';
  }
  function viewEfficiency(el) {
    S.ef = S.ef || { unitId: '', days: 7 };
    el.innerHTML = '<div class="page-h"><h2>Sewing Efficiency</h2></div><div id="vh"></div><div id="vb"></div>';
    $('#vh').innerHTML = '<div class="mhelp">Efficiency % = <b>produced minutes</b> ÷ <b>available minutes</b>. Produced minutes = hourly sewing output × SMV of the lot\'s category (Masters → Standard time, process Sewing). Available minutes = present × normal hours × 60 + OT present × OT hours × 60 (Daily Manpower). Each period is compared with the period of the same length right before it. Use <b>Details</b> on a day to see how it was calculated.</div>';
    loadEff();
  }
  function loadEff() { return api('capEfficiency', S.ef).then(function (r) { S.er = r; paintEff(); }).catch(fail); }
  function paintEff() {
    var r = S.er, f = S.ef, h = '', custom = !!(f.from || f.to);
    h += '<form class="fbar" id="ef">' + unitSel('ef_u', r.unitsList, f.unitId, true) +
      '<select id="ef_d">' + [[7, 'Last 7 days'], [14, 'Last 14 days'], [30, 'Last 30 days'], [60, 'Last 60 days'], [90, 'Last 90 days'], ['custom', 'Date range']].map(function (d) { return '<option value="' + d[0] + '"' + ((custom ? 'custom' : Number(f.days)) == d[0] ? ' selected' : '') + '>' + d[1] + '</option>'; }).join('') + '</select>' +
      '<input id="ef_f" type="date" max="' + todayStr() + '" value="' + esc(f.from || r.from) + '"' + (custom ? '' : ' hidden') + ' title="From"><input id="ef_t" type="date" max="' + todayStr() + '" value="' + esc(f.to || r.to) + '"' + (custom ? '' : ' hidden') + ' title="To">' +
      '<button class="btn" type="submit">Show</button></form>';
    h += '<div class="hint">' + esc(dfmt(r.from)) + ' to ' + esc(dfmt(r.to)) + ' (' + r.len + ' day(s)) · compared with ' + esc(dfmt(r.prevFrom)) + ' to ' + esc(dfmt(r.prevTo)) + ' · alert below ' + r.alertPct + '%</div>';
    if (!r.units.length) h += '<div class="card empty">No unit to show.</div>';
    r.units.forEach(function (u) {
      var s = u.Summary, p = u.Prev;
      h += '<h3 class="sec">' + esc(u.Unit) + '</h3><div class="jr"><div class="jc ' + (s.Eff == null ? '' : (s.Alert ? 'bad' : 'CLOSED')) + '"><h4>Efficiency</h4><div style="font-size:26px;font-weight:700">' + pctOrDash(s.Eff) + '</div><div class="sub">' + s.DaysCounted + ' day(s) counted</div>' + cmpTxt(s.Eff, p.Eff, '%', 'high') + '</div>' +
        '<div class="jc"><h4>Output</h4><div class="kv"><span>Sewn pcs</span><b>' + fmtNum(s.Out) + '</b></div>' + cmpTxt(s.Out, p.Out, '', 'high') + '<div class="kv"><span>Avg present</span><b>' + fmtNum(s.AvgPresent) + '</b></div></div>' +
        '<div class="jc"><h4>Absentee</h4><div style="font-size:22px;font-weight:700">' + pctOrDash(s.AbsentPct) + '</div>' + cmpTxt(s.AbsentPct, p.AbsentPct, '%', 'low') + '</div>' +
        '<div class="jc"><h4>Minutes</h4><div class="kv"><span>Produced</span><b>' + fmtNum(s.ProdMin) + '</b></div><div class="kv"><span>Available</span><b>' + fmtNum(s.AvailMin) + '</b></div><div class="kv"><span>OT share</span><b>' + pctOrDash(s.OtPct) + '</b></div></div></div>';
      if (s.MissingManpowerDays) h += '<div class="hint" style="color:var(--warn)">' + s.MissingManpowerDays + ' day(s) have output but no manpower entry.</div>';
      if (s.NoSmvPcs) h += '<div class="hint" style="color:var(--warn)">' + fmtNum(s.NoSmvPcs) + ' pcs have no SMV set for their category, so they are not in the %.</div>';
      h += u.Days.length ? '<table><thead><tr><th>Date</th><th>Present / strength</th><th>Absent</th><th>OT present</th><th>Output</th><th>Produced min</th><th>Available min</th><th>Efficiency</th><th></th></tr></thead><tbody>' +
        u.Days.map(function (d) {
          var c = effClass(d.Eff, r.alertPct);
          return '<tr><td data-l="Date">' + esc(dfmt(d.Date)) + (d.Working ? '' : ' <span class="badge">Off day</span>') + '</td><td data-l="Present / strength">' + (d.NoManpower ? '<span class="badge warn">Missing</span>' : fmtNum(d.Present) + (d.Strength ? ' / ' + fmtNum(d.Strength) : '')) + '</td>' +
            '<td data-l="Absent">' + pctOrDash(d.AbsentPct) + '</td><td data-l="OT present">' + (d.OT1 || d.OT2 || d.OtHrs ? (d.OT1 || d.OT2 ? fmtNum(d.OT1) + ' + ' + fmtNum(d.OT2) : '') + (d.OtHrs ? '<div class="cellsub">' + d.OtHrs + ' man-hrs</div>' : '') : '-') + (d.OtNoManpower ? '<div class="cellsub" style="color:var(--warn)">OT output, no OT manpower</div>' : '') + '</td>' +
            '<td data-l="Output">' + fmtNum(d.Out) + (d.OutOt ? '<div class="cellsub">OT ' + fmtNum(d.OutOt) + '</div>' : '') + (d.NoSmv ? '<div class="cellsub">no SMV: ' + esc(d.NoSmvCats.join(', ') || 'unknown') + '</div>' : '') + '</td><td data-l="Produced min">' + fmtNum(d.ProdMin) + '</td><td data-l="Available min">' + (d.NoManpower ? '-' : fmtNum(d.AvailMin)) + '</td>' +
            '<td data-l="Efficiency">' + (d.Eff == null ? '-' : '<div class="ebar ' + c + '"><i style="width:' + Math.min(100, d.Eff) + '%"></i></div><b>' + d.Eff + '%</b>') + '</td>' +
            '<td class="acts-td"><div class="acts"><button class="btn sm ghost" type="button" data-ud="' + esc(u.Unit_ID) + '" data-dd="' + esc(d.Date) + '">Details</button></div></td></tr>';
        }).join('') + '</tbody></table>' : '<div class="card empty">No sewing output or manpower in this period.</div>';
    });
    $('#vb').innerHTML = h;
    $('#ef_d').onchange = function () { var c = $('#ef_d').value === 'custom'; $('#ef_f').hidden = !c; $('#ef_t').hidden = !c; };
    $('#ef').onsubmit = function (e) {
      e.preventDefault(); S.ef.unitId = $('#ef_u').value;
      if ($('#ef_d').value === 'custom') { S.ef.from = $('#ef_f').value; S.ef.to = $('#ef_t').value; delete S.ef.days; } else { S.ef.days = Number($('#ef_d').value); delete S.ef.from; delete S.ef.to; }
      loadEff();
    };
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute || !t.getAttribute('data-dd')) return;
      api('capEffDetail', { unitId: t.getAttribute('data-ud'), date: t.getAttribute('data-dd') }).then(paintEffDetail).catch(fail);
    };
  }
  function paintEffDetail(d) {
    var m = d.Manpower, mn = d.Minutes, t = d.Totals, h = '', alert = S.er ? S.er.alertPct : 60;
    h += '<p><button class="btn ghost sm" id="ed_back">&larr; Back to efficiency</button></p>';
    h += '<div class="card"><h3 style="margin:0 0 4px">' + esc(d.Unit) + ' · ' + esc(dfmt(d.Date)) + (d.Working ? '' : ' <span class="badge">Off day</span>') + '</h3>' +
      '<div class="cellsub">How the efficiency of this day was worked out</div>' +
      '<div style="margin-top:8px;font-size:15px">Efficiency <b style="font-size:22px">' + pctOrDash(t.Eff) + '</b> = produced <b>' + fmtNum(t.ProdMin) + '</b> min ÷ available <b>' + (mn ? fmtNum(mn.Total) : '-') + '</b> min</div>' +
      (t.NoSmvPcs ? '<div class="hint" style="color:var(--warn)">' + fmtNum(t.NoSmvPcs) + ' pcs have no SMV, so they are not in produced minutes.</div>' : '') +
      (t.OtNoManpower ? '<div class="hint" style="color:var(--warn)">There is output in OT hours but no OT manpower was entered.</div>' : '') + '</div>';
    h += '<h3 class="sec">Manpower</h3>';
    if (!m) h += '<div class="card empty">No manpower entered for this day.</div>';
    else h += '<div class="jr"><div class="jc"><h4>Normal hours</h4><div class="kv"><span>Strength</span><b>' + (m.Strength == null ? '-' : fmtNum(m.Strength)) + '</b></div><div class="kv"><span>Present</span><b>' + fmtNum(m.Present) + '</b></div><div class="kv"><span>Absent</span><b>' + (m.Absent == null ? '-' : m.Absent + ' (' + m.AbsentPct + '%)') + '</b></div><div class="kv"><span>Hours</span><b>' + m.Hours + '</b></div><div class="kv"><span>Available min</span><b>' + fmtNum(mn.Normal) + '</b></div><div class="kv"><span>Efficiency</span><b>' + pctOrDash(t.EffNormal) + '</b></div></div>' +
      '<div class="jc"><h4>OT 6:00 – 7:30 PM</h4><div class="kv"><span>Present</span><b>' + fmtNum(m.OT1) + '</b></div><div class="kv"><span>Hours</span><b>1.5</b></div><div class="kv"><span>Available min</span><b>' + fmtNum(mn.Ot1) + '</b></div></div>' +
      '<div class="jc"><h4>OT from 8:00 PM</h4><div class="kv"><span>Present</span><b>' + fmtNum(m.OT2) + '</b></div><div class="kv"><span>Ends at</span><b>' + (m.OT2 ? esc(hrLabel(m.OT2End)) : '-') + '</b></div><div class="kv"><span>Hours</span><b>' + (m.OT2Hours || 0) + '</b></div><div class="kv"><span>Available min</span><b>' + fmtNum(mn.Ot2) + '</b></div></div>' +
      (d.OtSlots && d.OtSlots.length ? '<div class="jc"><h4>OT slots entered</h4>' + d.OtSlots.map(function (z) { return '<div class="kv"><span>' + esc(z.Slot) + '</span><b>' + fmtNum(z.Count) + ' × ' + z.Hours + ' h</b></div>'; }).join('') + '</div>' : '') +
      '<div class="jc"><h4>OT total</h4><div class="kv"><span>Available min</span><b>' + fmtNum(mn.Ot1 + mn.Ot2 + (mn.OtSlots || 0)) + '</b></div><div class="kv"><span>OT output</span><b>' + fmtNum(t.OtOut) + '</b></div><div class="kv"><span>OT efficiency</span><b>' + pctOrDash(t.EffOt) + '</b></div></div></div>';
    h += '<h3 class="sec">Lots worked (hourly output)</h3>';
    if (!d.Lots.length) h += '<div class="card empty">No hourly output on this day.</div>';
    else {
      h += '<table><thead><tr><th>Lot</th><th>Category</th><th>SMV</th>' + d.Slots.map(function (s) { return '<th' + (s.ot ? ' style="color:var(--warn)"' : '') + '>' + esc(s.label) + (s.ot ? ' (OT)' : '') + '</th>'; }).join('') + '<th>Output</th><th>Produced min</th></tr></thead><tbody>' +
        d.Lots.map(function (l) {
          return '<tr><td data-l="Lot"><b>' + esc(l.Lot_No) + '</b><div class="cellsub">' + esc(l.Plan_ID) + '</div></td><td data-l="Category">' + esc(l.Category) + '</td><td data-l="SMV">' + (l.Smv > 0 ? l.Smv : '<span class="badge warn">No SMV</span>') + '</td>' +
            d.Slots.map(function (s) { return '<td data-l="' + esc(s.label) + '">' + (l.Slots[s.h] ? fmtNum(l.Slots[s.h]) : '-') + '</td>'; }).join('') + '<td data-l="Output"><b>' + fmtNum(l.Out) + '</b></td><td data-l="Produced min">' + fmtNum(l.ProdMin) + '</td></tr>';
        }).join('') + '<tr><td colspan="3"><b>Total</b></td>' + d.Slots.map(function (s) { return '<td data-l="' + esc(s.label) + '"><b>' + fmtNum(s.Out) + '</b></td>'; }).join('') + '<td data-l="Output"><b>' + fmtNum(t.Out) + '</b></td><td data-l="Produced min"><b>' + fmtNum(t.ProdMin) + '</b></td></tr></tbody></table>';
      h += '<div class="hint">Produced minutes = output × SMV of the lot\'s category. Normal hours: ' + fmtNum(t.NormalOut) + ' pcs / ' + fmtNum(t.NormalProdMin) + ' min · OT hours: ' + fmtNum(t.OtOut) + ' pcs / ' + fmtNum(t.OtProdMin) + ' min.</div>';
    }
    $('#vb').innerHTML = h;
    $('#ed_back').onclick = function () { paintEff(); };
  }
  function viewCapacity(el) {
    S.cf = S.cf || { unitId: '' };
    el.innerHTML = '<div class="page-h"><h2>Capacity &amp; Load</h2></div><div id="vh"></div><div id="vb"></div>';
    $('#vh').innerHTML = '<div class="mhelp"><b>Sewing</b>: all categories are converted into the <b>base category</b> with the <b>equivalent factor</b> (Masters → Categories; base = 1, e.g. Formal 1, Casual 1.18). Daily capacity = available machines (Masters → Capacity) × standard output per machine of the base category (Masters → Standard time). Sewing WIP and real output are converted the same way (pieces × factor), shown as <b>eq. pcs</b>. <b>Other processes</b> use normal pieces and the standard output weighted by the categories waiting there. Average = last 7 working days. Load = eq. WIP ÷ daily capacity, in working days; the clear-by date skips weekly offs and holidays.</div>';
    loadCap();
  }
  function loadCap() { return api('capCapacity', S.cf).then(function (r) { S.cr = r; paintCap(); }).catch(fail); }
  function paintCap() {
    var r = S.cr, f = S.cf, h = '';
    h += '<form class="fbar" id="cf">' + unitSel('cf_u', r.unitsList, f.unitId, true) + '<button class="btn" type="submit">Show</button></form>';
    h += '<div class="hint">Sewing factors: ' + (r.factors.length ? r.factors.map(function (x) { return esc(x.Category) + ' <b>' + x.Factor + '</b>' + (x.Set ? '' : ' (not set, counted as 1)'); }).join(' · ') : 'no categories') + '</div>';
    if (!r.units.length) h += '<div class="card empty">No unit to show.</div>';
    r.units.forEach(function (u) {
      h += '<h3 class="sec">' + esc(u.Unit) + (u.WorkingToday ? '' : ' <span class="badge">Off today</span>') + '</h3>';
      h += u.Rows.length ? '<table><thead><tr><th>Process</th><th>Machines</th><th>Base std / machine</th><th>Daily capacity</th><th>Avg 7 days</th><th>Today</th><th>Utilisation</th><th>WIP</th><th>Load (days)</th><th>Clear by</th></tr></thead><tbody>' +
        u.Rows.map(function (x) {
          var noCap = x.Capacity == null;
          return '<tr><td data-l="Process"><b>' + esc(PROC[x.Process]) + '</b></td><td data-l="Machines">' + (x.Machines == null ? '<span class="badge warn">Not set</span>' : fmtNum(x.Machines)) + '</td>' +
            '<td data-l="Base std / machine">' + (x.BaseStd == null ? '<span class="badge warn">No std</span>' : fmtNum(x.BaseStd) + '<div class="cellsub">' + esc(x.Basis) + '</div>') + '</td>' +
            '<td data-l="Daily capacity">' + (noCap ? '-' : '<b>' + fmtNum(x.Capacity) + '</b>' + (x.Process === 'SEWING' ? '<div class="cellsub">eq. pcs</div>' : '')) + '</td><td data-l="Avg 7 days">' + fmtNum(x.Avg7) + '<div class="cellsub">' + fmtNum(x.Avg7Pcs) + ' actual pcs</div></td><td data-l="Today">' + fmtNum(x.Today) + '<div class="cellsub">' + fmtNum(x.TodayPcs) + ' actual pcs</div></td>' +
            '<td data-l="Utilisation">' + (x.Util == null ? '-' : '<div class="ebar ' + (x.Util >= 90 ? 'ok' : (x.Util >= 60 ? 'warn' : 'bad')) + '"><i style="width:' + Math.min(100, x.Util) + '%"></i></div><b>' + x.Util + '%</b>') + '</td>' +
            '<td data-l="WIP"><b>' + fmtNum(x.WipEq) + '</b>' + (x.Process === 'SEWING' ? ' eq.' : '') + '<div class="cellsub">' + fmtNum(x.Wip) + ' pcs' + (x.Lots ? ' · ' + x.Lots + ' lot(s)' : '') + '</div>' +
            (x.Mix.length > 1 ? '<div class="cellsub">' + x.Mix.map(function (m) { return esc(m.Category) + ' ' + fmtNum(m.Wip) + (x.Process === 'SEWING' ? '×' + m.Factor : ''); }).join(' · ') + '</div>' : '') + '</td>' +
            '<td data-l="Load (days)">' + (x.LoadDays == null ? '-' : '<b>' + x.LoadDays + '</b>') + '</td><td data-l="Clear by">' + (x.ClearBy ? esc(dfmt(x.ClearBy)) : '-') + '</td></tr>';
        }).join('') + '</tbody></table>' : '<div class="card empty">No capacity, WIP or output for this unit yet.</div>';
    });
    $('#vb').innerHTML = h;
    $('#cf').onsubmit = function (e) { e.preventDefault(); S.cf.unitId = $('#cf_u').value; loadCap(); };
  }
  /* ---- Phase 13: forecast ---- */
  var FCS = { ON_TRACK: ['On track', 'ok'], AT_RISK: ['At risk', 'warn'], LATE: ['Late', 'off'], DONE: ['Done', 'ok'], NO_RATE: ['No output rate', 'warn'], NO_CUTOFF: ['No cutoff set', ''], NO_LOTS: ['No lots yet', ''], NA: ['Not applicable', ''] };
  function viewForecast(el) {
    S.fc = S.fc || { unitId: '', seasonId: '', status: '' };
    el.innerHTML = '<div class="page-h"><h2>Forecast</h2></div><div id="vh"></div><div id="vb"></div>';
    $('#vh').innerHTML = '<div class="mhelp">For each active plan and stage (each stage has its own cutoff date on the plan: fabric, cutting, <b>sewing</b>, ironing &amp; packing): <b>to go</b> = fabric not yet issued for the Fabric stage, otherwise the pieces of the plan\'s <b>issued lots</b> that still have to pass the stage. <b>Rate</b> = the unit\'s average output over the last working days (Settings → FORECAST_AVG_DAYS). Only <b>sewing</b> is in equivalent pieces (category factor); every other stage is normal pieces. <b>Finish</b> = the working day the remaining pieces would be done, queued behind plans of the same unit with an earlier cutoff for that stage. <b>Late</b> = days needed are more than the working days left until that stage\'s cutoff; <b>At risk</b> = inside the safety buffer (Settings → AT_RISK_BUFFER_PCT).</div>';
    loadForecast();
  }
  function loadForecast() { return api('forecastReport', { unitId: S.fc.unitId, seasonId: S.fc.seasonId }).then(function (r) { S.fr = r; paintForecast(); }).catch(fail); }
  function fcBadge(s) { var m = FCS[s] || [s, '']; return '<span class="badge ' + m[1] + '">' + esc(m[0]) + '</span>'; }
  function paintForecast() {
    var r = S.fr, f = S.fc, h = '';
    h += '<form class="fbar" id="ff">' + unitSel('ff_u', r.unitsList, f.unitId, true) +
      '<select id="ff_s"><option value="">All seasons</option>' + r.seasons.map(function (s) { return '<option value="' + esc(s.id) + '"' + (f.seasonId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
      '<button class="btn" type="submit">Show</button></form>';
    h += '<div class="chips"><button class="chipb' + (f.status ? '' : ' on') + '" data-fs="">All (' + r.rows.length + ')</button>' +
      ['LATE', 'AT_RISK', 'NO_RATE', 'ON_TRACK', 'NO_CUTOFF', 'DONE', 'NO_LOTS'].map(function (k) { return '<button class="chipb' + (f.status === k ? ' on' : '') + '" data-fs="' + k + '">' + FCS[k][0] + ' (' + r.counts[k] + ')</button>'; }).join('') + '</div>';
    var rows = r.rows.filter(function (x) { return !f.status || x.Status === f.status; });
    h += '<div class="hint">Rate = average of the last ' + r.avgDays + ' working days · buffer ' + r.buffer + '% · today ' + esc(dfmt(r.today)) + '</div>';
    h += rows.length ? '<table><thead><tr><th>Plan</th><th>Main cutoff</th><th>Qty</th>' + r.stages.map(function (s) { return '<th>' + esc(s.name) + '</th>'; }).join('') + '<th>Overall</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr data-unit="' + esc(x.Unit || '') + '"><td data-l="Plan"><b>' + esc(x.Plan_ID) + '</b>' + (x.Plan_Type === 'IRON_ONLY' ? ' <span class="badge">Ironing only</span>' : (x.Plan_Type === 'JOB_WORK' ? ' <span class="badge">Job work</span>' : '')) + '<div class="cellsub">' + esc(x.Season) + ' · ' + esc(x.Category) + ' · ' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Cutoff">' + esc(dfmt(x.Cutoff)) + '<div class="cellsub">' + (x.DaysLeft == null ? '' : (x.DaysLeft < 0 ? Math.abs(x.DaysLeft) + ' day(s) over' : x.DaysLeft + ' day(s) left')) + '</div></td>' +
          '<td data-l="Qty">' + fmtNum(x.Plan_Qty) + '<div class="cellsub">issued ' + fmtNum(x.Issued) + (x.NotIssued ? ' · <span style="color:var(--warn)">not issued ' + fmtNum(x.NotIssued) + '</span>' : '') + '</div></td>' +
          r.stages.map(function (s) {
            var z = x.Stages[s.k];
            return '<td data-l="' + esc(s.name) + '">' + fcBadge(z.Status) +
              (z.Status === 'NO_LOTS' || z.Status === 'NA' ? '' : '<div class="cellsub">' + fmtNum(z.Done) + ' done · <b>' + fmtNum(z.Remaining) + '</b> to go</div>' +
              (z.Finish ? '<div><b>' + esc(dfmt(z.Finish)) + '</b></div><div class="cellsub">needs ' + z.Needed + ' day(s)' + (z.Cutoff ? ', ' + z.Available + ' available' : '') + (z.Ahead ? ' · ' + fmtNum(z.Ahead) + (z.Eq ? ' eq.' : '') + ' pcs queued ahead' : '') + '</div>' : '') +
              '<div class="cellsub">cutoff ' + (z.Cutoff ? esc(dfmt(z.Cutoff)) : '<i>not set</i>') + '</div>' +
              (z.Status === 'LATE' ? '<div class="cellsub" style="color:var(--bad)">short ' + fmtNum(z.Short) + (z.Eq ? ' eq.' : '') + ' pcs · need ' + fmtNum(z.Required || 0) + '/day</div>' : '') +
              '<div class="cellsub">rate ' + fmtNum(z.Rate) + '/day' + (z.Eq ? ' (eq.)' : '') + '</div>') + '</td>';
          }).join('') + '<td data-l="Overall">' + fcBadge(x.Status) + '</td></tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No plan to show. Plans appear here when they are active and their season is in progress.</div>';
    $('#vb').innerHTML = h;
    $('#ff').onsubmit = function (e) { e.preventDefault(); S.fc.unitId = $('#ff_u').value; S.fc.seasonId = $('#ff_s').value; loadForecast(); };
    $('#vb').onclick = function (e) { var t = e.target; if (t.getAttribute && t.getAttribute('data-fs') !== null && t.classList.contains('chipb')) { S.fc.status = t.getAttribute('data-fs'); paintForecast(); } };
  }
  // ---------------- Phase 6: Layering ----------------
  function viewLayering(el) {
    el.innerHTML = '<div class="page-h"><h2>Layering</h2></div><div id="vh"></div><div id="vb"></div>';
    loadLay();
  }
  function loadLay() { return api('layList').then(function (r) { S.lay = r; paintLay(); }).catch(fail); }
  function paintLay() {
    var r = S.lay, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">Start a lay on a free table, then complete it with the pieces laid. When the last lay of a lot is done, tick <b>last lay</b> – the lot then moves to cutting. Use <b>Adjust / Cancel</b> when part of the lot will not be laid (e.g. damaged fabric returned to the warehouse): the lot qty and the fabric issued against the plan go down.</div>';
    h += '<h3 class="sec">Waiting for layering</h3>' + (r.notStarted.lots ? '<div class="hint" style="margin-bottom:8px"><b>' + r.notStarted.lots + '</b> lot(s) / <b>' + fmtNum(r.notStarted.pcs) + '</b> pcs are lying as fabric, layering not started.</div>' : '');
    h += r.pending.length ? '<table><thead><tr><th>Lot</th><th>Lot date</th><th>Plan</th><th>Width</th><th>Status</th><th>Balance</th><th>Laid</th><th>To lay</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.pending.map(function (x) {
        return '<tr data-unit="' + esc(x.Unit || '') + '"><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b>' + (x.InProgress ? ' <span class="badge warn">Lay in progress</span>' : '') + '</td><td data-l="Lot date">' + esc(x.Lot_Date ? dfmt(x.Lot_Date) : '-') + '</td><td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Category) + ' · ' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Width">' + esc(x.Fabric_Width || '-') + '</td><td data-l="Status">' + (x.Started ? '<span class="badge">Layering started</span>' : '<span class="badge warn">Not started</span><div class="cellsub">Fabric in unit ' + (x.WaitDays == null ? '' : x.WaitDays + ' day(s)') + (x.Since ? ' · since ' + esc(dfmt(x.Since)) : '') + '</div>') + '</td><td data-l="Balance">' + fmtNum(x.Balance) + (x.Adj || x.Moved_Out ? '<div class="cellsub">Lot ' + fmtNum(x.Lot_Qty) + (x.Moved_Out ? ' · moved ' + fmtNum(x.Moved_Out) : '') + (x.Adj ? ' · <span style="color:var(--bad)">adjusted −' + fmtNum(x.Adj) + '</span>' : '') + '</div>' : '') + '</td><td data-l="Laid">' + fmtNum(x.Laid) + '</td><td data-l="To lay"><b>' + fmtNum(x.PendingLay) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts"><button class="btn sm" data-start="' + esc(x.Lot_ID) + '">Start lay</button><button class="btn sm ghost" data-adj="' + esc(x.Lot_ID) + '" title="Reduce the lot qty (fabric returned, damage) or cancel the lot">Adjust / Cancel</button></div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lot is waiting for layering.</div>';
    h += '<h3 class="sec">Lays in progress</h3>';
    h += r.active.length ? '<table><thead><tr><th>Lay</th><th>Lot</th><th>Category</th><th>Table</th><th>Started</th><th>Running for</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.active.map(function (x) {
        return '<tr data-unit="' + esc(x.Unit || '') + '"><td data-l="Lay"><b>' + esc(x.Lay_ID) + '</b>' + (x.Layer_Name ? '<div class="cellsub">' + esc(x.Layer_Name) + '</div>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '<div class="cellsub">To lay ' + fmtNum(x.PendingLay) + '</div></td>' +
          '<td data-l="Category">' + esc(x.Category) + '</td><td data-l="Table">' + esc(x.Table) + '<div class="cellsub">' + esc(x.Unit) + '</div></td><td data-l="Started">' + esc(dfmt(x.Start_At)) + '</td><td data-l="Running for">' + esc(x.Duration || '-') + '</td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canAct ? '<button class="btn sm" data-done="' + esc(x._id) + '">Complete</button><button class="btn sm ghost" data-xl="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lay in progress.</div>';
    h += '<h3 class="sec">Completed lays</h3>';
    h += r.done.length ? '<table><thead><tr><th>Lay</th><th>Lot</th><th>Category</th><th>Table</th><th>Started</th><th>Completed</th><th>Duration</th><th>Qty</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.done.map(function (x) {
        return '<tr data-unit="' + esc(x.Unit || '') + '"><td data-l="Lay"><b>' + esc(x.Lay_ID) + '</b>' + (x.Is_Final ? ' <span class="badge ok">Last lay</span>' : '') + '</td><td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.Category) + '</td><td data-l="Table">' + esc(x.Table) + '</td>' +
          '<td data-l="Started">' + esc(dfmt(x.Start_At)) + '</td><td data-l="Completed">' + esc(dfmt(x.End_At)) + '</td><td data-l="Duration"><b>' + esc(x.Duration || '-') + '</b></td><td data-l="Qty"><b>' + fmtNum(x.Lay_Qty) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canEdit ? '<button class="btn sm ghost" data-le="' + esc(x._id) + '">Edit</button>' : '') + (x.canCancel ? '<button class="btn sm ghost" data-xl="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">Nothing completed yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target, a = t.getAttribute && t.getAttribute.bind(t);
      if (!a) return;
      if (a('data-start')) return startLayForm(a('data-start'));
      if (a('data-adj')) { var lx = S.lay.pending.filter(function (z) { return z.Lot_ID === a('data-adj'); })[0]; if (lx) adjForm({ Lot_ID: lx.Lot_ID, Lot_No: lx.Lot_No, Lot_Qty: lx.Lot_Qty, Moved_Out: lx.Moved_Out, Adj: lx.Adj, Adj_Reason: lx.Adj_Reason, Laid: lx.Laid }, loadLay); return; }
      if (a('data-done')) return doneLayForm(a('data-done'));
      if (a('data-le')) return editLayForm(a('data-le'));
      if (a('data-xl')) {
        var id = a('data-xl');
        confirmBox('Cancel ' + id + '?', 'This lay will be cancelled.', 'Cancel lay', true).then(function (ok) {
          if (ok) api('layCancel', { id: id }).then(function () { toast('Lay cancelled', 'ok'); return loadLay(); }).catch(fail);
        });
      }
    };
  }
  /* lot qty adjustment / cancel: x = {Lot_ID, Lot_No, Lot_Qty, Moved_Out, Adj, Adj_Reason, Laid} */
  function adjForm(x, after) {
    var gross = (x.Lot_Qty || 0) - (x.Moved_Out || 0), max = Math.max(0, gross - (x.Laid || 0));
    openModal('<h3>Adjust / cancel – ' + esc(x.Lot_No) + '</h3><div class="hint">Lot qty ' + fmtNum(x.Lot_Qty) + (x.Moved_Out ? ' · moved to other lots ' + fmtNum(x.Moved_Out) : '') + ' · laid ' + fmtNum(x.Laid || 0) + (x.Adj ? ' · adjusted so far ' + fmtNum(x.Adj) : '') + '</div>' +
      '<form id="ja"><label for="ja_q">Total qty adjusted / cancelled for this lot (pcs)</label><input id="ja_q" type="number" min="0" max="' + max + '" step="1" inputmode="numeric" value="' + (x.Adj || '') + '">' +
      '<div class="hint" id="ja_s"></div>' +
      '<label for="ja_r">Reason</label><input id="ja_r" maxlength="200" autocomplete="off" placeholder="e.g. fabric damage – returned to fabric warehouse" value="' + esc(x.Adj_Reason || '') + '">' +
      '<div class="hint">Only the pieces not yet laid can be adjusted (up to ' + fmtNum(max) + '). The adjusted pieces also come off the fabric issued against the plan. Enter 0 to undo.</div>' +
      '<div class="row"><button type="button" class="btn ghost" id="ja_x">Back</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function calc() {
        var q = Number($('#ja_q').value) || 0, net = gross - q;
        $('#ja_s').innerHTML = q > max ? '<span style="color:var(--bad)">More than the ' + fmtNum(max) + ' pcs not yet laid</span>' :
          'Net lot qty <b>' + fmtNum(net) + '</b>' + (net === 0 ? ' · <b style="color:var(--bad)">the lot will be cancelled</b>' : (x.Laid && net <= x.Laid ? ' · layering will close (all laid)' : ' · still to lay ' + fmtNum(net - (x.Laid || 0))));
      }
      calc(); $('#ja_q').oninput = calc; $('#ja_x').onclick = closeModal;
      $('#ja').onsubmit = function (ev) {
        ev.preventDefault();
        var q = Number($('#ja_q').value) || 0, go2 = function () {
          api('lotAdjust', { lotId: x.Lot_ID, qty: String(q), reason: $('#ja_r').value }).then(function (r) {
            closeModal(); toast(r.cancelled ? 'Lot ' + x.Lot_No + ' cancelled' : 'Lot ' + x.Lot_No + ': net qty ' + fmtNum(r.Net) + (r.closed ? ' – layering closed' : ''), 'ok'); return after();
          }).catch(fail);
        };
        if (gross - q === 0) confirmBox('Cancel lot ' + x.Lot_No + '?', 'All ' + fmtNum(gross) + ' pcs are adjusted, so the lot will be cancelled. You can undo this from the Lots page.', 'Cancel lot', true).then(function (ok) { if (ok) go2(); });
        else go2();
      };
    });
  }
  function editLayForm(id) {
    var x = S.lay.done.filter(function (z) { return z._id === id; })[0]; if (!x) return;
    openModal('<h3>Edit ' + esc(x.Lay_ID) + ' – ' + esc(x.Lot_No) + '</h3><div class="hint">Lot balance ' + fmtNum(x.Balance) + ' · laid in all lays ' + fmtNum(x.Laid) + ' · this lay ' + fmtNum(x.Lay_Qty) + '</div>' +
      '<form id="le"><label for="le_q">Correct lay qty</label><input id="le_q" type="number" min="1" step="1" inputmode="numeric" value="' + x.Lay_Qty + '"><div class="hint" id="le_s"></div>' +
      '<label for="le_r">Reason</label><input id="le_r" maxlength="200" autocomplete="off" placeholder="e.g. typed 1300 instead of 1030">' +
      '<div class="row"><button type="button" class="btn ghost" id="le_x">Back</button><button class="btn" type="submit">Save</button></div></form>', function () {
      function calc() { var q = Number($('#le_q').value) || 0, t = x.Laid - x.Lay_Qty + q; $('#le_s').innerHTML = 'Laid for the lot after the change <b>' + fmtNum(t) + '</b> of ' + fmtNum(x.Balance) + (t >= x.Balance ? ' · layering closes' : ''); }
      calc(); $('#le_q').oninput = calc; $('#le_x').onclick = closeModal;
      $('#le').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { id: id, qty: $('#le_q').value, reason: $('#le_r').value };
        var send = function (ov) { return api('layEdit', Object.assign({ confirmOver: ov }, pay)).then(function () { closeModal(); toast('Lay qty corrected', 'ok'); return loadLay(); }); };
        send(false).catch(function (e) {
          if (e.code !== 'OVER') return fail(e);
          confirmBox('More than the lot balance', e.message.replace(' Confirm to continue.', '') + ' Continue?', 'Continue', true).then(function (ok) { if (ok) send(true).catch(fail); });
        });
      };
    });
  }
  function startLayForm(lotId) {
    var r = S.lay, lot = r.pending.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    openModal('<h3>Start lay – ' + esc(lot.Lot_No) + '</h3><form id="ls"><label for="ls_t">Table</label><select id="ls_t"><option value="">Select…</option>' +
      (r.tables || []).map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.busy ? ' disabled' : '') + '>' + esc(t.unit + ' · ' + t.name) + (t.busy ? ' (busy – ' + esc(t.busyLot) + ')' : '') + '</option>'; }).join('') + '</select>' +
      '<label for="ls_n">Layer name (optional)</label><input id="ls_n" maxlength="30" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="ls_x">Cancel</button><button class="btn" type="submit">Start</button></div></form>', function () {
      $('#ls_x').onclick = closeModal;
      $('#ls').onsubmit = function (ev) {
        ev.preventDefault();
        if (!$('#ls_t').value) return toast('Select a table', 'bad');
        api('layStart', { lotId: lotId, tableId: $('#ls_t').value, layerName: $('#ls_n').value }).then(function () { closeModal(); toast('Lay started', 'ok'); return loadLay(); }).catch(fail);
      };
    });
  }
  function doneLayForm(id) {
    var x = S.lay.active.filter(function (z) { return z._id === id; })[0]; if (!x) return;
    openModal('<h3>Complete ' + esc(x.Lay_ID) + ' – ' + esc(x.Lot_No) + '</h3><div class="hint">Balance ' + fmtNum(x.Balance) + ' · already laid ' + fmtNum(x.Laid) + ' · to lay ' + fmtNum(x.PendingLay) + '</div>' +
      '<form id="ld"><label for="ld_q">Pieces laid</label><input id="ld_q" type="number" min="1" step="1" inputmode="numeric" value="' + x.PendingLay + '">' +
      '<label class="chk"><input type="checkbox" id="ld_f"> <span>This was the last lay of the lot</span></label>' +
      '<div class="row"><button type="button" class="btn ghost" id="ld_x">Back</button><button class="btn" type="submit">Complete</button></div></form>', function () {
      $('#ld_x').onclick = closeModal;
      $('#ld').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { id: id, qty: $('#ld_q').value, final: $('#ld_f').checked };
        var send = function (ov) {
          return api('layComplete', Object.assign({ confirmOver: ov }, pay)).then(function () { closeModal(); toast('Lay completed', 'ok'); return loadLay(); });
        };
        send(false).catch(function (e) {
          if (e.code !== 'OVER') return fail(e);
          confirmBox('More than expected', e.message.replace(' Confirm to continue.', '') + ' Continue?', 'Continue', true).then(function (ok) { if (ok) send(true).catch(fail); });
        });
      };
    });
  }
  // ---------------- Phase 6: Cutting ----------------
  function viewCutting(el) {
    el.innerHTML = '<div class="page-h"><h2>Cutting</h2></div><div id="vh"></div><div id="vb"></div>';
    loadCut();
  }
  function loadCut() { return api('cutList').then(function (r) { S.cut = r; paintCut(); }).catch(fail); }
  function paintCut() {
    var r = S.cut, w = r.canWrite, h = '';
    $('#vh').innerHTML = '<div class="mhelp">Enter the pieces cut for a lot (daily or in one go). Sewing can start as soon as pieces are cut. Cutting may differ from the laid qty; it closes by itself once layering is closed and the cut qty reaches the laid qty. For a short cut, tick <b>cutting complete</b> on the last entry.</div>';
    h += '<h3 class="sec">Waiting for cutting</h3>';
    h += r.pending.length ? '<table><thead><tr><th>Lot</th><th>Plan</th><th>Laid</th><th>Cut</th><th>To cut</th><th>Layering</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.pending.map(function (x) {
        return '<tr data-unit="' + esc(x.Unit || '') + '"><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b></td><td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Category) + ' · ' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Laid">' + fmtNum(x.Laid) + '</td><td data-l="Cut">' + fmtNum(x.Cut) + '</td><td data-l="To cut"><b>' + fmtNum(x.PendingCut) + '</b></td>' +
          '<td data-l="Layering">' + (x.LayClosed ? '<span class="badge ok">Done</span>' : '<span class="badge warn">Ongoing</span>') + '</td>' +
          (w ? '<td class="acts-td"><div class="acts"><button class="btn sm" data-cut="' + esc(x.Lot_ID) + '">Enter cutting</button></div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No lot is waiting for cutting.</div>';
    h += '<h3 class="sec">Cutting entries</h3>';
    h += r.entries.length ? '<table><thead><tr><th>Entry</th><th>Lot</th><th>Category</th><th>Unit</th><th>Date</th><th>Qty</th>' + (w ? '<th></th>' : '') + '</tr></thead><tbody>' +
      r.entries.map(function (x) {
        return '<tr><td data-l="Entry"><b>' + esc(x.Cutting_ID) + '</b>' + (x.Is_Final ? ' <span class="badge ok">Complete</span>' : '') + (x.Remarks ? '<div class="cellsub">' + esc(x.Remarks) + '</div>' : '') + '</td>' +
          '<td data-l="Lot">' + esc(x.Lot_No) + '</td><td data-l="Category">' + esc(x.CatName || x.Category) + '</td><td data-l="Unit">' + esc(x.UnitName || x.Unit) + '</td><td data-l="Date">' + esc(dfmt(x.Cut_Date)) + '</td><td data-l="Qty"><b>' + fmtNum(x.Cut_Qty) + '</b></td>' +
          (w ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? corrBtn('CUT', x) + '<button class="btn sm ghost" data-xc="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>' : '<div class="card empty">No cutting entered yet.</div>';
    $('#vb').innerHTML = h;
    $('#vb').onclick = function (e) {
      var t = e.target; if (!t.getAttribute) return;
      if (t.getAttribute('data-cut')) return cutForm(t.getAttribute('data-cut'));
      var id = t.getAttribute('data-xc');
      if (id) confirmBox('Cancel ' + id + '?', 'This cutting entry will be cancelled.', 'Cancel entry', true).then(function (ok) {
        if (ok) api('cutCancel', { id: id }).then(function () { toast('Entry cancelled', 'ok'); return loadCut(); }).catch(fail);
      });
    };
  }
  function cutForm(lotId) {
    var lot = S.cut.pending.filter(function (x) { return x.Lot_ID === lotId; })[0]; if (!lot) return;
    openModal('<h3>Cutting – ' + esc(lot.Lot_No) + '</h3><div class="hint">Laid ' + fmtNum(lot.Laid) + ' · cut so far ' + fmtNum(lot.Cut) + ' · to cut ' + fmtNum(lot.PendingCut) + '</div>' +
      '<form id="cf"><label for="cf_d">Date</label><input id="cf_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="cf_q">Pieces cut</label><input id="cf_q" type="number" min="1" step="1" inputmode="numeric" value="' + Math.max(lot.PendingCut, 0) + '">' +
      '<div class="hint" id="cf_s" style="margin-top:8px"></div>' +
      '<label class="chk" id="cf_fl" hidden><input type="checkbox" id="cf_f"> <span>Cutting complete (short cut) – close cutting for this lot</span></label>' +
      '<label for="cf_r">Remarks (optional)</label><input id="cf_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="cf_x">Back</button><button class="btn" type="submit">Save</button></div></form>', function () {
      $('#cf_x').onclick = closeModal;
      function calc() {
        var t = lot.Cut + (Number($('#cf_q').value) || 0), short = lot.LayClosed && t < lot.Laid;
        $('#cf_fl').hidden = !short; if (!short) $('#cf_f').checked = false;
        $('#cf_s').innerHTML = 'Total cut after this entry <b>' + fmtNum(t) + '</b> of ' + fmtNum(lot.Laid) + ' laid' +
          (!lot.LayClosed ? ' · layering is still going on' : t >= lot.Laid ? ' · cutting will close' : ' · ' + fmtNum(lot.Laid - t) + ' short');
      }
      calc(); $('#cf').oninput = calc;
      $('#cf').onsubmit = function (ev) {
        ev.preventDefault();
        var pay = { lotId: lotId, date: $('#cf_d').value, qty: $('#cf_q').value, final: !$('#cf_fl').hidden && $('#cf_f').checked, remarks: $('#cf_r').value };
        api('cutSave', pay).then(function (res) { closeModal(); toast(res.closed ? 'Cutting saved – cutting closed' : 'Cutting saved', 'ok'); return loadCut(); }).catch(fail);
      };
    });
  }

  function viewLots(el) {
    el.innerHTML = '<div class="page-h"><h2>Lots</h2></div><div id="lh"></div><div id="lb"></div>';
    api('lotList').then(function (r) { S.lots = r.rows; paintLots(); }).catch(fail);
  }
  function paintLots() {
    $('#lh').innerHTML = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">All lots in your scope. Stage and days in stage update as work is recorded.</div>' +
      '<input id="lq" placeholder="Search lot, plan, category…" style="max-width:220px" value="' + esc(S.lq || '') + '">' +
      '<select id="ls" style="max-width:150px"><option value="">All status</option>' + ['ACTIVE', 'CONVERTED', 'COMPLETED', 'CANCELLED'].map(function (s) {
        return '<option' + (S.ls === s ? ' selected' : '') + ' value="' + s + '">' + s.charAt(0) + s.slice(1).toLowerCase() + '</option>'; }).join('') + '</select></div>';
    $('#lq').oninput = function () { S.lq = this.value; paintLotRows(); };
    $('#ls').onchange = function () { S.ls = this.value; paintLotRows(); };
    paintLotRows();
  }
  function paintLotRows() {
    var q = (S.lq || '').toLowerCase(), st = S.ls || '';
    var canAdj = pageEdit('layering');
    var rows = S.lots.filter(function (x) {
      return (!st || x.Lot_Status === st) && (!q || [x.Lot_No, x.Lot_ID, x.Plan_ID, x.Category, x.Unit, x.Season].join(' ').toLowerCase().indexOf(q) >= 0);
    });
    if (!rows.length) { $('#lb').innerHTML = '<div class="card empty">' + (S.lots.length ? 'No match.' : 'No lots yet.') + '</div>'; return; }
    $('#lb').innerHTML = '<table><thead><tr><th>Lot</th><th>Plan</th><th>Category / Unit</th><th>Type</th><th>Width</th><th>Lot qty</th><th>Moved out</th><th>Adjusted</th><th>Balance</th><th>Stage</th><th>Days in stage</th><th>Status</th>' + (canAdj ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (x) {
        var live = x.Lot_Status === 'ACTIVE';
        return '<tr' + (x.Lot_Status === 'CANCELLED' ? ' style="opacity:.6"' : '') + '><td data-l="Lot"><b>' + esc(x.Lot_No) + '</b><div class="cellsub">' + esc(x.Lot_ID) + (x.Origin ? ' · from ' + esc(x.Origin) : '') + '</div></td>' +
          '<td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Season) + '</div></td>' +
          '<td data-l="Category / Unit">' + esc(x.Category) + (x.Sub_Type ? ' <span class="badge">' + esc(x.Sub_Type) + '</span>' : '') + '<div class="cellsub">' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Type">' + esc(x.Lot_Type === 'JOB_WORK' ? 'Job work' : x.Lot_Type === 'IRON_ONLY' ? 'Ironing only' : x.Lot_Type.charAt(0) + x.Lot_Type.slice(1).toLowerCase()) + (x.Lot_Source ? '<div class="cellsub">' + esc(srcName(x.Lot_Source)) + '</div>' : '') + '</td><td data-l="Width">' + esc(x.Fabric_Width || '-') + '</td><td data-l="Lot qty">' + fmtNum(x.Lot_Qty) + '</td><td data-l="Moved out">' + (x.Moved_Out ? fmtNum(x.Moved_Out) : '-') + '</td><td data-l="Adjusted">' + (x.Adj_Qty ? '<span style="color:var(--bad)">' + fmtNum(x.Adj_Qty) + '</span>' + (x.Adj_Reason ? '<div class="cellsub">' + esc(x.Adj_Reason) + '</div>' : '') : '-') + '</td><td data-l="Balance"><b>' + fmtNum(x.Balance) + '</b></td>' +
          '<td data-l="Stage">' + (live ? esc(STAGE[x.Current_Stage] || x.Current_Stage) + (x.Current_Stage === 'LAYERING' && !x.Started ? '<div class="cellsub">Not started</div>' : '') : '-') + '</td>' +
          '<td data-l="Days in stage">' + (x.DaysInStage == null ? '-' : x.DaysInStage) + '</td>' +
          '<td data-l="Status"><span class="badge ' + (live ? 'ok' : (x.Lot_Status === 'CANCELLED' ? 'off' : '')) + '">' + esc(x.Lot_Status.charAt(0) + x.Lot_Status.slice(1).toLowerCase()) + '</span></td>' +
          (canAdj ? '<td class="acts-td"><div class="acts">' + (x.Adj_Qty && (live || x.Lot_Status === 'CANCELLED') ? '<button class="btn sm ghost" data-ladj="' + esc(x.Lot_ID) + '" title="Change or undo the qty adjustment">Adjust</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
    $('#lb').onclick = function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-ladj'); if (!id) return;
      var x = S.lots.filter(function (z) { return z.Lot_ID === id; })[0]; if (!x) return;
      adjForm({ Lot_ID: x.Lot_ID, Lot_No: x.Lot_No, Lot_Qty: x.Lot_Qty, Moved_Out: x.Moved_Out, Adj: x.Adj_Qty, Adj_Reason: x.Adj_Reason, Laid: x.Laid }, function () { return api('lotList').then(function (r) { S.lots = r.rows; paintLotRows(); }); });
    };
  }

  /* ---------- lot split / club (cutting) ---------- */
  function viewConversion(el) {
    el.innerHTML = '<div class="page-h"><h2>Split / Club Lots</h2></div><div id="vh"></div><div id="vb"></div>';
    loadConv();
  }
  function loadConv() { return api('convList').then(function (r) { S.conv = r; paintConv(); }).catch(fail); }
  function lotLine(l, from) {
    return '<div>' + esc(l.Lot_No) + ' <span class="cellsub" style="display:inline">· ' + fmtNum(l.Qty) + ' pcs' +
      (from ? ' moved (lot ' + fmtNum(l.LotQty) + ')' : (l.Fabric_Width ? ' · ' + esc(l.Fabric_Width) : '')) + '</span></div>';
  }
  function paintConv() {
    var r = S.conv, rows = r.rows;
    $('#vh').innerHTML = '<div class="page-h"><div class="mhelp" style="flex:1;margin:0">Use this when part of a lot has a different fabric width. <b>Split</b> moves some pieces of a lot (not yet laid) into new lot(s); the original lot keeps its number and its balance goes down. <b>Club</b> moves pieces from two or more lots into one new lot. New lots start at layering.</div>' +
      (r.canWrite ? '<button class="btn" id="vsp">Split a lot</button><button class="btn ghost" id="vcl">Club lots</button>' : '') + '</div>';
    if (r.canWrite) { $('#vsp').onclick = function () { splitForm(); }; $('#vcl').onclick = function () { clubForm(); }; }
    if (!rows.length) { $('#vb').innerHTML = '<div class="card empty">No split or club done yet.</div>'; return; }
    $('#vb').innerHTML = '<table><thead><tr><th>Conversion</th><th>From lot(s)</th><th>To lot(s)</th><th>Plan</th><th>Status</th>' + (r.canWrite ? '<th></th>' : '') + '</tr></thead><tbody>' +
      rows.map(function (x) {
        var live = x.Status === 'ACTIVE';
        return '<tr data-unit="' + esc(x.Unit || '') + '"' + (live ? '' : ' style="opacity:.6"') + '><td data-l="Conversion"><b>' + esc(x.Conversion_ID) + '</b> <span class="badge ' + (x.Type === 'SPLIT' ? 'warn' : '') + '">' + (x.Type === 'SPLIT' ? 'Split' : 'Club') + '</span><div class="cellsub">' + esc(dfmt(x.Date)) + (x.Remarks ? ' · ' + esc(x.Remarks) : '') + '</div></td>' +
          '<td data-l="From">' + x.sources.map(function (l) { return lotLine(l, true); }).join('') + '</td><td data-l="To">' + x.news.map(function (l) { return lotLine(l, false); }).join('') + '</td>' +
          '<td data-l="Plan">' + esc(x.Plan_ID) + '<div class="cellsub">' + esc(x.Category) + ' · ' + esc(x.Unit) + '</div></td>' +
          '<td data-l="Status"><span class="badge ' + (live ? 'ok' : 'off') + '">' + (live ? 'Done' : 'Cancelled') + '</span></td>' +
          (r.canWrite ? '<td class="acts-td"><div class="acts">' + (x.canCancel ? '<button class="btn sm ghost" data-id="' + esc(x._id) + '">Cancel</button>' : '') + '</div></td>' : '') + '</tr>';
      }).join('') + '</tbody></table>';
    $('#vb').onclick = function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-id'); if (!id) return;
      var x = rows.filter(function (z) { return z._id === id; })[0]; if (!x) return;
      confirmBox('Cancel ' + x.Conversion_ID + '?', 'The new lot(s) (' + x.news.map(function (n) { return n.Lot_No; }).join(', ') + ') will be cancelled and the pieces return to the original lot(s).', 'Cancel conversion', true).then(function (ok) {
        if (!ok) return;
        api('convCancel', { id: id }).then(function () { toast('Conversion cancelled', 'ok'); return loadConv(); }).catch(fail);
      });
    };
  }
  function todayStr() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  function splitForm() {
    var lots = S.conv.lots || [];
    if (!lots.length) { toast('No lot has pieces left to move.', 'bad'); return; }
    openModal('<h3>Split a lot</h3><form id="sp"><label for="sp_l">Lot to split</label><select id="sp_l"><option value="">Select…</option>' +
      lots.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.label) + '</option>'; }).join('') + '</select>' +
      '<label>Pieces moving to new lot(s)</label><div id="sp_rows"></div><button type="button" class="btn sm ghost" id="sp_add" style="margin-top:8px">+ Add lot</button><div class="hint" id="sp_sum" style="margin-top:8px"></div>' +
      '<label for="sp_d">Date</label><input id="sp_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="sp_r">Remarks (optional)</label><input id="sp_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="sp_x">Cancel</button><button class="btn" type="submit">Split</button></div></form>',
      function () {
        var src = null;
        function row() {
          return '<div class="cv-row" style="display:grid;grid-template-columns:1.2fr .8fr 1fr auto;gap:6px;margin-bottom:6px"><input class="sp-no" placeholder="Lot no (auto)" maxlength="30">' +
            '<input class="sp-q" type="number" min="1" step="1" inputmode="numeric" placeholder="Qty"><input class="sp-w" placeholder="Width e.g. 57 in" maxlength="30">' +
            '<button type="button" class="btn sm ghost sp-rm" title="Remove">✕</button></div>';
        }
        function names() { Array.prototype.forEach.call(document.querySelectorAll('#sp_rows .cv-row'), function (r, i) { r.querySelector('.sp-no').placeholder = src && src.suggest[i] ? src.suggest[i] : 'Lot no (auto)'; }); }
        function sum() {
          var t = 0; Array.prototype.forEach.call(document.querySelectorAll('.sp-q'), function (q) { t += Number(q.value) || 0; });
          $('#sp_sum').innerHTML = !src ? 'Select a lot first.' : 'Moving <b>' + fmtNum(t) + '</b> of <b>' + fmtNum(src.qty) + '</b> movable pcs · <b>' + fmtNum(src.balance - t) + '</b> pcs stay in ' + esc(src.Lot_No) +
            (t > src.qty ? ' · <span style="color:var(--bad)">' + fmtNum(t - src.qty) + ' too many</span>' : '');
        }
        $('#sp_rows').innerHTML = row(); names(); sum();
        $('#sp_l').onchange = function () { var v = this.value; src = lots.filter(function (l) { return l.id === v; })[0] || null; names(); sum(); };
        searchSelect($('#sp_l'), 'Search lot no, plan, category…');
        $('#sp_add').onclick = function () { if (document.querySelectorAll('#sp_rows .cv-row').length >= 10) return; $('#sp_rows').insertAdjacentHTML('beforeend', row()); names(); };
        $('#sp_rows').oninput = sum;
        $('#sp_rows').onclick = function (e) { if (e.target.classList.contains('sp-rm') && document.querySelectorAll('#sp_rows .cv-row').length > 1) { e.target.parentNode.remove(); names(); sum(); } };
        $('#sp_x').onclick = closeModal;
        $('#sp').onsubmit = function (ev) {
          ev.preventDefault();
          if (!src) return toast('Select the lot to split', 'bad');
          var news = Array.prototype.map.call(document.querySelectorAll('#sp_rows .cv-row'), function (r) {
            return { Lot_No: r.querySelector('.sp-no').value, Qty: r.querySelector('.sp-q').value, Fabric_Width: r.querySelector('.sp-w').value };
          });
          api('convSave', { type: 'SPLIT', date: $('#sp_d').value, remarks: $('#sp_r').value, sources: [src.id], news: news }).then(function (res) {
            closeModal(); toast('Split done: ' + res.lots.map(function (l) { return l.Lot_No; }).join(', '), 'ok'); return loadConv();
          }).catch(fail);
        };
      });
  }
  function clubForm() {
    var lots = S.conv.lots || [];
    if (lots.length < 2) { toast('Need at least two lots with pieces left to club.', 'bad'); return; }
    openModal('<h3>Club lots</h3><form id="cl"><label>Lots to club (same plan, same washing) and pieces to take from each</label><input type="search" id="cl_q" class="ss-q" placeholder="Search lot no, plan, category…" autocomplete="off" aria-label="Search lots"><div class="hint ss-n" id="cl_qn"></div><div id="cl_list" style="max-height:240px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 10px">' +
      lots.map(function (l, i) {
        return '<div class="cl-row" style="display:flex;align-items:center;gap:8px;padding:6px 0"><label class="chk" style="flex:1;margin:0"><input type="checkbox" class="cl-c" data-i="' + i + '"> <span>' + esc(l.label) + '<span class="cellsub">' + esc(l.Plan_ID) + (l.washing ? ' · Washing' : '') + '</span></span></label>' +
          '<input class="cl-q" data-i="' + i + '" type="number" min="1" max="' + l.qty + '" step="1" inputmode="numeric" value="' + l.qty + '" style="width:90px;height:38px" disabled></div>';
      }).join('') + '</div>' +
      '<div class="hint" id="cl_sum" style="margin-top:8px">Select two or more lots.</div>' +
      '<label for="cl_n">New lot number (optional)</label><input id="cl_n" maxlength="30" autocomplete="off" placeholder="e.g. Lot-2A"><div class="hint">Leave blank to generate automatically.</div>' +
      '<label for="cl_w">Fabric width of the new lot</label><input id="cl_w" maxlength="30" autocomplete="off" placeholder="e.g. 57 in">' +
      '<label for="cl_d">Date</label><input id="cl_d" type="date" max="' + todayStr() + '" value="' + todayStr() + '">' +
      '<label for="cl_r">Remarks (optional)</label><input id="cl_r" maxlength="200" autocomplete="off">' +
      '<div class="row"><button type="button" class="btn ghost" id="cl_x">Cancel</button><button class="btn" type="submit">Club</button></div></form>',
      function () {
        var boxes = Array.prototype.slice.call(document.querySelectorAll('.cl-c'));
        function qin(i) { return document.querySelector('.cl-q[data-i="' + i + '"]'); }
        function picked() { return boxes.filter(function (b) { return b.checked; }).map(function (b) { var i = Number(b.getAttribute('data-i')); return { lot: lots[i], qty: Number(qin(i).value) || 0 }; }); }
        function refresh() {
          var p = picked(), first = p[0] && p[0].lot, t = 0;
          p.forEach(function (x) { t += x.qty; });
          boxes.forEach(function (b) {
            var i = Number(b.getAttribute('data-i')), l = lots[i];
            b.disabled = !b.checked && !!first && (l.Plan_ID !== first.Plan_ID || l.washing !== first.washing);
            qin(i).disabled = !b.checked;
          });
          $('#cl_sum').innerHTML = p.length ? p.length + ' lot(s) selected · new lot will have <b>' + fmtNum(t) + '</b> pcs' : 'Select two or more lots.';
          var ws = p.map(function (x) { return x.lot.width; }).filter(function (w, i, a) { return w && a.indexOf(w) === i; });
          if (ws.length === 1 && !$('#cl_w').getAttribute('data-touched')) $('#cl_w').value = ws[0];
        }
        $('#cl_w').oninput = function () { this.setAttribute('data-touched', '1'); };
        /* search: narrows the list; ticked lots always stay visible */
        $('#cl_q').onkeydown = function (e) { if (e.key === 'Enter') e.preventDefault(); };
        $('#cl_q').oninput = function () {
          var words = this.value.toLowerCase().split(/\s+/).filter(Boolean), n = 0;
          Array.prototype.forEach.call(document.querySelectorAll('#cl_list .cl-row'), function (r) {
            var on = r.querySelector('.cl-c').checked, ok = !words.length || words.every(function (w) { return r.textContent.toLowerCase().indexOf(w) >= 0; });
            r.style.display = ok || on ? '' : 'none'; if (ok) n++;
          });
          $('#cl_qn').textContent = words.length ? (n ? n + ' match' + (n === 1 ? '' : 'es') + ' (ticked lots stay in the list)' : 'No match') : '';
        };
        $('#cl_list').onchange = refresh; $('#cl_list').oninput = refresh;
        $('#cl_x').onclick = closeModal;
        $('#cl').onsubmit = function (ev) {
          ev.preventDefault();
          var p = picked(); if (p.length < 2) return toast('Select two or more lots', 'bad');
          api('convSave', { type: 'CLUB', date: $('#cl_d').value, remarks: $('#cl_r').value,
            sources: p.map(function (x) { return { Lot_ID: x.lot.id, Qty: x.qty }; }),
            news: [{ Lot_No: $('#cl_n').value, Fabric_Width: $('#cl_w').value }] }).then(function (res) {
            closeModal(); toast('Clubbed into ' + res.lots[0].Lot_No, 'ok'); return loadConv();
          }).catch(fail);
        };
      });
  }

  /* ---------- boot ---------- */
  var saved = store('pt_token');
  if (saved) {
    S.token = saved;
    api('me').then(function (d) { startSession({ user: d.user, menu: d.menu }); })
             .catch(function () { S.token = null; store('pt_token', null); renderLogin(); });
  } else renderLogin();
})();
