import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { EncryptedMax, EncryptedMax__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("EncryptedMax — FHE.select + public reveal", function () {
  let owner: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let max: EncryptedMax;
  let addr: string;

  before(async function () {
    [owner, alice, bob] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    max = (await (
      (await ethers.getContractFactory("EncryptedMax")) as EncryptedMax__factory
    )
      .connect(owner)
      .deploy()) as EncryptedMax;
    addr = await max.getAddress();
  });

  async function submit(signer: HardhatEthersSigner, value: number) {
    const enc = await fhevm.createEncryptedInput(addr, signer.address).add32(value).encrypt();
    return (await max.connect(signer).submit(enc.handles[0], enc.inputProof)).wait();
  }

  it("tracks the maximum without revealing intermediates", async function () {
    await submit(alice, 5);
    await submit(bob, 12);
    await submit(alice, 3);
    await submit(bob, 9);

    const handle = await max.getHighest();

    // Owner is on the ACL — can decrypt.
    const v = await fhevm.userDecryptEuint(FhevmType.euint32, handle, addr, owner);
    expect(v).to.eq(12n);
  });

  it("submitters cannot decrypt the running max (no FHE.allow for them)", async function () {
    await submit(alice, 7);
    const handle = await max.getHighest();

    let caught: unknown;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint32, handle, addr, alice);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected ACL refusal for non-owner").to.exist;
    console.log("  → submitter-decrypt refused:", (caught as Error).message);
  });

  it("public reveal makes the value publicly decryptable", async function () {
    await submit(alice, 11);
    await submit(bob, 4);

    await (await max.connect(owner).reveal()).wait();

    const handle = await max.getHighest();
    const v = await fhevm.publicDecryptEuint(FhevmType.euint32, handle);
    expect(v).to.eq(11n);
  });

  it("public-decrypt before reveal fails", async function () {
    await submit(alice, 8);
    const handle = await max.getHighest();

    let caught: unknown;
    try {
      await fhevm.publicDecryptEuint(FhevmType.euint32, handle);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected public-decrypt to refuse before reveal").to.exist;
    console.log("  → public-decrypt before reveal:", (caught as Error).message);
  });

  it("reveal can only be called by owner", async function () {
    let caught: unknown;
    try {
      await max.connect(alice).reveal();
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected only-owner to revert").to.exist;
  });
});
