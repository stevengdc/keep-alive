const container = document.querySelector("#sites");
const empty = document.querySelector("#empty");
const logContainer = document.querySelector("#logs");
const noLogs = document.querySelector("#noLogs");
const profileContainer = document.querySelector("#profiles");

async function getCustomProfiles() {
  return (await chrome.storage.local.get("customProfiles")).customProfiles || [];
}

function downloadJson(filename, value) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function getSites() {
  return (await chrome.storage.local.get("sites")).sites || {};
}

async function getLogs() {
  return (await chrome.storage.local.get("logs")).logs || {};
}

const outcomeLabels = {
  "request-accepted": "Pedido aceite",
  "session-verified": "Sessão confirmada",
  "token-refreshed": "Token renovado",
  "refresh-failed": "Falha na renovação",
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
  const customProfiles = await getCustomProfiles();
  const profiles = [...customProfiles, ...KeepAliveProfiles.builtIns];
  profileContainer.replaceChildren(...profiles.map((profile) => {
    const chip = document.createElement("div");
    chip.className = "profile-chip";
    const text = document.createElement("span");
    text.textContent = `${profile.name} · ${profile.strategy.type}${KeepAliveProfiles.builtIns.some((item) => item.id === profile.id) ? " · integrado" : ""}`;
    chip.append(text);
    if (!KeepAliveProfiles.builtIns.some((item) => item.id === profile.id)) {
      const remove = document.createElement("button");
      remove.textContent = "Remover";
      remove.addEventListener("click", async () => {
        await chrome.storage.local.set({ customProfiles: customProfiles.filter((item) => item.id !== profile.id) });
      });
      chip.append(remove);
    }
    return chip;
  }));
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
    const exportProfile = document.createElement("button");
    exportProfile.className = "delete";
    exportProfile.textContent = "Exportar perfil";
    exportProfile.addEventListener("click", () => {
      const profile = KeepAliveProfiles.find(origin, customProfiles) || {
        schemaVersion: 1,
        id: new URL(origin).hostname.replace(/[^a-z0-9]+/gi, "-").toLowerCase(),
        version: 1,
        name: new URL(origin).hostname,
        matches: [`${origin}/*`],
        interval: {
          mode: site.intervalMode,
          minMinutes: site.intervalMode === "fixed" ? site.interval : site.intervalMin,
          maxMinutes: site.intervalMode === "fixed" ? site.interval : site.intervalMax
        },
        strategy: { type: site.method === "activity" ? "activity" : "authenticated-fetch" }
      };
      downloadJson(`${profile.id}.keepalive.json`, profile);
    });
    row.append(info, status, exportProfile, remove);
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
  downloadJson(`keep-alive-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, { exportedAt: new Date().toISOString(), logs: await getLogs() });
});
document.querySelector("#exportProfiles").addEventListener("click", async () => {
  downloadJson("keep-alive-profiles.json", {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    profiles: [...await getCustomProfiles(), ...KeepAliveProfiles.builtIns]
  });
});
document.querySelector("#importProfile").addEventListener("click", () => document.querySelector("#profileFile").click());
document.querySelector("#profileFile").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const incoming = Array.isArray(payload.profiles) ? payload.profiles : [payload];
    const invalid = incoming.map((profile) => ({ profile, result: KeepAliveProfiles.validate(profile) })).filter(({ result }) => !result.ok);
    if (invalid.length) throw new Error(invalid.flatMap(({ result }) => result.errors).join("\n"));
    const current = await getCustomProfiles();
    const merged = new Map(current.map((profile) => [profile.id, profile]));
    for (const profile of incoming) merged.set(profile.id, profile);
    await chrome.storage.local.set({ customProfiles: [...merged.values()] });
    alert(`${incoming.length} perfil/perfis importado(s).`);
  } catch (error) {
    alert(`Perfil inválido:\n${error.message}`);
  } finally {
    event.target.value = "";
  }
});
chrome.storage.onChanged.addListener(render);
render();
