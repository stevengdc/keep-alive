# Privacidade

O Keep Alive armazena localmente apenas a configuração definida pelo utilizador: domínio, intervalo, método, endpoint opcional e estado da última tentativa.

A extensão não recolhe telemetria, não contém analytics, não guarda palavras-passe e não envia informações para servidores próprios ou de terceiros. Os pedidos de manutenção de sessão são feitos diretamente ao website escolhido e usam a sessão já existente no navegador.

Perfis importados e resultados do analisador local ficam guardados apenas em `chrome.storage.local`. O analisador não envia páginas, cookies, tokens ou histórico para serviços externos. Uma futura integração opcional com uma API deverá usar um backend próprio, sanitização explícita e consentimento separado; nenhuma chave de API é incluída na extensão.
