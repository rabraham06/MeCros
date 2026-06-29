const App = (() => {
  // ── State ──────────────────────────────────────────────────────────────────
  let activeWorkoutId = null;
  let addFoodMealId = null;
  let selectedFoodId = null;
  let bwChart = null;
  let strengthChart = null;
  let macroChart = null;

  // ── Utilities ──────────────────────────────────────────────────────────────
  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }
  const get = p => api('GET', p);
  const post = (p, b) => api('POST', p, b);
  const patch = (p, b) => api('PATCH', p, b);
  const del = p => api('DELETE', p);

  function toast(msg, type = 'ok') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast' + (type === 'error' ? ' error' : '');
    setTimeout(() => t.classList.add('hidden'), 2500);
  }

  function localDateStr(date = new Date()) {
    return date.toLocaleDateString('en-CA'); // returns YYYY-MM-DD in local time
  }

  function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function fmtDatetime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  // ── Tab navigation ─────────────────────────────────────────────────────────
  function initNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
        if (btn.dataset.tab === 'dashboard') loadDashboard();
        if (btn.dataset.tab === 'workout') loadWorkouts();
        if (btn.dataset.tab === 'exercises') loadExercises();
        if (btn.dataset.tab === 'records') loadPRs();
        if (btn.dataset.tab === 'nutrition') loadMeals();
        if (btn.dataset.tab === 'progress') loadProgress();
        if (btn.dataset.tab === 'goals') loadGoals();
      });
    });
  }

  // ── Dashboard ──────────────────────────────────────────────────────────────
  async function loadDashboard() {
    const d = await get('/api/dashboard');
    document.getElementById('dash-workouts').textContent = d.totalWorkouts;
    document.getElementById('dash-prs').textContent = d.prCount;
    document.getElementById('dash-weight').textContent = d.latestWeight ? d.latestWeight.weight_kg + ' lbs' : '—';
    document.getElementById('dash-last').textContent = d.lastWorkout
      ? d.lastWorkout.name + '\n' + fmtDatetime(d.lastWorkout.started_at)
      : 'No workouts yet';

    const m = d.todayMacros || {};
    const calGoal = 2500, protGoal = 180, carbGoal = 280, fatGoal = 80;
    const setBar = (id, val, goal, valId, unit) => {
      document.getElementById(id).style.width = Math.min(100, (val / goal) * 100) + '%';
      document.getElementById(valId).textContent = (val || 0).toFixed(0) + unit;
    };
    setBar('bar-cal', m.calories, calGoal, 'val-cal', ' cal');
    setBar('bar-prot', m.protein, protGoal, 'val-prot', 'g');
    setBar('bar-carb', m.carbs, carbGoal, 'val-carb', 'g');
    setBar('bar-fat', m.fat, fatGoal, 'val-fat', 'g');

    loadBWChart();
  }

  async function loadBWChart() {
    const data = await get('/api/bodyweight');
    const canvas = document.getElementById('bw-chart');
    if (bwChart) bwChart.destroy();
    if (!data.length) return;
    bwChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: data.map(d => new Date(d.logged_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{ label: 'Weight (lbs)', data: data.map(d => d.weight_kg),
          borderColor: '#6c63ff', backgroundColor: 'rgba(108,99,255,.15)',
          tension: 0.3, fill: true, pointRadius: 4 }]
      },
      options: chartOpts('lbs')
    });
  }

  function logWeight() {
    const val = parseFloat(document.getElementById('bw-input').value);
    if (!val) return toast('Enter a weight', 'error');
    post('/api/bodyweight', { weight_kg: val })
      .then(() => { toast('Weight logged '); loadDashboard(); })
      .catch(() => toast('Error', 'error'));
  }

  // ── Workouts ───────────────────────────────────────────────────────────────
  async function loadWorkouts() {
    const list = await get('/api/workouts');
    const el = document.getElementById('workout-list');
    el.innerHTML = '';
    if (!list.length) { el.innerHTML = '<p style="color:var(--text-muted)">No workouts yet. Start one!</p>'; return; }
    list.forEach(w => {
      const div = document.createElement('div');
      div.className = 'workout-card';
      const finished = w.finished_at ? fmtDatetime(w.finished_at) : '<span style="color:var(--green)">Active</span>';
      div.innerHTML = `
        <div>
          <div style="font-weight:600">${w.name}</div>
          <div class="workout-meta">${fmtDatetime(w.started_at)} · ${w.notes || ''}</div>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center">
          <span style="font-size:.8rem;color:var(--text-muted)">${finished}</span>
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();App.deleteWorkout(${w.id})">✕</button>
        </div>`;
      div.addEventListener('click', () => viewWorkout(w));
      el.appendChild(div);
    });
  }

  async function startWorkout() {
    const name = prompt('Workout name (e.g. Push Day, Leg Day):', 'Workout ' + new Date().toLocaleDateString());
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
    sel.innerHTML = '<option value="">Select exercise...</option>';
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
    const weight_kg = parseFloat(document.getElementById('set-weight').value) || null;
    const reps = parseInt(document.getElementById('set-reps').value) || null;
    if (!exercise_id) return toast('Select an exercise', 'error');

    const existingSets = await get(`/api/workouts/${activeWorkoutId}/sets`);
    const sameExSets = existingSets.filter(s => s.exercise_id == exercise_id);
    const set_number = sameExSets.length + 1;

    await post(`/api/workouts/${activeWorkoutId}/sets`, { exercise_id, set_number, reps, weight_kg });
    toast('Set logged ✓');
    loadActiveSets();
    document.getElementById('set-weight').value = '';
    document.getElementById('set-reps').value = '';
  }

  async function loadActiveSets() {
    if (!activeWorkoutId) return;
    const sets = await get(`/api/workouts/${activeWorkoutId}/sets`);
    const el = document.getElementById('set-list');
    el.innerHTML = '';
    sets.forEach(s => {
      const div = document.createElement('div');
      div.className = 'set-row';
      div.innerHTML = `
        <div class="set-num">${s.set_number}</div>
        <div class="set-exercise-label">${s.exercise_name}</div>
        <div>${s.weight_kg ? s.weight_kg + ' lbs' : '—'}</div>
        <div>${s.reps ? s.reps + ' reps' : '—'}</div>
        <button class="btn btn-sm btn-danger" onclick="App.deleteSet(${s.id})">✕</button>`;
      el.appendChild(div);
    });
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
    if (!confirm('Delete this workout?')) return;
    await del(`/api/workouts/${id}`);
    loadWorkouts();
    toast('Deleted');
  }

  async function viewWorkout(w) {
    const sets = await get(`/api/workouts/${w.id}/sets`);
    document.getElementById('modal-title').textContent = w.name + ' · ' + fmtDate(w.started_at);
    const el = document.getElementById('modal-sets');
    el.innerHTML = '';
    if (!sets.length) { el.innerHTML = '<p style="color:var(--text-muted)">No sets logged.</p>'; }
    sets.forEach(s => {
      const div = document.createElement('div');
      div.className = 'set-row';
      div.innerHTML = `
        <div class="set-num">${s.set_number}</div>
        <div class="set-exercise-label">${s.exercise_name}</div>
        <div>${s.weight_kg ? s.weight_kg + ' lbs' : '—'}</div>
        <div>${s.reps ? s.reps + ' reps' : '—'}</div>`;
      el.appendChild(div);
    });
    document.getElementById('workout-modal').classList.remove('hidden');
  }

  function closeModal() { document.getElementById('workout-modal').classList.add('hidden'); }

  // ── Exercises ──────────────────────────────────────────────────────────────
  async function loadExercises() {
    const cat = document.getElementById('ex-filter-cat').value;
    const muscle = document.getElementById('ex-filter-muscle').value;
    let url = '/api/exercises?';
    if (cat) url += 'category=' + cat + '&';
    if (muscle) url += 'muscle=' + muscle;
    const exercises = await get(url);
    const el = document.getElementById('exercise-list');
    el.innerHTML = '';
    exercises.forEach(e => {
      const div = document.createElement('div');
      div.className = 'exercise-card';
      div.innerHTML = `
        <h3>${e.name}</h3>
        <div>
          <span class="tag tag-cat">${e.category}</span>
          <span class="tag tag-muscle">${e.muscle_group}</span>
          <span class="tag tag-equip">${e.equipment}</span>
        </div>
        ${e.instructions ? `<p class="instructions">${e.instructions}</p>` : ''}`;
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
      category: document.getElementById('ex-category').value,
      muscle_group: document.getElementById('ex-muscle').value,
      equipment: document.getElementById('ex-equipment').value,
      instructions: document.getElementById('ex-instructions').value,
    });
    toast('Exercise added');
    hideAddExercise();
    loadExercises();
  }

  // ── Personal Records ───────────────────────────────────────────────────────
  async function loadPRs() {
    const bests = await get('/api/records/bests');
    const el = document.getElementById('pr-list');
    el.innerHTML = '';
    if (!bests.length) { el.innerHTML = '<p style="color:var(--text-muted)">No PRs yet — start logging sets!</p>'; return; }
    bests.forEach(pr => {
      const div = document.createElement('div');
      div.className = 'pr-card';
      div.innerHTML = `
        <div style="font-weight:600;margin-bottom:.25rem">${pr.exercise_name}</div>
        <div class="pr-weight">${pr.best_weight} lbs</div>
        <div class="pr-detail">${pr.reps} reps · ${fmtDate(pr.achieved_at)}</div>
        <span class="tag tag-muscle">${pr.muscle_group}</span>`;
      el.appendChild(div);
    });
  }

  // ── Nutrition ──────────────────────────────────────────────────────────────
  async function loadMeals() {
    const dateInput = document.getElementById('meal-date');
    if (!dateInput.value) dateInput.value = localDateStr();
    const meals = await get('/api/meals?date=' + dateInput.value);

    const totals = meals.reduce((acc, m) => ({
      calories: acc.calories + m.macros.calories,
      protein: acc.protein + m.macros.protein,
      carbs: acc.carbs + m.macros.carbs,
      fat: acc.fat + m.macros.fat,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    document.getElementById('nutrition-summary').innerHTML = `
      <div class="stat-card"><div class="stat-label">Calories</div><div class="stat-value" style="color:var(--accent)">${totals.calories.toFixed(0)}</div></div>
      <div class="stat-card"><div class="stat-label">Protein</div><div class="stat-value" style="color:var(--green)">${totals.protein.toFixed(1)}g</div></div>
      <div class="stat-card"><div class="stat-label">Carbs</div><div class="stat-value" style="color:var(--yellow)">${totals.carbs.toFixed(1)}g</div></div>
      <div class="stat-card"><div class="stat-label">Fat</div><div class="stat-value" style="color:var(--accent2)">${totals.fat.toFixed(1)}g</div></div>`;

    const el = document.getElementById('meal-list');
    el.innerHTML = '';
    meals.forEach(m => {
      const div = document.createElement('div');
      div.className = 'meal-card';
      const foodRows = m.foods.map(f => `
        <div class="meal-food-row">
          <span>${f.name} <span style="color:var(--text-muted);font-size:.8rem">${f.amount_g}g</span></span>
          <div style="display:flex;align-items:center;gap:.75rem">
            <span style="font-size:.8rem;color:var(--text-muted)">${(f.amount_g * f.calories_per_100g / 100).toFixed(0)} cal · ${(f.amount_g * f.protein_per_100g / 100).toFixed(1)}g P</span>
            <button class="btn btn-sm btn-danger" onclick="App.deleteMealFood(${f.id}, ${m.id})">✕</button>
          </div>
        </div>`).join('');
      div.innerHTML = `
        <div class="meal-header">
          <h3>${m.name}</h3>
          <div style="display:flex;gap:.5rem">
            <button class="btn btn-sm btn-primary" onclick="App.openAddFoodToMeal(${m.id}, '${m.name}')">+ Food</button>
            <button class="btn btn-sm btn-danger" onclick="App.deleteMeal(${m.id})">Delete</button>
          </div>
        </div>
        ${foodRows || '<p style="color:var(--text-muted);font-size:.875rem">No foods added yet.</p>'}
        <div class="meal-macros">
          ${m.macros.calories.toFixed(0)} cal ·
          P: <span>${m.macros.protein.toFixed(1)}g</span>
          C: <span>${m.macros.carbs.toFixed(1)}g</span>
          F: <span>${m.macros.fat.toFixed(1)}g</span>
        </div>`;
      el.appendChild(div);
    });
  }

  function showAddMeal() { document.getElementById('add-meal-form').classList.remove('hidden'); }

  async function addMeal() {
    const name = document.getElementById('meal-name').value.trim();
    if (!name) return toast('Name required', 'error');
    const date = document.getElementById('meal-date').value || localDateStr();
    await post('/api/meals', { name, logged_at: date + 'T12:00:00' });
    document.getElementById('meal-name').value = '';
    document.getElementById('add-meal-form').classList.add('hidden');
    toast('Meal created ✓');
    loadMeals();
  }

  async function deleteMeal(id) {
    if (!confirm('Delete this meal?')) return;
    await del(`/api/meals/${id}`);
    loadMeals();
  }

  function openAddFoodToMeal(mealId, mealName) {
    addFoodMealId = mealId;
    selectedFoodId = null;
    document.getElementById('meal-target-name').textContent = mealName;
    document.getElementById('food-search').value = '';
    document.getElementById('food-amount').value = '';
    document.getElementById('food-results').innerHTML = '';
    document.getElementById('add-food-to-meal').classList.remove('hidden');
    document.getElementById('food-search').focus();
  }

  function hideAddFoodToMeal() {
    document.getElementById('add-food-to-meal').classList.add('hidden');
    addFoodMealId = null;
    selectedFoodId = null;
    loadMeals();
  }

  async function searchFoods() {
    const q = document.getElementById('food-search').value;
    const foods = await get('/api/foods?q=' + encodeURIComponent(q));
    const el = document.getElementById('food-results');
    el.innerHTML = '';
    foods.forEach(f => {
      const div = document.createElement('div');
      div.className = 'food-item' + (selectedFoodId === f.id ? ' selected' : '');
      div.innerHTML = `
        <div>
          <div>${f.name}${f.brand ? ` <span style="color:var(--text-muted)">(${f.brand})</span>` : ''}</div>
          <div class="food-macros-small">${f.calories_per_100g} kcal · P:${f.protein_per_100g}g C:${f.carbs_per_100g}g F:${f.fat_per_100g}g per 100g</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="App.addFoodToMeal(${f.id})">Add</button>`;
      el.appendChild(div);
    });
  }

  let aiEstimateData = null;

  async function estimateMacros() {
    const name = document.getElementById('food-search').value.trim();
    if (!name) return toast('Type a food name first', 'error');
    const btn = document.getElementById('estimate-btn');
    btn.textContent = 'Estimating...';
    btn.disabled = true;
    try {
      const data = await post('/api/foods/estimate', { name });
      aiEstimateData = { name, ...data };
      const amount = parseFloat(document.getElementById('food-amount').value) || 100;
      const scale = amount / 100;
      document.getElementById('ai-estimate-name').textContent = `${name} (${amount}g)`;
      document.getElementById('ai-estimate-values').innerHTML = `
        <span>🔥 <b>${(data.calories * scale).toFixed(0)}</b> kcal</span>
        <span>Protein: <b>${(data.protein * scale).toFixed(1)}g</b></span>
        <span>Carbs: <b>${(data.carbs * scale).toFixed(1)}g</b></span>
        <span>Fat: <b>${(data.fat * scale).toFixed(1)}g</b></span>
        <span style="color:var(--text-muted);font-size:.75rem">for ${amount}g · AI estimate</span>`;
      document.getElementById('ai-estimate-result').classList.remove('hidden');
    } catch {
      toast('AI estimate failed', 'error');
    } finally {
      btn.textContent = ' Estimate macros';
      btn.disabled = false;
    }
  }

  async function saveAiEstimate() {
    if (!aiEstimateData || !addFoodMealId) return;
    const amount = parseFloat(document.getElementById('food-amount').value);
    if (!amount || amount <= 0) return toast('Enter amount in grams first', 'error');
    const food = await post('/api/foods', {
      name: aiEstimateData.name,
      calories_per_100g: aiEstimateData.calories,
      protein_per_100g: aiEstimateData.protein,
      carbs_per_100g: aiEstimateData.carbs,
      fat_per_100g: aiEstimateData.fat,
    });
    await post(`/api/meals/${addFoodMealId}/foods`, { food_id: food.id, amount_g: amount });
    toast(`${aiEstimateData.name} added ✓`);
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

  // ── Progress ───────────────────────────────────────────────────────────────
  async function loadProgress() {
    const exercises = await get('/api/exercises');
    const sel = document.getElementById('prog-exercise');
    sel.innerHTML = '<option value="">Select exercise...</option>';
    exercises.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.id;
      opt.textContent = e.name;
      sel.appendChild(opt);
    });
    loadMacroProgress();
  }

  async function loadExerciseProgress() {
    const id = document.getElementById('prog-exercise').value;
    if (!id) return;
    const data = await get(`/api/progress/exercise/${id}`);
    const canvas = document.getElementById('strength-chart');
    if (strengthChart) strengthChart.destroy();
    if (!data.length) return;
    strengthChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: data.map(d => new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [{
          label: 'Max Weight (lbs)',
          data: data.map(d => d.max_weight),
          borderColor: '#6c63ff',
          backgroundColor: 'rgba(108,99,255,.15)',
          tension: 0.3, fill: true, yAxisID: 'y'
        }, {
          label: 'Volume (kg·reps)',
          data: data.map(d => d.volume),
          borderColor: '#4caf7d',
          backgroundColor: 'rgba(76,175,125,.1)',
          tension: 0.3, fill: true, yAxisID: 'y1'
        }]
      },
      options: {
        ...chartOpts(),
        scales: {
          x: axisStyle(),
          y: { ...axisStyle(), type: 'linear', position: 'left', title: { display: true, text: 'Weight (lbs)', color: '#8b90a8' } },
          y1: { ...axisStyle(), type: 'linear', position: 'right', grid: { drawOnChartArea: false }, title: { display: true, text: 'Volume', color: '#8b90a8' } }
        }
      }
    });
  }

  async function loadMacroProgress() {
    const data = await get('/api/progress/macros');
    const canvas = document.getElementById('macro-chart');
    if (macroChart) macroChart.destroy();
    if (!data.length) return;
    macroChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: data.map(d => new Date(d.date + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })),
        datasets: [
          { label: 'Protein (g)', data: data.map(d => d.protein), backgroundColor: 'rgba(76,175,125,.8)', stack: 'a' },
          { label: 'Carbs (g)', data: data.map(d => d.carbs), backgroundColor: 'rgba(245,166,35,.8)', stack: 'a' },
          { label: 'Fat (g)', data: data.map(d => d.fat), backgroundColor: 'rgba(255,101,132,.8)', stack: 'a' },
        ]
      },
      options: chartOpts('g')
    });
  }

  // ── Goals ──────────────────────────────────────────────────────────────────
  async function loadGoals() {
    const goals = await get('/api/goals');
    const el = document.getElementById('goal-list');
    el.innerHTML = '';
    if (!goals.length) { el.innerHTML = '<p style="color:var(--text-muted)">No goals set. Add one!</p>'; return; }
    goals.forEach(g => {
      const div = document.createElement('div');
      div.className = 'goal-card';
      div.innerHTML = `
        <div class="goal-check ${g.achieved ? 'done' : ''}" onclick="App.toggleGoal(${g.id}, ${g.achieved})" title="Mark complete">
          ${g.achieved ? '✓' : ''}
        </div>
        <div class="goal-info">
          <div class="goal-type">${g.type.replace(/_/g, ' ')}</div>
          <div class="goal-target ${g.achieved ? 'line-through' : ''}">${g.target_value} ${g.unit}</div>
          ${g.deadline ? `<div class="goal-deadline">By ${fmtDate(g.deadline)}</div>` : ''}
        </div>
        <button class="btn btn-sm btn-danger" onclick="App.deleteGoal(${g.id})">✕</button>`;
      el.appendChild(div);
    });
  }

  function showAddGoal() { document.getElementById('add-goal-form').classList.remove('hidden'); }
  function hideAddGoal() { document.getElementById('add-goal-form').classList.add('hidden'); }

  async function addGoal() {
    const target = parseFloat(document.getElementById('goal-target').value);
    if (!target) return toast('Enter a target value', 'error');
    await post('/api/goals', {
      type: document.getElementById('goal-type').value,
      target_value: target,
      unit: document.getElementById('goal-unit').value || 'units',
      deadline: document.getElementById('goal-deadline').value || null,
    });
    toast('Goal saved ✓');
    hideAddGoal();
    loadGoals();
  }

  async function toggleGoal(id, current) {
    await patch(`/api/goals/${id}`, { achieved: !current });
    loadGoals();
  }

  async function deleteGoal(id) {
    await del(`/api/goals/${id}`);
    loadGoals();
    toast('Goal removed');
  }

  // ── Chart helpers ──────────────────────────────────────────────────────────
  function axisStyle() {
    return {
      grid: { color: 'rgba(255,255,255,.05)' },
      ticks: { color: '#8b90a8' },
    };
  }

  function chartOpts(unit = '') {
    return {
      responsive: true,
      plugins: { legend: { labels: { color: '#8b90a8' } } },
      scales: {
        x: axisStyle(),
        y: { ...axisStyle(), ticks: { ...axisStyle().ticks, callback: v => v + (unit ? ' ' + unit : '') } }
      }
    };
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    initNav();
    loadDashboard();
    // Set today's date on nutrition tab
    document.getElementById('meal-date').value = localDateStr();
    // Close modal on backdrop click
    document.getElementById('workout-modal').addEventListener('click', function(e) {
      if (e.target === this) closeModal();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    logWeight, startWorkout, addSet, deleteSet, finishWorkout, deleteWorkout,
    loadExercises, showAddExercise, hideAddExercise, addExercise,
    showAddMeal, addMeal, deleteMeal, openAddFoodToMeal, hideAddFoodToMeal,
    searchFoods, addFoodToMeal, deleteMealFood, estimateMacros, saveAiEstimate, discardAiEstimate,
    loadExerciseProgress,
    showAddGoal, hideAddGoal, addGoal, toggleGoal, deleteGoal,
    closeModal,
  };
})();
