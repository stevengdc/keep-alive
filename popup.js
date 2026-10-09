const $ = (selector) => document.querySelector(selector);
let origin;
let config;

const defaults = {
  enabled: false,
  interval: 5,
  intervalMode: "fixed",
  intervalMin: 5,
  intervalMax: 10,
  method: "fetch",
  endpoint: "",
  onlyWhenTabOpen: true,
  failures: 0,
  lastRun: null,
  lastStatus: "waiting"
};

async function save() {
  const { sites = {} } = await chrome.storage.local.get("sites");
  sites[origin] = config;
  await chrome.storage.local.set({ sites });
}

function render() {
  $("#enabled").checked = config.enabled;
  const intervalValue = config.intervalMode === "custom"
    ? "custom"
    : config.intervalMode === "random"
      ? `random:${config.intervalMin}:${config.intervalMax}`
      : `fixed:${config.interval}`;
  $("#interval").value = [...$("#interval").options].some((option) => option.value === intervalValue)
    ? intervalValue
    : "custom";
  $("#intervalMin").value = config.intervalMin;
  $("#intervalMax").value = config.intervalMax;
  $("#customInterval").hidden = config.intervalMode !== "custom";
  $("#method").value = config.method;
  $("#endpoint").value = config.endpoint || "";
  $("#endpointRow").hidden = config.method !== "fetch";
  const intervalLabel = config.intervalMode === "fixed"
    ? (config.interval < 1 ? "30 segundos" : `${config.interval} min`)
    : `${config.intervalMin}–${config.intervalMax} min aleatório`;
  $("#summary").textContent = config.enabled
    ? `Ativo · ${intervalLabel}`
    : "Desativado neste site";
  if (config.lastRun) {
    const when = new Date(config.lastRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const labels = {
      "request-accepted": "pedido aceite pelo servidor",
      "session-verified": "sessão confirmada pela aplicação",
      "token-refreshed": "token da sessão renovado",
      "refresh-failed": "falha ao renovar o token",
      "activity-sent": "atividade emitida",
      "authentication-required": "sessão expirada",
      "http-error": "erro HTTP",
      "no-tab": "separador não encontrado",
      "tab-discarded": "separador descartado",
      "execution-error": "erro de execução",
      "app-client-unavailable": "cliente da aplicação indisponível",
      "ok": "pedido aceite"
    };
    $("#status").textContent = `Última tentativa às ${when}: ${labels[config.lastStatus] || config.lastStatus}`;
  }
}

async function toggleEnabled() {
  const next = $("#enabled").checked;
  if (next) {
    const granted = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!granted) {
      $("#enabled").checked = false;
      $("#status").className = "status error";
      $("#status").textContent = "É necessária permissão para aceder a este site.";
      return;
    }
  }
  config.enabled = next;
  await save();
  render();
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try { url = new URL(tab.url); } catch { /* ignored */ }
  if (!url || !["http:", "https:"].includes(url.protocol)) {
    $("#unsupported").hidden = false;
    return;
  }
  origin = url.origin;
  $("#host").textContent = url.hostname;
  $("#app").hidden = false;
  const { sites = {} } = await chrome.storage.local.get("sites");
  config = { ...defaults, ...sites[origin] };
  const isEdge = /Edg\//.test(navigator.userAgent);
  $("#browserName").textContent = isEdge ? "Edge" : "Chrome";
  $("#performanceSettings").addEventListener("click", () => {
    chrome.tabs.create({
      url: isEdge
        ? "edge://settings/system/managePerformance"
        : "chrome://settings/performance"
    });
  });
  render();

  $("#enabled").addEventListener("change", toggleEnabled);
  $("#interval").addEventListener("change", async (event) => {
    const [mode, first, second] = event.target.value.split(":");
    config.intervalMode = mode;
    if (mode === "fixed") config.interval = Number(first);
    if (mode === "random") {
      config.intervalMin = Number(first);
      config.intervalMax = Number(second);
    }
    await save();
    render();
  });
  const saveCustomInterval = async () => {
    config.intervalMin = Math.max(0.5, Number($("#intervalMin").value) || 5);
    config.intervalMax = Math.max(config.intervalMin, Number($("#intervalMax").value) || 10);
    await save();
    render();
  };
  $("#intervalMin").addEventListener("change", saveCustomInterval);
  $("#intervalMax").addEventListener("change", saveCustomInterval);
  $("#method").addEventListener("change", async (event) => { config.method = event.target.value; await save(); render(); });
  $("#endpoint").addEventListener("change", async (event) => { config.endpoint = event.target.value.trim(); await save(); });
  $("#test").addEventListener("click", async () => {
    const button = $("#test");
    button.disabled = true;
    $("#status").className = "status";
    $("#status").textContent = "A enviar sinal…";
    const result = await chrome.runtime.sendMessage({ type: "run", origin });
    $("#status").className = `status ${result.ok ? "ok" : "error"}`;
    $("#status").textContent = result.ok
      ? (result.message || "Pedido aceite pelo servidor; renovação não confirmada.")
      : (result.message || `Não foi possível enviar: ${result.status || "erro"}`);
    button.disabled = false;
  });
  $("#options").addEventListener("click", () => chrome.runtime.openOptionsPage());
}

init();
