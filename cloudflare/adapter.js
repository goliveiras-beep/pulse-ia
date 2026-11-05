// cloudflare/adapter.js — traduz Request/Response da Web (Cloudflare Workers) para o formato
// (req, res) estilo Node/Vercel que todos os handlers de api/ e lib/routes/ já usam.
// Só implementa o que o código realmente chama (levantado por grep): req.method/query/body/headers,
// req como async iterable (corpo bruto, multipart/Slack), res.status/setHeader/json/send/redirect/end.

function lerQuery(url) {
  const q = {};
  for (const [k, v] of url.searchParams) {
    if (k in q) q[k] = [].concat(q[k], v);
    else q[k] = v;
  }
  return q;
}

function parsearCorpo(tipo, buf) {
  const t = (tipo || '').toLowerCase();
  const texto = () => buf.toString('utf8');
  if (t.includes('application/json')) {
    try { return JSON.parse(texto() || 'null') ?? {}; } catch { return {}; }
  }
  if (t.includes('application/x-www-form-urlencoded')) {
    const o = {};
    for (const [k, v] of new URLSearchParams(texto())) o[k] = k in o ? [].concat(o[k], v) : v;
    return o;
  }
  if (t.startsWith('text/')) return texto();
  return undefined;
}

export async function criarReqRes(request, { extraQuery = {}, bodyParser = true } = {}) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

  const temCorpo = !['GET', 'HEAD'].includes(request.method);
  const bruto = temCorpo ? Buffer.from(await request.arrayBuffer()) : Buffer.alloc(0);

  const req = {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    query: { ...lerQuery(url), ...extraQuery },
    body: temCorpo && bodyParser ? parsearCorpo(headers['content-type'], bruto) : undefined,
    async *[Symbol.asyncIterator]() { if (bruto.length) yield bruto; },
  };

  const estado = { status: 200, headers: new Headers(), cookies: [], corpo: null };
  const minusculo = (n) => String(n).toLowerCase();

  const res = {
    get statusCode() { return estado.status; },
    set statusCode(c) { estado.status = c; },
    status(c) { estado.status = c; return res; },
    setHeader(n, v) {
      if (minusculo(n) === 'set-cookie') estado.cookies = [].concat(v);
      else estado.headers.set(n, Array.isArray(v) ? v.join(', ') : String(v));
      return res;
    },
    getHeader(n) {
      return minusculo(n) === 'set-cookie' ? estado.cookies : estado.headers.get(n) ?? undefined;
    },
    writeHead(c, h) { estado.status = c; if (h) for (const k in h) res.setHeader(k, h[k]); return res; },
    write(c) {
      const atual = estado.corpo == null ? Buffer.alloc(0) : Buffer.from(estado.corpo);
      estado.corpo = Buffer.concat([atual, Buffer.from(c)]);
      return true;
    },
    end(c) { if (c !== undefined && c !== null) res.write(c); return res; },
    send(c) {
      if (c !== null && typeof c === 'object' && !Buffer.isBuffer(c) && !(c instanceof Uint8Array)) return res.json(c);
      if (typeof c === 'string' && !estado.headers.has('content-type')) {
        estado.headers.set('content-type', 'text/html; charset=utf-8');
      }
      estado.corpo = c ?? null;
      return res;
    },
    json(o) {
      if (!estado.headers.has('content-type')) estado.headers.set('content-type', 'application/json; charset=utf-8');
      estado.corpo = JSON.stringify(o);
      return res;
    },
    redirect(a, b) {
      const [codigo, destino] = typeof a === 'number' ? [a, b] : [307, a];
      estado.status = codigo;
      estado.headers.set('location', destino);
      return res;
    },
  };

  const montarResposta = () => {
    const h = new Headers(estado.headers);
    for (const c of estado.cookies) h.append('set-cookie', c);
    const semCorpo = [101, 204, 205, 304].includes(estado.status) || request.method === 'HEAD';
    return new Response(semCorpo ? null : estado.corpo, { status: estado.status, headers: h });
  };

  return { req, res, montarResposta };
}
