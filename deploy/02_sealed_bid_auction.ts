import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const biddingSeconds = 60 * 60; // 1 hour bidding window

  const deployed = await deploy("SealedBidAuction", {
    from: deployer,
    args: [biddingSeconds],
    log: true,
  });

  console.log(`SealedBidAuction contract: `, deployed.address);
};
export default func;
func.id = "deploy_sealedBidAuction";
func.tags = ["SealedBidAuction"];
