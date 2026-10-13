# Criar perfis de site para o Keep Alive

Um perfil descreve como a extensão deve reconhecer e manter a sessão de um domínio. É um ficheiro JSON declarativo: não contém nem executa JavaScript.

## Segurança

Nunca inclua no perfil cookies, palavras-passe, códigos 2FA, `access_token`, `refresh_token`, cabeçalhos de autorização ou dados pessoais. Use apenas nomes de operações, campos e métodos observados no código da aplicação.

Antes de importar, confirme sempre o domínio em `matches`. A extensão rejeita estratégias desconhecidas e padrões que não tenham o formato `https://dominio/*`.

## Estratégias suportadas

- `authenticated-fetch`: pedido autenticado genérico à página ou endpoint configurado.
- `activity`: eventos locais de atividade; a eficácia depende do site.
- `apollo-refresh`: renovação através de um cliente Apollo existente na página e atualização do estado de sessão.

## Exemplo completo

```json
{
  "schemaVersion": 1,
  "id": "global-trusted-sign-support",
  "version": 1,
  "name": "Global Trusted Sign Support",
  "description": "Renova o token e o relógio interno da sessão.",
  "matches": [
    "https://support.globaltrustedsign.com/*"
  ],
  "interval": {
    "mode": "random",
    "minMinutes": 4,
    "maxMinutes": 7
  },
  "strategy": {
    "type": "apollo-refresh",
    "endpoint": "https://api.globaltrustedsign.com/graphql",
    "operation": "refreshToken",
    "field": "refreshToken",
    "variable": "refresh_token",
    "updateMethod": "changeSession",
    "tokenFields": {
      "access": "access_token",
      "refresh": "refresh_token",
      "expiresIn": "expires_in"
    }
  },
  "detection": {
    "requires": [
      "api.client.query",
      "methods.isLoggedIn",
      "methods.changeSession"
    ]
  }
}
```

## Prompt para uma IA

Anexe um HAR sanitizado e, se necessário, pequenos trechos dos bundles JavaScript. Remova previamente valores de cookies, tokens, cabeçalhos de autorização, parâmetros OAuth, dados pessoais e corpos de formulários.

Use este prompt:

```text
Analisa os ficheiros fornecidos e cria um perfil JSON para a extensão Keep Alive.

Objetivo:
- identificar o domínio exato;
- identificar se existe refresh de sessão REST ou GraphQL;
- encontrar apenas nomes de operação, variável, campos de resposta e método usado pela própria aplicação para atualizar a sessão;
- determinar um intervalo seguro a partir de expires_in, deixando pelo menos 30% de margem;
- não incluir cookies, tokens, credenciais, valores de cabeçalhos ou dados pessoais.

Estratégias permitidas: authenticated-fetch, activity, apollo-refresh.
O resultado deve ser apenas um objeto JSON compatível com schemaVersion 1.
Não inventes nomes. Se não houver evidência suficiente para apollo-refresh, usa authenticated-fetch.

Para apollo-refresh são obrigatórios:
strategy.operation
strategy.endpoint
strategy.field
strategy.variable
strategy.updateMethod
strategy.tokenFields.access
strategy.tokenFields.refresh
strategy.tokenFields.expiresIn

Formato de matches: https://dominio/*
IDs: apenas letras minúsculas, números e hífen.
```

## Validação e importação

1. Abra **Gerir todos os sites**.
2. Clique em **Importar perfil**.
3. Escolha o ficheiro `.json` ou `.keepalive.json`.
4. Confirme que aparece em **Integrações instaladas**.
5. Abra o site, ative-o e use **Testar agora**.
6. Consulte o log antes de confiar no perfil durante longos períodos.

Perfis gerados por IA são propostas. A extensão valida a estrutura, mas não consegue garantir que os nomes encontrados pertencem ao mecanismo correto ou que o site não mudou.
