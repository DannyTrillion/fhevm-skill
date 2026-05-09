---
name: fhevm
description: Use this skill when building, testing, or debugging Solidity contracts that use Zama's FHEVM (Fully Homomorphic Encryption on EVM). Covers @fhevm/solidity v0.11.x, @fhevm/hardhat-plugin v0.4.x, @zama-fhe/relayer-sdk v0.4.x, and OpenZeppelin Confidential Contracts (ERC-7984 v0.3.x). Trigger keywords include imports of `@fhevm/solidity` or `@openzeppelin/confidential-contracts`, types `euint*` / `ebool` / `eaddress` / `externalEuint*`, calls to `FHE.fromExternal` / `FHE.allow*` / `FHE.select` / `FHE.makePubliclyDecryptable`, the `@zama-fhe/relayer-sdk` package, `confidentialTransfer`, "FHEVM", "Zama", "encrypted Solidity", "confidential token".
---

# FHEVM (Zama Fully Homomorphic Encryption for Solidity)

Build Solidity contracts whose state is encrypted on-chain. The chain stores
opaque ciphertext **handles**; an off-chain **coprocessor** does the FHE
arithmetic; a sharded **KMS / Gateway** decrypts on demand for addresses the
contract has explicitly authorized.

> **Stale-knowledge warning.** If a snippet imports `TFHE` (renamed to `FHE`)
> or calls `FHE.requestDecryption` (removed; replaced by off-chain decrypt +
> on-chain `FHE.checkSignatures`), it's outdated. Rewrite against the API
> documented here.

This skill was authored against a working repo where every Solidity pattern
below has been compiled, tested with the FHEVM Hardhat plugin's mock node,
and the cited error strings were captured from real test runs.

### Verified working examples (this repo)

| Pattern | Contract | Test |
|---|---|---|
| Encrypted counter | [contracts/FHECounter.sol](contracts/FHECounter.sol) | [test/FHECounter.ts](test/FHECounter.ts) |
| `FHE.select` + public reveal | [contracts/EncryptedMax.sol](contracts/EncryptedMax.sol) | [test/EncryptedMax.ts](test/EncryptedMax.ts) |
| ERC-7984 confidential token | [contracts/MyConfidentialToken.sol](contracts/MyConfidentialToken.sol) | [test/MyConfidentialToken.ts](test/MyConfidentialToken.ts) |
| Anti-pattern catalog (6 deliberate mistakes) | [contracts/BadFHECounter.sol](contracts/BadFHECounter.sol) | [test/FHECounter.mistakes.ts](test/FHECounter.mistakes.ts) |

Every error string in [§13](#13-anti-patterns-reference-each-verified-by-a-passing-test)
was captured from `test/FHECounter.mistakes.ts`. Run `npx hardhat test`
to reproduce.

### Frontend / deploy templates

| Template | Purpose |
|---|---|
| [templates/frontend-fhevm-singleton.ts](templates/frontend-fhevm-singleton.ts) | Singleton `getFhevmInstance()` for React / Next.js |
| [templates/frontend-user-decrypt.ts](templates/frontend-user-decrypt.ts) | EIP-712 user-decrypt helper |
| [templates/encrypted-input-form.tsx](templates/encrypted-input-form.tsx) | Reference React form: encrypt → submit |
| [templates/deploy-with-frontend-handoff.ts](templates/deploy-with-frontend-handoff.ts) | hardhat-deploy script that writes `{ address, chainId, abi }` for the frontend |

---

## 1. Mental model — five rules to lock in

1. **A `euint32` is a `bytes32` handle, not a value.** The handle lives in
   contract storage; the actual ciphertext lives in the coprocessor. Cheap
   to move, store, and pass between contracts.
2. **Possession ≠ permission.** Every ciphertext has a per-address ACL.
   Holding a handle does not let you use it; you must be on the ACL
   (granted via `FHE.allow*`) or supply a proof for it (via
   `FHE.fromExternal`).
3. **Fresh op results live for one transaction.** The result of any FHE
   operation is allowed only for `address(this)` and only until the tx
   ends. To persist, call `FHE.allowThis(handle)` immediately after.
4. **Control flow cannot depend on encrypted data.** `if (ebool)`,
   `require(ebool)`, `&&` / `||` on `ebool` — none compile, and even if
   they did they'd leak. Use `FHE.select(cond, a, b)`.
5. **`bytes32(0)` is the absence of a handle, not "encrypted zero".** It
   cannot be decrypted. Operations treat it as a literal zero, but the
   relayer rejects it with `Handle is not initialized`.
6. **ACL is per-handle, not per-storage-slot.** Every FHE op
   (`add`, `sub`, `select`, …) returns a *new* handle. Reassigning a
   storage slot to that new handle does **not** carry forward the old
   handle's ACL. After every reassignment, re-grant: `FHE.allowThis(h);
   FHE.allow(h, user);`. This is the single most common source of "tx
   succeeded but I can't decrypt" bugs.

---

## 2. Architecture in one paragraph

A Solidity contract holds `bytes32` handles. When it calls `FHE.add(a, b)`,
it emits an event the **coprocessor** watches; the coprocessor produces a
new ciphertext and registers a new handle. The on-chain **ACL contract**
records which addresses can use which handle. When a user wants plaintext,
they sign an EIP-712 message and ask the **Gateway / relayer**; the **KMS**
(threshold of nodes; no single party can decrypt alone) returns the
cleartext if the user is on the ACL. Public reveal goes through
`FHE.makePubliclyDecryptable` then anyone can call `publicDecrypt`.

You write only the contract and the off-chain client. Everything else is
pre-deployed infrastructure addressed via `ZamaEthereumConfig`, which
selects coprocessor / ACL / KMS addresses at runtime based on
`block.chainid` (mainnet, Sepolia, or local).

---

## 3. Setup — Hardhat template

Use the official template, not from-scratch. It bundles the mock node so
local tests don't need a real coprocessor.

```bash
git clone https://github.com/zama-ai/fhevm-hardhat-template
cd fhevm-hardhat-template
npm install
npx hardhat compile
npx hardhat test           # runs against in-process mock node
```

Verified-working versions (from a clean install):

```jsonc
{
  "dependencies": {
    "@fhevm/solidity": "^0.11.1",
    "@fhevm/mock-utils": "^0.4.2"
  },
  "devDependencies": {
    "@fhevm/hardhat-plugin": "^0.4.2",
    "@zama-fhe/relayer-sdk": "^0.4.1",
    "hardhat": "^2.28.4",
    "ethers": "^6.16.0"
  }
}
```

For ERC-7984:

```bash
npm install @openzeppelin/confidential-contracts @openzeppelin/contracts
```

Hardhat config minimum:

```ts
import "@fhevm/hardhat-plugin";          // adds `fhevm` namespace + mock
import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";

const config = {
  solidity: { version: "0.8.27", settings: { evmVersion: "cancun" } },
  // EVM "cancun" is REQUIRED — transient storage powers FHE.allowTransient.
};
```

---

## 3.5. Deployment

The Hardhat template ships with `hardhat-deploy`. Deploy scripts live in
`deploy/` and are picked up automatically.

### Deploy script — `deploy/01_deploy_counter.ts`

```ts
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const counter = await deploy("Counter", {
    from: deployer,
    args: [],
    log: true,
  });

  console.log(`Counter deployed at ${counter.address}`);
};

