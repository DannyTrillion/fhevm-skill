import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { MyConfidentialToken, MyConfidentialToken__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

describe("MyConfidentialToken (ERC-7984)", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let token: MyConfidentialToken;
  let addr: string;

  before(async function () {
    [, alice, bob] = await ethers.getSigners();
  });

  beforeEach(async function () {
    if (!fhevm.isMock) this.skip();
    token = (await (
      (await ethers.getContractFactory("MyConfidentialToken")) as MyConfidentialToken__factory
    ).deploy()) as MyConfidentialToken;
    addr = await token.getAddress();
  });

  async function decryptBalance(holder: HardhatEthersSigner) {
    const handle = await token.confidentialBalanceOf(holder.address);
    if (handle === ethers.ZeroHash) return 0n;
    return await fhevm.userDecryptEuint(FhevmType.euint64, handle, addr, holder);
  }

  it("mints encrypted balance and lets holder decrypt their own balance", async function () {
    const enc = await fhevm.createEncryptedInput(addr, alice.address).add64(100).encrypt();
    await (await token.connect(alice).mint(enc.handles[0], enc.inputProof)).wait();

    expect(await decryptBalance(alice)).to.eq(100n);
  });

  it("confidentialTransfer moves encrypted balance Alice → Bob", async function () {
    // Mint 100 to Alice
    const mintEnc = await fhevm.createEncryptedInput(addr, alice.address).add64(100).encrypt();
    await (await token.connect(alice).mint(mintEnc.handles[0], mintEnc.inputProof)).wait();

    // Alice transfers 30 to Bob using the externalEuint64 + proof overload
    const xferEnc = await fhevm.createEncryptedInput(addr, alice.address).add64(30).encrypt();
    await (
      await token
        .connect(alice)
        ["confidentialTransfer(address,bytes32,bytes)"](
          bob.address,
          xferEnc.handles[0],
          xferEnc.inputProof,
        )
    ).wait();

    expect(await decryptBalance(alice)).to.eq(70n);
    expect(await decryptBalance(bob)).to.eq(30n);
  });

  it("transferring more than balance results in zero transferred (FHESafeMath, no leak)", async function () {
    // Alice has 50
    const mintEnc = await fhevm.createEncryptedInput(addr, alice.address).add64(50).encrypt();
    await (await token.connect(alice).mint(mintEnc.handles[0], mintEnc.inputProof)).wait();

    // Try to transfer 200 — encrypted-side check should block transfer silently
    const xferEnc = await fhevm.createEncryptedInput(addr, alice.address).add64(200).encrypt();
    await (
      await token
        .connect(alice)
        ["confidentialTransfer(address,bytes32,bytes)"](
          bob.address,
          xferEnc.handles[0],
          xferEnc.inputProof,
        )
    ).wait();

    // Tx didn't revert — and balances are unchanged, because the underflow guard
    // inside FHESafeMath returns ebool=false and select keeps the originals.
    expect(await decryptBalance(alice)).to.eq(50n);
    expect(await decryptBalance(bob)).to.eq(0n);
  });

  it("non-holder cannot decrypt someone else's balance", async function () {
    const mintEnc = await fhevm.createEncryptedInput(addr, alice.address).add64(42).encrypt();
    await (await token.connect(alice).mint(mintEnc.handles[0], mintEnc.inputProof)).wait();

    const aliceBalanceHandle = await token.confidentialBalanceOf(alice.address);

    let caught: unknown;
    try {
      await fhevm.userDecryptEuint(FhevmType.euint64, aliceBalanceHandle, addr, bob);
    } catch (e) {
      caught = e;
    }
    expect(caught, "expected Bob to be refused").to.exist;
    console.log("  → cross-user decrypt refused:", (caught as Error).message);
  });
});
