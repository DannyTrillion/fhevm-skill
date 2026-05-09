// Reference React component: takes a uint32 from the user, encrypts it
// against the (contract, user) pair, and submits via the contract's
// `setValue(externalEuint32, bytes)` function.
//
// Demonstrates:
//   - Singleton SDK pattern (see frontend-fhevm-singleton.ts)
//   - Wallet network verification before submission
//   - createEncryptedInput → add32 → encrypt → contract call
//
// Replace `MyContract.json` with your deployed artifact (see
// templates/deploy-with-frontend-handoff.ts) and `setValue` with your
// contract's actual function signature.

"use client";

import { useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { getFhevmInstance } from "./frontend-fhevm-singleton";
import MyContract from "./contracts/MyContract.json";

export function EncryptedInputForm() {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setStatus("Connecting wallet…");
    try {
      const provider = new BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      const { chainId } = await provider.getNetwork();
      if (Number(chainId) !== MyContract.chainId) {
        throw new Error(`Wrong network: switch to chainId ${MyContract.chainId}`);
      }

      setStatus("Encrypting input…");
      const instance = await getFhevmInstance();
      const enc = await instance
        .createEncryptedInput(MyContract.address, userAddress)
        .add32(BigInt(value))
        .encrypt();

      setStatus("Submitting transaction…");
      const contract = new Contract(MyContract.address, MyContract.abi, signer);
      const tx = await contract.setValue(enc.handles[0], enc.inputProof);
      await tx.wait();

      setStatus(`Submitted: ${tx.hash}`);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
      />
      <button onClick={submit} disabled={busy || !value}>
        Submit encrypted
      </button>
      {status && <p>{status}</p>}
    </div>
  );
}
