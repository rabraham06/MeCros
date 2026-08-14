require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
const initDb = require('./database');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// General API: 200 requests per minute
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please slow down.' },
}));

// AI estimate: 10 requests per minute to protect Anthropic API costs
app.use('/api/foods/estimate', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI estimate limit reached — try again in a minute.' },
}));

// AI meal analyzer: 10 requests per minute
app.use('/api/nutrition/analyze', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'AI analyze limit reached — try again in a minute.' },
}));

// ── Auth helpers ──────────────────────────────────────────────────────────────
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const attempt = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

initDb().then(db => {

  // ── Auth middleware ───────────────────────────────────────────────────────
  function requireAuth(req, res, next) {
    const header = req.headers['authorization'] || '';
    if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Unauthorized' });
    const token = header.slice(7);
    const user = db.prepare('SELECT id, username FROM users WHERE token=?').get(token);
    if (!user) return res.status(401).json({ error: 'Invalid or expired token' });
    req.userId = user.id;
    req.username = user.username;
    next();
  }

  // ── Auth routes (public — no token required) ──────────────────────────────
  app.post('/api/auth/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
    if (existing) return res.status(409).json({ error: 'Username already taken' });
    try {
      const password_hash = hashPassword(password);
      const token = generateToken();
      const r = db.prepare('INSERT INTO users (username, password_hash, token) VALUES (?, ?, ?)').run(username, password_hash, token);
      res.json({ token, userId: r.lastInsertRowid, username });
    } catch (err) {
      res.status(500).json({ error: 'Registration failed' });
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid username or password' });
    try {
      if (!verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'Invalid username or password' });
      const token = generateToken();
      db.prepare('UPDATE users SET token=? WHERE id=?').run(token, user.id);
      res.json({ token, userId: user.id, username: user.username });
    } catch {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  });

  app.post('/api/auth/logout', requireAuth, (req, res) => {
    db.prepare('UPDATE users SET token=NULL WHERE id=?').run(req.userId);
    res.json({ ok: true });
  });

  // All routes below this line require a valid token
  app.use('/api', requireAuth);

  // ─── PROFILE ─────────────────────────────────────────────────────────────
  const ACTIVITY_FACTORS = { sedentary: 13, light: 14.5, moderate: 15.5, active: 17 };
  const GOAL_CAL_RANGE   = { bulking: [300, 500], lean_bulking: [100, 250], cutting: [-600, -350] };
  const GOAL_PROT_RANGE  = { bulking: [0.7, 0.9], lean_bulking: [0.9, 1.1], cutting: [1.0, 1.3] };

  function calcRanges(weight_lbs, activity_level, goal) {
    const tdee = weight_lbs * (ACTIVITY_FACTORS[activity_level] || 15.5);
    const [calLo, calHi] = GOAL_CAL_RANGE[goal]  || [0, 200];
    const [prLo,  prHi]  = GOAL_PROT_RANGE[goal] || [0.8, 1.0];
    return {
      daily_calories: Math.round(tdee + (calLo + calHi) / 2),
      daily_protein:  Math.round(weight_lbs * (prLo + prHi) / 2),
      cal_low:   Math.round(tdee + calLo),
      cal_high:  Math.round(tdee + calHi),
      prot_low:  Math.round(weight_lbs * prLo),
      prot_high: Math.round(weight_lbs * prHi),
    };
  }

  app.get('/api/profile', (req, res) => {
    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id=?').get(req.userId);
    if (!profile) return res.json(null);
    res.json({ ...profile, ...calcRanges(profile.weight_lbs, profile.activity_level, profile.goal) });
  });

  app.post('/api/profile/setup', (req, res) => {
    const { display_name, height_cm, weight_lbs, activity_level, goal } = req.body;
    if (!display_name || !height_cm || !weight_lbs || !activity_level || !goal) {
      return res.status(400).json({ error: 'All fields required' });
    }
    const { daily_calories, daily_protein, cal_low, cal_high, prot_low, prot_high } =
      calcRanges(weight_lbs, activity_level, goal);
    const existing = db.prepare('SELECT user_id FROM user_profiles WHERE user_id=?').get(req.userId);
    if (existing) {
      db.prepare(
        'UPDATE user_profiles SET display_name=?, height_cm=?, weight_lbs=?, activity_level=?, goal=?, daily_calories=?, daily_protein=? WHERE user_id=?'
      ).run(display_name, height_cm, weight_lbs, activity_level, goal, daily_calories, daily_protein, req.userId);
    } else {
      db.prepare(
        'INSERT INTO user_profiles (user_id, display_name, height_cm, weight_lbs, activity_level, goal, daily_calories, daily_protein) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(req.userId, display_name, height_cm, weight_lbs, activity_level, goal, daily_calories, daily_protein);
    }
    res.json({ daily_calories, daily_protein, cal_low, cal_high, prot_low, prot_high });
  });

  // ─── DASHBOARD ───────────────────────────────────────────────────────────
  app.get('/api/dashboard', (req, res) => {
    const totalWorkouts = db.prepare('SELECT COUNT(*) as c FROM workouts WHERE user_id=?').get(req.userId).c;
    const lastWorkout = db.prepare(
      'SELECT name, started_at FROM workouts WHERE user_id=? ORDER BY started_at DESC LIMIT 1'
    ).get(req.userId);
    const prCount = db.prepare('SELECT COUNT(*) as c FROM personal_records WHERE user_id=?').get(req.userId).c;
    const latestWeight = db.prepare(
      'SELECT weight_kg, logged_at FROM body_weight WHERE user_id=? ORDER BY logged_at DESC LIMIT 1'
    ).get(req.userId);
    const todayMacros = db.prepare(`
      SELECT
        ROUND(SUM(mf.amount_g * f.calories_per_100g / 100), 1) as calories,
        ROUND(SUM(mf.amount_g * f.protein_per_100g / 100), 1) as protein,
        ROUND(SUM(mf.amount_g * f.carbs_per_100g / 100), 1) as carbs,
        ROUND(SUM(mf.amount_g * f.fat_per_100g / 100), 1) as fat
      FROM meals m
      JOIN meal_foods mf ON mf.meal_id = m.id
      JOIN foods f ON f.id = mf.food_id
      WHERE m.user_id=? AND substr(m.logged_at,1,10)=substr(datetime('now','localtime'),1,10)
    `).get(req.userId);

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
    ).all(req.userId));
  });

  app.post('/api/workouts', (req, res) => {
    const { name, notes } = req.body;
    const r = db.prepare(
      'INSERT INTO workouts (user_id, name, notes) VALUES (?, ?, ?)'
    ).run(req.userId, name, notes || '');
    res.json(db.prepare('SELECT * FROM workouts WHERE id=?').get(r.lastInsertRowid));
  });

  app.patch('/api/workouts/:id/finish', (req, res) => {
    db.prepare("UPDATE workouts SET finished_at=datetime('now') WHERE id=? AND user_id=?")
      .run(req.params.id, req.userId);
    res.json({ ok: true });
  });

  app.delete('/api/workouts/:id', (req, res) => {
    db.prepare('DELETE FROM workout_sets WHERE workout_id=?').run(req.params.id);
    db.prepare('DELETE FROM workouts WHERE id=? AND user_id=?').run(req.params.id, req.userId);
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
      ).get(req.userId, exercise_id);
      const isNewPR = !existing || weight_kg > existing.weight_kg ||
        (weight_kg === existing.weight_kg && reps > existing.reps);
      if (isNewPR) {
        db.prepare(
          'INSERT INTO personal_records (user_id, exercise_id, weight_kg, reps, workout_id) VALUES (?, ?, ?, ?, ?)'
        ).run(req.userId, exercise_id, weight_kg, reps, req.params.id);
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
    `).all(req.userId));
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
    `).all(req.userId));
  });

  // ─── BODY WEIGHT ──────────────────────────────────────────────────────────
  app.get('/api/bodyweight', (req, res) => {
    res.json(db.prepare(
      'SELECT * FROM body_weight WHERE user_id=? ORDER BY logged_at ASC'
    ).all(req.userId));
  });

  app.post('/api/bodyweight', (req, res) => {
    const { weight_kg, logged_at } = req.body;
    const r = db.prepare(
      'INSERT INTO body_weight (user_id, weight_kg, logged_at) VALUES (?, ?, ?)'
    ).run(req.userId, weight_kg, logged_at || new Date().toISOString());
    res.json(db.prepare('SELECT * FROM body_weight WHERE id=?').get(r.lastInsertRowid));
  });

  app.delete('/api/bodyweight/:id', (req, res) => {
    db.prepare('DELETE FROM body_weight WHERE id=? AND user_id=?').run(req.params.id, req.userId);
    res.json({ ok: true });
  });

  // ─── AI MACRO ESTIMATE ────────────────────────────────────────────────────
  app.post('/api/foods/estimate', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Food name required' });
    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `Estimate the macronutrients per 100g for: "${name}".
Reply with ONLY a valid JSON object, no explanation or markdown:
{"calories": number, "protein": number, "carbs": number, "fat": number}
Use realistic average values for this food.`
        }]
      });
      const raw = message.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      const json = JSON.parse(raw);
      res.json(json);
    } catch (err) {
      console.error('AI estimate error:', err.message);
      res.status(500).json({ error: 'Failed to estimate macros' });
    }
  });

  // ─── AI MEAL ANALYZER ────────────────────────────────────────────────────
  app.post('/api/nutrition/analyze', async (req, res) => {
    const { description } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ error: 'Meal description required' });
    try {
      const message = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: `A user ate: "${description.trim()}"

Estimate the macronutrients for each food item and the combined total.
Reply with ONLY a valid JSON object, no explanation or markdown:
{
  "items": [
    { "name": "string", "calories": number, "protein": number, "carbs": number, "fat": number }
  ],
  "total": { "calories": number, "protein": number, "carbs": number, "fat": number }
}
Use realistic average values. Calories and macros are for the described portion (not per 100g).`,
        }]
      });
      const raw = message.content[0].text.trim().replace(/^```json\s*/i, '').replace(/```\s*$/, '');
      const json = JSON.parse(raw);
      res.json(json);
    } catch (err) {
      console.error('AI meal analyze error:', err.message);
      res.status(500).json({ error: 'Failed to analyze meal' });
    }
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
      "SELECT * FROM meals WHERE user_id=? AND substr(logged_at,1,10)=? ORDER BY logged_at ASC"
    ).all(req.userId, d);

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
    ).run(req.userId, name, logged_at);
    res.json(db.prepare('SELECT * FROM meals WHERE id=?').get(r.lastInsertRowid));
  });

  app.patch('/api/meals/:id', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name required' });
    db.prepare('UPDATE meals SET name=? WHERE id=? AND user_id=?').run(name, req.params.id, req.userId);
    res.json({ ok: true });
  });

  app.delete('/api/meals/:id', (req, res) => {
    db.prepare('DELETE FROM meal_foods WHERE meal_id=?').run(req.params.id);
    db.prepare('DELETE FROM meals WHERE id=? AND user_id=?').run(req.params.id, req.userId);
    res.json({ ok: true });
  });

  app.post('/api/meals/:id/foods', (req, res) => {
    const { food_id, amount_g, qty = 1 } = req.body;
    const r = db.prepare(
      'INSERT INTO meal_foods (meal_id, food_id, amount_g, qty) VALUES (?, ?, ?, ?)'
    ).run(req.params.id, food_id, amount_g, qty);
    res.json(db.prepare('SELECT * FROM meal_foods WHERE id=?').get(r.lastInsertRowid));
  });

  app.delete('/api/mealfoods/:id', (req, res) => {
    db.prepare('DELETE FROM meal_foods WHERE id=?').run(req.params.id);
    res.json({ ok: true });
  });

  // ─── MEAL SUGGESTIONS ─────────────────────────────────────────────────────
  app.get('/api/nutrition/suggest', (req, res) => {
    const profile = db.prepare('SELECT * FROM user_profiles WHERE user_id=?').get(req.userId);
    if (!profile) return res.json({ suggestions: [], calRemaining: 0, protRemaining: 0 });

    const ranges = calcRanges(profile.weight_lbs, profile.activity_level, profile.goal);
    const today  = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD local

    const logged = db.prepare(`
      SELECT
        COALESCE(SUM(mf.amount_g * f.calories_per_100g / 100), 0) AS calories,
        COALESCE(SUM(mf.amount_g * f.protein_per_100g  / 100), 0) AS protein
      FROM meals m
      JOIN meal_foods mf ON mf.meal_id = m.id
      JOIN foods f ON f.id = mf.food_id
      WHERE m.user_id=? AND substr(m.logged_at,1,10)=?
    `).get(req.userId, today);

    const calRemaining  = Math.round(ranges.cal_low  - logged.calories);
    const protRemaining = Math.round(ranges.prot_low - logged.protein);

    if (calRemaining <= 0 && protRemaining <= 0) {
      return res.json({ suggestions: [], calRemaining, protRemaining });
    }

    // Foods the user has previously logged — deduplicated by name, using their usual serving size
    const userFoods = db.prepare(`
      SELECT MIN(f.id) AS id, f.name, f.brand,
             AVG(f.calories_per_100g) AS calories_per_100g,
             AVG(f.protein_per_100g)  AS protein_per_100g,
             AVG(f.carbs_per_100g)    AS carbs_per_100g,
             AVG(f.fat_per_100g)      AS fat_per_100g,
             COUNT(mf.id)             AS times_logged,
             ROUND(AVG(mf.amount_g))  AS avg_amount_g
      FROM foods f
      JOIN meal_foods mf ON mf.food_id = f.id
      JOIN meals m ON m.id = mf.meal_id
      WHERE m.user_id=?
      GROUP BY lower(f.name)
      ORDER BY times_logged DESC
      LIMIT 30
    `).all(req.userId);

    if (!userFoods.length) {
      return res.json({ suggestions: [], calRemaining, protRemaining });
    }

    const suggestions = userFoods.map(food => {
      // Use the user's own average serving size for this food
      const g = Math.max(25, Math.round((food.avg_amount_g || 100) / 25) * 25);

      const scale   = g / 100;
      const addCal  = +(food.calories_per_100g * scale).toFixed(0);
      const addProt = +(food.protein_per_100g  * scale).toFixed(1);

      // Score: protein contribution weighted most, then calorie fit, then familiarity
      const protScore = protRemaining > 0 ? addProt / Math.max(protRemaining, 1) : 0;
      const calFit    = calRemaining  > 0
        ? 1 - Math.min(Math.abs(addCal - calRemaining * 0.4) / (calRemaining * 0.4 + 1), 1)
        : 0;
      const score = protScore * 0.6 + calFit * 0.3 + Math.min(food.times_logged * 0.02, 0.1);

      return { id: food.id, name: food.name, brand: food.brand, suggested_g: g, added_calories: addCal, added_protein: addProt, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

    res.json({ suggestions, calRemaining, protRemaining });
  });

  // ─── GOALS ────────────────────────────────────────────────────────────────
  app.get('/api/goals', (req, res) => {
    res.json(db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY created_at DESC').all(req.userId));
  });

  app.post('/api/goals', (req, res) => {
    const { type, target_value, unit, deadline } = req.body;
    const r = db.prepare(
      'INSERT INTO goals (user_id, type, target_value, unit, deadline) VALUES (?, ?, ?, ?, ?)'
    ).run(req.userId, type, target_value, unit, deadline || null);
    res.json(db.prepare('SELECT * FROM goals WHERE id=?').get(r.lastInsertRowid));
  });

  app.patch('/api/goals/:id', (req, res) => {
    const { achieved } = req.body;
    db.prepare('UPDATE goals SET achieved=? WHERE id=? AND user_id=?').run(achieved ? 1 : 0, req.params.id, req.userId);
    res.json({ ok: true });
  });

  app.delete('/api/goals/:id', (req, res) => {
    db.prepare('DELETE FROM goals WHERE id=? AND user_id=?').run(req.params.id, req.userId);
    res.json({ ok: true });
  });

  // ─── PROGRESS ─────────────────────────────────────────────────────────────
  app.get('/api/progress/exercise/:id', (req, res) => {
    res.json(db.prepare(`
      SELECT w.started_at as date, MAX(ws.weight_kg) as max_weight, SUM(ws.reps * ws.weight_kg) as volume
      FROM workout_sets ws
      JOIN workouts w ON w.id = ws.workout_id
      WHERE ws.exercise_id=? AND w.user_id=?
      GROUP BY substr(w.started_at,1,10)
      ORDER BY w.started_at ASC
      LIMIT 30
    `).all(req.params.id, req.userId));
  });

  app.get('/api/progress/macros', (req, res) => {
    res.json(db.prepare(`
      SELECT substr(m.logged_at,1,10) as date,
        ROUND(SUM(mf.amount_g * f.calories_per_100g / 100), 1) as calories,
        ROUND(SUM(mf.amount_g * f.protein_per_100g / 100), 1) as protein,
        ROUND(SUM(mf.amount_g * f.carbs_per_100g / 100), 1) as carbs,
        ROUND(SUM(mf.amount_g * f.fat_per_100g / 100), 1) as fat
      FROM meals m
      JOIN meal_foods mf ON mf.meal_id = m.id
      JOIN foods f ON f.id = mf.food_id
      WHERE m.user_id=?
      GROUP BY substr(m.logged_at,1,10)
      ORDER BY date ASC
      LIMIT 30
    `).all(req.userId));
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`MeCros running → http://localhost:${PORT}`));

}).catch(err => {
  console.error('Failed to initialise database:', err);
  process.exit(1);
});
