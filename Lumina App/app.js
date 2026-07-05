/* =========================================================
   Lumina Habits — Consistency Tracker
   Vanilla JS + localStorage. No backend required.
   ========================================================= */

const STORAGE_KEY = "lumina_habits_v1";
const DEFAULT_FREEZES = 3;

let state = { habits: [], profile: {}, diary: {}, weight: {} };
let currentView = "dashboard";
let currentDetailId = null;
let pendingCategory = "Health";
let pendingColor = "#10B981";
let chatHistory = [];

/* ---------------- persistence ---------------- */
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state = raw ? JSON.parse(raw) : { habits: [] };
    if (!Array.isArray(state.habits)) state.habits = [];

    // migrate legacy habits so new features never crash on old data
    state.habits.forEach((h) => {
      if (typeof h.freezesAvailable !== "number") h.freezesAvailable = DEFAULT_FREEZES;
      if (!h.freezeLog || typeof h.freezeLog !== "object") h.freezeLog = {};
      if (!h.createdAt) h.createdAt = "0000-00-00";
      if (!h.log || typeof h.log !== "object") h.log = {};
      if (!h.notes || typeof h.notes !== "object") h.notes = {};
    });

    if (!state.profile || typeof state.profile !== "object") {
      state.profile = { name: "", emoji: "🙂", photo: null, joined: todayKey() };
    }
    if (typeof state.profile.photo === "undefined") state.profile.photo = null;
    if (!state.diary || typeof state.diary !== "object") state.diary = {};
    if (!state.weight || typeof state.weight !== "object") state.weight = {};
  } catch (e) {
    console.error("Failed to load state", e);
    state = { habits: [], profile: { name: "", emoji: "🙂", photo: null, joined: todayKey() }, diary: {}, weight: {} };
  }
}
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    console.error("Failed to save state", e);
    alert("Couldn't save — your browser may be blocking local storage (private/incognito mode, or storage is full).");
    return false;
  }
}

/* ---------------- toast ---------------- */
function showToast(message) {
  const existing = document.getElementById("app-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "app-toast";
  toast.className = "app-toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("visible"), 10);
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 250);
  }, 1800);
}

/* ---------------- date helpers ----------------
   NOTE: previously this used d.toISOString().slice(0,10), which reads the
   date in UTC. For anyone not in UTC (e.g. UTC+5:30), a check-in made late
   at night could be filed under the wrong day. All date keys now use the
   browser's LOCAL date instead. */
function keyFor(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function todayKey() {
  return keyFor(new Date());
}
function addDays(d, n) {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}
function formatFriendlyDate(d) {
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/* ---------------- habit math ---------------- */
function isDone(habit, key) {
  return !!habit.log[key];
}
function isFrozen(habit, key) {
  return !!(habit.freezeLog && habit.freezeLog[key]);
}
function freezesAvailable(habit) {
  return typeof habit.freezesAvailable === "number" ? habit.freezesAvailable : 0;
}
// A day "counts" toward keeping a streak alive if it was completed OR frozen.
function isProtected(habit, key) {
  return isDone(habit, key) || isFrozen(habit, key);
}

function currentStreak(habit) {
  let streak = 0;
  let d = new Date();
  if (!isProtected(habit, keyFor(d))) d = addDays(d, -1); // allow streak to still count if today not yet done
  while (isProtected(habit, keyFor(d))) {
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}

function longestStreak(habit) {
  const doneDates = Object.keys(habit.log).filter((k) => habit.log[k]);
  const frozenDates = habit.freezeLog ? Object.keys(habit.freezeLog).filter((k) => habit.freezeLog[k]) : [];
  const dates = Array.from(new Set([...doneDates, ...frozenDates])).sort();
  let longest = 0,
    current = 0,
    prev = null;
  for (const dstr of dates) {
    const d = new Date(dstr + "T00:00:00");
    if (prev) {
      const diffDays = Math.round((d - prev) / 86400000);
      current = diffDays === 1 ? current + 1 : 1;
    } else {
      current = 1;
    }
    longest = Math.max(longest, current);
    prev = d;
  }
  return longest;
}

// FIX: previously this always divided by a fixed 30-day window, so a habit
// created 5 days ago looked like it had a 17% completion rate instead of
// being judged only over the days it has actually existed.
function completionRate(habit, days = 30) {
  const createdAt = habit.createdAt && habit.createdAt !== "0000-00-00" ? habit.createdAt : null;
  let count = 0;
  let consideredDays = 0;
  let d = new Date();
  for (let i = 0; i < days; i++) {
    const key = keyFor(d);
    if (createdAt && key < createdAt) break; // habit didn't exist yet — stop counting
    consideredDays++;
    if (isDone(habit, key)) count++;
    d = addDays(d, -1);
  }
  if (consideredDays === 0) return 0;
  return Math.round((count / consideredDays) * 100);
}

function totalCompletions(habit) {
  return Object.values(habit.log).filter(Boolean).length;
}

function toggleToday(habitId) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  const key = todayKey();
  if (h.log[key]) delete h.log[key];
  else {
    h.log[key] = true;
    if (h.freezeLog && h.freezeLog[key]) delete h.freezeLog[key]; // a real check-in supersedes a freeze
  }
  saveState();
  renderCurrentView();
}

function toggleDate(habitId, key) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  if (h.log[key]) delete h.log[key];
  else {
    h.log[key] = true;
    if (h.freezeLog && h.freezeLog[key]) delete h.freezeLog[key];
  }
  saveState();
  renderCurrentView();
}

/* ---------------- streak freeze ---------------- */
function useFreeze(habitId) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  const key = todayKey();
  if (isDone(h, key)) {
    alert("Today is already checked in — no need to use a freeze.");
    return;
  }
  if (isFrozen(h, key)) return;
  if (freezesAvailable(h) <= 0) {
    alert("No streak freezes left for this habit.");
    return;
  }
  if (!h.freezeLog) h.freezeLog = {};
  h.freezeLog[key] = true;
  h.freezesAvailable = freezesAvailable(h) - 1;
  saveState();
  renderCurrentView();
}

