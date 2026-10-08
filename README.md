# Keep Alive

Extensão para Chromium que evita que sessões web expirem por inatividade. Cada site é ativado individualmente e os dados permanecem no navegador.

## Funcionalidades

- Ativação independente por domínio.
- Intervalos fixos, aleatórios predefinidos e intervalos mínimo/máximo personalizados.
- Pedido `GET` autenticado à página atual ou a um endpoint definido pelo utilizador.
- Modo alternativo de atividade suave para aplicações que renovam a sessão por eventos.
- Teste imediato e estado da última tentativa.
- Histórico das últimas 100 tentativas por site, com estado HTTP e diagnóstico.
- Deteção de respostas `401`/`403`, redirecionamentos e páginas de login devolvidas com HTTP `200`.
- Exportação do histórico em JSON.
- Integração específica com o cliente GraphQL/Apollo do Global Trusted Sign, incluindo renovação preventiva da sessão a cada 20 minutos.
- Atalho contextual para as definições de desempenho do Chrome ou Edge e aviso sobre suspensão do computador.
- Página de gestão de todos os sites.
- Permissões de acesso pedidas apenas para os domínios ativados.

## Instalar localmente

1. Abra `chrome://extensions` (Chrome) ou `edge://extensions` (Edge).
2. Ative o **Modo de programador**.
3. Clique em **Carregar sem compactação**.
4. Escolha esta pasta.
5. Abra o site pretendido, clique em **Keep Alive** e ative-o.

## Como funciona

O service worker agenda um alarme para cada site ativo. Quando chega a hora, a extensão procura um separador aberto desse domínio e executa nele o método escolhido. No modo normal, faz um pedido com os cookies da sessão. No modo de atividade, emite eventos não intrusivos sem mover o cursor real.

> O Keep Alive não guarda credenciais nem envia dados para serviços externos. Na integração Global Trusted Sign, os tokens são utilizados apenas na memória da própria página para renovar a sessão e nunca são devolvidos à extensão, registados ou persistidos. Um website pode aplicar políticas que impeçam este tipo de renovação; use a extensão apenas onde estiver autorizado.

## Desenvolvimento

Não há processo de build nem dependências. Depois de alterar os ficheiros, clique em **Recarregar** na página de extensões.

## Licença

[GPL-3.0](LICENSE)
