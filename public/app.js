const App = (() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let activeWorkoutId = null;
  let addFoodMealId   = null;
  let aiEstimateData  = null;
  let toastTimer      = null;

  // ── Auth ───────────────────────────────────────────────────────────────────
  const token = () => localStorage.getItem('mecros_token');

  function logout() {
    fetch('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token() } })
      .finally(() => {
        localStorage.removeItem('mecros_token');
        localStorage.removeItem('mecros_username');
        localStorage.removeItem('mecros_has_profile');
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
    return date.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
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
  function initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        const loaders = {
          dashboard: loadDashboard,
          workout:   loadWorkouts,
          exercises: loadExercises,
          records:   loadPRs,
          nutrition: loadMeals,
          goals:     loadGoals,
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
    const [d, profile] = await Promise.all([get('/api/dashboard'), get('/api/profile')]);
    document.getElementById('dash-workouts').textContent = d.totalWorkouts;
    document.getElementById('dash-prs').textContent      = d.prCount;
    document.getElementById('dash-last').textContent     = d.lastWorkout
      ? d.lastWorkout.name + ' · ' + fmtDatetime(d.lastWorkout.started_at)
      : 'No workouts yet';

    const m = d.todayMacros || {};
    const calGoal  = profile?.daily_calories || 2500;
    const protGoal = profile?.daily_protein  || 180;
    // Estimate carb/fat targets from remaining calories after protein
    const protCals = protGoal * 4;
    const remaining = Math.max(0, calGoal - protCals);
    const carbGoal = Math.round(remaining * 0.55 / 4);
    const fatGoal  = Math.round(remaining * 0.45 / 9);

    const setBar = (barId, valId, val, goal, unit) => {
      document.getElementById(barId).style.width = Math.min(100, ((val || 0) / goal) * 100) + '%';
      document.getElementById(valId).textContent = (val || 0).toFixed(0) + unit;
    };
    setBar('bar-cal',  'val-cal',  m.calories, calGoal,  ' cal');
    setBar('bar-prot', 'val-prot', m.protein,  protGoal, 'g');
    setBar('bar-carb', 'val-carb', m.carbs,    carbGoal, 'g');
    setBar('bar-fat',  'val-fat',  m.fat,      fatGoal,  'g');

    // Show targets beneath the macro bars if profile exists
    const targetsEl = document.getElementById('macro-targets');
    if (targetsEl && profile) {
      const goalLabel = { bulking: 'Bulking', lean_bulking: 'Lean Bulking', cutting: 'Cutting' }[profile.goal] || '';
      const calRange  = profile.cal_low  && profile.cal_high  ? `${profile.cal_low}–${profile.cal_high}`   : calGoal;
      const protRange = profile.prot_low && profile.prot_high ? `${profile.prot_low}–${profile.prot_high}` : protGoal;
      targetsEl.innerHTML = `<span class="macro-target-badge">${goalLabel}</span> Target: <strong>${calRange} cal</strong> · <strong>${protRange}g protein</strong>`;
      targetsEl.classList.remove('hidden');
    }

  }

  // ── Workouts ───────────────────────────────────────────────────────────────
  async function loadWorkouts() {
    const list = await get('/api/workouts');
    const el = document.getElementById('workout-list');
    el.innerHTML = '';

    if (!list.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🏋️</div>
          <p class="empty-state__text">No workouts logged yet.</p>
          <button type="button" class="btn btn--primary" onclick="App.startWorkout()">Start your first workout</button>
        </div>`;
      return;
    }

    list.forEach(w => {
      const div = document.createElement('div');
      div.className = 'workout-card';
      div.setAttribute('role', 'button');
      div.setAttribute('tabindex', '0');

      const nameEl  = document.createElement('div');
      const metaEl  = document.createElement('div');
      const infoDiv = document.createElement('div');
      nameEl.className = 'workout-card__name';
      metaEl.className = 'workout-card__meta';
      nameEl.textContent = w.name;
      metaEl.textContent = fmtDatetime(w.started_at) + (w.notes ? ' · ' + w.notes : '');
      infoDiv.appendChild(nameEl);
      infoDiv.appendChild(metaEl);

      const statusEl = document.createElement('span');
      statusEl.className = w.finished_at ? 'workout-card__status' : 'workout-card__status workout-card__status--active';
      statusEl.textContent = w.finished_at ? fmtDatetime(w.finished_at) : 'Active';

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn--danger btn--icon btn--sm';
      delBtn.setAttribute('aria-label', 'Delete workout');
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', e => { e.stopPropagation(); deleteWorkout(w.id); });

      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'workout-card__actions';
      actionsDiv.appendChild(statusEl);
      actionsDiv.appendChild(delBtn);

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
    toast('Workout started!');
  }

  async function populateExerciseSelect() {
    const exercises = await get('/api/exercises');
    const sel = document.getElementById('set-exercise');
    sel.innerHTML = '<option value="">Select exercise…</option>';
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
          <button type="button" class="btn btn--danger btn--icon btn--sm" aria-label="Delete set" onclick="App.deleteSet(${s.id})">✕</button>
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
    toast('Workout saved!');
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

    if (!exercises.length) {
      el.innerHTML = '<p class="text-muted">No exercises match the selected filters.</p>';
      return;
    }

    exercises.forEach(e => {
      const div = document.createElement('div');
      div.className = 'exercise-card';
      div.innerHTML = `
        <h3>${esc(e.name)}</h3>
        <div style="margin:.35rem 0">
          <span class="tag tag--cat">${esc(e.category)}</span>
          <span class="tag tag--muscle">${esc(e.muscle_group)}</span>
          <span class="tag tag--equip">${esc(e.equipment)}</span>
        </div>
        ${e.instructions ? `<p class="exercise-card__instructions">${esc(e.instructions)}</p>` : ''}`;
      el.appendChild(div);
    });
  }

  function showAddExercise() { document.getElementById('add-exercise-form').classList.remove('hidden'); }
  function hideAddExercise() { document.getElementById('add-exercise-form').classList.add('hidden'); }

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

    if (!bests.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🏅</div>
          <p class="empty-state__text">No PRs yet — start logging sets!</p>
        </div>`;
      return;
    }

    bests.forEach(pr => {
      const div = document.createElement('div');
      div.className = 'pr-card';
      div.innerHTML = `
        <div class="pr-card__name">${esc(pr.exercise_name)}</div>
        <div class="pr-card__weight">${esc(String(pr.best_weight))} lbs</div>
        <div class="pr-card__detail">${esc(String(pr.reps))} reps · ${fmtDate(pr.achieved_at)}</div>
        <div style="margin-top:.5rem">
          <span class="tag tag--muscle">${esc(pr.muscle_group)}</span>
        </div>`;
      el.appendChild(div);
    });
  }

  // ── Nutrition ──────────────────────────────────────────────────────────────
  async function loadMeals() {
    const dateInput = document.getElementById('meal-date');
    if (!dateInput.value) dateInput.value = localDateStr();
    const meals = await get('/api/meals?date=' + dateInput.value);

    document.getElementById('meal-analyzer').classList.toggle('hidden', meals.length === 0);

    const totals = meals.reduce((acc, m) => ({
      calories: acc.calories + (m.macros.calories || 0),
      protein:  acc.protein  + (m.macros.protein  || 0),
      carbs:    acc.carbs    + (m.macros.carbs     || 0),
      fat:      acc.fat      + (m.macros.fat       || 0),
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    document.getElementById('nutrition-summary').innerHTML = `
      <div class="stat-card"><div class="stat-label">Calories</div><div class="stat-value">${totals.calories.toFixed(0)}</div></div>
      <div class="stat-card"><div class="stat-label">Protein</div><div class="stat-value stat-value--green">${totals.protein.toFixed(1)}g</div></div>
      <div class="stat-card"><div class="stat-label">Carbs</div><div class="stat-value stat-value--yellow">${totals.carbs.toFixed(1)}g</div></div>
      <div class="stat-card"><div class="stat-label">Fat</div><div class="stat-value stat-value--red">${totals.fat.toFixed(1)}g</div></div>`;

    const el = document.getElementById('meal-list');
    el.innerHTML = '';

    if (!meals.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🥗</div>
          <p class="empty-state__text">No meals logged for this day.</p>
          <button type="button" class="btn btn--primary" onclick="App.showAddMeal()">Add a meal</button>
        </div>`;
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

      const editBtn = makeBtn('Edit name', 'btn--sm', 'meal-edit-btn-' + m.id,  () => startEditMeal(m.id));
      const saveBtn = makeBtn('Save',      'btn--sm btn--primary hidden', 'meal-save-btn-' + m.id, () => saveMealName(m.id));
      const addBtn  = makeBtn('+ Food',    'btn--sm btn--primary', null, () => openAddFoodToMeal(m.id, m.name));
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
        empty.className = 'text-muted';
        empty.style.fontSize = '.875rem';
        empty.textContent = 'No foods added yet.';
        card.appendChild(empty);
      } else {
        m.foods.forEach(f => {
          const row = document.createElement('div');
          row.className = 'food-row';

          const nameDiv = document.createElement('div');
          nameDiv.className = 'food-row__name';
          nameDiv.textContent = f.name;

          const amtSpan = document.createElement('span');
          amtSpan.className = 'food-row__amount';
          amtSpan.textContent = f.amount_g + 'g';

          const macroSpan = document.createElement('span');
          macroSpan.className = 'food-row__macros';
          const cal = (f.amount_g * f.calories_per_100g / 100).toFixed(0);
          const prot = (f.amount_g * f.protein_per_100g / 100).toFixed(1);
          macroSpan.textContent = `${cal} cal · ${prot}g P`;

          const rowActions = document.createElement('div');
          rowActions.className = 'food-row__actions';
          const foodDelBtn = makeBtn('✕', 'btn--icon btn--danger btn--sm', null, () => deleteMealFood(f.id));
          foodDelBtn.setAttribute('aria-label', 'Remove ' + f.name);
          rowActions.appendChild(foodDelBtn);

          row.appendChild(nameDiv);
          row.appendChild(amtSpan);
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
        <span>F <strong>${m.macros.fat.toFixed(1)}g</strong></span>`;
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
    hideAddMeal();
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
    document.getElementById('food-amount').value    = '';
    document.getElementById('food-results').innerHTML = '';
    discardAiEstimate();
    document.getElementById('add-food-to-meal').classList.remove('hidden');
    document.getElementById('food-search').focus();
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

      const addBtn = makeBtn('Add', 'btn--sm btn--primary', null, () => addFoodToMeal(f.id));

      div.appendChild(info);
      div.appendChild(addBtn);
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
      const amount = parseFloat(document.getElementById('food-amount').value) || 100;
      const scale  = amount / 100;
      document.getElementById('ai-estimate-name').textContent = `${name} (${amount}g) — AI estimate`;
      document.getElementById('ai-estimate-values').innerHTML = `
        <span>🔥 <strong>${(data.calories * scale).toFixed(0)}</strong> kcal</span>
        <span>Protein <strong>${(data.protein * scale).toFixed(1)}g</strong></span>
        <span>Carbs <strong>${(data.carbs * scale).toFixed(1)}g</strong></span>
        <span>Fat <strong>${(data.fat * scale).toFixed(1)}g</strong></span>`;
      document.getElementById('ai-estimate-result').classList.remove('hidden');
    } catch {
      toast('AI estimate failed', 'error');
    } finally {
      btn.textContent = '✦ AI Estimate';
      btn.disabled = false;
    }
  }

  async function saveAiEstimate() {
    if (!aiEstimateData || !addFoodMealId) return;
    const amount = parseFloat(document.getElementById('food-amount').value);
    if (!amount || amount <= 0) return toast('Enter amount in grams first', 'error');
    const food = await post('/api/foods', {
      name:               aiEstimateData.name,
      calories_per_100g:  aiEstimateData.calories,
      protein_per_100g:   aiEstimateData.protein,
      carbs_per_100g:     aiEstimateData.carbs,
      fat_per_100g:       aiEstimateData.fat,
    });
    await post(`/api/meals/${addFoodMealId}/foods`, { food_id: food.id, amount_g: amount });
    toast(aiEstimateData.name + ' added');
    discardAiEstimate();
    loadMeals();
  }

  function discardAiEstimate() {
    aiEstimateData = null;
    document.getElementById('ai-estimate-result').classList.add('hidden');
  }

  async function addFoodToMeal(foodId) {
    const amount = parseFloat(document.getElementById('food-amount').value);
    if (!amount || amount <= 0) return toast('Enter amount in grams', 'error');
    if (!addFoodMealId) return;
    await post(`/api/meals/${addFoodMealId}/foods`, { food_id: foodId, amount_g: amount });
    toast('Food added');
    document.getElementById('food-amount').value = '';
    loadMeals();
  }

  async function deleteMealFood(mfId) {
    await del(`/api/mealfoods/${mfId}`);
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
      renderMealAnalysis(data, desc);
    } catch {
      toast('Could not analyze meal — try again', 'error');
    } finally {
      btn.textContent = 'Analyze';
      btn.disabled = false;
    }
  }

  function renderMealAnalysis(data, desc) {
    const el = document.getElementById('meal-analysis-result');
    const rows = data.items.map(item => `
      <tr>
        <td>${esc(item.name)}</td>
        <td>${Math.round(item.calories)}</td>
        <td>${item.protein.toFixed(1)}g</td>
        <td>${item.carbs.toFixed(1)}g</td>
        <td>${item.fat.toFixed(1)}g</td>
      </tr>`).join('');

    el.innerHTML = `
      <table class="analysis-table">
        <thead>
          <tr><th>Item</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr>
            <td><strong>Total</strong></td>
            <td><strong>${Math.round(data.total.calories)}</strong></td>
            <td><strong>${data.total.protein.toFixed(1)}g</strong></td>
            <td><strong>${data.total.carbs.toFixed(1)}g</strong></td>
            <td><strong>${data.total.fat.toFixed(1)}g</strong></td>
          </tr>
        </tfoot>
      </table>
      <div class="analysis-actions">
        <button type="button" class="btn btn--primary btn--sm"
                onclick="App.logAnalyzedMeal(${JSON.stringify(data).replace(/"/g, '&quot;')}, ${JSON.stringify(desc).replace(/"/g, '&quot;')})">
          + Log this meal
        </button>
        <button type="button" class="btn btn--sm" onclick="document.getElementById('meal-analysis-result').classList.add('hidden')">
          Dismiss
        </button>
      </div>`;
    el.classList.remove('hidden');
  }

  async function logAnalyzedMeal(data, desc) {
    const date = document.getElementById('meal-date').value || localDateStr();
    const meal = await post('/api/meals', { name: desc.slice(0, 60), logged_at: date + 'T12:00:00' });
    for (const item of data.items) {
      const food = await post('/api/foods', {
        name: item.name,
        calories_per_100g:  item.calories,
        protein_per_100g:   item.protein,
        carbs_per_100g:     item.carbs,
        fat_per_100g:       item.fat,
      });
      await post(`/api/meals/${meal.id}/foods`, { food_id: food.id, amount_g: 100 });
    }
    toast('Meal logged!');
    document.getElementById('meal-analysis-result').classList.add('hidden');
    document.getElementById('meal-description').value = '';
    loadMeals();
  }

  // ── Goals ──────────────────────────────────────────────────────────────────
  async function loadGoals() {
    const goals = await get('/api/goals');
    const el = document.getElementById('goal-list');
    el.innerHTML = '';

    if (!goals.length) {
      el.innerHTML = `
        <div class="empty-state">
          <div class="empty-state__icon">🎯</div>
          <p class="empty-state__text">No goals set yet.</p>
          <button type="button" class="btn btn--primary" onclick="App.showAddGoal()">Add your first goal</button>
        </div>`;
      return;
    }

    goals.forEach(g => {
      const div = document.createElement('div');
      div.className = 'goal-card';

      const check = document.createElement('div');
      check.className = 'goal-card__check' + (g.achieved ? ' goal-card__check--done' : '');
      check.setAttribute('role', 'checkbox');
      check.setAttribute('aria-checked', g.achieved ? 'true' : 'false');
      check.setAttribute('tabindex', '0');
      check.textContent = g.achieved ? '✓' : '';
      check.addEventListener('click', () => toggleGoal(g.id, g.achieved));
      check.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') toggleGoal(g.id, g.achieved); });

      const info = document.createElement('div');
      info.className = 'goal-card__info';
      info.innerHTML = `
        <div class="goal-card__type">${esc(g.type.replace(/_/g, ' '))}</div>
        <div class="goal-card__target${g.achieved ? ' goal-card__target--done' : ''}">${esc(String(g.target_value))} ${esc(g.unit)}</div>
        ${g.deadline ? `<div class="goal-card__deadline">By ${fmtDate(g.deadline)}</div>` : ''}`;

      const delBtn = makeBtn('✕', 'btn--icon btn--danger btn--sm', null, () => deleteGoal(g.id));
      delBtn.setAttribute('aria-label', 'Delete goal');

      div.appendChild(check);
      div.appendChild(info);
      div.appendChild(delBtn);
      el.appendChild(div);
    });
  }

  function showAddGoal() { document.getElementById('add-goal-form').classList.remove('hidden'); }
  function hideAddGoal() { document.getElementById('add-goal-form').classList.add('hidden'); }

  async function addGoal() {
    const target = parseFloat(document.getElementById('goal-target').value);
    if (!target) return toast('Enter a target value', 'error');
    await post('/api/goals', {
      type:         document.getElementById('goal-type').value,
      target_value: target,
      unit:         document.getElementById('goal-unit').value || 'units',
      deadline:     document.getElementById('goal-deadline').value || null,
    });
    toast('Goal saved');
    hideAddGoal();
    loadGoals();
  }

  async function toggleGoal(id, current) {
    await patch(`/api/goals/${id}`, { achieved: !current });
    loadGoals();
  }

  async function deleteGoal(id) {
    if (!await confirmDialog('Remove this goal?')) return;
    await del(`/api/goals/${id}`);
    toast('Goal removed');
    loadGoals();
  }

  // ── Settings ───────────────────────────────────────────────────────────────
  async function loadSettings() {
    const profile = await get('/api/profile');
    if (!profile) return;

    document.getElementById('set-name').value = profile.display_name || '';
    document.getElementById('set-weight').value = profile.weight_lbs || '';

    // Height: convert cm back to ft + in
    if (profile.height_cm) {
      const totalIn = Math.round(profile.height_cm / 2.54);
      const ft = Math.floor(totalIn / 12);
      const inch = totalIn % 12;
      document.getElementById('set-height-ft').value = ft;
      document.getElementById('set-height-in').value = inch;
    }

    // Activity toggle
    document.querySelectorAll('#set-activity .settings-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === profile.activity_level);
    });

    // Goal toggle
    document.querySelectorAll('#set-goal .settings-toggle').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.val === profile.goal);
    });

    updateSettingsTargets();
  }

  function settingsToggle(groupId, btn) {
    document.querySelectorAll('#' + groupId + ' .settings-toggle').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    updateSettingsTargets();
  }

  function updateSettingsTargets() {
    const weight   = parseFloat(document.getElementById('set-weight').value);
    const activity = document.querySelector('#set-activity .settings-toggle.active')?.dataset.val;
    const goal     = document.querySelector('#set-goal .settings-toggle.active')?.dataset.val;
    const el       = document.getElementById('settings-targets');

    if (!weight || !activity || !goal) { el.classList.add('hidden'); return; }

    const ACTIVITY  = { sedentary: 13, light: 14.5, moderate: 15.5, active: 17 };
    const CAL_RANGE = { bulking: [300, 500], lean_bulking: [100, 250], cutting: [-600, -350] };
    const PR_RANGE  = { bulking: [0.7, 0.9], lean_bulking: [0.9, 1.1], cutting: [1.0, 1.3] };
    const tdee = weight * (ACTIVITY[activity] || 15.5);
    const [cLo, cHi] = CAL_RANGE[goal]  || [0, 200];
    const [pLo, pHi] = PR_RANGE[goal]   || [0.8, 1.0];
    const calRange  = `${Math.round(tdee + cLo)}–${Math.round(tdee + cHi)}`;
    const protRange = `${Math.round(weight * pLo)}–${Math.round(weight * pHi)}`;

    const goalLabel = { bulking: 'Bulking', lean_bulking: 'Lean Bulking', cutting: 'Cutting' }[goal] || '';
    el.innerHTML = `
      <span class="macro-target-badge">${goalLabel}</span>
      New targets: <strong>${calRange} cal/day</strong> · <strong>${protRange}g protein/day</strong>`;
    el.classList.remove('hidden');
  }

  async function saveSettings() {
    const name     = document.getElementById('set-name').value.trim();
    const ft       = parseFloat(document.getElementById('set-height-ft').value);
    const inch     = parseFloat(document.getElementById('set-height-in').value);
    const weight   = parseFloat(document.getElementById('set-weight').value);
    const activity = document.querySelector('#set-activity .settings-toggle.active')?.dataset.val;
    const goal     = document.querySelector('#set-goal .settings-toggle.active')?.dataset.val;

    if (!name || isNaN(ft) || isNaN(inch) || !weight || !activity || !goal) {
      return toast('Please fill in all fields', 'error');
    }

    await post('/api/profile/setup', {
      display_name: name,
      height_cm: ((ft * 12) + inch) * 2.54,
      weight_lbs: weight,
      activity_level: activity,
      goal,
    });

    toast('Settings saved');

    // Update the displayed name everywhere
    const usernameEl = document.getElementById('user-name');
    if (usernameEl) usernameEl.textContent = name;
    const headerName = document.querySelector('.app-nav + div span');
    if (headerName) headerName.textContent = name;

    loadDashboard();
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function axisStyle() {
    return {
      grid:  { color: 'rgba(255,255,255,.05)' },
      ticks: { color: cssVar('--text-muted') },
    };
  }

  function chartOpts(unit = '') {
    return {
      responsive: true,
      plugins: { legend: { labels: { color: cssVar('--text-muted') } } },
      scales: {
        x: axisStyle(),
        y: { ...axisStyle(), ticks: { ...axisStyle().ticks, callback: v => v + (unit ? ' ' + unit : '') } },
      },
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    // Redirect to login if no token (synchronous — no flash)
    if (!token()) { location.replace('/login.html'); return; }

    // Returning users: show immediately using cached username so there's no blank delay.
    // New/unknown sessions: stay hidden until the server confirms the token is valid.
    const cachedUsername = localStorage.getItem('mecros_username');
    if (cachedUsername) {
      document.body.style.visibility = 'visible';
    }

    // Validate token server-side. On 401, api() redirects to login and returns undefined.
    const profile = await get('/api/profile');
    if (profile === undefined) return;

    // First-time load path — token valid but no cached username yet
    if (!cachedUsername) {
      document.body.style.visibility = 'visible';
    }

    // Show display name from profile (fallback to username)
    const displayName = profile?.display_name || cachedUsername || 'User';

    // Show username and logout button in header
    const nav = document.querySelector('.app-nav');
    const userEl = document.createElement('div');
    userEl.style.cssText = 'display:flex;align-items:center;gap:.5rem;margin-left:auto';
    userEl.innerHTML = `
      <button type="button" class="btn btn--icon btn--sm" aria-label="Settings" title="Settings" onclick="document.querySelector('.nav-btn[data-tab=settings]')?.click()" style="font-size:1.1rem">⚙</button>
      <span style="font-size:.8rem;color:var(--text-muted)">${esc(displayName)}</span>
      <button type="button" class="btn btn--sm" onclick="App.logout()">Sign out</button>`;
    nav.after(userEl);

    const usernameEl = document.getElementById('user-name');
    if (usernameEl) usernameEl.textContent = displayName;

    initNav();
    document.getElementById('meal-date').value = localDateStr();
    loadDashboard();

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
    startWorkout, addSet, deleteSet, finishWorkout, deleteWorkout, closeModal,
    loadExercises, showAddExercise, hideAddExercise, addExercise,
    loadPRs,
    loadMeals, showAddMeal, hideAddMeal, addMeal, deleteMeal,
    startEditMeal, saveMealName,
    openAddFoodToMeal, hideAddFoodToMeal,
    searchFoods, addFoodToMeal, deleteMealFood,
    estimateMacros, saveAiEstimate, discardAiEstimate,
    analyzeMeal, logAnalyzedMeal,
    showAddGoal, hideAddGoal, addGoal, toggleGoal, deleteGoal,
    loadSettings, saveSettings, settingsToggle,
  };
})();