function undoFreeze(habitId) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  const key = todayKey();
  if (h.freezeLog && h.freezeLog[key]) {
    delete h.freezeLog[key];
    h.freezesAvailable = freezesAvailable(h) + 1;
    saveState();
    renderCurrentView();
  }
}

/* ---------------- badge / color helpers ---------------- */
const BADGE_CLASS = { Health: "badge-health", Work: "badge-work", Mind: "badge-mind", Other: "badge-other" };

// Determines the visual state of a single calendar-square day.
function dayStatus(habit, key, todayStr, createdAt) {
  if (isDone(habit, key)) return "done";
  if (isFrozen(habit, key)) return "frozen";
  if (key > todayStr) return "future";
  if (createdAt && createdAt !== "0000-00-00" && key < createdAt) return "before";
  if (key === todayStr) return "today-pending";
  return "missed";
}
function statusLabel(status) {
  return (
    { done: "Completed", frozen: "Streak freeze used", missed: "Missed", "today-pending": "Not yet checked in", future: "Upcoming", before: "" }[
      status
    ] || ""
  );
}

function buildMiniHeatmap(habit, days = 7) {
  const today = todayKey();
  let html = '<div class="flex items-center gap-1">';
  let d = addDays(new Date(), -(days - 1));
  for (let i = 0; i < days; i++) {
    const key = keyFor(d);
    const status = dayStatus(habit, key, today, habit.createdAt);
    html += `<div class="heatmap-square status-${status}" title="${d.toDateString()} — ${statusLabel(status)}"></div>`;
    d = addDays(d, 1);
  }
  html += "</div>";
  return html;
}

function buildFullHeatmap(habit, weeks = 26) {
  const today = todayKey();
  const totalDays = weeks * 7;
  let d = addDays(new Date(), -(totalDays - 1));
  // align start to a Sunday so columns look clean
  while (d.getDay() !== 0) d = addDays(d, -1);
  let html = '<div class="heatmap-grid">';
  let cursor = new Date(d);
  const end = new Date();
  while (cursor <= end || cursor.getDay() !== 0) {
    if (cursor > end) {
      html += `<div class="heatmap-square" style="visibility:hidden"></div>`;
    } else {
      const key = keyFor(cursor);
      const status = dayStatus(habit, key, today, habit.createdAt);
      const clickable = status !== "future" && status !== "before";
      html += `<div class="heatmap-square status-${status}" title="${cursor.toDateString()} — ${statusLabel(status)}" ${
        clickable ? `onclick="toggleDate('${habit.id}','${key}')" style="cursor:pointer"` : ""
      }></div>`;
    }
    cursor = addDays(cursor, 1);
    if (cursor > end && cursor.getDay() === 0) break;
  }
  html += "</div>";
  return html;
}

/* ---------------- view switching ---------------- */
const SUB_VIEWS = ["detail", "profile", "ai", "diary", "weight"];

function setView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  document.getElementById(`view-${view}`).classList.remove("hidden");

  document.getElementById("fab").classList.toggle("hidden", view !== "dashboard");
  document.getElementById("back-btn").classList.toggle("hidden", !SUB_VIEWS.includes(view));
  document.getElementById("menu-btn").classList.toggle("hidden", SUB_VIEWS.includes(view));

  const titles = {
    dashboard: "Lumina Habits",
    stats: "Consistency Stats",
    settings: "Settings",
    detail: "Habit Detail",
    profile: "Profile",
    ai: "AI Habit Coach",
    diary: "Daily Diary",
    weight: "Weight Tracker",
  };
  document.getElementById("header-title-text").textContent = titles[view] || "Lumina Habits";

  document.querySelectorAll(".nav-btn, .nav-btn-side").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view && view !== "detail");
  });

  renderCurrentView();
}

function renderCurrentView() {
  if (currentView === "dashboard") renderDashboard();
  else if (currentView === "detail") renderDetail(currentDetailId);
  else if (currentView === "stats") renderStats();
  else if (currentView === "profile") renderProfile();
  else if (currentView === "ai") renderAI();
  else if (currentView === "diary") renderDiary();
  else if (currentView === "weight") renderWeight();
  else if (currentView === "settings") {} // static
}

/* ---------------- menu (bottom sheet) ---------------- */
function renderMenuIdentity() {
  const p = state.profile || {};
  const avatarEl = document.getElementById("menu-avatar");
  avatarEl.innerHTML = p.photo ? `<img src="${p.photo}" alt="Profile photo" class="w-full h-full object-cover" />` : p.emoji || "🙂";
  document.getElementById("menu-profile-name").textContent = p.name ? p.name : "Add your name";
}

function openMenu() {
  renderMenuIdentity();
  document.getElementById("menu-sheet-overlay").classList.remove("hidden");
  const raf = window.requestAnimationFrame || ((cb) => setTimeout(cb, 16));
  raf(() => document.getElementById("menu-sheet").classList.remove("sheet-closed"));
}
function closeMenu() {
  document.getElementById("menu-sheet").classList.add("sheet-closed");
  setTimeout(() => document.getElementById("menu-sheet-overlay").classList.add("hidden"), 250);
}
function toggleMenu() {
  const sheet = document.getElementById("menu-sheet");
  if (sheet.classList.contains("sheet-closed")) openMenu();
  else closeMenu();
}

