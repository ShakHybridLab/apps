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
    assert.deepStrictEqual(s.options.map((o) => o[0]), ['none', 'gauges', 'tyres', 'drive', 'electric']);
    assert(s.options.every((o) => o[1] && /[a-zé]/.test(o[1])), 'étiquettes en français');
    assert(!app.settings.some((x) => x.key === 'tempBars'), 'l\'ancien réglage permanent est parti');
    const t = app.settings.find((x) => x.key === 'sportTint');
    assert.strictEqual(t.default, 140, 'le fond bleu par défaut');
    assert(t.steps.includes(t.default), 'le défaut est un cran');
});

// M Blade's view panel and the other themes' card: the effect layer the views' texts sit on
const PANEL = (w) => w.type === 'mpanel' || w.type === 'vcard' || w.type === 'sring' || w.type === 'nline' || w.type === 'mblades';
THEMES.forEach((name) => {
    const L = layout(name);
    const xb = L.widgets.filter((w) => w.id.startsWith('xb_'));
    check(name + ' : des widgets "xb_", chacun dans sa vue (jauges, pneus ou conduite), rien de permanent, ids uniques', () => {
        assert(xb.length >= (name === 'm' ? 6 : 14), 'trop peu de widgets xb_ : ' + xb.length);
        // (M Blade : le fond, la jauge d'essence à droite et la limitation sous le panneau des vues valent pour toutes les vues, carte fermée : "!mapUp&!viewSel=none")
        xb.forEach((w) => assert(/^viewSel=(gauges|tyres|electric|drive&!?driveSport)(&!?mapUp)?$/.test(w.toggle) || (name === 'mblade' && /^(!mapUp&!viewSel=none|(!?mapUp)&!viewSel=none&!viewSel=gauges)$/.test(w.toggle))
            // (M, 19 nov. 2026 : le fond sans la petite voiture des pneus, pour toutes les vues ; la vue Conduite y est le G-mètre, en Sport ou non)
            || (name === 'm' && (w.toggle === '!viewSel=none' || w.toggle === 'viewSel=drive')), w.id + ' : bascule ' + w.toggle));
        assert(xb.some((w) => /^viewSel=gauges/.test(w.toggle)), 'pas de vue jauges');
        assert.strictEqual(xb.some((w) => /^viewSel=tyres/.test(w.toggle)), name !== 'm', 'les pneus : M a déjà son bloc, les autres ont une vue');
        assert.deepStrictEqual(HudApp.viewsOf(L.widgets), name === 'm' ? ['gauges', 'drive', 'electric'] : ['gauges', 'tyres', 'drive', 'electric'], 'les vues du thème (M montre ses pneus sans vue, à la même place)');
        if (name !== 'sport') assert(xb.some((w) => w.toggle === 'viewSel=gauges' || w.toggle === 'viewSel=gauges&mapUp'), 'au moins une barre reste carte ouverte');
        const ids = L.widgets.map((w) => w.id);
        assert.strictEqual(new Set(ids).size, ids.length, 'identifiant en double');
    });
    // (M a déjà ses pneus, avec leur température, dans le tableau de bord)
    if (name !== 'm') check(name + ' : le bloc des pneus a ses quatre coins (pression et température) et sa roue', () => {
        ['FL', 'FR', 'RL', 'RR'].forEach((k) => {
            assert(xb.some((w) => w.text === '{{tyreP:' + k + '}}'), 'pression ' + k);
            assert(xb.some((w) => w.text === '{{tyreT:' + k + '}}'), 'température ' + k);
        });
        // (depuis le 19 nov. 2026 la roue seule a laissé la place à la voiture vue de dessus, dessinée par le panneau ou la carte : "mode": "tyres")
        assert(xb.some((w) => w.type === 'icon' && w.icon === 'tyre') || xb.some((w) => PANEL(w) && w.mode === 'tyres' && Array.isArray(w.tiles)), 'la roue');
    });
    check(name + ' : les barres : turbo et liquide partout, l\'huile là où le thème n\'a pas déjà la sienne', () => {
        // (M Blade has each view twice: right of the blade with the map closed, in the left column with the map up: the map-up copy is "&mapUp")
        // (M Blade : carte fermée, les barres sont dans le panneau des vues à gauche, "rows" de xb_vpan_g, comme le combiné M de BMW ; carte ouverte,
        // le turbo et le liquide en barres inclinées à droite, "&mapUp")
        const bars = xb.filter((w) => (w.type === 'slantbar' || w.type === 'meter') && !/(^|&)mapUp$/.test(w.toggle));
        // (Sport et Navi, 19 nov. 2026 : les quatre lectures sont les rangées de la carte des vues, xb_card_g)
        const pg = xb.find((w) => w.id === 'xb_vpan_g' || w.id === 'xb_card_g');
        const sig = pg ? pg.rows.map((r) => r.signal).sort() : bars.map((w) => w.sensor || w.signal).sort();
        if (pg) pg.rows.forEach((r) => assert(r.max > r.min && r.y > pg.y && r.y < pg.y + pg.h, r.signal + ' : bornes, dans la carte'));
        if (name === 'mblade') {
            assert.deepStrictEqual(bars, [], 'carte fermée : les barres sont dans le panneau');
            // (avec la carte, depuis le 20 nov. 2026 : le même panneau en petit à droite de la lame, ses deux barres dedans)
            const mg = xb.filter((w) => w.type === 'mpanel' && w.toggle === 'viewSel=gauges&mapUp')[0];
            assert(mg && mg.flip === true, 'carte ouverte : le petit panneau');
            assert.deepStrictEqual(mg.rows.map((r) => r.signal).sort(), ['boost', 'coolant'], 'carte ouverte : le turbo et le liquide');
            mg.rows.forEach((r) => assert(r.y > mg.y && r.y < mg.y + mg.h && mg.bar[0] > mg.x && mg.bar[1] < mg.x + mg.w, 'carte ouverte : les barres dans le panneau'));
            xb.find((w) => w.id === 'xb_vpan_g').rows.forEach((r) => assert(r.max > r.min && r.y > 0, r.signal + ' : bornes'));
        }
        assert.deepStrictEqual(sig, pg ? ['ambient', 'boost', 'coolant', 'oil'] : ['boost', 'coolant', 'oil'], 'capteurs : ' + sig);
        bars.forEach((w) => {
            assert(w.min !== undefined && w.max > w.min, w.id + ' : bornes');
            if (w.type === 'slantbar') assert(w.sensor === w.signal, w.id + ' : "sensor" et "signal" vont ensemble (le validateur veut "signal")');
        });
    });
    check(name + ' : une vue ne recouvre aucun texte ni autre élément du thème montré en même temps (carte fermée et ouverte, chaque vue, en Sport ou non)', () => {
        const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        const on = (w, map, view, sport) => !w.toggle || w.toggle.split('&').every((t) => {
            const not = t.charAt(0) === '!', k = not ? t.slice(1) : t;
            const v = k === 'mapUp' || k === 'powerOpen' ? map : k === 'powerShut' ? !map : k === 'driveSport' ? sport : k.indexOf('viewSel=') === 0 ? k.slice(8) === (view || 'none') : true;
            return not ? !v : v;
        });
        const box = (w) => w.type === 'text' || w.type === 'icon' || w.type === 'slantbar' || w.type === 'meter' || w.type === 'gmeter' || w.type === 'segbar';
        [false, true].forEach((map) => [['gauges', false], ['tyres', false], ['drive', true], ['drive', false]].forEach(([view, sport]) => {
            const mine = xb.filter((w) => on(w, map, view, sport) && w.type !== 'mblade' && w.type !== 'mdash');      // (M Blade's backdrop for the views, xb_vback: the whole panel)
            // M Blade's view panel (mpanel) is a band whose sides are "<": a box hits it when one of its corners or its middle is inside the band
            const inPanel = (p, w) => [[w.x, w.y], [w.x + w.w, w.y], [w.x, w.y + w.h], [w.x + w.w, w.y + w.h], [w.x + w.w / 2, w.y + w.h / 2]].some(([x, y]) => {
                // ("flip": the small panel beside the Waze map, mirrored: its point to the right)
                const off = p.shape[2] * Math.abs(y - p.shape[1]);
                const xl = p.flip ? p.x + p.w - (p.shape[0] - p.x) - off - p.shape[3] : p.shape[0] + off;
                return y > p.y && y < p.y + p.h && x > xl && x < xl + p.shape[3];
            });
            // Sport's round gauges (sring) cover their discs, not their layer's whole box: beside the map two rings share a tall layer, one above the
            // speed and one below it, and the speed shows between them
            const discs = (p) => (p.type === 'sring' && p.mode !== 'tyres' && p.rows && p.rows.length ? p.rows.map((r, i) => {
                const cx = p.bar[0] + i * (p.bar[1] - p.bar[0]), rr = p.card[0] + p.card[1] / 2 + 7;
                return { x: cx - rr, y: r.y - rr, w: 2 * rr, h: 2 * rr };
            }) : [p]);
            // (the limit's ring beside the map, o_lim_: no view shows with the map since 21 Nov 2026, hud.js setting('viewSel'), so the two never meet)
            mine.forEach((a) => L.widgets.filter((o) => !o.id.startsWith('xb_') && !o.id.startsWith('o_lim_') && box(o) && on(o, map, view, sport)).forEach((o) => {
                assert(a.type === 'mpanel' ? !inPanel(a, o) : !discs(a).some((q) => hit(q, o)), a.id + ' recouvre ' + o.id + ' (vue ' + view + (sport ? ', Sport' : '') + (map ? ', carte ouverte' : '') + ')');
            }));
            mine.filter((w) => !PANEL(w)).forEach((a, i, m) => m.slice(i + 1).forEach((b) => {
                if (a.type === 'text' || b.type === 'text' || a.type === 'icon' || b.type === 'icon' || a.type === 'gmeter' || b.type === 'gmeter') assert(!hit(a, b) || a.id.replace(/_[a-z]+$/, '') === b.id.replace(/_[a-z]+$/, '') && (a.type === 'segbar' || b.type === 'segbar') === false, a.id + ' recouvre ' + b.id + ' (vue ' + view + ')');
            }));
        }));
    });
    // la vue « Conduite » : en Sport le G-mètre et deux lectures, hors Sport quatre rangées (icône, nom du réglage), avec leur trait de trois crans sauf M Blade
    if (name !== 'm') check(name + ' : la vue Conduite : G-mètre et lectures en Sport, les quatre réglages des modes sinon', () => {
        const mine = (w) => !/(^|&)mapUp$/.test(w.toggle) && !PANEL(w);       // the view with the map closed (M Blade's panel apart); M Blade's map-up copy is checked the same way below
        const g = xb.filter((w) => mine(w) && /driveSport$|driveSport&/.test(w.toggle) && !/!driveSport/.test(w.toggle)), r = xb.filter((w) => mine(w) && /!driveSport/.test(w.toggle));
        if (name === 'mblade') {
            const up = (w) => /(^|&)mapUp$/.test(w.toggle) && !PANEL(w);
            const g2 = xb.filter((w) => up(w) && /driveSport/.test(w.toggle) && !/!driveSport/.test(w.toggle)), r2 = xb.filter((w) => up(w) && /!driveSport/.test(w.toggle));
            assert.deepStrictEqual(g2.map((w) => w.type).sort(), g.map((w) => w.type).sort(), 'carte ouverte : le même G-mètre');
            assert.deepStrictEqual(r2.map((w) => w.text || w.icon).sort(), r.map((w) => w.text || w.icon).sort(), 'carte ouverte : les mêmes réglages');
        }
        assert.deepStrictEqual(g.map((w) => w.type).sort(), ['gmeter', 'text', 'text']);
        assert.deepStrictEqual(g.filter((w) => w.type === 'text').map((w) => w.text).sort(), ['{{gFwd}}', '{{gSide}}']);
        assert.deepStrictEqual(r.filter((w) => w.type === 'text').map((w) => w.text).sort(), ['{{setup:chassis}}', '{{setup:engine}}', '{{setup:gearbox}}', '{{setup:steering}}']);
        assert.strictEqual(r.filter((w) => w.type === 'icon').length, 4);
        const bars = r.filter((w) => w.type === 'segbar');
        assert.strictEqual(bars.length, 0, 'les traits sont dans le panneau (M Blade) ou la carte (Sport, Navi)');
        {
            const p = xb.find((w) => w.id === 'xb_vpan_dr' || w.id === 'xb_card_dr');
            assert(p && PANEL(p) && p.div === 3 && p.seg === 3 && p.toggle === 'viewSel=drive&!driveSport&!mapUp', 'le panneau des réglages');
            assert.deepStrictEqual(p.rows.map((x) => x.signal), ['setupLevel:engine', 'setupLevel:chassis', 'setupLevel:steering', 'setupLevel:gearbox']);
            p.rows.forEach((x) => assert(x.min === 0 && x.max === 3, x.signal + ' : trois crans'));
        }
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
        const o = { layoutViews: views, viewNow: null, saved, rebuilt: 0, _rebuild() { this.rebuilt++; rebuilt.push(this.viewNow); }, _rebuildSoft() { this._rebuild(); }, setting(k) { return HudApp.prototype.setting.call(this, k); } };
        o.ctx = { settings: { item: () => null, get: (k) => (k === 'viewSel' ? saved : undefined) } };
        o.can = false; o.mapLayout = true; o.mapOff = false;
        o._mapCan = function () { return this.can; }; o._wazeMapOn = HudApp.prototype._wazeMapOn;
        o.nextView = HudApp.prototype.nextView; o.views = HudApp.prototype.views; o._mapOpen = HudApp.prototype._mapOpen;
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
    // carte ouverte (propriétaire, 21 nov. 2026 : « quand il y a Waze, on supprime tout ce qui est lié au BC ») : aucune vue avec la carte
    const m = mk(['gauges', 'tyres'], 'none');
    m.nextView(); assert.strictEqual(m.setting('viewSel'), 'gauges');
    m.can = true;
    assert.strictEqual(m.setting('viewSel'), 'none', 'une vue reste avec la carte');
    // la touche BC cache la carte puis la ramène (propriétaire, 22 nov. 2026 : « le BC active la vue Waze, et quand je suis dans la vue Waze
    // je veux la désactiver aussi avec le BC ») : carte -> aucune -> vues -> carte
    assert.strictEqual(m.nextView(), 'none'); assert.strictEqual(m._wazeMapOn(), false, 'la carte devait se cacher');
    assert.deepStrictEqual([m.nextView(), m.nextView(), m.nextView()], ['gauges', 'tyres', 'map']);
    assert.strictEqual(m._wazeMapOn(), true, 'la carte devait revenir'); assert.strictEqual(m.setting('viewSel'), 'none');
    assert.strictEqual(m.nextView(), 'none'); assert.strictEqual(m._wazeMapOn(), false);
    // sans Waze, la carte n'est pas une étape
    const n = mk(['gauges'], 'none');
    assert.deepStrictEqual([n.nextView(), n.nextView()], ['gauges', 'none']);
    // un thème sans vue mais avec la carte : la touche bascule carte / sans carte
    const w = mk([], 'none'); w.can = true;
    assert.deepStrictEqual([w.nextView(), w.nextView(), w.nextView()], ['none', 'map', 'none']);
    // la fenêtre d'une autre appli (Cluster Centre) : pas de vue, la touche attend
    const o = mk(['gauges'], 'none'); o.windowOpen = true;
    assert.strictEqual(o.setting('viewSel'), 'none', 'ni avec la fenêtre de Cluster Centre');
    const b = o.rebuilt; assert.strictEqual(o.nextView(), 'none'); assert.strictEqual(o.rebuilt, b);
});
check('les dessins des vues reçoivent tous les mêmes réglages : ils sont bâtis sur la source de mpanel (un réglage oublié vaut 0 : la voiture des pneus de Sport avait disparu, 0.21.53)', () => {
    const src = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8'), sh = require('../shared/shaders');
    assert(!src.includes("if (w.type === 'mpanel') {"), 'un réglage réservé à mpanel');
    ['u_flip', 'u_bs', 'u_car'].forEach((u) => {
        assert(src.includes("c.uniform(ref, '" + u + "'"), u + " n'est pas envoyé");
        ['mpanel', 'sring', 'mblades', 'nline'].forEach((t) => assert(sh[t].indexOf('uniform float ' + u + ';') > 0, t + ' : ' + u));
    });
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
    h.layoutMode = 'sport'; assert.strictEqual(h.setting('driveSport'), true);
    ['hybrid', 'eco', 'electric', null].forEach((m) => { h.layoutMode = m; assert.strictEqual(h.setting('driveSport'), false, String(m)); });
    h._toggleOn = HudApp.prototype._toggleOn;
    h.layoutMode = 'sport'; assert.strictEqual(h._toggleOn('driveSport'), true); assert.strictEqual(h._toggleOn('!driveSport'), false);
    assert.strictEqual(h._toggleOn('viewSel=drive&driveSport'), false, 'viewSel n\'est pas drive ici : le réglage est vide');
    const src = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(src.includes("(this.driveLayout && (this.layoutMode === 'sport') !== this.driveShown)"), 'la reconstruction au changement de mode');
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

// dans CHAQUE vue (et carte ouverte ou non), aucun widget sous le voyant de ceinture ni sous la lettre de rapport de BMW : la fenêtre du rapport
// efface ce qui y passe (la barre du liquide de M, 176 px, y mordait : elle n'apparaissait jamais, 18 nov. 2026)
// le panneau des vues de M Blade (mpanel) : chaque rangée sa valeur entre min et max, son ton (froid, chaud, au-delà de la limite, turbo, gel)
check('le panneau de M Blade : les barres suivent leurs capteurs, avec la couleur de chacun, et rien n\'est renvoyé si rien n\'a changé', () => {
    const P = layout('mblade').widgets.find((w) => w.id === 'xb_vpan_g');
    const go = (vals, over, ice, now, x) => {
        const calls = [];
        x = x || { w: P, ref: 1, last: '', c: { uniform: (r, nm, v) => calls.push([nm, v]) } };
        x.c.uniform = (r, nm, v) => calls.push([nm, v]);
        const fake = { _raw: (k) => vals[k], _overLimit: (k) => (over === k ? k : null), setting: (k) => ({ oilCold: 75, coolantCold: 70 })[k],
            _ice: () => ({ on: !!ice }) };
        HudApp.prototype._update.call(fake, x, now || 0, false);
        const get = (nm) => (calls.find((c) => c[0] === nm) || [])[1];
        return { v: get('u_lvl'), t: get('u_tone'), x };
    };
    const r = go({ boost: 1, oil: 60, coolant: 95, ambient: 15 });
    assert(same(r.v, [0.5, 0.1, 0.45, 0.5]), 'niveaux : ' + r.v);
    assert(same(r.t, [5, 1, 2, 0]), 'tons (turbo, huile froide, liquide chaud, extérieur) : ' + r.t);
    assert(same(go({ boost: 1, oil: 60, coolant: 95, ambient: 1 }, null, true).t, [5, 1, 2, 1]), 'le gel : bleu');
    const seen = new Set();
    for (let t = 0; t < 2000; t += 50) seen.add(go({ boost: 1, oil: 140, coolant: 95, ambient: 15 }, 'oil', false, t).t[1]);
    assert.deepStrictEqual([...seen].sort(), [3, 4], 'au-delà de la limite : rouge et rouge sombre en alternance');
    const once = go({ boost: 1, oil: 60, coolant: 95, ambient: 15 });
    assert.strictEqual(go({ boost: 1, oil: 60, coolant: 95, ambient: 15 }, null, false, 0, once.x).v, undefined, 'renvoyé sans changement');
    // la forme : le panneau prolonge l'hexagone (mêmes haut et bas), sa pointe à gauche, dans la partie visible
    const visible = require(path.join(root, 'shared', 'visible.js'));
    assert(P.y === 167 && P.y + P.h === 589, 'le haut et le bas de l\'hexagone');
    assert(visible.hoodY(P.shape[0]) < P.shape[1] && visible.hoodY(P.shape[0] + P.shape[2] * (P.shape[1] - P.y)) < P.y, 'la pointe et le coin haut sous le capot');
    assert.strictEqual(require(path.join(root, 'shared', 'shaders.js')).mpanel.indexOf('uniform vec4 u_pan;') > 0, true);
});
check('les jetons à nombre négatif ou décimal sont résolus ({{tc:-20}} : -20 °C, -4 °F ; {{pc:2}} : 2 bar, 29 psi)', () => {
    const mk = (units) => { const h = Object.create(HudApp.prototype); h.setting = (k) => (k === 'units' ? units : undefined); h.ctx = { settings: { item: () => null, get: () => undefined } }; return h; };
    assert.strictEqual(mk('metric')._resolve('{{tc:-20}}'), '-20');
    assert.strictEqual(mk('us')._resolve('{{tc:-20}}'), '-4');
    assert.strictEqual(mk('us')._resolve('{{tc:15}}'), '59');
    assert.strictEqual(mk('metric')._resolve('{{pc:2}}'), '2');
    assert.strictEqual(mk('us')._resolve('{{pc:2}}'), '29');
    assert.strictEqual(mk('metric')._resolve('{{pc:0.5}}'), '0.5');
});
check('aucune vue ne met un widget sur les zones que BMW dessine (ceinture, lettre de rapport) ni dans le trou de la lettre de rapport', () => {
    const visible = require(path.join(root, 'shared', 'visible.js'));
    const on = (w, map, v, sp) => !w.toggle || w.toggle.split('&').every((part) => {
        const neg = part[0] === '!', k = neg ? part.slice(1) : part;
        const val = k.indexOf('viewSel=') === 0 ? (v || 'none') === k.slice(8) : k === 'driveSport' ? sp : k === 'mapUp' ? map : true;
        return val !== neg;
    });
    const bad = [];
    THEMES.forEach((name) => [false, true].forEach((map) => [[null, false], ['gauges', false], ['tyres', false], ['drive', true], ['drive', false]].forEach(([v, sp]) => {
        const ws = layout(name).widgets.filter((w) => on(w, map, v, sp) && !(w.w >= 1500));
        visible.check(ws, 'panel').filter((m) => !/under the hood/.test(m)).forEach((m) => bad.push(name + ' ' + (v || 'aucune') + (map ? ' carte' : '') + ' : ' + m));
        // et le trou de la lettre de rapport (taille par défaut) : une barre qui y mord est retirée par le moteur, un texte ou une icône poussé de 6 px au plus
        const hole = require(path.join(root, 'shared', 'gear_window.js')).pick('auto', name);
        ws.filter((w) => w.id.indexOf('xb_') === 0 && w.x < hole.x + hole.w && hole.x < w.x + w.w && w.y < hole.y + hole.h && hole.y < w.y + w.h)
            .forEach((w) => bad.push(name + ' ' + (v || 'aucune') + (map ? ' carte' : '') + ' : ' + w.id + ' dans le trou de la lettre de rapport x ' + hole.x + '..' + (hole.x + hole.w)));
    })));
    assert.deepStrictEqual(bad, []);
});

check('la limitation : panneau à fond blanc, anneau rouge, chiffre noir ; au-dessus de la limite, chiffre rouge, fond toujours blanc (22 nov. 2026)', () => {
    const { THEMES: TH } = require(path.join(tmp, 'shared', 'hud_themes.js'));
    if (!fs.existsSync(path.join(tmp, 'shared', 'hud'))) fs.symlinkSync(path.join(root, 'apps', 'shaktheme', 'hud'), path.join(tmp, 'shared', 'hud'));   // ShakTheme's fonts
    let over = false;
    const o = { theme: TH[Object.keys(TH)[0]], _limitNow: () => ({ text: '90', over }) };
    const w = { w: 92, h: 92, limitBy: true, icon: 'ring' };
    const px = (b, x, y) => Array.from(b.slice((y * 92 + x) * 4, (y * 92 + x) * 4 + 4));
    const inkOf = (b) => {     // the darkest and the reddest pixels inside the white disc
        let dark = 0, red = 0;
        for (let y = 30; y < 62; y++) for (let x = 25; x < 67; x++) { const [r, g, bl, a] = px(b, x, y); if (a > 200 && r < 80 && g < 80) dark++; if (a > 200 && r > 150 && g < 90) red++; }
        return { dark, red };
    };
    const under = HudApp.prototype._paintLimitSign.call(o, w, '90', 'hot');
    const [r0, g0, b0, a0] = px(under, 46, 14);                 // inside the ring, above the number: white
    assert(a0 === 255 && r0 > 230 && g0 > 230 && b0 > 230, 'fond blanc : ' + [r0, g0, b0, a0]);
    const [r1, g1, , a1] = px(under, 46, 3);                    // on the ring: red
    assert(a1 > 200 && r1 > 150 && g1 < 90, 'anneau rouge : ' + [r1, g1, a1]);
    const iu = inkOf(under); assert(iu.dark > 40 && iu.red === 0, 'chiffre noir : ' + JSON.stringify(iu));
    over = true;
    const hot = HudApp.prototype._paintLimitSign.call(o, w, '90', 'hot');
    const io = inkOf(hot); assert(io.red > 40 && io.dark === 0, 'au-dessus : chiffre rouge : ' + JSON.stringify(io));
    const [r2, g2, b2] = px(hot, 46, 14); assert(r2 > 230 && g2 > 230 && b2 > 230, 'au-dessus : fond toujours blanc');
    // le chiffre à part n'est plus dessiné : c'est l'anneau qui l'a
    const src = fs.readFileSync(path.join(root, 'shared', 'hud.js'), 'utf8');
    assert(/if \(w\.limitBy && w\.text === '\{\{limit\}\}'\) s = '';/.test(src));
});
fs.rmSync && fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? failed + ' FAILED' : 'sensor bars: ' + n + ' checks pass');
if (failed) process.exitCode = 1;
