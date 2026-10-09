const ALARM_PREFIX = "keep-alive:";
const LOG_LIMIT = 100;
const DEFAULTS = {
  enabled: true,
  interval: 5,
  intervalMode: "fixed",
  intervalMin: 5,
  intervalMax: 10,
  method: "fetch",
  endpoint: "",
  onlyWhenTabOpen: true,
  notifyOnFailure: false,
  failureLimit: 3,
  failures: 0,
  lastRun: null,
  lastStatus: "waiting"
};

const storage = {
  async getSites() {
    const { sites = {} } = await chrome.storage.local.get("sites");
    return sites;
  },
  async setSites(sites) {
    await chrome.storage.local.set({ sites });
  },
  async appendLog(origin, entry) {
    const { logs = {} } = await chrome.storage.local.get("logs");
    logs[origin] = [entry, ...(logs[origin] || [])].slice(0, LOG_LIMIT);
    await chrome.storage.local.set({ logs });
  }
};

function safeUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "";
  }
}

async function recordResult(origin, site, data) {
  const timestamp = Date.now();
  site.lastRun = timestamp;
  site.lastStatus = data.outcome;
  site.failures = data.ok ? 0 : (site.failures || 0) + 1;
  const sites = await storage.getSites();
  sites[origin] = site;
  await storage.setSites(sites);
  await storage.appendLog(origin, {
    timestamp,
    source: data.source,
    method: site.method,
    scheduledInterval: site.nextInterval ?? null,
    outcome: data.outcome,
    ok: data.ok,
    status: data.status ?? null,
    requestedUrl: safeUrl(data.requestedUrl),
    finalUrl: safeUrl(data.finalUrl),
    redirected: Boolean(data.redirected),
    tabFrozen: Boolean(data.tabFrozen),
    tabDiscarded: Boolean(data.tabDiscarded),
    message: data.message || ""
  });
  return data;
}

function alarmName(origin) {
  return `${ALARM_PREFIX}${encodeURIComponent(origin)}`;
}

function getIntervalBounds(site) {
  if (site.intervalMode === "random" || site.intervalMode === "custom") {
    const first = Math.max(0.5, Number(site.intervalMin) || 5);
    const second = Math.max(0.5, Number(site.intervalMax) || 10);
    return [Math.min(first, second), Math.max(first, second)];
  }
  const fixed = Math.max(0.5, Number(site.interval) || 5);
  return [fixed, fixed];
}

function chooseInterval(site) {
  const [min, max] = getIntervalBounds(site);
  return Math.round((min + Math.random() * (max - min)) * 100) / 100;
}

async function applyGlobalTrustedSignSchedule() {
  const origin = "https://support.globaltrustedsign.com";
  const sites = await storage.getSites();
  if (!sites[origin]) return;
  if (
    sites[origin].intervalMode === "random" &&
    Number(sites[origin].intervalMin) === 4 &&
    Number(sites[origin].intervalMax) === 7
  ) return;
  sites[origin] = {
    ...sites[origin],
    intervalMode: "random",
    intervalMin: 4,
    intervalMax: 7
  };
  await storage.setSites(sites);
}

async function scheduleNext(origin) {
  const sites = await storage.getSites();
  const site = sites[origin];
  if (!site?.enabled) return;
  const interval = chooseInterval(site);
  site.nextInterval = interval;
  site.nextRun = Date.now() + interval * 60_000;
  sites[origin] = site;
  await storage.setSites(sites);
  await chrome.alarms.create(alarmName(origin), { delayInMinutes: interval });
}

async function syncAlarms() {
  const sites = await storage.getSites();
  const alarms = await chrome.alarms.getAll();
  await Promise.all(
    alarms
      .filter(({ name }) => name.startsWith(ALARM_PREFIX))
      .map(({ name }) => chrome.alarms.clear(name))
  );

  for (const [origin, site] of Object.entries(sites)) {
    if (!site.enabled) continue;
    const interval = chooseInterval(site);
    site.nextInterval = interval;
    site.nextRun = Date.now() + interval * 60_000;
    await chrome.alarms.create(alarmName(origin), { delayInMinutes: interval });
  }
  await storage.setSites(sites);
}

async function findMatchingTab(origin) {
  const tabs = await chrome.tabs.query({ url: `${origin}/*` });
  return tabs.find((tab) => tab.active) || tabs[0] || null;
}

