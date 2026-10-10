// Staff roles, lowest to highest. Each role can do everything the roles below it can.
//   support: read users, stats and payments; answer support requests
//   admin:   also manage tasks, bans, upgrades, announcements, fraud checks, economics and the audit log
//   owner:   also change balances, settings, staff roles, and export user data
const RANKS = { user: 0, support: 1, admin: 2, owner: 3 };
const STAFF_ROLES = ['support', 'admin', 'owner'];

const rank = (role) => RANKS[role] ?? 0;
const isStaff = (role) => rank(role) >= RANKS.support;
const atLeast = (role, min) => rank(role) >= RANKS[min];

module.exports = { RANKS, STAFF_ROLES, rank, isStaff, atLeast };
