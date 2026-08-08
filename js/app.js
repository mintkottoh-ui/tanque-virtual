"use strict";

/* ---------------------------------------------------------
   Estado e persistência
--------------------------------------------------------- */

const STORAGE_KEY = "tanqueVirtual:v1";

const DEFAULT_STATE = {
  config: {
    capacityL: 45,
    kmLGasolina: 12,
    ethanolFactor: 0.7,
    kmLDiesel: 14,
    prices: {
      gasolina: 6.09,
      etanol: 4.29,
      diesel: 6.29
    }
  },
  tank: {
    currentFuel: "gasolina",
    currentL: 22.5
  },
  history: []
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    // merge com defaults para tolerar versões antigas / campos ausentes
    return {
      config: { ...DEFAULT_STATE.config, ...parsed.config, prices: { ...DEFAULT_STATE.config.prices, ...(parsed.config && parsed.config.prices) } },
      tank: { ...DEFAULT_STATE.tank, ...parsed.tank },
      history: Array.isArray(parsed.history) ? parsed.history : []
    };
  } catch (e) {
    console.error("Falha ao ler estado salvo, usando padrão.", e);
    return structuredClone(DEFAULT_STATE);
  }
}

let state = loadState();

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ---------------------------------------------------------
   Cálculo de consumo (considera trânsito via velocidade média)
--------------------------------------------------------- */

const FUEL_LABELS = { gasolina: "Gasolina", etanol: "Etanol", diesel: "Diesel" };
const FUEL_ICONS = { gasolina: "🟠", etanol: "🟢", diesel: "⚫" };

function baseKmL(fuel) {
  const c = state.config;
  if (fuel === "gasolina") return c.kmLGasolina;
  if (fuel === "etanol") return c.kmLGasolina * c.ethanolFactor;
  if (fuel === "diesel") return c.kmLDiesel;
  return c.kmLGasolina;
}

function trafficFactor(avgSpeedKmh) {
  if (!isFinite(avgSpeedKmh) || avgSpeedKmh <= 0) {
    return { factor: 1, label: "Condição não informada" };
  }
  if (avgSpeedKmh < 15) return { factor: 0.60, label: "Trânsito intenso" };
  if (avgSpeedKmh < 25) return { factor: 0.72, label: "Trânsito pesado" };
  if (avgSpeedKmh < 35) return { factor: 0.82, label: "Trânsito moderado" };
  if (avgSpeedKmh < 50) return { factor: 0.92, label: "Trânsito leve" };
  if (avgSpeedKmh <= 90) return { factor: 1.00, label: "Fluindo bem" };
  if (avgSpeedKmh <= 110) return { factor: 0.94, label: "Rodovia rápida" };
  return { factor: 0.87, label: "Velocidade alta" };
}

function effectiveKmL(fuel, avgSpeedKmh) {
  return baseKmL(fuel) * trafficFactor(avgSpeedKmh).factor;
}

/* ---------------------------------------------------------
   Utilidades de formatação
--------------------------------------------------------- */

function fmtNum(n, decimals = 1) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function fmtMoney(n) {
  if (!isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function todayISODate() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---------------------------------------------------------
   Navegação por abas
--------------------------------------------------------- */

function goToView(name) {
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.dataset.view === name));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("active", b.dataset.goto === name));
  if (name === "historico") renderHistory();
}

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-goto]");
  if (btn) goToView(btn.dataset.goto);
});

/* ---------------------------------------------------------
   Renderização — Painel
--------------------------------------------------------- */

