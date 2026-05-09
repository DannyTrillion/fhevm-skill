import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { SimpleEncryptedCounter, SimpleEncryptedCounter__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  const factory = (await ethers.getContractFactory("SimpleEncryptedCounter")) as SimpleEncryptedCounter__factory;
  const counter = (await factory.deploy()) as SimpleEncryptedCounter;
  const counterAddress = await counter.getAddress();
  return { counter, counterAddress };
}

describe("SimpleEncryptedCounter", function () {
  let signers: Signers;
  let counter: SimpleEncryptedCounter;
  let counterAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    ({ counter, counterAddress } = await deployFixture());
  });

  it("count is uninitialized after deployment", async function () {
    const encryptedCount = await counter.getCount();
    expect(encryptedCount).to.eq(ethers.ZeroHash);
  });

  it("anyone can increment and the result is publicly decryptable", async function () {
    await (await counter.connect(signers.alice).increment()).wait();
    await (await counter.connect(signers.bob).increment()).wait();
    await (await counter.connect(signers.deployer).increment()).wait();

    const encryptedCount = await counter.getCount();
    const clearCount = await fhevm.publicDecryptEuint(FhevmType.euint32, encryptedCount);
    expect(clearCount).to.eq(3);
  });
});
