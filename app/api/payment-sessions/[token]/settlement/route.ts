import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isAddress } from "viem";
import { getCurrentUser } from "@/lib/server/auth";
import { hashInviteToken, paymentParties } from "@/lib/payment-session-security";
import { formatUsdc, parseUsdc } from "@/lib/money";
import { sessionView } from "@/lib/server/payment-sessions";
import { createCircleMintSandboxMockWirePayment, createCircleMintSandboxPayout, fetchCircleMintBalances, findCircleMintInboundTransfer, findCircleMintWireDeposit, getCircleMintSandboxPayout, getOrCreateCircleMintArcDepositAddress } from "@/lib/server/circle-mint";
import { createSettlementWalletTransfer, getSettlementWalletTransfer, verifyArcUsdcTransfer, verifySettlementWalletTransfer } from "@/lib/server/circle-settlement-wallet";
import { mutateDatabase, queryDatabase, type StoredInvoice, type StoredPaymentSession } from "@/lib/server/store";

function sessionForToken(token: string) {
  return queryDatabase((database) => database.paymentSessions.find((entry) => entry.inviteTokenHash === hashInviteToken(token) || entry.inviteTokenHash === token) ?? null);
}

function maximumSandboxAmount() {
  const value = process.env.PAYMENT_SESSION_SANDBOX_MAX_USD?.trim() || "10";
  return parseUsdc(value);
}

function isCompleteState(state?: string | null) {
  return ["COMPLETE", "CONFIRMED"].includes(String(state || "").toUpperCase());
}

function isFailedState(state?: string | null) {
  return ["FAILED", "DENIED", "CANCELLED"].includes(String(state || "").toUpperCase());
}

async function viewFor(sessionId: string, userId: string) {
  return queryDatabase((database) => {
    const session = database.paymentSessions.find((entry) => entry.id === sessionId);
    if (!session) throw new Error("Payment session not found");
    return sessionView(session, database.users, userId);
  });
}

