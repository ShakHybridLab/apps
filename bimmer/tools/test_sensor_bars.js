'use strict';
// node tools/test_sensor_bars.js : les vues des quatre thèmes de ShakTheme (jauges d'huile, de liquide de refroidissement et de pression du turbo ;
// pression et température des pneus), une à la fois : ce que chaque thème porte (tools/add_sensor_bars.py), le réglage "viewSel" et le bouton du
// volant qui les fait défiler (nextView), les bascules "a&!b" (une vue qui s'efface quand la fenêtre de la carte s'ouvre) et les couleurs de la barre de
// capteur (bleu tant que c'est froid, vert une fois chaud, bleu clair pour le turbo, rouge clignotant au-dessus de la limite).
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let failed = 0, n = 0;
function check(name, fn) { try { fn(); n++; } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }
const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sensorbars-'));
fs.mkdirSync(path.join(tmp, 'shared'));
fs.readdirSync(path.join(root, 'shared')).filter((f) => f.endsWith('.js')).forEach((f) => fs.copyFileSync(path.join(root, 'shared', f), path.join(tmp, 'shared', f)));
fs.symlinkSync(path.join(root, 'kit', 'runtime'), path.join(tmp, 'shared', 'kit'));
const HudApp = require(path.join(tmp, 'shared', 'hud.js'));
const Layouts = require(path.join(tmp, 'shared', 'layouts.js'));
const app = JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'app.json'), 'utf8'));
const layout = (n) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'layouts', n + '.json'), 'utf8'));
const THEMES = ['sport', 'm', 'mblade', 'navi'];

check('le réglage "viewSel" existe, vide par défaut, avec les vues ; le fond bleu est au plus fort', () => {
    const s = app.settings.find((x) => x.key === 'viewSel');
    assert(s && s.type === 'choice' && s.default === 'none', 'viewSel');
    assert.deepStrictEqual(s.options.map((o) => o[0]), ['none', 'gauges', 'tyres', 'drive']);
    assert(s.options.every((o) => o[1] && /[a-zé]/.test(o[1])), 'étiquettes en français');
    assert(!app.settings.some((x) => x.key === 'tempBars'), 'l\'ancien réglage permanent est parti');
    const t = app.settings.find((x) => x.key === 'sportTint');
    assert.strictEqual(t.default, 140, 'le fond bleu par défaut');
    assert(t.steps.includes(t.default), 'le défaut est un cran');
});

