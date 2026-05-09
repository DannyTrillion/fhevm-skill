import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import {
  FHECounter,
  FHECounter__factory,
  BadFHECounter,
  BadFHECounter__factory,
} from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

describe("FHECounter — deliberate mistakes", function () {
  let signers: Signers;
  let good: FHECounter;
  let goodAddr: string;
  let bad: BadFHECounter;
  let badAddr: string;

  before(async function () {
    const eth = await ethers.getSigners();
    signers = { deployer: eth[0], alice: eth[1], bob: eth[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();

    good = (await (
      (await ethers.getContractFactory("FHECounter")) as FHECounter__factory
    ).deploy()) as FHECounter;
    goodAddr = await good.getAddress();

    bad = (await (
      (await ethers.getContractFactory("BadFHECounter")) as BadFHECounter__factory
    ).deploy()) as BadFHECounter;
    badAddr = await bad.getAddress();
  });

  // -----------------------------------------------------------------
  // 1. Decrypting an uninitialized handle (bytes32(0))
  // -----------------------------------------------------------------
  it("MISTAKE 1: user-decrypting an uninitialized euint32 fails", async function () {
    const handle = await good.getCount();
    expect(handle).to.eq(ethers.ZeroHash); // never been written

    let caught: unknown;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, handle, goodAddr, signers.alice);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected userDecryptEuint to reject the zero handle").to.exist;
    console.log("  → MISTAKE 1 error:", (caught as Error).message);
  });

  // -----------------------------------------------------------------
  // 2. inputProof bound to Alice, submitted by Bob
  // -----------------------------------------------------------------
  it("MISTAKE 2: submitting another user's inputProof reverts", async function () {
    // Alice builds an input bundle bound to (goodAddr, alice)
    const enc = await fhevm
      .createEncryptedInput(goodAddr, signers.alice.address)
      .add32(1)
      .encrypt();

    // Bob tries to submit it
    let caught: unknown;
    try {
      await good.connect(signers.bob).increment(enc.handles[0], enc.inputProof);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected revert").to.exist;
    console.log("  → MISTAKE 2 error:", (caught as Error).message.split("\n")[0]);
  });

  // -----------------------------------------------------------------
  // 3. inputProof bound to a different contract address
  // -----------------------------------------------------------------
  it("MISTAKE 3: inputProof bound to wrong contract reverts", async function () {
    // Bundle bound to badAddr but submitted to good (different contract)
    const enc = await fhevm
      .createEncryptedInput(badAddr, signers.alice.address)
      .add32(1)
      .encrypt();

    let caught: unknown;
    try {
      await good.connect(signers.alice).increment(enc.handles[0], enc.inputProof);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected revert").to.exist;
    console.log("  → MISTAKE 3 error:", (caught as Error).message.split("\n")[0]);
  });

  // -----------------------------------------------------------------
  // 4. Empty / garbage inputProof
  // -----------------------------------------------------------------
  it("MISTAKE 4: empty inputProof reverts", async function () {
    const enc = await fhevm
      .createEncryptedInput(goodAddr, signers.alice.address)
      .add32(1)
      .encrypt();

    let caught: unknown;
    try {
      await good.connect(signers.alice).increment(enc.handles[0], "0x");
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected revert").to.exist;
    console.log("  → MISTAKE 4 error:", (caught as Error).message.split("\n")[0]);
  });

  // -----------------------------------------------------------------
  // 5. Missing FHE.allowThis(_count): second call reverts
  // -----------------------------------------------------------------
  it("MISTAKE 5: missing FHE.allowThis breaks the next transaction", async function () {
    const enc1 = await fhevm
      .createEncryptedInput(badAddr, signers.alice.address)
      .add32(1)
      .encrypt();

    // First call succeeds (initial _count handle is bytes32(0), treated as literal 0)
    await (
      await bad.connect(signers.alice).incrementMissingAllowThis(enc1.handles[0], enc1.inputProof)
    ).wait();

    // Second call: FHE.add(_count, v) needs the contract to be on _count's ACL.
    // It's not — we never called allowThis after writing _count.
    const enc2 = await fhevm
      .createEncryptedInput(badAddr, signers.alice.address)
      .add32(1)
      .encrypt();

    let caught: unknown;
    try {
      await bad.connect(signers.alice).incrementMissingAllowThis(enc2.handles[0], enc2.inputProof);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected revert").to.exist;
    console.log("  → MISTAKE 5 error:", (caught as Error).message.split("\n")[0]);
  });

  // -----------------------------------------------------------------
  // 6. Missing FHE.allow(_count, user): user-decrypt fails
  // -----------------------------------------------------------------
  it("MISTAKE 6: missing FHE.allow blocks the user from decrypting", async function () {
    const enc = await fhevm
      .createEncryptedInput(badAddr, signers.alice.address)
      .add32(7)
      .encrypt();

    // Tx itself succeeds — contract has the handle and is allowThis'd
    await (
      await bad.connect(signers.alice).incrementMissingUserAllow(enc.handles[0], enc.inputProof)
    ).wait();

    const handle = await bad.getCount();
    expect(handle).to.not.eq(ethers.ZeroHash);

    // But Alice cannot decrypt it: she's not on the ACL of _count
    let caught: unknown;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, handle, badAddr, signers.alice);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected user-decrypt to reject Alice").to.exist;
    console.log("  → MISTAKE 6 error:", (caught as Error).message);
  });
});
