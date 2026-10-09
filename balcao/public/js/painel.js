import { api, esc, brl, paraCentavos, deCentavos, mascaraTelefone, aviso, enviarImagem, horaCurta } from './comum.js';

const estado = {
  eu: null, loja: null, cardapio: [], pedidos: [], aba: 'pedidos',
  conhecidos: new Set(), primeira: true, som: false,
};
const $app = document.getElementById('app');
const CORES = ['#E4572E', '#C62828', '#F77F00', '#E0A100', '#2A9D8F', '#1D7A46', '#277DA1', '#5F4B8B', '#C2185B', '#2B2B2B'];
const ABAS = [['pedidos', 'Pedidos'], ['cardapio', 'Cardápio'], ['loja', 'Minha loja'], ['divulgar', 'Divulgar']];
const ROTULO_PGTO = { pix: 'Pix', cartao: 'Cartão na entrega', dinheiro: 'Dinheiro' };

/* ---------- inicialização ---------- */
async function iniciar() {
  const eu = await api('GET', '/api/eu').catch(() => ({ usuario: null }));
  if (!eu.usuario || !eu.loja) { location.replace('/entrar'); return; }
  estado.eu = eu; estado.loja = eu.loja;
  estado.aba = ABAS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : 'pedidos';
  montarEstrutura();
  await Promise.all([carregarPedidos(), carregarCardapio()]);
  renderAba();
  setInterval(carregarPedidos, 10000);
  window.addEventListener('hashchange', () => {
    const k = location.hash.slice(1);
    if (ABAS.some(([a]) => a === k)) { estado.aba = k; atualizarAbas(); renderAba(); }
  });
}

function diasRestantes(venc) {
  return Math.ceil((new Date(`${venc}T23:59:59`) - new Date()) / 864e5);
}
const dataBR = (iso) => iso.split('-').reverse().join('/');

function montarEstrutura() {
  const l = estado.loja;
  $app.innerHTML = `
    <header class="painel-topo"><div class="interno">
      <a class="marca" href="/" aria-label="Balcão">balcão</a>
      <span class="nome-loja" id="nome-loja"></span>
      <label class="chave"><input type="checkbox" id="chave-aberta" ${l.aberta ? 'checked' : ''}><span class="trilho"></span><span id="txt-aberta"></span></label>
      <a class="botao pequeno" id="ver-loja" target="_blank" rel="noopener">Ver loja</a>
      ${estado.eu.admin ? '<a class="botao pequeno" href="/admin">Admin</a>' : ''}
      <button class="botao pequeno" id="sair">Sair</button>
    </div></header>
    <div id="aviso-plano"></div>
    <nav class="abas" aria-label="Seções"><div class="interno" role="tablist" id="abas"></div></nav>
    <main class="conteudo" id="conteudo"></main>`;
  atualizarCabecalho();
  atualizarAbas();
  document.getElementById('chave-aberta').addEventListener('change', async (e) => {
    try {
      estado.loja = await api('PUT', '/api/painel/loja', { aberta: e.target.checked });
      atualizarCabecalho();
      aviso(estado.loja.aberta ? 'Loja aberta. Os clientes já podem pedir.' : 'Loja fechada. Os clientes veem o cardápio, mas não pedem.');
    } catch (err) { e.target.checked = !e.target.checked; aviso(err.message, 'erro'); }
  });
  document.getElementById('sair').addEventListener('click', async () => {
    await api('POST', '/api/sair').catch(() => {});
    location.href = '/entrar';
  });
}

function atualizarCabecalho() {
  const l = estado.loja;
  document.getElementById('nome-loja').textContent = l.nome;
  document.getElementById('txt-aberta').textContent = l.aberta ? 'Loja aberta' : 'Loja fechada';
  const ver = document.getElementById('ver-loja');
  ver.href = `/${l.slug}`;
  const dias = diasRestantes(l.vencimento);
  const caixa = document.getElementById('aviso-plano');
  const numero = estado.eu.plataformaWhatsapp;
  const texto = encodeURIComponent(`Olá! Quero ativar o plano do Balcão para a loja ${l.nome}.`);
  const botao = numero ? `<a class="botao pequeno" target="_blank" rel="noopener" href="https://wa.me/${numero}?text=${texto}">Falar sobre o plano</a>` : '';
  if (!l.ativa) {
    caixa.innerHTML = `<div class="aviso-plano vencido"><div class="interno"><span>Sua loja está indisponível para os clientes desde ${dataBR(l.vencimento)}. Renove o plano para voltar a receber pedidos.</span>${botao}</div></div>`;
  } else if (dias <= 5) {
    caixa.innerHTML = `<div class="aviso-plano"><div class="interno"><span>Seu plano vence ${dias <= 0 ? 'hoje' : `em ${dias} ${dias === 1 ? 'dia' : 'dias'}`} (${dataBR(l.vencimento)}).</span>${botao}</div></div>`;
  } else caixa.innerHTML = '';
}

