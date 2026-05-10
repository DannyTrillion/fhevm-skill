# FHEVM Skill — for Claude Code, Cursor, and Anthropic-compatible agents

> **Submission to the Zama Developer Program — Mainnet Season 2 (Bounty
> Track).** A production-quality AI skill that teaches agents to build
> correct FHEVM Solidity contracts, frontend integrations, and tests on
> the first try — backed by a working Hardhat repo where every pattern
> compiles and every documented error string is verified by a passing
> test.

**📹 Demo video (≤3 min):** https://youtu.be/i_OHMYBUj_M

---

## What this is

[`SKILL.md`](SKILL.md) is a single self-contained skill file that briefs
an AI coding agent on the full FHEVM development surface — encrypted
types, ACL, input proofs, user/public decryption, frontend integration
with `@zama-fhe/relayer-sdk`, OpenZeppelin Confidential Contracts
(ERC-7984), Hardhat testing, deployment, and 13 catalogued anti-patterns
keyed to their literal runtime error strings.

It works with any agent that ingests directory-scoped skill files —
Claude Code is the primary target, but Cursor / Windsurf / Aider all
consume the same format.

---

## Why it exists

FHEVM has roughly a dozen places where the obvious code compiles but
fails at runtime, often silently:

- `bytes32(0)` is not "encrypted zero" — it's the absence of a handle, and
  decrypting it errors.
- Every `FHE.add` returns a *new* handle; the previous handle's ACL does
  not carry forward.
- `confidentialTransfer` of more than your balance does not revert — it
  silently no-ops, so a successful tx is not proof of payment.
- `if (ebool)` and `require(ebool)` don't compile, but the error message
  doesn't tell you to use `FHE.select`.
- ERC-7984's overloaded `confidentialTransfer` throws "ambiguous function
  description" in ethers.js unless you use bracket-signature notation.

Without a skill, an agent suggests plausible-looking code and the user
discovers the failure 20 minutes later in a confusing stack trace. With
this skill, the agent produces working code on the first try and
proactively warns the user about the silent-failure UX traps.

---

## Validation

### 1. The local test suite — 21 passing

Every Solidity pattern documented in the skill has a working contract
+ test in this repo:

```bash
npm install
npx hardhat compile
npx hardhat test
```

Result:

```
EncryptedMax — FHE.select + public reveal              5 passing
FHECounter — deliberate mistakes (anti-pattern proof)  6 passing
FHECounter (canonical pattern)                         3 passing
MyConfidentialToken (ERC-7984)                         4 passing
SealedBidAuction (Test 4a output, polished)            1 passing
SimpleEncryptedCounter (Test 1 output)                 2 passing
                                                       ──────────
                                                      21 passing
```

The `deliberate mistakes` suite is the validation for [§13 Anti-patterns
reference](SKILL.md). Each test triggers one of the documented failure
modes and asserts the literal error string the skill claims you'll see.

### 2. The agent test — 5/5 passing in fresh Claude Code sessions

The skill was tested against five natural-language prompts in clean
Claude Code sessions with no other context. Every test passed every
criterion with zero fail signals.

| # | Prompt | Result |
|---|---|---|
| 1 | "Set up dev environment + write an encrypted counter that anyone can increment" | ✅ Compiled, tested (2 passing), deployed locally |
| 2 | "Build a sealed-bid auction; only owner sees the winner until reveal" | ✅ Branchless `FHE.select`, encrypted `eaddress` winner, dual-handle ACL sync |
| 3 | "Write a React component to call confidentialTransfer on an ERC-7984 token" | ✅ Bracket-signature notation, singleton SDK, silent-no-op warning |
| 4 | "Diagnose: 'User 0x... is not authorized to user decrypt handle' but the tx succeeded" | ✅ Identified missing `FHE.allow(handle, user)`; explained per-handle ACL |
| 5 | "Deploy Counter to Sepolia + wire up Next.js frontend" | ✅ `hardhat-deploy --network sepolia`, singleton SDK pattern, deploy artifact with `chainId` handoff, MetaMask network guard, paused before destructive deploy |

