# FHEVM Skill — for Claude Code, Cursor, and Anthropic-compatible agents

> **Submission to the Zama Developer Program — Mainnet Season 2 (Bounty
> Track).** A production-quality AI skill that teaches agents to build
> correct FHEVM Solidity contracts, frontend integrations, and tests on
> the first try — backed by a working Hardhat repo where every pattern
> compiles and every documented error string is verified by a passing
> test.

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
| 5 | "Deploy Counter to Sepolia + wire up Next.js frontend" | ✅ `ZamaSepoliaConfig`, deploy with chainId handoff, MetaMask network guard |

Across the 5 tests the agent surfaced 14 bonus catches beyond the
documented pass criteria — preventing UX traps the user didn't ask
about, picking the privacy-correct types unprompted, pausing before
irreversible actions.

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
