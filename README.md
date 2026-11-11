# Boost Recovery Lab

**A lost response must not become a second podcast boost.**

A loopback-only Cashu fault proxy, executable recovery example, and regression suite for wallet and Value4Value developers. Deliberately lose the response **after** the mint consumes a listener's proofs. Restart the client. Recover the original creator token with NUT-09 instead of constructing another payment.

The demo starts with **32 fake sats**, sends **13** to a creator, preserves **19** in listener change, and proves the creator cannot redeem the same token twice. No account, Lightning node, deposit, or external network is needed after dependency installation.

## Run in about 30 seconds

Requires Node.js 22.4 or newer and npm.

```sh
npm ci --ignore-scripts
npm test
npm run demo
# Or run both verification steps:
node verify.mjs
```

The final demo record should include:

```json
{"step":"creator-redeemed","creatorBalance":13,"senderChange":19,"duplicateRedemption":"rejected","paymentSwaps":1,"receiverSwaps":1,"secondRecovery":"same token; no new swap","result":"PASS"}
```

This is actual Cashu blind-signature cryptography over HTTP with `@cashu/cashu-ts` 4.13.1. The bundled mint verifies input signatures, conserves amounts including input fees, tracks spent proofs, issues DLEQ proofs and supports NUT-09 restoration. It has **no real funds**. The mint is a small test fixture, not a production mint or full Cashu implementation. Keys and balances disappear when the process stops.

## The bug this makes reproducible

```mermaid
sequenceDiagram
  participant L as Listener
  participant J as Private journal
  participant P as Fault proxy
  participant M as Test mint
  participant C as Creator
  L->>J: Persist inputs, secrets and blinded outputs; fsync
  L->>P: POST /v1/swap
  P->>M: Forward exact request
  M->>M: Consume inputs; sign outputs
  M-->>P: Signatures
  P--xL: Drop connection
  Note over L: Uncertain, not failed. Restart is safe.
  L->>J: Load original operation
  L->>M: NUT-09 restore original blinded outputs
  M-->>L: Original signatures with DLEQ
  L->>J: Persist recovered token and change
  L->>C: Original 13-sat creator token
  C->>M: Redeem once
```

A network exception cannot tell a listener whether a boost was paid. Spending a new set of proofs on retry can pay twice; discarding spent inputs without saving output secrets can lose the value. This lab makes both failure boundaries visible to app developers.

## Use the proxy with your own local test mint

```sh
node src/cli.mjs proxy \
  --upstream http://127.0.0.1:3338 \
  --mode drop-after --port 3339
```

Point your **test client's swap/restore transport** at `http://127.0.0.1:3339`. Provision test proofs with your mint's own fixture/faucet first. Preserve the canonical mint identity in your application's wallet store; the proxy is a transport test seam, not a second mint. The included demo uses the proxy URL consistently as its disposable mint identity.

The proxy forwards only `info`, `keys`, `keysets`, `swap`, `restore` and `checkstate`. It is not a full wallet gateway: minting, melting, auth, Nostr, and WebSocket endpoints are intentionally outside this lab. It never follows redirects and only accepts an explicit `http://127.0.0.1:PORT` upstream. Do not point it at a mint holding real money. A loopback URL alone does not prove a mint is fake.

Each injected fault fires **once**, then subsequent requests pass. Ctrl-C prints a JSON transcript of method, endpoint, request hash, fault and upstream status. It contains no proof secrets, tokens, signatures or body content.

| Mode | Injected boundary |
|---|---|
| `pass` | Baseline |
| `drop-before` | Connection closes before forwarding swap |
| `http-503-before` | Service error before forwarding swap |
| `drop-after` | Mint response fully received, connection closes before returning it |
| `truncate-after` | Mint commits; client sees an empty signatures array |
| `partial-restore` | Remove one restore output/signature pair |
| `empty-restore` | Hide all restored outputs |
| `bad-dleq-restore` | Corrupt a restored DLEQ proof |
| `reverse-restore` | Reverse output/signature pairs to test keyed matching |

Use `startProxy()` and `.arm(mode)` from `src/fault-proxy.mjs` to compose scenarios. Fault transcripts describe observed HTTP behavior, not proof of a real mint's internal commit. The bundled fixture supplies independent swap counters for those assertions.