function renderPainel() {
  const { tank, config } = state;
  const pct = Math.max(0, Math.min(100, (tank.currentL / config.capacityL) * 100));

  document.getElementById("tankLiters").textContent = fmtNum(tank.currentL, 1);
  document.getElementById("tankCapacity").textContent = fmtNum(config.capacityL, 0);
  document.getElementById("tankPercent").textContent = `${Math.round(pct)}%`;
  document.getElementById("tankBarFill").style.clipPath = `inset(0 ${100 - pct}% 0 0)`;

  const autonomy = tank.currentL * baseKmL(tank.currentFuel);
  document.getElementById("autonomyKm").textContent = `${fmtNum(autonomy, 0)} km`;
  document.getElementById("currentFuelLabel").textContent = FUEL_LABELS[tank.currentFuel];
  document.getElementById("fuelBadge").textContent = `${FUEL_ICONS[tank.currentFuel]} ${FUEL_LABELS[tank.currentFuel]}`;

  document.getElementById("lowFuelWarning").hidden = pct > 15;

  const todayKey = todayISODate();
  let todayKm = 0, todayLiters = 0;
  for (const e of state.history) {
    if (e.dateISO !== todayKey) continue;
    if (e.type === "trajeto") {
      todayKm += e.km;
      todayLiters += e.litersConsumed;
    }
  }
  document.getElementById("todayKm").textContent = fmtNum(todayKm, 1);
  document.getElementById("todayLiters").textContent = fmtNum(todayLiters, 2);
}

/* ---------------------------------------------------------
   Trajeto
--------------------------------------------------------- */

const tripKmEl = document.getElementById("tripKm");
const tripHoursEl = document.getElementById("tripHours");
const tripMinutesEl = document.getElementById("tripMinutes");
const tripDateEl = document.getElementById("tripDate");
const tripPreviewEl = document.getElementById("tripPreview");

function computeTripPreview() {
  const km = parseFloat(tripKmEl.value);
  const hours = parseFloat(tripHoursEl.value) || 0;
  const minutes = parseFloat(tripMinutesEl.value) || 0;
  const totalMinutes = hours * 60 + minutes;

  if (!km || km <= 0) {
    tripPreviewEl.hidden = true;
    return null;
  }

  const avgSpeed = totalMinutes > 0 ? km / (totalMinutes / 60) : NaN;
  const cond = trafficFactor(avgSpeed);
  const kmL = effectiveKmL(state.tank.currentFuel, avgSpeed);
  const liters = km / kmL;
  const tankAfter = Math.max(0, state.tank.currentL - liters);

  tripPreviewEl.hidden = false;
  document.getElementById("prevSpeed").textContent = isFinite(avgSpeed) ? `${fmtNum(avgSpeed, 0)} km/h` : "—";
  document.getElementById("prevCondition").textContent = cond.label;
  document.getElementById("prevConsumption").textContent = `${fmtNum(liters, 2)} L`;
  document.getElementById("prevTankAfter").textContent = `${fmtNum(tankAfter, 1)} L (${Math.round((tankAfter / state.config.capacityL) * 100)}%)`;

  return { km, totalMinutes, avgSpeed, kmL, liters, tankAfter };
}

[tripKmEl, tripHoursEl, tripMinutesEl].forEach(el => el.addEventListener("input", computeTripPreview));

document.getElementById("formTrajeto").addEventListener("submit", (e) => {
  e.preventDefault();
  const result = computeTripPreview();
  if (!result) return;

  state.tank.currentL = result.tankAfter;
  state.history.push({
    id: uid(),
    type: "trajeto",
    dateISO: tripDateEl.value || todayISODate(),
    createdAt: Date.now(),
    km: result.km,
    minutes: result.totalMinutes,
    avgSpeedKmh: isFinite(result.avgSpeed) ? result.avgSpeed : null,
    fuel: state.tank.currentFuel,
    kmL: result.kmL,
    litersConsumed: result.liters
  });
  saveState();

  toast(`Trajeto salvo: ${fmtNum(result.liters, 2)} L consumidos`);
  e.target.reset();
  tripDateEl.value = todayISODate();
  tripPreviewEl.hidden = true;
  renderPainel();
  goToView("painel");
});

/* ---------------------------------------------------------
   Abastecer
--------------------------------------------------------- */

const fuelTypeEl = document.getElementById("fuelType");
const fuelValueEl = document.getElementById("fuelValue");
const fuelPriceEl = document.getElementById("fuelPrice");
const fuelDateEl = document.getElementById("fuelDate");
const mixWarningEl = document.getElementById("mixWarning");

