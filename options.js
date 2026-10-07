const container = document.querySelector("#sites");
const empty = document.querySelector("#empty");

async function getSites() {
  return (await chrome.storage.local.get("sites")).sites || {};
}

function intervalLabel(value) {
  return value < 1 ? "30 seg" : `${value} min`;
}

async function render() {
  const sites = await getSites();
  const entries = Object.entries(sites);
  empty.hidden = entries.length > 0;
  container.replaceChildren(...entries.map(([origin, site]) => {
    const row = document.createElement("article");
    row.className = "site";
    const info = document.createElement("div");
    const title = document.createElement("h2");
    title.textContent = new URL(origin).hostname;
    const detail = document.createElement("small");
    detail.textContent = `${site.method === "activity" ? "Atividade suave" : "Pedido autenticado"} · ${intervalLabel(site.interval)}`;
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
}

document.querySelector("#removeAll").addEventListener("click", async () => {
  const sites = await getSites();
  const kept = Object.fromEntries(Object.entries(sites).filter(([, site]) => site.enabled));
  await chrome.storage.local.set({ sites: kept });
  render();
});
chrome.storage.onChanged.addListener(render);
render();