## Recovery module

```js
import { prepare, send, recover, creatorToken } from './src/recovery.mjs';

// proofs come from your LOCAL TEST mint. No payment happens in prepare().
await prepare('./.state/episode-42.journal.json', testMintURL, 13, proofs);
const first = await send('./.state/episode-42.journal.json');
const final = first.state === 'uncertain'
  ? await recover('./.state/episode-42.journal.json')
  : first;
// Handle this privately; never include tokens in analytics, logs or screenshots.
const token = creatorToken('./.state/episode-42.journal.json');
```

`prepare()` persists the SDK's exact serialized swap preview, including output secrets and blinding factors, before any swap. Atomic replacement and file/directory fsync protect committed journal writes on POSIX filesystems. `send()` marks the operation uncertain **before** sending, and refuses to resubmit an uncertain operation. `recover()`:

1. Asks NUT-09 for the **original** blinded outputs.
2. Matches returned output/signature pairs by `B_`, validates keyset/amount and DLEQ, and reconstructs the original token and change.
3. If none were restored, checks all input proofs. Only when all are unspent does it replay the **same saved** swap. This does not generate fresh payment outputs.
4. Refuses partial, inconsistent, missing-DLEQ or corrupted restores; spent/pending inputs without outputs remain unresolved.
5. Returns an already-completed journal unchanged, even after the creator redeems its token.

The reference module deliberately requires DLEQ for restored signatures. It does not assume NUT-19 cached responses; mints without NUT-09/NUT-12 are outside its supported recovery path. If a mint advertises NUT-19, its SDK transport may replay identical requests internally; fault transcripts show what actually happened.

## What the tests establish

Real HTTP tests cover pre/post-commit loss, malformed responses, a new Node process loading the journal, reordering, DLEQ corruption, missing restore data, fees, unselected proofs, private file permissions, concurrent writers, forged inputs, same-token reuse and duplicate redemption. A fresh SDK receiver redeems the resulting token at the mint. This is interoperability with cashu-ts, not certification across every mint implementation.

`npm run demo` is deterministic in its **amounts and invariants**, not its random keys, ports or cryptographic hashes. No mainnet or public test-mint claims are made.

## Limits and safe integration

This is a test instrument and recovery example, **not a production wallet**. A real application additionally needs transactional proof reservation across all payments, a durable database, recipient authentication, delivery acknowledgement, mint trust policy, balance reconciliation and backups. Returning a token is not evidence that its recipient received or redeemed it. Bearer tokens remain bearer tokens; no recipient locking is implemented here.

Journals contain spendable material. Keep them owner-only and outside Git. The demo removes its temporary test material after completion. The module fails closed if another writer holds the journal's `.lock`. An abruptly killed process can leave that lock: verify the recorded PID is no longer running before removing **only that stale lock**, then run `recover`. Never delete the journal to resolve an uncertain payment. A hostile or broken mint can deny restore forever; preserving a journal does not guarantee recovery.

## November scope and related work

Created for [Nut November 2026](https://nutnovember.org/), with all project code, documentation and tests started November 11. Existing dependencies are credited rather than claimed as new work. The Cashu SDK already offers prepared swaps and serialization; this project contributes a composable fault proxy, persistent reference recovery and end-to-end fault scenarios around those primitives.

The Value4Value connection is concrete: podcast boosts and streaming clients need reliable recovery when a listener loses connectivity. This complements creator tipping widgets and split-payout applications; it does not claim to replace them or to invent Cashu recovery.

Built on [cashu-ts](https://github.com/cashubtc/cashu-ts), [NUT-03 swaps](https://github.com/cashubtc/nuts/blob/main/03.md), [NUT-07 proof states](https://github.com/cashubtc/nuts/blob/main/07.md), [NUT-09 restore](https://github.com/cashubtc/nuts/blob/main/09.md) and [NUT-12 DLEQ](https://github.com/cashubtc/nuts/blob/main/12.md). Cryptographic operations use cashu-ts and Noble Curves. MIT licensed; dependencies retain their respective licenses.
