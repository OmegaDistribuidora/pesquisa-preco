# Pesquisa de Preco

Sistema web com frontend React e backend Express para pesquisas anonimas de preco, pronto para usar Postgres via `DATABASE_URL`.

## Recursos iniciais

- Listagem publica de pesquisas disponiveis por data de inicio/fim.
- Respostas anonimas com protecoes contra abuso e suporte a mais de uma resposta por usuario.
- Login administrativo via variaveis de ambiente.
- Criacao de pesquisas com resposta curta, longa, opcoes, lista suspensa, classificacao e upload avulso ou junto de pergunta.
- Validacao de texto, inteiro, decimal brasileiro e moeda em reais.
- Painel admin com previa das respostas e exportacao para CSV compativel com Excel.

## Variaveis de ambiente

Copie `.env.example` para `.env` em desenvolvimento ou configure no Railway:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/pesquisa_preco
ADMIN_LOGIN=admin
ADMIN_PASSWORD=troque-esta-senha
SESSION_SECRET=troque-este-segredo
PORT=3000
```

Em desenvolvimento, se `ADMIN_LOGIN` e `ADMIN_PASSWORD` nao estiverem definidos, o backend le `credenciais.txt`. Esse arquivo esta no `.gitignore` e nao deve ser enviado ao GitHub.

## Rodando localmente

Instale as dependencias:

```bash
npm install
```

Suba um Postgres local e aponte `DATABASE_URL`. Exemplo com Docker, caso esteja disponivel na maquina:

```bash
docker run --name pesquisa-preco-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=pesquisa_preco -p 5432:5432 -d postgres:16
```

Inicie o backend:

```bash
npm run dev
```

Para desenvolver o frontend com recarregamento automatico, use outro terminal:

```bash
npm run dev:client
```

Para simular producao:

```bash
npm run build
npm start
```

## Railway

O projeto roda como um unico processo no Railway: o Express serve a API e tambem o frontend React buildado. Nao e necessario criar um servico separado para frontend.

Configure um servico Postgres no Railway e adicione `DATABASE_URL`, `ADMIN_LOGIN`, `ADMIN_PASSWORD`, `SESSION_SECRET` e `UPLOAD_DIR` no servico web. Para imagens/arquivos, crie um volume no Railway e monte no caminho usado em `UPLOAD_DIR`, por exemplo `/data/uploads`.

`PUBLIC_BASE_URL` e opcional. Se ficar vazio, o sistema monta links publicos de arquivos usando o proprio dominio da requisicao. Use essa variavel apenas se quiser forcar um dominio especifico, como um dominio customizado.

O comando de build e `npm run build`; o comando de start e `npm start`.