async function runWeb3ToFiat(input: {
  session: StoredPaymentSession;
  currentUserId: string;
  payerId: string;
  receiverId: string;
  txHash?: string;
}) {
  const { session, currentUserId, payerId, receiverId } = input;
  if (parseUsdc(session.amount) > maximumSandboxAmount()) throw new Error(`Sandbox sessions are limited to ${formatUsdc(maximumSandboxAmount())} USD`);
  const payer = await queryDatabase((database) => database.users.find((entry) => entry.id === payerId) ?? null);
  const receiver = await queryDatabase((database) => database.users.find((entry) => entry.id === receiverId) ?? null);
  if (!payer?.walletAddress || !isAddress(payer.walletAddress)) throw new Error("The payer must bind a valid wallet address");
  const bankAccountId = process.env.CIRCLE_MINT_BANK_ACCOUNT_ID?.trim();
  if (!bankAccountId) throw new Error("Circle Mint sandbox bank account is not configured");
  const now = new Date().toISOString();

  if (!session.fiatSettlement) {
    if (currentUserId !== payerId) throw new Error("Only the payer can prepare the Circle deposit");
    const deposit = await getOrCreateCircleMintArcDepositAddress();
    if (!deposit.id || !deposit.address || !isAddress(deposit.address)) throw new Error("Circle Mint returned an invalid Arc deposit address");
    await mutateDatabase((database) => {
      const target = database.paymentSessions.find((entry) => entry.id === session.id)!;
      if (target.fiatSettlement) return;
      target.fiatSettlement = {
        mode: "web3_to_fiat", stage: "awaiting_web3_deposit", startingCircleBalance: null,
        wireSubmittedAt: null, mockWireTrackingRef: null, circleDepositId: null, circleDepositStatus: null,
        circleDepositAmount: null, circleDepositCreateDate: null, circleBalanceAfterDeposit: null,
        circleTransferId: null, circleTransferStatus: null, circleTransferTxHash: null,
        receiverTransferId: null, receiverTransferState: null, receiverTxHash: null,
        settlementWalletAddress: null, settlementWalletBalanceBefore: null, arcBlockNumber: null,
        circleDepositAddressId: deposit.id, circleDepositAddress: deposit.address,
        payerTransferTxHash: null, payerTransferBlockNumber: null,
        circleInboundTransferId: null, circleInboundTransferStatus: null,
        circlePayoutId: null, circlePayoutStatus: null, circlePayoutTrackingRef: null,
        circlePayoutDestinationName: null, payoutIdempotencyKey: randomUUID(),
        wireIdempotencyKey: randomUUID(), circleTransferIdempotencyKey: randomUUID(), receiverTransferIdempotencyKey: randomUUID(),
        error: null, updatedAt: now,
      };
      target.payerRailStatus = "funding";
      target.clearingStatus = "awaiting_payer";
      target.auditProof = { ...target.auditProof, circleDepositAddressId: deposit.id, circleDepositAddress: deposit.address, circleDepositChain: "ARC" };
      target.updatedAt = now;
    });
    return NextResponse.json({ session: await viewFor(session.id, currentUserId) });
  }

  let settlement = session.fiatSettlement;
  if (settlement.mode !== "web3_to_fiat") throw new Error("The saved settlement route does not match this payment session");
  if (settlement.stage === "awaiting_web3_deposit" && input.txHash) {
    if (currentUserId !== payerId) throw new Error("Only the payer can submit the deposit transaction");
    if (!/^0x[0-9a-fA-F]{64}$/.test(input.txHash)) throw new Error("Enter a valid Arc Testnet transaction hash");
    const proof = await verifyArcUsdcTransfer({
      txHash: input.txHash as `0x${string}`,
      sourceAddress: payer.walletAddress as `0x${string}`,
      destinationAddress: settlement.circleDepositAddress as `0x${string}`,
      amount: session.amount,
    });
    await mutateDatabase((database) => {
      const target = database.paymentSessions.find((entry) => entry.id === session.id)!;
      Object.assign(target.fiatSettlement!, { stage: "web3_deposit_submitted", payerTransferTxHash: input.txHash, payerTransferBlockNumber: proof.blockNumber, error: null, updatedAt: now });
      target.auditProof = { ...target.auditProof, payerTransferTxHash: input.txHash, payerTransferBlockNumber: proof.blockNumber, payerTransferBlockHash: proof.blockHash, onchainDepositVerified: true };
      target.clearingStatus = "clearing_on_arc";
      target.updatedAt = now;
    });
    settlement = (await sessionForTokenById(session.id)).fiatSettlement!;
  }

  if (settlement.stage === "web3_deposit_submitted") {
    const inbound = await findCircleMintInboundTransfer({ txHash: settlement.payerTransferTxHash!, amount: session.amount, submittedAfter: session.createdAt });
    if (!inbound) return NextResponse.json({ session: await viewFor(session.id, currentUserId), pending: true });
    if (isFailedState(inbound.status)) throw new Error(`Circle rejected the inbound USDC transfer${inbound.errorCode ? `: ${inbound.errorCode}` : ""}`);
    await mutateDatabase((database) => {
      const target = database.paymentSessions.find((entry) => entry.id === session.id)!;
      Object.assign(target.fiatSettlement!, {
        stage: isCompleteState(inbound.status) ? "circle_inbound_confirmed" : "web3_deposit_submitted",
        circleInboundTransferId: inbound.id || null, circleInboundTransferStatus: inbound.status || "pending",
        circleDepositId: inbound.id || null, circleDepositStatus: inbound.status || "pending",
        circleDepositAmount: inbound.amount?.amount || session.amount, circleDepositCreateDate: inbound.createDate || null,
        error: null, updatedAt: now,
      });
      target.auditProof = { ...target.auditProof, circleInboundTransferId: inbound.id, circleInboundTransferStatus: inbound.status, circleInboundTransactionHash: inbound.transactionHash };
      target.updatedAt = now;
    });
    if (!isCompleteState(inbound.status)) return NextResponse.json({ session: await viewFor(session.id, currentUserId), pending: true });
    settlement = (await sessionForTokenById(session.id)).fiatSettlement!;
  }

  if (settlement.stage === "circle_inbound_confirmed") {
    const claimed = await mutateDatabase((database) => {
      const target = database.paymentSessions.find((entry) => entry.id === session.id)!;
      if (target.fiatSettlement!.stage !== "circle_inbound_confirmed") return false;
      target.fiatSettlement!.stage = "fiat_payout_creating";
      target.fiatSettlement!.updatedAt = now; target.updatedAt = now; return true;
    });
    if (!claimed) return NextResponse.json({ session: await viewFor(session.id, currentUserId), pending: true });
    try {
      const payout = await createCircleMintSandboxPayout({ idempotencyKey: settlement.payoutIdempotencyKey!, bankAccountId, amount: session.amount, reference: `session-${session.id.slice(0, 8)}` });
      if (!payout.data?.id) throw new Error("Circle accepted the payout but did not return a payout ID");
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session.id)!;
        Object.assign(target.fiatSettlement!, { stage: "fiat_payout_submitted", circlePayoutId: payout.data!.id, circlePayoutStatus: payout.data!.status || "pending", circlePayoutTrackingRef: payout.data!.trackingRef || null, circlePayoutDestinationName: payout.data!.destination?.name || "Circle sandbox bank", error: null, updatedAt: now });
        target.receiverRailStatus = "payout_dispatching";
        target.auditProof = { ...target.auditProof, circlePayoutId: payout.data!.id, circlePayoutStatus: payout.data!.status, circlePayoutTrackingRef: payout.data!.trackingRef, circlePayoutDestination: payout.data!.destination };
        target.updatedAt = now;
        if (!database.fiatPayouts.some((entry) => entry.paymentSessionId === session.id)) database.fiatPayouts.push({ id: randomUUID(), ownerId: receiverId, paymentSessionId: session.id, circlePayoutId: payout.data!.id!, bankAccountId, amount: session.amount, currency: "USD", reference: `session-${session.id.slice(0, 8)}`, status: "submitted", trackingRef: payout.data!.trackingRef || null, destinationName: payout.data!.destination?.name || null, sourceWalletId: payout.data!.sourceWalletId || null, errorCode: payout.data!.errorCode || null, errorMessage: null, createdAt: now, updatedAt: now });
      });
    } catch (error) {
      await mutateDatabase((database) => { const target = database.paymentSessions.find((entry) => entry.id === session.id)!; target.fiatSettlement!.stage = "circle_inbound_confirmed"; target.updatedAt = new Date().toISOString(); });
      throw error;
    }
    settlement = (await sessionForTokenById(session.id)).fiatSettlement!;
  }

  if (settlement.stage === "fiat_payout_creating") return NextResponse.json({ session: await viewFor(session.id, currentUserId), pending: true });
  if (settlement.stage === "fiat_payout_submitted") {
    const payout = await getCircleMintSandboxPayout(settlement.circlePayoutId!);
    const state = payout.data?.status || settlement.circlePayoutStatus || "pending";
    if (isFailedState(state)) throw new Error(`Circle sandbox payout failed${payout.data?.errorCode ? `: ${payout.data.errorCode}` : ""}`);
    await mutateDatabase((database) => {
      const target = database.paymentSessions.find((entry) => entry.id === session.id)!;
      Object.assign(target.fiatSettlement!, { circlePayoutStatus: state, circlePayoutTrackingRef: payout.data?.trackingRef || target.fiatSettlement!.circlePayoutTrackingRef, circlePayoutDestinationName: payout.data?.destination?.name || target.fiatSettlement!.circlePayoutDestinationName, updatedAt: now });
      const record = database.fiatPayouts.find((entry) => entry.paymentSessionId === session.id);
      if (record) { record.status = isCompleteState(state) ? "confirmed" : "pending"; record.trackingRef = payout.data?.trackingRef || record.trackingRef; record.updatedAt = now; }
      if (!isCompleteState(state) || target.invoiceId) { target.updatedAt = now; return; }
      const invoice: StoredInvoice = { id: randomUUID(), senderId: payerId, recipientUserId: receiverId, recipientAddress: receiver?.walletAddress || bankAccountId, recipientLabel: receiver?.displayName || "Circle sandbox bank", amount: target.amount, token: "USDC", fundingMethod: "fiat_bank", sourceChain: "Arc Testnet + Circle sandbox", protocol: "fiat", paymentSessionId: target.id, txHash: target.fiatSettlement!.payerTransferTxHash!, explorerUrl: `https://testnet.arcscan.app/tx/${target.fiatSettlement!.payerTransferTxHash}`, status: "confirmed", memo: target.memo, createdAt: now };
      database.invoices.push(invoice); target.invoiceId = invoice.id; target.status = "complete"; target.payerRailStatus = "funded_on_arc"; target.receiverRailStatus = "settled"; target.clearingStatus = "settled"; target.arcEscrowTxHash = target.fiatSettlement!.payerTransferTxHash || null; target.fiatSettlement!.stage = "complete"; target.auditProof = { ...target.auditProof, circlePayoutStatus: state, circlePayoutTrackingRef: payout.data?.trackingRef, completedAt: now }; target.updatedAt = now;
    });
    if (!isCompleteState(state)) return NextResponse.json({ session: await viewFor(session.id, currentUserId), pending: true });
  }
  return NextResponse.json({ session: await viewFor(session.id, currentUserId) });
}

