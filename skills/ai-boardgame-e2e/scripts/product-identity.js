"use strict";

const crypto = require("crypto");
const { stableStringify } = require("./core");

const PRODUCT_IDENTITY_KINDS = Object.freeze({
  LOCAL_SOURCE: "local_source",
  DEPLOYED_WEB_ASSETS: "deployed_web_assets"
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizedUrl(value, label) {
  let url;
  try {
    url = new URL(String(value || ""));
  } catch (_error) {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error(`${label} must be an absolute HTTP(S) URL.`);
  }
  url.hash = "";
  return url.href;
}

function normalizedAsset(asset, index) {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    throw new Error(`deployed asset ${index} must be an object.`);
  }
  const url = normalizedUrl(asset.url, `deployed asset ${index}.url`);
  const contentType = String(asset.contentType || "").trim().toLowerCase();
  const digest = String(asset.sha256 || "").trim().toLowerCase();
  const bytes = Number(asset.bytes);
  if (!contentType) throw new Error(`deployed asset ${index}.contentType is required.`);
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error(`deployed asset ${index}.sha256 must be 64-hex.`);
  if (!Number.isInteger(bytes) || bytes < 0) throw new Error(`deployed asset ${index}.bytes must be a non-negative integer.`);
  return { url, contentType, bytes, sha256: digest };
}

function computeDeployedFingerprint(assets) {
  if (!Array.isArray(assets) || !assets.length) throw new Error("deployed assets must be a non-empty array.");
  const normalized = assets.map(normalizedAsset).sort((left, right) => left.url.localeCompare(right.url, "en"));
  if (new Set(normalized.map((asset) => asset.url)).size !== normalized.length) {
    throw new Error("deployed asset URLs must be unique.");
  }
  const fingerprintInput = normalized.map(({ url, sha256: digest }) => ({ url, sha256: digest }));
  return {
    assets: normalized,
    fingerprintSha256: sha256(Buffer.from(stableStringify(fingerprintInput), "utf8"))
  };
}

function normalizeProductIdentity(carrier) {
  if (!carrier || typeof carrier !== "object" || Array.isArray(carrier)) {
    throw new Error("product identity carrier must be an object.");
  }
  const supplied = carrier.identity && typeof carrier.identity === "object" && !Array.isArray(carrier.identity)
    ? carrier.identity
    : null;
  const inferredLocal = !supplied && (
    carrier.gitHead !== undefined
    || carrier.productSourceSha256 !== undefined
    || carrier.sourceTreeDirty !== undefined
  );
  const identity = supplied || (inferredLocal ? {
    kind: PRODUCT_IDENTITY_KINDS.LOCAL_SOURCE,
    gitHead: carrier.gitHead,
    productSourceSha256: carrier.productSourceSha256,
    sourceTreeDirty: carrier.sourceTreeDirty
  } : null);
  if (!identity) throw new Error("product identity is missing.");

  const kind = String(identity.kind || "");
  if (kind === PRODUCT_IDENTITY_KINDS.LOCAL_SOURCE) {
    const gitHead = String(identity.gitHead || "").trim().toLowerCase();
    const productSourceSha256 = String(identity.productSourceSha256 || "").trim().toLowerCase();
    if (!/^[a-f0-9]{40}$/.test(gitHead)) throw new Error("local_source identity requires a 40-hex gitHead.");
    if (!/^[a-f0-9]{64}$/.test(productSourceSha256)) {
      throw new Error("local_source identity requires a 64-hex productSourceSha256.");
    }
    if (typeof identity.sourceTreeDirty !== "boolean") {
      throw new Error("local_source identity requires a boolean sourceTreeDirty.");
    }
    return { kind, gitHead, productSourceSha256, sourceTreeDirty: identity.sourceTreeDirty };
  }

  if (kind === PRODUCT_IDENTITY_KINDS.DEPLOYED_WEB_ASSETS) {
    const entryUrl = normalizedUrl(identity.entryUrl, "deployed_web_assets identity.entryUrl");
    const computed = computeDeployedFingerprint(identity.assets);
    const suppliedFingerprint = String(identity.fingerprintSha256 || "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(suppliedFingerprint)) {
      throw new Error("deployed_web_assets identity requires a 64-hex fingerprintSha256.");
    }
    if (suppliedFingerprint !== computed.fingerprintSha256) {
      throw new Error("deployed_web_assets fingerprintSha256 does not match its asset manifest.");
    }
    if (!computed.assets.some((asset) => asset.url === entryUrl)) {
      throw new Error("deployed_web_assets manifest must include the entryUrl response.");
    }
    return {
      kind,
      entryUrl,
      fingerprintSha256: computed.fingerprintSha256,
      assets: computed.assets
    };
  }

  throw new Error("product identity kind must be local_source or deployed_web_assets.");
}

function productFingerprint(identity) {
  const normalized = normalizeProductIdentity({ identity });
  return normalized.kind === PRODUCT_IDENTITY_KINDS.LOCAL_SOURCE
    ? normalized.productSourceSha256
    : normalized.fingerprintSha256;
}

function sameProductIdentity(leftCarrier, rightCarrier) {
  try {
    return stableStringify(normalizeProductIdentity(leftCarrier))
      === stableStringify(normalizeProductIdentity(rightCarrier));
  } catch (_error) {
    return false;
  }
}

module.exports = {
  PRODUCT_IDENTITY_KINDS,
  computeDeployedFingerprint,
  normalizeProductIdentity,
  productFingerprint,
  sameProductIdentity
};
