import { useState } from "react";
import { BrowserProvider, Contract, isAddress } from "ethers";
import {
  initSDK,
  createInstance,
  SepoliaConfig,
} from "@zama-fhe/relayer-sdk/bundle";

const TOKEN_ABI = [
  "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "function confidentialTransfer(address to, bytes32 encryptedAmount) returns (bytes32)",
];

type Status =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "success"; txHash: string }
  | { kind: "error"; message: string };

export function ConfidentialTransfer({ tokenAddress }: { tokenAddress: string }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  const disabled = status.kind === "working";

  async function handleTransfer() {
    if (!window.ethereum) {
      setStatus({ kind: "error", message: "No injected wallet found" });
      return;
    }
    if (!isAddress(recipient)) {
      setStatus({ kind: "error", message: "Invalid recipient address" });
      return;
    }
    let amountBig: bigint;
    try {
      amountBig = BigInt(amount);
      if (amountBig <= 0n) throw new Error();
    } catch {
      setStatus({ kind: "error", message: "Amount must be a positive integer" });
      return;
    }

    try {
      setStatus({ kind: "working", message: "Loading SDK..." });
      await initSDK();

      setStatus({ kind: "working", message: "Connecting wallet..." });
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      setStatus({ kind: "working", message: "Initializing relayer..." });
      const instance = await createInstance({
        ...SepoliaConfig,
        network: window.ethereum,
      });

      setStatus({ kind: "working", message: "Encrypting amount..." });
      const input = instance.createEncryptedInput(tokenAddress, userAddress);
      input.add64(amountBig);
      const encrypted = await input.encrypt();

      setStatus({ kind: "working", message: "Sending transaction..." });
      const token = new Contract(tokenAddress, TOKEN_ABI, signer);
      const tx = await token["confidentialTransfer(address,bytes32,bytes)"](
        recipient,
        encrypted.handles[0],
        encrypted.inputProof,
      );

      setStatus({ kind: "working", message: `Mining ${tx.hash.slice(0, 10)}...` });
      await tx.wait();

      setStatus({ kind: "success", txHash: tx.hash });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
      <h3>Confidential Transfer (ERC-7984)</h3>

      <label>
        Recipient
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x..."
          disabled={disabled}
        />
      </label>

      <label>
        Amount (plaintext units, encrypted before sending)
        <input
          type="text"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="100"
          disabled={disabled}
        />
      </label>

      <button onClick={handleTransfer} disabled={disabled}>
        {disabled ? "Working..." : "Transfer"}
      </button>

      {status.kind === "working" && <p>{status.message}</p>}
      {status.kind === "success" && (
        <p>
          Submitted: <code>{status.txHash}</code>
          <br />
          Note: ERC-7984 silently no-ops on insufficient balance. Decrypt the
          post-tx balance to confirm the transfer applied.
        </p>
      )}
      {status.kind === "error" && <p style={{ color: "crimson" }}>Error: {status.message}</p>}
    </div>
  );
}
