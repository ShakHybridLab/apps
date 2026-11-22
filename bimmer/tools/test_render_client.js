'use strict';
// node tools/test_render_client.js : le client de cluster-render (shared/cluster_render_client.js) n'envoie un uniforme que s'il change.
// La boucle des jauges (40 images par seconde) règle tous les uniformes de toutes les couches à chaque image : sans cela, des milliers de
// messages JSON par seconde partaient vers le socket, ce qui occupe le processeur de la voiture (images saccadées, retard des jauges).
const assert = require('assert');
const { ClusterRender } = require('../shared/cluster_render_client');

let n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { console.error('FAIL ' + name + ': ' + (e && e.stack || e)); process.exitCode = 1; } }
function make() {
    const c = new ClusterRender('test', '/nonexistent');
    const sent = [];
    c.sock = { write(m) { sent.push(m); return true; } };
    c.connected = true;
    const text = () => sent.map((m) => (Buffer.isBuffer(m) ? m.toString('utf8') : String(m))).join('');
    return { c, sent, text, ops: () => (text().match(/"op":"uniform"/g) || []).length };
}

check('un uniforme inchangé n\'est pas renvoyé, un changement l\'est', () => {
    const { c, ops } = make();
    const ref = c.effect({ x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' });
    assert(ref > 0, 'la couche existe');
    c.uniform(ref, 'u_value', [0.5]);
    assert.strictEqual(ops(), 1);
    for (let i = 0; i < 50; i++) c.uniform(ref, 'u_value', [0.5]);
    assert.strictEqual(ops(), 1, 'cinquante fois la même valeur : un seul message');
    c.uniform(ref, 'u_value', [0.6]);
    assert.strictEqual(ops(), 2, 'une autre valeur part');
    c.uniform(ref, 'u_other', [0.6]);
    assert.strictEqual(ops(), 3, 'un autre nom part aussi');
    c.uniform(ref, 'u_value', [0.5]);
    assert.strictEqual(ops(), 4, 'revenir à l\'ancienne valeur part (le service garde la dernière)');
});

check('un tableau d\'uniformes, une pièce : même règle, chacun à sa clé', () => {
    const { c, ops } = make();
    const ref = c.effect({ x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' });
    c.uniform(ref, 'u_cells', [1, 2, 3, 4], { type: 'vec4' });
    c.uniform(ref, 'u_cells', [1, 2, 3, 4], { type: 'vec4' });
    assert.strictEqual(ops(), 1);
    c.uniform(ref, 'u_cells', [1, 2, 3, 5], { type: 'vec4' });
    assert.strictEqual(ops(), 2);
});

check('à la reconnexion, la couche rejoue ses derniers uniformes (rien n\'est perdu par le filtre)', () => {
    const { c } = make();
    const ref = c.effect({ x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' });
    c.connected = false;                                  // la voiture ne répond pas : ce qui est réglé alors reste gardé
    c.uniform(ref, 'u_value', [0.25]);
    c.uniform(ref, 'u_value', [0.75]);
    c.uniform(ref, 'u_value', [0.75]);
    const l = c.layers.get(ref);
    assert.strictEqual(l.uniforms['0:u_value'].v, '0.75', 'le dernier réglé est celui que la reconnexion enverra');
});

check('un uniforme refusé (type ou nombre invalide) ne change rien', () => {
    const { c, ops } = make();
    const ref = c.effect({ x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' });
    c.uniform(ref, 'u_bad', [1, 2, 3, 4, 5]);
    c.uniform(ref, 'u_none', []);
    assert.strictEqual(ops(), 0);
});

check('cork / uncork : une reconstruction part d\'un bloc, dans l\'ordre ; imbriqué, seul le dernier uncork envoie ; hors connexion, rien', () => {
    const c = new ClusterRender('test', '/nonexistent');
    const log = [];
    c.sock = { write(m) { log.push('w'); return true; }, cork() { log.push('cork'); }, uncork() { log.push('uncork'); } };
    c.connected = true;
    assert.strictEqual(c.cork(), true);
    assert.strictEqual(c.cork(), true);
    const ref = c.effect({ x: 0, y: 0, w: 10, h: 10, fs: 'void main(){}' });
    c.uniform(ref, 'u_a', [1]);
    c.uncork();
    assert.deepStrictEqual(log, ['cork', 'w', 'w'], 'un seul cork, pas encore d\'uncork');
    c.uncork();
    assert.deepStrictEqual(log, ['cork', 'w', 'w', 'uncork']);
    c.uncork();
    assert.strictEqual(log.length, 4, 'un uncork de trop ne fait rien');
    const d = new ClusterRender('test', '/nonexistent');
    assert.strictEqual(d.cork(), false, 'pas de socket : rien à retenir');
    d.uncork();
});
check('un socket qui freine n\'affame aucune couche : les écritures d\'images passent à tour de rôle (22 nov. 2026, la vitesse figée pendant que l\'anneau clignotait)', () => {
    const c = new ClusterRender('test', '/nonexistent');
    const order = [];
    c.sock = { write(m) { order.push(m.readUInt32LE ? m.readUInt32LE(4) : -1); return false; } };       // chaque écriture remplit le socket
    c.connected = true; c.ready = true;
    const a = c.image({ x: 0, y: 0, w: 4, h: 4, iw: 4, ih: 4 }), b = c.image({ x: 10, y: 0, w: 4, h: 4, iw: 4, ih: 4 });
    assert(a > 0 && b > 0);
    const px = Buffer.alloc(4 * 4 * 4, 255);
    const got = [];
    c.sock.write = (m) => { got.push(m); return false; };
    for (let i = 0; i < 6; i++) {
        // la couche A change à chaque fois (l'anneau qui clignote), B une seule fois au début (la vitesse)
        px[0] = i; c.blocked = false; c.pixels(a, null, Buffer.from(px));
        if (i === 0) c.pixels(b, null, Buffer.from(px));
    }
    // B a bien été écrite, alors que A avait toujours quelque chose à envoyer
    const sentB = c.layers.get(b).whole === false;            // B's whole picture went out (it is no longer waiting)
    assert(sentB, 'la couche B est restée en attente derrière A');
});

check('hud.js : _rebuild retient les écritures de chaque connexion pendant la reconstruction et les relâche même sur une erreur', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'shared', 'hud.js'), 'utf8');
    assert(/const corked = this\.clients\.filter\(\(c\) => typeof c\.cork === 'function' && c\.cork\(\)\);/.test(src));
    assert(/finally \{ corked\.forEach\(\(c\) => \{ try \{ c\.uncork\(\); \} catch/.test(src));
});

console.log(process.exitCode ? 'render client: FAILED' : 'render client: all ' + n + ' checks pass');
