#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { parseArgs, writeJson } = require("./core");
const { PRODUCT_IDENTITY_KINDS, computeDeployedFingerprint } = require("./product-identity");

const MAX_ASSETS = 128;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;

function attributes(tag) {
  const result = {};
  const pattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    result[String(match[1]).toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return result;
}

function discoverAssetUrls(html, entryUrl) {
  const urls = new Set([entryUrl]);
  for (const tag of html.match(/<script\b[^>]*>/gi) || []) {
    const src = attributes(tag).src;
    if (src) urls.add(new URL(src, entryUrl).href.split("#", 1)[0]);
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const attrs = attributes(tag);
    const rels = String(attrs.rel || "").toLowerCase().split(/\s+/);
    if (attrs.href && rels.includes("stylesheet")) {
      urls.add(new URL(attrs.href, entryUrl).href.split("#", 1)[0]);
    }
  }
  if (urls.size > MAX_ASSETS) throw new Error(`Deployment references more than ${MAX_ASSETS} entry assets.`);
  return [...urls];
}

async function fetchAsset(url) {
  const response = await fetch(url, {
    redirect: "follow",
    headers: { "user-agent": "ai-boardgame-e2e-deployed-fingerprint/1.0" }
  });
  if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ASSET_BYTES) throw new Error(`Deployment asset exceeds ${MAX_ASSET_BYTES} bytes: ${url}`);
  return {
    url: response.url.split("#", 1)[0],
    contentType: String(response.headers.get("content-type") || "application/octet-stream").split(";", 1)[0].trim().toLowerCase(),
    bytes: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    buffer
  };
}

async function captureDeployment(entryUrl) {
  const requested = new URL(String(entryUrl || ""));
  if (!new Set(["http:", "https:"]).has(requested.protocol)) throw new Error("--url must be an absolute HTTP(S) URL.");
  requested.hash = "";
  const entry = await fetchAsset(requested.href);
  const html = entry.buffer.toString("utf8");
  const urls = discoverAssetUrls(html, entry.url);
  const assets = [{ ...entry }];
  for (const url of urls) {
    if (url === entry.url) continue;
    assets.push(await fetchAsset(url));
  }
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`Deployment asset manifest exceeds ${MAX_TOTAL_BYTES} total bytes.`);
  const manifestAssets = assets.map(({ buffer: _buffer, ...asset }) => asset);
  const computed = computeDeployedFingerprint(manifestAssets);
  return {
    kind: PRODUCT_IDENTITY_KINDS.DEPLOYED_WEB_ASSETS,
    entryUrl: entry.url,
    fingerprintSha256: computed.fingerprintSha256,
    assets: computed.assets
  };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const entryUrl = args.url || args.positional[0];
  if (!entryUrl) throw new Error("Usage: node deployed-asset-fingerprint.js --url <entry-url> [--output <identity.json>]");
  const identity = await captureDeployment(entryUrl);
  if (args.output) writeJson(path.resolve(args.output), identity);
  else process.stdout.write(`${JSON.stringify(identity, null, 2)}\n`);
  return identity;
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { attributes, discoverAssetUrls, fetchAsset, captureDeployment, main };
