import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import solc from "solc";

const projectRoot = process.cwd();
const contractPath = path.join(projectRoot, "contracts", "RefundProtocol.sol");
const outputDirectory = path.join(projectRoot, "lib", "generated");
const outputPath = path.join(outputDirectory, "refund-protocol-artifact.json");
const source = await readFile(contractPath, "utf8");

function findImports(importPath) {
  const candidates = [
    path.join(projectRoot, "node_modules", importPath),
    path.join(projectRoot, "contracts", importPath),
  ];
  for (const candidate of candidates) {
    try {
      return { contents: readFileSync(candidate, "utf8") };
    } catch {
      // Try the next deterministic import root.
    }
  }
  return { error: `Unable to resolve Solidity import: ${importPath}` };
}

const input = {
  language: "Solidity",
  sources: { "RefundProtocol.sol": { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

const compiled = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (compiled.errors || []).filter((entry) => entry.severity === "error");
if (errors.length) {
  throw new Error(errors.map((entry) => entry.formattedMessage).join("\n"));
}

const artifact = compiled.contracts?.["RefundProtocol.sol"]?.RefundProtocol;
if (!artifact?.abi || !artifact?.evm?.bytecode?.object) {
  throw new Error("RefundProtocol compilation did not produce an ABI and bytecode");
}

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  source: "circlefin/arc-escrow",
  license: "Apache-2.0",
  compiler: solc.version(),
  abi: artifact.abi,
  bytecode: `0x${artifact.evm.bytecode.object}`,
}, null, 2)}\n`, "utf8");
console.log(`Compiled RefundProtocol artifact: ${path.relative(projectRoot, outputPath)}`);