/* ---------------- avatar upload ---------------- */
function handleAvatarUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("Please choose an image file.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    state.profile.photo = reader.result; // data URL, stored locally only
    saveState();
    renderMenuIdentity();
    if (currentView === "profile") renderProfile();
    showToast("Profile photo updated");
  };
  reader.onerror = () => alert("Couldn't read that image.");
  reader.readAsDataURL(file);
  event.target.value = "";
}
function removeProfilePhoto() {
  state.profile.photo = null;
  saveState();
  renderMenuIdentity();
  renderProfile();
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  document.getElementById("today-date").textContent = formatFriendlyDate(new Date());

  const list = document.getElementById("habit-list");
  const empty = document.getElementById("empty-state");

  if (state.habits.length === 0) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    empty.classList.add("flex");
    document.getElementById("today-completion").textContent = "—";
    return;
  }
  empty.classList.add("hidden");
  empty.classList.remove("flex");

  const doneToday = state.habits.filter((h) => isDone(h, todayKey())).length;
  const pct = Math.round((doneToday / state.habits.length) * 100);
  document.getElementById("today-completion").textContent = `${pct}%`;

  list.innerHTML = state.habits
    .map((h) => {
      const done = isDone(h, todayKey());
      const frozenToday = isFrozen(h, todayKey());
      const streak = currentStreak(h);
      return `
      <div class="habit-card rounded-xl p-4 md:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-hover cursor-pointer" onclick="openDetail('${h.id}')">
        <div class="flex items-center gap-4 flex-1 min-w-0">
          <button aria-label="Check in ${h.name}" onclick="event.stopPropagation(); toggleToday('${h.id}')"
            class="check-btn w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${done ? "completed" : ""} ${frozenToday ? "frozen" : ""}">
            ${done ? '<span class="material-symbols-outlined text-background">check</span>' : frozenToday ? '<span class="material-symbols-outlined" style="color:#38bdf8">ac_unit</span>' : ""}
          </button>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${h.color}"></span>
              <h3 class="text-lg font-semibold text-on-surface truncate">${h.name}</h3>
              <span class="badge ${BADGE_CLASS[h.category] || "badge-other"}">${h.category}</span>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <span class="material-symbols-outlined text-tertiary text-sm">local_fire_department</span>
              <span class="text-sm text-on-surface-variant">${streak} Day Streak</span>
            </div>
          </div>
        </div>
        ${buildMiniHeatmap(h)}
      </div>`;
    })
    .join("");
}

/* ---------------- detail ---------------- */
function openDetail(id) {
  currentDetailId = id;
  setView("detail");
}