> **Honesty note on test 5.** The agent's first attempt switched the
> contract to inherit a `ZamaSepoliaConfig` import, which the skill then
> claimed existed. A subsequent audit pass against installed
> `@fhevm/solidity` v0.11.1 source proved that import doesn't exist —
> only `ZamaEthereumConfig` does, and it auto-selects mainnet/Sepolia/local
> from `block.chainid`. Both the skill and the contract were corrected.
> Including this here because validation that catches its own
> false-positives is worth more than validation that doesn't.

Across the 5 tests the agent surfaced **14 bonus catches** beyond the
documented pass criteria — preventing UX traps the user didn't ask
about, picking the privacy-correct types unprompted, pausing before
irreversible actions. Enumerated below.

### Bonus catches — the 14 things the agent did unprompted

These were not in the test pass criteria. The agent surfaced each one
because the skill's mental model gave it the right defaults.

**Test 2 — sealed-bid auction (4)**

1. Stored the winner as `eaddress`, not plaintext `address`. Revealing
   *who won* during bidding leaks as much as the winning amount; the
   skill's privacy-by-default framing made this obvious to the agent.
2. Synchronised ACL grants across **both** handles (`_highestBid` *and*
   `_winner`) on every state update. The skill's [§14 EncryptedMax
   cookbook](SKILL.md) only shows one handle; the agent generalised.
3. Separated `endAuction()` from `reveal()` — clean state machine that
   prevents new bids from racing the reveal call.
4. Test asserts that **non-owners cannot decrypt** the running max during
   bidding. Negative tests for ACL refusal are the highest-signal FHEVM
   tests; [§10](SKILL.md) doesn't explicitly suggest them.

**Test 3 — frontend ERC-7984 transfer (3)**

5. Surfaced the silent-no-op trap from [§12](SKILL.md) and [§13.K](SKILL.md)
   as a user-facing warning in the component (not just a comment).
6. Pre-warned about Webpack-needs-`asyncWebAssembly` from [§11](SKILL.md).
   Most bundler footguns get hit at runtime; the agent prevented it.
7. Explained the `(contract, user)` proof binding to the user — the
   [§13.B](SKILL.md) `InvalidSigner()` trap, pre-emptively documented.

**Test 4 — decrypt-failure diagnosis (3)**

8. Recognised `0x7099…79C8` as Hardhat account index 1 and used that to
   suggest the user might have granted ACL to the deployer (account 0)
   by mistake. Not in the skill; pure debugging instinct on top of it.
9. Distinguished OZ ERC-7984 (auto-grants ACL on receive) from custom
   balance accounting (you must grant it yourself). [§12](SKILL.md)
   covers the OZ side; the agent contrasted it correctly.
