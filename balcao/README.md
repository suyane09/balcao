# Balcão

Plataforma de delivery com a marca de cada restaurante. O dono se cadastra, monta o cardápio, escolhe cores, logo e fonte, e ganha um link próprio (`seusite.com/nome-do-restaurante`). O cliente pede pelo celular, o pedido aparece no painel (com aviso sonoro) e chega pronto no WhatsApp do restaurante. Sem comissão por pedido: você cobra uma mensalidade.

## O que já funciona

- **Página de venda** com calculadora de economia (taxa de aplicativo versus plano).
- **Cadastro e login** de restaurantes, com 7 dias de teste grátis.
- **Painel do restaurante:** pedidos em colunas (novo, em preparo, saiu, finalizado) com som, cardápio com categorias, fotos, preços e adicionais, abrir e fechar a loja, taxa de entrega única ou **por bairro**, pedido mínimo, formas de pagamento, link e QR code, troca de senha.
- **Loja do cliente** com a identidade do restaurante (cor, logo, banner, fonte moderna, clássica ou divertida, tema claro ou escuro), carrinho, adicionais, observações, escolha de bairro, entrega ou retirada, e envio do pedido pelo WhatsApp.
- **Admin (você):** lista de restaurantes, botão `+30 dias` quando o restaurante paga, desativar e reativar, e **link de nova senha** para quem esqueceu (você envia pelo WhatsApp).
- Os preços são sempre recalculados no servidor, então o cliente não consegue alterar valores.

## Rodar no VS Code (Windows, Mac ou Linux)

1. Instale o **Node.js** (versão LTS em nodejs.org). Precisa ser 22.13 ou mais novo. Para conferir, abra um terminal e rode `node -v`.
2. Extraia o `balcao.zip`. No VS Code, vá em **Arquivo > Abrir Pasta** e escolha a pasta `balcao`.
3. Abra o arquivo `.env` e troque `ADMIN_EMAIL` pelo e-mail que você vai usar para criar a sua conta. Só esse e-mail enxerga a área `/admin`.
4. Abra o terminal do VS Code (**Ctrl + '** ou menu Terminal > Novo Terminal) e rode:
   ```bash
   npm install
   npm start
   ```
5. Abra `http://localhost:3000` no navegador.
6. Vá em `/cadastro` e crie a sua conta com o e-mail do `ADMIN_EMAIL`. Depois entre em `http://localhost:3000/admin`.

Dicas:
- **F5** no VS Code também liga o servidor (já está configurado em `.vscode/launch.json`) e permite depurar.
- `npm run dev` reinicia o servidor sozinho quando você mexe no `server.js`. Mudanças em `public/` aparecem ao atualizar a página (Ctrl + F5).
- Para parar o servidor, use **Ctrl + C** no terminal.
- Para ver no celular, conecte o celular no mesmo Wi-Fi e abra `http://IP-DO-SEU-COMPUTADOR:3000` (no Windows, rode `ipconfig` e veja o "Endereço IPv4"). Se o Windows perguntar sobre o firewall, permita.
- Para zerar os dados de teste, pare o servidor e apague a pasta `dados/`.

## Colocar no ar

O banco é um arquivo SQLite (pasta `dados/`), então o servidor precisa de **disco persistente**. Sem isso, os cadastros somem a cada reinício.

1. **VPS simples** (uma máquina pequena basta): instale o Node 22, copie a pasta, rode com `pm2` ou `systemd` e coloque o Nginx ou o Caddy na frente para ter HTTPS.
2. **Railway, Render ou Fly.io:** use o `Dockerfile` e monte um volume em `/dados`. Defina as variáveis do `.env.example` no painel da hospedagem.
3. **Domínio:** aponte o seu domínio para o servidor e defina `BASE_URL`. Use HTTPS, para o cookie de login ser marcado como seguro.

Faça backup da pasta `dados/` com frequência. Ela guarda o banco e as imagens.

## Como cobrar

O plano está em R$ 79 por mês (altere em `public/index.html` e `public/js/landing.js`). O fluxo é manual de propósito, para você começar sem integrar gateway de pagamento:

1. O restaurante testa por 7 dias.
2. Perto do vencimento, o painel mostra um aviso com botão que abre o seu WhatsApp.
3. Ele paga por Pix.
4. Em `/admin`, você clica em `+30 dias`.

Se o plano vence, a loja fica indisponível para os clientes e o cardápio continua guardado.

## Senha esquecida

O sistema não envia e-mails. Na tela de login, "Esqueci minha senha" abre o seu WhatsApp (o número vem de `PLATAFORMA_WHATSAPP`). Em `/admin`, clique em **Link de senha** na linha do restaurante e envie pelo WhatsApp. O link vale 1 hora e só funciona uma vez.

## O que ainda não existe

- Pagamento online dentro da loja (o cliente paga na entrega: Pix, cartão ou dinheiro).
- Acompanhamento do pedido pelo cliente depois de enviado.
- Cobrança automática da mensalidade.
- Envio de e-mails.

## Estrutura

```
server.js                           API, banco SQLite e páginas
.env                                configuração local
public/index.html                   página de venda
public/cadastro.html, entrar.html   acesso dos restaurantes
public/redefinir.html               nova senha pelo link do admin
public/painel.html + js/painel.js   painel do restaurante
public/loja.html + js/loja.js       loja do cliente (tema por restaurante)
public/admin.html                   administração da plataforma
```
