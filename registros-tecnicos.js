// registros-tecnicos.js — lado do navegador da tela /api/registros-tecnicos (fase 1: patch de RF).
// Os dados chegam em window.__RT (montado pelo servidor). Tudo é desenhado com createElement/textContent,
// nunca innerHTML com dado vindo da planilha.
(function () {
  'use strict';
  var RT = window.__RT;
  if (!RT) return;
  var M = RT.mapa, U = RT.usuario;
  var rows = RT.registros.slice();
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (k === 'class') n.className = attrs[k]; else n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }

  // ---------- mapa e estado ----------
  var sig = function (p) { var v = M.QIN[p.slice(0, 4)]; return v ? v[0] + ' ' + v[1] + ' ' + v[2] : ''; };
  var portLabel = function (p) { return M.QIN[p.slice(0, 4)] ? p + ' (' + sig(p) + ')' : p; };
  var shortLabel = function (p) { var v = M.QIN[p.slice(0, 4)]; return v ? p + ' ' + v[1] + ' ' + v[2] : p; };
  var dev = function (id) { return M.DEVICES.filter(function (d) { return d.id === id; })[0]; };
  var padrao = function (id, inp) { var d = dev(id); return d ? d.ins[inp - 1] : null; };
  var single = function (id) { var d = dev(id); return !!(d && d.ins.length === 1); };
  var dispName = function (id, inp) { return single(id) ? id : id + ' IN' + inp; };

  function atual() {
    var m = {};
    rows.filter(function (r) { return !r.removido; })
      .sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)) || a.linha - b.linha; })
      .forEach(function (r) { m[r.dispositivo + '|' + r.entrada] = { src: r.para, row: r }; });
    return m;
  }

  // ---------- datas (sempre em horário de Brasília) ----------
  var fmtDH = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  var fmt = function (iso) { var d = new Date(iso); return isNaN(d) ? String(iso) : fmtDH.format(d).replace(',', ''); };
  var diaBR = function (iso) { var d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d); };
  function agoraLocal() { var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); }

  // ---------- rack ----------
  function renderRack() {
    var cur = atual(), rack = $('rack'), fora = 0;
    rack.replaceChildren();
    M.UNITS.forEach(function (un) {
      var u = el('div', { class: 'unit' });
      var nm = el('div', { class: 'uname' }); nm.append(el('b', null, un.name), el('small', null, un.model)); u.append(nm);
      var js = el('div', { class: 'jacks' });
      for (var i = 0; i < 4; i++) {
        var pt = un.ports[i];
        if (!pt) { var e = el('div', { class: 'jack empty', 'aria-hidden': 'true' }); e.append(el('span', { class: 'ring' }), el('span', { class: 'in' }, '—'), el('span', { class: 'src' }, 'Sem uso')); js.append(e); continue; }
        var pd = padrao(pt.dev, pt.inp), c = cur[pt.dev + '|' + pt.inp], src = c ? c.src : pd, alt = src !== pd;
        if (alt) fora++;
        var b = el('button', { type: 'button', class: 'jack' + (alt ? ' alt' : ''), 'aria-label': dispName(pt.dev, pt.inp) + ': ' + portLabel(src) + (alt ? ', fora do padrão' : ', no padrão') });
        b.append(el('span', { class: 'ring' }), el('span', { class: 'in' }, pt.label), el('span', { class: 'src', title: portLabel(src) }, shortLabel(src)));
        if (alt) b.append(el('span', { class: 'pad', title: 'Padrão: ' + portLabel(pd) }, 'Padrão fora: ' + pd));
        if (U.isView) b.disabled = true;
        else b.addEventListener('click', (function (p) { return function () { $('disp').value = p.dev; fillInputs(); $('entrada').value = String(p.inp); syncFrom(); $('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('motivo').focus({ preventScroll: true }); }; })(pt));
        js.append(b);
      }
      u.append(js); rack.append(u);
    });
    var st = $('status');
    st.textContent = fora === 0 ? 'Todas as ' + M.TOTAL + ' entradas estão no padrão' : fora === 1 ? '1 entrada está fora do padrão' : fora + ' entradas estão fora do padrão';
    st.className = 'status ' + (fora === 0 ? 'ok' : 'bad');
    return fora;
  }

  // ---------- formulário ----------
  function fillSelect(sel, items, blank) {
    sel.replaceChildren();
    if (blank) sel.append(el('option', { value: '' }, blank));
    items.forEach(function (it) { sel.append(el('option', { value: it[0] }, it[1])); });
  }
  var portItems = function () {
    return M.PORTS.map(function (p) { return [p, portLabel(p)]; }).concat([[M.DISCONNECTED, M.DISCONNECTED], [M.OTHER, M.OTHER]]);
  };
  function fillInputs() {
    var d = dev($('disp').value);
    fillSelect($('entrada'), d ? d.ins.map(function (_, i) { return [String(i + 1), d.ins.length === 1 ? 'Entrada RF' : 'IN' + (i + 1)]; }) : []);
  }
  function syncFrom() {
    var id = $('disp').value, inp = +$('entrada').value, pd = padrao(id, inp);
    if (!pd) return;
    var c = atual()[id + '|' + inp], src = c ? c.src : pd;
    $('de').value = src;
    $('de-hint').textContent = src === pd ? 'Está no padrão do mapa.' : 'Padrão do mapa: ' + portLabel(pd);
    $('para-hint').textContent = 'Padrão do mapa: ' + portLabel(pd);
  }
  function setMsg(t, kind) { var m = $('msg'); if (m) { m.textContent = t; m.className = 'msg ' + (kind || ''); } }

  async function chamar(action, corpo) {
    var r = await fetch('/api/registros-tecnicos?action=' + action, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}) });
    var j = {};
    try { j = await r.json(); } catch (e) { /* resposta sem JSON */ }
    if (!r.ok) throw new Error(j.error || 'Erro ' + r.status);
    return j;
  }

  function initForm() {
    if (U.isView) return;
    fillSelect($('disp'), M.DEVICES.map(function (d) { return [d.id, d.id + ' (' + d.model + ')']; }));
    fillSelect($('de'), portItems());
    fillSelect($('para'), portItems(), 'Selecione');
    fillSelect($('tipo'), M.TIPOS.map(function (t) { return [t, t]; }));
    fillInputs();
    $('quando').value = agoraLocal();
    syncFrom();
    $('disp').addEventListener('change', function () { fillInputs(); syncFrom(); });
    $('entrada').addEventListener('change', syncFrom);

    $('form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var quando = $('quando').value, para = $('para').value, motivo = $('motivo').value.trim();
      if (!quando) { setMsg('Informe a data e a hora da alteração.', 'err'); return; }
      if (!para) { setMsg('Selecione a nova conexão.', 'err'); $('para').focus(); return; }
      if (!motivo) { setMsg('Informe o motivo da alteração.', 'err'); $('motivo').focus(); return; }
      if (para === $('de').value) { setMsg('A nova conexão é igual à anterior. Escolha outra ou ajuste a conexão anterior.', 'err'); return; }
      $('salvar').disabled = true; setMsg('Salvando…');
      try {
        var j = await chamar('registrar', {
          ts: new Date(quando).toISOString(), dispositivo: $('disp').value, entrada: +$('entrada').value,
          de: $('de').value, para: para, tipo: $('tipo').value, motivo: motivo, obs: $('obs').value.trim(),
        });
        rows = rows.concat(j.registros);
        setMsg('Alteração registrada.', 'ok');
        $('motivo').value = ''; $('obs').value = ''; $('para').value = ''; $('tipo').selectedIndex = 0; $('quando').value = agoraLocal();
        renderRack(); syncFrom(); renderTable();
      } catch (e) { setMsg(e.message, 'err'); }
      finally { $('salvar').disabled = false; }
    });

    // normalizar: confirmação em duas etapas na própria tela
    var pronto = false;
    function cancelaNorm() { pronto = false; $('padrao').textContent = 'Normalizar ao padrão'; $('padrao-cancel').hidden = true; }
    $('padrao-cancel').addEventListener('click', function () { cancelaNorm(); setMsg(''); });
    $('padrao').addEventListener('click', async function () {
      var n = renderRack();
      if (!n) { setMsg('Todas as entradas já estão no padrão do mapa oficial.', 'ok'); return; }
      if (!pronto) {
        pronto = true; $('padrao').textContent = 'Confirmar: normalizar ' + (n === 1 ? '1 entrada' : n + ' entradas');
        $('padrao-cancel').hidden = false; setMsg(''); return;
      }
      $('padrao').disabled = true; $('salvar').disabled = true; setMsg('Normalizando…');
      try {
        var j = await chamar('normalizar');
        rows = rows.concat(j.registros);
        setMsg(j.registros.length ? 'Mapa normalizado: ' + j.registros.length + (j.registros.length === 1 ? ' entrada' : ' entradas') + ' de volta ao padrão.' : 'Nada a normalizar.', 'ok');
        renderRack(); syncFrom(); renderTable();
      } catch (e) { setMsg(e.message, 'err'); }
      finally { cancelaNorm(); $('padrao').disabled = false; $('salvar').disabled = false; }
    });
  }

  // ---------- histórico ----------
  var LIMITE = 300;
  function filtradas() {
    var t = $('f-tec').value.trim().toLowerCase(), d = $('f-disp').value, de = $('f-de').value, ate = $('f-ate').value;
    return rows.filter(function (r) {
      if (r.removido) return false;
      if (t && r.tecnico.toLowerCase().indexOf(t) === -1) return false;
      if (d && r.dispositivo !== d) return false;
      var dia = diaBR(r.ts);
      if (de && dia < de) return false;
      if (ate && dia > ate) return false;
      return true;
    }).sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)) || b.linha - a.linha; });
  }
  function renderTable() {
    var tb = $('tbody'), list = filtradas();
    tb.replaceChildren();
    if (!list.length) {
      var tr = el('tr'), td = el('td', { class: 'empty-state', colspan: U.isGestor ? '8' : '7' }, rows.some(function (r) { return !r.removido; }) ? 'Nenhum registro com esses filtros.' : 'Nenhuma alteração registrada ainda.');
      tr.append(td); tb.append(tr); $('trunc').textContent = ''; return;
    }
    list.slice(0, LIMITE).forEach(function (r) {
      var tr = el('tr');
      var tipo = el('td'); tipo.append(el('span', { class: 'tag' + (r.tipo === 'Normalização ao padrão' ? ' norm' : '') }, r.tipo));
      var mot = el('td', null, r.motivo); if (r.obs) { mot.append(el('br'), el('small', { style: 'color:var(--text3)' }, r.obs)); }
      tr.append(el('td', null, fmt(r.ts)), el('td', null, r.tecnico), el('td', null, dispName(r.dispositivo, r.entrada)),
        el('td', null, portLabel(r.de)), el('td', null, portLabel(r.para)), tipo, mot);
      if (U.isGestor) {
        var ac = el('td'), b = el('button', { type: 'button', class: 'mini' }, 'Remover'), armado = false, timer;
        b.addEventListener('click', async function () {
          if (!armado) { armado = true; b.textContent = 'Confirmar?'; timer = setTimeout(function () { armado = false; b.textContent = 'Remover'; }, 4000); return; }
          clearTimeout(timer); b.disabled = true; b.textContent = '…';
          try {
            var j = await chamar('remover', { linha: r.linha, ts: r.ts, dispositivo: r.dispositivo, entrada: r.entrada });
            r.removido = j.removido || 'sim'; renderRack(); if (!U.isView) syncFrom(); renderTable();
          } catch (e) { b.disabled = false; armado = false; b.textContent = 'Remover'; alert(e.message); }
        });
        ac.append(b); tr.append(ac);
      }
      tb.append(tr);
    });
    $('trunc').textContent = list.length > LIMITE ? 'Mostrando os ' + LIMITE + ' mais recentes de ' + list.length + '. Use os filtros ou o CSV pra ver o resto.' : '';
  }

  // ---------- CSV ----------
  function csvCel(v) {
    var s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita fórmula ao abrir no Excel
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  $('csv').addEventListener('click', function () {
    var cab = ['Data e hora', 'Técnico', 'Dispositivo', 'Entrada', 'De', 'Para', 'Tipo', 'Motivo', 'Observações'];
    var linhas = filtradas().map(function (r) {
      return [fmt(r.ts), r.tecnico, r.dispositivo, single(r.dispositivo) ? 'Entrada RF' : 'IN' + r.entrada, portLabel(r.de), portLabel(r.para), r.tipo, r.motivo, r.obs].map(csvCel).join(',');
    });
    var csv = '\uFEFF' + [cab.join(',')].concat(linhas).join('\r\n');
    var a = el('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'patch_rf_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  });

  // ---------- início ----------
  fillSelect($('f-disp'), M.DEVICES.map(function (d) { return [d.id, d.id]; }), 'Todos');
  ['f-tec', 'f-disp', 'f-de', 'f-ate'].forEach(function (id) { $(id).addEventListener('input', renderTable); });
  initForm();
  renderRack();
  renderTable();
})();
