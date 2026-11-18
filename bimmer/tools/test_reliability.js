'use strict';
// node tools/test_reliability.js : ce qui garde les applis en vie et stables (18 nov. 2026).
//  - shared/survive.js : une erreur que personne n'a rattrapée est journalisée et comptée, l'appli continue (le kit, lui, sort, et sur la voiture
//    une sortie imprévue efface les réglages, la deuxième désinstalle l'appli) ;
//  - hud.js : _guard compte ses erreurs et ne remplit pas le journal ; deux reconstructions du thème sont espacées, la dernière demande est faite ;
//    les événements de cluster-render sont gardés ;
//  - cluster_render_client.js : un service qui ne dit pas bonjour ou ne lit plus est repris par une nouvelle connexion ;
//  - les minuteries des modules (Waze, zone de danger, limitation, écran partagé, Cluster Info) ne laissent pas sortir d'erreur.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const root = path.join(__dirname, '..');
let n = 0, failed = 0;
const later = [];
function check(name, fn) {
    try { const r = fn(); if (r && r.then) later.push(r.then(() => { n++; }, (e) => { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); })); else n++; }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reliab-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));
const survive = require(path.join(root, 'shared', 'survive.js'));
const hudSrc = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
const logOf = () => { const l = { lines: [] }; ['info', 'warn', 'error'].forEach((k) => { l[k] = (...a) => l.lines.push(k + ' ' + a.join(' ')); }); return l; };

check('survive : sur un bureau (personne n\'écoute), rien n\'est pris ; sur la voiture, l\'écoute du kit est remplacée et l\'erreur ne ferme rien', () => {
    const desk = new EventEmitter();
    const st0 = survive.install(logOf(), { proc: desk });
    assert.strictEqual(st0.on, false); assert.strictEqual(desk.listenerCount('uncaughtException'), 0, 'un bureau garde la façon de Node');
    const car = new EventEmitter(), log = logOf();
    let exited = 0;
    car.on('uncaughtException', () => { exited++; });                 // le kit : journal puis process.exit(1)
    const st = survive.install(log, { proc: car });
    assert.strictEqual(st.on, true); assert.strictEqual(car.listenerCount('uncaughtException'), 1, 'une seule écoute : la nôtre');
    car.emit('uncaughtException', new Error('boum'));
    assert.strictEqual(exited, 0, 'le kit ne sort plus');
    assert.deepStrictEqual([survive.state(car).n, survive.state(car).last], [1, 'boum']);
    assert(/uncaught \(the app keeps running\)/.test(log.lines[0]) && /boum/.test(log.lines[0]));
    assert.strictEqual(survive.install(log, { proc: car }), st, 'une seule installation par processus');
});
check('survive : une erreur qui se répète ne remplit pas le journal, et rien ne sort même si le journal casse', () => {
    const car = new EventEmitter(), log = logOf();
    car.on('uncaughtException', () => {});
    survive.install(log, { proc: car });
    for (let i = 0; i < 500; i++) car.emit('uncaughtException', new Error('encore'));
    assert.strictEqual(survive.state(car).n, 500);
    assert(log.lines.length <= survive.WHOLE + 1, 'lignes écrites : ' + log.lines.length);
    const bad = new EventEmitter(); bad.on('uncaughtException', () => {});
    survive.install({ error() { throw new Error('disque plein'); } }, { proc: bad });
    bad.emit('uncaughtException', 'x'); bad.emit('uncaughtException', null);
    assert.strictEqual(survive.state(bad).n, 2);
});
check('toutes les applis Shak installent survive.js en premier et l\'embarquent ; HUD Widgets n\'est pas touché', () => {
    fs.readdirSync(path.join(root, 'apps')).filter((a) => /^shak/.test(a)).forEach((a) => {
        const main = fs.readFileSync(path.join(root, 'apps', a, 'main.js'), 'utf8'), spec = JSON.parse(fs.readFileSync(path.join(root, 'apps', a, 'app.json'), 'utf8'));
        assert(/start\(ctx\) \{\n\s+require\('\.\/survive'\)\.install\(ctx\.log\);/.test(main), a + ' : survive n\'est pas la première chose de start()');
        assert(spec.shared.indexOf('survive.js') >= 0, a + ' : survive.js manque dans "shared"');
    });
    const w = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'idrive_hud_widgets', 'app.json'), 'utf8'));
    assert(w.shared.indexOf('survive.js') < 0);
    assert(!/require\('\.\/survive'\)/.test(hudSrc) && !/require\('\.\/survive'\)/.test(fs.readFileSync(path.join(root, 'shared', 'page.js'), 'utf8')), 'hud.js et page.js (partagés avec HUD Widgets) ne chargent pas survive.js');
});