THEMES.forEach((name) => {
    const L = layout(name);
    const xb = L.widgets.filter((w) => w.id.startsWith('xb_'));
    check(name + ' : des widgets "xb_", chacun dans sa vue (jauges, pneus ou conduite), rien de permanent, ids uniques', () => {
        assert(xb.length >= (name === 'm' ? 6 : 14), 'trop peu de widgets xb_ : ' + xb.length);
        xb.forEach((w) => assert(/^viewSel=(gauges|tyres|drive&!?driveSport)(&!mapUp)?$/.test(w.toggle), w.id + ' : bascule ' + w.toggle));
        assert(xb.some((w) => /^viewSel=gauges/.test(w.toggle)), 'pas de vue jauges');
        assert.strictEqual(xb.some((w) => /^viewSel=tyres/.test(w.toggle)), name !== 'm', 'les pneus : M a déjà son bloc, les autres ont une vue');
        assert.deepStrictEqual(HudApp.viewsOf(L.widgets), name === 'm' ? ['gauges'] : ['gauges', 'tyres', 'drive'], 'les vues du thème (M a déjà ses réglages de modes dans son tableau)');
        if (name !== 'sport') assert(xb.some((w) => w.toggle === 'viewSel=gauges'), 'au moins une barre reste carte ouverte');
        const ids = L.widgets.map((w) => w.id);
        assert.strictEqual(new Set(ids).size, ids.length, 'identifiant en double');
    });
    // (M a déjà ses pneus, avec leur température, dans le tableau de bord)
    if (name !== 'm') check(name + ' : le bloc des pneus a ses quatre coins (pression et température) et sa roue', () => {
        ['FL', 'FR', 'RL', 'RR'].forEach((k) => {
            assert(xb.some((w) => w.text === '{{tyreP:' + k + '}}'), 'pression ' + k);
            assert(xb.some((w) => w.text === '{{tyreT:' + k + '}}'), 'température ' + k);
        });
        assert(xb.some((w) => w.type === 'icon' && w.icon === 'tyre'), 'la roue');
    });
    check(name + ' : les barres : turbo et liquide partout, l\'huile là où le thème n\'a pas déjà la sienne', () => {
        const bars = xb.filter((w) => w.type === 'slantbar' || w.type === 'meter');
        const sig = bars.map((w) => w.sensor || w.signal).sort();
        assert.deepStrictEqual(sig, name === 'mblade' ? ['boost', 'coolant'] : ['boost', 'coolant', 'oil'], 'capteurs : ' + sig);
        bars.forEach((w) => {
            assert(w.min !== undefined && w.max > w.min, w.id + ' : bornes');
            if (w.type === 'slantbar') assert(w.sensor === w.signal, w.id + ' : "sensor" et "signal" vont ensemble (le validateur veut "signal")');
        });
    });
    check(name + ' : une vue ne recouvre aucun texte ni autre élément du thème montré en même temps (carte fermée et ouverte, chaque vue, en Sport ou non)', () => {
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const on = (w, map, view, sport) => !w.toggle || w.toggle.split('&').every((t) => {
            const not = t.charAt(0) === '!', k = not ? t.slice(1) : t;
            const v = k === 'mapUp' || k === 'powerOpen' ? map : k === 'powerShut' ? !map : k === 'driveSport' ? sport : k.indexOf('viewSel=') === 0 ? k.slice(8) === view : true;
            return not ? !v : v;
        });
        const box = (w) => w.type === 'text' || w.type === 'icon' || w.type === 'slantbar' || w.type === 'meter' || w.type === 'gmeter' || w.type === 'segbar';
        [false, true].forEach((map) => [['gauges', false], ['tyres', false], ['drive', true], ['drive', false]].forEach(([view, sport]) => {
            const mine = xb.filter((w) => on(w, map, view, sport));
            mine.forEach((a) => L.widgets.filter((o) => !o.id.startsWith('xb_') && box(o) && on(o, map, view, sport)).forEach((o) => {
                assert(!hit(a, o), a.id + ' recouvre ' + o.id + ' (vue ' + view + (sport ? ', Sport' : '') + (map ? ', carte ouverte' : '') + ')');
            }));
            mine.forEach((a, i) => mine.slice(i + 1).forEach((b) => {
                if (a.type === 'text' || b.type === 'text' || a.type === 'icon' || b.type === 'icon' || a.type === 'gmeter' || b.type === 'gmeter') assert(!hit(a, b) || a.id.replace(/_[a-z]+$/, '') === b.id.replace(/_[a-z]+$/, '') && (a.type === 'segbar' || b.type === 'segbar') === false, a.id + ' recouvre ' + b.id + ' (vue ' + view + ')');
            }));
        }));
    });
    // la vue « Conduite » : en Sport le G-mètre et deux lectures, hors Sport quatre rangées (icône, nom du réglage), avec leur trait de trois crans sauf M Blade
    if (name !== 'm') check(name + ' : la vue Conduite : G-mètre et lectures en Sport, les quatre réglages des modes sinon', () => {
        const g = xb.filter((w) => /driveSport$|driveSport&/.test(w.toggle) && !/!driveSport/.test(w.toggle)), r = xb.filter((w) => /!driveSport/.test(w.toggle));
        assert.deepStrictEqual(g.map((w) => w.type).sort(), ['gmeter', 'text', 'text']);
        assert.deepStrictEqual(g.filter((w) => w.type === 'text').map((w) => w.text).sort(), ['{{gFwd}}', '{{gSide}}']);
        assert.deepStrictEqual(r.filter((w) => w.type === 'text').map((w) => w.text).sort(), ['{{setup:chassis}}', '{{setup:engine}}', '{{setup:gearbox}}', '{{setup:steering}}']);
        assert.strictEqual(r.filter((w) => w.type === 'icon').length, 4);
        const bars = r.filter((w) => w.type === 'segbar');
        assert.strictEqual(bars.length, name === 'mblade' ? 0 : 4, 'les traits : M Blade n\'a plus de couche pour eux');
        bars.forEach((b) => assert(/^setupLevel:(engine|chassis|steering|gearbox)$/.test(b.signal) && b.max === 3, b.id));
        // les fontes du thème ont les lettres des textes
        const font = (n) => JSON.parse(fs.readFileSync(path.join(root, 'apps', 'shaktheme', 'hud', 'fonts', n + '.json'), 'utf8'));
        g.concat(r).filter((w) => w.type === 'text').forEach((w) => {
            const have = Object.keys(font(w.font).glyphs).join('');
            const need = w.text.indexOf('gSide') > 0 || w.text.indexOf('gFwd') > 0 ? '0123456789. LRACBK' : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ -';
            for (const ch of need) assert(have.indexOf(ch) >= 0 || ch === ' ' && have.length, w.font + ' n\'a pas "' + ch + '" (' + w.id + ')');
        });
    });
});

