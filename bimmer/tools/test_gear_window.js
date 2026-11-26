'use strict';
// « Trou autour de la lettre de rapport de BMW » (réglage gearWindow) : BMW dessine sa case noire tant qu'un calque en recouvre la
// lettre ; eroobeeroo (coupe à y 660) et Bimmer Lab (plein écran avec un trou en bas à droite) ne la recouvrent pas. Ici : chaque fond
// est coupé en trois calques (le haut, et deux morceaux de la même image sous y 660 de chaque côté du trou), aucun texte ni icône ne
// touche le trou, et aucune feuille d'images ne le recouvre. node tools/test_gear_window.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const gw = require('../shared/gear_window');
let failed = 0;
function check(name, fn) { try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gearwin-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));
const app = (n) => JSON.parse(fs.readFileSync(path.join(root, 'apps', n, 'app.json'), 'utf8'));
const layout = (n) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', n + '.json'), 'utf8'));
const THEMES = ['sport', 'm', 'mblade', 'navi'];
const IMAGE = { text: true, scale: true, stripe: true, badge: true, gridlabels: true, icon: true, emblem: true, swatchimg: true };
const isImage = (t) => !!IMAGE[t];
const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = gw.box;

check('quatre tailles de trou, y 660 à 720 ; la lettre de BMW (x 1392..1448, y 666..702) est dans les trois premières', () => {
    assert.deepStrictEqual(Object.keys(gw.VARIANTS), ['1', '2', '3', '4']);
    ['1', '2', '3'].forEach((id) => {
        const w = gw.pick(id, 'sport');
        assert(w.x <= gw.LETTER[0] && w.x + w.w >= gw.LETTER[2] && w.y <= gw.LETTER[1] && w.y + w.h >= gw.LETTER[3], 'la lettre n\'est pas dans le trou ' + id);
    });
    assert.deepStrictEqual(gw.pick('1', 'sport'), { id: '1', x: 1380, y: 660, w: 80, h: 60 }, 'Bimmer Lab 0.17.8');
    assert.deepStrictEqual(gw.pick('3', 'sport'), { id: '3', x: 1150, y: 660, w: 320, h: 60 }, 'Bimmer Lab 0.17.6');
    assert.deepStrictEqual(gw.pick('4', 'sport'), { id: '4', x: 0, y: 660, w: 1920, h: 60 }, 'toute la bande');
    THEMES.forEach((t) => assert.strictEqual(gw.pick('1', t).y, 660, t));
});

check('auto : la taille 1 pour les quatre thèmes (l\'essai 1 / 2 / 3 / 4 du 16 nov. 2026 a fait disparaître la case dans les quatre) ; « off », une valeur inconnue ou un layout qui n\'est pas un thème : pas de trou', () => {
    assert.deepStrictEqual(THEMES.map((t) => gw.pick('auto', t).id), ['1', '1', '1', '1']);
    assert.strictEqual(gw.pick(undefined, 'sport').id, '1');
    assert.strictEqual(gw.pick('off', 'sport'), null);
    assert.strictEqual(gw.pick('9', 'sport'), null);
    assert.strictEqual(gw.pick('auto', 'grid'), null, 'la grille de calibration reste pleine');
    assert.strictEqual(gw.pick('2', 'mapcal'), null);
});

