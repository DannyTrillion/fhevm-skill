"use client";

import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";

type Instance = Awaited<ReturnType<typeof createInstance>>;

let instancePromise: Promise<Instance> | null = null;

export function getFhevmInstance(): Promise<Instance> {
  if (!instancePromise) {
    instancePromise = (async () => {
      await initSDK();
      return createInstance({
        ...SepoliaConfig,
        network: (window as unknown as { ethereum: unknown }).ethereum,
      });
    })();
  }
  return instancePromise;
}