function renderDetail(id) {
  const h = state.habits.find((x) => x.id === id);
  const container = document.getElementById("view-detail");
  if (!h) {
    container.innerHTML = `<p class="text-on-surface-variant">Habit not found.</p>`;
    return;
  }
  const today = todayKey();
  const done = isDone(h, today);
  const frozenToday = isFrozen(h, today);
  const streak = currentStreak(h);
  const longest = longestStreak(h);
  const rate = completionRate(h, 30);
  const total = totalCompletions(h);
  const freezes = freezesAvailable(h);
  const goalHtml = h.target
    ? `<p class="text-sm text-on-surface-variant mt-1">Goal: ${h.target}-day streak ${streak >= h.target ? "🎉 achieved!" : `(${Math.max(h.target - streak, 0)} to go)`}</p>`
    : "";

  const freezeButtonHtml = frozenToday
    ? `<button onclick="undoFreeze('${h.id}')" class="px-4 py-2 rounded-lg font-medium text-on-surface-variant border border-outline-variant hover:bg-surface-container-high transition-colors whitespace-nowrap">Undo Freeze</button>`
    : `<button onclick="useFreeze('${h.id}')" ${done || freezes <= 0 ? "disabled" : ""}
        class="px-4 py-2 rounded-lg font-medium border transition-colors whitespace-nowrap ${
          done || freezes <= 0 ? "bg-surface-variant text-on-surface-variant border-transparent cursor-not-allowed" : "hover:bg-surface-container-high"
        }"
        style="${done || freezes <= 0 ? "" : "color:#38bdf8;border-color:#38bdf8;"}">
        Freeze Today
      </button>`;

  container.innerHTML = `
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <span class="w-4 h-4 rounded-full" style="background:${h.color}"></span>
        <div>
          <h2 class="text-2xl font-semibold">${h.name}</h2>
          <span class="badge ${BADGE_CLASS[h.category] || "badge-other"}">${h.category}</span>
        </div>
      </div>
      <button onclick="deleteHabit('${h.id}')" class="w-10 h-10 flex items-center justify-center rounded-full hover:bg-error/10 text-error transition-colors" title="Delete habit">
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>

    <div class="card-bg border rounded-xl p-6 flex flex-col items-center gap-2">
      <span class="material-symbols-outlined text-tertiary text-4xl">local_fire_department</span>
      <p class="text-4xl font-bold text-primary">${streak}</p>
      <p class="text-on-surface-variant">Day Streak</p>
      ${goalHtml}
      <button onclick="toggleToday('${h.id}')" class="mt-4 w-full max-w-xs py-3 rounded-xl font-semibold transition-all ${done ? "bg-emerald text-background" : "border border-emerald text-emerald hover:bg-emerald hover:text-background"}">
        ${done ? "✓ Done Today" : "Mark Today as Done"}
      </button>
    </div>

    <div class="card-bg border rounded-xl p-5 flex items-center justify-between gap-4 flex-wrap">
      <div class="flex items-center gap-3">
        <span class="material-symbols-outlined text-2xl" style="color:#38bdf8">ac_unit</span>
        <div>
          <p class="font-semibold">Streak Freeze</p>
          <p class="text-sm text-on-surface-variant">${freezes} freeze${freezes === 1 ? "" : "s"} left${frozenToday ? " · today is frozen" : ""}</p>
        </div>
      </div>
      ${freezeButtonHtml}
    </div>

    <div class="grid grid-cols-3 gap-3">
      <div class="card-bg border rounded-xl p-4 flex flex-col items-center gap-1">
        <span class="text-xl font-semibold text-primary">${longest}</span>
        <span class="text-xs text-on-surface-variant text-center">Longest Streak</span>
      </div>
      <div class="card-bg border rounded-xl p-4 flex flex-col items-center gap-1">
        <span class="text-xl font-semibold text-emerald">${rate}%</span>
        <span class="text-xs text-on-surface-variant text-center">Completion Rate</span>
      </div>
      <div class="card-bg border rounded-xl p-4 flex flex-col items-center gap-1">
        <span class="text-xl font-semibold text-secondary">${total}</span>
        <span class="text-xs text-on-surface-variant text-center">Total Check-ins</span>
      </div>
    </div>

    <div class="card-bg border rounded-xl p-5 flex flex-col gap-3">
      <div class="flex items-center justify-between flex-wrap gap-2">
        <h3 class="font-semibold">Activity (last 26 weeks)</h3>
        <div class="flex items-center gap-3 text-xs text-on-surface-variant flex-wrap">
          <span class="flex items-center gap-1"><span class="legend-dot" style="background:#10B981"></span>Done</span>
          <span class="flex items-center gap-1"><span class="legend-dot" style="background:#f43f5e"></span>Missed</span>
          <span class="flex items-center gap-1"><span class="legend-dot" style="background:#38bdf8"></span>Frozen</span>
        </div>
      </div>
      ${buildFullHeatmap(h)}
      <p class="text-xs text-on-surface-variant/70">Tap a square to toggle that day — green means done, red means missed.</p>
    </div>

    <div class="card-bg border rounded-xl p-5 flex flex-col gap-3">
      <h3 class="font-semibold">Notes</h3>
      <textarea id="habit-note-input" rows="3" placeholder="Anything worth remembering about today's ${h.name}?"
        class="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary placeholder-on-surface-variant/50 resize-none">${escapeHtml(h.notes[today] || "")}</textarea>
      <button onclick="saveHabitNote('${h.id}')" class="self-end px-5 py-2 rounded-lg bg-primary text-on-primary font-medium hover:bg-primary-fixed transition-colors">Save Note</button>
      <div class="flex flex-col gap-2 mt-1">
        ${
          Object.keys(h.notes).filter((k) => k !== today).length === 0
            ? `<p class="text-xs text-on-surface-variant/70 text-center py-2">Past notes for this habit will show up here, by date.</p>`
            : Object.keys(h.notes)
                .filter((k) => k !== today)
                .sort()
                .reverse()
                .map(
                  (k) => `
              <div class="flex flex-col gap-1 border-t border-outline-variant/30 pt-2 first:border-0 first:pt-0">
                <div class="flex justify-between items-center">
                  <span class="text-xs font-medium text-on-surface-variant">${new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                  <button onclick="deleteHabitNote('${h.id}','${k}')" class="text-on-surface-variant hover:text-error transition-colors"><span class="material-symbols-outlined text-[16px]">delete</span></button>
                </div>
                <p class="text-sm text-on-surface whitespace-pre-wrap">${escapeHtml(h.notes[k])}</p>
              </div>`
                )
                .join("")
        }
      </div>
    </div>
  `;
}

function saveHabitNote(habitId) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  const val = document.getElementById("habit-note-input").value.trim();
  const key = todayKey();
  if (val) h.notes[key] = val;
  else delete h.notes[key];
  if (saveState()) showToast("Note saved");
  renderDetail(habitId);
}

function deleteHabitNote(habitId, key) {
  const h = state.habits.find((x) => x.id === habitId);
  if (!h) return;
  if (!confirm("Delete this note?")) return;
  delete h.notes[key];
  saveState();
  renderDetail(habitId);
}

function deleteHabit(id) {
  if (!confirm("Delete this habit and all of its history? This can't be undone.")) return;
  state.habits = state.habits.filter((h) => h.id !== id);
  saveState();
  setView("dashboard");
}

/* ---------------- stats ---------------- */
function renderStats() {
  const summary = document.getElementById("stats-summary");
  const breakdown = document.getElementById("stats-breakdown");

  if (state.habits.length === 0) {
    summary.innerHTML = "";
    breakdown.innerHTML = `<p class="text-on-surface-variant text-center py-8">Add a habit to start seeing stats.</p>`;
    return;
  }

  const best = Math.max(...state.habits.map((h) => longestStreak(h)));
  const avgRate = Math.round(state.habits.reduce((sum, h) => sum + completionRate(h, 30), 0) / state.habits.length);

  summary.innerHTML = `
    <div class="card-bg border rounded-xl p-4 flex flex-col gap-2">
      <span class="text-sm text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">checklist</span>Total Active</span>
      <span class="text-3xl font-semibold">${state.habits.length}</span>
    </div>
    <div class="card-bg border rounded-xl p-4 flex flex-col gap-2">
      <span class="text-sm text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">local_fire_department</span>Best Streak</span>
      <span class="text-3xl font-semibold text-tertiary">${best} Days</span>
    </div>
    <div class="card-bg border rounded-xl p-4 flex flex-col gap-2">
      <span class="text-sm text-on-surface-variant flex items-center gap-2"><span class="material-symbols-outlined text-[18px]">percent</span>Avg Completion</span>
      <span class="text-3xl font-semibold text-emerald">${avgRate}%</span>
    </div>
  `;

  const sorted = [...state.habits].sort((a, b) => completionRate(b, 30) - completionRate(a, 30));
  breakdown.innerHTML = sorted
    .map((h) => {
      const rate = completionRate(h, 30);
      return `
      <div class="flex flex-col gap-1.5">
        <div class="flex justify-between items-center text-sm">
          <span class="flex items-center gap-2 font-medium"><span class="w-2 h-2 rounded-full" style="background:${h.color}"></span>${h.name}</span>
          <span class="text-on-surface-variant">${rate}%</span>
        </div>
        <div class="stat-bar-track">
          <div class="stat-bar-fill" style="width:${rate}%; background:${h.color}"></div>
        </div>
      </div>`;
    })
    .join("");
}

