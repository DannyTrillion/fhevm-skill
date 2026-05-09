// Singleton wrapper around @zama-fhe/relayer-sdk for use in React / Next.js.
//
// Why a singleton: in a component, a naive `await initSDK()` runs on every
// render. Building the instance once and reusing it avoids re-loading the
// WASM bundle and re-fetching coprocessor metadata.
//
// Why the double `??=`: guards against the race where two components mount
// concurrently on first paint and both call getFhevmInstance() before the
// promise resolves. Without the guard, you can end up running initSDK()
// twice and creating two instances.

import { initSDK, createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/bundle";

let _instance: Awaited<ReturnType<typeof createInstance>> | null = null;
let _initPromise: Promise<void> | null = null;

export async function getFhevmInstance() {
  if (_instance) return _instance;
  _initPromise ??= initSDK();
  await _initPromise;
  _instance ??= await createInstance({ ...SepoliaConfig, network: window.ethereum });
  return _instance;
}
