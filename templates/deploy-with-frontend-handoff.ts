// Deploy script template. Drop into `deploy/` and Hardhat will pick it up.
//
// Two things this template does that the default does not:
//   1. Writes { address, chainId, abi } to a JSON the frontend imports —
//      the chainId lets the frontend verify wallet network at runtime.
//   2. Logs the deployed address. Default scripts run silently which is
//      annoying when you immediately need the address for `hardhat verify`.

import { writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const CONTRACT_NAME = "MyContract";                                    // ← change me
const FRONTEND_ARTIFACT = "frontend/src/contracts/MyContract.json";    // ← change me

const func: DeployFunction = async (hre: HardhatRuntimeEnvironment) => {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const result = await deploy(CONTRACT_NAME, {
    from: deployer,
    args: [],
    log: true,
  });

  const artifact = await hre.artifacts.readArtifact(CONTRACT_NAME);
  mkdirSync(dirname(FRONTEND_ARTIFACT), { recursive: true });
  writeFileSync(
    FRONTEND_ARTIFACT,
    JSON.stringify(
      {
        address: result.address,
        chainId: hre.network.config.chainId,
        abi: artifact.abi,
      },
      null,
      2,
    ),
  );

  console.log(`${CONTRACT_NAME} deployed at ${result.address} (chainId ${hre.network.config.chainId})`);
};

func.tags = [CONTRACT_NAME];
export default func;
