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
      var tecnico = $('tecnico').value;
      if (!tecnico) { setMsg('Selecione o técnico responsável.', 'err'); $('tecnico').focus(); return; }
      if (!quando) { setMsg('Informe a data e a hora da alteração.', 'err'); return; }
      if (!para) { setMsg('Selecione a nova conexão.', 'err'); $('para').focus(); return; }
      if (!motivo) { setMsg('Informe o motivo da alteração.', 'err'); $('motivo').focus(); return; }
      if (para === $('de').value) { setMsg('A nova conexão é igual à anterior. Escolha outra ou ajuste a conexão anterior.', 'err'); return; }
      $('salvar').disabled = true; setMsg('Salvando…');
      try {
        var j = await chamar('registrar', {
          tecnico: tecnico, ts: new Date(quando).toISOString(), dispositivo: $('disp').value, entrada: +$('entrada').value,
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
      if (!$('tecnico').value) { setMsg('Selecione o técnico responsável antes de normalizar.', 'err'); $('tecnico').focus(); return; }
      if (!pronto) {
        pronto = true; $('padrao').textContent = 'Confirmar: normalizar ' + (n === 1 ? '1 entrada' : n + ' entradas');
        $('padrao-cancel').hidden = false; setMsg(''); return;
      }
      $('padrao').disabled = true; $('salvar').disabled = true; setMsg('Normalizando…');
      try {
        var j = await chamar('normalizar', { tecnico: $('tecnico').value });
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
      var tr = el('tr'), td = el('td', { class: 'empty-state', colspan: U.isGestor ? '9' : '8' }, rows.some(function (r) { return !r.removido; }) ? 'Nenhum registro com esses filtros.' : 'Nenhuma alteração registrada ainda.');
      tr.append(td); tb.append(tr); $('trunc').textContent = ''; return;
    }
    list.slice(0, LIMITE).forEach(function (r) {
      var tr = el('tr');
      var tipo = el('td'); tipo.append(el('span', { class: 'tag' + (r.tipo === 'Normalização ao padrão' ? ' norm' : '') }, r.tipo));
      var mot = el('td', null, r.motivo); if (r.obs) { mot.append(el('br'), el('small', { style: 'color:var(--text3)' }, r.obs)); }
      tr.append(el('td', null, fmt(r.ts)), el('td', null, r.tecnico), el('td', null, dispName(r.dispositivo, r.entrada)),
        el('td', null, portLabel(r.de)), el('td', null, portLabel(r.para)), tipo, mot, el('td', null, r.registradoPor || '—'));
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
    var cab = ['Data e hora', 'Técnico', 'Dispositivo', 'Entrada', 'De', 'Para', 'Tipo', 'Motivo', 'Observações', 'Registrado por'];
    var linhas = filtradas().map(function (r) {
      return [fmt(r.ts), r.tecnico, r.dispositivo, single(r.dispositivo) ? 'Entrada RF' : 'IN' + r.entrada, portLabel(r.de), portLabel(r.para), r.tipo, r.motivo, r.obs, r.registradoPor || ''].map(csvCel).join(',');
    });
    var csv = '\uFEFF' + [cab.join(',')].concat(linhas).join('\r\n');
    var a = el('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    a.download = 'patch_rf_' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
  });

  // ---------- mapa atual em Word (.docx) ----------
  // Mesmo documento do artefato original "Registro de alterações do patch de RF": situação atual do patch,
  // registro mais recente, entradas fora do padrão e as quatro tabelas de referência. Gerado no navegador
  // com a biblioteca docx (jsDelivr, permitida pela política de segurança da página).
  var docxPromise = null;
  function loadDocx() {
    if (window.docx) return Promise.resolve(window.docx);
    if (!docxPromise) docxPromise = new Promise(function (res) {
      var sc = document.createElement('script');
      sc.src = 'https://cdn.jsdelivr.net/npm/docx@9.6.1/dist/index.iife.js';
      sc.onload = function () { res(window.docx || null); };
      sc.onerror = function () { docxPromise = null; res(null); };
      document.head.appendChild(sc);
    });
    return docxPromise;
  }
  var PRIO = { SES14: 'Alta', AMZ3: 'Alta', IS35e: 'Média', IS34: 'Baixa', D2: 'Baixa' };
  var PFILL = { Alta: 'F4B6B6', 'Média': 'FFE699', Baixa: 'E7E6E6' };
  var ALTFILL = 'C0392B', MOMFILL = 'F1C232', RESFILL = 'F8CBAD';
  var satOf = function (p) { var v = M.QIN[String(p).slice(0, 4)]; return v ? v[1] : null; };
  var destName = function (id, inp) { return single(id) ? id : id + '-IN' + inp; };
  // Versão do documento: começa em 3 e sobe 1 a cada registro novo (mesma numeração do artefato original).
  function versaoDoc() { return Math.max(3, 1 + rows.filter(function (r) { return !r.removido; }).length); }
  var nomeDoc = function (v) { return 'Mapa_Patch_RF_CPD_VERSAO_FINAL ' + v + '.docx'; };

  async function montarDocx() {
    var D = await loadDocx(); if (!D) return null;
    var cur = atual();
    var srcOf = function (id, i) { var c = cur[id + '|' + i]; return c ? c.src : padrao(id, i); };
    var destNow = {}, destDef = {};
    M.DEVICES.forEach(function (d) {
      d.ins.forEach(function (pd, k) {
        var lab = destName(d.id, k + 1);
        (destDef[pd] = destDef[pd] || []).push(lab);
        var sn = srcOf(d.id, k + 1);
        (destNow[sn] = destNow[sn] || []).push(lab);
      });
    });
    var W = 15398 - 1440;
    var brd = { style: D.BorderStyle.SINGLE, size: 4, color: '999999' };
    var borders = { top: brd, bottom: brd, left: brd, right: brd };
    var cell = function (text, w, o) {
      o = o || {};
      return new D.TableCell({
        width: { size: w, type: D.WidthType.DXA }, borders: borders,
        shading: o.fill ? { fill: o.fill, type: D.ShadingType.CLEAR, color: 'auto' } : undefined,
        margins: { top: 50, bottom: 50, left: 70, right: 70 },
        children: String(text).split('\n').map(function (l) {
          return new D.Paragraph({ alignment: D.AlignmentType.CENTER, children: [new D.TextRun({ text: l, bold: o.bold, color: o.color, size: o.size || 17, font: 'Arial' })] });
        }),
      });
    };
    var table = function (headers, body, ratios) {
      var sum = ratios.reduce(function (a, b) { return a + b; }, 0);
      var ws = ratios.map(function (r) { return Math.floor(W * r / sum); });
      ws[ws.length - 1] += W - ws.reduce(function (a, b) { return a + b; }, 0);
      return new D.Table({
        width: { size: W, type: D.WidthType.DXA }, columnWidths: ws,
        rows: [new D.TableRow({ tableHeader: true, children: headers.map(function (h, i) { return cell(h, ws[i], { fill: '1F3864', bold: true, color: 'FFFFFF' }); }) })]
          .concat(body.map(function (r) { return new D.TableRow({ children: r.map(function (x, i) { return typeof x === 'object' ? cell(x.t, ws[i], x) : cell(x, ws[i]); }) }); })),
      });
    };
    var P = function (t, o) { return new D.Paragraph({ spacing: { after: 100 }, children: [new D.TextRun(Object.assign({ text: t, font: 'Arial', size: 20 }, o || {}))] }); };
    var H = function (t) { return new D.Paragraph({ heading: D.HeadingLevel.HEADING_1, spacing: { before: 280, after: 140 }, children: [new D.TextRun({ text: t })] }); };
    var pc = function (p) { return { t: p, fill: PFILL[p], bold: true }; };
    var ALT = { fill: ALTFILL, bold: true, color: 'FFFFFF' }, MOM = { fill: MOMFILL, bold: true, color: '1B2631' };

    // registro mais recente (ou aviso, se ainda não há nenhum)
    var ativos = rows.filter(function (r) { return !r.removido; })
      .sort(function (a, b) { return String(b.ts).localeCompare(String(a.ts)) || b.linha - a.linha; });
    var tr = ativos[0] || { nota: 'Nenhuma alteração registrada ainda. O mapa abaixo é o padrão oficial.', titulo: 'Situação atual' };
    var resumo = tr.nota ? P(tr.nota) : table(['Campo', 'Valor'], [
      ['Dispositivo / entrada', dispName(tr.dispositivo, tr.entrada)],
      ['Conexão anterior', portLabel(String(tr.de || ''))],
      [{ t: 'Nova conexão', bold: true }, Object.assign({ t: portLabel(String(tr.para || '')) }, tr.para !== padrao(tr.dispositivo, tr.entrada) ? MOM : { bold: true })],
      ['Padrão do mapa', Object.assign({ t: portLabel(String(padrao(tr.dispositivo, tr.entrada) || '')) }, tr.para !== padrao(tr.dispositivo, tr.entrada) ? ALT : {})],
      ['Tipo', tr.tipo],
      ['Técnico responsável', tr.tecnico], ['Data e hora da alteração', fmt(tr.ts)], ['Motivo', tr.motivo + (tr.obs ? '\n' + tr.obs : '')],
    ], [1, 3]);

    var offRows = [];
    M.DEVICES.forEach(function (d) {
      d.ins.forEach(function (pd, k) {
        var c = cur[d.id + '|' + (k + 1)];
        if (c && c.src !== pd) offRows.push([{ t: dispName(d.id, k + 1), bold: true }, Object.assign({ t: portLabel(pd) }, ALT), Object.assign({ t: portLabel(c.src) }, MOM), c.row.tecnico || '', fmt(c.row.ts)]);
      });
    });
    var ants = [['RX02', 'SES14', 'L / R', 'Q1 · E3 / E4'], ['RX03', 'SES14', 'L / R', 'Q2 · E1 / E2'], ['RX06', 'AMZ3', 'V / H', 'Q3 · E3 / E4'],
      ['RX01', 'IS35e', 'L / R', 'Q1 · E1 / E2'], ['RX04', 'IS34', 'V / H', 'Q2 · E3 / E4'], ['RX05', 'D2', 'V / H', 'Q3 · E1 / E2']]
      .map(function (a) { return [{ t: a[0], bold: true }, a[1], a[2], pc(PRIO[a[1]]), a[3]]; });

    var qRows = [];
    ['Q1', 'Q2', 'Q3'].forEach(function (q) {
      for (var e = 1; e <= 4; e++) {
        var v = M.QIN[q + '-' + e];
        var row = [{ t: q, bold: true }, String(e), v[0] + ' · ' + v[1] + ' ' + v[2], pc(PRIO[v[1]])];
        for (var o = 1; o <= 4; o++) {
          var port = q + '-' + e + '.' + o;
          var nowL = destNow[port] || [], wasL = destDef[port] || [];
          var now = nowL.join(', '), was = wasL.join(', ');
          if (now !== was) {
            var gained = nowL.some(function (x) { return wasL.indexOf(x) === -1; });
            row.push(Object.assign({ t: (now || 'RESERVA') + (was ? '\n(padrão: ' + was + ')' : '\n(padrão: reserva)') }, gained ? MOM : ALT));
          } else row.push(now ? { t: now, fill: PFILL[PRIO[v[1]]] } : { t: 'RESERVA', fill: RESFILL, bold: true });
        }
        qRows.push(row);
      }
    });
    var rRows = M.UNITS.map(function (un) {
      var row = [{ t: un.name, bold: true }, un.model];
      for (var i = 0; i < 4; i++) {
        var pt = un.ports[i];
        if (!pt) { row.push('–'); continue; }
        var pd = padrao(pt.dev, pt.inp), sn = srcOf(pt.dev, pt.inp), v = M.QIN[String(sn).slice(0, 4)];
        var pre = pt.label.indexOf('IN') === 0 ? '' : pt.label + '\n';
        var txt = pre + (v ? sn + '\n' + v[1] + ' ' + v[2] + ' (' + v[0] + ')' : sn);
        row.push(sn !== pd ? Object.assign({ t: txt + '\n(padrão fora: ' + pd + ')' }, MOM) : { t: txt, fill: v ? PFILL[PRIO[v[1]]] : undefined });
      }
      return row;
    });
    var cap = [], tMK = 0, tDR = 0, tNS = 0, tRes = 0;
    ['SES14', 'AMZ3', 'IS35e', 'IS34', 'D2'].forEach(function (st) {
      var mk = 0, ns = 0, drIn = 0, drs = {};
      M.DEVICES.forEach(function (d) {
        d.ins.forEach(function (_, k) {
          var sn = srcOf(d.id, k + 1); if (satOf(sn) !== st) return;
          if (d.id.indexOf('MK') === 0) mk++; else if (d.id.indexOf('DEMOD') === 0) ns++; else { drs[d.id] = 1; drIn++; }
        });
      });
      var nIrd = Object.keys(drs).length;
      var res = M.PORTS.filter(function (p) { return satOf(p) === st && !(destNow[p] || []).length; }).length;
      tMK += mk; tDR += drIn; tNS += ns; tRes += res;
      var drList = Object.keys(drs).sort().map(function (x) { return x.replace('IRD', ''); }).join(', ');
      cap.push([{ t: st, bold: true }, pc(PRIO[st]), mk ? String(mk) : '–', nIrd ? nIrd + ' (IRD' + drList + ')' : '–', ns ? String(ns) : '–', { t: String(mk + nIrd + ns), bold: true }, String(res)]);
    });
    cap.push([{ t: 'Total', bold: true }, '', { t: String(tMK), bold: true }, { t: tDR + ' entradas', bold: true }, { t: String(tNS), bold: true }, '', { t: String(tRes), bold: true }]);
    var legend = table(['Prioridade', 'Alta', 'Média', 'Baixa', 'Reserva', 'Alterado', 'Alterado'], [[{ t: 'Cor', bold: true }, { t: 'SES14 · AMZ3', fill: PFILL.Alta }, { t: 'IS35e', fill: PFILL['Média'] }, { t: 'IS34 · D2', fill: PFILL.Baixa }, { t: 'Saída livre', fill: RESFILL }, Object.assign({ t: 'Padrão que saiu' }, ALT), Object.assign({ t: 'Alterada no momento' }, MOM)]], [1, 1, 1, 1, 1, 1, 1]);

    var logoBytes = null;
    try { var rl = await fetch('/antenas-logo.png'); if (rl.ok) logoBytes = new Uint8Array(await rl.arrayBuffer()); } catch (e) { /* sem logo, o documento sai igual */ }
    var versao = versaoDoc();
    var doc = new D.Document({
      styles: { default: { document: { run: { font: 'Arial', size: 20 } } }, paragraphStyles: [{ id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, color: '1F3864', font: 'Arial' }, paragraph: { outlineLevel: 0 } }] },
      sections: [{
        properties: { page: { size: { width: 11906, height: 16838, orientation: D.PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
        headers: logoBytes ? { default: new D.Header({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.ImageRun({ type: 'png', data: logoBytes, transformation: { width: 110, height: 59 } })] })] }) } : undefined,
        footers: { default: new D.Footer({ children: [new D.Paragraph({ alignment: D.AlignmentType.RIGHT, children: [new D.TextRun({ text: 'Patch de RF – CPD · pág. ', size: 16, color: '888888' }), new D.TextRun({ children: [D.PageNumber.CURRENT], size: 16, color: '888888' })] })] }) },
        children: [
          new D.Paragraph({ spacing: { after: 80 }, children: [new D.TextRun({ text: 'Mapa de Conexões – Patch de RF do CPD · Versão final ' + versao, bold: true, size: 36, color: '1F3864' })] }),
          P(offRows.length ? 'Situação atual do patch, gerada em ' + fmt(new Date().toISOString()) + '. O último registro está logo abaixo.' : 'Mapa oficial padrão, gerado em ' + fmt(new Date().toISOString()) + '. Todas as entradas estão no padrão.', { color: '555555' }),
          P('Notação: Q1-3.2 = Quintech 1, entrada 3, saída 2.', { bold: true }),
          legend,
          H(tr.titulo || (tr.tipo === 'Normalização ao padrão' ? 'Normalização ao padrão registrada' : 'Último registro')), resumo,
          H('Entradas fora do padrão'),
          offRows.length ? table(['Entrada', 'Padrão que saiu', 'Conexão alterada no momento', 'Técnico', 'Desde'], offRows, [1, 1.6, 1.6, 1.2, 1.1]) : P('Nenhuma. Todas as ' + M.TOTAL + ' entradas estão no padrão do mapa oficial.'),
          H('1. Antenas, satélites e prioridade'), table(['Antena', 'Satélite', 'Polarização', 'Prioridade', 'Quintech / entradas'], ants, [1, 1, 1, 1, 1.4]),
          H('2. Mapa por Quintech'), table(['Quintech', 'Entrada', 'Sinal', 'Prioridade', 'Saída 1', 'Saída 2', 'Saída 3', 'Saída 4'], qRows, [0.8, 0.7, 1.6, 0.9, 1.2, 1.2, 1.2, 1.2]),
          H('3. Mapa por receptor'), table(['Receptor', 'Fabricante', 'Porta 1', 'Porta 2', 'Porta 3', 'Porta 4'], rRows, [0.9, 1.1, 1.3, 1.3, 1.3, 1.3]),
          H('4. Capacidade por satélite'), table(['Satélite', 'Prioridade', 'MK (MediaKind)', 'IRD (DR5000)', 'DEMOD (Novelsat)', 'Máx. simultâneo', 'Reservas'], cap, [1, 1, 1, 1.6, 1, 1.2, 1]),
        ],
      }],
    });
    return { blob: await D.Packer.toBlob(doc), nome: nomeDoc(versao) };
  }
  $('mapa').addEventListener('click', async function () {
    var b = $('mapa'); b.disabled = true; var antes = b.textContent; b.textContent = 'Gerando…';
    try {
      var r = await montarDocx();
      if (!r) { alert('Não foi possível gerar o Word agora. Verifique a conexão e tente de novo.'); return; }
      var a = el('a'); a.href = URL.createObjectURL(r.blob); a.download = r.nome;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    } catch (e) { alert('Não foi possível gerar o Word: ' + e.message); }
    finally { b.disabled = false; b.textContent = antes; }
  });

  // ---------- início ----------
  fillSelect($('f-disp'), M.DEVICES.map(function (d) { return [d.id, d.id]; }), 'Todos');
  ['f-tec', 'f-disp', 'f-de', 'f-ate'].forEach(function (id) { $(id).addEventListener('input', renderTable); });
  initForm();
  renderRack();
  renderTable();
})();
