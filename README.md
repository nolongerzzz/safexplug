# safexplug

Desktop helpers for Safex (SFX / SFT): a miner with its own node, and a wallet that syncs against your own node. Both are MIT licensed and run on Windows, Mac and Linux.

**Status: pre-release.** Each app lives on its own branch while its features and first release version are being settled, so `main` holds only this page. There is no tagged release yet.

## The two apps

| App | What it does | Branch | Download |
| --- | --- | --- | --- |
| **SAFEX SOLO-SYNC Node+Mine** | Runs a Safex node and mines against it (solo or pool), with live hashrate, a list of all your rigs, and view-only payments. | [`solo-sync-node-mine`](https://github.com/nolongerzzz/safexplug/tree/solo-sync-node-mine) | [zip](https://github.com/nolongerzzz/safexplug/archive/refs/heads/solo-sync-node-mine.zip) |
| **SAFEX SOLO-SYNC Wallet** | Desktop wallet for SFX and SFT: send, receive, history, staking, explorer, marketplace and peer-to-peer swaps. | [`solo-sync-wallet`](https://github.com/nolongerzzz/safexplug/tree/solo-sync-wallet) | [zip](https://github.com/nolongerzzz/safexplug/archive/refs/heads/solo-sync-wallet.zip) |

Each branch has its own README with install steps for Linux, Mac and Windows. The miner has a **Wallet** button that opens the wallet, and the wallet can use the node the miner runs. Neither app needs the other.

## How they handle your keys

Neither app asks for a seed or a private key. The wallet's create and recover steps open the official wallet tool's own terminal window, so seed words are typed only there. The miner asks only for your public address, plus a view key if you turn on Payments, and a view key cannot spend. Every wallet send is two steps: the transaction is built, you see the exact amount, address and fee, and only your confirmation sends it.

## Built on existing tools

These apps wrap existing software rather than replacing it: the miner uses [xmrig](https://github.com/xmrig/xmrig) as its mining engine, and the wallet runs the official Safex wallet tools (safexcore) on your own computer.

## Before you use it

- This is early software and it has not been independently audited. The wallet handles real funds, so test with a small amount first and keep your 25 seed words written down on paper.
- On Linux the Node tab uses Docker. On Mac the official release has no wallet tools, so you build them once from the safexcore source (the wallet's README explains how), and Mac swaps are not available yet.
- Antivirus programs often flag mining engines. If yours removes the engine, restore it and add an exception for the app folder.