func.tags = ["Counter"];
export default func;
```

### Hardhat config — networks & accounts

```ts
import { HardhatUserConfig } from "hardhat/config";
import "@fhevm/hardhat-plugin";
import "hardhat-deploy";

const config: HardhatUserConfig = {
  solidity: { version: "0.8.27", settings: { evmVersion: "cancun" } },
  namedAccounts: { deployer: { default: 0 } },
  networks: {
    hardhat: {},                                  // mock node, no real coprocessor
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL!,
      accounts: [process.env.DEPLOYER_PRIVATE_KEY!],
      chainId: 11155111,
    },
  },
};
export default config;
```

### Deploy commands

```bash
# Local mock (in-process; resets every run)
npx hardhat deploy --tags Counter

# Sepolia (real coprocessor — ZamaEthereumConfig auto-selects Sepolia at chainId 11155111)
npx hardhat deploy --network sepolia --tags Counter
```

**Why one config works for both networks.** `ZamaEthereumConfig` reads
`block.chainid` at deploy time and picks the right coprocessor / ACL /
KMS addresses. So the same contract source ships to mainnet (chainId 1),
Sepolia (11155111), and the local mock node (31337). A deploy to any
*other* chain reverts with `ZamaProtocolUnsupported()`.

### Handoff to the frontend

After deploy, write the address + ABI somewhere the frontend can import:

```ts
// inside the deploy script, after `deploy(...)`:
import { writeFileSync } from "fs";
writeFileSync(
  "frontend/src/contracts/Counter.json",
  JSON.stringify({
    address: counter.address,
    chainId: hre.network.config.chainId,   // lets the frontend verify wallet network
    abi: counter.abi,
  }, null, 2),
);
```

Then in the frontend:

```ts
import CounterArtifact from "./contracts/Counter.json";
const contract = new Contract(CounterArtifact.address, CounterArtifact.abi, signer);

// Verify the user's wallet is on the same network the contract was deployed to.
// FHEVM contracts on a different chain produce confusing "FHE call reverted"
// errors that are really network-mismatch errors.
const { chainId } = await provider.getNetwork();
if (Number(chainId) !== CounterArtifact.chainId) {
  throw new Error(`Wrong network: connect to chainId ${CounterArtifact.chainId}`);
}
```

### Verification

```bash
npx hardhat verify --network sepolia <deployed-address>
```

`@fhevm/solidity` library calls verify cleanly on Etherscan — no special
flags needed.

---

## 4. Encrypted types

| Type | Plaintext | Notes |
|---|---|---|
| `ebool` | `bool` | Result of every comparison. Cannot be used in `if` / `require`. |
| `euint8`…`euint256` | `uint8`…`uint256` | Widths: 8, 16, 32, 64, 128, 256. Pick the smallest that fits. |
| `eaddress` | `address` | Alias for `euint160`. |
| `externalEuint*` | — | **Wire format** for client inputs. Cannot do math on it. Must `FHE.fromExternal` first. |

Storage and ABI: every encrypted value is a `bytes32` handle on the EVM.
You can `return` it from a `view`, store it, pass via calldata, emit it.
Visibility (`private` / `public`) only controls the auto-getter; the
*value* is opaque regardless.

---

## 5. Operations

```solidity
import {FHE, ebool, euint32, externalEuint32}
    from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig}
    from "@fhevm/solidity/config/ZamaConfig.sol";

