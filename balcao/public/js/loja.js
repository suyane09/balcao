import { api, esc, brl, mascaraTelefone } from './comum.js';

const slug = decodeURIComponent(location.pathname.split('/').filter(Boolean)[0] || '');
const modoCarrinho = location.pathname.split('/').filter(Boolean)[1] === 'carrinho';
const $app = document.getElementById('app');
const chave = `balcao:${slug}`;
const lerLocal = (k, padrao) => { try { return JSON.parse(localStorage.getItem(`${chave}:${k}`)) ?? padrao; } catch { return padrao; } };
const gravarLocal = (k, v) => { try { localStorage.setItem(`${chave}:${k}`, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } };

let dados = null;
let carrinho = lerLocal('carrinho', []);

const FONTES = {
  moderna: { titulo: 'Plus Jakarta Sans', corpo: 'Plus Jakarta Sans', fallback: 'system-ui, sans-serif' },
  classica: { titulo: 'Fraunces', corpo: 'Plus Jakarta Sans', fallback: 'Georgia, serif' },
  divertida: { titulo: 'Baloo 2', corpo: 'Baloo 2', fallback: 'system-ui, sans-serif' },
};
const PARAM_FONTE = {
  'Plus Jakarta Sans': 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
  Fraunces: 'Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700',
  'Baloo 2': 'Baloo+2:wght@400;500;600;700;800',
};

/* ---------- tema ---------- */
function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function luminancia(hex) {
  const [r, g, b] = rgb(hex).map((c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const misturarComBranco = (hex, t) => `rgb(${rgb(hex).map((c) => Math.round(c * (1 - t) + 255 * t)).join(',')})`;

const contraste = (a, b) => { const [x, y] = [luminancia(a), luminancia(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const hexDe = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
const misturar = (hex, alvo, t) => hexDe(rgb(hex).map((c, i) => c * (1 - t) + rgb(alvo)[i] * t));

/* Cor da marca que realmente aparece: se ela some no fundo (ex.: cinza escuro no tema escuro), clareia/escurece até dar para ler */
function corVisivel(hex, fundo, alvo) {
  if (contraste(hex, fundo) >= 3) return hex;
  const [r, g, b] = rgb(hex);
  if (Math.max(r, g, b) - Math.min(r, g, b) < 40) return alvo; // cor neutra: usa branco/preto do tema
  for (let t = 0.1; t <= 1; t += 0.1) { const c = misturar(hex, alvo, t); if (contraste(c, fundo) >= 3) return c; }
  return alvo;
}

function aplicarTema(l) {
  const raiz = document.documentElement;
  const escuro = l.tema === 'escuro';
  const cor = corVisivel(l.cor, escuro ? '#1b1b20' : '#ffffff', escuro ? '#f2f2f4' : '#181a1f');
  raiz.style.setProperty('--marca', cor);
  raiz.style.setProperty('--marca-original', l.cor);
  raiz.style.setProperty('--marca-original-texto', luminancia(l.cor) > 0.35 ? '#17181c' : '#ffffff');
  raiz.style.setProperty('--marca-texto', luminancia(cor) > 0.35 ? '#17181c' : '#ffffff');
  raiz.style.setProperty('--marca-suave', misturarComBranco(l.cor, 0.9));
  raiz.classList.toggle('escuro', escuro);
  const f = FONTES[l.fonte] || FONTES.moderna;
  const familias = [...new Set([f.titulo, f.corpo])].map((n) => `family=${PARAM_FONTE[n]}`).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${familias}&display=swap`;
  document.head.append(link);
  raiz.style.setProperty('--fonte', `'${f.corpo}', ${f.fallback}`);
  raiz.style.setProperty('--fonte-titulo', `'${f.titulo}', ${f.fallback}`);
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', l.cor);
}

/* ---------- início ---------- */
async function iniciar() {
  try { dados = await api('GET', `/api/loja/${encodeURIComponent(slug)}`); }
  catch (err) {
    $app.innerHTML = `<div class="indisponivel"><h1>Loja não encontrada</h1><p>${esc(err.message)}</p></div>`;
    return;
  }
  aplicarTema(dados.loja);
  document.title = `${dados.loja.nome} · Cardápio e pedidos`;
  if (dados.indisponivel) {
    $app.innerHTML = `<div class="indisponivel"><h1>${esc(dados.loja.nome)}</h1><p>Esta loja está temporariamente indisponível para pedidos. Tente novamente mais tarde.</p></div>`;
    return;
  }
  if (modoCarrinho) { document.title = `Seu pedido · ${dados.loja.nome}`; renderCarrinhoPagina(); return; }
  renderPagina();
}

const ICONES = {
  tempo: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  entrega: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  retirada: '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  minimo: '<circle cx="12" cy="12" r="10"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 6v2"/><path d="M12 16v2"/>',
  horario: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  local: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/>',
};
const icone = (n) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[n]}</svg>`;
/* "40" vira "40 min"; textos como "40 a 60 min" ficam como estão */
const textoTempo = (t) => (/^\d+$/.test(t.trim()) ? `${t.trim()} min` : t.trim());

function renderPagina() {
  const { loja, categorias } = dados;
  const inicial = (loja.nome.trim()[0] || '?').toUpperCase();
  const infos = [];
  if (loja.tempo) infos.push(`<span>${icone('tempo')}${esc(textoTempo(loja.tempo))}</span>`);
  if (loja.entrega) infos.push(`<span>${icone('entrega')}${textoEntrega(loja)}</span>`);
  if (loja.retirada) infos.push(`<span>${icone('retirada')}Retirada no local</span>`);
  if (loja.pedido_minimo) infos.push(`<span>${icone('minimo')}Mínimo ${brl(loja.pedido_minimo)}</span>`);
  if (loja.horario) infos.push(`<span>${icone('horario')}${esc(loja.horario)}</span>`);
  if (loja.instagram) infos.push(`<a href="https://instagram.com/${encodeURIComponent(loja.instagram)}" target="_blank" rel="noopener">${icone('instagram')}@${esc(loja.instagram)}</a>`);
  const logo = `<div class="logo" style="${loja.logo ? `background-image:url('${esc(loja.logo)}')` : ''}">${loja.logo ? '' : esc(inicial)}</div>`;
  const situacao = `<span class="situacao ${loja.aberta ? 'aberta' : 'fechada'}">${loja.aberta ? 'Aberto agora' : 'Fechado no momento'}</span>`;

  $app.innerHTML = `
    <div class="pagina ${loja.banner ? '' : 'sem-capa'}">
      ${loja.banner ? `<div class="capa" style="background-image:url('${esc(loja.banner)}')"></div>` : ''}
      <header class="identidade">
        ${loja.banner ? `${logo}<h1>${esc(loja.nome)}</h1>${situacao}` : `<div class="topo">${logo}<div class="topo-texto"><h1>${esc(loja.nome)}</h1>${situacao}</div></div>`}
        ${loja.descricao ? `<p class="descricao">${esc(loja.descricao)}</p>` : ''}
        <div class="infos">${infos.join('')}</div>
        ${loja.endereco ? `<p class="endereco-loja">${icone('local')}${esc(loja.endereco)}</p>` : ''}
      </header>
      ${loja.aberta ? '' : '<div class="faixa-fechada" role="status">Estamos fechados agora. Você pode ver o cardápio, mas os pedidos só voltam quando a loja abrir.</div>'}
      ${categorias.length ? `
      <nav class="nav-cat" aria-label="Categorias"><div class="trilha">${categorias.map((c, i) => `<a href="#cat-${c.id}" data-cat="${c.id}" class="${i === 0 ? 'ativa' : ''}">${esc(c.nome)}</a>`).join('')}</div></nav>
      ${categorias.map((c) => `
        <section class="secao" id="cat-${c.id}"><h2>${esc(c.nome)}</h2>
          <div class="itens">${c.produtos.map((p) => `
            <button class="item ${p.imagem ? '' : 'sem-foto'} ${p.disponivel ? '' : 'esgotado'}" data-prod="${p.id}" ${p.disponivel ? '' : 'disabled'}>
              <div><div class="nome">${esc(p.nome)}</div>
                ${p.descricao ? `<div class="desc">${esc(p.descricao)}</div>` : ''}
                ${p.disponivel ? `<div class="preco">${brl(p.preco)}</div>` : '<div class="tag">Esgotado</div>'}</div>
              ${p.imagem ? `<div class="foto" style="background-image:url('${esc(p.imagem)}')" role="img" aria-label="${esc(p.nome)}">${p.disponivel ? '<span class="mais" aria-hidden="true">+</span>' : ''}</div>` : ''}
            </button>`).join('')}</div>
        </section>`).join('')}` : '<div class="vazio-cardapio">O cardápio ainda está sendo montado. Volte em breve.</div>'}
      <p class="rodape-loja">Peça direto, sem intermediários. Feito com <a href="/" target="_blank" rel="noopener">Balcão</a>.</p>
    </div>
    <div class="barra-carrinho" id="barra" hidden><button id="abrir-carrinho"></button></div>`;

  document.getElementById('abrir-carrinho').addEventListener('click', () => { location.href = `/${encodeURIComponent(slug)}/carrinho`; });
  $app.addEventListener('click', (e) => {
    const item = e.target.closest('[data-prod]');
    if (item) abrirProduto(achar(item.dataset.prod));
  });
  espionarCategorias();
  atualizarBarra();
}

/* "Entrega grátis", "Entrega R$ 5,00" ou, com bairros, "Entrega de R$ 3,00 a R$ 8,00" */
function textoEntrega(l) {
  if (l.bairros.length) {
    const taxas = l.bairros.map((b) => b.taxa);
    const min = Math.min(...taxas); const max = Math.max(...taxas);
    if (min === max) return `Entrega ${min ? brl(min) : 'grátis'}`;
    return `Entrega de ${min ? brl(min) : 'grátis'} a ${brl(max)}`;
  }
  return `Entrega ${l.taxa_entrega ? brl(l.taxa_entrega) : 'grátis'}`;
}

const achar = (id) => dados.categorias.flatMap((c) => c.produtos).find((p) => p.id === Number(id));

function espionarCategorias() {
  const links = [...document.querySelectorAll('.nav-cat a')];
  if (!links.length || !('IntersectionObserver' in window)) return;
  const obs = new IntersectionObserver((entradas) => {
    entradas.forEach((en) => {
      if (!en.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('ativa', a.dataset.cat === en.target.id.replace('cat-', '')));
      const ativa = document.querySelector('.nav-cat a.ativa');
      ativa?.scrollIntoView({ inline: 'center', block: 'nearest' });
    });
  }, { rootMargin: '-25% 0px -65% 0px' });
  document.querySelectorAll('.secao').forEach((s) => obs.observe(s));
}

/* ---------- carrinho ---------- */
const subtotal = () => carrinho.reduce((s, i) => s + i.preco * i.qtd, 0);
const totalItens = () => carrinho.reduce((s, i) => s + i.qtd, 0);
const salvarCarrinho = () => gravarLocal('carrinho', carrinho);
function atualizarBarra() {
  salvarCarrinho();
  const barra = document.getElementById('barra');
  if (!barra) return;
  barra.hidden = !carrinho.length;
  document.getElementById('abrir-carrinho').innerHTML =
    `<span><span class="qtd">${totalItens()}</span>Ver carrinho</span><span>${brl(subtotal())}</span>`;
  gravarLocal('carrinho', carrinho);
}

function abrirFolha(html) {
  const d = document.createElement('dialog');
  d.className = 'folha';
  d.innerHTML = html;
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
  return d;
}

function abrirProduto(p) {
  if (!p) return;
  const aberta = dados.loja.aberta;
  let qtd = 1;
  const d = abrirFolha(`
    <button class="fechar ${p.imagem ? '' : 'sem-foto'}" aria-label="Fechar" data-fechar>✕</button>
    <div class="corpo">
      ${p.imagem ? `<div class="foto-grande" style="background-image:url('${esc(p.imagem)}')"></div>` : ''}
      <h2 ${p.imagem ? '' : 'style="padding-right:2.6rem"'}>${esc(p.nome)}</h2>
      ${p.descricao ? `<p style="color:var(--suave)">${esc(p.descricao)}</p>` : ''}
      <p style="font-weight:800;margin-top:.5rem">${brl(p.preco)}</p>
      ${p.adicionais.length ? `<span class="rotulo-bloco">Adicionais</span>${p.adicionais.map((a, i) => `
        <label class="adicional"><span class="esq"><input type="checkbox" value="${i}"> ${esc(a.nome)}</span><span>${a.preco ? `+ ${brl(a.preco)}` : 'grátis'}</span></label>`).join('')}` : ''}
      <label class="rotulo-bloco" for="obs-item">Alguma observação?</label>
      <textarea id="obs-item" maxlength="120" placeholder="Ex.: sem cebola, ponto da carne..."></textarea>
    </div>
    <div class="pe">
      <div class="passos-qtd"><button type="button" data-menos aria-label="Diminuir">−</button><output id="qtd">1</output><button type="button" data-mais aria-label="Aumentar">+</button></div>
      <button class="botao-marca" id="adicionar" ${aberta ? '' : 'disabled'}></button>
    </div>`);
  const botao = d.querySelector('#adicionar');
  const escolhidos = () => [...d.querySelectorAll('.adicional input:checked')].map((i) => p.adicionais[Number(i.value)]);
  const unitario = () => p.preco + escolhidos().reduce((s, a) => s + a.preco, 0);
  const atualizar = () => {
    d.querySelector('#qtd').textContent = qtd;
    botao.textContent = aberta ? `Adicionar · ${brl(unitario() * qtd)}` : 'Loja fechada';
  };
  d.addEventListener('click', (e) => {
    if (e.target.closest('[data-fechar]')) d.close();
    if (e.target.closest('[data-menos]')) { qtd = Math.max(1, qtd - 1); atualizar(); }
    if (e.target.closest('[data-mais]')) { qtd = Math.min(50, qtd + 1); atualizar(); }
  });
  d.addEventListener('change', atualizar);
  botao.addEventListener('click', () => {
    const adicionais = escolhidos().map((a) => a.nome).sort();
    const obs = d.querySelector('#obs-item').value.trim();
    const existente = carrinho.find((i) => i.produtoId === p.id && i.obs === obs && i.adicionais.join('|') === adicionais.join('|'));
    if (existente) existente.qtd = Math.min(50, existente.qtd + qtd);
    else carrinho.push({ produtoId: p.id, nome: p.nome, preco: unitario(), qtd, adicionais, obs });
    atualizarBarra();
    d.close();
  });
  atualizar();
}

/* ---------- página do carrinho (/loja/carrinho): itens, entrega, dados e pagamento numa tela só ---------- */
function renderCarrinhoPagina() {
  const l = dados.loja;
  const voltarHref = `/${encodeURIComponent(slug)}`;
  const salvos = lerLocal('cliente', {});
  const form = { tipo: l.entrega ? 'entrega' : 'retirada', cliente: salvos.cliente || '', telefone: salvos.telefone || '', endereco: salvos.endereco || '', bairro: salvos.bairro || '', pagamento: l.pagamentos[0], troco: '', obs: '' };
  const ROTULO = { pix: 'Pix', cartao: 'Cartão (na entrega)', dinheiro: 'Dinheiro' };
  let erro = '';
  let resposta = null;

  const temBairros = () => l.bairros.length > 0;
  const bairroEscolhido = () => l.bairros.find((b) => b.nome === form.bairro);
  const taxa = () => {
    if (form.tipo !== 'entrega') return 0;
    return temBairros() ? (bairroEscolhido()?.taxa ?? 0) : l.taxa_entrega;
  };
  const inicial = (l.nome.trim()[0] || '?').toUpperCase();
  const topo = `
    <header class="topo-carrinho">
      <a class="voltar" href="${voltarHref}"><svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>Cardápio</a>
      <span class="loja-mini"><span class="logo-mini" style="${l.logo ? `background-image:url('${esc(l.logo)}')` : ''}">${l.logo ? '' : esc(inicial)}</span>${esc(l.nome)}</span>
    </header>`;

  function desenhar() {
    if (resposta) return desenharSucesso();
    if (!carrinho.length) {
      $app.innerHTML = `<div class="pagina-carrinho">${topo}<div class="vazio-cardapio">Seu carrinho está vazio.<br><br><a class="botao-marca link-botao" href="${voltarHref}">Ver o cardápio</a></div></div>`;
      return;
    }
    const minimoFalta = l.pedido_minimo - subtotal();
    const pct = l.pedido_minimo ? Math.min(100, Math.round((subtotal() / l.pedido_minimo) * 100)) : 100;
    const n = totalItens();
    const bloqueado = !l.aberta || minimoFalta > 0;
    const rotuloBotao = !l.aberta ? 'Loja fechada' : (minimoFalta > 0 ? `Faltam ${brl(minimoFalta)}` : 'Enviar pedido');
    const total = subtotal() + taxa();
    const botao = `<button type="submit" form="form-pedido" class="botao-marca" data-enviar ${bloqueado ? 'disabled' : ''}>${rotuloBotao}</button>`;

    $app.innerHTML = `
      <div class="pagina-carrinho">
        ${topo}
        <h1>Seu pedido<span class="contagem">${n} ${n === 1 ? 'item' : 'itens'}</span></h1>
        ${l.aberta ? '' : '<div class="faixa-fechada" style="margin:0 0 1rem" role="status">Estamos fechados agora. Os pedidos só voltam quando a loja abrir.</div>'}
        ${erro ? `<div class="alerta-form" role="alert">${esc(erro)}</div>` : ''}
        <form id="form-pedido" class="grade-carrinho" novalidate>
          <div class="coluna-principal">
            <section class="bloco">
              <h2>Itens</h2>
              ${carrinho.map((i, idx) => {
                const foto = achar(i.produtoId)?.imagem;
                return `
                <div class="linha-carrinho ${foto ? '' : 'sem-mini'}">
                  ${foto ? `<div class="mini" style="background-image:url('${esc(foto)}')"></div>` : ''}
                  <div class="info">
                    <div class="nome">${esc(i.nome)}</div>
                    ${i.adicionais.length ? `<div class="sub">+ ${esc(i.adicionais.join(', '))}</div>` : ''}
                    ${i.obs ? `<div class="sub">Obs: ${esc(i.obs)}</div>` : ''}
                    <div class="controles">
                      <div class="passos-qtd"><button type="button" data-menos="${idx}" aria-label="Diminuir">−</button><output>${i.qtd}</output><button type="button" data-mais="${idx}" aria-label="Aumentar">+</button></div>
                      <button type="button" class="remover" data-remover="${idx}">Remover</button>
                    </div>
                  </div>
                  <div class="preco">${brl(i.preco * i.qtd)}</div>
                </div>`;
              }).join('')}
              <a class="mais-itens" href="${voltarHref}">+ Adicionar mais itens</a>
              ${minimoFalta > 0 ? `<div class="aviso-minimo" role="status"><p>Faltam <strong>${brl(minimoFalta)}</strong> para o pedido mínimo de ${brl(l.pedido_minimo)}.</p><div class="barra-min"><span style="width:${pct}%"></span></div></div>` : ''}
            </section>

            ${l.entrega && l.retirada ? `
            <section class="bloco">
              <h2>Como você quer receber?</h2>
              <div class="escolhas">
                <label class="escolha"><input type="radio" name="tipo" value="entrega" ${form.tipo === 'entrega' ? 'checked' : ''}> ${textoEntrega(l)}</label>
                <label class="escolha"><input type="radio" name="tipo" value="retirada" ${form.tipo === 'retirada' ? 'checked' : ''}> Retirar no local</label>
              </div>
            </section>` : ''}

            <section class="bloco">
              <h2>Seus dados</h2>
              <label class="rotulo-bloco" for="f-nome">Seu nome</label><input type="text" id="f-nome" autocomplete="name" maxlength="60" value="${esc(form.cliente)}">
              <label class="rotulo-bloco" for="f-fone">Seu WhatsApp</label><input type="tel" id="f-fone" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000" value="${esc(form.telefone)}">
              ${form.tipo === 'entrega' && temBairros() ? `<label class="rotulo-bloco" for="f-bairro">Bairro</label><select id="f-bairro"><option value="">Escolha o bairro</option>${l.bairros.map((b) => `<option value="${esc(b.nome)}" ${form.bairro === b.nome ? 'selected' : ''}>${esc(b.nome)} · ${b.taxa ? brl(b.taxa) : 'grátis'}</option>`).join('')}</select>` : ''}
              ${form.tipo === 'entrega' ? `<label class="rotulo-bloco" for="f-end">Endereço de entrega</label><textarea id="f-end" maxlength="200" placeholder="${temBairros() ? 'Rua, número e ponto de referência' : 'Rua, número, bairro e ponto de referência'}">${esc(form.endereco)}</textarea>` : (l.endereco ? `<p class="retirada-em">${icone('local')}Retirada em: ${esc(l.endereco)}</p>` : '')}
            </section>

            <section class="bloco">
              <h2>Pagamento</h2>
              <div class="escolhas">${l.pagamentos.map((k) => `<label class="escolha"><input type="radio" name="pgto" value="${k}" ${form.pagamento === k ? 'checked' : ''}> ${ROTULO[k]}</label>`).join('')}</div>
              ${form.pagamento === 'dinheiro' ? `<label class="rotulo-bloco" for="f-troco">Troco para quanto? (opcional)</label><input type="text" id="f-troco" maxlength="30" placeholder="Ex.: R$ 100" value="${esc(form.troco)}">` : ''}
              <label class="rotulo-bloco" for="f-obs">Observação do pedido (opcional)</label><textarea id="f-obs" maxlength="200">${esc(form.obs)}</textarea>
            </section>
          </div>

          <aside class="bloco resumo-lateral">
            <h2>Resumo</h2>
            <div class="resumo"><div><span>Subtotal</span><span>${brl(subtotal())}</span></div>
              ${form.tipo === 'entrega' ? `<div><span>Entrega</span><span>${temBairros() && !bairroEscolhido() ? 'escolha o bairro' : (taxa() ? brl(taxa()) : 'grátis')}</span></div>` : ''}
              <div class="total"><span>Total</span><span>${brl(total)}</span></div></div>
            ${botao}
          </aside>
        </form>
        <div class="barra-enviar"><div class="conteudo"><div class="total-mini"><small>Total</small><strong>${brl(total)}</strong></div>${botao}</div></div>
      </div>`;
    mascaraTelefone($app.querySelector('#f-fone'));
  }

  function lerForm() {
    const v = (id) => $app.querySelector(id)?.value ?? '';
    if ($app.querySelector('#f-nome')) { form.cliente = v('#f-nome'); form.telefone = v('#f-fone'); form.obs = v('#f-obs'); }
    if ($app.querySelector('#f-end')) form.endereco = v('#f-end');
    if ($app.querySelector('#f-bairro')) form.bairro = v('#f-bairro');
    if ($app.querySelector('#f-troco')) form.troco = v('#f-troco');
    const tipo = $app.querySelector('input[name=tipo]:checked'); if (tipo) form.tipo = tipo.value;
    const pg = $app.querySelector('input[name=pgto]:checked'); if (pg) form.pagamento = pg.value;
  }

  function desenharSucesso() {
    window.scrollTo({ top: 0 });
    $app.innerHTML = `
      <div class="pagina-carrinho">${topo}
        <div class="bloco sucesso-pagina"><div class="sucesso"><div class="selo" aria-hidden="true">✓</div>
          <h2>Pedido #${resposta.numero} registrado</h2>
          <p>Falta só um passo: envie o pedido para o WhatsApp do restaurante para ele confirmar com você.</p>
          <a class="botao-whats" href="${esc(resposta.whatsappUrl)}" target="_blank" rel="noopener">Enviar pelo WhatsApp</a>
          <a class="botao-claro link-botao" href="${voltarHref}">Voltar ao cardápio</a>
          <p style="font-size:.85rem">Total: ${brl(resposta.total)}</p></div></div>
      </div>`;
  }

  $app.addEventListener('click', (e) => {
    const m = e.target.closest('[data-menos]'), p = e.target.closest('[data-mais]'), r = e.target.closest('[data-remover]');
    if (!m && !p && !r) return;
    lerForm();
    if (m) { const i = carrinho[Number(m.dataset.menos)]; i.qtd = Math.max(1, i.qtd - 1); }
    if (p) { const i = carrinho[Number(p.dataset.mais)]; i.qtd = Math.min(50, i.qtd + 1); }
    if (r) carrinho.splice(Number(r.dataset.remover), 1);
    salvarCarrinho(); desenhar();
  });
  $app.addEventListener('change', (e) => {
    if (e.target.name === 'tipo' || e.target.name === 'pgto' || e.target.id === 'f-bairro') { lerForm(); desenhar(); }
  });
  $app.addEventListener('submit', async (e) => {
    e.preventDefault();
    lerForm();
    const botoes = [...$app.querySelectorAll('[data-enviar]')];
    botoes.forEach((b) => { b.disabled = true; b.textContent = 'Enviando...'; });
    try {
      resposta = await api('POST', `/api/loja/${encodeURIComponent(slug)}/pedidos`, {
        ...form, itens: carrinho.map((i) => ({ produtoId: i.produtoId, nome: i.nome, qtd: i.qtd, adicionais: i.adicionais, obs: i.obs })),
      });
      gravarLocal('cliente', { cliente: form.cliente, telefone: form.telefone, endereco: form.endereco, bairro: form.bairro });
      carrinho = []; salvarCarrinho();
      desenhar();
      window.open(resposta.whatsappUrl, '_blank', 'noopener');
    } catch (err) {
      erro = err.message; desenhar();
      $app.querySelector('.alerta-form')?.scrollIntoView({ block: 'center' });
    }
  });
  desenhar();
}

iniciar();