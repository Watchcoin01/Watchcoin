process.env.NODE_ENV = 'test';
process.env.DB_PATH = ':memory:';
process.env.ADMIN_EMAIL = 'admin@test.com';
process.env.MAX_ACCOUNTS_PER_IP = '50';
process.env.JWT_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createApp } = require('../src/server');
const { db } = require('../src/db');

let server, root, admin, ama;
before(() => new Promise((resolve) => { server = createApp().listen(0, () => { root = `http://127.0.0.1:${server.address().port}`; resolve(); }); }));
after(() => server.close());

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${root}/api${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
const signup = async (name, email) => (await call('POST', '/auth/signup', { body: { name, email, password: 'secret1' } })).body;
const PIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const dataUrl = (buf, type = 'jpeg') => `data:image/${type};base64,${buf.toString('base64')}`;
const A = (m, p, body) => call(m, p, { token: admin.token, body });
const base = { type: 'like', title: 'With cover', url: 'https://youtu.be/abc', tokens: 10, secs: 10 };

test('a cover picture is saved, and tasks hand out a small link instead of the picture itself', async () => {
  admin = await signup('Boss', 'admin@test.com'); ama = await signup('Ama', 'ama@test.com');
  db.prepare('UPDATE tasks SET active=0').run();
  const r = await A('POST', '/admin/tasks', { ...base, cover: dataUrl(PIC) });
  assert.equal(r.status, 201);
  assert.equal(r.body.task.hasCover, true); assert.equal(r.body.task.cover, undefined);
  assert.match(r.body.task.coverUrl, /^\/api\/covers\/\d+\?v=\d+$/);

  const list = await A('GET', '/admin/tasks');
  assert.equal(list.body.tasks.find((t) => t.id === r.body.task.id).cover, undefined); // the admin list stays light

  const mine = await call('GET', '/tasks', { token: ama.token });
  assert.equal(mine.body.tasks[0].cover, r.body.task.coverUrl); // people get a link, not the picture bytes
});

test('the cover is served as a real image that browsers can keep', async () => {
  const id = db.prepare('SELECT id FROM tasks WHERE cover!=?').get('').id;
  const img = await fetch(`${root}/api/covers/${id}`); // no login needed
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  assert.match(img.headers.get('cache-control'), /public/);
  assert.equal(img.headers.get('cross-origin-resource-policy'), 'cross-origin'); // so the admin dashboard can show it
  assert.deepEqual(Buffer.from(await img.arrayBuffer()), PIC);
  const etag = img.headers.get('etag');
  // A browser that already has the picture asks "has it changed?" and gets a tiny "no" back. (Plain http here, because fetch adds a no-cache header.)
  const status = await new Promise((resolve) => require('node:http').get(`${root}/api/covers/${id}`, { headers: { 'if-none-match': etag } }, (res) => { res.resume(); resolve(res.statusCode); }));
  assert.equal(status, 304);
  assert.equal((await fetch(`${root}/api/covers/99999`)).status, 404);
  assert.equal((await fetch(`${root}/api/covers/abc`)).status, 404);
});

test('only normal pictures are accepted', async () => {
  const svg = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64')}`;
  assert.equal((await A('POST', '/admin/tasks', { ...base, cover: svg })).status, 400); // SVG can carry scripts
  assert.equal((await A('POST', '/admin/tasks', { ...base, cover: 'data:image/jpeg;base64,not base64!' })).status, 400);
  assert.equal((await A('POST', '/admin/tasks', { ...base, cover: 'https://evil.example/x.jpg' })).status, 400);
  assert.equal((await A('POST', '/admin/tasks', { ...base, cover: dataUrl(Buffer.alloc(160000)) })).status, 400); // too big
  assert.equal((await A('POST', '/admin/tasks', { ...base, cover: dataUrl(PIC, 'png') })).status, 201);
  assert.equal((await A('POST', '/admin/tasks', { ...base, cover: dataUrl(PIC, 'webp') })).status, 201);
});

test('editing keeps, replaces or removes the cover, and the link changes when the picture does', async () => {
  const t = (await A('POST', '/admin/tasks', { ...base, title: 'Editable', cover: dataUrl(PIC) })).body.task;
  let r = await A('PATCH', `/admin/tasks/${t.id}`, { title: 'Renamed only' });
  assert.equal(r.body.task.coverUrl, t.coverUrl); // other edits leave the picture alone
  assert.equal(db.prepare('SELECT cover FROM tasks WHERE id=?').get(t.id).cover, dataUrl(PIC));

  await new Promise((res) => setTimeout(res, 5));
  const other = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9]);
  r = await A('PATCH', `/admin/tasks/${t.id}`, { cover: dataUrl(other) });
  assert.notEqual(r.body.task.coverUrl, t.coverUrl); // new version, so browsers fetch the new picture
  assert.deepEqual(Buffer.from(await (await fetch(`${root}${r.body.task.coverUrl}`)).arrayBuffer()), other);

  r = await A('PATCH', `/admin/tasks/${t.id}`, { cover: '' });
  assert.equal(r.body.task.hasCover, false); assert.equal(r.body.task.coverUrl, '');
  assert.equal((await fetch(`${root}/api/covers/${t.id}`)).status, 404);
});

test('hiding a task hides its picture too', async () => {
  const t = (await A('POST', '/admin/tasks', { ...base, title: 'Hide me', cover: dataUrl(PIC) })).body.task;
  assert.equal((await fetch(`${root}/api/covers/${t.id}`)).status, 200);
  await A('DELETE', `/admin/tasks/${t.id}`);
  assert.equal((await fetch(`${root}/api/covers/${t.id}`)).status, 404);
});
