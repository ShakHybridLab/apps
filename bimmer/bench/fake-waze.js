'use strict';
/**
 * fake-waze.js - a stand-in for waze-on-cluster on the Mac bench, to test shared/waze.js ("Show Waze map inside
 * the theme"). It writes <dir>/status.json once a second like the real tool ({ state, target, ... }, 0644, by
 * rename) and listens on <dir>/ctl.sock for its newline JSON commands, logging each one and ignoring any it
 * doesn't recognise - like the real tool's Server::on_command, which only understands "guide", "cluster" and
 * "hud" and logs "unknown or malformed command" for anything else (re-read from its source 20 Nov 2026; an
 * earlier version of this file made up a "start"/"target" reply that the real tool never sends, which hid
 * shared/waze.js chasing that same imagined protocol on every bench run). Like the real control socket it has
 * one owner: with --busy N the first N connections get the "busy" status and are closed.
 *
 *   node bench/fake-waze.js bench/.data/waze [--state showing|idle] [--busy N]
 *   kill -USR1 <pid>   flips the state between showing and idle (the phone's map coming and going)
 *   then run the bench with WAZE_STATUS=<dir>/status.json
 * Bench only; never on the car.
 */
const fs = require('fs');
const net = require('net');
const path = require('path');

const args = process.argv.slice(2);
const dir = path.resolve(args[0] || 'bench/.data/waze');
const opt = (k, d) => { const i = args.indexOf('--' + k); return i > 0 ? args[i + 1] : d; };
let state = opt('state', 'showing'), busyLeft = Number(opt('busy', 0));
const target = 'map';         // the real tool's only target
const log = (s) => console.log(new Date().toISOString().slice(11, 19) + ' fake-waze: ' + s);

fs.mkdirSync(dir, { recursive: true });
const sockPath = path.join(dir, 'ctl.sock'), statusPath = path.join(dir, 'status.json');
try { fs.unlinkSync(sockPath); } catch (e) { /* none */ }

function writeStatus() {
    const s = { state, target, page: state === 'showing' ? 'Waze map, 15 frames/s' : null, reason: state === 'idle' ? 'Waiting for the phone\'s map' : null };
    fs.writeFileSync(statusPath + '.tmp', JSON.stringify(s) + '\n', { mode: 0o644 });
    fs.renameSync(statusPath + '.tmp', statusPath);
}
setInterval(writeStatus, 1000);
writeStatus();

let owner = null;
net.createServer((c) => {
    if (owner || busyLeft > 0) {
        if (busyLeft > 0) busyLeft--;
        log('second connection refused (busy)');
        c.end('{"ev":"status","state":"error","target":null,"page":null,"reason":"busy"}\n');
        return;
    }
    owner = c;
    c.write(JSON.stringify({ ev: 'status', state, target }) + '\n');     // report(): the only thing the real tool ever writes back, on connect and on every change
    let buf = '';
    c.setEncoding('utf8');
    c.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            let m = null;
            try { m = JSON.parse(line); } catch (e) { log('malformed line, owner dropped: ' + line); c.destroy(); return; }
            if (['guide', 'cluster', 'hud'].indexOf(m.cmd) >= 0) log('command ' + JSON.stringify(m));
            else log('unknown or malformed command ' + JSON.stringify(m) + ' (ignored, like the real tool)');
            // the real tool sends no reply to any command: its only output on this socket is the status line below, on connect and on change
        }
    });
    c.on('close', () => { if (owner === c) owner = null; log('owner disconnected'); });
    c.on('error', () => {});
}).listen(sockPath, () => log('listening on ' + sockPath + ', state ' + state + ', target ' + target + (busyLeft ? ', busy for ' + busyLeft : '')));

process.on('SIGUSR1', () => {
    state = state === 'showing' ? 'idle' : 'showing'; log('state -> ' + state); writeStatus();
    if (owner) owner.write(JSON.stringify({ ev: 'status', state, target }) + '\n');
});