/* ---------------- profile ---------------- */
const PROFILE_EMOJIS = ["🙂", "🔥", "🌱", "🎯", "🧠", "💪", "📚", "🧘"];

function renderProfile() {
  const container = document.getElementById("view-profile");
  const p = state.profile;
  const totalHabits = state.habits.length;
  const totalCheckins = state.habits.reduce((s, h) => s + totalCompletions(h), 0);
  const best = state.habits.length ? Math.max(...state.habits.map((h) => longestStreak(h))) : 0;
  const avatarInner = p.photo ? `<img src="${p.photo}" alt="Profile photo" class="w-full h-full object-cover" />` : p.emoji || "🙂";

  container.innerHTML = `
    <div class="flex flex-col items-center gap-3 py-2">
      <label for="profile-photo-input" class="cursor-pointer relative" title="Tap to change photo">
        <div id="profile-avatar" class="w-20 h-20 rounded-full bg-surface-container-high flex items-center justify-center text-4xl overflow-hidden">${avatarInner}</div>
        <span class="absolute bottom-0 right-0 w-7 h-7 rounded-full bg-primary flex items-center justify-center pointer-events-none">
          <span class="material-symbols-outlined text-on-primary text-[16px]">photo_camera</span>
        </span>
      </label>
      <input id="profile-photo-input" type="file" accept="image/*" class="hidden" onchange="handleAvatarUpload(event)" />
      ${p.photo ? `<button onclick="removeProfilePhoto()" class="text-xs text-error hover:underline">Remove photo</button>` : ""}
      <input id="profile-name" type="text" placeholder="Your name" value="${(p.name || "").replace(/"/g, "&quot;")}"
        class="text-center bg-transparent border-b border-outline-variant focus:outline-none focus:border-primary text-xl font-semibold text-on-surface py-1 px-2" />
      <p class="text-sm text-on-surface-variant">Member since ${p.joined || todayKey()}</p>
    </div>
    ${
      p.photo
        ? ""
        : `<div class="flex flex-wrap justify-center gap-2">
      ${PROFILE_EMOJIS.map((e) => `<button class="emoji-dot ${e === p.emoji ? "selected" : ""}" onclick="setProfileEmoji('${e}')">${e}</button>`).join("")}
    </div>`
    }
    <div class="grid grid-cols-3 gap-3 mt-2">
      <div class="card-bg border rounded-xl p-4 flex flex-col items-center gap-1">
        <span class="text-xl font-semibold text-primary">${totalHabits}</span>
        <span class="text-xs text-on-surface-variant text-center">Habits</span>
      </div>
      <div class="card-bg border rounded-xl p-4 flex flex-col items-center gap-1">
        <span class="text-xl font-semibold text-tertiary">${best}</span>
        <span class="text-xs text-on-surface-variant text-center">Best Streak</span>
      </div>
      <div class="card-bg border rounded-xl p-4 flex flex-col items-center gap-1">
        <span class="text-xl font-semibold text-emerald">${totalCheckins}</span>
        <span class="text-xs text-on-surface-variant text-center">Check-ins</span>
      </div>
    </div>
  `;

  document.getElementById("profile-name").addEventListener("change", (e) => {
    state.profile.name = e.target.value.trim();
    saveState();
    renderMenuIdentity();
  });
}

function setProfileEmoji(emoji) {
  state.profile.emoji = emoji;
  saveState();
  renderProfile();
}

/* ---------------- AI Habit Coach (local chatbot) ----------------
   Fully local, rule-based pattern matching over the person's own
   habit/weight/diary data. No network calls, no real LLM — this is a
   static frontend with no backend to safely hold an API key. */
function toneFor(rate) {
  if (rate >= 75) return { label: "Excellent", color: "#10B981" };
  if (rate >= 45) return { label: "Building momentum", color: "#dec29a" };
  return { label: "Needs attention", color: "#f43f5e" };
}

const CHAT_HISTORY_KEY = "lumina_chat_v1";
const WELCOME_MESSAGE =
  "Hi! I'm your on-device habit coach. I can see your habits, streaks, weight log, and diary right here on this device — I'm a simple local assistant, not a connected AI model. Try asking me things like \"how's my streak?\", \"how's my weight trend?\", or mention a habit by name.";

function loadChatHistory() {
  try {
    const raw = localStorage.getItem(CHAT_HISTORY_KEY);
    chatHistory = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(chatHistory)) chatHistory = [];
  } catch (e) {
    chatHistory = [];
  }
  if (chatHistory.length === 0) {
    chatHistory.push({ role: "bot", text: WELCOME_MESSAGE });
  }
}
function saveChatHistory() {
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(chatHistory.slice(-40)));
  } catch (e) {
    console.error("Failed to save chat history", e);
  }
}

function renderAI() {
  if (chatHistory.length === 0) loadChatHistory();
  const container = document.getElementById("chat-messages");
  container.innerHTML = chatHistory.map((m) => chatBubbleHtml(m)).join("");
  container.scrollTop = container.scrollHeight;
  const input = document.getElementById("chat-input");
  if (input) setTimeout(() => input.focus(), 50);
}

function chatBubbleHtml(m) {
  const isUser = m.role === "user";
  return `<div class="chat-bubble ${isUser ? "chat-bubble-user" : "chat-bubble-bot"}">${escapeHtml(m.text)}</div>`;
}