contract MyContract is ZamaEthereumConfig { /* ... */ }
```

> Inheriting `ZamaEthereumConfig` wires in the coprocessor / ACL / KMS
> addresses. The contract picks the right ones at runtime via
> `block.chainid` (mainnet `1`, Sepolia `11155111`, local `31337`); on
> unsupported chains it reverts with `ZamaProtocolUnsupported()`.
> **Without inheriting it, every FHE call reverts.** Note: there is *no*
> separate `ZamaSepoliaConfig` import in `@fhevm/solidity` v0.11.x — old
> tutorials that show one are out of date.

**Arithmetic** (return new handle, do not mutate; no overflow revert):

```solidity
FHE.add(a, b)   FHE.sub(a, b)   FHE.mul(a, b)
FHE.div(a, scalarPlaintext)     // ciphertext / plaintext only
FHE.rem(a, scalarPlaintext)
FHE.min(a, b)   FHE.max(a, b)   FHE.neg(a)
```

**Bitwise**: `FHE.and / or / xor / not / shl / shr`

**Comparisons** (return `ebool`): `FHE.eq / ne / lt / le / gt / ge`

**Branching — your `if` replacement**:

```solidity
ebool c = FHE.gt(a, b);
euint32 winner = FHE.select(c, a, b);   // c ? a : b, evaluated encrypted-side
```

Both branches always execute. **Type widths must match exactly** — cast
with `FHE.asEuintN(...)` when needed.

**Constants** (no proof required):

```solidity
euint32 zero = FHE.asEuint32(0);
ebool   t    = FHE.asEbool(true);
```

**Cost shape** (rough, plus the per-tx HCU budget):

| Op | Cost | Note |
|---|---|---|
| `add`, `sub` | cheap | |
| comparisons, `select` | medium | |
| `mul` (cipher × cipher) | expensive | |
| `mul` (cipher × scalar) | medium-cheap | use this when one side is plaintext |
| `div`, `rem` (cipher ÷ scalar) | expensive | |

**HCU per-transaction limits** (from FHEVM v0.7+):

- Global HCU limit: **20,000,000** per transaction
- HCU depth limit: **5,000,000** per transaction (sequential dependency depth)

Exceeding either reverts the tx. Design rules:
- Keep each tx small; split heavy work across txs.
- Avoid long sequential dependency chains (e.g., `add(add(add(...)))` of
  many ciphertexts). Prefer parallelizable shapes when possible.
- Heavy `mul` chains and big `select` cascades are the usual culprits.

---

## 6. Access Control List (ACL)

| Call | Who gets access | Lifetime |
|---|---|---|
| `FHE.allowThis(ct)` | `address(this)` | persistent |
| `FHE.allow(ct, addr)` | `addr` | persistent |
| `FHE.allowTransient(ct, addr)` | `addr` | this transaction only (EIP-1153) |
| `FHE.makePubliclyDecryptable(ct)` | everyone, forever | persistent, irreversible |
| `FHE.isAllowed(ct, addr) → bool` | inspect | view |
| `FHE.isSenderAllowed(ct) → bool` | inspect, msg.sender | view |

### The canonical pattern in 90% of contracts

```solidity
function increment(externalEuint32 inH, bytes calldata proof) external {
    euint32 v = FHE.fromExternal(inH, proof);
    _count = FHE.add(_count, v);
    FHE.allowThis(_count);            // persist for THIS contract
    FHE.allow(_count, msg.sender);    // let caller decrypt later
}
```

- Skip `allowThis` → next tx reverts with `ACLNotAllowed()` when the
  contract tries to use its own stored handle.
- Skip `allow` → tx succeeds, but the user cannot decrypt and gets
  `is not authorized to user decrypt handle ...` from the relayer.

### `allowTransient` — the cheap variant

When passing a handle to another contract for use within this same call:

```solidity
FHE.allowTransient(handle, address(otherContract));
otherContract.use(handle);  // they can read it; access dies at tx end
```

EIP-1153 transient storage means no SSTORE — much cheaper than `FHE.allow`
if the recipient doesn't need to keep access.

### Defending against handle injection

If a function takes a handle the user already owns elsewhere, verify:

```solidity
function transfer(euint64 amount) external {
    require(FHE.isSenderAllowed(amount), "not your ciphertext");
    // ...
}
```

Prevents someone from passing a handle for *another user's* balance.

### Reorg-handling: the 96-block rule

ACL grants are propagated to the Gateway as soon as a block includes them.
A reorg that drops your transaction can leave a granted ACL bound to a
sale or state change that never finalized. For high-value or critical
flows, use a **two-step ACL with a timelock**:

```solidity
// Tx 1: record action only — no ACL grant yet
function buyKey() external payable {
    pendingBuyer[id] = msg.sender;
    pendingBlock[id] = block.number;
}

// Tx 2 (≥ 96 blocks later): grant ACL
function claimKey(uint256 id) external {
    require(msg.sender == pendingBuyer[id], "not buyer");
    require(block.number > pendingBlock[id] + 95, "wait for finality");
    FHE.allow(privateKey[id], msg.sender);
}
```

Why 96: Ethereum's worst-case reorg depth is 95 slots. Use this only when
necessary — it adds latency before users can decrypt.

---

## 7. Encrypted inputs from clients (`externalEuint*` + `inputProof`)

A user encrypts inputs **bound to a specific (contract, user) pair**. The
binding is enforced on-chain via `FHE.fromExternal`.

### Off-chain (test or browser)

```ts
const enc = await fhevm
  .createEncryptedInput(contractAddress, userAddress)
  .add32(value)         // .addBool, .add8, .add16, .add64, .add128, .add256, .addAddress
  .add32(other)         // pack many in one bundle — one shared inputProof
  .encrypt();
