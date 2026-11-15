'use strict';
/**
 * RideTube on cluster: the video RideTube plays, in a cluster theme's centre window and on the HUD, ONLY WHILE THE CAR STANDS
 * (shared/video_app.js; the gate is shared/video_bridge.js Standing and has no switch). The centre screen shows the settings.
 * Stays up in the background like every OAP app.
 */
const mgu = require('./kit/mgu');
const { VideoApp } = require('./video_app');
const { ClusterRender } = require('./cluster_render_client');

mgu.run({
    start(ctx) {
        let app;
        try {
            const cfg = ctx.spec.config || {};
            app = new VideoApp({
                id: ctx.spec.id, log: ctx.log,
                setting: (k) => ctx.settings.get(k),
                makeRender: (target) => new ClusterRender(ctx.spec.id + '_' + target, cfg.socketPath),
                videoPath: process.env.RIDETUBE_VIDEO || cfg.videoPath,
            });
            // the speed, re-read every second: a standing car may not notify a speed that doesn't change, and the gate wants
            // fresh readings. 65535 = the car's "invalid": passed on as unknown, which shuts the gate.
            ctx.signals.watch('de.bmw.infotainment.vehicle.Vehicle2', '1', {
                statusCarSpeed2: (v) => {
                    const k = v && v.speedVehicleCentreOfGravity;
                    app.speed(typeof k === 'number' && k !== 65535 ? k * 0.015625 : null);
                },
            }, ctx.log, { pollMs: 1000 }).then((s) => ctx.log.info('speed: ' + (s && s.error ? 'error: ' + s.error : 'subscribed')));
            app.start();
        } catch (e) {
            // nothing drawn, but stay up: an exit here would count as a crash on the car
            ctx.log.error('RideTube on cluster failed to start: ' + (e && e.stack || e));
            return;
        }
        process.on('exit', () => { try { app.stop(); } catch (e) { /* exiting anyway */ } });
    },
});