function sendChatMessage() {
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text) return;
  chatHistory.push({ role: "user", text });
  input.value = "";
  const container = document.getElementById("chat-messages");
  container.innerHTML = chatHistory.map((m) => chatBubbleHtml(m)).join("");
  container.scrollTop = container.scrollHeight;

  setTimeout(() => {
    const reply = generateBotReply(text);
    chatHistory.push({ role: "bot", text: reply });
    saveChatHistory();
    container.innerHTML = chatHistory.map((m) => chatBubbleHtml(m)).join("");
    container.scrollTop = container.scrollHeight;
  }, 350);
}

function generateBotReply(rawText) {
  const text = rawText.toLowerCase();

  if (state.habits.length === 0 && !/weight|hi|hello|hey/.test(text)) {
    return "You don't have any habits set up yet — tap the + button on the dashboard to add your first one, then I can help track your progress.";
  }

  // greeting
  if (/^(hi|hello|hey|yo)\b/.test(text)) {
    return "Hey there! How are your habits going today? You can ask me about a streak, your weight trend, or how you're doing overall.";
  }

  if (/thank/.test(text)) {
    return "You're welcome! Keep showing up for yourself.";
  }

  // mention of a specific habit name
  const matchedHabit = state.habits.find((h) => text.includes(h.name.toLowerCase()));
  if (matchedHabit) {
    const rate = completionRate(matchedHabit, 30);
    const streak = currentStreak(matchedHabit);
    const noteCount = Object.keys(matchedHabit.notes || {}).length;
    const t = toneFor(rate);
    return `"${matchedHabit.name}" — ${streak}-day streak, ${rate}% completion this month (${t.label.toLowerCase()}). ${
      noteCount ? `You've logged ${noteCount} note${noteCount === 1 ? "" : "s"} for it.` : "You haven't added any notes for it yet."
    }`;
  }

  // streak
  if (/streak/.test(text)) {
    if (state.habits.length === 0) return "Add a habit first and I'll be able to track streaks for you.";
    const best = [...state.habits].sort((a, b) => currentStreak(b) - currentStreak(a))[0];
    const streak = currentStreak(best);
    return streak > 0
      ? `Your longest active streak right now is "${best.name}" at ${streak} day${streak === 1 ? "" : "s"}. Keep it going!`
      : `None of your habits have an active streak right now — today's a good day to restart one.`;
  }

  // overall progress / stats
  if (/progress|how am i doing|stats|overall|doing/.test(text)) {
    const avg = Math.round(state.habits.reduce((s, h) => s + completionRate(h, 30), 0) / state.habits.length);
    const t = toneFor(avg);
    return `You're averaging ${avg}% completion across ${state.habits.length} habit${state.habits.length === 1 ? "" : "s"} this month — ${t.label.toLowerCase()}.`;
  }

  // weight
  if (/weight/.test(text)) {
    const dates = Object.keys(state.weight).sort();
    if (dates.length === 0) return "You haven't logged any weight yet — head to the Weight Tracker to log today's.";
    const latestKey = dates[dates.length - 1];
    const latest = state.weight[latestKey];
    if (dates.length === 1) return `Your latest logged weight is ${latest} kg (on ${latestKey}). Log a few more entries and I can tell you the trend.`;
    const firstKey = dates[Math.max(0, dates.length - 8)]; // ~last week
    const prior = state.weight[firstKey];
    const diff = Math.round((latest - prior) * 10) / 10;
    const direction = diff > 0 ? "up" : diff < 0 ? "down" : "steady";
    return `Your latest weight is ${latest} kg. Over your recent entries it's trending ${direction}${diff !== 0 ? ` (${diff > 0 ? "+" : ""}${diff} kg)` : ""}.`;
  }

  // diary
  if (/diary|journal|reflect/.test(text)) {
    const count = Object.keys(state.diary).length;
    const hasToday = !!state.diary[todayKey()];
    return hasToday
      ? `You've already written in your diary today — nice. You have ${count} entr${count === 1 ? "y" : "ies"} total.`
      : `You haven't written today's diary entry yet. You have ${count} entr${count === 1 ? "y" : "ies"} logged so far — want to add today's?`;
  }

  // motivation / struggling
  if (/tired|motivat|give up|can't|cant|hard|struggl|lazy|skip/.test(text)) {
    const strugglingHabit = [...state.habits].sort((a, b) => completionRate(a, 30) - completionRate(b, 30))[0];
    if (strugglingHabit && freezesAvailable(strugglingHabit) > 0) {
      return `It's normal to have low-energy days. "${strugglingHabit.name}" has been tough lately — you still have ${freezesAvailable(strugglingHabit)} streak freeze${freezesAvailable(strugglingHabit) === 1 ? "" : "s"} you could use to protect it without pressure. Even a tiny version of the habit today counts.`;
    }
    return "It's normal to have low-energy days. Try doing the smallest possible version of one habit today — consistency matters more than intensity.";
  }

  // fallback
  return "I can help with things like: \"how's my streak?\", \"how's my weight trend?\", \"how am I doing overall?\", or just say a habit's name. What would you like to know?";
}

