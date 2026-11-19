'use strict';
/**
 * ShakLimites (essai) : la limitation de vitesse de la route d'après une carte (shared/limits_map.js, fabriquée depuis OpenStreetMap par
 * tools/build_limits.py) et la position GPS de la voiture ; ShakTheme l'affiche dans son rond de limitation (shared/limits_app.js écrit le
 * fichier que shared/speedlimit.js lit ; le panneau lu par la caméra de la voiture, quand elle en lit, passe devant).
 * Appli à part : la carte pèse plusieurs Mo, le thème ne doit ni grossir ni dépendre d'elle. L'écran montre tout pour une photo.
 */
const path = require('path');
const mgu = require('./kit/mgu');
const { LimitsMap } = require('./limits_map');
const { LimitsApp } = require('./limits_app');

const WHY = {
    'no position yet': 'pas encore de position',
    'position not understood': 'position pas comprise',
    'position too old': 'position trop ancienne (plus de 5 s)',
    'no map': 'carte absente : elle n\'a pas encore été fabriquée',
    'no road with a limit here': 'pas de route connue avec une limitation ici',
    'on the road': 'sur la route',
    'standing': 'à l\'arrêt : la dernière limite est gardée',
};
const CLS = ['autoroute', 'voie rapide', 'route principale', 'route secondaire', 'petite route', 'rue'];

mgu.run({
    start(ctx) {
        require('./survive').install(ctx.log);       // une erreur que personne n'a rattrapée ne ferme pas l'appli (shared/survive.js)
        let app, sub = null;
        try {
            let map = null, mapWhy = 'carte absente';
            try {
                map = new LimitsMap(require('./kit/pack').open(path.join(__dirname, 'limits')));
                const i = map.index;
                mapWhy = i ? 'carte du ' + i.date + ' : ' + i.ways + ' routes, ' + i.km + ' km' : 'carte absente : elle n\'a pas encore été fabriquée';
            } catch (e) { mapWhy = 'carte illisible : ' + (e && e.message || e); }
            app = new LimitsApp({ map, log: ctx.log });
            app.start();
            let loop = null;
            const kick = () => { if (loop && loop.kick) loop.kick(); };
            ctx.signals.watch('de.bmw.infotainment.GPSData', '1', { GPSPositionCAN: (v) => { app.position(v); kick(); } }, ctx.log)
                .then((s) => { sub = s; ctx.log.info('GPSData : ' + (s && s.error ? s.error : 'abonné') + ' ; ' + mapWhy); kick(); })
                .catch((e) => { sub = { error: String(e && e.message || e) }; });
            const render = () => {
                const s = app.state(), cv = ctx.canvas(1600, 520);
                const W = '#ffffff', D = '#dce4ef', G = '#91a0b4', OK = '#7fd4a0', BAD = '#ff6b6b', HI = '#ffd166';
                cv.clear('#090c12');
                cv.text('SHAKLIMITES (ESSAI)', 40, 50, 28, W, { font: 'bold' });
                cv.text('La limitation de la route d\'après la carte et le GPS. Roule sur une grande route, puis photographie l\'écran.', 40, 78, 16, G);
                const st = !sub ? 'ouverture…' : sub.error ? 'REFUSÉ : ' + String(sub.error).slice(0, 60) : sub.available ? 'disponible' : 'la voiture ne répond pas';
                cv.text('GPS : ' + st + '   ·   ' + mapWhy, 40, 106, 16, sub && (sub.error || !sub.available) ? BAD : OK);
                const p = s.pos;
                cv.text('Position', 40, 160, 16, W, { font: 'bold' });
                cv.text(p ? p.lat.toFixed(5) + ' , ' + p.lon.toFixed(5) + '   (il y a ' + Math.round(p.age / 1000) + ' s, ' + s.raw.n + ' messages)' : s.raw.n ? 'pas comprise (' + s.raw.n + ' messages)' : 'rien reçu', 40, 184, 15, p ? OK : G);
                cv.text('Cap (d\'après le déplacement) : ' + (s.heading === null ? 'pas encore, la voiture n\'a pas bougé' : Math.round(s.heading) + '°'), 40, 210, 15, D);
                const m = s.last;
                cv.text('Route trouvée', 40, 260, 16, W, { font: 'bold' });
                cv.text(m ? (CLS[m.cls] || 'route') + ' limitée à ' + m.limit + ' km/h, à ' + Math.round(m.dist) + ' m' + (m.oneway ? ', sens unique' : '') : 'aucune', 40, 284, 15, m ? D : G);
                if (s.cand) cv.text('en attente de confirmation : ' + s.cand.limit + ' km/h', 40, 310, 15, HI);
                cv.text('LIMITATION', 900, 160, 16, G, { font: 'bold' });
                cv.text(s.limit === null ? '--' : s.limit + ' km/h', 900, 220, 54, s.limit === null ? G : HI, { font: 'bold' });
                cv.text(WHY[s.why] || s.why, 900, 256, 16, D);
                cv.text(s.writing ? 'Envoyée au thème (ShakTheme, rond de limitation)' : s.writeError ? 'Écriture impossible : ' + s.writeError : 'Rien envoyé au thème', 900, 300, 16, s.writing ? OK : s.writeError ? BAD : G, { font: 'bold' });
                cv.text('Le panneau lu par la caméra de la voiture passe devant la carte.', 900, 326, 14, G);
                cv.text('Grandes routes seulement. Ni travaux ni limites temporaires. Carte : contributeurs d\'OpenStreetMap (ODbL).', 40, 500, 14, G);
                return ctx.ui.image('MAIN_GFX', cv);
            };
            loop = ctx.loop('MAIN', 4, render);
            render();
            const timer = setInterval(kick, 1000);
            if (timer.unref) timer.unref();
        } catch (e) {
            ctx.log.error('ShakLimites n\'a pas démarré : ' + (e && e.stack || e));
            return;
        }
        process.on('exit', () => { try { app.stop(); } catch (e) { /* on sort */ } });
    },
});