function atualizarAbas() {
  const novos = estado.pedidos.filter((p) => p.status === 'novo').length;
  document.getElementById('abas').innerHTML = ABAS.map(([k, nome]) => `
    <button role="tab" aria-selected="${estado.aba === k}" data-aba="${k}">${nome}${k === 'pedidos' && novos ? `<span class="contador" aria-label="${novos} pedidos novos">${novos}</span>` : ''}</button>`).join('');
  document.title = `${novos ? `(${novos}) ` : ''}Painel · Balcão`;
}

document.addEventListener('click', (e) => {
  const aba = e.target.closest('[data-aba]');
  if (aba) { estado.aba = aba.dataset.aba; history.replaceState(null, '', `#${estado.aba}`); atualizarAbas(); renderAba(); return; }
  const a = e.target.closest('[data-acao]');
  if (a && acoes[a.dataset.acao]) acoes[a.dataset.acao](a, e);
});

function renderAba() {
  const alvo = document.getElementById('conteudo');
  if (estado.aba === 'pedidos') renderPedidos(alvo);
  else if (estado.aba === 'cardapio') renderCardapio(alvo);
  else if (estado.aba === 'loja') renderLoja(alvo);
  else renderDivulgar(alvo);
}

/* ---------- pedidos ---------- */
async function carregarPedidos() {
  let lista;
  try { lista = await api('GET', '/api/painel/pedidos'); }
  catch (err) { if (err.status === 401) location.replace('/entrar'); return; }
  const novosChegaram = lista.filter((p) => p.status === 'novo' && !estado.conhecidos.has(p.id));
  lista.forEach((p) => estado.conhecidos.add(p.id));
  estado.pedidos = lista;
  atualizarAbas();
  if (!estado.primeira && novosChegaram.length) {
    tocarAviso();
    aviso(novosChegaram.length === 1 ? `Pedido novo: #${novosChegaram[0].numero}` : `${novosChegaram.length} pedidos novos`);
  }
  estado.primeira = false;
  if (estado.aba === 'pedidos' && !document.querySelector('dialog[open]')) renderPedidos(document.getElementById('conteudo'));
}

let audioCtx;
function tocarAviso() {
  if (!estado.som) return;
  try {
    audioCtx ??= new AudioContext();
    [0, 0.22, 0.44].forEach((atraso, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = i % 2 ? 660 : 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + atraso);
      g.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + atraso + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + atraso + 0.2);
      o.connect(g).connect(audioCtx.destination);
      o.start(audioCtx.currentTime + atraso); o.stop(audioCtx.currentTime + atraso + 0.22);
    });
  } catch { /* sem áudio disponível */ }
}

function cartaoPedido(p) {
  const itens = p.itens.map((i) => `
    <li>${i.qtd}x ${esc(i.nome)}</li>
    ${i.adicionais.length ? `<li class="sub-item">+ ${esc(i.adicionais.join(', '))}</li>` : ''}
    ${i.obs ? `<li class="sub-item">Obs: ${esc(i.obs)}</li>` : ''}`).join('');
  const fone = `55${p.telefone}`;
  const botoes = {
    novo: `<button class="botao primario pequeno" data-acao="status" data-id="${p.id}" data-status="preparo">Aceitar</button>
           <button class="botao perigo pequeno" data-acao="status" data-id="${p.id}" data-status="cancelado">Recusar</button>`,
    preparo: `<button class="botao primario pequeno" data-acao="status" data-id="${p.id}" data-status="pronto">${p.tipo === 'entrega' ? 'Saiu para entrega' : 'Pronto para retirar'}</button>`,
    pronto: `<button class="botao primario pequeno" data-acao="status" data-id="${p.id}" data-status="entregue">Concluir</button>`,
    entregue: '', cancelado: '',
  }[p.status];
  return `
    <article class="pedido ${p.status === 'novo' ? 'novo' : ''}">
      <div class="cab"><span class="num">#${p.numero}</span><span class="hora">${horaCurta(p.criado_em)}</span></div>
      <div><strong>${esc(p.cliente)}</strong> <span class="etiqueta ${p.tipo === 'entrega' ? '' : 'alerta'}">${p.tipo === 'entrega' ? 'Entrega' : 'Retirada'}</span></div>
      <ul>${itens}</ul>
      ${p.tipo === 'entrega' ? `<div class="info">${esc(p.endereco)}${p.bairro ? ` · ${esc(p.bairro)}` : ''}</div>` : ''}
      <div class="info">${ROTULO_PGTO[p.pagamento] || esc(p.pagamento)}${p.troco ? ` · troco para ${esc(p.troco)}` : ''}</div>
      ${p.obs ? `<div class="info">Obs: ${esc(p.obs)}</div>` : ''}
      <div class="total"><span>Total</span><span>${brl(p.total)}</span></div>
      <div class="acoes">${botoes}
        <a class="botao pequeno" target="_blank" rel="noopener" href="https://wa.me/${fone}">WhatsApp</a>
        ${p.status === 'cancelado' ? '<span class="etiqueta erro">Cancelado</span>' : ''}${p.status === 'entregue' ? '<span class="etiqueta ok">Concluído</span>' : ''}
      </div>
    </article>`;
}

