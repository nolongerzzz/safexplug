'use strict';
// Parts of the wallet that are built but not switched on in this version.
// sell: the Sell tab (create a seller account, list items). Start the wallet with SAFEX_SELL=1 to use it.
// swap: the Swap tab. On by default; SAFEX_SWAP=0 switches it off.
module.exports = { swap: process.env.SAFEX_SWAP !== '0', sell: process.env.SAFEX_SELL === '1' };
