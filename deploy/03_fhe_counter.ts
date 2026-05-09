import { writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployed = await deploy("FHECounter", {
    from: deployer,
    log: true,
  });

  console.log(`FHECounter deployed at: ${deployed.address}`);

  const artifact = await hre.artifacts.readArtifact("FHECounter");
  const out = join(__dirname, "..", "frontend", "src", "contracts", "FHECounter.json");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        address: deployed.address,
        chainId: hre.network.config.chainId,
        abi: artifact.abi,
      },
      null,
      2,
    ),
  );
  console.log(`Frontend artifact written to ${out}`);
};

export default func;
func.id = "deploy_fhe_counter";
func.tags = ["FHECounter"];