THEMES.forEach((t) => {
    ['1', '2', '3', '4'].forEach((id) => {
        check(t + ', trou ' + id + ' : aucun élément ne touche le trou, les fonds sont coupés, les originaux intacts', () => {
            const l = layout(t), before = JSON.stringify(l.widgets);
            const win = gw.pick(id, t);
            const r = gw.apply(l.widgets, win, isImage);
            assert.strictEqual(JSON.stringify(l.widgets), before, 'le layout d\'origine est modifié');
            r.widgets.forEach((w) => assert(!hit(box(w), win), w.id + ' touche le trou (' + JSON.stringify(box(w)) + ')'));
            assert(r.cropped.length >= 1, 'aucun fond coupé');
            const lead = r.widgets.filter((w) => r.cropped.indexOf(w.id) >= 0);
            lead.forEach((w) => { assert.strictEqual(box(w).y + box(w).h, win.y, w.id + ' ne finit pas à ' + win.y); assert.strictEqual(w.h, 720, 'la hauteur de l\'image change (le fond serait écrasé)'); });
            assert(!r.widgets.some((w) => /^gw_cover/.test(w.id)), 'plus de bande noire : le fond continue sous y ' + win.y);
            const follow = r.widgets.filter((w) => w.follow);
            assert.strictEqual(follow.length, id === '4' ? 0 : 2 * lead.length, 'deux morceaux par fond coupé (aucun pour la taille 4)');
            follow.forEach((f) => {
                assert(r.cropped.indexOf(f.follow) >= 0, 'un morceau suit un fond coupé');
                assert.strictEqual(box(f).y, win.y); assert.strictEqual(box(f).y + box(f).h, 720, 'le morceau va jusqu\'au bas de l\'écran');
                assert.strictEqual(f.w, 1920); assert.strictEqual(f.h, 720);
            });
            if (follow.length) {
                const [a, b] = follow.slice(0, 2).map(box);
                assert.strictEqual(a.x, 0); assert.strictEqual(a.x + a.w, win.x); assert.strictEqual(b.x, win.x + win.w); assert.strictEqual(b.x + b.w, 1920, 'les deux morceaux et le trou font la largeur de l\'écran');
            }
            // les textes et icônes de la ligne du bas qui étaient hors du trou restent
            const keep = l.widgets.filter((w) => !hit(w, win));
            keep.forEach((w) => assert(r.widgets.some((o) => o.id === w.id), w.id + ' a disparu sans toucher le trou'));
        });
    });
});

check('un texte ou une icône qui mord de peu est poussé (à droite, à gauche ou vers le haut), sinon retiré', () => {
    const win = gw.pick('1', 'sport');       // x 1380..1460, y 660..720
    const T = (id, x, y, w, h) => ({ id, type: 'text', x, y, w, h });
    const r = gw.apply([T('droite', 1458, 668, 24, 30), T('haut', 1400, 630, 40, 34), T('dedans', 1390, 670, 40, 24), T('loin', 100, 670, 80, 24)], win, isImage);
    const by = {}; r.widgets.forEach((w) => { by[w.id] = w; });
    assert.strictEqual(by.droite.x, 1460, 'poussé hors du trou à droite');
    assert.strictEqual(by.haut.y + by.haut.h, 660, 'remonté : son bas finit à 660');
    assert(!by.dedans && r.dropped.indexOf('dedans') >= 0, 'un texte dans le trou est retiré');
    assert.deepStrictEqual([by.loin.x, by.loin.y], [100, 670], 'un texte loin du trou ne bouge pas');
    assert.deepStrictEqual(r.nudged.sort(), ['droite', 'haut']);
});

check('un effet qui commence dans le trou est retiré, celui qui le traverse est coupé à y 660 (rectangle seulement, pas sa hauteur) ; un fond dont le shader ne sait pas dessiner un morceau est remplacé sous 660 par deux bandes noires', () => {
    const win = gw.pick('1', 'sport');
    const r = gw.apply([{ id: 'fond', type: 'sdash', x: 0, y: 0, w: 1920, h: 720 }, { id: 'bas', type: 'fill', x: 1380, y: 680, w: 50, h: 20 }], win, isImage);
    const f = r.widgets.find((w) => w.id === 'fond');
    assert.deepStrictEqual([f.x, f.y, f.w, f.h], [0, 0, 1920, 720]);
    assert.deepStrictEqual(f.rect, { x: 0, y: 0, w: 1920, h: 660 });
    assert(!r.widgets.some((w) => w.id === 'bas') && r.dropped.indexOf('bas') >= 0);
    assert.deepStrictEqual(r.widgets.filter((w) => w.follow).map((w) => [w.id, w.follow]), [['fond_gl', 'fond'], ['fond_gr', 'fond']]);
    const k = gw.apply([{ id: 'plein', type: 'fill', x: 0, y: 0, w: 1920, h: 720, color: [1, 2, 3, 255] }], win, isImage);
    assert.deepStrictEqual(k.widgets.filter((w) => /^gw_cover/.test(w.id)).map((w) => [w.x, w.w]), [[0, 1380], [1460, 460]]);
    assert(!k.widgets.some((w) => w.follow));
});

