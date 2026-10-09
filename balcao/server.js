import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';

const raiz = path.dirname(fileURLToPath(import.meta.url));
const PORTA = Number(process.env.PORT) || 3000;
const DADOS = process.env.DATA_DIR || path.join(raiz, 'dados');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const WHATS_PLATAFORMA = String(process.env.PLATAFORMA_WHATSAPP || '').replace(/\D/g, '');
const DIAS_TESTE = Number(process.env.DIAS_TESTE) || 7;
const BASE_URL = (process.env.BASE_URL || '').replace(/\/$/, '');

fs.mkdirSync(DADOS, { recursive: true });
const db = new DatabaseSync(path.join(DADOS, 'balcao.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, nome TEXT NOT NULL,
  senha_hash TEXT NOT NULL, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lojas (
  id INTEGER PRIMARY KEY, usuario_id INTEGER UNIQUE NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  slug TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, whatsapp TEXT NOT NULL,
  descricao TEXT NOT NULL DEFAULT '', endereco TEXT NOT NULL DEFAULT '', horario TEXT NOT NULL DEFAULT '',
  instagram TEXT NOT NULL DEFAULT '', cor TEXT NOT NULL DEFAULT '#E4572E', tema TEXT NOT NULL DEFAULT 'claro',
  fonte TEXT NOT NULL DEFAULT 'moderna', logo_id TEXT, banner_id TEXT,
  taxa_entrega INTEGER NOT NULL DEFAULT 0, pedido_minimo INTEGER NOT NULL DEFAULT 0, tempo TEXT NOT NULL DEFAULT '',
  pagamentos TEXT NOT NULL DEFAULT '["pix","cartao","dinheiro"]',
  entrega INTEGER NOT NULL DEFAULT 1, retirada INTEGER NOT NULL DEFAULT 1,
  aberta INTEGER NOT NULL DEFAULT 1, ativa INTEGER NOT NULL DEFAULT 1,
  vencimento TEXT NOT NULL, criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categorias (
  id INTEGER PRIMARY KEY, loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, ordem INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY, loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES categorias(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', preco INTEGER NOT NULL,
  imagem_id TEXT, adicionais TEXT NOT NULL DEFAULT '[]', disponivel INTEGER NOT NULL DEFAULT 1,
  ordem INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pedidos (
  id INTEGER PRIMARY KEY, loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL, cliente TEXT NOT NULL, telefone TEXT NOT NULL, tipo TEXT NOT NULL,
  endereco TEXT NOT NULL DEFAULT '', pagamento TEXT NOT NULL, troco TEXT NOT NULL DEFAULT '',
  obs TEXT NOT NULL DEFAULT '', itens TEXT NOT NULL, subtotal INTEGER NOT NULL, taxa INTEGER NOT NULL,
  total INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'novo', criado_em TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS imagens (
  id TEXT PRIMARY KEY, loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  mime TEXT NOT NULL, dados BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS redefinicoes (
  token TEXT PRIMARY KEY, usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pedidos_loja ON pedidos(loja_id, id);
CREATE INDEX IF NOT EXISTS idx_produtos_loja ON produtos(loja_id, categoria_id);
`);

/* migrações simples: bancos criados antes de uma nova coluna ganham a coluna ao iniciar */
function garantirColuna(tabela, coluna, definicao) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all();
  if (!colunas.some((c) => c.name === coluna)) db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
}
garantirColuna('lojas', 'bairros', "TEXT NOT NULL DEFAULT '[]'");
garantirColuna('pedidos', 'bairro', "TEXT NOT NULL DEFAULT ''");

/* ---------- utilidades ---------- */
class Erro extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}
const corpo = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const agora = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hojeBR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
function somarDias(dataISO, dias) {
  const d = new Date(`${dataISO}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
const brl = (c) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const lerJSON = (s, padrao) => { try { return JSON.parse(s); } catch { return padrao; } };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inteiro = (v, min, max) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new Erro(400, 'Valor numérico inválido.');
  return n;
};

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function normalizarWhats(v) {
  let d = String(v ?? '').replace(/\D/g, '');
  if ((d.length === 10 || d.length === 11)) d = `55${d}`;
  if (!/^55\d{10,11}$/.test(d)) throw new Erro(400, 'WhatsApp inválido. Use o DDD e o número, por exemplo (82) 99999-9999.');
  return d;
}

const RESERVADOS = new Set(['api', 'img', 'css', 'js', 'painel', 'entrar', 'cadastro', 'admin', 'sair',
  'favicon.ico', 'robots.txt', 'static', 'assets', 'loja', 'lojas', 'termos', 'ajuda', 'redefinir']);
function gerarSlug(nome, ignorarId = null) {
  let base = nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'loja';
  if (RESERVADOS.has(base)) base = `${base}-loja`;
  let slug = base; let n = 2;
  const existe = db.prepare('SELECT id FROM lojas WHERE slug = ?');
  for (;;) {
    const r = existe.get(slug);
    if (!r || r.id === ignorarId) return slug;
    slug = `${base}-${n++}`;
  }
}
const slugValido = (s) => /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(s) && !RESERVADOS.has(s);

/* senha */
function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  return `${sal.toString('hex')}:${crypto.scryptSync(senha, sal, 64).toString('hex')}`;
}
function confereSenha(senha, guardado) {
  const [sal, h] = String(guardado).split(':');
  if (!sal || !h) return false;
  const calc = crypto.scryptSync(senha, Buffer.from(sal, 'hex'), 64);
  const esperado = Buffer.from(h, 'hex');
  return calc.length === esperado.length && crypto.timingSafeEqual(calc, esperado);
}

/* limite simples de tentativas por IP */
const tentativas = new Map();
const limitar = (max, janelaMs = 15 * 60 * 1000) => (req, _res, next) => {
  const chave = `${req.path}|${req.ip}`;
  const t = Date.now();
  const lista = (tentativas.get(chave) || []).filter((x) => t - x < janelaMs);
  if (lista.length >= max) return next(new Erro(429, 'Muitas tentativas. Aguarde alguns minutos e tente de novo.'));
  lista.push(t); tentativas.set(chave, lista);
  next();
};
setInterval(() => tentativas.clear(), 60 * 60 * 1000).unref();

/* ---------- app ---------- */
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '3mb' }));
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  next();
});

function lerCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return o;
}
function abrirSessao(req, res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const dias = 30;
  db.prepare('INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, ?)')
    .run(sha(token), usuarioId, Date.now() + dias * 864e5);
  const seguro = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.append('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${dias * 86400}${seguro ? '; Secure' : ''}`);
}
app.use('/api', (req, _res, next) => {
  const token = lerCookies(req).sid;
  if (token) {
    const s = db.prepare('SELECT usuario_id, expira_em FROM sessoes WHERE token = ?').get(sha(token));
    if (s && s.expira_em > Date.now()) {
      req.usuario = db.prepare('SELECT id, email, nome FROM usuarios WHERE id = ?').get(s.usuario_id);
      req.loja = db.prepare('SELECT * FROM lojas WHERE usuario_id = ?').get(s.usuario_id);
    }
  }
  next();
});
const exigirLogin = (req, _res, next) => (req.usuario && req.loja ? next() : next(new Erro(401, 'Entre na sua conta para continuar.')));
const ehAdmin = (req) => !!(ADMIN_EMAIL && req.usuario && req.usuario.email === ADMIN_EMAIL);
const exigirAdmin = (req, _res, next) => (ehAdmin(req) ? next() : next(new Erro(403, 'Acesso restrito.')));

const lojaAtiva = (l) => !!l.ativa && l.vencimento >= hojeBR();
const urlImg = (id) => (id ? `/img/${id}` : null);

function lojaDoPainel(l) {
  return {
    id: l.id, slug: l.slug, nome: l.nome, whatsapp: l.whatsapp, descricao: l.descricao, endereco: l.endereco,
    horario: l.horario, instagram: l.instagram, cor: l.cor, tema: l.tema, fonte: l.fonte,
    logo_id: l.logo_id, banner_id: l.banner_id, taxa_entrega: l.taxa_entrega, pedido_minimo: l.pedido_minimo,
    tempo: l.tempo, pagamentos: lerJSON(l.pagamentos, []), bairros: lerJSON(l.bairros, []),
    entrega: !!l.entrega, retirada: !!l.retirada,
    aberta: !!l.aberta, ativa: lojaAtiva(l), vencimento: l.vencimento,
  };
}

/* bairros com taxa própria: se a lista estiver vazia, vale a taxa única da loja */
function lerBairros(lista) {
  const vistos = new Set();
  return (Array.isArray(lista) ? lista : []).slice(0, 80).map((b) => ({
    nome: txt(b?.nome, 40), taxa: inteiro(b?.taxa ?? 0, 0, 100000),
  })).filter((b) => {
    const k = b.nome.toLowerCase();
    if (!b.nome || vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}

/* ---------- conta ---------- */
app.post('/api/cadastro', limitar(10), (req, res) => {
  const b = corpo(req);
  const email = txt(b.email, 120).toLowerCase();
  const nome = txt(b.nome, 60);
  const senha = String(b.senha ?? '');
  const nomeLoja = txt(b.loja, 60);
  if (!nome) throw new Erro(400, 'Informe o seu nome.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Erro(400, 'Informe um e-mail válido.');
  if (senha.length < 6) throw new Erro(400, 'A senha precisa ter pelo menos 6 caracteres.');
  if (!nomeLoja) throw new Erro(400, 'Informe o nome do seu restaurante.');
  const whatsapp = normalizarWhats(b.whatsapp);
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) {
    throw new Erro(409, 'Já existe uma conta com esse e-mail. Entre ou use outro e-mail.');
  }
  const usuarioId = tx(() => {
    const u = db.prepare('INSERT INTO usuarios (email, nome, senha_hash, criado_em) VALUES (?, ?, ?, ?)')
      .run(email, nome, hashSenha(senha), agora());
    db.prepare(`INSERT INTO lojas (usuario_id, slug, nome, whatsapp, vencimento, criado_em)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run(u.lastInsertRowid, gerarSlug(nomeLoja), nomeLoja, whatsapp, somarDias(hojeBR(), DIAS_TESTE), agora());
    return Number(u.lastInsertRowid);
  });
  abrirSessao(req, res, usuarioId);
  res.status(201).json({ ok: true });
});

app.post('/api/entrar', limitar(20), (req, res) => {
  const b = corpo(req);
  const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(txt(b.email, 120).toLowerCase());
  if (!u || !confereSenha(String(b.senha ?? ''), u.senha_hash)) throw new Erro(401, 'E-mail ou senha incorretos.');
  abrirSessao(req, res, u.id);
  res.json({ ok: true });
});

app.post('/api/sair', (req, res) => {
  const token = lerCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessoes WHERE token = ?').run(sha(token));
  res.append('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  res.json({ ok: true });
});

/* troca de senha pelo próprio restaurante (mantém só a sessão atual aberta) */
app.post('/api/painel/senha', exigirLogin, limitar(10), (req, res) => {
  const b = corpo(req);
  const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
  if (!confereSenha(String(b.atual ?? ''), u.senha_hash)) throw new Erro(400, 'A senha atual está incorreta.');
  const nova = String(b.nova ?? '');
  if (nova.length < 6) throw new Erro(400, 'A nova senha precisa ter pelo menos 6 caracteres.');
  db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(nova), u.id);
  const atual = lerCookies(req).sid;
  db.prepare('DELETE FROM sessoes WHERE usuario_id = ? AND token <> ?').run(u.id, sha(atual ?? ''));
  res.json({ ok: true });
});

/* redefinição: o admin gera um link de uso único (vale 1 hora) e envia ao restaurante */
app.post('/api/admin/lojas/:id/redefinir', exigirLogin, exigirAdmin, (req, res) => {
  const l = db.prepare('SELECT usuario_id FROM lojas WHERE id = ?').get(req.params.id);
  if (!l) throw new Erro(404, 'Loja não encontrada.');
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('DELETE FROM redefinicoes WHERE usuario_id = ? OR expira_em < ?').run(l.usuario_id, Date.now());
  db.prepare('INSERT INTO redefinicoes (token, usuario_id, expira_em) VALUES (?, ?, ?)').run(sha(token), l.usuario_id, Date.now() + 60 * 60 * 1000);
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  res.json({ url: `${base}/redefinir?token=${token}` });
});
app.get('/api/redefinir/validar', (req, res) => {
  const r = db.prepare('SELECT expira_em FROM redefinicoes WHERE token = ?').get(sha(String(req.query.token ?? '')));
  res.json({ valido: !!(r && r.expira_em > Date.now()) });
});
app.post('/api/redefinir', limitar(15), (req, res) => {
  const b = corpo(req);
  const hash = sha(String(b.token ?? ''));
  const r = db.prepare('SELECT usuario_id, expira_em FROM redefinicoes WHERE token = ?').get(hash);
  if (!r || r.expira_em < Date.now()) throw new Erro(400, 'Este link expirou ou já foi usado. Peça um novo link.');
  const senha = String(b.senha ?? '');
  if (senha.length < 6) throw new Erro(400, 'A senha precisa ter pelo menos 6 caracteres.');
  tx(() => {
    db.prepare('UPDATE usuarios SET senha_hash = ? WHERE id = ?').run(hashSenha(senha), r.usuario_id);
    db.prepare('DELETE FROM redefinicoes WHERE usuario_id = ?').run(r.usuario_id);
    db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(r.usuario_id);
  });
  res.json({ ok: true });
});

app.get('/api/eu', (req, res) => {
  if (!req.usuario) return res.json({ usuario: null, plataformaWhatsapp: WHATS_PLATAFORMA || null });
  res.json({
    usuario: { nome: req.usuario.nome, email: req.usuario.email },
    loja: req.loja ? lojaDoPainel(req.loja) : null,
    admin: ehAdmin(req),
    plataformaWhatsapp: WHATS_PLATAFORMA || null,
  });
});

/* ---------- imagens ---------- */
app.post('/api/painel/imagem', exigirLogin, (req, res) => {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(corpo(req).dataUrl ?? ''));
  if (!m) throw new Erro(400, 'Envie uma imagem PNG, JPG ou WebP.');
  const dados = Buffer.from(m[2], 'base64');
  if (dados.length > 700 * 1024) throw new Erro(413, 'Imagem muito grande. Use uma foto menor.');
  const total = db.prepare('SELECT COUNT(*) AS n FROM imagens WHERE loja_id = ?').get(req.loja.id).n;
  if (total > 400) throw new Erro(429, 'Limite de imagens atingido.');
  const id = crypto.randomBytes(12).toString('hex');
  db.prepare('INSERT INTO imagens (id, loja_id, mime, dados) VALUES (?, ?, ?, ?)').run(id, req.loja.id, m[1], dados);
  res.status(201).json({ id, url: urlImg(id) });
});

app.get('/img/:id', (req, res) => {
  const r = db.prepare('SELECT mime, dados FROM imagens WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).end();
  res.set({ 'Content-Type': r.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(Buffer.from(r.dados));
});

/* ---------- painel: loja ---------- */
app.get('/api/painel/loja', exigirLogin, (req, res) => res.json(lojaDoPainel(req.loja)));

app.put('/api/painel/loja', exigirLogin, (req, res) => {
  const b = corpo(req);
  const l = req.loja;
  const nome = txt(b.nome ?? l.nome, 60);
  if (!nome) throw new Erro(400, 'O nome do restaurante não pode ficar vazio.');
  const cor = String(b.cor ?? l.cor);
  if (!/^#[0-9a-fA-F]{6}$/.test(cor)) throw new Erro(400, 'Cor inválida.');
  const tema = ['claro', 'escuro'].includes(b.tema) ? b.tema : l.tema;
  const fonte = ['moderna', 'classica', 'divertida'].includes(b.fonte) ? b.fonte : l.fonte;
  let slug = l.slug;
  if (b.slug !== undefined && b.slug !== l.slug) {
    slug = txt(b.slug, 40).toLowerCase();
    if (!slugValido(slug)) throw new Erro(400, 'Endereço inválido. Use letras minúsculas, números e hífen (mínimo 3 caracteres).');
    if (db.prepare('SELECT 1 FROM lojas WHERE slug = ? AND id <> ?').get(slug, l.id)) throw new Erro(409, 'Esse endereço já está em uso.');
  }
  const pagamentos = (Array.isArray(b.pagamentos) ? b.pagamentos : lerJSON(l.pagamentos, []))
    .filter((p) => ['pix', 'cartao', 'dinheiro'].includes(p));
  const entrega = b.entrega === undefined ? l.entrega : (b.entrega ? 1 : 0);
  const retirada = b.retirada === undefined ? l.retirada : (b.retirada ? 1 : 0);
  if (!entrega && !retirada) throw new Erro(400, 'Ative pelo menos entrega ou retirada.');
  if (!pagamentos.length) throw new Erro(400, 'Aceite pelo menos uma forma de pagamento.');
  const donoDaImagem = (id) => {
    if (id == null || id === '') return null;
    if (!db.prepare('SELECT 1 FROM imagens WHERE id = ? AND loja_id = ?').get(String(id), l.id)) throw new Erro(400, 'Imagem inválida.');
    return String(id);
  };
  const bairros = b.bairros !== undefined ? JSON.stringify(lerBairros(b.bairros)) : l.bairros;
  db.prepare(`UPDATE lojas SET slug=?, nome=?, whatsapp=?, descricao=?, endereco=?, horario=?, instagram=?, cor=?, tema=?,
      fonte=?, logo_id=?, banner_id=?, taxa_entrega=?, pedido_minimo=?, tempo=?, pagamentos=?, entrega=?, retirada=?, aberta=?,
      bairros=?
      WHERE id=?`).run(
    slug, nome, b.whatsapp !== undefined ? normalizarWhats(b.whatsapp) : l.whatsapp,
    txt(b.descricao ?? l.descricao, 240), txt(b.endereco ?? l.endereco, 160), txt(b.horario ?? l.horario, 120),
    txt(b.instagram ?? l.instagram, 40).replace(/^@/, ''), cor, tema, fonte,
    b.logo_id !== undefined ? donoDaImagem(b.logo_id) : l.logo_id,
    b.banner_id !== undefined ? donoDaImagem(b.banner_id) : l.banner_id,
    b.taxa_entrega !== undefined ? inteiro(b.taxa_entrega, 0, 100000) : l.taxa_entrega,
    b.pedido_minimo !== undefined ? inteiro(b.pedido_minimo, 0, 1000000) : l.pedido_minimo,
    txt(b.tempo ?? l.tempo, 40), JSON.stringify(pagamentos), entrega, retirada,
    b.aberta === undefined ? l.aberta : (b.aberta ? 1 : 0), bairros, l.id,
  );
  res.json(lojaDoPainel(db.prepare('SELECT * FROM lojas WHERE id = ?').get(l.id)));
});

/* ---------- painel: cardápio ---------- */
function cardapioDoPainel(lojaId) {
  const cats = db.prepare('SELECT id, nome, ordem FROM categorias WHERE loja_id = ? ORDER BY ordem, id').all(lojaId);
  const prods = db.prepare('SELECT * FROM produtos WHERE loja_id = ? ORDER BY ordem, id').all(lojaId);
  return cats.map((c) => ({
    id: c.id, nome: c.nome,
    produtos: prods.filter((p) => p.categoria_id === c.id).map((p) => ({
      id: p.id, categoria_id: p.categoria_id, nome: p.nome, descricao: p.descricao, preco: p.preco,
      imagem_id: p.imagem_id, adicionais: lerJSON(p.adicionais, []), disponivel: !!p.disponivel,
    })),
  }));
}
app.get('/api/painel/cardapio', exigirLogin, (req, res) => res.json(cardapioDoPainel(req.loja.id)));

app.post('/api/painel/categorias', exigirLogin, (req, res) => {
  const nome = txt(corpo(req).nome, 40);
  if (!nome) throw new Erro(400, 'Dê um nome para a categoria.');
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM categorias WHERE loja_id = ?').get(req.loja.id).o;
  const r = db.prepare('INSERT INTO categorias (loja_id, nome, ordem) VALUES (?, ?, ?)').run(req.loja.id, nome, ordem);
  res.status(201).json({ id: Number(r.lastInsertRowid), nome });
});
app.put('/api/painel/categorias/:id', exigirLogin, (req, res) => {
  const nome = txt(corpo(req).nome, 40);
  if (!nome) throw new Erro(400, 'Dê um nome para a categoria.');
  const r = db.prepare('UPDATE categorias SET nome = ? WHERE id = ? AND loja_id = ?').run(nome, req.params.id, req.loja.id);
  if (!r.changes) throw new Erro(404, 'Categoria não encontrada.');
  res.json({ ok: true });
});
app.delete('/api/painel/categorias/:id', exigirLogin, (req, res) => {
  const r = db.prepare('DELETE FROM categorias WHERE id = ? AND loja_id = ?').run(req.params.id, req.loja.id);
  if (!r.changes) throw new Erro(404, 'Categoria não encontrada.');
  res.json({ ok: true });
});

function mover(tabela, id, dir, lojaId, escopo) {
  const lista = db.prepare(`SELECT id FROM ${tabela} WHERE loja_id = ? ${escopo.sql} ORDER BY ordem, id`).all(lojaId, ...escopo.args);
  const i = lista.findIndex((x) => x.id === Number(id));
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= lista.length) return;
  [lista[i], lista[j]] = [lista[j], lista[i]];
  tx(() => lista.forEach((x, k) => db.prepare(`UPDATE ${tabela} SET ordem = ? WHERE id = ?`).run(k + 1, x.id)));
}
app.post('/api/painel/categorias/:id/mover', exigirLogin, (req, res) => {
  mover('categorias', req.params.id, corpo(req).dir, req.loja.id, { sql: '', args: [] });
  res.json({ ok: true });
});
app.post('/api/painel/produtos/:id/mover', exigirLogin, (req, res) => {
  const p = db.prepare('SELECT categoria_id FROM produtos WHERE id = ? AND loja_id = ?').get(req.params.id, req.loja.id);
  if (!p) throw new Erro(404, 'Produto não encontrado.');
  mover('produtos', req.params.id, corpo(req).dir, req.loja.id, { sql: 'AND categoria_id = ?', args: [p.categoria_id] });
  res.json({ ok: true });
});

function lerProduto(req, b) {
  const nome = txt(b.nome, 80);
  if (!nome) throw new Erro(400, 'Informe o nome do produto.');
  const preco = inteiro(b.preco, 0, 10000000);
  const cat = db.prepare('SELECT id FROM categorias WHERE id = ? AND loja_id = ?').get(b.categoria_id, req.loja.id);
  if (!cat) throw new Erro(400, 'Escolha uma categoria.');
  const adicionais = (Array.isArray(b.adicionais) ? b.adicionais : []).slice(0, 20)
    .map((a) => ({ nome: txt(a?.nome, 40), preco: inteiro(a?.preco ?? 0, 0, 1000000) }))
    .filter((a) => a.nome);
  let imagem = null;
  if (b.imagem_id) {
    if (!db.prepare('SELECT 1 FROM imagens WHERE id = ? AND loja_id = ?').get(String(b.imagem_id), req.loja.id)) throw new Erro(400, 'Imagem inválida.');
    imagem = String(b.imagem_id);
  }
  return { nome, descricao: txt(b.descricao, 240), preco, categoria_id: cat.id, adicionais: JSON.stringify(adicionais), imagem, disponivel: b.disponivel === false ? 0 : 1 };
}
app.post('/api/painel/produtos', exigirLogin, (req, res) => {
  const p = lerProduto(req, corpo(req));
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem), 0) + 1 AS o FROM produtos WHERE loja_id = ? AND categoria_id = ?').get(req.loja.id, p.categoria_id).o;
  const r = db.prepare(`INSERT INTO produtos (loja_id, categoria_id, nome, descricao, preco, imagem_id, adicionais, disponivel, ordem)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(req.loja.id, p.categoria_id, p.nome, p.descricao, p.preco, p.imagem, p.adicionais, p.disponivel, ordem);
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});
app.put('/api/painel/produtos/:id', exigirLogin, (req, res) => {
  const p = lerProduto(req, corpo(req));
  const r = db.prepare(`UPDATE produtos SET categoria_id=?, nome=?, descricao=?, preco=?, imagem_id=?, adicionais=?, disponivel=?
                        WHERE id = ? AND loja_id = ?`)
    .run(p.categoria_id, p.nome, p.descricao, p.preco, p.imagem, p.adicionais, p.disponivel, req.params.id, req.loja.id);
  if (!r.changes) throw new Erro(404, 'Produto não encontrado.');
  res.json({ ok: true });
});
app.delete('/api/painel/produtos/:id', exigirLogin, (req, res) => {
  const r = db.prepare('DELETE FROM produtos WHERE id = ? AND loja_id = ?').run(req.params.id, req.loja.id);
  if (!r.changes) throw new Erro(404, 'Produto não encontrado.');
  res.json({ ok: true });
});

/* ---------- painel: pedidos ---------- */
const STATUS = ['novo', 'preparo', 'pronto', 'entregue', 'cancelado'];
const pedidoPublico = (p) => ({
  id: p.id, numero: p.numero, cliente: p.cliente, telefone: p.telefone, tipo: p.tipo, endereco: p.endereco, bairro: p.bairro,
  pagamento: p.pagamento, troco: p.troco, obs: p.obs, itens: lerJSON(p.itens, []), subtotal: p.subtotal,
  taxa: p.taxa, total: p.total, status: p.status, criado_em: p.criado_em,
});
app.get('/api/painel/pedidos', exigirLogin, (req, res) => {
  const rows = db.prepare('SELECT * FROM pedidos WHERE loja_id = ? ORDER BY id DESC LIMIT 150').all(req.loja.id);
  res.json(rows.map(pedidoPublico));
});
app.patch('/api/painel/pedidos/:id', exigirLogin, (req, res) => {
  const status = corpo(req).status;
  if (!STATUS.includes(status)) throw new Erro(400, 'Status inválido.');
  const r = db.prepare('UPDATE pedidos SET status = ? WHERE id = ? AND loja_id = ?').run(status, req.params.id, req.loja.id);
  if (!r.changes) throw new Erro(404, 'Pedido não encontrado.');
  res.json({ ok: true });
});

/* ---------- público: loja e pedido ---------- */
function lojaPublica(l) {
  return {
    slug: l.slug, nome: l.nome, descricao: l.descricao, endereco: l.endereco, horario: l.horario, instagram: l.instagram,
    cor: l.cor, tema: l.tema, fonte: l.fonte, logo: urlImg(l.logo_id), banner: urlImg(l.banner_id),
    taxa_entrega: l.taxa_entrega, pedido_minimo: l.pedido_minimo, tempo: l.tempo,
    pagamentos: lerJSON(l.pagamentos, []), bairros: lerJSON(l.bairros, []),
    entrega: !!l.entrega, retirada: !!l.retirada, aberta: !!l.aberta,
  };
}
const buscarLoja = (slug) => db.prepare('SELECT * FROM lojas WHERE slug = ?').get(String(slug).toLowerCase());

app.get('/api/loja/:slug', (req, res) => {
  const l = buscarLoja(req.params.slug);
  if (!l) throw new Erro(404, 'Loja não encontrada.');
  if (!lojaAtiva(l)) return res.json({ loja: lojaPublica(l), indisponivel: true, categorias: [] });
  const cats = db.prepare('SELECT id, nome FROM categorias WHERE loja_id = ? ORDER BY ordem, id').all(l.id);
  const prods = db.prepare('SELECT * FROM produtos WHERE loja_id = ? ORDER BY ordem, id').all(l.id);
  res.json({
    loja: lojaPublica(l), indisponivel: false,
    categorias: cats.map((c) => ({
      id: c.id, nome: c.nome,
      produtos: prods.filter((p) => p.categoria_id === c.id).map((p) => ({
        id: p.id, nome: p.nome, descricao: p.descricao, preco: p.preco, imagem: urlImg(p.imagem_id),
        adicionais: lerJSON(p.adicionais, []), disponivel: !!p.disponivel,
      })),
    })).filter((c) => c.produtos.length),
  });
});

const ROTULO_PAGAMENTO = { pix: 'Pix', cartao: 'Cartão (na entrega)', dinheiro: 'Dinheiro' };
app.post('/api/loja/:slug/pedidos', limitar(30, 10 * 60 * 1000), (req, res) => {
  const l = buscarLoja(req.params.slug);
  if (!l || !lojaAtiva(l)) throw new Erro(404, 'Loja indisponível.');
  if (!l.aberta) throw new Erro(409, 'A loja está fechada no momento. Tente mais tarde.');
  const b = corpo(req);
  const cliente = txt(b.cliente, 60);
  if (!cliente) throw new Erro(400, 'Informe o seu nome.');
  const telefone = String(b.telefone ?? '').replace(/\D/g, '');
  if (telefone.length < 10 || telefone.length > 11) throw new Erro(400, 'Informe o seu WhatsApp com DDD.');
  const tipo = b.tipo === 'retirada' ? 'retirada' : 'entrega';
  if (tipo === 'entrega' && !l.entrega) throw new Erro(400, 'Esta loja não faz entrega.');
  if (tipo === 'retirada' && !l.retirada) throw new Erro(400, 'Esta loja não tem retirada no local.');
  const endereco = txt(b.endereco, 200);
  if (tipo === 'entrega' && endereco.length < 5) throw new Erro(400, 'Informe o endereço de entrega.');
  const aceitos = lerJSON(l.pagamentos, []);
  if (!aceitos.includes(b.pagamento)) throw new Erro(400, 'Escolha uma forma de pagamento.');
  const brutos = Array.isArray(b.itens) ? b.itens.slice(0, 60) : [];
  if (!brutos.length) throw new Erro(400, 'Seu carrinho está vazio.');

  const itens = brutos.map((it) => {
    const p = db.prepare('SELECT * FROM produtos WHERE id = ? AND loja_id = ?').get(Number(it?.produtoId), l.id);
    if (!p || !p.disponivel) throw new Erro(409, `O item "${txt(it?.nome, 60) || 'selecionado'}" não está mais disponível. Atualize a página.`);
    const catalogo = lerJSON(p.adicionais, []);
    const escolhidos = (Array.isArray(it.adicionais) ? it.adicionais : []).map(String)
      .map((nome) => catalogo.find((a) => a.nome === nome)).filter(Boolean);
    const qtd = inteiro(it.qtd ?? 1, 1, 50);
    const unitario = p.preco + escolhidos.reduce((s, a) => s + a.preco, 0);
    return { nome: p.nome, qtd, unitario, adicionais: escolhidos.map((a) => a.nome), obs: txt(it.obs, 120), total: unitario * qtd };
  });
  const subtotal = itens.reduce((s, i) => s + i.total, 0);
  if (subtotal < l.pedido_minimo) throw new Erro(400, `O pedido mínimo é ${brl(l.pedido_minimo)}.`);
  const bairrosLoja = lerJSON(l.bairros, []);
  let taxa = 0;
  let bairro = '';
  if (tipo === 'entrega') {
    if (bairrosLoja.length) {
      const achado = bairrosLoja.find((x) => x.nome === txt(b.bairro, 40));
      if (!achado) throw new Erro(400, 'Escolha o bairro da entrega.');
      bairro = achado.nome; taxa = achado.taxa;
    } else taxa = l.taxa_entrega;
  }
  const total = subtotal + taxa;

  const pedido = tx(() => {
    const numero = db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM pedidos WHERE loja_id = ?').get(l.id).n;
    db.prepare(`INSERT INTO pedidos (loja_id, numero, cliente, telefone, tipo, endereco, bairro, pagamento, troco, obs, itens, subtotal, taxa, total, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(l.id, numero, cliente, telefone, tipo, endereco, bairro, b.pagamento, txt(b.troco, 30), txt(b.obs, 200), JSON.stringify(itens), subtotal, taxa, total, agora());
    return numero;
  });

  const linhas = [`*Pedido #${pedido}* · ${l.nome}`, `Cliente: ${cliente} (${telefone})`, ''];
  itens.forEach((i) => {
    linhas.push(`${i.qtd}x ${i.nome} · ${brl(i.total)}`);
    if (i.adicionais.length) linhas.push(`   + ${i.adicionais.join(', ')}`);
    if (i.obs) linhas.push(`   Obs: ${i.obs}`);
  });
  linhas.push('', `Subtotal: ${brl(subtotal)}`);
  if (tipo === 'entrega') linhas.push(`Entrega${bairro ? ` (${bairro})` : ''}: ${taxa ? brl(taxa) : 'grátis'}`);
  linhas.push(`*Total: ${brl(total)}*`, '');
  linhas.push(tipo === 'entrega' ? `Entregar em: ${endereco}${bairro ? `, ${bairro}` : ''}` : 'Retirada no local');
  linhas.push(`Pagamento: ${ROTULO_PAGAMENTO[b.pagamento]}${b.pagamento === 'dinheiro' && txt(b.troco, 30) ? ` (troco para ${txt(b.troco, 30)})` : ''}`);
  if (txt(b.obs, 200)) linhas.push(`Obs: ${txt(b.obs, 200)}`);
  const texto = linhas.join('\n');
  res.status(201).json({
    numero: pedido, total, texto,
    whatsappUrl: `https://wa.me/${l.whatsapp}?text=${encodeURIComponent(texto)}`,
  });
});

/* ---------- admin da plataforma ---------- */
app.get('/api/admin/lojas', exigirLogin, exigirAdmin, (_req, res) => {
  const rows = db.prepare(`
    SELECT l.*, u.email, u.nome AS dono,
           (SELECT COUNT(*) FROM pedidos p WHERE p.loja_id = l.id) AS pedidos
    FROM lojas l JOIN usuarios u ON u.id = l.usuario_id ORDER BY l.id DESC`).all();
  res.json(rows.map((l) => ({
    id: l.id, slug: l.slug, nome: l.nome, dono: l.dono, email: l.email, whatsapp: l.whatsapp,
    pedidos: l.pedidos, ativa: !!l.ativa, vencimento: l.vencimento, criado_em: l.criado_em, vigente: lojaAtiva(l),
  })));
});
app.patch('/api/admin/lojas/:id', exigirLogin, exigirAdmin, (req, res) => {
  const b = corpo(req);
  const l = db.prepare('SELECT * FROM lojas WHERE id = ?').get(req.params.id);
  if (!l) throw new Erro(404, 'Loja não encontrada.');
  let vencimento = l.vencimento;
  if (b.somarDias !== undefined) {
    const base = l.vencimento > hojeBR() ? l.vencimento : hojeBR();
    vencimento = somarDias(base, inteiro(b.somarDias, 1, 400));
  }
  db.prepare('UPDATE lojas SET vencimento = ?, ativa = ? WHERE id = ?')
    .run(vencimento, b.ativa === undefined ? l.ativa : (b.ativa ? 1 : 0), l.id);
  res.json({ ok: true });
});

/* ---------- QR code ---------- */
app.get('/api/qr', async (req, res) => {
  const url = txt(req.query.url, 300);
  if (!/^https?:\/\//.test(url)) throw new Erro(400, 'Endereço inválido.');
  const svg = await QRCode.toString(url, { type: 'svg', margin: 1, width: 512, color: { dark: '#121A2B', light: '#FFFFFF' } });
  res.type('image/svg+xml').send(svg);
});

app.use('/api', (_req, _res, next) => next(new Erro(404, 'Endereço não encontrado.')));

/* ---------- páginas ---------- */
app.use(express.static(path.join(raiz, 'public'), { extensions: ['html'], maxAge: '5m' }));

const modeloLoja = fs.readFileSync(path.join(raiz, 'public', 'loja.html'), 'utf8');
const pagina404 = path.join(raiz, 'public', '404.html');
const moeda = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* texto da prévia do link (WhatsApp, Instagram, Telegram...): descrição + o que o cliente quer saber de cara */
function descricaoDaPrevia(l) {
  const extras = [];
  const tempo = String(l.tempo || '').trim();
  if (tempo) extras.push(/^\d+$/.test(tempo) ? `${tempo} min` : tempo);
  if (l.entrega) {
    const taxas = lerJSON(l.bairros, []).map((b) => b.taxa);
    const menor = taxas.length ? Math.min(...taxas) : l.taxa_entrega;
    extras.push(menor ? `Entrega a partir de ${moeda(menor)}` : 'Entrega grátis');
  }
  if (l.retirada) extras.push('Retirada no local');
  if (l.pedido_minimo) extras.push(`Mínimo ${moeda(l.pedido_minimo)}`);
  if (l.horario) extras.push(l.horario);
  const abertura = (l.descricao || '').trim() || `Peça direto de ${l.nome}, sem intermediários.`;
  const texto = extras.length ? `${abertura}\n${extras.join(' · ')}` : abertura;
  return texto.length > 200 ? `${texto.slice(0, 197)}...` : texto;
}

app.get(['/:slug', '/:slug/carrinho'], (req, res, next) => {
  const slug = req.params.slug.toLowerCase();
  if (RESERVADOS.has(slug)) return next();
  const l = buscarLoja(slug);
  if (!l) return res.status(404).sendFile(pagina404);
  const base = BASE_URL || `${req.protocol}://${req.get('host')}`;
  /* imagem da prévia: capa (formato largo) > logo > foto do primeiro produto */
  const foto = db.prepare('SELECT imagem_id FROM produtos WHERE loja_id = ? AND imagem_id IS NOT NULL ORDER BY ordem, id LIMIT 1').get(l.id)?.imagem_id;
  const imagem = l.banner_id || l.logo_id || foto;
  const url = (id) => esc(`${base}/img/${id}`);
  const metaImagem = imagem
    ? `<meta property="og:image" content="${url(imagem)}">\n<meta property="og:image:alt" content="${esc(l.nome)}">\n<meta name="twitter:image" content="${url(imagem)}">`
    : '';
  const icone = l.logo_id || foto;
  const html = modeloLoja
    .replaceAll('{{META_IMAGEM}}', metaImagem)
    .replaceAll('{{TWITTER_CARD}}', l.banner_id ? 'summary_large_image' : 'summary')
    .replaceAll('{{LINK_ICONE}}', icone ? `<link rel="icon" href="/img/${esc(icone)}">` : '')
    .replaceAll('{{TITULO}}', esc(l.nome))
    .replaceAll('{{DESCRICAO}}', esc(descricaoDaPrevia(l)))
    .replaceAll('{{COR}}', esc(l.cor))
    .replaceAll('{{URL}}', esc(`${base}/${l.slug}`));
  res.set('Cache-Control', 'no-cache').type('html').send(html);
});

app.use((_req, res) => res.status(404).sendFile(pagina404));

app.use((e, _req, res, _next) => {
  if (e instanceof Erro) return res.status(e.status).json({ erro: e.message });
  if (e?.type === 'entity.too.large') return res.status(413).json({ erro: 'Arquivo muito grande.' });
  if (e?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Requisição inválida.' });
  console.error(e);
  res.status(500).json({ erro: 'Algo deu errado. Tente novamente em instantes.' });
});

app.listen(PORTA, () => console.log(`Balcão rodando em http://localhost:${PORTA}`));