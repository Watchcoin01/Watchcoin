// Video clips for the prize-wheel animals, uploaded from the admin dashboard.
// Files live next to the database (on the Railway volume), so they survive redeploys.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cfg = require('./config');
const { getSetting, setSetting } = require('./db');

const DIR = process.env.MEDIA_DIR
  || (cfg.dbPath === ':memory:' ? path.join(os.tmpdir(), `watchcoin-media-${process.pid}`) : path.join(path.dirname(path.resolve(cfg.dbPath)), 'media'));
fs.mkdirSync(DIR, { recursive: true });

const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = { 'video/mp4': 'mp4', 'video/webm': 'webm' };
const ANIMALS = ['dragon', 'lion', 'eagle', 'croc', 'wolf', 'bull', 'goat'];

const list = () => { try { return JSON.parse(getSetting('wheel_media', '{}')); } catch { return {}; } };
const urlFor = (m) => `/media/${m.file}`;
// { dragon: '/media/dragon-abc.mp4', ... } for the animals that have a clip.
const urls = () => Object.fromEntries(Object.entries(list()).map(([a, m]) => [a, urlFor(m)]));

// Checks the first bytes, so a renamed file of another kind is refused.
function looksLike(type, buf) {
  if (type === 'video/mp4') return buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp';
  if (type === 'video/webm') return buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3;
  return false;
}

function save(animal, type, buf) {
  const ext = TYPES[type];
  const file = `${animal}-${crypto.randomBytes(5).toString('hex')}.${ext}`; // new name each time, so phones never keep an old copy
  const tmp = path.join(DIR, `.${file}.tmp`);
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, path.join(DIR, file));
  const all = list(), old = all[animal];
  all[animal] = { file, type, size: buf.length, uploadedAt: Date.now() };
  setSetting('wheel_media', JSON.stringify(all));
  if (old) fs.rm(path.join(DIR, old.file), { force: true }, () => {});
  return all[animal];
}

function remove(animal) {
  const all = list(), old = all[animal];
  if (!old) return false;
  delete all[animal];
  setSetting('wheel_media', JSON.stringify(all));
  fs.rm(path.join(DIR, old.file), { force: true }, () => {});
  return true;
}

module.exports = { DIR, MAX_BYTES, TYPES, ANIMALS, list, urls, urlFor, looksLike, save, remove };