10. The killer insight: **"ACL is per-handle, not per-storage-slot.
    Every reassignment needs a fresh `FHE.allow`."** This was a
    first-principles statement of a rule the skill only implied. After
    seeing it, we promoted it to [§1 mental-model rule #6](SKILL.md).

**Test 5 — Sepolia deploy + Next.js (4)**

11. Built a `getFhevmInstance()` singleton with double-`??=` guard
    against the concurrent-mount race. Skill's [§11](SKILL.md) didn't
    teach this; we added it after the test result.
12. Added MetaMask `chainId` verification on the **wallet side**. Skill
    only covered the contract side; agent added the symmetric check.
13. **Paused before the destructive deploy**, listed exactly what it
    would consume (Sepolia ETH, public artifact), surfaced what to
    verify (`MNEMONIC`, `INFURA_API_KEY`, deployer funded), asked for
    go-ahead. Inherited from Claude's general guidelines, but applied
    correctly to this domain.
14. Persisted `chainId` in the deploy artifact (`{address, chainId, abi}`),
    not just `{address, abi}`. Strict improvement on the skill's
    [§3.5](SKILL.md) snippet — incorporated into the skill afterwards.

### 3. Real-world deployment — Confidential GoFundMe

- Live: **https://confidential-gofundme.vercel.app**
- Source: **https://github.com/DannyTrillion/confidential-gofundme**

A privacy-preserving crowdfunding webapp built on FHEVM using this skill
in a fresh Claude Code session. Causes, goals, and recipient wallets are
public; **individual donor amounts are encrypted as `euint64` on-chain**
via ERC-7984. Built in one weekend (excluding UI/UX polish).

This is the strongest validation in the README — not a controlled
benchmark, a real shipped product. Two concrete moments from the build:

#### A pattern the skill saved from re-deriving

`FHE.makePubliclyDecryptable(_encTotal)` for the running donation
total. Without [§9 Pattern A](SKILL.md), this is the kind of thing that
swallows an hour — trying `FHE.allow` first (wrong, that's per-address)
or building a KMS-callback song-and-dance. The whole product hinges on
that one line being placed correctly in both the constructor and every
state-mutating function (donate, withdraw, etc.). Worked first try.

#### An anti-pattern the skill caught at the keyboard

During the encrypted-recipient phase, the natural reach was for
`require(FHE.eq(msg.sender, _encBeneficiary), …)` in `withdraw()` —
`require` on an `ebool`. [§1 rule 4](SKILL.md) and [§13.F](SKILL.md)
flagged it before typing finished. Switched to:

```solidity
ebool gate = FHE.eq(msg.sender, _encBeneficiary);
funds = FHE.select(gate, _encTotal, FHE.asEuint64(0));
```

The contract never observes the gate result; the relayer only sees funds
either move or not. Without the skill, that's a 30-minute compile-fail
detour at minimum — and at worst a leaky `if (FHE.decrypt(...))` that
ships before someone points out the leak.

---

## Repository layout

```
SKILL.md                                # the skill (top-level for visibility)
README.md                               # this file
LICENSE                                 # BSD-3-Clause-Clear

contracts/                              # working examples — every pattern in SKILL.md
  FHECounter.sol                        #   §14 canonical counter
  EncryptedMax.sol                      #   §14 FHE.select + reveal
  MyConfidentialToken.sol               #   §12 ERC-7984
  BadFHECounter.sol                     #   §13 anti-pattern proofs

test/                                   # passing tests for every pattern
  FHECounter.ts                         #   canonical-path tests
  FHECounter.mistakes.ts                #   anti-pattern verification (the validation for §13)
  EncryptedMax.ts
  MyConfidentialToken.ts
  FHECounterSepolia.ts                  #   live Sepolia smoke test (skipped on local)

templates/                              # reusable starting points referenced from SKILL.md
  deploy-with-frontend-handoff.ts       #   hardhat-deploy script writing {address, chainId, abi}
  frontend-fhevm-singleton.ts           #   getFhevmInstance() for React/Next.js
  frontend-user-decrypt.ts              #   EIP-712 user-decrypt helper
  encrypted-input-form.tsx              #   reference React form

deploy/                                 # working deploy scripts
hardhat.config.ts                       # both `hardhat` and `sepolia` networks wired
```

---

## Install

### Claude Code — personal use (all your projects)

```bash
mkdir -p ~/.claude/skills/fhevm
cp SKILL.md ~/.claude/skills/fhevm/SKILL.md
```

### Claude Code — single project

```bash
mkdir -p .claude/skills/fhevm
cp SKILL.md .claude/skills/fhevm/SKILL.md
```

The skill auto-activates when Claude sees imports like `@fhevm/solidity`,
types like `euint32`, calls like `FHE.fromExternal`, or keywords like
"FHEVM" / "Zama" / "confidential token" in the conversation.

### Cursor / Windsurf / Aider

Drop `SKILL.md` into your project's root or `.cursor/rules/` directory
(Cursor) or `.aider.conf.yml`'s `read` list (Aider). The frontmatter is
ignored by these tools but the body works as-is.

---

## Try it yourself

```bash
git clone <this-repo>
cd <this-repo>
npm install

# 1. Compile every example
npx hardhat compile

# 2. Run the full validation suite (21 passing)
npx hardhat test

# 3. See the anti-pattern catalog produce its documented errors
npx hardhat test test/FHECounter.mistakes.ts
```

The mistakes test prints each error to the console as it triggers — exactly
matching the strings in [SKILL.md §13](SKILL.md).

---

## Verified package versions

Captured from this repo's passing test run:

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

If versions diverge in future Zama releases, update the skill's [§17
Versions verified](SKILL.md) table accordingly.

---

## License

BSD-3-Clause-Clear. See [LICENSE](LICENSE).
