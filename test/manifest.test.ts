import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SAFE_ALLOWANCE_SCHEME } from "../src/drivers/safe-allowance/driver.js";

/**
 * Guards the class of defect that unit tests structurally cannot see: the
 * manifest and the code disagreeing.
 *
 * Both real-run failures were of this kind. `scheme` defaulted to "exact" with
 * no driver behind it, so the default configuration could never settle; and
 * `repo`/`ref`/`actor` were read by main.ts while undeclared, which produced an
 * "Unexpected input(s)" warning. Every unit test passes inputs explicitly, so
 * nothing exercised the defaults or the declarations until a real invocation
 * did.
 */

const manifest = readFileSync(join(process.cwd(), "action.yml"), "utf8");

/** action.yml is simple and hand-written; a real YAML parser is not worth a dependency. */
function inputs(): Map<string, { default?: string }> {
  const section = manifest.slice(manifest.indexOf("\ninputs:"), manifest.indexOf("\noutputs:"));
  const found = new Map<string, { default?: string }>();
  let current: string | undefined;

  for (const line of section.split(/\r?\n/)) {
    const name = /^ {2}([a-z_]+):\s*$/.exec(line);
    if (name?.[1]) {
      current = name[1];
      found.set(current, {});
      continue;
    }
    const value = /^ {4}default:\s*"?([^"\n]*)"?\s*$/.exec(line);
    if (value && current) found.set(current, { default: value[1] });
  }
  return found;
}

test("the default scheme is one an installed driver actually supports", () => {
  const scheme = inputs().get("scheme")?.default;
  assert.equal(
    scheme,
    SAFE_ALLOWANCE_SCHEME,
    `action.yml defaults scheme to "${scheme}" but the only driver supports ` +
      `"${SAFE_ALLOWANCE_SCHEME}". A default with no driver behind it fails every ` +
      "real settlement with DRIVER_NOT_FOUND while every unit test passes.",
  );
});

test("the default network is the one AGENTS.md mandates", () => {
  // AllowanceModule is deployed on Ethereum Sepolia and absent from Base Sepolia.
  assert.equal(inputs().get("network")?.default, "eip155:11155111");
});

test("every input main.ts reads is declared in action.yml", () => {
  const main = readFileSync(join(process.cwd(), "src/main.ts"), "utf8");
  const read = new Set(
    [...main.matchAll(/\binput\("([a-z_]+)"\)/g)].map((m) => m[1] as string),
  );
  const declared = inputs();

  const undeclared = [...read].filter((name) => !declared.has(name));
  assert.deepEqual(
    undeclared,
    [],
    `main.ts reads ${undeclared.join(", ")} but action.yml does not declare them. ` +
      "Undeclared inputs still work, but Actions warns on every run and the " +
      "contract is invisible to anyone reading the manifest.",
  );
});

test("declared inputs are readable as blank without breaking fallbacks", () => {
  // A declared input a workflow omits arrives as "", not absent. readInput turns
  // that back into undefined; this asserts the manifest does not rely on some
  // other mechanism.
  const declared = inputs();
  for (const optional of ["repo", "ref", "actor", "comment"]) {
    assert.ok(declared.has(optional), `${optional} should be declared`);
    assert.equal(declared.get(optional)?.default, undefined, `${optional} should have no default`);
  }
});
