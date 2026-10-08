# SAFEX SOLO-SYNC Wallet

A desktop wallet for Safex Cash (SFX) and Safex Token (SFT). It runs the official Safex wallet program on your own computer and syncs against **your own node**, so no website or account sits between you and your coins. Linux, Mac and Windows. MIT licensed.

- **Home:** your SFX and SFT balances, send, receive, saved addresses, and recent activity. SFX and SFT can go out together in one transaction.
- **History:** every transaction, in and out, with its details.
- **Market:** browse the Safex marketplace and buy listings.
- **Staking:** stake SFT, see your interest, and unstake.
- **Swap:** trade SFT for SFX directly with another wallet, with no middleman holding anything.
- **Explorer:** look up blocks and transactions from your own node.
- **Help:** plain-language answers, searchable, plus the wallet tool's own command list.

## Install

You need a few hundred MB of free disk space, plus a Safex node to connect to. By default the wallet looks for one on this computer (`127.0.0.1:17402`). The SAFEX SOLO-SYNC Node+Mine app can run that node for you.

### Linux

1. Unpack the wallet folder into your home folder (the miner looks for `~/safex-wallet`).
2. In a terminal in that folder run `bash install.sh`. It installs Node.js if needed, sets the app up and adds a menu entry.
3. Open **Safex SOLO-SYNC Wallet** from your menu, or run `npm start`.

On first run the wallet offers to download the official wallet tools (safexcore 7.0.3) and checks them against the published checksums.

### Mac

1. Unpack the wallet folder into your home folder.
2. In Terminal in that folder run `bash install.sh`, then `npm start`.
3. The official release has no Mac wallet tools, so you build them once from the safexcore source. The wallet then copies them for you (Help, Wallet tool options, Update wallet tools). To send SFX and SFT in one transaction, run `bash tools/mac-build-mixed.sh` afterwards.

### Windows

1. Unpack the wallet folder.
2. Double-click `tools\start-windows.cmd`. The first run downloads the app runtime for you.

## First run

1. **Wallet tools.** If the wallet asks, press the download button. Linux downloads and verifies the official tools. On a Mac see above.
2. **Create or open a wallet.** Create and Recover open the wallet tool's own terminal window. Your seed words and keys appear and are typed only there. This app never sees them. Write the 25 seed words on paper before you do anything else.
3. **Connect to your node.** Leave the default if your node is on this computer. Otherwise type your node's address, for example `192.168.1.20:17402`.
4. **Wait for it to sync.** The chip at the top turns to Synced. Balances are only trustworthy once it has.

## Sending

Every send is two steps. The wallet tool builds the transaction without sending it, the screen shows the exact amount, address and fee, and only your confirmation sends that same transaction. The confirmation box then shows the transaction ID with a Copy button.

- **Saved addresses** are kept per wallet, so one wallet's contacts never appear in another.
- **Send everything** fills the amount box with everything available.
- **SFX + SFT in one transaction.** The "Also send SFT" field adds tokens to an SFX send. It needs a wallet tool that supports it. Help tells you whether yours does.
- **Split coins** and **Sweep dust** tidy up your outputs. A coin used in a send is unavailable until its change comes back, so splitting a large balance into several coins lets you make several sends in a row. Sweeping gathers small SFX outputs that are too small to send on their own.

## Swap

A swap is one ordinary transaction that two wallets sign together: one signs the tokens, the other signs the cash. Nothing is held by anyone in between, and neither side can change what the other agreed to. Offers are posted to a board (a small relay). Both wallets need the swap-capable wallet tool, which comes with the app on Linux. A Mac version is not available yet. Open the Swap tab, read an offer, and every amount and fee is shown before anything is sent. The Help tab explains the steps.

## Using it with the miner

SAFEX SOLO-SYNC Node+Mine has a **Wallet** button that opens this wallet, or brings it forward if it is already open. The miner's Payments tab uses its own view-only wallet (port 18082), while this wallet uses 18083, so both run together. Nothing in this wallet needs the miner.

## Updating

Download `safex-wallet-<version>-update.tar.xz` into your Downloads folder. An **Update** button appears in the header. Click it twice, once to start and once to confirm. The app unpacks the update over its own folder and restarts.

## How it handles secrets

- Seed words and keys are typed and shown only in the wallet tool's own terminal window.
- Your wallet password is typed here, sent once to the wallet tool to open the wallet, and is never written to disk or put on a command line.
- Antivirus programs can be wary of unsigned wallet software. Download only from places you trust.

## Developing

```sh
npm install
npm start          # run the app
npm test           # unit checks (uses a fake wallet tool)
```

## License

MIT
