const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'gymtracker.db');

function createWrapper(sqlDb) {
  function save() {
    fs.writeFileSync(DB_PATH, Buffer.from(sqlDb.export()));
  }

  function prepare(sql) {
    return {
      run(...args) {
        sqlDb.run(sql, args);
        const res = sqlDb.exec('SELECT last_insert_rowid()');
        save();
        return { lastInsertRowid: res[0]?.values[0][0] };
      },
      get(...args) {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(args);
        const row = stmt.step() ? stmt.getAsObject() : undefined;
        stmt.free();
        return row;
      },
      all(...args) {
        const stmt = sqlDb.prepare(sql);
        stmt.bind(args);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free();
        return rows;
      }
    };
  }

  function exec(sql) {
    sqlDb.exec(sql);
    save();
  }

  function pragma(str) {
    sqlDb.run('PRAGMA ' + str);
  }

  return { prepare, exec, pragma };
}

async function initDb() {
  const SQL = await initSqlJs();
  const sqlDb = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  const db = createWrapper(sqlDb);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      token TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS body_weight (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      weight_kg REAL NOT NULL,
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL,
      muscle_group TEXT NOT NULL,
      equipment TEXT NOT NULL DEFAULT 'Barbell',
      instructions TEXT
    );

    CREATE TABLE IF NOT EXISTS workouts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      notes TEXT,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS workout_sets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_id INTEGER NOT NULL,
      exercise_id INTEGER NOT NULL,
      set_number INTEGER NOT NULL,
      reps INTEGER,
      weight_kg REAL,
      duration_sec INTEGER,
      notes TEXT,
      FOREIGN KEY (workout_id) REFERENCES workouts(id),
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS personal_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      exercise_id INTEGER NOT NULL,
      weight_kg REAL NOT NULL,
      reps INTEGER NOT NULL,
      achieved_at TEXT NOT NULL DEFAULT (datetime('now')),
      workout_id INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (exercise_id) REFERENCES exercises(id)
    );

    CREATE TABLE IF NOT EXISTS foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      brand TEXT,
      calories_per_100g REAL NOT NULL,
      protein_per_100g REAL NOT NULL,
      carbs_per_100g REAL NOT NULL,
      fat_per_100g REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS meals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      logged_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS meal_foods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meal_id INTEGER NOT NULL,
      food_id INTEGER NOT NULL,
      amount_g REAL NOT NULL,
      qty INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (meal_id) REFERENCES meals(id),
      FOREIGN KEY (food_id) REFERENCES foods(id)
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id INTEGER PRIMARY KEY,
      display_name TEXT NOT NULL,
      height_cm REAL NOT NULL,
      weight_lbs REAL NOT NULL,
      activity_level TEXT NOT NULL,
      goal TEXT NOT NULL,
      daily_calories INTEGER NOT NULL,
      daily_protein INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      target_value REAL NOT NULL,
      unit TEXT NOT NULL,
      deadline TEXT,
      achieved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migrations
  try { db.prepare('ALTER TABLE meal_foods ADD COLUMN qty INTEGER NOT NULL DEFAULT 1').run(); } catch {}
  try { db.prepare("ALTER TABLE user_profiles ADD COLUMN gender TEXT NOT NULL DEFAULT 'male'").run(); } catch {}

  // Seed exercise library
  const exCount = db.prepare('SELECT COUNT(*) as c FROM exercises').get();
  if (exCount.c === 0) {
    const ins = db.prepare(
      'INSERT INTO exercises (name, category, muscle_group, equipment, instructions) VALUES (?, ?, ?, ?, ?)'
    );
    const exercises = [
      ['Barbell Back Squat', 'Strength', 'Legs', 'Barbell', 'Stand with bar on traps, squat until thighs are parallel to floor, drive through heels to stand.'],
      ['Romanian Deadlift', 'Strength', 'Hamstrings', 'Barbell', 'Hinge at hips with soft knees, lower bar along legs, feel hamstring stretch, drive hips forward.'],
      ['Bench Press', 'Strength', 'Chest', 'Barbell', 'Lie on bench, lower bar to chest with elbows at ~75°, press to lockout.'],
      ['Overhead Press', 'Strength', 'Shoulders', 'Barbell', 'Press bar from shoulders overhead to lockout, keep core tight.'],
      ['Deadlift', 'Strength', 'Back', 'Barbell', 'Hip-width stance, grip just outside legs, drive floor away, lock hips and knees at top.'],
      ['Pull-up', 'Strength', 'Back', 'Bodyweight', 'Hang from bar, pull chest to bar, control the descent.'],
      ['Dumbbell Row', 'Strength', 'Back', 'Dumbbell', 'Brace on bench, row dumbbell to hip, squeeze at top.'],
      ['Incline Dumbbell Press', 'Strength', 'Chest', 'Dumbbell', 'Set bench 30-45°, press dumbbells from chest to lockout.'],
      ['Leg Press', 'Strength', 'Legs', 'Machine', 'Place feet shoulder-width on platform, press to near lockout, lower under control.'],
      ['Lat Pulldown', 'Strength', 'Back', 'Cable', 'Pull bar to upper chest, lead with elbows, control return.'],
      ['Cable Row', 'Strength', 'Back', 'Cable', 'Sit tall, pull handle to stomach, squeeze shoulder blades.'],
      ['Tricep Pushdown', 'Isolation', 'Triceps', 'Cable', 'Elbows tucked, push handle down to lockout, slow return.'],
      ['Bicep Curl', 'Isolation', 'Biceps', 'Dumbbell', 'Curl weight to shoulder, squeeze, lower slowly.'],
      ['Leg Curl', 'Isolation', 'Hamstrings', 'Machine', 'Curl legs toward glutes, hold briefly, lower slowly.'],
      ['Calf Raise', 'Isolation', 'Calves', 'Machine', 'Full range of motion, pause at top and bottom.'],
      ['Face Pull', 'Isolation', 'Shoulders', 'Cable', 'Pull rope to face level, rotate wrists out at end.'],
      ['Lateral Raise', 'Isolation', 'Shoulders', 'Dumbbell', 'Raise dumbbells to shoulder height with slight elbow bend.'],
      ['Plank', 'Core', 'Core', 'Bodyweight', 'Hold straight line from head to heels, brace core.'],
      ['Running', 'Cardio', 'Full Body', 'Bodyweight', 'Steady state or interval running.'],
      ['Rowing Machine', 'Cardio', 'Full Body', 'Machine', 'Drive with legs first, lean back, pull handle to lower chest.'],
    ];
    exercises.forEach(e => ins.run(...e));
  }

  // Seed common foods
  const foodCount = db.prepare('SELECT COUNT(*) as c FROM foods').get();
  if (foodCount.c === 0) {
    const ins = db.prepare(
      'INSERT INTO foods (name, brand, calories_per_100g, protein_per_100g, carbs_per_100g, fat_per_100g) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const foods = [
      ['Chicken Breast (cooked)', null, 165, 31, 0, 3.6],
      ['White Rice (cooked)', null, 130, 2.7, 28, 0.3],
      ['Broccoli', null, 34, 2.8, 7, 0.4],
      ['Whole Eggs', null, 155, 13, 1.1, 11],
      ['Oats', null, 389, 17, 66, 7],
      ['Greek Yogurt', null, 59, 10, 3.6, 0.4],
      ['Banana', null, 89, 1.1, 23, 0.3],
      ['Sweet Potato', null, 86, 1.6, 20, 0.1],
      ['Salmon (cooked)', null, 208, 20, 0, 13],
      ['Cottage Cheese', null, 98, 11, 3.4, 4.3],
      ['Almonds', null, 579, 21, 22, 50],
      ['Beef (lean mince)', null, 215, 26, 0, 12],
      ['Whey Protein', 'Generic', 400, 80, 5, 7],
      ['Pasta (cooked)', null, 131, 5, 25, 1.1],
      ['Bread (whole wheat)', null, 247, 13, 41, 4],
    ];
    foods.forEach(f => ins.run(...f));
  }

  return db;
}

module.exports = initDb;
