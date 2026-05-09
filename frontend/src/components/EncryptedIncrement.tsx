"use client";

import { useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { getFhevmInstance } from "../lib/fhevm";
import CounterArtifact from "../contracts/FHECounter.json";

const SEPOLIA_CHAIN_ID = 11155111n;

type Status =
  | { kind: "idle" }
  | { kind: "working"; message: string }
  | { kind: "success"; txHash: string }
  | { kind: "error"; message: string };

export function EncryptedIncrement() {
  const [value, setValue] = useState("1");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function handleSubmit() {
    const eth = (window as unknown as { ethereum?: unknown }).ethereum;
    if (!eth) {
      setStatus({ kind: "error", message: "No injected wallet found" });
      return;
    }

    let increment: number;
    try {
      increment = Number(value);
      if (!Number.isInteger(increment) || increment <= 0 || increment > 0xffffffff) {
        throw new Error();
      }
    } catch {
      setStatus({ kind: "error", message: "Increment must be a positive uint32" });
      return;
    }

    try {
      setStatus({ kind: "working", message: "Connecting wallet..." });
      const provider = new BrowserProvider(eth as never);
      await provider.send("eth_requestAccounts", []);
      const network = await provider.getNetwork();
      if (network.chainId !== SEPOLIA_CHAIN_ID) {
        setStatus({ kind: "error", message: `Wrong network: switch to Sepolia (chainId ${SEPOLIA_CHAIN_ID})` });
        return;
      }

      const signer = await provider.getSigner();
      const userAddress = await signer.getAddress();

      setStatus({ kind: "working", message: "Loading FHE relayer..." });
      const instance = await getFhevmInstance();

      setStatus({ kind: "working", message: "Encrypting increment..." });
      const input = instance.createEncryptedInput(CounterArtifact.address, userAddress);
      input.add32(increment);
      const encrypted = await input.encrypt();

      setStatus({ kind: "working", message: "Sending transaction..." });
      const counter = new Contract(CounterArtifact.address, CounterArtifact.abi, signer);
      const tx = await counter.increment(encrypted.handles[0], encrypted.inputProof);

      setStatus({ kind: "working", message: `Mining ${tx.hash.slice(0, 10)}...` });
      await tx.wait();

      setStatus({ kind: "success", txHash: tx.hash });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus({ kind: "error", message });
    }
  }

  const disabled = status.kind === "working";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 480 }}>
      <h2>Encrypted Counter</h2>
      <p>
        Contract: <code>{CounterArtifact.address}</code>
      </p>

      <label>
        Increment by (uint32)
        <input
          type="number"
          min={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
        />
      </label>

      <button onClick={handleSubmit} disabled={disabled}>
        {disabled ? "Working..." : "Submit encrypted increment"}
      </button>

      {status.kind === "working" && <p>{status.message}</p>}
      {status.kind === "success" && (
        <p>
          Submitted: <code>{status.txHash}</code>
        </p>
      )}
      {status.kind === "error" && <p style={{ color: "crimson" }}>Error: {status.message}</p>}
    </div>
  );
}