/* ---------------- daily diary ---------------- */
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function renderDiary() {
  const container = document.getElementById("view-diary");
  const today = todayKey();
  const entries = Object.keys(state.diary).sort().reverse();
  const pastEntries = entries.filter((k) => k !== today);

  container.innerHTML = `
    <div class="card-bg border rounded-xl p-5 flex flex-col gap-3">
      <h3 class="font-semibold">Today — ${formatFriendlyDate(new Date())}</h3>
      <textarea id="diary-today" rows="5" placeholder="How did today go? Reflect on your habits..."
        class="w-full bg-surface border border-outline-variant rounded-lg px-4 py-3 text-on-surface focus:outline-none focus:ring-2 focus:ring-primary placeholder-on-surface-variant/50 resize-none">${escapeHtml(state.diary[today] || "")}</textarea>
      <button onclick="saveDiaryToday()" class="self-end px-5 py-2 rounded-lg bg-primary text-on-primary font-medium hover:bg-primary-fixed transition-colors">Save Entry</button>
    </div>
    <div class="flex flex-col gap-3">
      ${
        pastEntries.length === 0
          ? `<p class="text-on-surface-variant text-center py-8">Past entries will appear here.</p>`
          : pastEntries
              .map(
                (k) => `
        <div class="card-bg border rounded-xl p-4 flex flex-col gap-1">
          <div class="flex justify-between items-center">
            <span class="text-sm font-medium text-on-surface-variant">${new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
            <button onclick="deleteDiaryEntry('${k}')" class="text-on-surface-variant hover:text-error transition-colors"><span class="material-symbols-outlined text-[18px]">delete</span></button>
          </div>
          <p class="text-on-surface whitespace-pre-wrap">${escapeHtml(state.diary[k])}</p>
        </div>`
              )
              .join("")
      }
    </div>
  `;
}

function saveDiaryToday() {
  const val = document.getElementById("diary-today").value.trim();
  const key = todayKey();
  if (val) state.diary[key] = val;
  else delete state.diary[key];
  if (saveState()) showToast("Diary entry saved");
  renderDiary();
}

function deleteDiaryEntry(key) {
  if (!confirm("Delete this diary entry?")) return;
  delete state.diary[key];
  saveState();
  renderDiary();
}

/* ---------------- weight tracker ---------------- */
function saveWeightToday() {
  const input = document.getElementById("weight-input");
  const val = parseFloat(input.value);
  if (!Number.isFinite(val) || val <= 0) {
    alert("Enter a valid weight in kg.");
    return;
  }
  state.weight[todayKey()] = Math.round(val * 10) / 10;
  if (saveState()) showToast("Weight logged");
  input.value = "";
  renderWeight();
}

function deleteWeightEntry(key) {
  if (!confirm("Delete this weight entry?")) return;
  delete state.weight[key];
  saveState();
  renderWeight();
}

function buildWeightChartSvg(entries) {
  // entries: [[dateKey, value], ...] sorted ascending, already limited to a reasonable window
  const width = 600;
  const height = 180;
  const padX = 12;
  const padY = 20;
  const values = entries.map((e) => e[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = entries.length > 1 ? (width - padX * 2) / (entries.length - 1) : 0;

  const points = entries.map((e, i) => {
    const x = padX + stepX * i;
    const y = height - padY - ((e[1] - min) / range) * (height - padY * 2);
    return [x, y];
  });

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1][0].toFixed(1)} ${height - padY} L ${points[0][0].toFixed(1)} ${height - padY} Z`;
  const dots = points.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" fill="#3B82F6" />`).join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" class="w-full h-auto" preserveAspectRatio="none">
      <path d="${areaPath}" fill="#3B82F622" stroke="none" />
      <path d="${linePath}" fill="none" stroke="#3B82F6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
    </svg>
    <div class="flex justify-between text-xs text-on-surface-variant">
      <span>${min} kg</span>
      <span>${max} kg</span>
    </div>
  `;
}

function renderWeight() {
  const chartCard = document.getElementById("weight-chart-card");
  const historyEl = document.getElementById("weight-history");
  const dateKeys = Object.keys(state.weight).sort();

  if (dateKeys.length === 0) {
    chartCard.innerHTML = `<p class="text-on-surface-variant text-center py-10">Log your weight above to start seeing a trend.</p>`;
    historyEl.innerHTML = "";
    return;
  }

  const recentKeys = dateKeys.slice(-30);
  const entries = recentKeys.map((k) => [k, state.weight[k]]);
  const latest = entries[entries.length - 1][1];
  const first = entries[0][1];
  const diff = Math.round((latest - first) * 10) / 10;

  chartCard.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-2">
      <div>
        <p class="text-2xl font-semibold text-primary">${latest} kg</p>
        <p class="text-xs text-on-surface-variant">Latest logged weight</p>
      </div>
      <div class="text-right">
        <p class="text-sm font-medium ${diff > 0 ? "text-error" : diff < 0 ? "text-emerald" : "text-on-surface-variant"}">${diff > 0 ? "+" : ""}${diff} kg</p>
        <p class="text-xs text-on-surface-variant">Since ${recentKeys[0]}</p>
      </div>
    </div>
    ${buildWeightChartSvg(entries)}
  `;

  historyEl.innerHTML = [...dateKeys]
    .reverse()
    .map(
      (k) => `
    <div class="card-bg border rounded-xl p-4 flex items-center justify-between">
      <div>
        <p class="font-medium">${state.weight[k]} kg</p>
        <p class="text-xs text-on-surface-variant">${new Date(k + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</p>
      </div>
      <button onclick="deleteWeightEntry('${k}')" class="text-on-surface-variant hover:text-error transition-colors"><span class="material-symbols-outlined text-[18px]">delete</span></button>
    </div>`
    )
    .join("");
}

/* ---------------- add habit modal ---------------- */
function openModal() {
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.getElementById("modal-overlay").classList.add("flex");
  document.getElementById("habit-name").value = "";
  document.getElementById("target-streak").value = "";
  document.getElementById("target-freezes").value = "";
  pendingCategory = "Health";
  pendingColor = "#10B981";
  document.querySelectorAll(".cat-chip").forEach((c) => c.classList.toggle("selected", c.dataset.cat === pendingCategory));
  document.querySelectorAll(".color-dot").forEach((c) => c.classList.toggle("selected", c.dataset.color === pendingColor));
  setTimeout(() => document.getElementById("habit-name").focus(), 50);
}
function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-overlay").classList.remove("flex");
}

