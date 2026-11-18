'use strict';
/**
 * ShakRadar (essai) : la position GPS de la voiture (GPSData) contre la liste des zones de danger de France ; tant qu'une zone est devant,
 * le fichier que lit l'alerte « zone de danger » de ShakTheme est écrit (shared/radar_app.js). L'écran montre tout pour une photo : ce que
 * la voiture envoie (brut), la position comprise et son échelle, la zone la plus proche, et si l'alerte part vers le thème.
 * Appli à part : GPSData n'a pas encore été vu accepté par la voiture, un refus ne touche qu'elle.
 */
const path = require('path');
const mgu = require('./kit/mgu');
const { RadarZones } = require('./radar_zones');
const { RadarApp, WITHIN_M } = require('./radar_app');
const { clip, wrap, show } = require('./signal_probe');

const GPS = 'de.bmw.infotainment.GPSData';
const WHY = {
    'turned off': 'éteinte',
    'no position yet': 'pas encore de position',
    'position not understood': 'position pas comprise (voir les valeurs brutes)',
    'position too old': 'position trop ancienne (plus de 5 s)',
    'in a zone': 'dans une zone de danger',
    'zone ahead': 'zone de danger devant',
    'zone behind': 'la zone est derrière : pas d\'alerte',
};

// l'échelle trouvée par gps_pos.js, en français ; les polices de l'écran n'ont pas les guillemets « », d'où les droits
const HOW = { 'degrees': 'degrés', '1e-6 degree': 'millionièmes de degré', '1e-7 degree': 'dix-millionièmes de degré', '1e-5 degree': 'cent-millièmes de degré',
    'milliarcsecond': 'millisecondes d\'arc', '1/1000 minute': 'millièmes de minute', 'turn / 2^31': 'demi-tour sur 2^31', 'turn / 2^32': 'tour sur 2^32', 'radians': 'radians' };
const howFr = (h) => { const m = /^(.*?)( from -90 \/ -180)?$/.exec(h || ''); return (HOW[m[1]] || m[1]) + (m[2] ? ', décalé de -90 / -180' : ''); };

mgu.run({
    start(ctx) {
        let app, sub = null;
        try {
            let zones = null, zonesWhy = '';
            try {
                const doc = require('./kit/pack').open(path.join(__dirname, 'zones')).json('radars_fr_zones.json');
                zones = new RadarZones(doc);
                zonesWhy = zones.zones.length + ' zones (liste du ' + (zones.version || '?') + ')';
            } catch (e) { zonesWhy = 'liste des zones illisible : ' + (e && e.message || e); }
            app = new RadarApp({ zones, log: ctx.log });
            app.start();
            ctx.signals.watch(GPS, '1', {
                GPSPositionCAN: (v) => { app.position(v); kick(); },
                GPSPositionExtendedCAN: (v) => { app.extended(v); kick(); },
            }, ctx.log, { pollMs: 1000 }).then((s) => { sub = s; ctx.log.info('GPSData : ' + (s && s.error ? s.error : 'abonné')); kick(); })
                .catch((e) => { sub = { error: String(e && e.message || e) }; });

            let loop = null;
            function kick() { if (loop && loop.kick) loop.kick(); }
            const render = () => {
                const s = app.state(), cv = ctx.canvas(1600, 520);
                const W = '#ffffff', D = '#dce4ef', G = '#91a0b4', OK = '#7fd4a0', BAD = '#ff6b6b', HI = '#ffd166';
                cv.clear('#090c12');
                cv.text('SHAKRADAR (ESSAI)', 40, 50, 28, W, { font: 'bold' });
                cv.text('La position GPS de la voiture et les zones de danger de France. Roule dehors, puis photographie l\'écran.', 40, 78, 16, G);
                const st = !sub ? 'ouverture…' : sub.error ? 'REFUSÉE : ' + clip(String(sub.error), 60)
                    : sub.failed && Object.keys(sub.failed).length ? 'abonnement refusé : ' + clip(Object.keys(sub.failed).map((k) => k + ' ' + sub.failed[k]).join(', '), 70)
                        : sub.available ? 'disponible' : 'la voiture ne répond pas';
                cv.text('GPSData : ' + st + '   ·   ' + zonesWhy, 40, 106, 16, sub && (sub.error || !sub.available) ? BAD : OK);
                // left: what the car sends, raw
                const raw = (label, v, n, y) => {
                    cv.text(label + ' : ' + n + ' msg', 40, y, 16, n ? W : G, { font: 'bold' });
                    wrap(v === null || v === undefined ? 'rien reçu' : show(v), 84, 3).forEach((t, j) => cv.text(t, 40, y + 20 + j * 16, 14, n ? D : G));
                };
                raw('GPSPositionCAN', s.raw.pos, s.raw.posN, 150);
                raw('GPSPositionExtendedCAN', s.raw.ext, s.raw.extN, 240);
                // what the app understood
                const p = s.pos;
                cv.text('Position comprise', 40, 340, 16, W, { font: 'bold' });
                cv.text(p ? p.lat.toFixed(5) + ' , ' + p.lon.toFixed(5) + '   (échelle : ' + howFr(p.how) + ', il y a ' + Math.round(p.age / 1000) + ' s)' : s.raw.posN ? 'pas comprise : envoie la photo des valeurs brutes' : 'rien reçu',
                    40, 362, 15, p ? OK : G);
                const e = s.ext || {};
                const f = (x, u) => (x === null || x === undefined ? '-' : (Math.round(x * 10) / 10) + u);
                cv.text('cap ' + f(e.heading, '°') + '   ·   altitude ' + f(e.altitude, '') + '   ·   qualité ' + f(e.quality, '') + '   ·   vitesse ' + f(e.speed, ''), 40, 386, 15, D);
                // right: the zone and the alert
                cv.text('ZONE DE DANGER', 900, 150, 16, G, { font: 'bold' });
                const z = s.zone;
                cv.text(WHY[s.why] || s.why, 900, 182, 22, z ? HI : D, { font: 'bold' });
                if (z) {
                    cv.text(z.inside ? 'dans la zone' : 'à ' + Math.round(z.edgeM) + ' m du bord de la zone', 900, 214, 18, W);
                    cv.text('limite : ' + (z.limit ? z.limit + ' km/h' : 'inconnue') + (z.wide ? '   ·   zone large (4 km)' : '   ·   zone de 2 km'), 900, 240, 16, D);
                } else cv.text('alerte à moins de ' + (WITHIN_M / 1000) + ' km du bord d\'une zone', 900, 214, 15, G);
                cv.text(s.writing ? 'Alerte envoyée au thème (ShakTheme)' : s.writeError ? 'Écriture impossible : ' + s.writeError : 'Rien envoyé au thème', 900, 290, 16, s.writing ? OK : s.writeError ? BAD : G, { font: 'bold' });
                cv.text('Dans ShakTheme : réglage "Alerte zone de danger" allumé.', 900, 316, 14, G);
                cv.text('Zones et non radars : la liste officielle des radars fixes, arrondie en zones de 2 km (4 km sur autoroute).', 40, 500, 14, G);
                return ctx.ui.image('MAIN_GFX', cv);
            };
            loop = ctx.loop('MAIN', 4, render);
            render();
            const timer = setInterval(kick, 1000);
            if (timer.unref) timer.unref();
        } catch (e) {
            ctx.log.error('ShakRadar n\'a pas démarré : ' + (e && e.stack || e));
            return;
        }
        process.on('exit', () => { try { app.stop(); } catch (e) { /* on sort */ } });
    },
});
