const express = require('express');
const path = require('path');
const initDb = require('./database');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const USER_ID = 1;

initDb().then(db => {

  // ─── DASHBOARD ───────────────────────────────────────────────────────────
  app.get('/api/dashboard', (req, res) => {
    const totalWorkouts = db.prepare('SELECT COUNT(*) as c FROM workouts WHERE user_id=?').get(USER_ID).c;
    const lastWorkout = db.prepare(
      'SELECT name, started_at FROM workouts WHERE user_id=? ORDER BY started_at DESC LIMIT 1'
    ).get(USER_ID);
    const prCount = db.prepare('SELECT COUNT(*) as c FROM personal_records WHERE user_id=?').get(USER_ID).c;
    const latestWeight = db.prepare(
      'SELECT weight_kg, logged_at FROM body_weight WHERE user_id=? ORDER BY logged_at DESC LIMIT 1'
    ).get(USER_ID);
    const todayMacros = db.prepare(`
      SELECT
        ROUND(SUM(mf.amount_g * f.calories_per_100g / 100), 1) as calories,
        ROUND(SUM(mf.amount_g * f.protein_per_100g / 100), 1) as protein,
        ROUND(SUM(mf.amount_g * f.carbs_per_100g / 100), 1) as carbs,
        ROUND(SUM(mf.amount_g * f.fat_per_100g / 100), 1) as fat
      FROM meals m
      JOIN meal_foods mf ON mf.meal_id = m.id
      JOIN foods f ON f.id = mf.food_id
      WHERE m.user_id=? AND DATE(m.logged_at)=DATE('now')
    `).get(USER_ID);

    res.json({ totalWorkouts, lastWorkout, prCount, latestWeight, todayMacros });
  });

  // ─── EXERCISES ────────────────────────────────────────────────────────────
  app.get('/api/exercises', (req, res) => {
    const { category, muscle } = req.query;
    let sql = 'SELECT * FROM exercises WHERE 1=1';
    const params = [];
    if (category) { sql += ' AND category=?'; params.push(category); }
    if (muscle) { sql += ' AND muscle_group=?'; params.push(muscle); }
    sql += ' ORDER BY name';
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/exercises', (req, res) => {
    const { name, category, muscle_group, equipment, instructions } = req.body;
    const r = db.prepare(
      'INSERT INTO exercises (name, category, muscle_group, equipment, instructions) VALUES (?, ?, ?, ?, ?)'
    ).run(name, category, muscle_group, equipment || 'Bodyweight', instructions || '');
    res.json(db.prepare('SELECT * FROM exercises WHERE id=?').get(r.lastInsertRowid));
  });

  // ─── WORKOUTS ─────────────────────────────────────────────────────────────
  app.get('/api/workouts', (req, res) => {
    res.json(db.prepare(
      'SELECT * FROM workouts WHERE user_id=? ORDER BY started_at DESC LIMIT 50'
    ).all(USER_ID));
  });

  app.post('/api/workouts', (req, res) => {
    const { name, notes } = req.body;
    const r = db.prepare(
      'INSERT INTO workouts (user_id, name, notes) VALUES (?, ?, ?)'
    ).run(USER_ID, name, notes || '');
    res.json(db.prepare('SELECT * FROM workouts WHERE id=?').get(r.lastInsertRowid));
  });

  app.patch('/api/workouts/:id/finish', (req, res) => {
    db.prepare("UPDATE workouts SET finished_at=datetime('now') WHERE id=? AND user_id=?")
      .run(req.params.id, USER_ID);
    res.json({ ok: true });
  });

  app.delete('/api/workouts/:id', (req, res) => {
    db.prepare('DELETE FROM workout_sets WHERE workout_id=?').run(req.params.id);
    db.prepare('DELETE FROM workouts WHERE id=? AND user_id=?').run(req.params.id, USER_ID);
    res.json({ ok: true });
  });

  app.get('/api/workouts/:id/sets', (req, res) => {
    res.json(db.prepare(`
      SELECT ws.*, e.name as exercise_name, e.muscle_group, e.category
      FROM workout_sets ws
      JOIN exercises e ON e.id = ws.exercise_id
      WHERE ws.workout_id=?
      ORDER BY ws.exercise_id, ws.set_number
    `).all(req.params.id));
  });

  app.post('/api/workouts/:id/sets', (req, res) => {
    const { exercise_id, set_number, reps, weight_kg, duration_sec, notes } = req.body;
    const r = db.prepare(
      'INSERT INTO workout_sets (workout_id, exercise_id, set_number, reps, weight_kg, duration_sec, notes) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(req.params.id, exercise_id, set_number, reps || null, weight_kg || null, duration_sec || null, notes || '');

    if (weight_kg && reps) {
      const existing = db.prepare(
        'SELECT * FROM personal_records WHERE user_id=? AND exercise_id=? ORDER BY weight_kg DESC, reps DESC LIMIT 1'
      ).get(USER_ID, exercise_id);
      const isNewPR = !existing || weight_kg > existing.weight_kg ||
        (weight_kg === existing.weight_kg && reps > existing.reps);
      if (isNewPR) {
        db.prepare(
          'INSERT INTO personal_records (user_id, exercise_id, weight_kg, reps, workout_id) VALUES (?, ?, ?, ?, ?)'
        ).run(USER_ID, exercise_id, weight_kg, reps, req.params.id);
      }
    }

    res.json(db.prepare('SELECT * FROM workout_sets WHERE id=?').get(r.lastInsertRowid));
  });

  app.delete('/api/sets/:id', (req, res) => {
    db.prepare('DELETE FROM workout_sets WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── PERSONAL RECORDS ─────────────────────────────────────────────────────
  app.get('/api/records', (req, res) => {
    res.json(db.prepare(`
      SELECT pr.*, e.name as exercise_name, e.muscle_group, e.category
      FROM personal_records pr
      JOIN exercises e ON e.id = pr.exercise_id
      WHERE pr.user_id=?
      ORDER BY pr.achieved_at DESC
    `).all(USER_ID));
  });

  app.get('/api/records/bests', (req, res) => {
    res.json(db.prepare(`
      SELECT pr.exercise_id, e.name as exercise_name, e.muscle_group,
        MAX(pr.weight_kg) as best_weight, pr.reps, pr.achieved_at
      FROM personal_records pr
      JOIN exercises e ON e.id = pr.exercise_id
      WHERE pr.user_id=?
      GROUP BY pr.exercise_id
      ORDER BY e.name
    `).all(USER_ID));
  });

  // ─── BODY WEIGHT ──────────────────────────────────────────────────────────
  app.get('/api/bodyweight', (req, res) => {
    res.json(db.prepare(
      'SELECT * FROM body_weight WHERE user_id=? ORDER BY logged_at ASC'
    ).all(USER_ID));
  });

  app.post('/api/bodyweight', (req, res) => {
    const { weight_kg, logged_at } = req.body;
    const r = db.prepare(
      'INSERT INTO body_weight (user_id, weight_kg, logged_at) VALUES (?, ?, ?)'
    ).run(USER_ID, weight_kg, logged_at || new Date().toISOString());
    res.json(db.prepare('SELECT * FROM body_weight WHERE id=?').get(r.lastInsertRowid));
  });

  app.delete('/api/bodyweight/:id', (req, res) => {
    db.prepare('DELETE FROM body_weight WHERE id=? AND user_id=?').run(req.params.id, USER_ID);
    res.json({ ok: true });
  });

  // ─── FOODS ────────────────────────────────────────────────────────────────
  app.get('/api/foods', (req, res) => {
    const { q } = req.query;
    let sql = 'SELECT * FROM foods';
    const params = [];
    if (q) { sql += ' WHERE name LIKE ? OR brand LIKE ?'; params.push(`%${q}%`, `%${q}%`); }
    sql += ' ORDER BY name LIMIT 50';
    res.json(db.prepare(sql).all(...params));
  });

  app.post('/api/foods', (req, res) => {
    const { name, brand, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g } = req.body;
    const r = db.prepare(
      'INSERT INTO foods (name, brand, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(name, brand || null, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g);
    res.json(db.prepare('SELECT * FROM foods WHERE id=?').get(r.lastInsertRowid));
  });

  // ─── MEALS ────────────────────────────────────────────────────────────────
  app.get('/api/meals', (req, res) => {
    const { date } = req.query;
    const d = date || new Date().toISOString().slice(0, 10);
    const meals = db.prepare(
      "SELECT * FROM meals WHERE user_id=? AND DATE(logged_at)=? ORDER BY logged_at ASC"
    ).all(USER_ID, d);

    const result = meals.map(m => {
      const foods = db.prepare(`
        SELECT mf.*, f.name, f.calories_per_100g, f.protein_per_100g, f.carbs_per_100g, f.fat_per_100g
        FROM meal_foods mf JOIN foods f ON f.id=mf.food_id
        WHERE mf.meal_id=?
      `).all(m.id);
      const macros = foods.reduce((acc, f) => ({
        calories: acc.calories + (f.amount_g * f.calories_per_100g / 100),
        protein: acc.protein + (f.amount_g * f.protein_per_100g / 100),
        carbs: acc.carbs + (f.amount_g * f.carbs_per_100g / 100),
        fat: acc.fat + (f.amount_g * f.fat_per_100g / 100),
      }), { calories: 0, protein: 0, carbs: 0, fat: 0 });
      return { ...m, foods, macros };
    });
    res.json(result);
  });

  app.post('/api/meals', (req, res) => {
    const { name, logged_at } = req.body;
    const r = db.prepare(
      'INSERT INTO meals (user_id, name, logged_at) VALUES (?, ?, ?)'
    ).run(USER_ID, name, logged_at || new Date().toISOString());
    res.json(db.prepare('SELECT * FROM meals WHERE id=?').get(r.lastInsertRowid));
  });

  app.delete('/api/meals/:id', (req, res) => {
    db.prepare('DELETE FROM meal_foods WHERE meal_id=?').run(req.params.id);
    db.prepare('DELETE FROM meals WHERE id=? AND user_id=?').run(req.params.id, USER_ID);
    res.json({ ok: true });
  });

  app.post('/api/meals/:id/foods', (req, res) => {
    const { food_id, amount_g } = req.body;
    const r = db.prepare(
      'INSERT INTO meal_foods (meal_id, food_id, amount_g) VALUES (?, ?, ?)'
    ).run(req.params.id, food_id, amount_g);
    res.json(db.prepare('SELECT * FROM meal_foods WHERE id=?').get(r.lastInsertRowid));
  });

  app.delete('/api/mealfoods/:id', (req, res) => {
    db.prepare('DELETE FROM meal_foods WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── GOALS ────────────────────────────────────────────────────────────────
  app.get('/api/goals', (req, res) => {
    res.json(db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY created_at DESC').all(USER_ID));
  });

  app.post('/api/goals', (req, res) => {
    const { type, target_value, unit, deadline } = req.body;
    const r = db.prepare(
      'INSERT INTO goals (user_id, type, target_value, unit, deadline) VALUES (?, ?, ?, ?, ?)'
    ).run(USER_ID, type, target_value, unit, deadline || null);
    res.json(db.prepare('SELECT * FROM goals WHERE id=?').get(r.lastInsertRowid));
  });

  app.patch('/api/goals/:id', (req, res) => {
    const { achieved } = req.body;
    db.prepare('UPDATE goals SET achieved=? WHERE id=? AND user_id=?').run(achieved ? 1 : 0, req.params.id, USER_ID);
    res.json({ ok: true });
  });

  app.delete('/api/goals/:id', (req, res) => {
    db.prepare('DELETE FROM goals WHERE id=? AND user_id=?').run(req.params.id, USER_ID);
    res.json({ ok: true });
  });

  // ─── PROGRESS ─────────────────────────────────────────────────────────────
  app.get('/api/progress/exercise/:id', (req, res) => {
    res.json(db.prepare(`
      SELECT w.started_at as date, MAX(ws.weight_kg) as max_weight, SUM(ws.reps * ws.weight_kg) as volume
      FROM workout_sets ws
      JOIN workouts w ON w.id = ws.workout_id
      WHERE ws.exercise_id=? AND w.user_id=?
      GROUP BY DATE(w.started_at)
      ORDER BY w.started_at ASC
      LIMIT 30
    `).all(req.params.id, USER_ID));
  });

  app.get('/api/progress/macros', (req, res) => {
    res.json(db.prepare(`
      SELECT DATE(m.logged_at) as date,
        ROUND(SUM(mf.amount_g * f.calories_per_100g / 100), 1) as calories,
        ROUND(SUM(mf.amount_g * f.protein_per_100g / 100), 1) as protein,
        ROUND(SUM(mf.amount_g * f.carbs_per_100g / 100), 1) as carbs,
        ROUND(SUM(mf.amount_g * f.fat_per_100g / 100), 1) as fat
      FROM meals m
      JOIN meal_foods mf ON mf.meal_id = m.id
      JOIN foods f ON f.id = mf.food_id
      WHERE m.user_id=?
      GROUP BY DATE(m.logged_at)
      ORDER BY date ASC
      LIMIT 30
    `).all(USER_ID));
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`GymTracker running → http://localhost:${PORT}`));

}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
