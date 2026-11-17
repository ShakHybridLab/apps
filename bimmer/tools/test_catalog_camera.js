'use strict';
// Les pages « Caméras » du catalogue (shared/catalog.js) sur un faux catalogue : tout ce que CameraProxy et ICAM2Proxy ont (champs, méthodes,
// diffusions), sur deux pages de 8 rangées, et rien d'une autre interface. Lancer : node tools/test_catalog_camera.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const catalog = require('../shared/catalog');

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e.stack || e.message)); process.exitCode = 1; } }

const methods = {};
for (let i = 0; i < 6; i++) methods['request' + i] = { id: 10 + i, in: [{ name: 'camera', dataRef: 'T.Cam' }, { name: 'mode', dataRef: 'T.Mode' }], out: [{ name: 'streamId', dataRef: 'T.Stream' }] };
const db = {
    datatypes: { 'T.Cam': { type: 'struct', members: [{ name: 'position' }, { name: 'view' }] }, 'T.Mode': { type: 'struct', members: [{ name: 'width' }, { name: 'height' }] }, 'T.Stream': { type: 'struct', members: [{ name: 'name' }, { name: 'port' }] } },
    interfaces: {
        'de.bmw.infotainment.video.cameraproxy.CameraProxy': { id: 4242, major: 1, fields: { statusCamera: { dataRef: 'T.Cam', getter: { id: 1 }, notifier: { id: 2 } } }, methods, broadcasts: { cameraChanged: { id: 7, args: [{ name: 'state', dataRef: 'T.Cam' }] } } },
        'de.bmw.infotainment.video.cameraproxy.ICAM2Proxy': { fields: { statusCam2: { dataRef: 'T.Mode', notifier: { id: 3 } } } },
        'de.bmw.infotainment.vehicle.Vehicle2': { fields: { statusCarSpeed2: { dataRef: 'T.Mode', notifier: { id: 5 } } } },
    },
};
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cc-')), 'catalog.json');
fs.writeFileSync(file, JSON.stringify(db));
const cat = catalog.find(file);
const cam = cat.groups.find((g) => g.id === 'camera'), cam2 = cat.groups.find((g) => g.id === 'camera2');

check('deux pages caméra, de MAX_ROWS rangées au plus, sans erreur', () => {
    assert.strictEqual(cat.error, null);
    assert(cam && cam2, 'groupes absents');
    assert.strictEqual(cam.rows.length, catalog.MAX_ROWS);
    assert(cam2.rows.length > 0 && cam2.rows.length <= catalog.MAX_ROWS);
});
check('rien de l\'interface de la vitesse, et chaque rangée n\'est qu\'une fois, d\'une page ou de l\'autre', () => {
    const all = cam.rows.concat(cam2.rows);
    assert(all.every((r) => /cameraproxy|ICAM2/i.test(r.iface)), 'une autre interface');
    const keys = all.map((r) => r.iface + '|' + r.field);
    assert.strictEqual(new Set(keys).size, keys.length, 'une rangée en double');
    // CameraProxy : 1 (interface) + 1 champ + 6 méthodes + 1 diffusion = 9 ; ICAM2Proxy : 1 champ (rien de simple, pas de rangée « interface ») = 10
    assert.strictEqual(all.length, 10);
});
check('les méthodes, leurs arguments entrants et sortants, les diffusions et les champs y sont', () => {
    const all = cam.rows.concat(cam2.rows);
    const m = all.find((r) => r.field === 'methods.request0');
    assert(m && m.flags === 'methods', 'méthode absente');
    const mem = m.members.join(' ');
    assert(/in:camera\{position\/view\}/.test(mem) && /in:mode\{width\/height\}/.test(mem) && /out:streamId\{name\/port\}/.test(mem), mem);
    assert(all.find((r) => r.field === 'broadcasts.cameraChanged'), 'diffusion absente');
    const f = all.find((r) => r.field === 'fields.statusCamera');
    assert(f && f.flags === 'get notify', 'champ absent ou mal marqué');
    assert(all.find((r) => r.field === '(interface)').members.join(' ').indexOf('id=4242') >= 0, 'l\'identifiant de l\'interface');
});
check('les autres groupes ne changent pas : aucun ne reçoit les interfaces caméra', () => {
    cat.groups.filter((g) => !/^camera/.test(g.id)).forEach((g) => assert(g.rows.every((r) => !/cameraproxy|ICAM2/i.test(r.iface)), g.id));
});
check('un catalogue illisible : les groupes caméra existent, vides, avec l\'erreur', () => {
    const bad = catalog.find(path.join(os.tmpdir(), 'nope-' + Date.now() + '.json'));
    assert(bad.error && bad.groups.some((g) => g.id === 'camera' && g.rows.length === 0));
});
console.log(process.exitCode ? 'catalogue caméra : ÉCHECS' : 'catalogue caméra : ' + n + ' vérifications passent');
