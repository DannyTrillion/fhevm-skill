// EIP-712 user-decryption helper. Use when one specific user wants to read
// a value the contract has authorized for them via FHE.allow(handle, user).
//
// Flow: generate ephemeral keypair → sign EIP-712 message → relayer
// returns the cleartext re-encrypted to the ephemeral public key.
//
// The signature authorizes the relayer for a bounded time window
// (durationDays). After expiry the user must re-sign.

import { getFhevmInstance } from "./frontend-fhevm-singleton";
import { Signer } from "ethers";

export type DecryptParams = {
  handle: string;             // 0x... bytes32 ciphertext handle
  contractAddress: string;    // contract that owns the ACL grant
  signer: Signer;             // must be on the handle's ACL
  durationDays?: number;      // signature validity window in days, default 10
};

export async function userDecrypt({
  handle,
  contractAddress,
  signer,
  durationDays = 10,
}: DecryptParams): Promise<bigint | boolean | string> {
  const instance = await getFhevmInstance();
  const userAddress = await signer.getAddress();

  const keypair = instance.generateKeypair();
  const startTimeStamp = Math.floor(Date.now() / 1000);   // number — browser SDK rejects strings
  const contractAddresses = [contractAddress];

  const eip712 = instance.createEIP712(
    keypair.publicKey,
    contractAddresses,
    startTimeStamp,
    durationDays,
  );

  const signature = await signer.signTypedData(
    eip712.domain,
    { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
    eip712.message,
  );

  const result = await instance.userDecrypt(
    [{ handle, contractAddress }],
    keypair.privateKey,
    keypair.publicKey,
    signature.replace("0x", ""),
    contractAddresses,
    userAddress,
    startTimeStamp,
    durationDays,
  );

  return result[handle];
}