function fillDefaultPrice() {
  fuelPriceEl.value = state.config.prices[fuelTypeEl.value];
}

function computeFuelPreview() {
  const price = parseFloat(fuelPriceEl.value) || 0;
  const value = parseFloat(fuelValueEl.value) || 0;
  const liters = price > 0 ? value / price : 0;
  document.getElementById("prevLiters").textContent = `${fmtNum(liters, 2)} L`;

  const tankAfter = Math.min(state.config.capacityL, state.tank.currentL + liters);
  document.getElementById("prevTankFuel").textContent = `${fmtNum(tankAfter, 1)} L (${Math.round((tankAfter / state.config.capacityL) * 100)}%)`;

  mixWarningEl.hidden = fuelTypeEl.value === state.tank.currentFuel;
}

fuelTypeEl.addEventListener("change", () => { fillDefaultPrice(); computeFuelPreview(); });
[fuelValueEl, fuelPriceEl].forEach(el => el.addEventListener("input", computeFuelPreview));

document.getElementById("formAbastecer").addEventListener("submit", (e) => {
  e.preventDefault();
  const fuel = fuelTypeEl.value;
  const price = parseFloat(fuelPriceEl.value);
  const value = parseFloat(fuelValueEl.value);
  if (!price || price <= 0 || !value || value <= 0) return;

  const capacity = state.config.capacityL;
  const before = state.tank.currentL;
  let liters = value / price;
  let after = before + liters;
  let cappedValue = 0;

  if (after > capacity) {
    liters = capacity - before;
    cappedValue = value - liters * price;
    after = capacity;
  }

  const total = liters * price;

  state.tank.currentL = after;
  state.tank.currentFuel = fuel;

  state.history.push({
    id: uid(),
    type: "abastecimento",
    dateISO: fuelDateEl.value || todayISODate(),
    createdAt: Date.now(),
    fuel,
    liters,
    pricePerL: price,
    total
  });
  saveState();

  toast(cappedValue > 0
    ? `Tanque ficou cheio antes de usar tudo (sobrou ${fmtMoney(cappedValue)})`
    : `Abastecido: +${fmtNum(liters, 2)} L de ${FUEL_LABELS[fuel]} (${fmtMoney(total)})`);

  e.target.reset();
  fuelDateEl.value = todayISODate();
  fillDefaultPrice();
  computeFuelPreview();
  renderPainel();
  goToView("painel");
});

/* ---------------------------------------------------------
   Histórico (dia / semana / mês)
--------------------------------------------------------- */

let historyPeriod = "dia";

document.getElementById("historyPeriodSwitch").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn");
  if (!btn) return;
  historyPeriod = btn.dataset.period;
  document.querySelectorAll("#historyPeriodSwitch .seg-btn").forEach(b => b.classList.toggle("active", b === btn));
  renderHistory();
});