check('les six shaders de fond lisent u_rect et u_org (un morceau de l\'image), et hud.js les règle pour chaque fond ; le shader de M Blade reste sous les 8748 jetons qui tiennent sur la voiture', () => {
    const sh = require('../shared/shaders');
    ['sdash', 'mdash', 'mblade', 'navi', 'evo', 'circuit'].forEach((t) => {
        const src = sh[t];
        assert(/uniform vec2 u_rect;/.test(src) && /uniform vec2 u_org;/.test(src), t + ' : uniformes');
        assert(src.indexOf('vec2 p = v_uv * u_rect + u_org;') >= 0, t + ' : p');
        assert(!/vec2 p = v_uv \* u_size;/.test(src), t + ' : ancienne ligne');
    });
    const hud = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(/BACKDROP_TYPES = \{ sdash: true, mdash: true, mblade: true, navi: true, evo: true, circuit: true \}/.test(hud));
    assert(hud.indexOf("c.uniform(ref, 'u_rect', [r.w, r.h]);") >= 0 && hud.indexOf("c.uniform(ref, 'u_org', [r.x - w.x, r.y - w.y]);") >= 0);
    // le budget : aucun fond ne dépasse 8748 jetons (le plus grand qui tienne sur une X3 G01, tools/shader_budget.js)
    const sb = require('../tools/shader_budget');
    ['sdash', 'mdash', 'mblade', 'navi', 'evo', 'circuit'].forEach((t) => {
        const l = sb.layer(sh[t], 1920, 720);
        assert(l.tokens <= 8748 && l.level === 'ok', t + ' : ' + l.text);
    });
});

check('_follow : un morceau ne se met jamais à jour seul, chaque uniforme du fond principal part aussi vers lui, le reste du client passe tel quel', () => {
    const calls = [];
    const mkClient = (n) => ({ n, drop(ref) { calls.push([n, 'drop', ref, this.n]); }, uniform(ref, name, v) { calls.push([n, ref, name, v]); } });
    const cl = mkClient('A'), cf = mkClient('B');
    const lead = { w: { id: 'sport' }, c: cl, ref: 10 };
    const fol = { w: { id: 'sport_gl', follow: 'sport' }, c: cf, ref: 20 };
    const fake = { widgets: new Map([['sport', lead], ['sport_gl', fol]]), updated: [], _update(x, now, force) { this.updated.push([x.w.id, force]); } };
    HudApp.prototype._follow.call(fake, fol);
    assert.strictEqual(fol.follower, true);
    assert.deepStrictEqual(fake.updated, [['sport', true]], 'le fond principal renvoie tout aussitôt');
    lead.c.uniform(10, 'u_speed', [0.5]);
    assert.deepStrictEqual(calls, [['A', 10, 'u_speed', [0.5]], ['B', 20, 'u_speed', [0.5]]]);
    calls.length = 0;
    lead.c.drop(10);
    assert.deepStrictEqual(calls, [['A', 'drop', 10, 'A']], 'drop passe au vrai client, avec son this');
    // un deuxième morceau : le client n'est enveloppé qu'une fois
    const cg = mkClient('C'), fol2 = { w: { id: 'sport_gr', follow: 'sport' }, c: cg, ref: 30 };
    fake.widgets.set('sport_gr', fol2);
    HudApp.prototype._follow.call(fake, fol2);
    calls.length = 0;
    lead.c.uniform(10, 'u_rpm', [1]);
    assert.deepStrictEqual(calls.map((c) => c[0]), ['A', 'B', 'C']);
    // un morceau dont le fond principal manque ne plante pas
    HudApp.prototype._follow.call(fake, { w: { id: 'x', follow: 'absent' }, c: cf, ref: 1 });
    // _update d'un morceau ne fait rien
    const spy = { widgets: new Map() };
    assert.strictEqual(HudApp.prototype._update.call(spy, { follower: true, w: { type: 'sdash' } }, Date.now(), true), undefined);
});

check('_plan : une feuille d\'images ne recouvre jamais le trou, même quand le layout veut regrouper des éléments des deux côtés', () => {
    const T = (id, x, y, w, h) => ({ id, type: 'text', z: 3, x, y, w, h, sheet: 'bas' });
    const ws = [T('g', 150, 669, 150, 26), T('d', 1630, 669, 120, 26)];
    const mk = (avoid) => ({ _avoid: avoid, _connOf: () => 0 });
    const one = HudApp.prototype._plan.call(mk(null), ws, Infinity, Infinity);
    assert.strictEqual(one.length, 1, 'sans trou le layout regroupe les deux textes en une feuille');
    const win = gw.pick('1', 'sport');
    const two = HudApp.prototype._plan.call(mk(win), ws, Infinity, Infinity);
    assert.strictEqual(two.length, 2, 'avec le trou : deux feuilles');
    two.forEach((s) => assert(!hit(s, win), 'la feuille ' + s.members[0].id + ' recouvre le trou'));
});