function renderPedidos(alvo) {
  const por = (...s) => estado.pedidos.filter((p) => s.includes(p.status));
  const colunas = [
    ['Novos', por('novo')], ['Em preparo', por('preparo')], ['Saíram ou prontos', por('pronto')],
    ['Finalizados', por('entregue', 'cancelado').slice(0, 12)],
  ];
  const total = estado.pedidos.length;
  alvo.innerHTML = `
    <div class="cabecalho-sessao">
      <h2>Pedidos</h2>
      <button class="botao pequeno" data-acao="som">${estado.som ? 'Som ativado' : 'Ativar aviso sonoro'}</button>
    </div>
    ${total ? '' : `<div class="vazio"><strong>Nenhum pedido por enquanto</strong>Compartilhe o link da sua loja para receber o primeiro. Os pedidos aparecem aqui e tocam um aviso.
      <div class="sugestoes"><button class="botao primario pequeno" data-aba="divulgar">Ver link e QR code</button></div></div>`}
    ${total ? `<div class="colunas-pedidos">${colunas.map(([nome, lista]) => `
      <section class="coluna"><h3>${nome} <span class="etiqueta">${lista.length}</span></h3>
        <div class="lista">${lista.map(cartaoPedido).join('') || '<div class="vazio" style="padding:1rem">Vazio</div>'}</div></section>`).join('')}</div>` : ''}`;
}

/* ---------- cardápio ---------- */
async function carregarCardapio() { estado.cardapio = await api('GET', '/api/painel/cardapio'); }

function renderCardapio(alvo) {
  const cats = estado.cardapio;
  alvo.innerHTML = `
    <div class="cabecalho-sessao"><h2>Cardápio</h2>
      <button class="botao primario" data-acao="nova-categoria">Nova categoria</button></div>
    ${cats.length ? cats.map((c, ci) => `
      <section class="categoria">
        <header>
          <h3>${esc(c.nome)}</h3>
          <button class="botao pequeno fantasma" data-acao="mover-cat" data-id="${c.id}" data-dir="-1" ${ci === 0 ? 'disabled' : ''} aria-label="Subir categoria">▲</button>
          <button class="botao pequeno fantasma" data-acao="mover-cat" data-id="${c.id}" data-dir="1" ${ci === cats.length - 1 ? 'disabled' : ''} aria-label="Descer categoria">▼</button>
          <button class="botao pequeno" data-acao="renomear-cat" data-id="${c.id}">Renomear</button>
          <button class="botao pequeno perigo" data-acao="excluir-cat" data-id="${c.id}">Excluir</button>
          <button class="botao pequeno primario" data-acao="novo-produto" data-cat="${c.id}">Adicionar produto</button>
        </header>
        ${c.produtos.length ? c.produtos.map((p, pi) => `
          <div class="produto-linha ${p.disponivel ? '' : 'esgotado'}">
            <div class="miniatura" style="${p.imagem_id ? `background-image:url(/img/${p.imagem_id})` : ''}">${p.imagem_id ? '' : 'sem foto'}</div>
            <div><div class="nome">${esc(p.nome)}</div>
              <div class="detalhe">${brl(p.preco)}${p.adicionais.length ? ` · ${p.adicionais.length} adicionais` : ''}${p.disponivel ? '' : ' · esgotado'}</div></div>
            <div class="lado">
              <label class="chave" style="font-size:.9rem"><input type="checkbox" data-acao="disponivel" data-id="${p.id}" ${p.disponivel ? 'checked' : ''}><span class="trilho"></span>Disponível</label>
              <button class="botao pequeno fantasma" data-acao="mover-prod" data-id="${p.id}" data-dir="-1" ${pi === 0 ? 'disabled' : ''} aria-label="Subir produto">▲</button>
              <button class="botao pequeno fantasma" data-acao="mover-prod" data-id="${p.id}" data-dir="1" ${pi === c.produtos.length - 1 ? 'disabled' : ''} aria-label="Descer produto">▼</button>
              <button class="botao pequeno" data-acao="editar-produto" data-id="${p.id}">Editar</button>
            </div>
          </div>`).join('') : `<div class="vazio" style="border:0">Nenhum produto em ${esc(c.nome)}. Adicione o primeiro.</div>`}
      </section>`).join('') : `
      <div class="vazio"><strong>Seu cardápio está vazio</strong>Comece criando uma categoria. Depois adicione os produtos com foto e preço.
        <div class="sugestoes">${['Lanches', 'Pizzas', 'Porções', 'Bebidas', 'Sobremesas'].map((n) => `<button class="botao pequeno" data-acao="criar-cat-rapida" data-nome="${n}">${n}</button>`).join('')}</div></div>`}`;
}