const MONTHS_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function parseISODate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function fmtShort(date) {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function groupKeyAndLabel(entry, period) {
  const date = parseISODate(entry.dateISO);

  if (period === "dia") {
    const key = entry.dateISO;
    const today = todayISODate();
    const yestDate = new Date();
    yestDate.setDate(yestDate.getDate() - 1);
    const yesterday = yestDate.toISOString().slice(0, 10);
    let label;
    if (key === today) label = "Hoje";
    else if (key === yesterday) label = "Ontem";
    else label = date.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
    return { key, label };
  }

  if (period === "semana") {
    const monday = mondayOf(date);
    const sunday = new Date(monday);
    sunday.setDate(sunday.getDate() + 6);
    const key = monday.toISOString().slice(0, 10);
    return { key, label: `Semana de ${fmtShort(monday)} a ${fmtShort(sunday)}` };
  }

  // mes
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return { key, label: `${MONTHS_PT[date.getMonth()]} de ${date.getFullYear()}` };
}

let openGroups = new Set();

function renderHistory() {
  const listEl = document.getElementById("historyList");
  const emptyEl = document.getElementById("historyEmpty");

  const sorted = [...state.history].sort((a, b) => b.createdAt - a.createdAt);
  emptyEl.hidden = sorted.length > 0;
  listEl.innerHTML = "";
  if (sorted.length === 0) return;

  const groups = new Map();
  for (const entry of sorted) {
    const { key, label } = groupKeyAndLabel(entry, historyPeriod);
    if (!groups.has(key)) groups.set(key, { label, entries: [] });
    groups.get(key).entries.push(entry);
  }

  // abre o grupo mais recente por padrão na primeira renderização
  if (openGroups.size === 0 && groups.size > 0) {
    openGroups.add(groups.keys().next().value);
  }

  for (const [key, group] of groups) {
    let km = 0, litersConsumed = 0, litersRefueled = 0, spent = 0;
    for (const e of group.entries) {
      if (e.type === "trajeto") { km += e.km; litersConsumed += e.litersConsumed; }
      else { litersRefueled += e.liters; spent += e.total; }
    }

    const sub = [];
    if (km > 0) sub.push(`${fmtNum(km, 1)} km`);
    if (litersConsumed > 0) sub.push(`${fmtNum(litersConsumed, 2)} L consumidos`);
    if (litersRefueled > 0) sub.push(`${fmtNum(litersRefueled, 1)} L abastecidos`);
    if (spent > 0) sub.push(fmtMoney(spent));

    const groupEl = document.createElement("div");
    groupEl.className = "history-group" + (openGroups.has(key) ? " open" : "");

    const header = document.createElement("div");
    header.className = "history-group-header";
    header.innerHTML = `
      <div>
        <div class="history-group-title">${group.label}</div>
        <div class="history-group-sub">${sub.join(" · ") || "Sem movimentação"}</div>
      </div>
      <div class="history-group-chevron">▶</div>
    `;
    header.addEventListener("click", () => {
      if (openGroups.has(key)) openGroups.delete(key); else openGroups.add(key);
      groupEl.classList.toggle("open");
    });

    const entriesEl = document.createElement("div");
    entriesEl.className = "history-entries";
    for (const entry of group.entries) {
      entriesEl.appendChild(renderHistoryItem(entry));
    }

    groupEl.appendChild(header);
    groupEl.appendChild(entriesEl);
    listEl.appendChild(groupEl);
  }
}

function renderHistoryItem(entry) {
  const item = document.createElement("div");
  item.className = "history-item";

  let icon, title, sub;
  if (entry.type === "trajeto") {
    icon = "🛣️";
    title = `${fmtNum(entry.km, 1)} km · ${FUEL_LABELS[entry.fuel]}`;
    const speedTxt = entry.avgSpeedKmh ? `${fmtNum(entry.avgSpeedKmh, 0)} km/h méd.` : "sem tempo informado";
    sub = `${fmtNum(entry.litersConsumed, 2)} L consumidos · ${speedTxt}`;
  } else {
    icon = "⛽";
    title = `+${fmtNum(entry.liters, 1)} L de ${FUEL_LABELS[entry.fuel]}`;
    sub = `${fmtMoney(entry.pricePerL)}/L · total ${fmtMoney(entry.total)}`;
  }

  item.innerHTML = `
    <div class="history-item-icon">${icon}</div>
    <div class="history-item-main">
      <div class="history-item-title">${title}</div>
      <div class="history-item-sub">${sub}</div>
    </div>
    <button class="history-item-del" title="Excluir registro">✕</button>
  `;

  item.querySelector(".history-item-del").addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (!confirm("Excluir este registro do histórico? Isso não altera o nível atual do tanque.")) return;
    state.history = state.history.filter(e => e.id !== entry.id);
    saveState();
    renderHistory();
    renderPainel();
  });

  return item;
}

/* ---------------------------------------------------------
   Configurações
--------------------------------------------------------- */