function saveHabit() {
  const name = document.getElementById("habit-name").value.trim();
  if (!name) {
    alert("Please give your habit a name.");
    return;
  }
  const targetVal = parseInt(document.getElementById("target-streak").value, 10);
  const freezesVal = parseInt(document.getElementById("target-freezes").value, 10);
  const habit = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name,
    category: pendingCategory,
    color: pendingColor,
    target: Number.isFinite(targetVal) && targetVal > 0 ? targetVal : null,
    freezesAvailable: Number.isFinite(freezesVal) && freezesVal >= 0 ? freezesVal : DEFAULT_FREEZES,
    freezeLog: {},
    notes: {},
    createdAt: todayKey(),
    log: {},
  };
  state.habits.push(habit);
  saveState();
  closeModal();
  setView("dashboard");
}

/* ---------------- settings ---------------- */
function exportData(format) {
  if (state.habits.length === 0) {
    alert("No data to export yet.");
    return;
  }
  let blob, filename;
  if (format === "json") {
    blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    filename = "lumina-habits-export.json";
  } else {
    const rows = [["habit", "category", "date", "completed", "frozen"]];
    state.habits.forEach((h) => {
      const dates = new Set([...Object.keys(h.log), ...Object.keys(h.freezeLog || {})]);
      Array.from(dates)
        .sort()
        .forEach((date) => rows.push([h.name, h.category, date, h.log[date] ? "1" : "0", h.freezeLog && h.freezeLog[date] ? "1" : "0"]));
    });
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    blob = new Blob([csv], { type: "text/csv" });
    filename = "lumina-habits-export.csv";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function resetAllData() {
  if (!confirm("This will permanently delete all habits and history. Continue?")) return;
  state = { habits: [], profile: { name: "", emoji: "🙂", photo: null, joined: todayKey() }, diary: {}, weight: {} };
  saveState();
  setView("dashboard");
}

/* ---------------- daily reminders (in-app only) ----------------
   Real push notifications when the tab is closed need a backend/service
   worker + push server, which this static app doesn't have. This checks
   periodically while the tab is open and fires a browser Notification. */
const REMINDER_ENABLED_KEY = "lumina_reminder_enabled";
const REMINDER_TIME_KEY = "lumina_reminder_time";
const REMINDER_LAST_FIRED_KEY = "lumina_reminder_last_fired";

function initReminders() {
  const toggle = document.getElementById("reminder-toggle");
  const timeInput = document.getElementById("reminder-time");
  if (!toggle || !timeInput) return;

  const enabled = localStorage.getItem(REMINDER_ENABLED_KEY) === "1";
  const time = localStorage.getItem(REMINDER_TIME_KEY) || "20:00";
  toggle.checked = enabled;
  timeInput.value = time;

  toggle.addEventListener("change", (e) => {
    if (e.target.checked && "Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm !== "granted") {
          alert("Reminders need notification permission. You can still track habits without it, but you won't get a nudge.");
        }
      });
    }
    localStorage.setItem(REMINDER_ENABLED_KEY, e.target.checked ? "1" : "0");
  });

  timeInput.addEventListener("change", (e) => {
    localStorage.setItem(REMINDER_TIME_KEY, e.target.value);
  });

  setInterval(checkReminder, 60 * 1000);
  checkReminder();
}

function checkReminder() {
  const enabled = localStorage.getItem(REMINDER_ENABLED_KEY) === "1";
  if (!enabled) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (state.habits.length === 0) return;

  const time = localStorage.getItem(REMINDER_TIME_KEY) || "20:00";
  const now = new Date();
  const nowStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (nowStr < time) return;

  const today = todayKey();
  if (localStorage.getItem(REMINDER_LAST_FIRED_KEY) === today) return; // already nudged today

  const pending = state.habits.filter((h) => !isDone(h, today) && !isFrozen(h, today));
  if (pending.length === 0) return;

  new Notification("Don't lose your streak", {
    body: pending.length === 1 ? `"${pending[0].name}" isn't checked in yet today.` : `${pending.length} habits aren't checked in yet today.`,
    icon: "assets/logo.png",
  });
  localStorage.setItem(REMINDER_LAST_FIRED_KEY, today);
}

/* ---------------- theme ---------------- */
function applyTheme(dark) {
  document.documentElement.classList.toggle("dark", dark);
  document.getElementById("theme-toggle").querySelector(".material-symbols-outlined").textContent = dark ? "dark_mode" : "light_mode";
  const darkToggle = document.getElementById("dark-toggle");
  if (darkToggle) darkToggle.checked = dark;
  localStorage.setItem("lumina_theme", dark ? "dark" : "light");
}

/* ---------------- wiring ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  loadState();
  loadChatHistory();

  document.getElementById("back-btn").addEventListener("click", () => setView("dashboard"));

  document.getElementById("menu-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    toggleMenu();
  });

  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChatMessage();
  });

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
  });

  document.querySelectorAll(".cat-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      pendingCategory = chip.dataset.cat;
      document.querySelectorAll(".cat-chip").forEach((c) => c.classList.toggle("selected", c === chip));
    });
  });

  document.querySelectorAll(".color-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      pendingColor = dot.dataset.color;
      document.querySelectorAll(".color-dot").forEach((c) => c.classList.toggle("selected", c === dot));
    });
  });

  const themeToggleBtn = document.getElementById("theme-toggle");
  themeToggleBtn.addEventListener("click", () => applyTheme(!document.documentElement.classList.contains("dark")));

  const darkToggle = document.getElementById("dark-toggle");
  if (darkToggle) darkToggle.addEventListener("change", (e) => applyTheme(e.target.checked));

  const savedTheme = localStorage.getItem("lumina_theme");
  applyTheme(savedTheme !== "light");

  initReminders();

  // seed example habits on very first run so the UI isn't empty
  if (state.habits.length === 0 && localStorage.getItem("lumina_seeded") === null) {
    localStorage.setItem("lumina_seeded", "1");
  }

  setView("dashboard");
});
