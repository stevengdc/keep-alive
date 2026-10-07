const ALARM_PREFIX = "keep-alive:";
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
  }
};

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
    if (site.onlyWhenTabOpen !== false) {
      site.lastStatus = "no-tab";
      site.lastRun = Date.now();
      sites[origin] = site;
      await storage.setSites(sites);
      return { ok: false, reason: "no-tab" };
    }
    return { ok: false, reason: "no-tab" };
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
          return { ok: true, status: "activity" };
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
        return { ok: response.ok, status: response.status };
      },
      args: [site]
    });

    site.lastRun = Date.now();
    site.lastStatus = result?.ok ? "ok" : `http-${result?.status || "error"}`;
    site.failures = result?.ok ? 0 : (site.failures || 0) + 1;
    sites[origin] = site;
    await storage.setSites(sites);
    return { ok: Boolean(result?.ok), status: result?.status };
  } catch (error) {
    site.lastRun = Date.now();
    site.lastStatus = "error";
    site.failures = (site.failures || 0) + 1;
    sites[origin] = site;
    await storage.setSites(sites);
    return { ok: false, reason: error.message };
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