// enc.handles is bytes32[]; enc.inputProof is bytes
```

### On-chain

```solidity
function f(externalEuint32 a, externalEuint32 b, bytes calldata proof) external {
    euint32 va = FHE.fromExternal(a, proof);
    euint32 vb = FHE.fromExternal(b, proof);   // same proof validates many handles
    // ...
}
```

**Type discipline:** `externalEuintN` ≠ `euintN`. You cannot `FHE.add` an
`externalEuint32`. The type wall forces every input through proof
verification.

---

## 8. User decryption (EIP-712 flow)

Used when one specific user wants to read a value the contract has
authorized for them via `FHE.allow(handle, user)`.

### In Hardhat tests (mock plugin)

```ts
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

const handle = await contract.getValue();
const cleartext = await fhevm.userDecryptEuint(
  FhevmType.euint32,    // or euint8/16/64/128/256, ebool, eaddress
  handle,
  contractAddress,
  signer,               // must be on the handle's ACL
);
```

Defensive pattern for "value may be uninitialized":

```ts
const handle = await contract.getValue();
const value = handle === ethers.ZeroHash
  ? 0n
  : await fhevm.userDecryptEuint(FhevmType.euint32, handle, addr, signer);
```

### In a browser frontend (Sepolia)

```ts
import {
  initSDK,
  createInstance,
  SepoliaConfig,
} from "@zama-fhe/relayer-sdk/bundle";
import { BrowserProvider } from "ethers";

await initSDK();   // loads WASM
const instance = await createInstance({
  ...SepoliaConfig,
  network: window.ethereum,
});

const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();
const userAddress = await signer.getAddress();

const keypair = instance.generateKeypair();
const startTimeStamp = Math.floor(Date.now() / 1000);   // number — the browser SDK rejects strings
const durationDays = 10;                                 // number
const contractAddresses = [contractAddress];

const eip712 = instance.createEIP712(
  keypair.publicKey,
  contractAddresses,
  startTimeStamp,
  durationDays,
);