async function runKeepAlive(origin, manual = false) {
  const sites = await storage.getSites();
  const site = sites[origin];
  if (!site || (!site.enabled && !manual)) return { ok: false, reason: "disabled" };

  const tab = await findMatchingTab(origin);
  if (!tab?.id) {
    return recordResult(origin, site, {
      ok: false,
      outcome: "no-tab",
      source: manual ? "manual" : "scheduled",
      message: "Não foi encontrado um separador aberto deste site."
    });
  }

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (config) => {
        if (config.method === "activity") {
          document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
          document.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            clientX: Math.max(1, Math.round(innerWidth / 2)),
            clientY: Math.max(1, Math.round(innerHeight / 2))
          }));
          return {
            ok: true,
            outcome: "activity-sent",
            requestedUrl: location.href,
            finalUrl: location.href,
            message: "Eventos de atividade emitidos; a renovação da sessão não pode ser confirmada."
          };
        }

        // Global Trusted Sign mantém o relógio da sessão no estado do cliente
        // Apollo. Um fetch ao HTML não passa por esse cliente e não conta como
        // atividade. Localizamos o contexto React já autenticado e fazemos a
        // query oficial de verificação sem ler, copiar ou guardar tokens.
        if (location.hostname === "support.globaltrustedsign.com") {
          if (/^\/login(?:\/|$)/i.test(location.pathname)) {
            return {
              ok: false,
              outcome: "authentication-required",
              status: 401,
              requestedUrl: location.href,
              finalUrl: location.href,
              message: "A aplicação já se encontra na página de autenticação."
            };
          }

          const rootElement = document.querySelector("#root") || document.documentElement;
          const reactKey = Object.keys(rootElement).find((key) =>
            key.startsWith("__reactContainer$") || key.startsWith("__reactFiber$")
          );
          const rootFiber = reactKey ? rootElement[reactKey] : null;
          const stack = rootFiber ? [rootFiber] : [];
          const visited = new Set();
          let appContext = null;

          while (stack.length && visited.size < 25000) {
            const fiber = stack.pop();
            if (!fiber || visited.has(fiber)) continue;
            visited.add(fiber);
            const candidates = [fiber.memoizedProps?.value, fiber.pendingProps?.value];
            appContext = candidates.find((value) =>
              value?.api?.client && typeof value.api.client.query === "function" &&
              value?.state?.session && typeof value?.methods?.isLoggedIn === "function" &&
              typeof value?.methods?.changeSession === "function"
            ) || null;
            if (appContext) break;
            if (fiber.child) stack.push(fiber.child);
            if (fiber.sibling) stack.push(fiber.sibling);
          }

          if (!appContext?.methods?.isLoggedIn()) {
            return {
              ok: false,
              outcome: "app-client-unavailable",
              requestedUrl: location.href,
              finalUrl: location.href,
              message: "Não foi possível encontrar uma sessão autenticada no cliente da aplicação."
            };
          }

          const makeName = (value) => ({ kind: "Name", value });
          const makeField = (name) => ({
            kind: "Field",
            name: makeName(name),
            arguments: [],
            directives: []
          });
          const nameField = makeField("name");
          const userField = {
            kind: "Field",
            name: makeName("user"),
            arguments: [],
            directives: [],
            selectionSet: { kind: "SelectionSet", selections: [nameField] }
          };
          const checkAuthenticationQuery = {
            kind: "Document",
            definitions: [{
              kind: "OperationDefinition",
              operation: "query",
              name: makeName("checkAuthentication"),
              variableDefinitions: [],
              directives: [],
              selectionSet: { kind: "SelectionSet", selections: [userField] }
            }]
          };

          const session = appContext.state.session?.params || appContext.state.session;
          const sessionUser = session?.user;
          // Os tokens renovados por este serviço expiram em 600 segundos.
          // Cada execução usa por isso o refresh token rotativo, garantindo
          // uma margem segura com o intervalo específico de 4–7 minutos.
          const shouldRefresh = Boolean(sessionUser?.refreshToken);

          if (shouldRefresh) {
            if (typeof appContext.methods.changeSession !== "function") {
              return {
                ok: false,
                outcome: "app-client-unavailable",
                requestedUrl: "https://api.globaltrustedsign.com/graphql",
                finalUrl: location.href,
                message: "O cliente da aplicação não expõe o método changeSession necessário para atualizar a sessão."
              };
            }

            const refreshTokenField = {
              kind: "Field",
              name: makeName("refreshToken"),
              arguments: [{
                kind: "Argument",
                name: makeName("refresh_token"),
                value: { kind: "Variable", name: makeName("refresh_token") }
              }],
              directives: [],
              selectionSet: {
                kind: "SelectionSet",
                selections: ["access_token", "refresh_token", "expires_in"].map(makeField)
              }
            };
            const refreshTokenQuery = {
              kind: "Document",
              definitions: [{
                kind: "OperationDefinition",
                operation: "query",
                name: makeName("refreshToken"),
                variableDefinitions: [{
                  kind: "VariableDefinition",
                  variable: { kind: "Variable", name: makeName("refresh_token") },
                  type: {
                    kind: "NonNullType",
                    type: { kind: "NamedType", name: makeName("String") }
                  },
                  directives: []
                }],
                directives: [],
                selectionSet: { kind: "SelectionSet", selections: [refreshTokenField] }
              }]
            };

            const refreshed = await appContext.api.client.query({
              query: refreshTokenQuery,
              variables: { refresh_token: sessionUser.refreshToken },
              fetchPolicy: "no-cache",
              errorPolicy: "all",
              context: { noLoading: true }
            });
            const token = refreshed?.data?.refreshToken;
            if (!token?.access_token || !token?.refresh_token || refreshed?.errors?.length) {
              return {
                ok: false,
                outcome: "refresh-failed",
                status: 401,
                requestedUrl: "https://api.globaltrustedsign.com/graphql",
                finalUrl: location.href,
                redirected: false,
                message: "A aplicação não conseguiu renovar preventivamente o token da sessão."
              };
            }

            const expiresInMinutes = Math.max(1, Number(token.expires_in || 600) / 60);
            appContext.methods.changeSession({
              sessionCreatedDate: new Date().toISOString(),
              user: {
                accessToken: token.access_token,
                refreshToken: token.refresh_token,
                refreshTokenExpiresIn: expiresInMinutes
              }
            });

            return {
              ok: true,
              outcome: "token-refreshed",
              status: 200,
              requestedUrl: "https://api.globaltrustedsign.com/graphql",
              finalUrl: location.href,
              redirected: false,
              message: "Token e relógio interno da sessão renovados através do método nativo da aplicação."
            };
          }

          const response = await appContext.api.client.query({
            query: checkAuthenticationQuery,
            fetchPolicy: "no-cache",
            context: { noLoading: true }
          });
          const verified = Boolean(response?.data?.user?.name) && !response?.errors?.length;
          return {
            ok: verified,
            outcome: verified ? "session-verified" : "authentication-required",
            status: verified ? 200 : 401,
            requestedUrl: "https://api.globaltrustedsign.com/graphql",
            finalUrl: location.href,
            redirected: false,
            message: verified
              ? "Sessão confirmada pelo cliente autenticado da aplicação."
              : "A API não confirmou a sessão do utilizador."
          };
        }

        const target = config.endpoint || location.href;
        const targetUrl = new URL(target, location.href);
        if (targetUrl.origin !== location.origin) {
          throw new Error("O endpoint tem de pertencer ao mesmo site.");
        }
        const response = await fetch(target, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          redirect: "follow"
        });

        const contentType = response.headers.get("content-type") || "";
        let looksLikeLogin = false;
        if (contentType.includes("text/html")) {
          try {
            const sample = (await response.clone().text()).slice(0, 65536).toLowerCase();
            looksLikeLogin = /erro\s*401|authorization required|autorização requerida|efetue login|faça login|type=["']password["']/.test(sample);
          } catch {
            // A resposta pode não permitir leitura; o estado HTTP continua a ser registado.
          }
        }
        const finalUrl = new URL(response.url);
        const isLoginUrl = /(?:login|signin|sign-in|auth|sso)/i.test(finalUrl.pathname);
        const authenticationRequired = response.status === 401 || response.status === 403 || looksLikeLogin || isLoginUrl;
        const ok = response.ok && !authenticationRequired;
        return {
          ok,
          outcome: authenticationRequired ? "authentication-required" : (response.ok ? "request-accepted" : "http-error"),
          status: response.status,
          requestedUrl: targetUrl.href,
          finalUrl: response.url,
          redirected: response.redirected,
          message: authenticationRequired
            ? "A resposta parece ser uma página de autenticação; a sessão já não estava válida."
            : (response.ok
              ? "O servidor aceitou o pedido, mas só o próprio site pode confirmar se a sessão foi renovada."
              : `O servidor respondeu com HTTP ${response.status}.`)
        };
      },
      args: [{ ...site, forceTokenRefresh: manual }]
    });

    return recordResult(origin, site, {
      ...result,
      ok: Boolean(result?.ok),
      source: manual ? "manual" : "scheduled",
      tabFrozen: Boolean(tab.frozen),
      tabDiscarded: Boolean(tab.discarded)
    });
  } catch (error) {
    return recordResult(origin, site, {
      ok: false,
      outcome: tab.discarded ? "tab-discarded" : "execution-error",
      source: manual ? "manual" : "scheduled",
      tabFrozen: Boolean(tab.frozen),
      tabDiscarded: Boolean(tab.discarded),
      message: error.message
    });
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await applyGlobalTrustedSignSchedule();
  await syncAlarms();
});
chrome.runtime.onStartup.addListener(async () => {
  await applyGlobalTrustedSignSchedule();
  await syncAlarms();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.sites) return;
  const schedule = (sites = {}) => JSON.stringify(
    Object.fromEntries(Object.entries(sites).map(([origin, site]) => [origin, {
      enabled: site.enabled,
      interval: site.interval,
      intervalMode: site.intervalMode || "fixed",
      intervalMin: site.intervalMin,
      intervalMax: site.intervalMax
    }]))
  );
  if (schedule(changes.sites.oldValue) !== schedule(changes.sites.newValue)) syncAlarms();
});
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (!name.startsWith(ALARM_PREFIX)) return;
  const origin = decodeURIComponent(name.slice(ALARM_PREFIX.length));
  runKeepAlive(origin).finally(() => scheduleNext(origin));
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "sync") syncAlarms().then(() => sendResponse({ ok: true }));
  else if (message.type === "run") runKeepAlive(message.origin, true).then(sendResponse);
  else return false;
  return true;
});
