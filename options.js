const container = document.querySelector("#sites");
const empty = document.querySelector("#empty");
const logContainer = document.querySelector("#logs");
const noLogs = document.querySelector("#noLogs");

async function getSites() {
  return (await chrome.storage.local.get("sites")).sites || {};
}

async function getLogs() {
  return (await chrome.storage.local.get("logs")).logs || {};
}

const outcomeLabels = {
  "request-accepted": "Pedido aceite",
  "session-verified": "Sessão confirmada",
  "activity-sent": "Atividade emitida",
  "authentication-required": "Sessão expirada",
  "http-error": "Erro HTTP",
  "no-tab": "Sem separador",
  "tab-discarded": "Separador descartado",
  "execution-error": "Erro de execução",
  "app-client-unavailable": "Cliente indisponível"
};

function intervalLabel(value) {
  return value < 1 ? "30 seg" : `${value} min`;
}

function siteIntervalLabel(site) {
  return site.intervalMode === "random" || site.intervalMode === "custom"
    ? `${site.intervalMin}–${site.intervalMax} min aleatório`
    : intervalLabel(site.interval);
}

async function render() {
  const sites = await getSites();
  const logs = await getLogs();
  const entries = Object.entries(sites);
  empty.hidden = entries.length > 0;
  container.replaceChildren(...entries.map(([origin, site]) => {
    const row = document.createElement("article");
    row.className = "site";
    const info = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = new URL(origin).hostname;
    const detail = document.createElement("small");
    detail.textContent = `${site.method === "activity" ? "Atividade suave" : "Pedido autenticado"} · ${siteIntervalLabel(site)}`;
    info.append(title, detail);
    const status = document.createElement("span");
    status.className = `pill ${site.enabled ? "on" : ""}`;
    status.textContent = site.enabled ? "ATIVO" : "INATIVO";
    const remove = document.createElement("button");
    remove.className = "delete";
    remove.textContent = "Remover";
    remove.addEventListener("click", async () => {
      const current = await getSites();
      delete current[origin];
      await chrome.storage.local.set({ sites: current });
      await chrome.permissions.remove({ origins: [`${origin}/*`] });
      render();
    });
    row.append(info, status, remove);
    return row;
  }));

  const allLogs = Object.entries(logs)
    .flatMap(([origin, records]) => records.map((record) => ({ origin, ...record })))
    .sort((a, b) => b.timestamp - a.timestamp);
  noLogs.hidden = allLogs.length > 0;
  logContainer.replaceChildren(...allLogs.map((entry) => {
    const row = document.createElement("div");
    row.className = "log-row";
    const time = document.createElement("time");
    time.dateTime = new Date(entry.timestamp).toISOString();
    time.textContent = new Date(entry.timestamp).toLocaleString();
    const host = document.createElement("span");
    host.textContent = new URL(entry.origin).hostname;
    const result = document.createElement("span");
    result.className = `result ${entry.ok ? "ok" : "fail"}`;
    result.textContent = `${outcomeLabels[entry.outcome] || entry.outcome}${entry.status ? ` (${entry.status})` : ""}`;
    const message = document.createElement("span");
    message.className = "message";
    const tabState = entry.tabDiscarded ? " [separador descartado]" : (entry.tabFrozen ? " [separador congelado]" : "");
    message.textContent = `${entry.message || "—"}${tabState}`;
    if (entry.finalUrl) message.title = `URL final: ${entry.finalUrl}`;
    row.append(time, host, result, message);
    return row;
  }));
}

document.querySelector("#removeAll").addEventListener("click", async () => {
  const sites = await getSites();
  const kept = Object.fromEntries(Object.entries(sites).filter(([, site]) => site.enabled));
  await chrome.storage.local.set({ sites: kept });
  render();
});
document.querySelector("#clearLogs").addEventListener("click", async () => {
  await chrome.storage.local.remove("logs");
  render();
});
document.querySelector("#exportLogs").addEventListener("click", async () => {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), logs: await getLogs() }, null, 2);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  link.download = `keep-alive-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});
chrome.storage.onChanged.addListener(render);
render();