check('_gearWindow : cluster seulement, réglage présent, pas « off » ; avec le trou l\'option « bande du bas libre » s\'efface et les fonds ne creusent plus de poche', () => {
    const fake = (target, val, has) => ({ target, ctx: { settings: { item: (k) => (has === false || (k !== 'gearWindow' && k !== 'stripClear') ? null : {}) } }, setting: (k) => (k === 'gearWindow' ? val : true) });
    assert.strictEqual(HudApp.prototype._gearWindow.call(fake('panel', 'auto'), 'sport').id, '1');
    assert.strictEqual(HudApp.prototype._gearWindow.call(fake('panel', 'off'), 'sport'), null);
    assert.strictEqual(HudApp.prototype._gearWindow.call(fake('hud', 'auto'), 'sport'), null, 'le HUD n\'a pas de bande');
    assert.strictEqual(HudApp.prototype._gearWindow.call(fake('panel', 'auto', false), 'sport'), null, 'ShakHUD n\'a pas le réglage');
    const f = fake('panel', 'auto');
    f._stripOn = HudApp.prototype._stripOn; f._slotOff = HudApp.prototype._slotOff;
    f.gearWin = null;
    assert.strictEqual(f._stripOn(), true, 'sans trou la bande libre marche encore');
    assert.strictEqual(f._slotOff(), 1);
    f.gearWin = gw.pick('1', 'sport');
    assert.strictEqual(f._stripOn(), false, 'avec le trou elle s\'efface');
    assert.strictEqual(f._slotOff(), 1, 'pas de poche dans le fond tant que le trou est ouvert');
    const g = fake('panel', 'off'); g._stripOn = () => false; g._slotOff = HudApp.prototype._slotOff; g.gearWin = null;
    assert.strictEqual(g._slotOff(), 0, 'sans trou ni bande libre la poche de la case reste');
});

check('_balance : le trou coupe des feuilles en deux ; une connexion qui dépasse 8 calques passe sa plus petite feuille à la connexion la moins utilisée, jamais un effet, et sans boucler quand tout est plein', () => {
    const logs = [];
    const mk = (conns) => conns.map((c, i) => ({ kind: i % 5 === 4 ? 'layer' : 'sheet', conn: c, w: 10 + i, h: 10, members: [{ id: 'm' + i }] }));
    const fake = (plan) => ({ log: { info: (t) => logs.push(t) }, _connCounts: HudApp.prototype._connCounts });
    const plan = mk([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);          // 9 sur la connexion 1 (l'effet d'indice 4 est dessus)
    const f = fake(plan);
    HudApp.prototype._balance.call(f, plan);
    const counts = f._connCounts(plan);
    assert.deepStrictEqual(counts, [8, 3, 1], 'la neuvième est passée à la connexion 3, la moins utilisée : ' + counts);
    assert.strictEqual(plan[4].conn, 0, 'un effet ne bouge jamais');
    assert.strictEqual(plan[0].conn, 2, 'la plus petite feuille est celle qui part');
    assert.strictEqual(logs.length, 1);
    const full = mk([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 3]);
    HudApp.prototype._balance.call(fake(full), full);               // tout est plein : rien ne bouge, pas de boucle infinie
    assert.strictEqual(full.filter((e) => e.conn === 0).length, 9);
});

check('le réglage et le fichier : ShakTheme a le choix gearWindow (auto par défaut), dans l\'onglet Affichage ; les deux applis livrent gear_window.js', () => {
    const st = app('shaktheme');
    const it = st.settings.find((s) => s.key === 'gearWindow');
    assert(it && it.type === 'choice' && it.default === 'auto');
    assert.deepStrictEqual(it.options.map((o) => o[0]), ['auto', '1', '2', '3', '4', 'off']);
    assert(/^[^a-z]*[A-ZÉ]/.test(it.label) && !/[a-z]+ [a-z]+ the /.test(it.label), 'étiquette en français');
    assert(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'main.js'), 'utf8').indexOf("'gearWindow'") >= 0, 'pas dans l\'onglet Affichage');
    assert(!app('shakhud').settings.some((s) => s.key === 'gearWindow'), 'ShakHUD n\'a pas ce réglage');
    ['shaktheme', 'shakhud'].forEach((n) => assert(app(n).shared.indexOf('gear_window.js') >= 0, n));
});

console.log(failed ? failed + ' échec(s)' : 'tout passe');
process.exit(failed ? 1 : 0);
