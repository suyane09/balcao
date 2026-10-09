/* Funções compartilhadas pelas páginas */

export async function api(metodo, url, corpo) {
  const opcoes = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (corpo !== undefined) {
    opcoes.headers['Content-Type'] = 'application/json';
    opcoes.body = JSON.stringify(corpo);
  }
  let resp;
  try { resp = await fetch(url, opcoes); }
  catch { throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.'); }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(dados.erro || 'Algo deu errado. Tente novamente.');
    e.status = resp.status;
    throw e;
  }
  return dados;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const brl = (centavos) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* "12,50" -> 1250 */
export function paraCentavos(texto) {
  const limpo = String(texto ?? '').replace(/[^\d,.]/g, '');
  if (!limpo) return 0;
  const normal = limpo.includes(',') ? limpo.replace(/\./g, '').replace(',', '.') : limpo;
  const n = Number(normal);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
export const deCentavos = (c) => (c / 100).toFixed(2).replace('.', ',');

export function mascaraTelefone(input) {
  input.addEventListener('input', () => {
    let d = input.value.replace(/\D/g, '').slice(0, 11);
    if (d.length > 6) d = d.replace(/^(\d{2})(\d{4,5})(\d{4}).*/, '($1) $2-$3');
    else if (d.length > 2) d = d.replace(/^(\d{2})(\d+)/, '($1) $2');
    else if (d.length) d = `(${d}`;
    input.value = d;
  });
}

let timerToast;
export function aviso(mensagem, tipo = 'ok') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.textContent = mensagem;
  el.className = `toast toast-${tipo} visivel`;
  clearTimeout(timerToast);
  timerToast = setTimeout(() => el.classList.remove('visivel'), 3600);
}

/* Reduz a imagem no navegador antes de enviar (economiza espaço e banda) */
export function reduzirImagem(arquivo, maxLado, qualidade = 0.8) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpe?g|webp)$/.test(arquivo.type)) return reject(new Error('Use uma imagem PNG, JPG ou WebP.'));
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', qualidade));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível ler essa imagem.')); };
    img.src = url;
  });
}

export async function enviarImagem(arquivo, maxLado, qualidade) {
  const dataUrl = await reduzirImagem(arquivo, maxLado, qualidade);
  return api('POST', '/api/painel/imagem', { dataUrl });
}

export function horaCurta(iso) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
