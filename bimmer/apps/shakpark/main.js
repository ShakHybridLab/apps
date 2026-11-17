'use strict';
/**
 * ShakPark : la caméra avant (en D, sous 15 km/h) ou arrière (en R) dans la fenêtre centrale du thème du cluster
 * (shared/park_app.js, règles dans shared/park.js). L'image vient des fichiers /dev/shm/shakpark-front et shakpark-rear
 * que l'outil de capture écrit. Reste en fond comme toute appli OAP ; l'écran du centre montre les réglages.
 */
const mgu = require('./kit/mgu');
const { ParkApp } = require('./park_app');
const { stageOfStatus, stageOfSelection, speedOf } = require('./park');
const { ClusterRender } = require('./cluster_render_client');

mgu.run({
    start(ctx) {
        let app;
        try {
            const cfg = ctx.spec.config || {};
            app = new ParkApp({
                id: ctx.spec.id, log: ctx.log,
                setting: (k) => ctx.settings.get(k),
                makeRender: (target) => new ClusterRender(ctx.spec.id + '_' + target, cfg.socketPath),
                frontPath: process.env.SHAKPARK_FRONT || cfg.frontPath,
                rearPath: process.env.SHAKPARK_REAR || cfg.rearPath,
            });
            // la vitesse, relue chaque seconde : une voiture à l'arrêt ne notifie pas une vitesse qui ne change pas, et la
            // règle des 15 km/h veut une lecture récente. 65535 = « invalide » : transmis comme inconnu (speedOf).
            ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
                statusCarSpeed2: (v) => app.speed(speedOf(v)),
            }, ctx.log, { pollMs: 1000 }).then((s) => ctx.log.info('vitesse : ' + (s && s.error ? 'erreur : ' + s.error : 'abonné')));
            // le rapport : la position du sélecteur, par les deux signaux que ShakTheme lit déjà (le dernier à parler gagne)
            ctx.signals.watch('de.bmw.infrastructure.VehicleInformation', '1', {
                statusGearboxDrive: (v) => { const s = stageOfStatus(v && v.statusActualStageDrive); if (s !== undefined) app.gear(s); },
                DataPowerTrain2: (v) => { const s = stageOfSelection(v && v.statusGearSelectionDrive); if (s !== undefined) app.gear(s); },
            }, ctx.log).then((s) => ctx.log.info('rapport : ' + (s && s.error ? 'erreur : ' + s.error : 'abonné')));
            app.start();
        } catch (e) {
            // rien de dessiné, mais on reste en vie : une sortie ici compterait comme un plantage sur la voiture
            ctx.log.error('ShakPark n\'a pas démarré : ' + (e && e.stack || e));
            return;
        }
        process.on('exit', () => { try { app.stop(); } catch (e) { /* on sort de toute façon */ } });
    },
});