check('viewsOf : les vues d\'un thème, dans l\'ordre du cycle, sans doublon', () => {
    const w = (t) => ({ id: 'a' + Math.random(), type: 'text', toggle: t });
    assert.deepStrictEqual(HudApp.viewsOf([w('viewSel=tyres'), w('viewSel=drive&!driveSport&!mapUp'), w('viewSel=gauges&!mapUp'), w('viewSel=tyres'), w('mapUp'), w(undefined)]), ['gauges', 'tyres', 'drive']);
    assert.deepStrictEqual(HudApp.viewsOf([w('mapUp')]), []);
    assert.deepStrictEqual(HudApp.VIEW_ORDER.slice(0, 3), ['gauges', 'tyres', 'drive']);
});
check('nextView : chaque appui passe à la vue suivante, le dernier revient à aucune, un thème sans vue ne bouge pas', () => {
    const rebuilt = [];
    const mk = (views, saved) => {
        const o = { layoutViews: views, viewNow: null, saved, rebuilt: 0, _rebuild() { this.rebuilt++; rebuilt.push(this.viewNow); }, setting(k) { return HudApp.prototype.setting.call(this, k); } };
        o.ctx = { settings: { item: () => null, get: (k) => (k === 'viewSel' ? saved : undefined) } };
        o._wazeMapOn = () => false;
        o.nextView = HudApp.prototype.nextView; o.views = HudApp.prototype.views;
        return o;
    };
    const t = mk(['gauges', 'tyres'], 'none');
    assert.deepStrictEqual([t.nextView(), t.nextView(), t.nextView(), t.nextView()], ['gauges', 'tyres', 'none', 'gauges']);
    assert.strictEqual(t.setting('viewSel'), 'gauges'); assert.strictEqual(t.rebuilt, 4);
    const none = mk([], 'none');
    assert.strictEqual(none.nextView(), 'none'); assert.strictEqual(none.rebuilt, 0, 'rien à reconstruire');
    const saved = mk(['gauges', 'tyres'], 'tyres');          // un choix gardé dans les réglages : le premier appui passe à la suite
    assert.strictEqual(saved.nextView(), 'none');
    assert.deepStrictEqual(t.views(), ['gauges', 'tyres']);
});
check('la vue du bouton gagne sur le réglage, et un choix fait dans les réglages reprend la main', () => {
    const src = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(src.includes("if (key === 'viewSel' && this.viewNow !== null) return this.viewNow;"), 'setting()');
    assert(src.includes("if (key === 'viewSel') this.viewNow = null;"), 'onChange');
    assert(src.includes('this.layoutViews = viewsOf(layout.widgets);'), 'les vues du thème sont relevées à chaque reconstruction');
});

check('driveSport : vrai quand la voiture est en Sport, faux sinon ou tant qu\'elle n\'a rien dit ; un changement de mode reconstruit un thème qui en dépend', () => {
    const h = Object.create(HudApp.prototype);
    h.viewNow = null; h.ctx = { settings: { item: () => null, get: () => 'none' } };
    h.driveMode = 'sport'; assert.strictEqual(h.setting('driveSport'), true);
    ['hybrid', 'eco', 'electric', null].forEach((m) => { h.driveMode = m; assert.strictEqual(h.setting('driveSport'), false, String(m)); });
    h._toggleOn = HudApp.prototype._toggleOn;
    h.driveMode = 'sport'; assert.strictEqual(h._toggleOn('driveSport'), true); assert.strictEqual(h._toggleOn('!driveSport'), false);
    assert.strictEqual(h._toggleOn('viewSel=drive&driveSport'), false, 'viewSel n\'est pas drive ici : le réglage est vide');
    const src = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(src.includes("(this.driveLayout && (this.driveMode === 'sport') !== this.driveShown)"), 'la reconstruction au changement de mode');
    assert(src.includes("this.driveLayout = layout.widgets.some((w) => /(^|&)!?driveSport(&|$)/.test(w.toggle || ''));"), 'le thème dit s\'il suit le mode');
});

