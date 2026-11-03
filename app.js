/**
 * Shift Schedule 2026+ Web Application & PWA
 * Refactored Modular 5-Shift Generator with Multi-Year Support, Mobile Month Modal, Notes Persistence, Auto-Focus Today, User Statistics, Offline Outbox & Telegram Integration
 */

(function () {
  'use strict';

  // --- 1. PWA Service Worker Registration with Auto Update ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('Service Worker registered with scope:', reg.scope);
          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed' && navigator.serviceWorker.controller) {
                  console.log('New Service Worker content available; refreshing...');
                  window.location.reload();
                }
              };
            }
          };
        })
        .catch((err) => {
          console.warn('Service Worker registration failed:', err);
        });
    });
  }

  // --- 2. Constants & Configuration ---
  const CONFIG = {
    REF_DATE_UTC: Date.UTC(2026, 0, 1),
    CYCLE_PATTERN: [1, 1, 1, null, null, 3, 3, 3, null, null, 2, 2, 2, null, null],
    SHIFTS_LIST: ["А", "Б", "В", "Г", "Д"],
    SHIFT_BASE_INDICES: { "А": 2, "Б": 11, "В": 8, "Г": 5, "Д": 14 },
    MONTH_NAMES: [
      "Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
      "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"
    ],
    DAY_NAMES: ["нд", "пн", "вт", "ср", "чт", "пт", "сб"],
    STORAGE_KEYS: {
      NOTES: "shift_schedule_notes_v2",
      THEME: "shift_schedule_theme",
      FEEDBACKS: "shift_schedule_feedbacks",
      USAGE_STATS: "shift_schedule_usage_stats_v1",
      OUTBOX: "shift_schedule_outbox_v1"
    },
    MOBILE_BREAKPOINT_QUERY: "(max-width: 768px)"
  };

  // --- 3. Application State ---
  const State = {
    today: new Date(),
    currentYear: new Date().getFullYear() || 2026,
    activeFilter: "all",
    activeNoteTarget: null,
    selectedRating: 5,
    // Mobile Month Modal state
    currentModalMonthIdx: 0,
    isMonthModalOpen: false,
    ignoreMonthFocusGuard: false
  };

  // --- 4. Storage & Utility Helpers ---
  const Utils = {
    _toastTimer: null,

    // Returns human‑readable shift name based on numeric code
    getShiftName(shift) {
      switch (shift) {
        case 1:
          return "Нічна"; // night
        case 2:
          return "Ранкова"; // morning
        case 3:
          return "Вечірня"; // evening
        default:
          return "";
      }
    },

    // Returns compact icon for table cell status badge
    getStatusIcon(statusTag) {
      if (!statusTag || statusTag === "normal") return "";
      if (statusTag.includes("Лікарняний")) return "✚";
      if (statusTag.includes("Відпустка")) return "⛱︎";
      return "✎";
    },

    safeGetItem(key, defaultValue = null) {
      try {
        const raw = localStorage.getItem(key);
        return raw !== null ? raw : defaultValue;
      } catch (e) {
        console.warn("localStorage read failed:", e);
        return defaultValue;
      }
    },

    safeSetItem(key, value) {
      try {
        localStorage.setItem(key, value);
      } catch (e) {
        console.warn("localStorage write failed:", e);
      }
    },

    escapeHtml(str) {
      return (str || "").replace(/[&<>"']/g, function (m) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m];
      });
    },

    formatDateKey(year, monthIdx, day) {
      const mm = String(monthIdx + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    },

    makeNoteKey(dateStr, shiftGroup) {
      return `${dateStr}_${shiftGroup}`;
    },

    isMobileView() {
      return window.matchMedia(CONFIG.MOBILE_BREAKPOINT_QUERY).matches;
    },

    showToast(message, duration = 3500) {
      const toast = document.getElementById("toastNotification");
      if (!toast) return;
      if (this._toastTimer) {
        clearTimeout(this._toastTimer);
      }
      toast.textContent = message;
      toast.classList.add("active");
      this._toastTimer = setTimeout(() => {
        toast.classList.remove("active");
        this._toastTimer = null;
      }, duration);
    },

    updateModalScrollLock() {
      const activeModals = document.querySelectorAll(".modal-backdrop.active");
      if (activeModals.length > 0) {
        document.body.classList.add("modal-open");
      } else {
        document.body.classList.remove("modal-open");
      }
    }
  };

  // --- 5. Storage Service ---
  const StorageService = {
    getUsageStats() {
      try {
        const raw = Utils.safeGetItem(CONFIG.STORAGE_KEYS.USAGE_STATS);
        return raw ? JSON.parse(raw) : {
          visitCount: 1,
          firstVisit: new Date().toISOString(),
          lastVisit: new Date().toISOString()
        };
      } catch (e) {
        return { visitCount: 1, firstVisit: new Date().toISOString(), lastVisit: new Date().toISOString() };
      }
    },

    trackUsage() {
      try {
        const raw = Utils.safeGetItem(CONFIG.STORAGE_KEYS.USAGE_STATS);
        const stats = raw ? JSON.parse(raw) : {
          visitCount: 0,
          firstVisit: new Date().toISOString(),
          lastVisit: new Date().toISOString()
        };
        stats.visitCount = (stats.visitCount || 0) + 1;
        stats.lastVisit = new Date().toISOString();
        Utils.safeSetItem(CONFIG.STORAGE_KEYS.USAGE_STATS, JSON.stringify(stats));
        
        // Track visit globally via server (Vercel KV) instead of spamming Telegram directly
        setTimeout(() => {
          if (navigator.onLine) {
            fetch(`/api/track-visit`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                isFirstVisit: stats.visitCount === 1,
                visitCount: stats.visitCount
              })
            }).catch(() => {});
          }
        }, 2000);
        
        return stats;
      } catch (e) {
        return { visitCount: 1, firstVisit: new Date().toISOString(), lastVisit: new Date().toISOString() };
      }
    },

    getStoredNotes() {
      try {
        const raw = Utils.safeGetItem(CONFIG.STORAGE_KEYS.NOTES);
        let notes = raw ? JSON.parse(raw) : {};
        let modified = false;
        const emojiMap = {
          "🏖️ Відпустка": "⛱︎ Відпустка",
          "🤒 Лікарняний": "✚ Лікарняний",
          "⚡ Понаднормово": "✎ Інше",
          "🔄 Заміна": "✎ Інше",
          "📝 Особисте": "✎ Інше",
          "⚡︎ Понаднормово": "✎ Інше",
          "⇄ Заміна": "✎ Інше",
          "✎ Особисте": "✎ Інше"
        };
        Object.keys(notes).forEach(key => {
          if (notes[key] && emojiMap[notes[key].statusTag]) {
            notes[key].statusTag = emojiMap[notes[key].statusTag];
            modified = true;
          }
        });
        if (modified) {
          Utils.safeSetItem(CONFIG.STORAGE_KEYS.NOTES, JSON.stringify(notes));
        }
        return notes;
      } catch (e) {
        return {};
      }
    },

    saveStoredNotes(notes) {
      Utils.safeSetItem(CONFIG.STORAGE_KEYS.NOTES, JSON.stringify(notes));
    },

    setNote(dateStr, shiftGroup, noteData) {
      const notes = this.getStoredNotes();
      const key = Utils.makeNoteKey(dateStr, shiftGroup);
      if (!noteData || (!noteData.text && (!noteData.statusTag || noteData.statusTag === "normal"))) {
        delete notes[key];
      } else {
        notes[key] = noteData;
      }
      this.saveStoredNotes(notes);
    }
  };

  // --- 6. Shift Calculation Engine ---
  const ShiftEngine = {
    calculateShift(shiftGroup, year, monthIdx, day) {
      const targetUtc = Date.UTC(year, monthIdx, day);
      const diffDays = Math.round((targetUtc - CONFIG.REF_DATE_UTC) / (86400 * 1000));
      const baseIdx = CONFIG.SHIFT_BASE_INDICES[shiftGroup];
      if (baseIdx === undefined) return null;

      // Mathematical positive modulo handles past and future centuries correctly
      const cycleIdx = ((baseIdx + diffDays) % 15 + 15) % 15;
      return CONFIG.CYCLE_PATTERN[cycleIdx];
    },

    calculateMonthStats(shiftGroup, year, monthIdx) {
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
      let workDays = 0;
      let shift1 = 0;
      let shift2 = 0;
      let shift3 = 0;
      let offDays = 0;

      for (let d = 1; d <= daysInMonth; d++) {
        const val = this.calculateShift(shiftGroup, year, monthIdx, d);
        if (val === 1) { shift1++; workDays++; }
        else if (val === 2) { shift2++; workDays++; }
        else if (val === 3) { shift3++; workDays++; }
        else { offDays++; }
      }

      return { daysInMonth, workDays, shift1, shift2, shift3, offDays };
    }
  };

  // --- 7. Theme Service ---
  const ThemeService = {
    init() {
      const savedTheme = Utils.safeGetItem(CONFIG.STORAGE_KEYS.THEME, "dark");
      document.documentElement.setAttribute("data-theme", savedTheme);
      this.updateIcon(savedTheme);
    },

    toggle() {
      const current = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", current);
      Utils.safeSetItem(CONFIG.STORAGE_KEYS.THEME, current);
      this.updateIcon(current);
    },

    updateIcon(theme) {
      const btnThemeToggle = document.getElementById("btnThemeToggle");
      if (btnThemeToggle) {
        btnThemeToggle.setAttribute("aria-checked", theme === "light" ? "true" : "false");
        btnThemeToggle.setAttribute("title", theme === "light" ? "Увімкнути темну тему" : "Увімкнути світлу тему");
      }
    }
  };

  // --- 8. Telegram & Outbox Service ---
  const TelegramService = {
    queueOutboxItem(text, successToast) {
      try {
        const outbox = JSON.parse(Utils.safeGetItem(CONFIG.STORAGE_KEYS.OUTBOX, "[]"));
        outbox.push({ text, successToast, timestamp: Date.now() });
        Utils.safeSetItem(CONFIG.STORAGE_KEYS.OUTBOX, JSON.stringify(outbox));
      } catch (e) {
        console.warn("Outbox queue error:", e);
      }
    },

    async flushOutbox() {
      if (!navigator.onLine) return;
      try {
        const outbox = JSON.parse(Utils.safeGetItem(CONFIG.STORAGE_KEYS.OUTBOX, "[]"));
        if (outbox.length === 0) return;

        const remaining = [];
        for (const item of outbox) {
          try {
            const res = await fetch(`/api/send-message`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: item.text })
            });
            const data = await res.json();
            if (data.ok && item.successToast) {
              Utils.showToast(item.successToast);
            } else if (!data.ok) {
              remaining.push(item);
            }
          } catch {
            remaining.push(item);
          }
        }
        Utils.safeSetItem(CONFIG.STORAGE_KEYS.OUTBOX, JSON.stringify(remaining));
      } catch (e) {
        console.warn("Outbox flush failed:", e);
      }
    },

    sendOrQueue(textMessage, successMsg, offlineMsg) {
      if (!navigator.onLine) {
        this.queueOutboxItem(textMessage, successMsg);
        Utils.showToast(offlineMsg);
        return;
      }

      fetch(`/api/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: textMessage
        })
      }).then(res => res.json()).then(data => {
        if (data.ok) {
          Utils.showToast(successMsg);
        } else {
          this.queueOutboxItem(textMessage, successMsg);
          Utils.showToast(offlineMsg);
        }
      }).catch(() => {
        this.queueOutboxItem(textMessage, successMsg);
        Utils.showToast(offlineMsg);
      });
    }
  };

  // --- 9. Table DOM Generator Module ---
  const TableBuilder = {
    buildMonthTable(year, monthIdx, notes, activeFilter, onCellClick) {
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
      const tableWrapper = document.createElement("div");
      tableWrapper.className = "table-wrapper";

      const table = document.createElement("table");
      table.className = "calendar-table";

      const thead = document.createElement("thead");
      const trHead1 = document.createElement("tr");

      const thEmpty = document.createElement("th");
      thEmpty.textContent = "Зміна";
      trHead1.appendChild(thEmpty);

      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, monthIdx, d);
        const dayOfWeek = dateObj.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        const th = document.createElement("th");
        th.textContent = d;
        if (isWeekend) th.classList.add("is-weekend");
        trHead1.appendChild(th);
      }
      thead.appendChild(trHead1);

      const trHead2 = document.createElement("tr");
      const thSubEmpty = document.createElement("th");
      thSubEmpty.textContent = "";
      trHead2.appendChild(thSubEmpty);

      for (let d = 1; d <= daysInMonth; d++) {
        const dateObj = new Date(year, monthIdx, d);
        const dayOfWeek = dateObj.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        const th = document.createElement("th");
        th.textContent = CONFIG.DAY_NAMES[dayOfWeek];
        if (isWeekend) th.classList.add("is-weekend");
        trHead2.appendChild(th);
      }
      thead.appendChild(trHead2);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      const visibleShifts = activeFilter === "all" ? CONFIG.SHIFTS_LIST : [activeFilter];

      visibleShifts.forEach(shiftGroup => {
        const tr = document.createElement("tr");

        const tdLabel = document.createElement("td");
        tdLabel.textContent = shiftGroup;
        tr.appendChild(tdLabel);

        for (let d = 1; d <= daysInMonth; d++) {
          const dateObj = new Date(year, monthIdx, d);
          const dayOfWeek = dateObj.getDay();
          const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
          const dateStr = Utils.formatDateKey(year, monthIdx, d);

          const shiftVal = ShiftEngine.calculateShift(shiftGroup, year, monthIdx, d);
          const td = document.createElement("td");
          td.className = "cell-day";

          if (shiftVal === 1) td.classList.add("cell-shift-1");
          else if (shiftVal === 2) td.classList.add("cell-shift-2");
          else if (shiftVal === 3) td.classList.add("cell-shift-3");
          else td.classList.add("cell-shift-off");

          if (isWeekend) td.classList.add("cell-is-weekend");

          if (year === State.today.getFullYear() && monthIdx === State.today.getMonth() && d === State.today.getDate()) {
            td.classList.add("cell-today");
          }

          td.textContent = shiftVal !== null ? shiftVal : "";

          const noteKey = Utils.makeNoteKey(dateStr, shiftGroup);
          const note = notes[noteKey];

          if (note) {
            const dot = document.createElement("span");
            dot.className = "note-dot";
            td.appendChild(dot);

            if (note.statusTag && note.statusTag !== "normal") {
              const badge = document.createElement("span");
              badge.className = "custom-status-badge";
              badge.textContent = Utils.getStatusIcon(note.statusTag);
              td.appendChild(badge);
            }

            const shiftName = Utils.getShiftName(shiftVal) || "Вихідний";
            let tooltip = `${dateStr} [${shiftName}]: `;
            if (note.statusTag && note.statusTag !== "normal") tooltip += `[${note.statusTag}] `;
            if (note.text) tooltip += note.text;
            td.title = tooltip.trim();
          } else {
            const shiftName = Utils.getShiftName(shiftVal) || "Вихідний";
            td.title = `${CONFIG.MONTH_NAMES[monthIdx]} ${d}, ${year} — ${shiftName}`;
          }

          if (onCellClick) {
            td.addEventListener("click", () => {
              onCellClick({
                dateStr,
                shiftGroup,
                year,
                monthIdx,
                day: d,
                shift: shiftVal,
                note
              });
            });
          }

          tr.appendChild(td);
        }

        tbody.appendChild(tr);
      });

      table.appendChild(tbody);
      tableWrapper.appendChild(table);
      return tableWrapper;
    }
  };

  // --- 9.5. Shift Filter Controller ---
  const FilterController = {
    setFilter(filterValue, clickedBtn = null) {
      if (filterValue === "all" || (filterValue === State.activeFilter && filterValue !== "all")) {
        State.activeFilter = "all";
      } else {
        State.activeFilter = filterValue;
      }

      if (clickedBtn && typeof clickedBtn.blur === "function") {
        clickedBtn.blur();
      }

      this.syncUI();
      CalendarRenderer.render();
      if (State.isMonthModalOpen) {
        MonthModalController.renderCurrentMonth();
      }

      const filterAccordion = document.getElementById("filterAccordion");
      if (filterAccordion && filterAccordion.hasAttribute("open")) {
        filterAccordion.removeAttribute("open");
      }
    },

    syncUI() {
      const allFilterBtns = document.querySelectorAll(".btn-filter");
      allFilterBtns.forEach(btn => {
        const isMatch = btn.dataset.filter === State.activeFilter;
        btn.classList.toggle("active", isMatch);
        btn.setAttribute("aria-pressed", isMatch ? "true" : "false");
      });

      const activeFilterBadge = document.getElementById("activeFilterBadge");
      const filterAccordion = document.getElementById("filterAccordion");
      if (activeFilterBadge) {
        activeFilterBadge.textContent = State.activeFilter === "all" ? "Всі" : `Зміна ${State.activeFilter}`;
      }
      if (filterAccordion) {
        filterAccordion.classList.toggle("has-active-filter", State.activeFilter !== "all");
      }
    }
  };

  // --- 10. Calendar & Mobile Cards Renderer ---
  const CalendarRenderer = {
    render() {
      const yearInput = document.getElementById("yearInput");
      const calendarContainer = document.getElementById("calendarContainer");
      if (!yearInput || !calendarContainer) return;

      yearInput.value = State.currentYear;
      calendarContainer.innerHTML = "";
      const notes = StorageService.getStoredNotes();
      const isMobile = Utils.isMobileView();

      for (let monthIdx = 0; monthIdx < 12; monthIdx++) {
        let cardElement;
        if (isMobile) {
          cardElement = this.renderMobileMonthTile(State.currentYear, monthIdx, notes);
        } else {
          cardElement = this.renderDesktopMonthCard(State.currentYear, monthIdx, notes);
        }
        calendarContainer.appendChild(cardElement);
      }
    },

    renderDesktopMonthCard(year, monthIdx, notes) {
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
      const monthCard = document.createElement("div");
      monthCard.className = "month-card";

      let metaText = `${daysInMonth} днів`;
      if (State.activeFilter !== "all") {
        const stats = ShiftEngine.calculateMonthStats(State.activeFilter, year, monthIdx);
        metaText = `${daysInMonth} дн. • Зміна ${State.activeFilter}: ${stats.workDays} роб. / ${stats.offDays} вих.`;
      }

      const header = document.createElement("div");
      header.className = "month-header";
      header.innerHTML = `
        <div class="month-title">${CONFIG.MONTH_NAMES[monthIdx]} ${year}</div>
        <div class="month-meta">${metaText}</div>
      `;
      monthCard.appendChild(header);

      const tableWrapper = TableBuilder.buildMonthTable(year, monthIdx, notes, State.activeFilter, (cellData) => {
        NoteModalController.open(cellData);
      });
      monthCard.appendChild(tableWrapper);

      return monthCard;
    },

    renderMobileMonthTile(year, monthIdx, notes) {
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();
      const monthCard = document.createElement("div");
      monthCard.className = "month-card month-card-mobile";
      monthCard.setAttribute("tabindex", "0");
      monthCard.setAttribute("role", "button");
      monthCard.setAttribute("aria-label", `Відкрити графік: ${CONFIG.MONTH_NAMES[monthIdx]} ${year}`);

      // Count notes stored for this month (filtered by shift if filter active)
      const monthPrefix = `${year}-${String(monthIdx + 1).padStart(2, '0')}-`;
      let noteCount = 0;
      Object.keys(notes).forEach(key => {
        if (key.startsWith(monthPrefix)) {
          if (State.activeFilter === "all" || key.endsWith(`_${State.activeFilter}`)) {
            noteCount++;
          }
        }
      });

      const noteBtnClass = noteCount > 0 ? "btn-month-note has-notes" : "btn-month-note";
      const noteCountText = noteCount > 0 ? `<span class="note-count-badge">${noteCount}</span>` : ``;

      let metaText = `${daysInMonth} днів`;
      if (State.activeFilter !== "all") {
        const stats = ShiftEngine.calculateMonthStats(State.activeFilter, year, monthIdx);
        metaText = `Зміна ${State.activeFilter}: ${stats.workDays} роб.`;
      }

      monthCard.innerHTML = `
        <div class="month-header">
          <div class="month-title" style="display:flex; align-items:center; gap:8px;">
            <span class="material-symbols-outlined" style="font-size: 1.2rem;">calendar_month</span>
            <span>${CONFIG.MONTH_NAMES[monthIdx]} ${year}</span>
          </div>
          <div class="month-meta">${metaText}</div>
        </div>
        <div class="month-card-preview">
          <div class="${noteBtnClass}">
            <span class="material-symbols-outlined" style="font-size: 1.1rem;">edit_note</span>
            <span>Нотатки</span>
            ${noteCountText}
          </div>
          <span class="material-symbols-outlined open-arrow" style="color: var(--text-secondary);">arrow_outward</span>
        </div>
      `;

      const triggerOpen = () => {
        MonthModalController.open(year, monthIdx);
      };

      monthCard.addEventListener("click", () => {
        triggerOpen();
      });

      monthCard.addEventListener("focus", () => {
        // Only open on focus if not guarded against focus loop after modal close
        if (!State.ignoreMonthFocusGuard && !State.isMonthModalOpen) {
          triggerOpen();
        }
      });

      monthCard.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          triggerOpen();
        }
      });

      return monthCard;
    },

    scrollToToday() {
      setTimeout(() => {
        const calendarContainer = document.getElementById("calendarContainer");
        const todayCell = calendarContainer ? calendarContainer.querySelector(".cell-today") : null;
        if (todayCell && !State.isMonthModalOpen) {
          todayCell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        }
      }, 350);
    }
  };

  // --- 11. Mobile Month Modal Controller ---
  const MonthModalController = {
    open(year, monthIdx) {
      if (State.isMonthModalOpen || State.ignoreMonthFocusGuard) return;
      State.isMonthModalOpen = true;
      State.currentModalMonthIdx = monthIdx;

      this.renderCurrentMonth();

      const monthModal = document.getElementById("monthModal");
      if (monthModal) {
        monthModal.classList.add("active");
        Utils.updateModalScrollLock();
      }
    },

    close() {
      if (!State.isMonthModalOpen) return;
      State.isMonthModalOpen = false;
      State.ignoreMonthFocusGuard = true;

      const monthModal = document.getElementById("monthModal");
      if (monthModal) {
        monthModal.classList.remove("active");
        Utils.updateModalScrollLock();
      }

      // Blur currently active element to prevent immediate focus loop when modal closes
      if (document.activeElement) {
        document.activeElement.blur();
      }

      setTimeout(() => {
        State.ignoreMonthFocusGuard = false;
      }, 400);
    },

    renderCurrentMonth() {
      const monthModalTitle = document.getElementById("monthModalTitle");
      const monthModalSubtitle = document.getElementById("monthModalSubtitle");
      const monthModalTableContainer = document.getElementById("monthModalTableContainer");
      const monthModalStatsBar = document.getElementById("monthModalStatsBar");
      const btnPrevMonthModal = document.getElementById("btnPrevMonthModal");
      const btnNextMonthModal = document.getElementById("btnNextMonthModal");

      if (!monthModalTableContainer) return;

      const year = State.currentYear;
      const monthIdx = State.currentModalMonthIdx;
      const daysInMonth = new Date(year, monthIdx + 1, 0).getDate();

      if (monthModalTitle) monthModalTitle.textContent = `${CONFIG.MONTH_NAMES[monthIdx]} ${year}`;
      if (monthModalSubtitle) {
        monthModalSubtitle.textContent = State.activeFilter === "all"
          ? `${daysInMonth} днів • Загальний графік`
          : `${daysInMonth} днів • Фільтр: Зміна ${State.activeFilter}`;
      }

      if (monthModalStatsBar) {
        monthModalStatsBar.style.display = "flex";
        if (State.activeFilter !== "all") {
          const stats = ShiftEngine.calculateMonthStats(State.activeFilter, year, monthIdx);
          monthModalStatsBar.innerHTML = `
            <span>Зміна <b>${State.activeFilter}</b>: роб. днів <b>${stats.workDays}</b> (<b>1</b>:${stats.shift1} • <b>2</b>:${stats.shift2} • <b>3</b>:${stats.shift3})</span>
            <span>Вихідних: <b>${stats.offDays}</b></span>
          `;
        } else {
          monthModalStatsBar.innerHTML = `
            <span><b>1</b> — Нічна</span>
            <span><b>2</b> — Ранкова</span>
            <span><b>3</b> — Вечірня</span>
            <span>Порожньо — Вихідний</span>
          `;
        }
      }

      monthModalTableContainer.innerHTML = "";
      const notes = StorageService.getStoredNotes();

      const tableWrapper = TableBuilder.buildMonthTable(year, monthIdx, notes, State.activeFilter, (cellData) => {
        NoteModalController.open(cellData);
      });
      monthModalTableContainer.appendChild(tableWrapper);

      // Update Prev / Next buttons state
      if (btnPrevMonthModal) {
        btnPrevMonthModal.disabled = (monthIdx === 0 && year <= 1900);
      }
      if (btnNextMonthModal) {
        btnNextMonthModal.disabled = (monthIdx === 11 && year >= 2100);
      }
    },

    nextMonth() {
      if (State.currentModalMonthIdx < 11) {
        State.currentModalMonthIdx++;
      } else if (State.currentYear < 2100) {
        State.currentYear++;
        State.currentModalMonthIdx = 0;
        const yearInput = document.getElementById("yearInput");
        if (yearInput) yearInput.value = State.currentYear;
        CalendarRenderer.render();
      }
      this.renderCurrentMonth();
    },

    prevMonth() {
      if (State.currentModalMonthIdx > 0) {
        State.currentModalMonthIdx--;
      } else if (State.currentYear > 1900) {
        State.currentYear--;
        State.currentModalMonthIdx = 11;
        const yearInput = document.getElementById("yearInput");
        if (yearInput) yearInput.value = State.currentYear;
        CalendarRenderer.render();
      }
      this.renderCurrentMonth();
    },

    goToToday() {
      const now = new Date();
      State.today = now;
      const targetYear = now.getFullYear();
      const targetMonth = now.getMonth();

      if (State.currentYear !== targetYear) {
        State.currentYear = targetYear;
        const yearInput = document.getElementById("yearInput");
        if (yearInput) yearInput.value = State.currentYear;
        CalendarRenderer.render();
      }

      if (State.isMonthModalOpen) {
        State.currentModalMonthIdx = targetMonth;
        this.renderCurrentMonth();
        this.scrollToToday();
      } else {
        this.open(targetYear, targetMonth);
        this.scrollToToday();
      }
    },

    scrollToToday() {
      setTimeout(() => {
        const modalContainer = document.getElementById("monthModalTableContainer");
        const todayCell = modalContainer ? modalContainer.querySelector(".cell-today") : document.querySelector(".cell-today");
        if (todayCell) {
          todayCell.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
        }
      }, 300);
    }
  };

  // --- 12. Note Modal Controller ---
  const NoteModalController = {
    open(data) {
      State.activeNoteTarget = data;
      const modalDateTitle = document.getElementById("modalDateTitle");
      const noteStatusSelect = document.getElementById("noteStatusSelect");
      const noteTextInput = document.getElementById("noteTextInput");
      const btnDeleteNote = document.getElementById("btnDeleteNote");
      const noteModal = document.getElementById("noteModal");

      const shiftTypeName = Utils.getShiftName(data.shift);
      const shiftText = data.shift ? shiftTypeName : "Вихідний";
      if (modalDateTitle) {
        modalDateTitle.textContent = `${data.dateStr} (${data.shiftGroup}) — ${shiftText}`;
      }

      if (data.note) {
        if (noteStatusSelect) noteStatusSelect.value = data.note.statusTag || "normal";
        if (noteTextInput) noteTextInput.value = data.note.text || "";
        if (btnDeleteNote) btnDeleteNote.style.display = "inline-flex";
      } else {
        if (noteStatusSelect) noteStatusSelect.value = "normal";
        if (noteTextInput) noteTextInput.value = "";
        if (btnDeleteNote) btnDeleteNote.style.display = "none";
      }

      if (noteModal) {
        noteModal.classList.add("active");
        Utils.updateModalScrollLock();
      }
    },

    close() {
      const noteModal = document.getElementById("noteModal");
      if (noteModal) {
        noteModal.classList.remove("active");
        State.activeNoteTarget = null;
        Utils.updateModalScrollLock();
      }
    },

    save() {
      if (!State.activeNoteTarget) return;

      const noteStatusSelect = document.getElementById("noteStatusSelect");
      const noteTextInput = document.getElementById("noteTextInput");
      const statusTag = noteStatusSelect ? noteStatusSelect.value : "normal";
      const text = noteTextInput ? noteTextInput.value.trim() : "";

      if (statusTag === "normal" && !text) {
        StorageService.setNote(State.activeNoteTarget.dateStr, State.activeNoteTarget.shiftGroup, null);
      } else {
        StorageService.setNote(State.activeNoteTarget.dateStr, State.activeNoteTarget.shiftGroup, {
          statusTag,
          text,
          updatedAt: new Date().toISOString()
        });
      }

      this.close();
      CalendarRenderer.render();
      if (State.isMonthModalOpen) {
        MonthModalController.renderCurrentMonth();
      }
      Utils.showToast("Нотатку збережено");
    },

    delete() {
      if (!State.activeNoteTarget) return;
      StorageService.setNote(State.activeNoteTarget.dateStr, State.activeNoteTarget.shiftGroup, null);
      this.close();
      CalendarRenderer.render();
      if (State.isMonthModalOpen) {
        MonthModalController.renderCurrentMonth();
      }
      Utils.showToast("Нотатку видалено");
    }
  };

  // --- 13. Notes List Drawer Controller ---
  const NotesListController = {
    open() {
      this.renderList();
      const notesListModal = document.getElementById("notesListModal");
      if (notesListModal) {
        notesListModal.classList.add("active");
        Utils.updateModalScrollLock();
      }
    },

    close() {
      const notesListModal = document.getElementById("notesListModal");
      if (notesListModal) {
        notesListModal.classList.remove("active");
        Utils.updateModalScrollLock();
      }
    },

    renderList() {
      const notesSearchInput = document.getElementById("notesSearchInput");
      const notesListContainer = document.getElementById("notesListContainer");
      if (!notesListContainer) return;

      const notes = StorageService.getStoredNotes();
      const query = (notesSearchInput && notesSearchInput.value ? notesSearchInput.value : "").toLowerCase().trim();
      notesListContainer.innerHTML = "";

      const keys = Object.keys(notes).sort();

      if (keys.length === 0) {
        notesListContainer.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 24px;">Нотатки відсутні</div>`;
        return;
      }

      let count = 0;
      keys.forEach(key => {
        const note = notes[key];
        const parts = key.split("_");
        const dateStr = parts[0];
        const shiftGroup = parts[1];
        const statusDisplay = (note.statusTag && note.statusTag !== "normal") ? note.statusTag : "Зміна";

        const fullText = `${dateStr} ${shiftGroup} ${statusDisplay} ${note.text || ''}`.toLowerCase();
        if (query && !fullText.includes(query)) return;

        count++;
        const item = document.createElement("div");
        item.className = "note-item";
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.title = "Натисніть, щоб редагувати нотатку";
        item.innerHTML = `
          <div>
            <div class="note-meta">📅 ${Utils.escapeHtml(dateStr)} | Зміна ${Utils.escapeHtml(shiftGroup)} [${Utils.escapeHtml(statusDisplay)}]</div>
            <div class="note-text">${Utils.escapeHtml(note.text || 'Без тексту')}</div>
          </div>
          <button type="button" class="btn-delete-note" title="Видалити" aria-label="Видалити">🗑️</button>
        `;

        item.addEventListener("click", () => {
          const dateParts = dateStr.split("-").map(Number);
          const y = dateParts[0];
          const mIdx = (dateParts[1] || 1) - 1;
          const d = dateParts[2] || 1;
          const shiftVal = ShiftEngine.calculateShift(shiftGroup, y, mIdx, d);
          this.close();
          NoteModalController.open({
            dateStr,
            shiftGroup,
            year: y,
            monthIdx: mIdx,
            day: d,
            shift: shiftVal,
            note
          });
        });

        item.querySelector(".btn-delete-note").addEventListener("click", (e) => {
          e.stopPropagation();
          StorageService.setNote(dateStr, shiftGroup, null);
          this.renderList();
          CalendarRenderer.render();
          if (State.isMonthModalOpen) {
            MonthModalController.renderCurrentMonth();
          }
          Utils.showToast("Нотатку видалено");
        });

        notesListContainer.appendChild(item);
      });

      if (count === 0) {
        notesListContainer.innerHTML = `<div style="text-align: center; color: var(--text-secondary); padding: 24px;">Нічого не знайдено за запитом "${Utils.escapeHtml(query)}"</div>`;
      }
    }
  };

  // --- 14. QR Code Modal Controller ---
  const QrController = {
    open() {
      const qrImage = document.getElementById("qrImage");
      const qrModal = document.getElementById("qrModal");

      const currentUrl = window.location.href;

      if (qrImage) {
        const qrApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(currentUrl)}&margin=10`;
        qrImage.src = qrApiUrl;
      }

      if (qrModal) {
        qrModal.classList.add("active");
        Utils.updateModalScrollLock();
      }
    },

    close() {
      const qrModal = document.getElementById("qrModal");
      if (qrModal) {
        qrModal.classList.remove("active");
        Utils.updateModalScrollLock();
      }
    },

    copyUrl() {
      const url = window.location.href;

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
          Utils.showToast("📋 Посилання скопійовано в буфер обміну!");
        }).catch(() => {
          this.fallbackCopy(url);
        });
      } else {
        this.fallbackCopy(url);
      }
    },

    fallbackCopy(text) {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      
      // Prevent scrolling to bottom of page in MS Edge.
      textArea.style.top = "0";
      textArea.style.left = "0";
      textArea.style.position = "fixed";

      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      try {
        document.execCommand('copy');
        Utils.showToast("📋 Посилання скопійовано!");
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err);
      }

      document.body.removeChild(textArea);
    },

    shareNative() {
      const url = window.location.href;
      if (navigator.share) {
        navigator.share({
          title: "Графік змін",
          text: "Перегляд графіка змін 2025-2030+",
          url: url
        }).catch(() => {});
      } else {
        this.copyUrl();
      }
    }
  };

  // --- 15. Feedback Controller ---
  const FeedbackController = {
    open() {
      const feedbackText = document.getElementById("feedbackText");
      const feedbackContact = document.getElementById("feedbackContact");
      const feedbackModal = document.getElementById("feedbackModal");

      if (feedbackText) feedbackText.value = "";
      if (feedbackContact) feedbackContact.value = "";
      State.selectedRating = 5;
      this.updateStarUI(5);

      if (feedbackModal) {
        feedbackModal.classList.add("active");
        Utils.updateModalScrollLock();
      }
    },

    close() {
      const feedbackModal = document.getElementById("feedbackModal");
      if (feedbackModal) {
        feedbackModal.classList.remove("active");
        Utils.updateModalScrollLock();
      }
    },

    updateStarUI(rating) {
      const starRating = document.getElementById("starRating");
      if (!starRating) return;
      const stars = starRating.querySelectorAll("span");
      stars.forEach(s => {
        const val = parseInt(s.dataset.star, 10);
        const isActive = val <= rating;
        s.classList.toggle("active", isActive);
        s.setAttribute("aria-checked", val === rating ? "true" : "false");
      });
    },

    submit() {
      const feedbackContact = document.getElementById("feedbackContact");
      const feedbackText = document.getElementById("feedbackText");

      const contact = feedbackContact ? feedbackContact.value.trim() : "";
      const text = feedbackText ? feedbackText.value.trim() : "";

      if (!text) {
        Utils.showToast("Будь ласка, введіть текст вашого повідомлення");
        return;
      }

      const feedbackData = {
        date: new Date().toISOString(),
        rating: State.selectedRating,
        contact,
        text
      };

      const feedbacks = JSON.parse(Utils.safeGetItem(CONFIG.STORAGE_KEYS.FEEDBACKS, "[]"));
      feedbacks.push(feedbackData);
      Utils.safeSetItem(CONFIG.STORAGE_KEYS.FEEDBACKS, JSON.stringify(feedbacks));

      const stars = "⭐".repeat(feedbackData.rating);
      const textMessage = `
⚡ <b>Новий відгук з додатку Графік змін!</b>

<b>Оцінка:</b> ${stars} (${feedbackData.rating}/5)
<b>Контакт:</b> ${Utils.escapeHtml(feedbackData.contact || 'Не вказано')}
<b>Дата:</b> ${new Date().toLocaleString('uk-UA')}

<b>Текст відгуку:</b>
${Utils.escapeHtml(feedbackData.text)}
      `.trim();

      TelegramService.sendOrQueue(textMessage, "Відгук успішно надіслано! ✅", "Відгук збережено в офлайн-чергу");
      this.close();
    }
  };

  // --- 16. Install App Controller ---
  const InstallAppController = {
    init() {
      const installAppModal = document.getElementById("installAppModal");
      const appHeaderTitle = document.getElementById("appHeaderTitle");
      
      if (appHeaderTitle) {
        appHeaderTitle.addEventListener("click", () => {
          if (installAppModal) {
            installAppModal.classList.add("active");
            Utils.updateModalScrollLock();
          }
        });
      }

      const btnCloseInstallModal = document.getElementById("btnCloseInstallModal");
      const btnGotItInstall = document.getElementById("btnGotItInstall");

      [btnCloseInstallModal, btnGotItInstall].forEach(btn => {
        if (btn) {
          btn.addEventListener("click", () => this.close());
        }
      });
    },
    
    close() {
      const installAppModal = document.getElementById("installAppModal");
      if (installAppModal) {
        installAppModal.classList.remove("active");
        Utils.updateModalScrollLock();
      }
    }
  };

  // --- 17. App Orchestrator & Event Handlers ---
  const App = {
    init() {
      StorageService.trackUsage();
      ThemeService.init();
      FilterController.syncUI();
      this.setupEventListeners();
      CalendarRenderer.render();
      TelegramService.flushOutbox();

      // Під час завантаження: відкриваємо модальне вікно з поточним місяцем та скролимо до поточного числа
      const now = State.today;
      if (State.currentYear === now.getFullYear()) {
        MonthModalController.open(State.currentYear, now.getMonth());
        MonthModalController.scrollToToday();
      } else {
        CalendarRenderer.scrollToToday();
      }

      InstallAppController.init();
    },

    setupEventListeners() {
      const btnPrevYear = document.getElementById("btnPrevYear");
      const btnNextYear = document.getElementById("btnNextYear");
      const yearInput = document.getElementById("yearInput");
      const btnTodayHeader = document.getElementById("btnTodayHeader");
      const btnTodayModal = document.getElementById("btnTodayModal");
      const btnThemeToggle = document.getElementById("btnThemeToggle");
      const shiftFilterButtons = document.querySelectorAll(".btn-filter");
      const filterAccordion = document.getElementById("filterAccordion");

      if (btnPrevYear) {
        btnPrevYear.addEventListener("click", () => {
          if (State.currentYear > 1900) {
            State.currentYear--;
            if (yearInput) yearInput.value = State.currentYear;
            CalendarRenderer.render();
            if (State.isMonthModalOpen) MonthModalController.renderCurrentMonth();
          }
        });
      }

      if (btnNextYear) {
        btnNextYear.addEventListener("click", () => {
          if (State.currentYear < 2100) {
            State.currentYear++;
            if (yearInput) yearInput.value = State.currentYear;
            CalendarRenderer.render();
            if (State.isMonthModalOpen) MonthModalController.renderCurrentMonth();
          }
        });
      }

      if (yearInput) {
        yearInput.addEventListener("change", () => {
          const val = parseInt(yearInput.value, 10);
          if (!isNaN(val) && val >= 1900 && val <= 2100) {
            State.currentYear = val;
            CalendarRenderer.render();
            if (State.isMonthModalOpen) MonthModalController.renderCurrentMonth();
          } else {
            yearInput.value = State.currentYear;
          }
        });
      }

      if (btnTodayHeader) {
        btnTodayHeader.addEventListener("click", () => MonthModalController.goToToday());
      }
      if (btnTodayModal) {
        btnTodayModal.addEventListener("click", () => MonthModalController.goToToday());
      }

      shiftFilterButtons.forEach(btn => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          FilterController.setFilter(btn.dataset.filter, btn);
        });
      });

      // Close filter accordion when clicking outside
      document.addEventListener("click", (e) => {
        if (filterAccordion && filterAccordion.hasAttribute("open") && !filterAccordion.contains(e.target)) {
          filterAccordion.removeAttribute("open");
        }
      });

      if (btnThemeToggle) btnThemeToggle.addEventListener("click", () => ThemeService.toggle());

      // Note Modal Listeners
      const btnCloseNoteModal = document.getElementById("btnCloseNoteModal");
      const btnCancelNote = document.getElementById("btnCancelNote");
      const btnSaveNote = document.getElementById("btnSaveNote");
      const btnDeleteNote = document.getElementById("btnDeleteNote");
      if (btnCloseNoteModal) btnCloseNoteModal.addEventListener("click", () => NoteModalController.close());
      if (btnCancelNote) btnCancelNote.addEventListener("click", () => NoteModalController.close());
      if (btnSaveNote) btnSaveNote.addEventListener("click", () => NoteModalController.save());
      if (btnDeleteNote) btnDeleteNote.addEventListener("click", () => NoteModalController.delete());

      // Month Modal Listeners
      const btnCloseMonthModal = document.getElementById("btnCloseMonthModal");
      const btnDoneMonthModal = document.getElementById("btnDoneMonthModal");
      const btnPrevMonthModal = document.getElementById("btnPrevMonthModal");
      const btnNextMonthModal = document.getElementById("btnNextMonthModal");
      if (btnCloseMonthModal) btnCloseMonthModal.addEventListener("click", () => MonthModalController.close());
      if (btnDoneMonthModal) btnDoneMonthModal.addEventListener("click", () => MonthModalController.close());
      if (btnPrevMonthModal) btnPrevMonthModal.addEventListener("click", () => MonthModalController.prevMonth());
      if (btnNextMonthModal) btnNextMonthModal.addEventListener("click", () => MonthModalController.nextMonth());

      // Notes List Listeners
      const btnCloseNotesListModal = document.getElementById("btnCloseNotesListModal");
      const notesSearchInput = document.getElementById("notesSearchInput");
      const btnsNotesList = document.querySelectorAll(".btn-notes-list, #btnNotesList");
      btnsNotesList.forEach(btn => btn.addEventListener("click", () => NotesListController.open()));
      if (btnCloseNotesListModal) btnCloseNotesListModal.addEventListener("click", () => NotesListController.close());
      if (notesSearchInput) notesSearchInput.addEventListener("input", () => NotesListController.renderList());

      // QR Code Listeners
      const btnCloseQrModal = document.getElementById("btnCloseQrModal");
      const btnCopyUrl = document.getElementById("btnCopyUrl");
      const btnShareNative = document.getElementById("btnShareNative");
      const btnsQrCode = document.querySelectorAll(".btn-qr-code, #btnQrCode");
      btnsQrCode.forEach(btn => btn.addEventListener("click", () => QrController.open()));
      if (btnCloseQrModal) btnCloseQrModal.addEventListener("click", () => QrController.close());
      if (btnCopyUrl) btnCopyUrl.addEventListener("click", () => QrController.copyUrl());
      if (btnShareNative) btnShareNative.addEventListener("click", () => QrController.shareNative());

      // Feedback Listeners
      const btnCloseFeedbackModal = document.getElementById("btnCloseFeedbackModal");
      const btnCancelFeedback = document.getElementById("btnCancelFeedback");
      const btnSubmitFeedback = document.getElementById("btnSubmitFeedback");
      const starRating = document.getElementById("starRating");
      const btnsFeedback = document.querySelectorAll(".btn-feedback, #btnFeedback");
      btnsFeedback.forEach(btn => btn.addEventListener("click", () => FeedbackController.open()));
      if (btnCloseFeedbackModal) btnCloseFeedbackModal.addEventListener("click", () => FeedbackController.close());
      if (btnCancelFeedback) btnCancelFeedback.addEventListener("click", () => FeedbackController.close());
      if (btnSubmitFeedback) btnSubmitFeedback.addEventListener("click", () => FeedbackController.submit());

      if (starRating) {
        const stars = starRating.querySelectorAll("span");
        stars.forEach(star => {
          star.addEventListener("click", () => {
            State.selectedRating = parseInt(star.dataset.star, 10);
            FeedbackController.updateStarUI(State.selectedRating);
          });
        });
      }

      // Backdrop Click & Mobile Drawer Handle Swipe-to-Close for all modals
      const modalMap = [
        { id: "noteModal", close: () => NoteModalController.close() },
        { id: "notesListModal", close: () => NotesListController.close() },
        { id: "qrModal", close: () => QrController.close() },
        { id: "feedbackModal", close: () => FeedbackController.close() },
        { id: "monthModal", close: () => MonthModalController.close() },
        { id: "installAppModal", close: () => InstallAppController.close() }
      ];

      modalMap.forEach(item => {
        const modalEl = document.getElementById(item.id);
        if (modalEl) {
          modalEl.addEventListener("click", (e) => {
            if (e.target === modalEl) {
              item.close();
            }
          });

          const handle = modalEl.querySelector(".drawer-handle");
          if (handle) {
            let touchStartY = 0;
            handle.addEventListener("touchstart", (e) => {
              touchStartY = e.touches[0].clientY;
            }, { passive: true });
            handle.addEventListener("touchend", (e) => {
              if (e.changedTouches[0].clientY - touchStartY > 45) {
                item.close();
              }
            }, { passive: true });
          }
        }
      });

      // Global Escape Key Listener for Closing Modals in Z-Index Priority Order
      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          for (const item of modalMap) {
            const modalEl = document.getElementById(item.id);
            if (modalEl && modalEl.classList.contains("active")) {
              item.close();
              return;
            }
          }
          if (filterAccordion && filterAccordion.hasAttribute("open")) {
            filterAccordion.removeAttribute("open");
          }
        }
      });

      // Online status change auto-flush outbox
      window.addEventListener("online", () => TelegramService.flushOutbox());

      // Responsive media query listener to automatically toggle mobile/desktop views on resize or rotation
      const mediaQuery = window.matchMedia(CONFIG.MOBILE_BREAKPOINT_QUERY);
      if (mediaQuery.addEventListener) {
        mediaQuery.addEventListener("change", () => CalendarRenderer.render());
      } else if (mediaQuery.addListener) {
        mediaQuery.addListener(() => CalendarRenderer.render());
      }
    }
  };

  // --- 18. DOMContentLoaded Launch ---
  document.addEventListener("DOMContentLoaded", () => {
    App.init();
  });

})();
