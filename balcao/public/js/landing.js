import { brl } from './comum.js';

const PLANO = 7900; // centavos
const TAXA = 0.152; // 12% de comissão + 3,2% de pagamento online

const vendas = document.getElementById('vendas');
const pct = document.getElementById('pct');

function calcular() {
  const v = Number(vendas.value) * 100;
  const p = Number(pct.value) / 100;
  const taxasHoje = Math.round(v * TAXA);
  const evitadas = Math.round(v * p * TAXA);
  const sobra = evitadas - PLANO;
  document.getElementById('vendas-v').textContent = brl(v);
  document.getElementById('pct-v').textContent = `${pct.value}%`;
  document.getElementById('taxas').textContent = brl(taxasHoje);
  document.getElementById('economia').textContent = brl(evitadas);
  document.getElementById('sobra').textContent = brl(Math.max(sobra, 0));
  document.getElementById('sobra-txt').textContent =
    sobra >= 0 ? 'Sobra no seu bolso por mês' : 'Com esses números o plano ainda não se paga';
}
vendas.addEventListener('input', calcular);
pct.addEventListener('input', calcular);
calcular();
