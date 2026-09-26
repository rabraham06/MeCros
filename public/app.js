const App = (() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let activeWorkoutId = null;
  let addFoodMealId   = null;
  let aiEstimateData  = null;
  let toastTimer      = null;
  let currentMeals    = [];
  let currentProfile  = null;

  // ── Auth ───────────────────────────────────────────────────────────────────
  const token = () => sessionStorage.getItem('mecros_token');

  function logout() {
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token() } })
      .finally(() => {
        sessionStorage.removeItem('mecros_token');
        sessionStorage.removeItem('mecros_username');
        sessionStorage.removeItem('mecros_has_profile');
        window.location.href = '/login.html';
      });
  }

  // ── HTTP helpers ───────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() },
    };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (res.status === 401) { window.location.href = '/login.html'; return; }
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  const get   = p     => api('GET',    p);
  const post  = (p,b) => api('POST',   p, b);
  const patch = (p,b) => api('PATCH',  p, b);
  const del   = p     => api('DELETE', p);

  // ── Utilities ──────────────────────────────────────────────────────────────

  // Escapes user-supplied strings before inserting via innerHTML, preventing XSS.
  function esc(str) {
    const d = document.createElement('div');
    d.textContent = str ?? '';
    return d.innerHTML;
  }

  function toast(msg, type = 'ok') {
    const el = document.getElementById('toast');
    clearTimeout(toastTimer);            // clear any previous timer before re-showing
    el.textContent = msg;
    el.className = type === 'error' ? 'toast toast--error' : 'toast';
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
  }

  function localDateStr(date = new Date()) {
    return date.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDatetime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // Shows a modal backdrop by removing the 'hidden' class.
  function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
  function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

  // Promise-based confirm dialog. Replaces onclick handlers each call to avoid stacking.
  function confirmDialog(message) {
    return new Promise(resolve => {
      document.getElementById('confirmMessage').textContent = message;
      showModal('confirmModal');

      const ok  = document.getElementById('confirmOkBtn');
      const can = document.getElementById('confirmCancelBtn');

      function finish(result) {
        hideModal('confirmModal');
        ok.removeEventListener('click', onOk);
        can.removeEventListener('click', onCancel);
        resolve(result);
      }
      const onOk     = () => finish(true);
      const onCancel = () => finish(false);
      ok.addEventListener('click',  onOk,     { once: true });
      can.addEventListener('click', onCancel, { once: true });
    });
  }

  // ── Tab navigation ─────────────────────────────────────────────────────────
  function switchTab(tabName) {
    const btn = document.querySelector(`.nav-btn[data-tab="${tabName}"]`);
    if (btn) btn.click();
  }

  function initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        document.body.dataset.tab = btn.dataset.tab;
        const loaders = {
          dashboard: loadDashboard,
          workout:   loadWorkouts,
          exercises: loadExercises,
          records:   loadPRs,
          nutrition: loadMeals,
          settings:  loadSettings,
        };
        loaders[btn.dataset.tab]?.();
      });
    });

    // Global Escape key closes any open modal
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (!document.getElementById('workout-modal').classList.contains('hidden')) closeModal();
      if (!document.getElementById('confirmModal').classList.contains('hidden'))  hideModal('confirmModal');
      if (!document.getElementById('workoutModal').classList.contains('hidden'))  hideModal('workoutModal');
    });
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  async function loadDashboard() {
    const [d, profile] = await Promise.all([get('/api/dashboard'), Promise.resolve(currentProfile || get('/api/profile'))]);
    document.getElementById('dash-workouts').textContent = d.totalWorkouts;
    document.getElementById('dash-prs').textContent      = d.prCount;
    document.getElementById('dash-last').textContent     = d.lastWorkout
      ? d.lastWorkout.name + ' · ' + fmtDatetime(d.lastWorkout.started_at)
      : 'No workouts yet';

    const m = d.todayMacros || {};
    const calGoal   = profile?.daily_calories || 2500;
    const protGoal  = profile?.daily_protein  || 180;
    const fiberGoal = profile?.fiber_high || Math.round(calGoal / 1000 * 14);
    // Estimate carb/fat targets from remaining calories after protein
    const protCals = protGoal * 4;
    const remaining = Math.max(0, calGoal - protCals);
    const carbGoal = Math.round(remaining * 0.55 / 4);
    const fatGoal  = Math.round(remaining * 0.45 / 9);

    const setBar = (barId, valId, val, goal, unit) => {
      document.getElementById(barId).style.width = Math.min(100, ((val || 0) / goal) * 100) + '%';
      document.getElementById(valId).innerHTML = `${(val || 0).toFixed(0)}<span class="of"> / ${goal}${unit}</span>`;
    };
    setBar('bar-cal',   'val-cal',   m.calories, calGoal,   '');
    setBar('bar-prot',  'val-prot',  m.protein,  protGoal,  'g');
    setBar('bar-carb',  'val-carb',  m.carbs,    carbGoal,  'g');
    setBar('bar-fat',   'val-fat',   m.fat,      fatGoal,   'g');
    setBar('bar-fiber', 'val-fiber', m.fiber,    fiberGoal, 'g');

    // Show targets beneath the macro bars if profile exists
    const targetsEl = document.getElementById('macro-targets');
    if (targetsEl && profile) {
      const goalLabel  = { bulking: 'Bulking', lean_bulking: 'Lean Bulking', cutting: 'Cutting' }[profile.goal] || '';
      const calRange   = profile.cal_low  && profile.cal_high  ? `${profile.cal_low}–${profile.cal_high}`   : calGoal;
      const protRange  = profile.prot_low && profile.prot_high ? `${profile.prot_low}–${profile.prot_high}` : protGoal;
      const fiberRange = profile.fiber_low && profile.fiber_high ? `${profile.fiber_low}–${profile.fiber_high}g fiber` : `${fiberGoal}g fiber`;
      targetsEl.innerHTML = `<span class="macro-target-badge">${goalLabel.toLowerCase()}</span> aiming for <strong>${calRange} cal</strong> · <strong>${protRange}g protein</strong> · <strong>${fiberRange}</strong>`;
      targetsEl.classList.remove('hidden');
    }

  }

  // ── Workouts ───────────────────────────────────────────────────────────────
  async function loadWorkouts() {
    const list = await get('/api/workouts');
    const el = document.getElementById('workout-list');
    el.innerHTML = '';

    el.classList.toggle('log', list.length > 0);

    if (!list.length) {
      el.innerHTML = `
        <p class="note">Nothing in the log yet. Start a workout and your sessions will stack up here.</p>`;
      return;
    }

    list.forEach(w => {
      const div = document.createElement('div');
      div.className = 'log-row';
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');

      const started = new Date(w.started_at);
      const dateEl  = document.createElement('div');
      dateEl.className = 'log-row__date';
      dateEl.innerHTML = `<span>${started.getDate()}</span>${started.toLocaleDateString('en-GB', { month: 'short' })}`;

      const nameEl  = document.createElement('div');
      const metaEl  = document.createElement('div');
      const infoDiv = document.createElement('div');
      nameEl.className = 'log-row__name';
      metaEl.className = 'log-row__meta';
      nameEl.textContent = w.name;
      metaEl.textContent = 'started ' + started.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        + (w.notes ? ' · ' + w.notes : '');
      infoDiv.appendChild(nameEl);
      infoDiv.appendChild(metaEl);

      const statusEl = document.createElement('span');
      if (w.finished_at) {
        statusEl.textContent = 'done ' + fmtDatetime(w.finished_at);
      } else {
        statusEl.className = 'log-row__live';
        statusEl.textContent = 'in progress';
      }

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn--danger btn--icon btn--sm';
      delBtn.setAttribute('aria-label', 'Delete workout');
      delBtn.textContent = '×';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteWorkout(w.id); });

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'log-row__side';
      actionsDiv.appendChild(statusEl);
      actionsDiv.appendChild(delBtn);

      div.appendChild(dateEl);
      div.appendChild(infoDiv);
      div.appendChild(actionsDiv);
      div.addEventListener('click', () => viewWorkout(w));
      div.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') viewWorkout(w); });
      el.appendChild(div);
    });
  }

  async function startWorkout() {
    const input     = document.getElementById('workoutInput');
    const saveBtn   = document.getElementById('saveWorkoutBtn');
    const cancelBtn = document.getElementById('cancelWorkoutBtn');

    input.value = 'Workout ' + new Date().toLocaleDateString();
    showModal('workoutModal');
    setTimeout(() => { input.select(); }, 50);

    const name = await new Promise(resolve => {
      function onSave()   { hideModal('workoutModal'); cleanup(); resolve(input.value.trim()); }
      function onCancel() { hideModal('workoutModal'); cleanup(); resolve(null); }
      function onKey(e)   { if (e.key === 'Enter') onSave(); }
      function cleanup()  {
        saveBtn.removeEventListener('click', onSave);
        cancelBtn.removeEventListener('click', onCancel);
        input.removeEventListener('keydown', onKey);
      }
      saveBtn.addEventListener('click',   onSave,   { once: true });
      cancelBtn.addEventListener('click', onCancel, { once: true });
      input.addEventListener('keydown', onKey);
    });

    if (!name) return;
    const w = await post('/api/workouts', { name });
    activeWorkoutId = w.id;
    document.getElementById('active-name').textContent = w.name;
    document.getElementById('active-workout').classList.remove('hidden');
    await populateExerciseSelect();
    toast('Workout started');
  }

  async function populateExerciseSelect() {
    const exercises = await get('/api/exercises');
    const sel = document.getElementById('set-exercise');
    sel.innerHTML = '<option value="">Pick an exercise…</option>';
    exercises.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = `${e.name} (${e.muscle_group})`;
      sel.appendChild(opt);
    });
  }

  async function addSet() {
    if (!activeWorkoutId) return toast('No active workout', 'error');
    const exercise_id = document.getElementById('set-exercise').value;
    const weight_kg   = parseFloat(document.getElementById('set-weight').value) || null;
    const reps        = parseInt(document.getElementById('set-reps').value)     || null;
    if (!exercise_id) return toast('Select an exercise', 'error');

    // Count sets for this exercise from the already-rendered table to avoid an extra GET.
    const existing = document.querySelectorAll('#set-list [data-exercise-id="' + exercise_id + '"]');
    const set_number = existing.length + 1;

    await post(`/api/workouts/${activeWorkoutId}/sets`, { exercise_id, set_number, reps, weight_kg });
    toast('Set logged');
    loadActiveSets();
    document.getElementById('set-weight').value = '';
    document.getElementById('set-reps').value   = '';
  }

  async function loadActiveSets() {
    if (!activeWorkoutId) return;
    const sets = await get(`/api/workouts/${activeWorkoutId}/sets`);
    const el = document.getElementById('set-list');
    el.innerHTML = '';
    if (!sets.length) return;

    const table = document.createElement('table');
    table.className = 'set-table';
    table.innerHTML = '<thead><tr><th>#</th><th>Exercise</th><th>Weight</th><th>Reps</th><th></th></tr></thead>';
    const tbody = document.createElement('tbody');

    sets.forEach(s => {
      const tr = document.createElement('tr');
      tr.dataset.exerciseId = s.exercise_id;
      tr.innerHTML = `
        <td><span class="set-num">${esc(String(s.set_number))}</span></td>
        <td>${esc(s.exercise_name)}</td>
        <td>${s.weight_kg ? esc(String(s.weight_kg)) + ' lbs' : '—'}</td>
        <td>${s.reps      ? esc(String(s.reps))      + ' reps' : '—'}</td>
        <td>
          <button type="button" class="btn btn--danger btn--icon btn--sm" aria-label="Delete set" onclick="App.deleteSet(${s.id})">×</button>
        </td>`;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    el.appendChild(table);
  }

  async function deleteSet(id) {
    await del(`/api/sets/${id}`);
    loadActiveSets();
  }

  async function finishWorkout() {
    if (!activeWorkoutId) return;
    await patch(`/api/workouts/${activeWorkoutId}/finish`);
    activeWorkoutId = null;
    document.getElementById('active-workout').classList.add('hidden');
    document.getElementById('set-list').innerHTML = '';
    toast('Saved to your log');
    loadWorkouts();
  }

  async function cancelWorkout() {
    if (!activeWorkoutId) return;
    if (!await confirmDialog('Cancel this workout? All sets will be lost.')) return;
    await del(`/api/workouts/${activeWorkoutId}`);
    activeWorkoutId = null;
    document.getElementById('active-workout').classList.add('hidden');
    document.getElementById('set-list').innerHTML = '';
    toast('Workout cancelled');
    loadWorkouts();
  }

  async function deleteWorkout(id) {
    if (!await confirmDialog('This workout and all its sets will be permanently deleted.')) return;
    await del(`/api/workouts/${id}`);
    toast('Workout deleted');
    loadWorkouts();
  }

  async function viewWorkout(w) {
    const sets = await get(`/api/workouts/${w.id}/sets`);
    document.getElementById('modal-title').textContent = w.name + ' · ' + fmtDate(w.started_at);
    const el = document.getElementById('modal-sets');
    el.innerHTML = '';

    if (!sets.length) {
      el.innerHTML = '<p class="text-muted">No sets logged for this workout.</p>';
    } else {
      const table = document.createElement('table');
      table.className = 'set-table';
      table.innerHTML = '<thead><tr><th>#</th><th>Exercise</th><th>Weight</th><th>Reps</th></tr></thead>';
      const tbody = document.createElement('tbody');
      sets.forEach(s => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td><span class="set-num">${esc(String(s.set_number))}</span></td>
          <td>${esc(s.exercise_name)}</td>
          <td>${s.weight_kg ? esc(String(s.weight_kg)) + ' lbs' : '—'}</td>
          <td>${s.reps      ? esc(String(s.reps))      + ' reps' : '—'}</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      el.appendChild(table);
    }
    showModal('workout-modal');
  }

  function closeModal() { hideModal('workout-modal'); }

  // ── Exercises ──────────────────────────────────────────────────────────────
  async function loadExercises() {
    const cat    = document.getElementById('ex-filter-cat').value;
    const muscle = document.getElementById('ex-filter-muscle').value;
    let url = '/api/exercises?';
    if (cat)    url += 'category=' + encodeURIComponent(cat)    + '&';
    if (muscle) url += 'muscle='   + encodeURIComponent(muscle) + '&';
    const exercises = await get(url);
    const el = document.getElementById('exercise-list');
    el.innerHTML = '';

    el.classList.toggle('ex-index', exercises.length > 0);

    if (!exercises.length) {
      el.innerHTML = '<p class="note">Nothing matches that combination.</p>';
      return;
    }

    exercises.forEach(e => {
      const div = document.createElement('div');
      div.className = 'ex-item';
      div.innerHTML = `
        <h3>${esc(e.name)}${e.user_id ? '<span class="ex-item__mine">yours</span>' : ''}</h3>
        <p class="ex-item__meta">${esc(e.muscle_group)} · ${esc(e.equipment)} · ${esc(e.category)}</p>
        ${e.instructions ? `<p class="ex-item__how">${esc(e.instructions)}</p>` : ''}`;
      if (e.user_id) {
        const delBtn = makeBtn('×', 'btn--icon btn--danger btn--sm ex-item__del', null, () => deleteExercise(e.id));
        delBtn.setAttribute('aria-label', 'Delete exercise');
        div.appendChild(delBtn);
      }
      el.appendChild(div);
    });
  }

  function showAddExercise() {
    const form = document.getElementById('add-exercise-form');
    form.classList.remove('hidden');
    setTimeout(() => form.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    document.getElementById('ex-name').focus();
  }
  function hideAddExercise() { document.getElementById('add-exercise-form').classList.add('hidden'); }

  async function deleteExercise(id) {
    if (!await confirmDialog('Delete this exercise?')) return;
    await del(`/api/exercises/${id}`);
    toast('Exercise deleted');
    loadExercises();
  }

  async function addExercise() {
    const name = document.getElementById('ex-name').value.trim();
    if (!name) return toast('Name required', 'error');
    await post('/api/exercises', {
      name,
      category:     document.getElementById('ex-category').value,
      muscle_group: document.getElementById('ex-muscle').value,
      equipment:    document.getElementById('ex-equipment').value,
      instructions: document.getElementById('ex-instructions').value,
    });
    document.getElementById('ex-name').value = '';
    document.getElementById('ex-instructions').value = '';
    toast('Exercise added');
    hideAddExercise();
    loadExercises();
  }

  // ── Personal Records ───────────────────────────────────────────────────────
  async function loadPRs() {
    const bests = await get('/api/records/bests');
    const el = document.getElementById('pr-list');
    el.innerHTML = '';

    el.classList.toggle('pr-grid', bests.length > 0);

    if (!bests.length) {
      el.innerHTML = `<p class="note">The board’s empty. Log a few sets and your best lifts land here.</p>`;
      return;
    }

    bests.forEach(pr => {
      const div = document.createElement('div');
      div.className = 'pr-row';
      div.innerHTML = `
        <div class="pr-row__weight">${esc(String(pr.best_weight))}<small>lbs</small></div>
        <div>
          <div class="pr-row__name">${esc(pr.exercise_name)}</div>
          <div class="pr-row__detail">${esc(String(pr.reps))} reps · ${fmtDate(pr.achieved_at)} · ${esc(pr.muscle_group)}</div>
        </div>`;
      el.appendChild(div);
    });
  }

  // ── Nutrition ──────────────────────────────────────────────────────────────
async function loadMeals() {
    const dateInput = document.getElementById('meal-date');
    if (!dateInput.value) dateInput.value = localDateStr();
    const meals = await get('/api/meals?date=' + dateInput.value);
    currentMeals = meals || [];

    document.getElementById('meal-analyzer').classList.toggle('hidden', meals.length === 0);


    const totals = meals.reduce((acc, m) => ({
      calories: acc.calories + (m.macros.calories || 0),
      protein:  acc.protein  + (m.macros.protein  || 0),
      carbs:    acc.carbs    + (m.macros.carbs     || 0),
      fat:      acc.fat      + (m.macros.fat       || 0),
      fiber:    acc.fiber    + (m.macros.fiber     || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });

    document.getElementById('nutrition-summary').innerHTML = `
      <p class="day-total__kcal"><span>${totals.calories.toFixed(0)}</span>kcal</p>
      <p class="day-total__macros">
        <span><b>${totals.protein.toFixed(1)}</b> g protein</span>
        <span><b>${totals.carbs.toFixed(1)}</b> g carbs</span>
        <span><b>${totals.fat.toFixed(1)}</b> g fat</span>
        <span><b>${totals.fiber.toFixed(1)}</b> g fiber</span>
      </p>`;

    const targetsEl = document.getElementById('nutrition-targets');
    if (currentProfile?.cal_low) {
      const p = currentProfile;
      const goalLabel = { bulking: 'Bulking', lean_bulking: 'Lean Bulking', cutting: 'Cutting' }[p.goal] || '';
      const calPct   = Math.min(100, Math.round(totals.calories / p.cal_high  * 100));
      const protPct  = Math.min(100, Math.round(totals.protein  / p.prot_low  * 100));
      const fiberPct = p.fiber_high ? Math.min(100, Math.round(totals.fiber / p.fiber_high * 100)) : 0;
      targetsEl.innerHTML = `
        <div class="nt-label">Against your ${esc(goalLabel.toLowerCase())} targets</div>
        <div class="nt-rows">
          <div class="nt-row">
            <span class="nt-name">Calories</span>
            <div class="nt-bar-wrap"><div class="nt-bar" style="width:${calPct}%"></div></div>
            <span class="nt-range">${totals.calories.toFixed(0)} / ${p.cal_low}–${p.cal_high}</span>
          </div>
          <div class="nt-row">
            <span class="nt-name">Protein</span>
            <div class="nt-bar-wrap"><div class="nt-bar nt-bar--prot" style="width:${protPct}%"></div></div>
            <span class="nt-range">${totals.protein.toFixed(1)}g / ${p.prot_low}–${p.prot_high}g</span>
          </div>
          ${p.fiber_low ? `<div class="nt-row">
            <span class="nt-name">Fiber</span>
            <div class="nt-bar-wrap"><div class="nt-bar nt-bar--fiber" style="width:${fiberPct}%"></div></div>
            <span class="nt-range">${totals.fiber.toFixed(1)}g / ${p.fiber_low}–${p.fiber_high}g</span>
          </div>` : ''}
        </div>`;
      targetsEl.classList.remove('hidden');
    } else {
      targetsEl.classList.add('hidden');
    }

    const el = document.getElementById('meal-list');
    el.innerHTML = '';

    if (!meals.length) {
      el.innerHTML = `<p class="note">No meals written down for this day. Hit “New meal” to start one.</p>`;
      return;
    }

    meals.forEach(m => {
      const card = document.createElement('div');
      card.className = 'meal-card';

      // Header
      const header = document.createElement('div');
      header.className = 'meal-card__header';

      const titleRow = document.createElement('div');
      titleRow.className = 'meal-card__title-row';

      const nameSpan = document.createElement('h3');
      nameSpan.id = 'meal-name-' + m.id;
      nameSpan.textContent = m.name;

      const nameInput = document.createElement('input');
      nameInput.id = 'meal-name-input-' + m.id;
      nameInput.className = 'input hidden';
      nameInput.value = m.name;
      nameInput.setAttribute('aria-label', 'Edit meal name');
      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter')  saveMealName(m.id);
        if (e.key === 'Escape') cancelEditMeal(m.id);
      });

      titleRow.appendChild(nameSpan);
      titleRow.appendChild(nameInput);

      const actions = document.createElement('div');
      actions.className = 'meal-card__actions';

      const editBtn = makeBtn('Rename',    'btn--sm', 'meal-edit-btn-' + m.id,  () => startEditMeal(m.id));
      const saveBtn = makeBtn('Save',      'btn--sm btn--primary hidden', 'meal-save-btn-' + m.id, () => saveMealName(m.id));
      const addBtn  = makeBtn('Add food',  'btn--sm btn--primary', null, () => openAddFoodToMeal(m.id, m.name));
      const delBtn  = makeBtn('Delete',    'btn--sm btn--danger', null, () => deleteMeal(m.id));

      actions.appendChild(editBtn);
      actions.appendChild(saveBtn);
      actions.appendChild(addBtn);
      actions.appendChild(delBtn);
      header.appendChild(titleRow);
      header.appendChild(actions);
      card.appendChild(header);

      // Food rows
      if (m.foods.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'meal-card__empty';
        empty.textContent = 'empty plate so far';
        card.appendChild(empty);
      } else {
        m.foods.forEach(f => {
          const row = document.createElement('div');
          row.className = 'food-row';

          const nameDiv = document.createElement('div');
          nameDiv.className = 'food-row__name';
          nameDiv.textContent = f.name;

          const macroSpan = document.createElement('span');
          macroSpan.className = 'food-row__macros';
          const cal   = (f.amount_g * f.calories_per_100g / 100).toFixed(0);
          const prot  = (f.amount_g * f.protein_per_100g  / 100).toFixed(1);
          const fiber = (f.amount_g * (f.fiber_per_100g || 0) / 100).toFixed(1);
          macroSpan.textContent = `${cal} cal · ${prot}g P · ${fiber}g Fi`;

          const rowActions = document.createElement('div');
          rowActions.className = 'food-row__actions';

          const minusBtn = makeBtn('−', 'btn--icon btn--sm', null, () => decrementMealFood(m.id, f.food_id));
          const qtyLabel = document.createElement('span');
          qtyLabel.className = 'food-row__qty';
          qtyLabel.textContent = f.qty + '×';
          const plusBtn  = makeBtn('+', 'btn--icon btn--sm', null, () => incrementMealFood(m.id, f.food_id, f.serving_g));
          const delBtn   = makeBtn('×', 'btn--icon btn--danger btn--sm', null, () => deleteMealFood(m.id, f.food_id));
          delBtn.setAttribute('aria-label', 'Remove ' + f.name);

          rowActions.appendChild(minusBtn);
          rowActions.appendChild(qtyLabel);
          rowActions.appendChild(plusBtn);
          rowActions.appendChild(delBtn);

          row.appendChild(nameDiv);
          row.appendChild(macroSpan);
          row.appendChild(rowActions);
          card.appendChild(row);
        });
      }

      // Meal totals
      const totalsDiv = document.createElement('div');
      totalsDiv.className = 'meal-totals';
      totalsDiv.innerHTML = `
        <span><strong>${m.macros.calories.toFixed(0)}</strong> cal</span>
        <span>P <strong>${m.macros.protein.toFixed(1)}g</strong></span>
        <span>C <strong>${m.macros.carbs.toFixed(1)}g</strong></span>
        <span>F <strong>${m.macros.fat.toFixed(1)}g</strong></span>
        <span>Fi <strong>${(m.macros.fiber || 0).toFixed(1)}g</strong></span>`;
      card.appendChild(totalsDiv);

      el.appendChild(card);
    });
  }

  // Helper: creates a <button> element cleanly.
  function makeBtn(label, classes, id, handler) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ' + classes;
    btn.textContent = label;
    if (id) btn.id = id;
    if (handler) btn.addEventListener('click', handler);
    return btn;
  }

  function startEditMeal(id) {
    document.getElementById('meal-name-'       + id).classList.add('hidden');
    document.getElementById('meal-name-input-' + id).classList.remove('hidden');
    document.getElementById('meal-edit-btn-'   + id).classList.add('hidden');
    document.getElementById('meal-save-btn-'   + id).classList.remove('hidden');
    document.getElementById('meal-name-input-' + id).focus();
  }

  function cancelEditMeal(id) {
    document.getElementById('meal-name-'       + id).classList.remove('hidden');
    document.getElementById('meal-name-input-' + id).classList.add('hidden');
    document.getElementById('meal-edit-btn-'   + id).classList.remove('hidden');
    document.getElementById('meal-save-btn-'   + id).classList.add('hidden');
  }

  async function saveMealName(id) {
    const name = document.getElementById('meal-name-input-' + id).value.trim();
    if (!name) return toast('Name cannot be empty', 'error');
    await patch(`/api/meals/${id}`, { name });
    toast('Meal renamed');
    loadMeals();
  }

  function showAddMeal() {
    document.getElementById('add-meal-form').classList.remove('hidden');
    document.getElementById('meal-name').focus();
  }
  function hideAddMeal() { document.getElementById('add-meal-form').classList.add('hidden'); }

  async function addMeal() {
    const name = document.getElementById('meal-name').value.trim();
    if (!name) return toast('Name required', 'error');
    const dateInput = document.getElementById('meal-date');
    if (!dateInput.value) dateInput.value = localDateStr();
    await post('/api/meals', { name, logged_at: dateInput.value + 'T12:00:00' });
    document.getElementById('meal-name').value = '';
    document.getElementById('meal-name-count').textContent = '0/50';
    document.getElementById('meal-name-count').classList.remove('full');
    document.getElementById('meal-name').focus();
    toast('Meal created');
    loadMeals();
  }

  async function deleteMeal(id) {
    if (!await confirmDialog('This meal and all its foods will be permanently deleted.')) return;
    await del(`/api/meals/${id}`);
    toast('Meal deleted');
    loadMeals();
  }

  function openAddFoodToMeal(mealId, mealName) {
    addFoodMealId = mealId;
    document.getElementById('meal-target-name').textContent = mealName;
    document.getElementById('food-search').value    = '';
    document.getElementById('food-results').innerHTML = '';
    discardAiEstimate();
    const panel = document.getElementById('add-food-to-meal');
    panel.classList.remove('hidden');
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('food-search').focus({ preventScroll: true });
  }

  function hideAddFoodToMeal() {
    document.getElementById('add-food-to-meal').classList.add('hidden');
    addFoodMealId = null;
    discardAiEstimate();
    loadMeals();
  }

  async function searchFoods() {
    const q = document.getElementById('food-search').value;
    const foods = await get('/api/foods?q=' + encodeURIComponent(q));
    const el = document.getElementById('food-results');
    el.innerHTML = '';
    foods.forEach(f => {
      const div = document.createElement('div');
      div.className = 'food-result-item';

      const info = document.createElement('div');
      const nameEl   = document.createElement('div');
      const macroEl  = document.createElement('div');
      nameEl.className  = 'food-result-item__name';
      macroEl.className = 'food-result-item__macros';
      nameEl.textContent  = f.name + (f.brand ? ' (' + f.brand + ')' : '');
      macroEl.textContent = `${f.calories_per_100g} kcal · P:${f.protein_per_100g}g C:${f.carbs_per_100g}g F:${f.fat_per_100g}g per 100g`;
      info.appendChild(nameEl);
      info.appendChild(macroEl);

      const controls = document.createElement('div');
      controls.className = 'food-result-item__controls';

      const qtyInput = document.createElement('input');
      qtyInput.type        = 'number';
      qtyInput.className   = 'input food-result-item__qty';
      qtyInput.value       = '1';
      qtyInput.min         = '1';
      qtyInput.placeholder = 'qty';
      qtyInput.setAttribute('aria-label', 'Quantity');

      const amtInput = document.createElement('input');
      amtInput.type        = 'number';
      amtInput.className   = 'input food-result-item__amount';
      amtInput.value       = '100';
      amtInput.min         = '1';
      amtInput.placeholder = 'g';
      amtInput.setAttribute('aria-label', 'Amount in grams');

      const addBtn = makeBtn('Add', 'btn--sm btn--primary', null, () => {
        const qty = Math.max(1, parseInt(qtyInput.value) || 1);
        const grams = parseFloat(amtInput.value);
        addFoodToMeal(f.id, grams * qty, qty);
      });

      controls.appendChild(qtyInput);
      controls.appendChild(amtInput);
      controls.appendChild(addBtn);
      div.appendChild(info);
      div.appendChild(controls);
      el.appendChild(div);
    });
  }

  async function estimateMacros() {
    const name = document.getElementById('food-search').value.trim();
    if (!name) return toast('Type a food name first', 'error');
    const btn = document.getElementById('estimate-btn');
    btn.textContent = 'Estimating…';
    btn.disabled = true;
    try {
      const data = await post('/api/foods/estimate', { name });
      aiEstimateData = { name, ...data };
      const amount = 100;
      const scale  = 1;
      document.getElementById('ai-estimate-name').textContent = `${name}, per 100 g (estimated)`;
      document.getElementById('ai-estimate-values').innerHTML = `
        <span><strong>${(data.calories * scale).toFixed(0)}</strong> kcal</span>
        <span>Protein <strong>${(data.protein * scale).toFixed(1)}g</strong></span>
        <span>Carbs <strong>${(data.carbs * scale).toFixed(1)}g</strong></span>
        <span>Fat <strong>${(data.fat * scale).toFixed(1)}g</strong></span>`;
      document.getElementById('ai-estimate-result').classList.remove('hidden');
    } catch {
      toast('Couldn’t estimate that one', 'error');
    } finally {
      btn.textContent = 'Not listed? Estimate it';
      btn.disabled = false;
    }
  }

  async function saveAiEstimate() {
    if (!aiEstimateData || !addFoodMealId) return;
    const food = await post('/api/foods', {
      name:               aiEstimateData.name,
      calories_per_100g:  aiEstimateData.calories,
      protein_per_100g:   aiEstimateData.protein,
      carbs_per_100g:     aiEstimateData.carbs,
      fat_per_100g:       aiEstimateData.fat,
      fiber_per_100g:     aiEstimateData.fiber || 0,
    });
    await post(`/api/meals/${addFoodMealId}/foods`, { food_id: food.id, amount_g: 100 });
    toast(aiEstimateData.name + ' added');
    discardAiEstimate();
    loadMeals();
  }

  function discardAiEstimate() {
    aiEstimateData = null;
    document.getElementById('ai-estimate-result').classList.add('hidden');
  }

  async function addFoodToMeal(foodId, amount, qty = 1) {
    if (!amount || amount <= 0) return toast('Enter a valid amount', 'error');
    if (!addFoodMealId) return;
    await post(`/api/meals/${addFoodMealId}/foods`, { food_id: foodId, amount_g: amount, qty });
    toast(qty > 1 ? `${qty}× food added` : 'Food added');
    loadMeals();
  }

  async function incrementMealFood(mealId, foodId, servingG) {
    await post(`/api/meals/${mealId}/foods`, { food_id: foodId, amount_g: servingG, qty: 1 });
    loadMeals();
  }

  async function decrementMealFood(mealId, foodId) {
    await post(`/api/meals/${mealId}/foods/${foodId}/decrement`);
    loadMeals();
  }

  async function deleteMealFood(mealId, foodId) {
    await del(`/api/meals/${mealId}/foods/${foodId}`);
    loadMeals();
  }

  // ── AI Meal Analyzer ───────────────────────────────────────────────────────
  async function analyzeMeal() {
    const input = document.getElementById('meal-description');
    const desc = input.value.trim();
    if (!desc) return toast('Describe a meal first', 'error');
    const btn = document.getElementById('analyze-btn');
    btn.textContent = 'Analyzing…';
    btn.disabled = true;
    const resultEl = document.getElementById('meal-analysis-result');
    resultEl.classList.add('hidden');
    try {
      const data = await post('/api/nutrition/analyze', { description: desc });
      lastAnalysisData = data;
      renderMealAnalysis(data, desc);
    } catch {
      toast('Couldn’t read that meal, try rewording it', 'error');
    } finally {
      btn.textContent = 'Estimate';
      btn.disabled = false;
    }
  }

  function renderMealAnalysis(data, desc) {
    const el = document.getElementById('meal-analysis-result');
    const rows = data.items.map(item => {
      const qty = Math.max(1, Math.round(item.qty) || 1);
      return `
      <tr>
        <td>${esc(item.name)}${qty > 1 ? ` <span class="text-muted">${qty}×</span>` : ''}</td>
        <td>${Math.round(item.calories * qty)}</td>
        <td>${(item.protein * qty).toFixed(1)}g</td>
        <td>${(item.carbs * qty).toFixed(1)}g</td>
        <td>${(item.fat * qty).toFixed(1)}g</td>
        <td>${((item.fiber || 0) * qty).toFixed(1)}g</td>
      </tr>`;
    }).join('');

    el.innerHTML = `
      <table class="analysis-table">
        <thead>
          <tr><th>Item</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th><th>Fiber</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            <td><strong>${Math.round(data.total.calories)}</strong></td>
            <td><strong>${data.total.protein.toFixed(1)}g</strong></td>
            <td><strong>${data.total.carbs.toFixed(1)}g</strong></td>
            <td><strong>${data.total.fat.toFixed(1)}g</strong></td>
            <td><strong>${(data.total.fiber || 0).toFixed(1)}g</strong></td>
          </tr>
        </tfoot>
      </table>
      <div class="analysis-actions">
        <select id="analysis-meal-select" class="input" style="flex:1;min-width:0">
          ${currentMeals.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}
        </select>
        <button type="button" class="btn btn--primary btn--sm" onclick="App.logAnalyzedMeal()">
          Add to meal
        </button>
        <button type="button" class="btn btn--sm" onclick="document.getElementById('meal-analysis-result').classList.add('hidden')">
          Dismiss
        </button>
      </div>`;
    el.classList.remove('hidden');
  }

  let lastAnalysisData = null;

  async function logAnalyzedMeal() {
    const mealId = document.getElementById('analysis-meal-select')?.value;
    if (!mealId) return toast('Select a meal to add to', 'error');
    if (!lastAnalysisData) return;
    for (const item of lastAnalysisData.items) {
      const qty = Math.max(1, Math.round(item.qty) || 1);
      const food = await post('/api/foods', {
        name: item.name,
        calories_per_100g: item.calories,
        protein_per_100g:  item.protein,
        carbs_per_100g:    item.carbs,
        fat_per_100g:      item.fat,
        fiber_per_100g:    item.fiber || 0,
      });
      await post(`/api/meals/${mealId}/foods`, { food_id: food.id, amount_g: 100 * qty, qty });
    }
    toast('Added to meal');
    document.getElementById('meal-analysis-result').classList.add('hidden');
    document.getElementById('meal-description').value = '';
    lastAnalysisData = null;
    loadMeals();
  }


  // ── Settings ───────────────────────────────────────────────────────────────
  async function loadSettings() {
    const profile = await get('/api/profile');
    if (!profile) return;

    document.getElementById('set-name').value = profile.display_name || '';
    document.getElementById('set-profile-weight').value = profile.weight_lbs || '';

    // Height: convert cm back to ft + in
    if (profile.height_cm) {
      const totalIn = Math.round(profile.height_cm / 2.54);
      const ft = Math.floor(totalIn / 12);
      const inch = totalIn % 12;
      document.getElementById('set-height-ft').value = ft;
      document.getElementById('set-height-in').value = inch;
    }

    // Gender toggle
    document.querySelectorAll('#set-gender .settings-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === (profile.gender || 'male'));
    });

    // Activity toggle
    document.querySelectorAll('#set-activity .settings-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === profile.activity_level);
    });

    // Goal toggle
    document.querySelectorAll('#set-goal .settings-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === profile.goal);
    });

    updateSettingsTargets();

    // Reflect saved theme in the toggle
    const savedTheme = localStorage.getItem('mecros_theme') || '';
    document.querySelectorAll('#set-theme .settings-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === savedTheme);
    });
  }

  function setTheme(theme) {
    const valid = ['light', 'dark', 'purple'];
    if (!valid.includes(theme)) return;
    localStorage.setItem('mecros_theme', theme);
    document.documentElement.setAttribute('data-theme', theme);
    document.querySelectorAll('#set-theme .settings-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === theme);
    });
    closeThemeMenu();
  }

  function toggleThemeMenu() {
    let menu = document.getElementById('theme-menu');
    if (menu) { closeThemeMenu(); return; }
    menu = document.createElement('div');
    menu.id = 'theme-menu';
    menu.className = 'theme-menu';
    menu.innerHTML = `
      <button onclick="App.setTheme('light')">☀️ Light</button>
      <button onclick="App.setTheme('dark')">🌙 Dark</button>
      <button onclick="App.setTheme('purple')">✦ Purple</button>`;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeThemeMenuOutside), 0);
  }

  function closeThemeMenu() {
    document.getElementById('theme-menu')?.remove();
    document.removeEventListener('click', closeThemeMenuOutside);
  }

  function closeThemeMenuOutside(e) {
    if (!e.target.closest('#theme-menu') && !e.target.closest('[aria-label="Change appearance"]')) closeThemeMenu();
  }

  function settingsToggle(groupId, btn) {
    document.querySelectorAll('#' + groupId + ' .settings-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSettingsTargets();
  }

  function updateSettingsTargets() {
    const weight   = parseFloat(document.getElementById('set-profile-weight').value);
    const ft       = parseFloat(document.getElementById('set-height-ft').value) || 0;
    const inch     = parseFloat(document.getElementById('set-height-in').value) || 0;
    const height_cm = ((ft * 12) + inch) * 2.54;
    const activity = document.querySelector('#set-activity .settings-toggle.active')?.dataset.val;
    const goal     = document.querySelector('#set-goal .settings-toggle.active')?.dataset.val;
    const gender   = document.querySelector('#set-gender .settings-toggle.active')?.dataset.val || 'male';
    const el       = document.getElementById('settings-targets');

    if (!weight || !height_cm || !activity || !goal) { el.classList.add('hidden'); return; }

    const ACTIVITY_MULTIPLIERS = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
    const weight_kg = weight / 2.2046;
    const bmr = gender === 'female'
      ? (10 * weight_kg) + (6.25 * height_cm) - 286
      : (10 * weight_kg) + (6.25 * height_cm) - 120;
    const tdee = bmr * (ACTIVITY_MULTIPLIERS[activity] || 1.55);
    const CAL_RANGE = { bulking: [300, 500], lean_bulking: [100, 250], cutting: [-600, -350] };
    const PR_RANGE  = { bulking: [0.7, 0.9], lean_bulking: [0.9, 1.1], cutting: [1.0, 1.3] };
    const [cLo, cHi] = CAL_RANGE[goal]  || [0, 200];
    const [pLo, pHi] = PR_RANGE[goal]   || [0.8, 1.0];
    const calRange  = `${Math.round(tdee + cLo)}–${Math.round(tdee + cHi)}`;
    const protRange = `${Math.round(weight * pLo)}–${Math.round(weight * pHi)}`;

    const goalLabel = { bulking: 'Bulking', lean_bulking: 'Lean Bulking', cutting: 'Cutting' }[goal] || '';
    el.innerHTML = `
      <span class="macro-target-badge">${goalLabel.toLowerCase()}</span>
      works out to <strong>${calRange} cal/day</strong> · <strong>${protRange}g protein/day</strong>`;
    el.classList.remove('hidden');
  }

  async function saveSettings() {
    const name     = document.getElementById('set-name').value.trim();
    const ft       = parseFloat(document.getElementById('set-height-ft').value);
    const inch     = parseFloat(document.getElementById('set-height-in').value);
    const weight   = parseFloat(document.getElementById('set-profile-weight').value);
    const activity = document.querySelector('#set-activity .settings-toggle.active')?.dataset.val;
    const goal     = document.querySelector('#set-goal .settings-toggle.active')?.dataset.val;
    const gender   = document.querySelector('#set-gender .settings-toggle.active')?.dataset.val;

    if (!name || isNaN(ft) || isNaN(inch) || !weight || !activity || !goal || !gender) {
      return toast('Please fill in all fields', 'error');
    }

    const height_cm = ((ft * 12) + inch) * 2.54;

    try {
      await post('/api/profile/setup', {
        display_name: name,
        height_cm,
        weight_lbs: weight,
        activity_level: activity,
        goal,
        gender,
      });
    } catch (err) {
      return toast(err.message || 'Failed to save settings', 'error');
    }

    toast('Settings saved');

    // Compute updated ranges locally so UI reflects changes immediately
    const MULT = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 };
    const CAL  = { bulking: [300, 500], lean_bulking: [100, 250], cutting: [-600, -350] };
    const PR   = { bulking: [0.7, 0.9], lean_bulking: [0.9, 1.1], cutting: [1.0, 1.3] };
    const wKg  = weight / 2.2046;
    const bmr  = gender === 'female'
      ? (10 * wKg) + (6.25 * height_cm) - 286
      : (10 * wKg) + (6.25 * height_cm) - 120;
    const tdee = bmr * (MULT[activity] || 1.55);
    const [cLo, cHi] = CAL[goal]  || [0, 200];
    const [pLo, pHi] = PR[goal]   || [0.8, 1.0];
    const targetCal  = tdee + (cLo + cHi) / 2;

    currentProfile = {
      ...currentProfile,
      display_name: name,
      weight_lbs: weight,
      height_cm,
      activity_level: activity,
      goal,
      gender,
      cal_low:    Math.round(tdee + cLo),
      cal_high:   Math.round(tdee + cHi),
      prot_low:   Math.round(weight * pLo),
      prot_high:  Math.round(weight * pHi),
      fiber_low:  Math.round(targetCal / 1000 * 12),
      fiber_high: Math.round(targetCal / 1000 * 16),
    };

    // Update the displayed name everywhere
    const usernameEl = document.getElementById('user-name');
    if (usernameEl) usernameEl.textContent = name;
    const headerName = document.getElementById('whoami-name');
    if (headerName) headerName.textContent = name;

    loadDashboard();
    loadMeals();
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function axisStyle() {
    return {
      grid:  { color: 'rgba(255,255,255,.05)' },
      ticks: { color: cssVar('--ink-2') },
    };
  }

  function chartOpts(unit = '') {
    return {
      responsive: true,
      plugins: { legend: { labels: { color: cssVar('--ink-2') } } },
      scales: {
        x: axisStyle(),
        y: { ...axisStyle(), ticks: { ...axisStyle().ticks, callback: v => v + (unit ? ' ' + unit : '') } },
      },
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function dismissLoader() {
    const el = document.getElementById('loading-screen');
    if (el) el.classList.add('hidden');
  }

  async function init() {
    // Redirect to login if no token (synchronous — no flash)
    if (!token()) { location.replace('/login.html'); return; }

    const cachedUsername = sessionStorage.getItem('mecros_username');

    // Validate token server-side. On 401, api() redirects to login and returns undefined.
    const profile = await get('/api/profile');
    if (profile === undefined) return;
    currentProfile = profile;

    // Show display name from profile (fallback to username)
    const displayName = profile?.display_name || cachedUsername || 'User';

    // Name, settings and sign-out in the masthead.
    // Gear = dashed thick ring (the teeth) around a solid ring; exit = door frame + arrow.
    const gearIcon = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="9" stroke-width="3.2" stroke-dasharray="3.2 3.8686"/>
      <circle cx="12" cy="12" r="5.2" stroke-width="4.4"/></svg>`;
    const exitIcon = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M14 8l4 4-4 4"/><path d="M18 12H9"/></svg>`;
    const paletteIcon = `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/>
      <path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/></svg>`;
    document.getElementById('whoami').innerHTML = `
      <span class="who-name" id="whoami-name">${esc(displayName)}</span>
      <button type="button" class="btn btn--sm btn--icon who-btn" onclick="App.toggleThemeMenu()" aria-label="Change appearance">${paletteIcon}</button>
      <button type="button" class="btn btn--sm who-btn who-settings" onclick="App.switchTab('settings')">${gearIcon}Settings</button>
      <button type="button" class="btn btn--sm who-btn" onclick="App.logout()">${exitIcon}Sign out</button>`;


    const usernameEl = document.getElementById('user-name');
    if (usernameEl) usernameEl.textContent = displayName;

    // Journal-style date line and a greeting that knows what time it is
    const tz = 'America/New_York';
    document.getElementById('today-line').textContent =
      new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
    const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }));
    document.getElementById('greet-word').textContent =
      hour < 5 ? 'Still up' : hour < 12 ? 'Morning' : hour < 17 ? 'Afternoon' : 'Evening';

    initNav();
    document.getElementById('meal-date').value = localDateStr();
    await loadDashboard();
    dismissLoader();

    // Close workout detail modal on backdrop click
    document.getElementById('workout-modal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });
    // Close confirm modal on backdrop click
    document.getElementById('confirmModal').addEventListener('click', function(e) {
      if (e.target === this) hideModal('confirmModal');
    });
    // Close workout name modal on backdrop click
    document.getElementById('workoutModal').addEventListener('click', function(e) {
      if (e.target === this) hideModal('workoutModal');
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    logout,
    startWorkout, addSet, deleteSet, finishWorkout, cancelWorkout, deleteWorkout, closeModal,
    loadExercises, showAddExercise, hideAddExercise, addExercise, deleteExercise,
    loadPRs,
    loadMeals, showAddMeal, hideAddMeal, addMeal, deleteMeal,
    startEditMeal, saveMealName,
    openAddFoodToMeal, hideAddFoodToMeal,
    searchFoods, addFoodToMeal, incrementMealFood, decrementMealFood, deleteMealFood,
    estimateMacros, saveAiEstimate, discardAiEstimate,
    analyzeMeal, logAnalyzedMeal,
    loadSettings, saveSettings, settingsToggle, updateSettingsTargets,
    switchTab, setTheme, toggleThemeMenu,
  };
})();