check('le validateur de mises en page accepte "a&!b" et refuse le reste', () => {
    const lay = new Layouts(tmp, { warn() {}, info() {} }, [1920, 720]);
    const ok = (t) => lay._validate({ schemaVersion: 2, widgets: [{ id: 'a', type: 'fill', x: 0, y: 0, w: 10, h: 10, toggle: t }] }, 't');
    ['viewSel=gauges', '!mapUp', 'viewSel=tyres&!mapUp', 'viewSel=drive&driveSport&!mapUp', 'viewSel=drive&!driveSport', 'a=b&c', 'a&b&!c', '!viewSel=gauges'].forEach((t) => ok(t));
    ['', '&a', 'a&', 'a&&b', 'a b', 'a|b'].forEach((t) => assert.throws(() => ok(t), /bad toggle/, 'devrait refuser "' + t + '"'));
});

check('_toggleOn : "a&!b" demande les deux', () => {
    const set = { a: true, b: false, c: true };
    const fake = { setting: (k) => set[k], _toggleOn: HudApp.prototype._toggleOn };
    const t = (s) => fake._toggleOn(s);
    assert.strictEqual(t('a'), true); assert.strictEqual(t('!b'), true); assert.strictEqual(t('a&!b'), true);
    assert.strictEqual(t('a&b'), false); assert.strictEqual(t('!a&!b'), false); assert.strictEqual(t('a&c&!b'), true);
    set.b = true; assert.strictEqual(t('a&!b'), false);
});

// la barre de capteur : _update sur un faux client qui note les uniformes
function run(sensor, raw, over, cold, now) {
    const calls = [];
    const x = { w: { type: 'slantbar', sensor, signal: sensor, min: sensor === 'boost' ? 0 : 50, max: sensor === 'boost' ? 1.6 : 150 }, ref: 7, last: '', c: { uniform: (r, name, v) => calls.push([name, v]) } };
    const fake = {
        _raw: () => raw, _overLimit: () => (over ? sensor : null), setting: (k) => (k === 'oilCold' || k === 'coolantCold' ? cold : 0),
        theme: { hot: [255, 42, 42, 255] },
    };
    HudApp.prototype._update.call(fake, x, now || 0, true);
    const get = (nm) => (calls.find((c) => c[0] === nm) || [])[1];
    return { value: get('u_value'), on: get('u_on'), calls, x, fake };
}
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
check('la barre de capteur : la longueur suit la valeur entre min et max (arrondie au 200e), 0 sans donnée', () => {
    assert(same(run('oil', 100, false, 75).value, [0.5]));
    assert(same(run('oil', 150, false, 75).value, [1]) && same(run('oil', 400, false, 75).value, [1]), 'plafonnée à 1');
    assert(same(run('oil', 20, false, 75).value, [0]), 'plancher à 0');
    assert(same(run('oil', null, false, 75).value, [0]), 'sans donnée');
    assert(same(run('boost', 0.8, false, 0).value, [0.5]));
});
check('la barre de capteur : bleu tant que c\'est froid, vert une fois chaud, bleu clair pour le turbo', () => {
    const cold = run('oil', 60, false, 75).on, warm = run('oil', 95, false, 75).on, boost = run('boost', 0.8, false, 0).on;
    assert(cold && warm && boost);
    assert(!same(cold, warm), 'froid et chaud ont la même couleur');
    assert(warm[1] > warm[0] && warm[1] > warm[2], 'chaud : vert');
    assert(cold[2] > cold[0] && cold[2] > cold[1], 'froid : bleu');
    assert(same(boost, [79 / 255, 180 / 255, 1, 1]), 'turbo : bleu clair');
    assert(same(run('oil', 60, false, 0).on, warm), 'seuil à 0 : jamais « froid »');
});
check('la barre de capteur : au-dessus de la limite elle clignote entre le rouge et un rouge sombre', () => {
    const a = run('coolant', 120, true, 70, 0).on, b = run('coolant', 120, true, 70, 10 * 1000).on;
    const seen = [];
    for (let t = 0; t < 4000; t += 50) seen.push(run('coolant', 120, true, 70, t).on.join(','));
    assert(new Set(seen).size === 2, 'deux couleurs en alternance : ' + new Set(seen).size);
    assert(a && b);
});
check('la barre de capteur : rien n\'est renvoyé si rien n\'a changé (sauf forcé)', () => {
    const r = run('oil', 95, false, 75);
    r.calls.length = 0;
    HudApp.prototype._update.call(r.fake, r.x, 0, false);
    assert.strictEqual(r.calls.length, 0, 'une mise à jour inutile');
    HudApp.prototype._update.call(r.fake, r.x, 0, true);
    assert(r.calls.length > 0, 'forcé : doit repartir');
});

fs.rmSync && fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? failed + ' FAILED' : 'sensor bars: ' + n + ' checks pass');
if (failed) process.exitCode = 1;
