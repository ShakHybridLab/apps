'use strict';
/**
 * ShakTheme: redraws the iDrive 7 instrument cluster (the 1920x720 "panel" target) through cluster-render.
 *
 * The center screen is the app's own page (shared/page.js, a canvas screen): the themes with their
 * pictures, which drive mode shows which, and the settings. Each choice is saved in the app's data/settings.json
 * by the kit; the shared engine (hud.js) listens and redraws at once. It keeps running after the page is
 * closed (OAP apps stay up in the background), so the page is only needed for changes. The kit's own
 * settings list stays one tap away (the bar's All settings).
 */
const mgu = require('./kit/mgu');
const HudApp = require('./hud');
const Page = require('./page');

mgu.run({
    start(ctx) {
        require('./survive').install(ctx.log);       // une erreur que personne n'a rattrapée ne ferme pas l'appli (shared/survive.js)
        let hud;
        try {
            hud = new HudApp(ctx);
        } catch (e) {
            // nothing drawn, but stay up: an exit here would count as a crash on the car
            ctx.log.error('Cluster failed to start: ' + (e && e.stack || e));
            return;
        }
        hud.start();
        // l'alerte « zone de danger » sans appli à part (demande du propriétaire, 19 nov. 2026) : la position GPS de la voiture contre la liste des
        // zones de France (shared/radar_app.js, comme ShakRadar), tant que le réglage « Alerte zone de danger » est allumé. Rien ici ne peut
        // empêcher le thème de démarrer : une erreur est écrite au journal, le thème continue sans l'alerte.
        let radar = null;
        try {
            const { RadarZones } = require('./radar_zones');
            const { RadarApp } = require('./radar_app');
            const zones = new RadarZones(require('./kit/pack').open(require('path').join(__dirname, 'zones')).json('radars_fr_zones.json'));
            radar = new RadarApp({ zones, log: ctx.log, file: 'danger-shaktheme.json', app: 'ShakTheme', enabled: () => ctx.settings.get('dangerAlert') === true, everyMs: 1900,
                // la zone passe aussi en mémoire au thème : sur la voiture, le fichier ne pouvait pas être écrit (« écriture EACCES », 22 nov. 2026)
                onZone: (o) => { if (hud.danger) { hud.danger.feed(o); hud.danger.scan(); } } });
            radar.start();
            hud.radar = radar;
            ctx.signals.watch('de.bmw.infotainment.GPSData', '1', {
                GPSPositionCAN: (v) => radar.position(v),       // (le cap, l'altitude et la vitesse du GPS ne servent pas à l'alerte : pas lus ici)
            }, ctx.log).then((s) => ctx.log.info('GPSData : ' + (s && s.error ? s.error : 'abonné') + ', ' + zones.zones.length + ' zones de danger'))
                .catch((e) => ctx.log.warn('GPSData : ' + (e && e.message || e)));
        } catch (e) { ctx.log.warn('alerte zone de danger : pas démarrée (' + (e && e.message || e) + ')'); }
        // la touche BC au bout du commodo des clignotants fait défiler les vues du thème (demande du propriétaire, 19 nov. 2026). Sur sa voiture
        // (ShakManette), IndicatorSteeringColumn.operationColumnStalks vaut 64 pendant l'appui et 0 au relâcher : un appui = le passage de « sans 64 » à
        // « avec 64 ». Lecture seule : la voiture change aussi son propre ordinateur de bord, comme avant.
        try {
            const bc = new (require('./bc_button').BcButton)(() => { if (ctx.settings.get('bcViews') !== false) ctx.log.info('touche BC : vue ' + hud.nextView()); });
            ctx.signals.watch('de.bmw.body.Light', '1', { IndicatorSteeringColumn: (v) => bc.value(v) }, ctx.log)
                .then((s) => ctx.log.info('commodo : ' + (s && s.error ? s.error : 'abonné')))
                .catch((e) => ctx.log.warn('commodo : ' + (e && e.message || e)));
        } catch (e) { ctx.log.warn('touche BC : pas démarrée (' + (e && e.message || e) + ')'); }
        new Page(ctx, hud, {
            title: ctx.spec.title, what: 'cluster',
            look: { name: 'Themes', style: 'hero', tags: { m: 'M8 style', sport: 'Live Cockpit', mblade: 'blue card · red blade', navi: 'speed band · big map' } },
            tabs: ['look', 'badge', 'map', 'alerts', 'display', 'signals', 'settings'],
            settings: ['units', 'clock', 'timeZone', 'tankLitres', 'evRangeFull', 'reserveKm', 'reservePct', 'tyreLow', 'speedZone', 'startupSweep', 'limitRing', 'launchTimer', 'launchReady', 'launchRpm', 'accentByMode', 'iceBelow', 'evShare', 'redline', 'shiftBefore', 'coldGuard', 'showBoost', 'demo'],
            display: ['bcViews', 'viewSel', 'gFlipLat', 'gFlipLong', 'sportTint', 'sportFacets', 'sportPower', 'stockShiftLight', 'shiftLightRed', 'shiftLightFlash', 'nightDim', 'gearWindow', 'cameraNotch'],
        }).start();
        process.on('exit', () => { try { hud.stop(); if (radar) radar.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
