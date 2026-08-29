(function(){
  "use strict";

  var MAX_ACTIVE = 10;
  var KEYS = { habits:'dt_habits_v1', records:'dt_records_v1' };

  // ---------- storage ----------
  function loadHabits(){
    try { var raw = localStorage.getItem(KEYS.habits); return raw ? JSON.parse(raw) : []; }
    catch(e){ return []; }
  }
  function saveHabits(list){
    try { localStorage.setItem(KEYS.habits, JSON.stringify(list)); }
    catch(e){ alert('Could not save that habit. Your browser storage may be full or disabled.'); }
  }
  function loadRecords(){
    try { var raw = localStorage.getItem(KEYS.records); return raw ? JSON.parse(raw) : {}; }
    catch(e){ return {}; }
  }
  function saveRecords(rec){
    try { localStorage.setItem(KEYS.records, JSON.stringify(rec)); }
    catch(e){ alert('Could not save that entry. Your browser storage may be full or disabled.'); }
  }

  var habits = loadHabits();
  var records = loadRecords();

  // ---------- date helpers ----------
  function getLocalDateString(d){
    d = d || new Date();
    var y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return y + '-' + m + '-' + day;
  }
  function todayStr(){ return getLocalDateString(new Date()); }
  function dateFromISO(iso){ return new Date(iso + 'T00:00:00'); }
  function makeId(){ return 'h_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8); }
  function escapeHtml(str){
    return String(str == null ? '' : str).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }
  function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
  function activeCount(){ return habits.filter(function(h){ return h.active; }).length; }
  function earliestHabitDate(){
    if (!habits.length) return null;
    return habits.reduce(function(m,h){ return h.createdDate < m ? h.createdDate : m; }, habits[0].createdDate);
  }

  // ---------- record status ----------
  function getRecordStatus(habitId, dateStr){
    return (records[dateStr] && records[dateStr][habitId]) || 'unanswered';
  }
  function setRecordStatus(habitId, dateStr, status){
    if (!records[dateStr]) records[dateStr] = {};
    if (status === 'unanswered'){
      delete records[dateStr][habitId];
      if (Object.keys(records[dateStr]).length === 0) delete records[dateStr];
    } else {
      records[dateStr][habitId] = status;
    }
    saveRecords(records);
  }
  function computeDailyScore(dateStr){
    var applicable = habits.filter(function(h){ return h.active && h.createdDate <= dateStr; });
    var total = applicable.length;
    if (total === 0) return { completed:0, total:0, percent:null };
    var completed = applicable.filter(function(h){ return getRecordStatus(h.id, dateStr) === 'completed'; }).length;
    return { completed:completed, total:total, percent:Math.round(completed/total*100) };
  }

  // ---------- streak helpers (generic) ----------
  function currentStreakFor(isGoodFn, sinceDate){
    var streak = 0;
    var cursor = new Date();
    var ds = getLocalDateString(cursor);
    if (!isGoodFn(ds)) cursor.setDate(cursor.getDate()-1);
    while (true){
      ds = getLocalDateString(cursor);
      if (sinceDate && ds < sinceDate) break;
      if (isGoodFn(ds)){ streak++; cursor.setDate(cursor.getDate()-1); }
      else break;
    }
    return streak;
  }
  function bestStreakFor(isGoodFn, sinceDate){
    if (!sinceDate) return 0;
    var cursor = dateFromISO(sinceDate);
    var end = new Date();
    var run = 0, best = 0;
    while (cursor <= end){
      var ds = getLocalDateString(cursor);
      if (isGoodFn(ds)){ run++; if (run > best) best = run; }
      else { run = 0; }
      cursor.setDate(cursor.getDate()+1);
    }
    return best;
  }
  function isStreakDay(ds){
    var rec = records[ds];
    if (!rec) return false;
    return Object.keys(rec).some(function(hid){ return rec[hid] === 'completed'; });
  }
  function computeOverallCurrentStreak(){ return currentStreakFor(isStreakDay, earliestHabitDate()); }
  function computeOverallBestStreak(){ return bestStreakFor(isStreakDay, earliestHabitDate()); }

  // ---------- per-habit stats ----------
  function computeHabitStats(h){
    var since = h.createdDate, end = new Date();
    var cursor = dateFromISO(since);
    var totalDays = 0, completedDays = 0;
    while (cursor <= end){
      totalDays++;
      if (getRecordStatus(h.id, getLocalDateString(cursor)) === 'completed') completedDays++;
      cursor.setDate(cursor.getDate()+1);
    }
    var percent = totalDays > 0 ? Math.round(completedDays/totalDays*100) : 0;
    var isGood = function(ds){ return getRecordStatus(h.id, ds) === 'completed'; };
    return {
      totalDays: totalDays, completedDays: completedDays, percent: percent,
      current: currentStreakFor(isGood, since), best: bestStreakFor(isGood, since)
    };
  }

  // ---------- range rates ----------
  function rateOverLastNDays(n, offset){
    var vals = [];
    var today = new Date();
    for (var i = offset + n - 1; i >= offset; i--){
      var d = new Date(today); d.setDate(d.getDate()-i);
      var s = computeDailyScore(getLocalDateString(d));
      if (s.total > 0) vals.push(s.percent);
    }
    if (!vals.length) return null;
    return Math.round(vals.reduce(function(a,b){ return a+b; },0) / vals.length);
  }
  function last7Rate(){ return rateOverLastNDays(7,0); }
  function previous7Rate(){ return rateOverLastNDays(7,7); }
  function overallRate(){
    var since = earliestHabitDate();
    if (!since) return null;
    var cursor = dateFromISO(since), end = new Date();
    var totalC = 0, totalA = 0;
    while (cursor <= end){
      var s = computeDailyScore(getLocalDateString(cursor));
      totalC += s.completed; totalA += s.total;
      cursor.setDate(cursor.getDate()+1);
    }
    return totalA > 0 ? Math.round(totalC/totalA*100) : null;
  }

  // ---------- scores ----------
  function computeDisciplineScore(){
    var l7 = last7Rate();
    if (l7 === null) return null;
    var overall = overallRate();
    var streakFactor = Math.min(computeOverallCurrentStreak()/30, 1) * 100;
    var ov = overall === null ? l7 : overall;
    return Math.round(0.5*l7 + 0.25*streakFactor + 0.25*ov);
  }
  function computeConsistencyScore(){
    var since = earliestHabitDate();
    if (!since) return null;
    var cursor = dateFromISO(since), end = new Date();
    var totalDays = 0, streakDays = 0;
    while (cursor <= end){
      totalDays++;
      if (isStreakDay(getLocalDateString(cursor))) streakDays++;
      cursor.setDate(cursor.getDate()+1);
    }
    var streakRate = totalDays > 0 ? streakDays/totalDays*100 : 0;
    var ov = overallRate();
    return ov === null ? Math.round(streakRate) : Math.round(0.6*streakRate + 0.4*ov);
  }
  function computeGrowthScore(){
    var l7 = last7Rate();
    if (l7 === null) return null;
    var p7 = previous7Rate();
    if (p7 === null) return l7;
    return clamp(Math.round(50 + (l7-p7)/2), 0, 100);
  }
  function computeTrend(){
    var l7 = last7Rate(), p7 = previous7Rate();
    if (l7 === null || p7 === null) return null;
    var diff = l7 - p7;
    var label = diff > 5 ? 'Improving' : diff < -5 ? 'Declining' : 'Stable';
    return { label: label, diff: diff };
  }

  // ---------- achievements & records ----------
  function computeAchievements(){
    var since = earliestHabitDate();
    var best80 = false, best100 = false, daysTracked = 0;
    var bestStreakAll = computeOverallBestStreak();
    if (since){
      var cursor = dateFromISO(since), end = new Date();
      while (cursor <= end){
        var s = computeDailyScore(getLocalDateString(cursor));
        if (s.total > 0){
          if (s.percent >= 80) best80 = true;
          if (s.percent >= 100) best100 = true;
        }
        daysTracked++;
        cursor.setDate(cursor.getDate()+1);
      }
    }
    return [
      { icon:'\u2b50', label:'First Day', unlocked: bestStreakAll >= 1 },
      { icon:'\ud83d\udd25', label:'3 Day Streak', unlocked: bestStreakAll >= 3 },
      { icon:'\ud83d\udd25', label:'7 Day Streak', unlocked: bestStreakAll >= 7 },
      { icon:'\ud83d\udd25', label:'14 Day Streak', unlocked: bestStreakAll >= 14 },
      { icon:'\ud83c\udfc6', label:'30 Day Streak', unlocked: bestStreakAll >= 30 },
      { icon:'\ud83d\udcaa', label:'80% Day', unlocked: best80 },
      { icon:'\ud83d\udcaf', label:'100% Day', unlocked: best100 },
      { icon:'\ud83d\udcc5', label:'7 Days Tracked', unlocked: daysTracked >= 7 },
      { icon:'\ud83d\uddd3\ufe0f', label:'30 Days Tracked', unlocked: daysTracked >= 30 }
    ];
  }
  function computePersonalRecords(){
    var totalCompleted = 0;
    Object.keys(records).forEach(function(ds){
      Object.keys(records[ds]).forEach(function(hid){ if (records[ds][hid] === 'completed') totalCompleted++; });
    });
    var since = earliestHabitDate();
    var bestDay = 0, daysTracked = 0;
    if (since){
      var cursor = dateFromISO(since), end = new Date();
      while (cursor <= end){
        var s = computeDailyScore(getLocalDateString(cursor));
        if (s.total > 0 && s.percent > bestDay) bestDay = s.percent;
        daysTracked++;
        cursor.setDate(cursor.getDate()+1);
      }
    }
    var mostConsistent = null, mostConsistentPct = -1;
    habits.filter(function(h){ return h.active; }).forEach(function(h){
      var stats = computeHabitStats(h);
      if (stats.totalDays >= 3 && stats.percent > mostConsistentPct){ mostConsistentPct = stats.percent; mostConsistent = h; }
    });
    return {
      bestDay: bestDay, bestStreak: computeOverallBestStreak(),
      mostConsistentName: mostConsistent ? mostConsistent.name : null, mostConsistentPct: mostConsistent ? mostConsistentPct : null,
      totalCompleted: totalCompleted, daysTracked: daysTracked
    };
  }

  // ---------- DOM refs ----------
  var dateEyebrow = document.getElementById('dateEyebrow');
  var scoreHero = document.getElementById('scoreHero');
  var habitListEl = document.getElementById('habitList');
  var emptyStateEl = document.getElementById('emptyState');
  var noActiveStateEl = document.getElementById('noActiveState');
  var todayScreen = document.getElementById('todayScreen');
  var dashboardScreen = document.getElementById('dashboardScreen');
  var habitsScreen = document.getElementById('habitsScreen');
  var dashEmpty = document.getElementById('dashEmpty');
  var dashContent = document.getElementById('dashContent');
  var manageList = document.getElementById('manageList');
  var manageCount = document.getElementById('manageCount');
  var fabAddBtn = document.getElementById('fabAddBtn');
  var sheetOverlay = document.getElementById('sheetOverlay');
  var sheetTitle = document.getElementById('sheetTitle');
  var sheetError = document.getElementById('sheetError');
  var habitNameInput = document.getElementById('habitNameInput');
  var habitIconInput = document.getElementById('habitIconInput');
  var habitDescInput = document.getElementById('habitDescInput');
  var editOnlyRow = document.getElementById('editOnlyRow');
  var toggleActiveBtn = document.getElementById('toggleActiveBtn');

  var sheetMode = 'add';
  var currentEditId = null;
  var currentScreen = 'today';

  // ---------- Today rendering ----------
  function renderScoreHeroInto(el, dateStr, subLabel){
    var s = computeDailyScore(dateStr);
    var r = 42, circumference = 2*Math.PI*r;
    var pct = s.percent == null ? 0 : s.percent;
    var offset = circumference * (1 - pct/100);
    el.innerHTML =
      '<div class="score-ring-wrap">' +
        '<svg viewBox="0 0 100 100" class="score-ring">' +
          '<circle cx="50" cy="50" r="' + r + '" class="score-ring-track"></circle>' +
          '<circle cx="50" cy="50" r="' + r + '" class="score-ring-fill" style="stroke-dasharray:' + circumference + ';stroke-dashoffset:' + offset + '"></circle>' +
        '</svg>' +
        '<div class="score-ring-label">' +
          '<div class="score-pct">' + (s.total === 0 ? '\u2013' : pct + '%') + '</div>' +
          '<div class="score-sub">' + (s.total === 0 ? 'no habits' : subLabel) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="score-body">' +
        (s.total === 0
          ? '<p class="score-completed">Add your first habit to begin.</p>'
          : '<p class="score-completed">Completed <strong>' + s.completed + ' / ' + s.total + '</strong></p>' +
            '<p class="score-formula">= completed \u00F7 active habits, \u00D7 100</p>') +
      '</div>';
  }

  function renderThread(habitId, createdDate){
    var out = '';
    var today = new Date();
    for (var i = 6; i >= 0; i--){
      var d = new Date(today); d.setDate(d.getDate()-i);
      var ds = getLocalDateString(d);
      var cls = 'thread-dot';
      if (createdDate && ds < createdDate){
        cls += ' thread-dot--void';
      } else {
        var status = getRecordStatus(habitId, ds);
        cls += status === 'completed' ? ' thread-dot--done' : status === 'missed' ? ' thread-dot--missed' : ' thread-dot--empty';
      }
      out += '<span class="' + cls + '"></span>';
    }
    return out;
  }

  function renderHabitList(){
    if (habits.length === 0){
      emptyStateEl.hidden = false; noActiveStateEl.hidden = true;
      habitListEl.hidden = true; habitListEl.innerHTML = '';
      return;
    }
    emptyStateEl.hidden = true;
    var active = habits.filter(function(h){ return h.active; }).sort(function(a,b){ return a.order - b.order; });
    if (active.length === 0){
      noActiveStateEl.hidden = false;
      habitListEl.hidden = true; habitListEl.innerHTML = '';
      return;
    }
    noActiveStateEl.hidden = true;
    habitListEl.hidden = false;
    var today = todayStr();
    habitListEl.innerHTML = active.map(function(h){
      var status = getRecordStatus(h.id, today);
      return (
        '<div class="habit-card" data-id="' + h.id + '">' +
          '<div class="habit-card-main">' +
            '<div class="habit-icon">' + (escapeHtml(h.icon) || '\u2022') + '</div>' +
            '<div class="habit-info">' +
              '<p class="habit-name">' + escapeHtml(h.name) + '</p>' +
              (h.description ? '<p class="habit-desc">' + escapeHtml(h.description) + '</p>' : '') +
              '<div class="habit-thread">' + renderThread(h.id, h.createdDate) + '</div>' +
            '</div>' +
            '<button class="habit-more" data-action="edit" aria-label="Edit ' + escapeHtml(h.name) + '">\u22EF</button>' +
          '</div>' +
          '<div class="habit-actions">' +
            '<button class="btn-done' + (status==='completed'?' is-active':'') + '" data-action="done" aria-pressed="' + (status==='completed') + '">\u2705 Done</button>' +
            '<button class="btn-notdone' + (status==='missed'?' is-active':'') + '" data-action="notdone" aria-pressed="' + (status==='missed') + '">\u274C Not done</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  function renderToday(){
    dateEyebrow.textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
    renderScoreHeroInto(scoreHero, todayStr(), 'today');
    renderHabitList();
  }

  // ---------- Habits screen rendering ----------
  function renderManageList(){
    manageCount.textContent = activeCount() + ' of ' + MAX_ACTIVE + ' active';
    var sorted = habits.slice().sort(function(a,b){
      if (a.active !== b.active) return a.active ? -1 : 1;
      return a.order - b.order;
    });
    if (sorted.length === 0){
      manageList.innerHTML = '<p style="color:var(--text-dim);font-size:14px;">No habits yet. Tap + to add one.</p>';
      return;
    }
    manageList.innerHTML = sorted.map(function(h){
      return (
        '<div class="manage-row">' +
          '<div class="manage-row-main">' +
            '<span class="manage-icon">' + (escapeHtml(h.icon) || '\u2022') + '</span>' +
            '<span class="manage-name">' + escapeHtml(h.name) + '</span>' +
          '</div>' +
          '<div class="manage-row-actions">' +
            '<button class="pill ' + (h.active ? 'pill--active' : 'pill--inactive') + '" data-toggle="' + h.id + '">' + (h.active ? 'Active' : 'Disabled') + '</button>' +
            '<button class="link-btn" data-edit="' + h.id + '">Edit</button>' +
          '</div>' +
        '</div>'
      );
    }).join('');
  }

  // ---------- Dashboard rendering ----------
  function renderWeekChart(){
    var out = '';
    var today = new Date();
    for (var i = 6; i >= 0; i--){
      var d = new Date(today); d.setDate(d.getDate()-i);
      var ds = getLocalDateString(d);
      var s = computeDailyScore(ds);
      var pct = s.total === 0 ? 0 : s.percent;
      var label = d.toLocaleDateString(undefined, { weekday:'narrow' });
      out += '<div class="week-bar-col">' +
        '<div class="week-bar-track"><div class="week-bar-fill" style="height:' + pct + '%"></div></div>' +
        '<div class="week-bar-label">' + label + '</div>' +
        '<div class="week-bar-pct">' + (s.total === 0 ? '\u2013' : pct + '%') + '</div>' +
      '</div>';
    }
    return out;
  }

  function renderCalGrid(){
    var now = new Date();
    var year = now.getFullYear(), month = now.getMonth();
    var firstDay = new Date(year, month, 1);
    var daysInMonth = new Date(year, month+1, 0).getDate();
    var startWeekday = firstDay.getDay();
    var out = '';
    for (var b = 0; b < startWeekday; b++) out += '<div class="cal-cell cal-cell--blank"></div>';
    var todayVal = todayStr();
    for (var day = 1; day <= daysInMonth; day++){
      var ds = getLocalDateString(new Date(year, month, day));
      var cls = 'cal-cell';
      if (ds > todayVal){
        cls += ' cal-cell--future';
      } else {
        var s = computeDailyScore(ds);
        if (s.total === 0) cls += ' cal-cell--void';
        else {
          var p = s.percent;
          cls += p === 0 ? ' cal-cell--l0' : p < 40 ? ' cal-cell--l1' : p < 70 ? ' cal-cell--l2' : p < 100 ? ' cal-cell--l3' : ' cal-cell--l4';
        }
      }
      if (ds === todayVal) cls += ' cal-cell--today';
      out += '<div class="' + cls + '">' + day + '</div>';
    }
    return out;
  }

  function renderDashboard(){
    if (habits.length === 0){
      dashEmpty.hidden = false; dashContent.hidden = true;
      return;
    }
    dashEmpty.hidden = true; dashContent.hidden = false;

    renderScoreHeroInto(document.getElementById('dashTodayScore'), todayStr(), 'today');

    var curStreak = computeOverallCurrentStreak(), bestStreak = computeOverallBestStreak();
    document.getElementById('streakRow').innerHTML =
      '<div class="stat-card"><div class="stat-value">' + curStreak + '</div><div class="stat-label">Current streak (days)</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + bestStreak + '</div><div class="stat-label">Best streak (days)</div></div>';

    var activeHabits = habits.filter(function(h){ return h.active; });
    document.getElementById('habitConsistencyList').innerHTML = activeHabits.length === 0
      ? '<p class="muted-note">No active habits right now.</p>'
      : activeHabits.map(function(h){
          var st = computeHabitStats(h);
          return '<div class="habit-stat-card">' +
            '<p class="habit-stat-name">' + (escapeHtml(h.icon) || '\u2022') + ' ' + escapeHtml(h.name) + '</p>' +
            '<div class="habit-stat-grid">' +
              '<div class="habit-stat-item"><div class="v">' + st.percent + '%</div><div class="l">Consistency (' + st.completedDays + '/' + st.totalDays + ' days)</div></div>' +
              '<div class="habit-stat-item"><div class="v">' + st.current + ' days</div><div class="l">Current streak</div></div>' +
              '<div class="habit-stat-item"><div class="v">' + st.best + ' days</div><div class="l">Best streak</div></div>' +
              '<div class="habit-stat-item"><div class="v">' + st.totalDays + '</div><div class="l">Days tracked</div></div>' +
            '</div>' +
          '</div>';
        }).join('');

    document.getElementById('weekChart').innerHTML = renderWeekChart();
    document.getElementById('calGrid').innerHTML = renderCalGrid();

    var disc = computeDisciplineScore(), cons = computeConsistencyScore(), grow = computeGrowthScore();
    function scoreCard(label, val, explain){
      return '<div class="score-card"><div class="v">' + (val===null?'\u2013':val) + '</div><div class="l">' + label + '</div>' +
        '<details><summary>How this works</summary><p>' + explain + '</p></details></div>';
    }
    document.getElementById('scoreTrio').innerHTML =
      scoreCard('Discipline', disc, '50% your last 7 days\u2019 completion + 25% current streak (capped at 30 days) + 25% all-time completion. An app-generated progress metric, not a scientific measurement.') +
      scoreCard('Consistency', cons, '60% of days you completed at least one habit + 40% your all-time completion rate. Measures how regularly you show up, not how hard the habits are.') +
      scoreCard('Growth', grow, 'Starts at 50 (neutral) and moves with how your last 7 days compare to the 7 days before that. An estimate of momentum, not a measure of real potential.');

    var trend = computeTrend();
    var trendCard = document.getElementById('trendCard');
    if (trend === null){
      trendCard.innerHTML = '<div><p class="trend-label">Not enough data yet</p><p class="trend-note">Check back after two full weeks of tracking to see your trend.</p></div>';
    } else {
      trendCard.innerHTML = '<div><p class="trend-label">' + trend.label + '</p><p class="trend-note">Last 7 days vs. the 7 before that</p></div>' +
        '<div class="trend-diff">' + (trend.diff >= 0 ? '+' : '') + trend.diff + '%</div>';
    }

    document.getElementById('achvGrid').innerHTML = computeAchievements().map(function(a){
      return '<div class="achv-badge' + (a.unlocked ? ' unlocked' : '') + '"><div class="achv-icon">' + a.icon + '</div><div class="achv-label">' + a.label + '</div></div>';
    }).join('');

    var rec = computePersonalRecords();
    document.getElementById('recordsList').innerHTML =
      '<div class="record-row"><span>Best daily score</span><span class="v">' + rec.bestDay + '%</span></div>' +
      '<div class="record-row"><span>Best streak</span><span class="v">' + rec.bestStreak + ' days</span></div>' +
      '<div class="record-row"><span>Most consistent habit</span><span class="v">' + (rec.mostConsistentName ? escapeHtml(rec.mostConsistentName) + ' (' + rec.mostConsistentPct + '%)' : '\u2013') + '</span></div>' +
      '<div class="record-row"><span>Total habits completed</span><span class="v">' + rec.totalCompleted + '</span></div>' +
      '<div class="record-row"><span>Total days tracked</span><span class="v">' + rec.daysTracked + '</span></div>';
  }

  // ---------- screens ----------
  function showScreen(name){
    currentScreen = name;
    todayScreen.hidden = name !== 'today';
    dashboardScreen.hidden = name !== 'dashboard';
    habitsScreen.hidden = name !== 'habits';
    fabAddBtn.hidden = name === 'dashboard';
    document.querySelectorAll('.nav-btn').forEach(function(btn){
      btn.classList.toggle('is-active', btn.dataset.screen === name);
    });
    if (name === 'today') renderToday();
    else if (name === 'dashboard') renderDashboard();
    else if (name === 'habits') renderManageList();
  }

  // ---------- sheet ----------
  function showSheetError(msg){ sheetError.textContent = msg; sheetError.hidden = false; }
  function clearSheetError(){ sheetError.hidden = true; sheetError.textContent = ''; }

  function openAddSheet(prefillName){
    sheetMode = 'add'; currentEditId = null;
    sheetTitle.textContent = 'Add habit';
    habitNameInput.value = prefillName || '';
    habitIconInput.value = '';
    habitDescInput.value = '';
    editOnlyRow.hidden = true;
    clearSheetError();
    sheetOverlay.hidden = false;
    setTimeout(function(){ habitNameInput.focus(); }, 50);
  }
  function openEditSheet(habitId){
    var h = habits.find(function(x){ return x.id === habitId; });
    if (!h) return;
    sheetMode = 'edit'; currentEditId = habitId;
    sheetTitle.textContent = 'Edit habit';
    habitNameInput.value = h.name;
    habitIconInput.value = h.icon || '';
    habitDescInput.value = h.description || '';
    editOnlyRow.hidden = false;
    toggleActiveBtn.textContent = h.active ? 'Disable' : 'Enable';
    clearSheetError();
    sheetOverlay.hidden = false;
  }
  function closeSheet(){ sheetOverlay.hidden = true; }

  function handleSaveHabit(){
    var name = habitNameInput.value.trim();
    if (!name){ showSheetError('Please enter a habit name.'); return; }
    var iconRaw = habitIconInput.value.trim();
    var icon = Array.from(iconRaw).slice(0,2).join('');
    var description = habitDescInput.value.trim().slice(0,120);

    if (sheetMode === 'add'){
      if (activeCount() >= MAX_ACTIVE){
        showSheetError('You already have ' + MAX_ACTIVE + ' active habits. Disable or delete one before adding another.');
        return;
      }
      habits.push({ id:makeId(), name:name, icon:icon, description:description, createdDate:todayStr(), active:true, order:habits.length });
    } else {
      var h = habits.find(function(x){ return x.id === currentEditId; });
      if (h){ h.name = name; h.icon = icon; h.description = description; }
    }
    saveHabits(habits);
    closeSheet();
    showScreen(currentScreen);
  }

  function handleToggleActive(){
    var h = habits.find(function(x){ return x.id === currentEditId; });
    if (!h) return;
    if (!h.active && activeCount() >= MAX_ACTIVE){
      showSheetError('You already have ' + MAX_ACTIVE + ' active habits. Disable another one before re-enabling this.');
      return;
    }
    h.active = !h.active;
    saveHabits(habits);
    closeSheet();
    showScreen(currentScreen);
  }

  function handleDeleteHabit(){
    var h = habits.find(function(x){ return x.id === currentEditId; });
    if (!h) return;
    var ok = confirm('Delete "' + h.name + '"? It will be removed from your habit list, though its past records stay in storage. Consider Disable instead if you might want it back.');
    if (!ok) return;
    habits = habits.filter(function(x){ return x.id !== currentEditId; });
    saveHabits(habits);
    closeSheet();
    showScreen(currentScreen);
  }

  // ---------- events ----------
  document.querySelectorAll('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){ showScreen(btn.dataset.screen); });
  });
  fabAddBtn.addEventListener('click', function(){ openAddSheet(); });
  document.getElementById('emptyAddBtn').addEventListener('click', function(){ openAddSheet(); });
  document.getElementById('cancelSheetBtn').addEventListener('click', closeSheet);
  document.getElementById('saveHabitBtn').addEventListener('click', handleSaveHabit);
  toggleActiveBtn.addEventListener('click', handleToggleActive);
  document.getElementById('deleteHabitBtn').addEventListener('click', handleDeleteHabit);
  habitNameInput.addEventListener('keydown', function(e){ if (e.key === 'Enter') handleSaveHabit(); });
  sheetOverlay.addEventListener('click', function(e){ if (e.target === sheetOverlay) closeSheet(); });

  document.querySelectorAll('.chip').forEach(function(chip){
    chip.addEventListener('click', function(){ openAddSheet(chip.dataset.suggest); });
  });

  habitListEl.addEventListener('click', function(e){
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var card = btn.closest('.habit-card');
    var id = card.dataset.id;
    var action = btn.dataset.action;
    if (action === 'edit'){ openEditSheet(id); return; }
    var newStatus = action === 'done' ? 'completed' : 'missed';
    var current = getRecordStatus(id, todayStr());
    setRecordStatus(id, todayStr(), current === newStatus ? 'unanswered' : newStatus);
    renderToday();
  });

  manageList.addEventListener('click', function(e){
    var toggleBtn = e.target.closest('[data-toggle]');
    var editBtn = e.target.closest('[data-edit]');
    if (toggleBtn){
      var id = toggleBtn.dataset.toggle;
      var h = habits.find(function(x){ return x.id === id; });
      if (!h) return;
      if (!h.active && activeCount() >= MAX_ACTIVE){
        alert('You already have ' + MAX_ACTIVE + ' active habits. Disable another one first.');
        return;
      }
      h.active = !h.active;
      saveHabits(habits);
      renderManageList();
    } else if (editBtn){
      openEditSheet(editBtn.dataset.edit);
    }
  });

  // ---------- init ----------
  showScreen('today');
})();

// ---------- offline caching (PWA) ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('service-worker.js').catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
}
