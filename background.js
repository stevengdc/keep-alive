const ALARM_PREFIX = "keep-alive:";
const LOG_LIMIT = 100;
const DEFAULTS = {
  enabled: true,
  interval: 5,
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

async function syncAlarms() {
  const sites = await storage.getSites();
  const alarms = await chrome.alarms.getAll();
  await Promise.all(
    alarms
      .filter(({ name }) => name.startsWith(ALARM_PREFIX))
      .map(({ name }) => chrome.alarms.clear(name))
  );

  await Promise.all(
    Object.entries(sites)
      .filter(([, site]) => site.enabled)
      .map(([origin, site]) =>
        chrome.alarms.create(alarmName(origin), {
          delayInMinutes: Math.max(0.5, Number(site.interval) || 5),
          periodInMinutes: Math.max(0.5, Number(site.interval) || 5)
        })
      )
  );
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
        const redirectedToLogin = response.redirected && /(?:login|signin|sign-in|auth|sso)/i.test(finalUrl.pathname);
        const authenticationRequired = response.status === 401 || response.status === 403 || looksLikeLogin || redirectedToLogin;
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
      args: [site]
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

chrome.runtime.onInstalled.addListener(syncAlarms);
chrome.runtime.onStartup.addListener(syncAlarms);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.sites) return;
  const schedule = (sites = {}) => JSON.stringify(
    Object.fromEntries(Object.entries(sites).map(([origin, site]) => [origin, {
      enabled: site.enabled,
      interval: site.interval
    }]))
  );
  if (schedule(changes.sites.oldValue) !== schedule(changes.sites.newValue)) syncAlarms();
});
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name.startsWith(ALARM_PREFIX)) runKeepAlive(decodeURIComponent(name.slice(ALARM_PREFIX.length)));
});
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "sync") syncAlarms().then(() => sendResponse({ ok: true }));
  else if (message.type === "run") runKeepAlive(message.origin, true).then(sendResponse);
  else return false;
  return true;
});
