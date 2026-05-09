import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, network } from "hardhat";
import { SealedBidAuction, SealedBidAuction__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  owner: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

const BIDDING_SECONDS = 60 * 60;

async function deployFixture(owner: HardhatEthersSigner) {
  const factory = (await ethers.getContractFactory("SealedBidAuction", owner)) as SealedBidAuction__factory;
  const auction = (await factory.deploy(BIDDING_SECONDS)) as SealedBidAuction;
  const auctionAddress = await auction.getAddress();
  return { auction, auctionAddress };
}

describe("SealedBidAuction", function () {
  let signers: Signers;
  let auction: SealedBidAuction;
  let auctionAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { owner: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    ({ auction, auctionAddress } = await deployFixture(signers.owner));
  });

  it("two bids: higher bidder wins, owner reveals, public decrypt confirms", async function () {
    // Alice bids 100
    const aliceBid = await fhevm
      .createEncryptedInput(auctionAddress, signers.alice.address)
      .add64(100)
      .encrypt();
    await (await auction.connect(signers.alice).bid(aliceBid.handles[0], aliceBid.inputProof)).wait();

    // Bob bids 250 — wins
    const bobBid = await fhevm
      .createEncryptedInput(auctionAddress, signers.bob.address)
      .add64(250)
      .encrypt();
    await (await auction.connect(signers.bob).bid(bobBid.handles[0], bobBid.inputProof)).wait();

    // Before reveal: non-owner cannot publicly decrypt — owner can user-decrypt
    const encryptedHighest = await auction.getHighestBid();
    const encryptedWinner = await auction.getWinner();

    const ownerSeesBid = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      encryptedHighest,
      auctionAddress,
      signers.owner,
    );
    const ownerSeesWinner = await fhevm.userDecryptEaddress(encryptedWinner, auctionAddress, signers.owner);
    expect(ownerSeesBid).to.eq(250n);
    expect(ownerSeesWinner.toLowerCase()).to.eq(signers.bob.address.toLowerCase());

    // Advance time past auction end and close
    await network.provider.send("evm_increaseTime", [BIDDING_SECONDS + 1]);
    await network.provider.send("evm_mine");
    await (await auction.connect(signers.owner).endAuction()).wait();

    // Owner reveals
    await (await auction.connect(signers.owner).reveal()).wait();

    // Public decrypt — anyone can read the cleared values now
    const clearHighest = await fhevm.publicDecryptEuint(FhevmType.euint64, encryptedHighest);
    const clearWinner = await fhevm.publicDecryptEaddress(encryptedWinner);
    expect(clearHighest).to.eq(250n);
    expect(clearWinner.toLowerCase()).to.eq(signers.bob.address.toLowerCase());
  });
});
