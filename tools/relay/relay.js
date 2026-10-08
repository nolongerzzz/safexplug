#!/usr/bin/env node
'use strict';
// Run a swap relay on its own:  node tools/relay/relay.js [port] [host]     (defaults 18090 and 127.0.0.1)
const { createRelay } = require('../../src/core/relay');
const port = Number(process.argv[2]) || 18090, host = process.argv[3] || '127.0.0.1';
createRelay().listen(port, host).then((p) => console.log(`swap relay listening on http://${host}:${p}`), (e) => { console.error(String(e.message || e)); process.exit(1); });