async function sessionForTokenById(sessionId: string) {
  const result = await queryDatabase((database) => database.paymentSessions.find((entry) => entry.id === sessionId) ?? null);
  if (!result) throw new Error("Payment session not found");
  return result;
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const current = await getCurrentUser();
  if (!current) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { token } = await params;
  try {
    let session = await sessionForToken(token);
    if (!session) throw new Error("Payment session not found");
    if (session.status !== "ready" && session.status !== "complete") throw new Error("This payment session is not ready");
    const parties = paymentParties(session);
    if (current.id !== parties.payerId && current.id !== parties.receiverId) throw new Error("Only session participants can advance settlement");
    if (parties.payerRail === "web3_usdc" && parties.receiverRail === "fiat_bank") {
      let body: { txHash?: string } = {};
      try { body = await _request.json(); } catch { /* Empty body is valid for initialization and polling. */ }
      return await runWeb3ToFiat({ session, currentUserId: current.id, payerId: parties.payerId!, receiverId: parties.receiverId!, txHash: body.txHash });
    }
    if (parties.payerRail !== "fiat_bank" || parties.receiverRail !== "web3_usdc") throw new Error("This sandbox route is not available yet");
    if (parseUsdc(session.amount) > maximumSandboxAmount()) {
      throw new Error(`Sandbox sessions are limited to ${formatUsdc(maximumSandboxAmount())} USD`);
    }
    const receiver = await queryDatabase((database) => database.users.find((entry) => entry.id === parties.receiverId) ?? null);
    if (!receiver?.walletAddress || !isAddress(receiver.walletAddress)) throw new Error("The receiver must bind a valid wallet address");

    if (!session.fiatSettlement) {
      if (current.id !== parties.payerId) throw new Error("Only the payer can start the sandbox bank payment");
      const bankAccountId = process.env.CIRCLE_MINT_BANK_ACCOUNT_ID?.trim();
      if (!bankAccountId) throw new Error("Circle Mint sandbox bank account is not configured");
      const balances = await fetchCircleMintBalances();
      const now = new Date().toISOString();
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id);
        if (!target?.fiatSettlement) {
          target!.fiatSettlement = {
            mode: "fiat_to_web3",
            stage: "not_started",
            startingCircleBalance: balances.availableUsd,
            wireSubmittedAt: null,
            mockWireTrackingRef: null,
            circleDepositId: null,
            circleDepositStatus: null,
            circleDepositAmount: null,
            circleDepositCreateDate: null,
            circleBalanceAfterDeposit: null,
            circleTransferId: null,
            circleTransferStatus: null,
            circleTransferTxHash: null,
            receiverTransferId: null,
            receiverTransferState: null,
            receiverTxHash: null,
            settlementWalletAddress: null,
            settlementWalletBalanceBefore: null,
            arcBlockNumber: null,
            wireIdempotencyKey: randomUUID(),
            circleTransferIdempotencyKey: randomUUID(),
            receiverTransferIdempotencyKey: randomUUID(),
            error: null,
            updatedAt: now,
          };
          target!.payerRailStatus = "funding";
          target!.clearingStatus = "awaiting_payer";
          target!.updatedAt = now;
        }
      });
      session = await sessionForToken(token);
    }

    const settlement = session!.fiatSettlement!;
    const now = new Date().toISOString();
    if (settlement.stage === "not_started" || (settlement.stage === "failed" && !settlement.mockWireTrackingRef)) {
      if (current.id !== parties.payerId) throw new Error("Only the payer can start the sandbox bank payment");
      const response = await createCircleMintSandboxMockWirePayment({
        bankAccountId: process.env.CIRCLE_MINT_BANK_ACCOUNT_ID!.trim(),
        amount: session!.amount,
        memo: `OffGrid session ${session!.id.slice(0, 8)}`,
      });
      const trackingRef = response.data?.trackingRef;
      if (!trackingRef) throw new Error("Circle accepted the mock wire but did not return its tracking reference");
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        target.fiatSettlement!.stage = "wire_submitted";
        target.fiatSettlement!.wireSubmittedAt = now;
        target.fiatSettlement!.mockWireTrackingRef = trackingRef;
        target.fiatSettlement!.error = null;
        target.fiatSettlement!.updatedAt = now;
        target.auditProof = { ...target.auditProof, circleMockWireTrackingRef: trackingRef, circleMockWireStatus: response.data?.status || "pending" };
        target.clearingStatus = "clearing_on_arc";
        target.updatedAt = now;
      });
    } else if (settlement.stage === "wire_submitted" || settlement.stage === "circle_balance_funded") {
      if (!settlement.mockWireTrackingRef) throw new Error("The Circle mock wire tracking reference is missing");
      const excludedDepositIds = await queryDatabase((database) => database.paymentSessions
        .filter((entry) => entry.id !== session!.id)
        .map((entry) => entry.fiatSettlement?.circleDepositId)
        .filter((id): id is string => Boolean(id)));
      const deposit = await findCircleMintWireDeposit({
        trackingRef: settlement.mockWireTrackingRef,
        amount: session!.amount,
        submittedAfter: settlement.wireSubmittedAt || session!.createdAt,
        excludedIds: excludedDepositIds,
      });
      if (!deposit) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
      const depositStatus = deposit.status || "pending";
      if (isFailedState(depositStatus)) throw new Error(`Circle sandbox deposit failed${deposit.riskEvaluation?.reason ? `: ${deposit.riskEvaluation.reason}` : ""}`);
      const balances = isCompleteState(depositStatus) ? await fetchCircleMintBalances() : null;
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        Object.assign(target.fiatSettlement!, {
          stage: isCompleteState(depositStatus) ? "circle_deposit_confirmed" : "wire_submitted",
          circleDepositId: deposit.id || null,
          circleDepositStatus: depositStatus,
          circleDepositAmount: deposit.amount?.amount || null,
          circleDepositCreateDate: deposit.createDate || null,
          circleBalanceAfterDeposit: balances?.availableUsd || null,
          error: null,
          updatedAt: now,
        });
        target.auditProof = {
          ...target.auditProof,
          circleDepositId: deposit.id,
          circleDepositStatus: depositStatus,
          circleDepositTrackingRef: deposit.trackingRef,
          circleDepositAmount: deposit.amount,
          circleDepositCreateDate: deposit.createDate,
          circleMintBalanceAfterDeposit: balances?.availableUsd,
        };
        target.updatedAt = now;
      });
      if (!isCompleteState(depositStatus)) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
    } else if (settlement.stage === "circle_deposit_confirmed") {
      const claimed = await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        if (target.fiatSettlement!.stage !== "circle_deposit_confirmed") return false;
        target.fiatSettlement!.stage = "receiver_transfer_creating";
        target.fiatSettlement!.error = null;
        target.fiatSettlement!.updatedAt = now;
        target.updatedAt = now;
        return true;
      });
      if (!claimed) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
      try {
        const relay = await createSettlementWalletTransfer({
          idempotencyKey: settlement.receiverTransferIdempotencyKey,
          destinationAddress: receiver.walletAddress,
          amount: session!.amount,
          reference: `session-${session!.id.slice(0, 8)}`,
        });
        await mutateDatabase((database) => {
          const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
          Object.assign(target.fiatSettlement!, {
            stage: "receiver_transfer_submitted",
            receiverTransferId: relay.id,
            receiverTransferState: relay.state,
            settlementWalletAddress: relay.sourceAddress,
            settlementWalletBalanceBefore: relay.sourceBalanceBefore,
            error: null,
            updatedAt: now,
          });
          target.auditProof = {
            ...target.auditProof,
            settlementWalletAddress: relay.sourceAddress,
            settlementWalletBalanceBefore: relay.sourceBalanceBefore,
            receiverTransferId: relay.id,
            receiverTransferState: relay.state,
          };
          target.updatedAt = now;
        });
      } catch (error) {
        await mutateDatabase((database) => {
          const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
          target.fiatSettlement!.stage = "circle_deposit_confirmed";
          target.fiatSettlement!.updatedAt = new Date().toISOString();
          target.updatedAt = target.fiatSettlement!.updatedAt;
        });
        throw error;
      }
    } else if (settlement.stage === "receiver_transfer_creating") {
      return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
    } else if (settlement.stage === "receiver_transfer_submitted") {
      const relay = await getSettlementWalletTransfer(settlement.receiverTransferId!);
      if (isFailedState(relay.state)) throw new Error(`Settlement wallet transfer failed${relay.errorReason ? `: ${relay.errorReason}` : ""}`);
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        target.fiatSettlement!.receiverTransferState = relay.state;
        target.fiatSettlement!.receiverTxHash = relay.txHash;
        target.fiatSettlement!.updatedAt = now;
        target.updatedAt = now;
      });
      if (!isCompleteState(relay.state) || !relay.txHash) return NextResponse.json({ session: await viewFor(session!.id, current.id), pending: true });
      const chainProof = await verifySettlementWalletTransfer({
        txHash: relay.txHash as `0x${string}`,
        destinationAddress: receiver.walletAddress,
        amount: session!.amount,
      });
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === session!.id)!;
        if (target.invoiceId) return;
        const recipient = database.users.find((entry) => entry.id === parties.receiverId)!;
        const invoice: StoredInvoice = {
          id: randomUUID(), senderId: parties.payerId!, recipientUserId: recipient.id,
          recipientAddress: recipient.walletAddress, recipientLabel: recipient.displayName,
          amount: target.amount, token: "USDC", fundingMethod: "fiat_bank", sourceChain: "Circle sandbox + Arc Testnet",
          protocol: "fiat", paymentSessionId: target.id, txHash: relay.txHash!,
          explorerUrl: `https://testnet.arcscan.app/tx/${relay.txHash}`, status: "confirmed", memo: target.memo,
          createdAt: now,
        };
        database.invoices.push(invoice);
        target.invoiceId = invoice.id;
        target.status = "complete";
        target.payerRailStatus = "funded_on_arc";
        target.receiverRailStatus = "settled";
        target.clearingStatus = "settled";
        target.arcEscrowTxHash = relay.txHash;
        target.fiatSettlement!.stage = "complete";
        target.fiatSettlement!.arcBlockNumber = chainProof.blockNumber;
        target.auditProof = {
          ...target.auditProof,
          receiverTransferState: relay.state,
          receiverTxHash: relay.txHash,
          arcBlockNumber: chainProof.blockNumber,
          arcBlockHash: chainProof.blockHash,
          onchainUsdcTransferVerified: true,
          completedAt: now,
        };
        target.updatedAt = now;
      });
    }
    return NextResponse.json({ session: await viewFor(session!.id, current.id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to advance sandbox settlement";
    const found = await sessionForToken(token).catch(() => null);
    if (found?.fiatSettlement) {
      await mutateDatabase((database) => {
        const target = database.paymentSessions.find((entry) => entry.id === found.id);
        if (target?.fiatSettlement) {
          target.fiatSettlement.error = message;
          target.fiatSettlement.updatedAt = new Date().toISOString();
          target.updatedAt = target.fiatSettlement.updatedAt;
        }
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: message.startsWith("Only ") ? 403 : 400 });
  }
}