function abrirDialogo(html) {
  const d = document.createElement('dialog');
  d.className = 'modal';
  d.innerHTML = html;
  d.addEventListener('close', () => d.remove());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  document.body.append(d);
  d.showModal();
  return d;
}

function dialogoNome(titulo, valor, aoSalvar) {
  const d = abrirDialogo(`<form method="dialog"><h2>${esc(titulo)}</h2>
    <div class="campo"><label for="nome-cat">Nome</label><input type="text" id="nome-cat" maxlength="40" value="${esc(valor)}" required></div>
    <div class="rodape-modal"><button class="botao" value="cancelar" formnovalidate>Cancelar</button><button class="botao primario" value="ok">Salvar</button></div></form>`);
  d.querySelector('input').focus();
  d.querySelector('form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    try { await aoSalvar(d.querySelector('input').value); d.close(); }
    catch (err) { aviso(err.message, 'erro'); }
  });
}

function dialogoProduto(produto, categoriaId) {
  const novo = !produto;
  const p = produto || { nome: '', descricao: '', preco: 0, imagem_id: null, adicionais: [], disponivel: true, categoria_id: categoriaId };
  let imagemId = p.imagem_id;
  const d = abrirDialogo(`<form method="dialog">
    <h2>${novo ? 'Novo produto' : 'Editar produto'}</h2>
    <div id="erro-prod" class="erro-form" role="alert" hidden></div>
    <div class="campo"><span class="rotulo">Foto</span>
      <div class="foto-campo"><div class="previa" id="previa"></div>
        <div><input type="file" id="foto" accept="image/png,image/jpeg,image/webp" hidden>
          <button type="button" class="botao pequeno" id="escolher-foto">Escolher foto</button>
          <button type="button" class="botao pequeno fantasma" id="tirar-foto">Remover</button><br>
          <small>Fotos boas vendem mais. Use uma imagem bem iluminada.</small></div></div></div>
    <div class="campo"><label for="p-nome">Nome</label><input type="text" id="p-nome" maxlength="80" value="${esc(p.nome)}" required></div>
    <div class="campo"><label for="p-desc">Descrição</label><textarea id="p-desc" maxlength="240" placeholder="Ingredientes, tamanho, o que vem junto...">${esc(p.descricao)}</textarea></div>
    <div class="grade-2">
      <div class="campo"><label for="p-preco">Preço</label><div class="prefixo"><span>R$</span><input type="text" id="p-preco" inputmode="decimal" value="${p.preco ? deCentavos(p.preco) : ''}" placeholder="0,00" required></div></div>
      <div class="campo"><label for="p-cat">Categoria</label><select id="p-cat">${estado.cardapio.map((c) => `<option value="${c.id}" ${c.id === p.categoria_id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></div>
    </div>
    <div class="campo"><span class="rotulo">Adicionais (opcional)</span><small>Ex.: bacon extra, queijo, molho especial.</small>
      <div id="adicionais"></div><button type="button" class="botao pequeno" id="mais-adicional">Adicionar adicional</button></div>
    <div class="campo"><label class="chave"><input type="checkbox" id="p-disp" ${p.disponivel ? 'checked' : ''}><span class="trilho"></span>Disponível para pedido</label></div>
    <div class="rodape-modal">
      ${novo ? '' : '<button type="button" class="botao perigo" id="excluir-prod" style="margin-right:auto">Excluir</button>'}
      <button class="botao" value="cancelar" formnovalidate>Cancelar</button><button class="botao primario" value="ok">Salvar produto</button>
    </div></form>`);
  const previa = d.querySelector('#previa');
  const atualizarPrevia = () => {
    previa.style.backgroundImage = imagemId ? `url(/img/${imagemId})` : '';
    previa.textContent = imagemId ? '' : 'sem foto';
  };
  atualizarPrevia();
  const lista = d.querySelector('#adicionais');
  const linha = (a = { nome: '', preco: 0 }) => {
    const el = document.createElement('div');
    el.className = 'linha-adicional';
    el.innerHTML = `<input type="text" placeholder="Nome" maxlength="40" value="${esc(a.nome)}" aria-label="Nome do adicional">
      <div class="prefixo"><span>R$</span><input type="text" inputmode="decimal" placeholder="0,00" value="${a.preco ? deCentavos(a.preco) : ''}" aria-label="Preço do adicional"></div>
      <button type="button" class="botao pequeno fantasma" aria-label="Remover adicional">✕</button>`;
    el.querySelector('button').addEventListener('click', () => el.remove());
    lista.append(el);
  };
  p.adicionais.forEach(linha);
  d.querySelector('#mais-adicional').addEventListener('click', () => linha());
  d.querySelector('#escolher-foto').addEventListener('click', () => d.querySelector('#foto').click());
  d.querySelector('#tirar-foto').addEventListener('click', () => { imagemId = null; atualizarPrevia(); });
  d.querySelector('#foto').addEventListener('change', async (e) => {
    const arq = e.target.files[0]; if (!arq) return;
    previa.textContent = 'enviando...';
    try { imagemId = (await enviarImagem(arq, 640, 0.78)).id; }
    catch (err) { aviso(err.message, 'erro'); }
    atualizarPrevia();
  });
  d.querySelector('#excluir-prod')?.addEventListener('click', async () => {
    if (!confirm(`Excluir "${p.nome}" do cardápio?`)) return;
    try { await api('DELETE', `/api/painel/produtos/${p.id}`); await carregarCardapio(); renderAba(); d.close(); aviso('Produto excluído.'); }
    catch (err) { aviso(err.message, 'erro'); }
  });
  d.querySelector('form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const adicionais = [...lista.children].map((el) => {
      const [nome, preco] = el.querySelectorAll('input');
      return { nome: nome.value.trim(), preco: paraCentavos(preco.value) };
    }).filter((a) => a.nome);
    const dados = {
      nome: d.querySelector('#p-nome').value, descricao: d.querySelector('#p-desc').value,
      preco: paraCentavos(d.querySelector('#p-preco').value), categoria_id: Number(d.querySelector('#p-cat').value),
      imagem_id: imagemId, adicionais, disponivel: d.querySelector('#p-disp').checked,
    };
    try {
      await (novo ? api('POST', '/api/painel/produtos', dados) : api('PUT', `/api/painel/produtos/${p.id}`, dados));
      await carregarCardapio(); renderAba(); d.close(); aviso('Produto salvo.');
    } catch (err) {
      const box = d.querySelector('#erro-prod'); box.textContent = err.message; box.hidden = false;
      box.scrollIntoView({ block: 'nearest' });
    }
  });
}

const achaProduto = (id) => estado.cardapio.flatMap((c) => c.produtos).find((p) => p.id === Number(id));
const recarregarCardapio = async () => { await carregarCardapio(); renderAba(); };

/* ---------- minha loja ---------- */
function renderLoja(alvo) {
  const l = estado.loja;
  const radio = (nome, valor, texto, atual) => `<label><input type="radio" name="${nome}" value="${valor}" ${atual === valor ? 'checked' : ''}><span>${texto}</span></label>`;
  alvo.innerHTML = `
    <div class="cabecalho-sessao"><h2>Minha loja</h2><span class="etiqueta ${l.ativa ? 'ok' : 'erro'}">Plano até ${dataBR(l.vencimento)}</span></div>
    <form id="form-loja" novalidate>
      <div id="erro-loja" class="erro-form" role="alert" hidden></div>
      <section class="secao-form"><h3>Identidade visual</h3>
        <div class="grade-2">
          <div class="campo"><span class="rotulo">Logo</span><div class="foto-campo"><div class="previa" id="previa-logo"></div>
            <div><input type="file" id="logo" accept="image/png,image/jpeg,image/webp" hidden><button type="button" class="botao pequeno" data-acao="escolher" data-alvo="logo">Escolher logo</button></div></div></div>
          <div class="campo"><span class="rotulo">Banner (foto de capa)</span><div class="foto-campo"><div class="previa" id="previa-banner" style="width:140px"></div>
            <div><input type="file" id="banner" accept="image/png,image/jpeg,image/webp" hidden><button type="button" class="botao pequeno" data-acao="escolher" data-alvo="banner">Escolher banner</button></div></div></div>
        </div>
        <div class="campo"><span class="rotulo">Cor da marca</span>
          <div class="cores" id="cores">${CORES.map((c) => `<button type="button" style="background:${c}" data-cor="${c}" aria-label="Cor ${c}" aria-pressed="${l.cor.toLowerCase() === c.toLowerCase()}"></button>`).join('')}
            <input type="color" id="cor" value="${l.cor}" aria-label="Escolher outra cor"></div></div>
        <div class="grade-2">
          <div class="campo"><span class="rotulo">Tema</span><div class="segmentado">${radio('tema', 'claro', 'Claro', l.tema)}${radio('tema', 'escuro', 'Escuro', l.tema)}</div></div>
          <div class="campo"><span class="rotulo">Fonte</span><div class="segmentado">${radio('fonte', 'moderna', 'Moderna', l.fonte)}${radio('fonte', 'classica', 'Clássica', l.fonte)}${radio('fonte', 'divertida', 'Divertida', l.fonte)}</div></div>
        </div>
        <div class="campo"><label for="descricao">Frase de apresentação</label><textarea id="descricao" maxlength="240" placeholder="Ex.: Smash burgers artesanais, feitos na hora.">${esc(l.descricao)}</textarea></div>
      </section>
      <section class="secao-form"><h3>Atendimento</h3>
        <div class="grade-2">
          <div class="campo"><label for="nome">Nome do restaurante</label><input type="text" id="nome" maxlength="60" value="${esc(l.nome)}" required></div>
          <div class="campo"><label for="whatsapp">WhatsApp que recebe os pedidos</label><input type="tel" id="whatsapp" inputmode="tel" value="${esc(l.whatsapp.replace(/^55/, ''))}"></div>
          <div class="campo"><label for="instagram">Instagram</label><div class="prefixo"><span>@</span><input type="text" id="instagram" maxlength="40" value="${esc(l.instagram)}"></div></div>
          <div class="campo"><label for="tempo">Tempo estimado</label><input type="text" id="tempo" maxlength="40" value="${esc(l.tempo)}" placeholder="Ex.: 40 a 60 min"></div>
          <div class="campo"><label for="horario">Horário de funcionamento</label><input type="text" id="horario" maxlength="120" value="${esc(l.horario)}" placeholder="Ex.: Ter a dom, 18h às 23h"></div>
          <div class="campo"><label for="endereco">Endereço do restaurante</label><input type="text" id="endereco" maxlength="160" value="${esc(l.endereco)}"></div>
          <div class="campo"><label for="taxa">Taxa de entrega (valor único)</label><div class="prefixo"><span>R$</span><input type="text" id="taxa" inputmode="decimal" value="${deCentavos(l.taxa_entrega)}"></div></div>
          <div class="campo"><label for="minimo">Pedido mínimo</label><div class="prefixo"><span>R$</span><input type="text" id="minimo" inputmode="decimal" value="${deCentavos(l.pedido_minimo)}"></div></div>
        </div>
        <div class="campo"><span class="rotulo">Taxa por bairro (opcional)</span>
          <small>Se você cadastrar bairros, o cliente escolhe o bairro e paga a taxa dele. Sem bairros, vale a taxa única acima.</small>
          <div id="bairros"></div><button type="button" class="botao pequeno" id="mais-bairro">Adicionar bairro</button></div>
        <div class="campo"><span class="rotulo">Como o cliente recebe</span><div class="checks">
          <label><input type="checkbox" id="entrega" ${l.entrega ? 'checked' : ''}> Entrega</label>
          <label><input type="checkbox" id="retirada" ${l.retirada ? 'checked' : ''}> Retirada no local</label></div></div>
        <div class="campo"><span class="rotulo">Formas de pagamento aceitas</span><div class="checks" id="pagamentos">
          ${Object.entries(ROTULO_PGTO).map(([k, n]) => `<label><input type="checkbox" value="${k}" ${l.pagamentos.includes(k) ? 'checked' : ''}> ${n}</label>`).join('')}</div></div>
      </section>
      <section class="secao-form"><h3>Endereço da sua loja na internet</h3>
        <div class="campo"><label for="slug">Final do link (letras minúsculas, números e hífen)</label><input type="text" id="slug" maxlength="40" value="${esc(l.slug)}">
          <small>Endereço completo: ${esc(location.host)}/<strong id="slug-previa">${esc(l.slug)}</strong>. Se você mudar o link, os endereços já divulgados deixam de funcionar.</small></div>
      </section>
      <button class="botao primario grande" id="salvar-loja">Salvar alterações</button>
    </form>
    <form id="form-senha" class="secao-form" style="margin-top:1.6rem" novalidate>
      <h3>Senha de acesso</h3>
      <div id="erro-senha" class="erro-form" role="alert" hidden></div>
      <div class="grade-2">
        <div class="campo"><label for="senha-atual">Senha atual</label><input type="password" id="senha-atual" autocomplete="current-password"></div>
        <div class="campo"><label for="senha-nova">Nova senha</label><input type="password" id="senha-nova" autocomplete="new-password" minlength="6"><small>Pelo menos 6 caracteres.</small></div>
      </div>
      <button class="botao">Alterar senha</button>
    </form>`;
  mascaraTelefone(document.getElementById('whatsapp'));
  const listaBairros = document.getElementById('bairros');
  const linhaBairro = (b = { nome: '', taxa: 0 }) => {
    const el = document.createElement('div');
    el.className = 'linha-adicional';
    el.innerHTML = `<input type="text" placeholder="Nome do bairro" maxlength="40" value="${esc(b.nome)}" aria-label="Nome do bairro">
      <div class="prefixo"><span>R$</span><input type="text" inputmode="decimal" placeholder="0,00" value="${b.taxa ? deCentavos(b.taxa) : ''}" aria-label="Taxa do bairro"></div>
      <button type="button" class="botao pequeno fantasma" aria-label="Remover bairro">✕</button>`;
    el.querySelector('button').addEventListener('click', () => el.remove());
    listaBairros.append(el);
  };
  l.bairros.forEach(linhaBairro);
  document.getElementById('mais-bairro').addEventListener('click', () => linhaBairro());
  document.getElementById('form-senha').addEventListener('submit', trocarSenha);
  const ids = { logo: l.logo_id, banner: l.banner_id };
  const previa = (k) => {
    const el = document.getElementById(`previa-${k}`);
    el.style.backgroundImage = ids[k] ? `url(/img/${ids[k]})` : '';
    el.textContent = ids[k] ? '' : 'sem imagem';
  };
  previa('logo'); previa('banner');
  alvo.dataset.ids = '';
  estadoForm.ids = ids; estadoForm.previa = previa;
  estadoForm.cor = l.cor;
  document.getElementById('cores').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cor]'); if (!b) return;
    estadoForm.cor = b.dataset.cor;
    document.getElementById('cor').value = b.dataset.cor;
    document.querySelectorAll('#cores [data-cor]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  });
  document.getElementById('cor').addEventListener('input', (e) => {
    estadoForm.cor = e.target.value;
    document.querySelectorAll('#cores [data-cor]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
  });
  ['logo', 'banner'].forEach((k) => document.getElementById(k).addEventListener('change', async (e) => {
    const arq = e.target.files[0]; if (!arq) return;
    try { ids[k] = (await enviarImagem(arq, k === 'logo' ? 360 : 1400, k === 'logo' ? 0.9 : 0.8)).id; previa(k); }
    catch (err) { aviso(err.message, 'erro'); }
  }));
  document.getElementById('slug').addEventListener('input', (e) => {
    document.getElementById('slug-previa').textContent = e.target.value.trim().toLowerCase();
  });
  document.getElementById('form-loja').addEventListener('submit', salvarLoja);
}
const estadoForm = { ids: {}, cor: '#E4572E' };

async function salvarLoja(e) {
  e.preventDefault();
  const v = (id) => document.getElementById(id).value;
  const erro = document.getElementById('erro-loja'); erro.hidden = true;
  const botao = document.getElementById('salvar-loja'); botao.disabled = true;
  try {
    estado.loja = await api('PUT', '/api/painel/loja', {
      nome: v('nome'), whatsapp: v('whatsapp'), instagram: v('instagram'), tempo: v('tempo'), horario: v('horario'),
      endereco: v('endereco'), descricao: v('descricao'), slug: v('slug'),
      taxa_entrega: paraCentavos(v('taxa')), pedido_minimo: paraCentavos(v('minimo')),
      entrega: document.getElementById('entrega').checked, retirada: document.getElementById('retirada').checked,
      pagamentos: [...document.querySelectorAll('#pagamentos input:checked')].map((i) => i.value),
      bairros: [...document.querySelectorAll('#bairros .linha-adicional')].map((el) => {
        const [nome, taxa] = el.querySelectorAll('input');
        return { nome: nome.value.trim(), taxa: paraCentavos(taxa.value) };
      }).filter((b) => b.nome),
      cor: estadoForm.cor, tema: document.querySelector('input[name=tema]:checked').value,
      fonte: document.querySelector('input[name=fonte]:checked').value,
      logo_id: estadoForm.ids.logo ?? null, banner_id: estadoForm.ids.banner ?? null,
    });
    atualizarCabecalho();
    aviso('Alterações salvas.');
  } catch (err) {
    erro.textContent = err.message; erro.hidden = false; erro.scrollIntoView({ block: 'center' });
  } finally { botao.disabled = false; }
}

async function trocarSenha(e) {
  e.preventDefault();
  const erro = document.getElementById('erro-senha'); erro.hidden = true;
  try {
    await api('POST', '/api/painel/senha', {
      atual: document.getElementById('senha-atual').value, nova: document.getElementById('senha-nova').value,
    });
    e.target.reset();
    aviso('Senha alterada.');
  } catch (err) { erro.textContent = err.message; erro.hidden = false; }
}

/* ---------- divulgar ---------- */
function renderDivulgar(alvo) {
  const url = `${location.origin}/${estado.loja.slug}`;
  alvo.innerHTML = `
    <div class="cabecalho-sessao"><h2>Divulgar</h2></div>
    <div class="divulgar">
      <div>
        <div class="secao-form"><h3>O link da sua loja</h3>
          <div class="link-copia"><input type="text" readonly id="link" value="${esc(url)}" aria-label="Link da loja">
            <button class="botao primario" data-acao="copiar">Copiar link</button>
            <a class="botao" target="_blank" rel="noopener" href="${esc(url)}">Abrir loja</a></div>
          <ul class="dicas">
            <li>Coloque o link na bio do Instagram e na descrição do perfil no Google.</li>
            <li>Cole o QR code na sacola e na caixa de quem pede pelo aplicativo. Na próxima vez, o cliente pede direto com você.</li>
            <li>Mande o link no status do WhatsApp quando lançar uma promoção.</li>
          </ul></div>
      </div>
      <div class="qr"><img src="/api/qr?url=${encodeURIComponent(url)}" alt="QR code da sua loja" width="228" height="228">
        <a class="botao pequeno" style="margin-top:.8rem" href="/api/qr?url=${encodeURIComponent(url)}" download="qrcode-${esc(estado.loja.slug)}.svg">Baixar QR code</a></div>
    </div>`;
}

/* ---------- ações ---------- */
const acoes = {
  async status(el) {
    try {
      await api('PATCH', `/api/painel/pedidos/${el.dataset.id}`, { status: el.dataset.status });
      await carregarPedidos();
    } catch (err) { aviso(err.message, 'erro'); }
  },
  som() {
    estado.som = !estado.som;
    if (estado.som) tocarAviso();
    renderPedidos(document.getElementById('conteudo'));
  },
  'nova-categoria'() { dialogoNome('Nova categoria', '', async (n) => { await api('POST', '/api/painel/categorias', { nome: n }); await recarregarCardapio(); }); },
  async 'criar-cat-rapida'(el) { try { await api('POST', '/api/painel/categorias', { nome: el.dataset.nome }); await recarregarCardapio(); } catch (err) { aviso(err.message, 'erro'); } },
  'renomear-cat'(el) {
    const c = estado.cardapio.find((x) => x.id === Number(el.dataset.id));
    dialogoNome('Renomear categoria', c.nome, async (n) => { await api('PUT', `/api/painel/categorias/${c.id}`, { nome: n }); await recarregarCardapio(); });
  },
  async 'excluir-cat'(el) {
    const c = estado.cardapio.find((x) => x.id === Number(el.dataset.id));
    const aviso1 = c.produtos.length ? ` Os ${c.produtos.length} produtos dela também serão excluídos.` : '';
    if (!confirm(`Excluir a categoria "${c.nome}"?${aviso1}`)) return;
    try { await api('DELETE', `/api/painel/categorias/${c.id}`); await recarregarCardapio(); aviso('Categoria excluída.'); } catch (err) { aviso(err.message, 'erro'); }
  },
  async 'mover-cat'(el) { await api('POST', `/api/painel/categorias/${el.dataset.id}/mover`, { dir: Number(el.dataset.dir) }).catch((e) => aviso(e.message, 'erro')); await recarregarCardapio(); },
  async 'mover-prod'(el) { await api('POST', `/api/painel/produtos/${el.dataset.id}/mover`, { dir: Number(el.dataset.dir) }).catch((e) => aviso(e.message, 'erro')); await recarregarCardapio(); },
  'novo-produto'(el) { dialogoProduto(null, Number(el.dataset.cat)); },
  'editar-produto'(el) { dialogoProduto(achaProduto(el.dataset.id)); },
  async disponivel(el) {
    const p = achaProduto(el.dataset.id);
    try {
      await api('PUT', `/api/painel/produtos/${p.id}`, { ...p, disponivel: el.checked });
      await recarregarCardapio();
    } catch (err) { el.checked = !el.checked; aviso(err.message, 'erro'); }
  },
  escolher(el) { document.getElementById(el.dataset.alvo).click(); },
  async copiar() {
    const campo = document.getElementById('link');
    try { await navigator.clipboard.writeText(campo.value); aviso('Link copiado.'); }
    catch { campo.select(); aviso('Selecione e copie o link.'); }
  },
};

iniciar();
