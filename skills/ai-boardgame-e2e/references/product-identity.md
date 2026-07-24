# Product identity for local and deployed Runs

A formal Run must prove that the product tested before play is the same product verified after cleanup. Use exactly one identity kind; never substitute a local checkout digest for an unknown deployment.

## Local source identity

Use `local_source` when the tested Server is started from or can be tied directly to the local checkout:

```json
{
  "passed": true,
  "command": "npm test",
  "testScope": "local_product_tests",
  "identity": {
    "kind": "local_source",
    "gitHead": "<40-hex>",
    "productSourceSha256": "<64-hex>",
    "sourceTreeDirty": false
  }
}
```

Legacy flat `gitHead`, `productSourceSha256`, and `sourceTreeDirty` fields remain readable. New evidence should use the explicit `identity` object.

## Deployed web-asset identity

Use `deployed_web_assets` when testing a URL whose Git commit and local source tree cannot be verified honestly. Capture the final entry HTML plus every external script and stylesheet referenced by that HTML:

```text
node <skill>/scripts/deployed-asset-fingerprint.js --url <entry-url> --output <temporary-identity.json>
```

The output contains:

```json
{
  "kind": "deployed_web_assets",
  "entryUrl": "https://example.test/Game/",
  "fingerprintSha256": "<64-hex>",
  "assets": [
    {
      "url": "https://example.test/Game/",
      "contentType": "text/html",
      "bytes": 1234,
      "sha256": "<64-hex>"
    }
  ]
}
```

The aggregate fingerprint is the SHA-256 of the canonical sorted `{url, sha256}` manifest. The auditor recomputes it, requires the manifest to include `entryUrl`, and compares the complete normalized identity before and after play. Asset order cannot change the identity; URL or content changes do.

Record the preflight as:

```json
{
  "type": "product_test",
  "command": "node deployed-asset-fingerprint.js --url https://example.test/Game/",
  "testScope": "deployed_asset_fingerprint",
  "passed": true,
  "identity": { "kind": "deployed_web_assets" }
}
```

Embed the full generated identity, not the shortened example. Store the same identity in `run.json.productBuild`. After cleanup, run the capture again and put the new full identity in `product_build_verified`. A mismatch fails product-integrity verification.

`deployed_asset_fingerprint` proves which public HTML/JS/CSS bytes were exercised and that they stayed stable. It does not claim a Git commit, local dirty flag, unreferenced lazy assets, source maps, Server-only code identity, or that local unit tests correspond to the deployment. Put those claims in `notEvaluated` unless separately proven.

## Historical reuse

For current-build reuse, query the same identity kind and its generic fingerprint:

```json
{
  "requireCurrentBuild": true,
  "currentProductIdentityKind": "deployed_web_assets",
  "currentProductFingerprintSha256": "<64-hex>"
}
```

For local-source compatibility, `currentProductSourceSha256` still resolves to `local_source`. Evidence from one identity kind cannot satisfy current-build reuse for the other kind.
