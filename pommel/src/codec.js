let codecModulePromise = null;
let codecModule = null;

function loadCodecModule() {
  if (!codecModulePromise) {
    codecModulePromise = import('./wasm/kitesabre_webcodec/kitesabre_webcodec.js').then(async (mod) => {
      await mod.default();
      codecModule = mod;
      return mod;
    });
  }

  return codecModulePromise;
}

export async function initializeCodec() {
  return loadCodecModule();
}

export async function encodeBinaryCommand(commandJson) {
  const mod = await loadCodecModule();
  return mod.encode_command(commandJson);
}

export async function createStreamDecoder() {
  const mod = await loadCodecModule();
  return new mod.StreamDecoder();
}

export function isCodecReady() {
  return codecModule !== null;
}
