// Game rules and constants. Everything that affects how many tokens people earn lives here.
const cfg = require('./config');

const MS_DAY = 86400000;

const PLANS = [
  { id: 0, name: 'Free', priceUsdt: 0, tasksPerDay: 5 },
  { id: 1, name: 'Plus', priceUsdt: 5, tasksPerDay: 10 },
  { id: 2, name: 'Pro', priceUsdt: 15, tasksPerDay: 20 },
  { id: 3, name: 'VIP', priceUsdt: 30, tasksPerDay: 40 },
];
const PLAN_DAYS = 30;

const LEVELS = [
  { name: 'Bronze', min: 0, boost: 0 },
  { name: 'Silver', min: 500, boost: 0.05 },
  { name: 'Gold', min: 2000, boost: 0.1 },
  { name: 'Platinum', min: 10000, boost: 0.15 },
];

const SPIN_PRIZES = [2, 5, 10, 5, 20, 10, 50];
const BONUS = { allDone: 25, referral: 50, streakBase: 5, streakCapDays: 7 };
const MAX_TASKS_PER_HOUR = 5;
const MIN_QUIZ_READ_MS = 1500; // answering a question faster than this after the timer ends is treated as a bot

const CHALLENGES = [
  { id: 0, title: 'Finish 20 tasks', target: 20, reward: 100, metric: 'tasks' },
  { id: 1, title: 'Claim your streak bonus on 5 days', target: 5, reward: 50, metric: 'streakClaims' },
  { id: 2, title: 'Earn 300 WTC', target: 300, reward: 75, metric: 'earned' },
];

const ACHIEVEMENTS = [
  { key: 'first', title: 'First task', desc: 'Finish any task' },
  { key: 't10', title: '10 tasks', desc: 'Finish 10 tasks' },
  { key: 's3', title: '3-day streak', desc: 'Reach a 3-day streak' },
  { key: 's7', title: '7-day streak', desc: 'Reach a 7-day streak' },
  { key: 'ref', title: 'Recruiter', desc: 'A friend you invited finished a task' },
  { key: 'spin', title: 'Lucky', desc: 'Spin the wheel' },
  { key: 'k1', title: '1,000 WTC', desc: 'Earn 1,000 WTC in total' },
  { key: 'gold', title: 'Gold level', desc: 'Reach Gold level' },
];

const shift = (t) => t + cfg.tzOffsetMin * 60000;
const dayKey = (t = Date.now()) => new Date(shift(t)).toISOString().slice(0, 10);
const dayStart = (t = Date.now()) => {
  const d = new Date(shift(t));
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - cfg.tzOffsetMin * 60000;
};
const weekStart = (t = Date.now()) => {
  const s = dayStart(t);
  const dow = (new Date(shift(s)).getUTCDay() + 6) % 7; // Monday = 0
  return s - dow * MS_DAY;
};

function levelFor(lifetime) {
  let i = 0;
  LEVELS.forEach((l, j) => { if (lifetime >= l.min) i = j; });
  return { ...LEVELS[i], next: LEVELS[i + 1] || null };
}

const activePlan = (u) => (u.plan > 0 && u.plan_exp > Date.now() ? u.plan : 0);

// Tokens a user earns for one task: base, doubled during a promotion, plus their level boost.
const rewardFor = (task, user) =>
  Math.round(task.tokens * (task.double_until > Date.now() ? 2 : 1) * (1 + levelFor(user.lifetime).boost));

const toUsdt = (wtc, price) => Number((wtc * price).toFixed(6));

module.exports = {
  MS_DAY, PLANS, PLAN_DAYS, LEVELS, SPIN_PRIZES, BONUS, MAX_TASKS_PER_HOUR, MIN_QUIZ_READ_MS,
  CHALLENGES, ACHIEVEMENTS, dayKey, dayStart, weekStart, levelFor, activePlan, rewardFor, toUsdt,
};