const signature = await signer.signTypedData(
  eip712.domain,
  { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
  eip712.message,
);

const result = await instance.userDecrypt(
  [{ handle: ciphertextHandle, contractAddress }],
  keypair.privateKey,
  keypair.publicKey,
  signature.replace("0x", ""),
  contractAddresses,
  userAddress,
  startTimeStamp,
  durationDays,
);

const cleartext = result[ciphertextHandle];
```

The EIP-712 signature authorizes the relayer to decrypt and re-encrypt
the value to the user's ephemeral keypair for a bounded time window.

---

## 9. Public decryption

### Pattern A — broadcast forever via the ACL (most common)

```solidity
// Inside the contract:
FHE.makePubliclyDecryptable(winnerHandle);
```

Off-chain, anyone can then:

```ts
// Hardhat:
const v = await fhevm.publicDecryptEuint(FhevmType.euint32, handle);

// Browser:
const result = await instance.publicDecrypt([handle]);
const v = result.clearValues[handle];   // not result[handle] — the result is { clearValues, abiEncodedClearValues, decryptionProof }
```

If you skip `makePubliclyDecryptable`:

```
Handle 0x... is not allowed for public decryption!
```

`FHE.allow` does **not** make a handle public. `makePubliclyDecryptable`
is permanent and irreversible — once public, public forever.

### Pattern B — verify a KMS-signed cleartext on-chain

`FHE.requestDecryption(...)` was removed. Current pattern: decrypt
off-chain via the relayer, submit cleartext + signatures back to your
contract, verify with `FHE.checkSignatures`:

```solidity
function finalizeReveal(
    bytes32[] calldata handlesList,
    bytes calldata cleartexts,
    bytes calldata decryptionProof
) external {
    require(!revealed, "already revealed");        // replay guard FIRST
    FHE.checkSignatures(handlesList, cleartexts, decryptionProof);
    (uint8 a, uint8 b) = abi.decode(cleartexts, (uint8, uint8));
    revealed = true;
    // act on the cleartext
}
```

Required checks in any reveal callback:
- Replay flag set BEFORE the signature check is allowed to gate it.
- `checkSignatures` BEFORE `abi.decode`.
- Stable handle order between the request side and the decode.

---

## 10. Testing FHEVM contracts

```ts
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { expect } from "chai";

describe("MyContract", function () {
  let signers, contract, addr;

  before(async () => {
    const eth = await ethers.getSigners();
    signers = { alice: eth[1], bob: eth[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();        // mock-only
    contract = await (await ethers.getContractFactory("MyContract")).deploy();
    addr = await contract.getAddress();
  });

  it("happy path", async () => {
    const enc = await fhevm
      .createEncryptedInput(addr, signers.alice.address)
      .add32(42)
      .encrypt();

    await contract
      .connect(signers.alice)
      .setValue(enc.handles[0], enc.inputProof);

    const handle = await contract.getValue();
    const value = await fhevm.userDecryptEuint(
      FhevmType.euint32, handle, addr, signers.alice,
    );
    expect(value).to.eq(42n);
  });
});
```

Use `fhevm.isMock` to skip mock-only tests on real networks. Always test
the failure modes too — see `Anti-patterns` below.

---

## 11. Frontend integration with `@zama-fhe/relayer-sdk`

> **Naming note.** The package formerly known as **`fhevmjs`** has been
> renamed and superseded by **`@zama-fhe/relayer-sdk`**. If a tutorial,
> StackOverflow answer, or AI suggestion tells you to `npm install fhevmjs`,
> it is outdated. The API surface (`createInstance`,
> `createEncryptedInput`, `userDecrypt`, `publicDecrypt`) is broadly
> similar but not identical — always use `@zama-fhe/relayer-sdk` for new
> work.

```ts
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";
import { BrowserProvider, Contract } from "ethers";

await initSDK();           // load WASM bundle (await before anything else)

const instance = await createInstance({
  ...SepoliaConfig,
  network: window.ethereum,
});

const provider = new BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const input = instance.createEncryptedInput(contractAddress, await signer.getAddress());
input.add32(123456);
const encrypted = await input.encrypt();

const contract = new Contract(contractAddress, abi, signer);
await (await contract.setValue(encrypted.handles[0], encrypted.inputProof)).wait();
```

For Node.js (server-side), import from `@zama-fhe/relayer-sdk/node`
instead of `/bundle`.

**Webpack tip.** The bundle ships WASM. In `webpack.config.js`:

```js
module.exports = {
  experiments: { asyncWebAssembly: true },
  resolve: { fallback: { fs: false, path: false, crypto: false } },
};
```

Vite users: WASM works out-of-the-box; no extra config needed in most
cases. If you see a `top-level await` error, set `build.target: "esnext"`.

**`initSDK()` timing trap.** It returns a Promise — must be awaited
before any `createInstance`, `createEIP712`, or `createEncryptedInput`
call. Calling these too early gives obscure "module not initialized"
errors.

### Singleton pattern for React / Next.js

In a component, `await initSDK()` runs on every render unless cached.
Build it once and reuse:

```ts
// frontend/src/lib/fhevm.ts
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";

let _instance: Awaited<ReturnType<typeof createInstance>> | null = null;
let _initPromise: Promise<void> | null = null;

export async function getFhevmInstance() {
  if (_instance) return _instance;
  _initPromise ??= initSDK();          // ensure initSDK runs exactly once
  await _initPromise;
  _instance ??= await createInstance({ ...SepoliaConfig, network: window.ethereum });
  return _instance;
}
```

Then in any component: `const instance = await getFhevmInstance();`.
The double-`??=` guards against the race where two components await
concurrently on first mount.

---

## 12. OpenZeppelin Confidential Contracts (ERC-7984)

Confidential fungible-token standard. Encrypted balances, encrypted
transfers, optional wrapping to/from a vanilla ERC-20.

```bash
npm install @openzeppelin/confidential-contracts @openzeppelin/contracts
```

### Real, working import paths (verified against package v0.3.x)

```solidity
import {ERC7984}
    from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper}
    from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {IERC7984}
    from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {FHESafeMath}
    from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
```

`ERC7984` is `abstract` — subclass it with at least a constructor and a
mint policy.

### Minimal concrete token (verified to compile and pass tests)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {FHE, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

contract MyConfidentialToken is ERC7984, ZamaEthereumConfig {
    constructor() ERC7984("MyConfidential", "MCT", "ipfs://meta") {}

    function mint(externalEuint64 inH, bytes calldata proof) external {
        euint64 amount = FHE.fromExternal(inH, proof);
        _mint(msg.sender, amount);   // ERC7984 handles ACL + balance update
    }
}
```

### The ABI overload trap (caught in real tests)

`ERC7984` declares two `confidentialTransfer` overloads:

```solidity
function confidentialTransfer(address, externalEuint64, bytes);
function confidentialTransfer(address, euint64);
```

In ethers.js, `token.confidentialTransfer(to, handle, proof)` errors with
"ambiguous function description." Use the full signature in brackets:

```ts
await token
  .connect(alice)
  ["confidentialTransfer(address,bytes32,bytes)"](
    bob.address,
    encrypted.handles[0],
    encrypted.inputProof,
  );

// And for the on-chain-handle overload:
await token
  .connect(alice)
  ["confidentialTransfer(address,bytes32)"](bob.address, handle);
```

### Insufficient balance does NOT revert

`ERC7984` uses `FHESafeMath`. If Alice has 50 and tries to transfer 200,
the tx **succeeds** but balances are unchanged. Reverting on insufficient
balance would leak the balance. Implications:

- Successful tx ≠ proof of transfer.
- To confirm, decrypt the post-tx balance (requires being on the ACL), or
  store a confidential `_lastTransferred` ciphertext for the caller to
  read.
- UX: don't show "transfer succeeded" until you've verified the balance
  delta.

### Operator pattern (passing on-chain ciphertext)

When passing an *already on-chain* `euint64` to `confidentialTransfer`,
the token contract needs ACL access:

```solidity
FHE.allowTransient(amount, address(token));   // single-tx grant; cheap
token.confidentialTransfer(to, amount);
```

Without this, the call reverts with `ACLNotAllowed()` when the token
tries to operate on the amount.

### Wrapping ERC-20 ↔ ERC-7984

```solidity
import {ERC7984ERC20Wrapper}
    from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
```

- **`wrap(to, amount)`** — caller `approve`s the wrapper on the underlying
  ERC-20, then calls `wrap`. The wrapper pulls ERC-20 via
  `safeTransferFrom`, mints matching confidential supply to `to`, and
  refunds any decimal-conversion dust.
- **`unwrap(from, to, encryptedAmount, inputProof)`** — burns confidential
  supply. `finalizeUnwrap(unwrapRequestId, cleartextAmount,
  decryptionProof)` then sends the ERC-20 back.

**Unwrap is two-phase** because the underlying ERC-20 transfer needs a
plaintext amount. The relayer reveals the amount between phases. UX
should reflect this asynchrony.

---

## 13. Anti-patterns reference (each verified by a passing test)

These are the failure modes you will hit. Each entry pairs the literal
error string with the fix.

### Quick lookup — error fragment → cause

When debugging, grep the error you see against this table first.

| Error fragment | Most likely cause | See |
|---|---|---|
| `Handle is not initialized` | Decrypting `bytes32(0)` (uninitialized storage slot) | A |
| `InvalidSigner()` | Input proof bound to a different contract or sender | B |
| `SenderNotAllowedToUseHandle` | Handle submitted without a valid proof, sender not pre-authorised | C |
| `ACLNotAllowed()` (during an FHE op) | Missing `FHE.allowThis` after a storage write (or missing `allow` for inter-contract call) | D |
| `is not authorized to user decrypt handle` | Missing `FHE.allow(handle, user)` | E |
| `Type ebool is not implicitly convertible` | Tried `if` / `require` on encrypted boolean | F |
| `Handle ... is not allowed for public decryption` | Forgot `FHE.makePubliclyDecryptable(handle)` | I |
| `ambiguous function description` (ethers) | Overloaded `confidentialTransfer` needs bracket-signature notation | J |

### A. Decrypting an uninitialized handle

**Error:** `Handle is not initialized`

`euint32` storage defaults to `bytes32(0)` — *no handle*, not "encrypted
zero." Initialize in the constructor (`_x = FHE.asEuint32(0);
FHE.allowThis(_x); FHE.allow(_x, owner);`) **or** treat zero handles as
"not yet set" client-side.

### B. Wrong sender / wrong contract for the input proof

**Error:** `FHEVM Input verification error 'InvalidSigner()': The contract
address ... or signer account ... used in this transaction differs from
the values originally provided to the 'createEncryptedInput()' function.`

The proof binds `(contract, user)`. Both must match `address(this)` and
`msg.sender`. There is no submit-on-behalf-of pattern at this layer.

### C. Empty / mismatched `inputProof` (one-way authorization model)

**Error:** `SenderNotAllowedToUseHandle("0x...handle...", "0x...sender...")`

Authorization is a single unified check: *is `msg.sender` allowed to use
this handle?* Two paths — pre-existing ACL entry, or just-in-time via
`FHE.fromExternal`. If both fail, you get this error. The system
deliberately doesn't tell you *which* check failed (would leak handle
existence).

**Debugging checklist:**
1. Did you call `FHE.fromExternal(handle, proof)`?
2. Are handle and proof from the *same* `encrypt()` call?
3. If the handle came from another contract: did that contract call
   `FHE.allow` (or `allowTransient`) for your contract?
4. If from a previous tx of yours: did that tx call `FHE.allow(handle,
   you)`?

### D. Missing `FHE.allowThis` after writing storage

**Error:** `'ACLNotAllowed()' while calling FHE operator: ... To grant
access to a <handle> for a contract at <contract address>, call:
FHE.allow(<contract address>, <handle>).`

First call works (zero-handle treated as literal zero). Second call
reverts. **Rule:** every storage write of an FHE-op result must be
followed by `FHE.allowThis(thatHandle)`. Read the error — it tells you
the fix.

### E. Missing `FHE.allow(handle, user)`

**Error (off-chain):** `User 0x... is not authorized to user decrypt handle 0x...!`

Tx succeeds; user can't decrypt. Most common silent FHEVM bug. After
persisting any handle the caller needs to read, call `FHE.allow(handle,
msg.sender)`.

### F. `if` / `require` on `ebool`

**Compile error:** `Type ebool is not implicitly convertible to expected type bool.`

Use `FHE.select(cond, ifTrue, ifFalse)`. For "conditional update":
`_x = FHE.select(cond, newX, _x);` — always write, let `select` pick.

### G. FHE ops in a `view` function

`FHE.add`, `FHE.allow`, `FHE.fromExternal`, etc. write state (events,
ACL). They cannot run in `view` / `pure`. Compiles, then reverts at call.
View functions can only return existing handles.

### H. `FHE.select` with mismatched widths

```solidity
FHE.select(cond, euint32_a, euint64_b)   // does not compile
```

Cast first: `FHE.select(cond, FHE.asEuint64(a), b)`.

### I. Public-decrypting a non-public handle

**Error:** `Handle 0x... is not allowed for public decryption!`

`FHE.allow` does **not** make a handle public. Call
`FHE.makePubliclyDecryptable(handle)` first. Permanent and irreversible.

### J. Ethers.js ambiguous function on overloaded confidential calls

**Error:** ethers throws "ambiguous function description" on
`token.confidentialTransfer(...)`.

Use bracket notation with the full signature:
`token["confidentialTransfer(address,bytes32,bytes)"](...)`.

### K. Treating a successful `confidentialTransfer` as proof of payment

ERC-7984 uses `FHESafeMath`: insufficient balance ⇒ silent no-op, **no
revert**. Verify by decrypting the post-tx balance, or by reading a
confidential `_lastTransferred` ciphertext.

### L. Forgetting the 96-block reorg timelock for high-value ACLs

ACL grants reach the Gateway as soon as a block includes them. A reorg
that drops the granting tx leaves the off-chain decrypt still authorized.
For high-value flows: split into a "record action" tx and a "grant ACL
after `block.number > recordedBlock + 95`" tx.

### M. Hitting per-tx HCU limits

If a tx exceeds 20M HCU global or 5M HCU depth, it reverts. Causes:
deep `mul` chains, big `select` cascades over many handles. Fix by
splitting work into multiple txs and parallelizing where possible.

---

## 14. Cookbook — verified working idioms

### Encrypted counter

```solidity
contract Counter is ZamaEthereumConfig {
    euint32 private _count;

    function increment(externalEuint32 inH, bytes calldata proof) external {
        euint32 v = FHE.fromExternal(inH, proof);
        _count = FHE.add(_count, v);
        FHE.allowThis(_count);
        FHE.allow(_count, msg.sender);
    }

    function getCount() external view returns (euint32) { return _count; }
}
```

### Encrypted max — `FHE.select` with conditional update

```solidity
contract EncryptedMax is ZamaEthereumConfig {
    euint32 private _highest;
    address public owner;

    constructor() { owner = msg.sender; }

    function submit(externalEuint32 inH, bytes calldata proof) external {
        euint32 v = FHE.fromExternal(inH, proof);
        ebool isHigher = FHE.gt(v, _highest);
        _highest = FHE.select(isHigher, v, _highest);  // always-write
        FHE.allowThis(_highest);
        FHE.allow(_highest, owner);                    // submitter cannot read
    }

    function reveal() external {
        require(msg.sender == owner, "only owner");
        FHE.makePubliclyDecryptable(_highest);
    }
}
```

The state slot is **always** written. The encrypted-side `select` chooses
whether the new value or the old one lands. Submitters cannot tell whether
their submission won.

### Bound-checking without leaking the input

```solidity
ebool tooBig = FHE.gt(input, maxAllowed);
euint32 capped = FHE.select(tooBig, maxAllowed, input);
// capped = min(input, maxAllowed); whether capping happened stays secret.
```

### Conditional state update (replaces `if (cond) state = newValue`)

```solidity
ebool ok = FHE.ge(balance, amount);
balance  = FHE.select(ok, FHE.sub(balance, amount), balance);
// transfer "happens" iff ok; from the EVM's POV the SSTORE always happens.
```

### Reorg-safe ACL grant for a high-value secret

```solidity
mapping(uint256 => address) public pendingBuyer;
mapping(uint256 => uint256) public pendingBlock;
mapping(uint256 => euint32) public secret;

function buyKey(uint256 id) external payable {
    require(msg.value == price, "wrong price");
    pendingBuyer[id] = msg.sender;
    pendingBlock[id] = block.number;
}

function claimKey(uint256 id) external {
    require(msg.sender == pendingBuyer[id], "not buyer");
    require(block.number > pendingBlock[id] + 95, "wait for finality");
    FHE.allow(secret[id], msg.sender);
    delete pendingBuyer[id];
    delete pendingBlock[id];
}
```

### ERC-7984 transfer with on-chain ciphertext

```solidity
FHE.allowTransient(amount, address(token));   // one-tx grant
token.confidentialTransfer(recipient, amount);
```

### Public reveal of a winner

```solidity
function reveal() external onlyOwner {
    FHE.makePubliclyDecryptable(_winnerHandle);
}
// off-chain: anyone can publicDecrypt([_winnerHandle])
```

### Defending against handle injection

```solidity
function transfer(euint64 amount) external {
    require(FHE.isSenderAllowed(amount), "not your ciphertext");
    // ... use amount safely
}
```

---

## 15. Quick API reference

### Solidity (`@fhevm/solidity` v0.11.x)

```solidity
import {FHE, ebool, euint8, euint16, euint32, euint64, euint128, euint256, eaddress,
        externalEbool, externalEuint8, externalEuint16, externalEuint32,
        externalEuint64, externalEuint128, externalEuint256}
    from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig}
    from "@fhevm/solidity/config/ZamaConfig.sol";

// Inputs
FHE.fromExternal(externalEuintN handle, bytes proof) returns (euintN)

// Constants
FHE.asEbool(true)        FHE.asEuintN(uintN value)
FHE.asEuintN(euintM v)   // width conversion

// Arithmetic
FHE.add  FHE.sub  FHE.mul  FHE.div  FHE.rem  FHE.neg  FHE.min  FHE.max
// Bitwise
FHE.and  FHE.or  FHE.xor  FHE.not  FHE.shl  FHE.shr
// Comparison (→ ebool)
FHE.eq  FHE.ne  FHE.lt  FHE.le  FHE.gt  FHE.ge
// Branching
FHE.select(ebool cond, T a, T b) returns (T)
// ACL
FHE.allowThis(ct)
FHE.allow(ct, addr)
FHE.allowTransient(ct, addr)
FHE.makePubliclyDecryptable(ct)
FHE.isAllowed(ct, addr) returns (bool)
FHE.isSenderAllowed(ct) returns (bool)
// Decryption verification (on-chain checking of off-chain reveals)
FHE.checkSignatures(bytes32[] handlesList, bytes cleartexts, bytes proof)
FHE.toBytes32(euintN ct) returns (bytes32)
```

### Hardhat plugin (`@fhevm/hardhat-plugin` v0.4.x, in test code)

```ts
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

fhevm.isMock                                                 // boolean
fhevm.createEncryptedInput(contractAddr, userAddr)
     .add8(v) | .add16(v) | .add32(v) | .add64(v)
     | .add128(v) | .add256(v) | .addBool(b) | .addAddress(a)
     .encrypt() → { handles: bytes32[], inputProof: bytes }

fhevm.userDecryptEuint(FhevmType.euintN, handle, contractAddr, signer) → bigint
fhevm.publicDecryptEuint(FhevmType.euintN, handle) → bigint

// ebool and eaddress use SEPARATE functions (no FhevmType arg):
fhevm.userDecryptEbool(handle, contractAddr, signer)              → boolean
fhevm.userDecryptEaddress(handle, contractAddr, signer)           → string
fhevm.publicDecryptEbool(handle)                                  → boolean
fhevm.publicDecryptEaddress(handle)                               → string

// FhevmType (only for *Euint* variants): euint4 | euint8 | euint16 | euint32 | euint64 | euint128 | euint256
```

### Browser SDK (`@zama-fhe/relayer-sdk/bundle` v0.4.x)

```ts
import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";

await initSDK();                                             // load WASM (always await first)
const instance = await createInstance({ ...SepoliaConfig, network: window.ethereum });

instance.createEncryptedInput(contractAddr, userAddr)
        .add32(v).encrypt()                                  // → { handles, inputProof }

instance.generateKeypair()                                   // → { publicKey, privateKey }
instance.createEIP712(publicKey, contractAddrs, startTs, durationDays)
        // → { domain, types, message }
instance.userDecrypt(handleContractPairs, privKey, pubKey, signature, contractAddrs,
                     userAddr, startTs, durationDays)        // → { [handle]: cleartext }
instance.publicDecrypt([handles])
        // → { clearValues: {[handle]: cleartext}, abiEncodedClearValues, decryptionProof }
        // Access via result.clearValues[handle], NOT result[handle].
```

### OpenZeppelin Confidential Contracts (`@openzeppelin/confidential-contracts` v0.3.x)

```solidity
import {ERC7984}
    from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {ERC7984ERC20Wrapper}
    from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984ERC20Wrapper.sol";
import {ERC7984Restricted}
    from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984Restricted.sol";
import {ERC7984Freezable}
    from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984Freezable.sol";
import {ERC7984Votes}
    from "@openzeppelin/confidential-contracts/token/ERC7984/extensions/ERC7984Votes.sol";
import {IERC7984}
    from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {FHESafeMath}
    from "@openzeppelin/confidential-contracts/utils/FHESafeMath.sol";
import {VestingWalletConfidential}
    from "@openzeppelin/confidential-contracts/finance/VestingWalletConfidential.sol";
```

---

## 16. Decision tree for AI agents

When asked to write FHEVM code, walk these checks in order:

1. **Is the user encrypting on the client side?** → Function signature is
   `(externalEuintN inH, bytes calldata proof, …)`. Inside, call
   `FHE.fromExternal(inH, proof)` first. Off-chain side uses
   `createEncryptedInput(contractAddr, userAddr).addN(v).encrypt()`.

2. **Does the function compute and store?** → After every storage write
   of an FHE-op result, call `FHE.allowThis(handle)`. If a user needs to
   read it later, also `FHE.allow(handle, msg.sender)` (or whichever
   address). Skipping either is the most common bug source.

3. **Does the function need to branch on a comparison?** → Replace `if
   (cond) X else Y` with `FHE.select(cond, X, Y)`. For conditional state
   updates: `_slot = FHE.select(cond, newValue, _slot);`.

4. **Does the function take a handle the user already owns?** → Add
   `require(FHE.isSenderAllowed(handle));` to prevent injection.

5. **Does the function call another contract with an encrypted value?**
   → Single tx: `FHE.allowTransient(handle, address(other))`. Cross tx:
   `FHE.allow(handle, address(other))`.

6. **Does the contract reveal an outcome to everyone?** →
   `FHE.makePubliclyDecryptable(handle)`, then off-chain
   `instance.publicDecrypt([handle])` or `fhevm.publicDecryptEuint(...)`
   in tests. Permanent and irreversible.

7. **Is this view code reading state?** → Return the handle as `bytes32`
   via the typed getter. Never call FHE ops inside `view` / `pure`.

8. **Is the project using ERC-7984?** → Import from
   `@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol`;
   subclass it; remember `FHE.allowTransient(amount, address(token))`
   before `confidentialTransfer` when passing on-chain ciphertext;
   remember overloaded calls need bracket-signature notation in
   ethers.js; remember insufficient balance silently no-ops.

9. **Is this high-value or critical (sales, key reveals)?** → Use the
   two-tx 96-block reorg pattern: record-now, grant-ACL-after-finality.

10. **Is this a heavy single-tx flow?** → Watch HCU: 20M global / 5M
    depth per tx. Split work across txs and parallelize where possible.

---

## 17. Versions verified for this skill

Captured from a clean install + passing test suite:

| Package | Version |
|---|---|
| `@fhevm/solidity` | `^0.11.1` |
| `@fhevm/hardhat-plugin` | `^0.4.2` |
| `@fhevm/mock-utils` | `^0.4.2` |
| `@zama-fhe/relayer-sdk` | `^0.4.1` |
| `@openzeppelin/confidential-contracts` | `^0.3.x` |
| `hardhat` | `^2.28.4` |
| `ethers` | `^6.16.0` |
| Solidity | `0.8.27` |
| EVM target | `cancun` (required for transient storage) |

If versions diverge, re-check
[docs.zama.org](https://docs.zama.org/protocol/) and the
[Hardhat template](https://github.com/zama-ai/fhevm-hardhat-template).
FHEVM has had two breaking renames (TFHE → FHE) and one removed API
(`FHE.requestDecryption`) since 2024.
