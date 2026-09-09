import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbi, parseAbiParameters } from "viem";
import { verifiesGatewayCredit, verifiesUsdcDelivery } from "../lib/fast-deposit-proof";
import { ARC } from "../lib/arc/config";
const account = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const abi = parseAbi(["event Deposited(address indexed token, address indexed depositor, address indexed sender, uint256 value)"]);
function receipt() { return { status: "0x1", logs: [{ address: "0x0077777d7eba4688bdef3e311b846f25870a19b9", topics: encodeEventTopics({ abi, eventName: "Deposited", args: { token: ARC.contracts.usdc, depositor: account, sender: other } }) as string[], data: encodeAbiParameters(parseAbiParameters("uint256"), [3_000_000n]) }] }; }
describe("fast deposit destination proof", () => {
  it("requires the exact Gateway account, token, amount and successful receipt", () => {
    expect(verifiesGatewayCredit(receipt(), account, "3")).toBe(true);
    expect(verifiesGatewayCredit(receipt(), other, "3")).toBe(false);
    expect(verifiesGatewayCredit(receipt(), account, "4")).toBe(false);
    expect(verifiesGatewayCredit({ ...receipt(), status: "0x0" }, account, "3")).toBe(false);
    const fake = receipt(); fake.logs[0].address = other;
    expect(verifiesGatewayCredit(fake, account, "3")).toBe(false);
  });
  it("does not confuse a Gateway credit with wallet delivery", () => {
    expect(verifiesUsdcDelivery(receipt(), account, "3")).toBe(false);
  });
  it("checks the selected wallet receives the exact USDC amount", () => {
    const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
    const proof = { status: "0x1", logs: [{ address: ARC.contracts.usdc, topics: encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from: other, to: account } }) as string[], data: encodeAbiParameters(parseAbiParameters("uint256"), [3_000_000n]) }] };
    expect(verifiesUsdcDelivery(proof, account, "3")).toBe(true);
    expect(verifiesUsdcDelivery(proof, other, "3")).toBe(false);
    expect(verifiesUsdcDelivery(proof, account, "2.9")).toBe(false);
  });
});