function fakeHud() {
    const h = Object.create(HudApp.prototype);
    h.log = logOf();
    return h;
}
check('_guard : l\'erreur est comptée, écrite entière les premières fois puis au plus une ligne toutes les 10 s par endroit', () => {
    const h = fakeHud();
    for (let i = 0; i < 300; i++) h._guard('widget rev', () => { throw new Error('pas de valeur'); });
    h._guard('tick', () => { throw new Error('autre'); });
    const f = h.faultsShown();
    assert.strictEqual(f.n, 301); assert.strictEqual(f.last, 'tick: autre');
    assert(h.log.lines.length <= 5, 'lignes : ' + h.log.lines.length);
    assert.strictEqual(fakeHud().faultsShown(), null, 'rien à montrer sans erreur');
    let ran = 0; h._guard('ok', () => { ran++; }); assert.strictEqual(ran, 1);
});
check('les événements de cluster-render et les changements de réglages passent par _guard', () => {
    assert(/const on = \(name, fn\) => c\.on\(name, \(\.\.\.a\) => this\._guard\('cluster-render ' \+ name/.test(hudSrc));
    assert(!/\n\s+c\.on\('(ready|layer|target|refused|status|budget|disconnected)'/.test(hudSrc), 'un événement de cluster-render n\'est pas gardé');
    assert(/ctx\.settings\.onChange\(\(key\) => this\._guard\('setting ' \+ key/.test(hudSrc));
});

// la reconstruction : un faux moteur qui compte les _rebuildInner
function rebuildHud(started) {
    const h = fakeHud();
    h.started = started; h.clients = []; h.client = { ready: true }; h.inner = 0;
    h._rebuildInner = () => { h.inner++; };
    h._status = () => {};
    return h;
}
check('reconstruction : la première part tout de suite ; celles demandées dans les 400 ms n\'en font qu\'une, un peu plus tard', () => {
    const h = rebuildHud(true);
    h._rebuild(); assert.strictEqual(h.inner, 1, 'la première : tout de suite');
    for (let i = 0; i < 20; i++) h._rebuild();
    assert.strictEqual(h.inner, 1, 'rien d\'autre avant le délai'); assert(h.rebuildT, 'une seule est en attente');
    return wait(480).then(() => {
        assert.strictEqual(h.inner, 2, 'la demande en attente est faite une fois : ' + h.inner);
        assert(!h.rebuildT);
        return wait(450);
    }).then(() => { h._rebuild(); assert.strictEqual(h.inner, 3, 'le délai passé : tout de suite'); });
});
check('reconstruction : cluster-render revenu (now) passe devant le délai ; une appli pas démarrée (tests, outils) n\'attend jamais ; l\'horloge qui recule ne bloque rien', () => {
    const h = rebuildHud(true);
    h._rebuild(); h._rebuild(); assert(h.rebuildT);
    h._rebuild(true); assert.strictEqual(h.inner, 2); assert(!h.rebuildT, 'l\'attente est annulée : tout vient d\'être refait');
    const t = rebuildHud(false);
    t._rebuild(); t._rebuild(); t._rebuild(); assert.strictEqual(t.inner, 3);
    const c = rebuildHud(true);
    c.rebuiltAt = Date.now() + 3600000;                       // l'heure de la voiture a reculé d'une heure (recalage GPS)
    c._rebuild(); assert.strictEqual(c.inner, 1);
});
check('reconstruction : une erreur dedans ne sort pas, et les connexions sont toujours débouchées', () => {
    const h = rebuildHud(true);
    let corks = 0, uncorks = 0;
    h.clients = [{ cork() { corks++; return true; }, uncork() { uncorks++; } }, { cork() { return false; }, uncork() { uncorks += 10; } }];
    h._rebuildInner = () => { throw new Error('layout cassé'); };
    h._rebuild();
    assert.deepStrictEqual([corks, uncorks], [1, 1]);
    assert.strictEqual(h.faultsShown().n, 1);
});

check('couche refusée par cluster-render : le thème est refait un peu plus tard, trois fois au plus, et le compte repart après un thème passé entier', () => {
    const fast = path.join(tmp, 'shared', 'hud_fast.js');
    fs.writeFileSync(fast, hudSrc.replace('const REFUSED_RETRY_MS = [5000, 15000, 45000];', 'const REFUSED_RETRY_MS = [40, 40, 40];').replace('const REBUILD_MIN_MS = 400;', 'const REBUILD_MIN_MS = 5;'));
    const Fast = require(fast);
    const h = Object.create(Fast.prototype);
    h.log = logOf(); h.started = true; h.clients = []; h.client = { ready: true }; h._status = () => {};
    let inner = 0, refuse = true;
    h._rebuildInner = () => { inner++; if (!h.refused) h.refusedTries = 0; h.refused = null; if (refuse) setTimeout(() => { h.refused = 'sheet: memory'; h._retryRefused(); }, 5); };
    h._rebuild();
    return wait(600).then(() => {
        assert.strictEqual(inner, 4, 'la première et trois essais, pas plus : ' + inner);
        refuse = false; h._rebuild(true);                 // un changement de vue : cette fois tout passe
        return wait(100);
    }).then(() => {
        assert.strictEqual(inner, 5); assert.strictEqual(h.refused, null);
        refuse = true; h._rebuild(true);                  // plus tard, un nouveau refus : le compte est reparti de zéro
        return wait(600);
    }).then(() => { assert.strictEqual(inner, 9, 'trois nouveaux essais : ' + inner); clearTimeout(h.refusedT); });
});
check('couche refusée : le vrai _rebuildInner remet le compte à zéro quand le thème précédent est passé entier, et stop() annule l\'essai en attente', () => {
    assert(/if \(!this\.refused\) this\.refusedTries = 0;[^\n]*\n\s+this\.refused = null;/.test(hudSrc));
    assert(/if \(op === 'layer' \|\| op === 'asset'\) this\._retryRefused\(\);/.test(hudSrc));
    assert(/clearTimeout\(this\.refusedT\); this\.refusedT = null;/.test(hudSrc) && /clearTimeout\(this\.rebuildT\); this\.rebuildT = null;\n\s+clearTimeout\(this\.refusedT\)/.test(hudSrc));
});

// le client de cluster-render contre un faux service
const net = require('net');
function service(onConn) {
    const p = path.join(tmp, 'cr-' + Math.random().toString(36).slice(2) + '.sock');
    const srv = net.createServer(onConn);
    return new Promise((r) => srv.listen(p, () => r({ p, srv })));
}
check('client : un service qui prend la connexion sans dire bonjour est repris par une nouvelle connexion', () => {
    const crPath = path.join(tmp, 'shared', 'cluster_render_client.js');
    const src = fs.readFileSync(crPath, 'utf8').replace(/const HELLO_MS = \d+;/, 'const HELLO_MS = 150;');
    const fast = path.join(tmp, 'cr_fast.js'); fs.writeFileSync(fast, src);
    const { ClusterRender } = require(fast);
    let conns = 0;
    return service((s) => { conns++; s.on('error', () => {}); }).then(({ p, srv }) => {
        const c = new ClusterRender('t', p);
        c.connect();
        return wait(900).then(() => {
            c.close(); srv.close();
            assert(conns >= 2, 'connexions : ' + conns);
            assert.strictEqual(c.ready, false);
        });
    });
});
check('client : le bonjour arrivé, la garde est levée ; la fermeture remet le bouchon à zéro', () => {
    const { ClusterRender } = require(path.join(tmp, 'shared', 'cluster_render_client.js'));
    const hello = () => { const b = Buffer.from(JSON.stringify({ ev: 'hello', backend: 'x', targets: 'panel' })); const m = Buffer.alloc(5 + b.length); m.writeUInt32LE(b.length + 1, 0); m[4] = 0x4a; b.copy(m, 5); return m; };
    let socks = [];
    return service((s) => { socks.push(s); s.on('error', () => {}); s.write(hello()); }).then(({ p, srv }) => {
        const c = new ClusterRender('t', p);
        c.connect();
        return wait(150).then(() => {
            assert.strictEqual(c.ready, true); assert.strictEqual(c.helloTimer, null, 'la garde est levée');
            assert.strictEqual(c.cork(), true); assert.strictEqual(c.corked, 1);
            socks[0].destroy();
            return wait(100);
        }).then(() => {
            assert.strictEqual(c.corked, 0, 'le bouchon ne reste pas compté sur un socket fermé');
            c.uncork();                                      // l'appel du « finally » d'une reconstruction : sans effet, sans erreur
            return wait(400);
        }).then(() => {
            assert.strictEqual(c.ready, true, 'reconnecté');
            assert.strictEqual(c.cork(), true); c.uncork(); assert.strictEqual(c.corked, 0);
            c.close(); srv.close();
        });
    });
});
check('client : un service qui ne lit plus ne fait pas grossir la mémoire sans fin (au-delà de BACKLOG_MAX la connexion est refaite), sauf pendant un bouchon', () => {
    const { ClusterRender, BACKLOG_MAX } = require(path.join(tmp, 'shared', 'cluster_render_client.js'));
    assert(BACKLOG_MAX > 1920 * 720 * 4, 'au-dessus du plus gros message (une image entière)');
    const c = new ClusterRender('t', '/nonexistent');
    let destroyed = 0;
    c.sock = { bufferSize: BACKLOG_MAX + 1, write() { return false; }, destroy() { destroyed++; } };
    c.connected = true;
    c.corked = 1; c._send({ op: 'status' }); assert.strictEqual(destroyed, 0, 'bouché : une reconstruction attend là exprès');
    c.corked = 0; c._send({ op: 'status' }); assert.strictEqual(destroyed, 1);
    c.sock.bufferSize = 1024; c._send({ op: 'status' }); assert.strictEqual(destroyed, 1, 'une file courte : rien');
});

// un module chargé mais pas embarqué : l'appli ne démarre pas sur la voiture (HUD Widgets n'embarquait plus six modules que hud.js et page.js chargent)
check('chaque appli embarque tous les modules partagés que son code charge ("shared" de app.json)', () => {
    const reqs = (src) => { const out = []; const re = /require\('\.\/([A-Za-z0-9_]+)(?:\.js)?'\)/g; let m; while ((m = re.exec(src))) out.push(m[1] + '.js'); return out; };
    const bad = [];
    fs.readdirSync(path.join(root, 'apps')).forEach((a) => {
        const dir = path.join(root, 'apps', a);
        if (!fs.existsSync(path.join(dir, 'app.json')) || !fs.existsSync(path.join(dir, 'main.js'))) return;
        const spec = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8')), shared = spec.shared || [];
        const own = (f) => fs.existsSync(path.join(dir, f));
        const seen = {}, todo = reqs(fs.readFileSync(path.join(dir, 'main.js'), 'utf8'));
        while (todo.length) {
            const f = todo.pop();
            if (seen[f]) continue;
            seen[f] = true;
            if (own(f)) { reqs(fs.readFileSync(path.join(dir, f), 'utf8')).forEach((x) => todo.push(x)); continue; }
            if (!fs.existsSync(path.join(root, 'shared', f))) continue;                 // (un module du kit ou de Node)
            if (shared.indexOf(f) < 0) bad.push(a + ' : ' + f);
            reqs(fs.readFileSync(path.join(root, 'shared', f), 'utf8')).forEach((x) => todo.push(x));
        }
    });
    assert.deepStrictEqual(bad, []);
});

// l'horloge de la voiture qui recule (elle est réglée par la voiture, parfois après le démarrage des applis)
check('horloge qui recule d\'une heure : la carte Waze ne reste pas « ouverte », l\'alerte radar ne garde pas une vieille position, une vieille image de caméra n\'est pas « en direct »', () => {
    const Waze = require(path.join(tmp, 'shared', 'waze.js'));
    let now = 5000000;
    const w = new Waze({ dataDir: tmp, statusPath: path.join(tmp, 'none.json'), controlPath: path.join(tmp, 'none.sock'), now: () => now }, logOf(), () => {});
    w.now = () => now; w._sync = () => {};
    w.wanted = true;
    w._update({ state: 'showing', target: 'panel', raw: '', keys: 'a' }); assert.strictEqual(w.up, true);
    now -= 3600000;
    w._update(null); assert.strictEqual(w.up, false, 'plus de carte : la fenêtre se ferme, elle ne reste pas tenue une heure');
    const { RadarApp } = require(path.join(tmp, 'shared', 'radar_app.js'));
    let t = 9000000;
    const r = new RadarApp({ zones: { nearest: () => ({ lat: 48, lon: 2, edgeM: 500, centreM: 1500, inside: false, limit: 80 }) }, now: () => t, dir: path.join(tmp, 'themes') });
    r.position({ latitude: 48.85, longitude: 2.35 });
    assert(r._ahead(t), 'une zone devant');
    t -= 3600000;
    assert.strictEqual(r._ahead(t), null); assert.strictEqual(r.why, 'position too old');
    const park = fs.readFileSync(path.join(root, 'shared', 'park_app.js'), 'utf8');
    assert(/live\(now\) \{ return this\.seq !== null && this\.seqAt > 0 && now >= this\.seqAt && now - this\.seqAt < LIVE_MS; \}/.test(park));
    assert(/now >= this\._wzAt && now - this\._wzAt < 1000/.test(hudSrc) && /now >= this\.windowAskAt && now - this\.windowAskAt < WINDOW_HOLD_MS/.test(hudSrc));
});
check('horloge qui recule : Cluster Info continue d\'écrire ses fichiers (les autres applis croiraient le thème parti)', () => {
    const ci = fs.readFileSync(path.join(root, 'shared', 'cluster_info.js'), 'utf8');
    assert(/t >= this\.wantedAt && t - this\.wantedAt < 1000/.test(ci) && /t >= this\.themeAt && t - this\.themeAt < 1000 && key === this\.themeKey/.test(ci));
    assert(!/[^(]t - j\.t (<|>=) STALE_MS/.test(ci), 'la fraîcheur des fichiers des autres applis : en valeur absolue');
});

// les minuteries des modules
check('Waze, zone de danger, limitation, écran partagé, Cluster Info, surveillance des mises en page : aucune minuterie ne laisse sortir une erreur', () => {
    const src = (f) => fs.readFileSync(path.join(root, 'shared', f), 'utf8');
    assert(/setInterval\(\(\) => \{ try \{ this\.scan\(\); \} catch/.test(src('cluster_info.js')));
    assert(/const beat = \(\) => \{ try \{ this\.beat\(\); \} catch/.test(src('screen.js')));
    ['danger.js', 'speedlimit.js'].forEach((f) => assert(/const scan = \(\) => \{ try \{ this\.scan\(\); \} catch/.test(src(f)), f));
    assert(/watcher\.on\('error'/.test(src('layouts.js')));
    const Waze = require(path.join(tmp, 'shared', 'waze.js'));
    const log = logOf();
    const w = new Waze({ dataDir: tmp, statusPath: path.join(tmp, 'none.json'), controlPath: path.join(tmp, 'none.sock') }, log, () => { throw new Error('thème cassé'); });
    w._update = () => { throw new Error('état illisible'); };
    w._safeUpdate(null); w._safeUpdate(null);
    assert.strictEqual(log.lines.filter((l) => /status not handled/.test(l)).length, 1, 'dit une fois');
    const { Danger } = require(path.join(tmp, 'shared', 'danger.js'));
    const d = new Danger({ dir: path.join(tmp, 'nodir') }, log, () => {});
    d.scan = () => { throw new Error('x'); };
    d.start(); d.stop();
    const Screen = require(path.join(tmp, 'shared', 'screen.js'));
    assert(typeof Screen === 'function');
});

Promise.all(later).then(() => {
    try { fs.rmSync ? fs.rmSync(tmp, { recursive: true, force: true }) : null; } catch (e) { /* tmp */ }
    console.log(failed ? failed + ' FAILED' : 'reliability: ' + n + ' checks pass');
    process.exit(failed ? 1 : 0);
});