function loadConfigForm() {
  const c = state.config;
  document.getElementById("cfgCapacity").value = c.capacityL;
  document.getElementById("cfgKmLGasolina").value = c.kmLGasolina;
  document.getElementById("cfgEthanolFactor").value = c.ethanolFactor;
  document.getElementById("cfgKmLDiesel").value = c.kmLDiesel;
  document.getElementById("cfgPrecoGasolina").value = c.prices.gasolina;
  document.getElementById("cfgPrecoEtanol").value = c.prices.etanol;
  document.getElementById("cfgPrecoDiesel").value = c.prices.diesel;
  document.getElementById("cfgCurrentFuel").value = state.tank.currentFuel;
  document.getElementById("cfgCurrentLevel").value = state.tank.currentL;
  updateCalcEthanol();
}

function updateCalcEthanol() {
  const kmLGas = parseFloat(document.getElementById("cfgKmLGasolina").value) || 0;
  const factor = parseFloat(document.getElementById("cfgEthanolFactor").value) || 0;
  document.getElementById("calcEthanolKmL").textContent = `${fmtNum(kmLGas * factor, 2)} km/L`;
}

document.getElementById("cfgKmLGasolina").addEventListener("input", updateCalcEthanol);
document.getElementById("cfgEthanolFactor").addEventListener("input", updateCalcEthanol);

document.getElementById("btnSaveConfig").addEventListener("click", () => {
  const capacity = parseFloat(document.getElementById("cfgCapacity").value);
  if (!capacity || capacity <= 0) { toast("Informe uma capacidade de tanque válida"); return; }

  state.config.capacityL = capacity;
  state.config.kmLGasolina = parseFloat(document.getElementById("cfgKmLGasolina").value) || state.config.kmLGasolina;
  state.config.ethanolFactor = parseFloat(document.getElementById("cfgEthanolFactor").value) || state.config.ethanolFactor;
  state.config.kmLDiesel = parseFloat(document.getElementById("cfgKmLDiesel").value) || state.config.kmLDiesel;
  state.config.prices.gasolina = parseFloat(document.getElementById("cfgPrecoGasolina").value) || 0;
  state.config.prices.etanol = parseFloat(document.getElementById("cfgPrecoEtanol").value) || 0;
  state.config.prices.diesel = parseFloat(document.getElementById("cfgPrecoDiesel").value) || 0;
  state.tank.currentFuel = document.getElementById("cfgCurrentFuel").value;

  const level = parseFloat(document.getElementById("cfgCurrentLevel").value);
  state.tank.currentL = Math.max(0, Math.min(state.config.capacityL, isFinite(level) ? level : state.tank.currentL));

  saveState();
  fillDefaultPrice();
  toast("Configurações salvas");
  renderPainel();
});

document.getElementById("btnExport").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `tanque-virtual-backup-${todayISODate()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById("btnImport").addEventListener("click", () => {
  document.getElementById("importFile").click();
});

document.getElementById("importFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.config || !parsed.tank) throw new Error("formato inválido");
      state = {
        config: { ...DEFAULT_STATE.config, ...parsed.config, prices: { ...DEFAULT_STATE.config.prices, ...(parsed.config.prices || {}) } },
        tank: { ...DEFAULT_STATE.tank, ...parsed.tank },
        history: Array.isArray(parsed.history) ? parsed.history : []
      };
      saveState();
      loadConfigForm();
      renderPainel();
      openGroups = new Set();
      renderHistory();
      toast("Backup importado com sucesso");
    } catch (err) {
      toast("Arquivo de backup inválido");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
});

document.getElementById("btnReset").addEventListener("click", () => {
  if (!confirm("Isso vai apagar TODOS os dados (histórico, configurações e tanque). Deseja continuar?")) return;
  state = structuredClone(DEFAULT_STATE);
  saveState();
  loadConfigForm();
  renderPainel();
  openGroups = new Set();
  renderHistory();
  toast("Dados apagados");
});

/* ---------------------------------------------------------
   Toast
--------------------------------------------------------- */

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

/* ---------------------------------------------------------
   Inicialização
--------------------------------------------------------- */

function init() {
  tripDateEl.value = todayISODate();
  fuelDateEl.value = todayISODate();
  fillDefaultPrice();
  computeFuelPreview();
  loadConfigForm();
  renderPainel();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(err => console.error("Falha ao registrar service worker", err));
  }
}

init();
