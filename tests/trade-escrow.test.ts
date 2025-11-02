// File: tests/trade-escrow.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 200;
const ERR_TRADE_NOT_FOUND = 201;
const ERR_TRADE_CANCELLED = 202;
const ERR_TRADE_COMPLETED = 203;
const ERR_INVALID_STATE = 205;
const ERR_DEADLINE_PASSED = 207;
const ERR_ALREADY_RELEASED = 208;
const ERR_DISPUTE_ACTIVE = 209;

interface Trade {
  offerId: bigint;
  buyer: string;
  producer: string;
  quantityKwh: bigint;
  pricePerKwh: bigint;
  totalAmount: bigint;
  feeAmount: bigint;
  amountAfterFee: bigint;
  createdAt: bigint;
  deliveryDeadline: bigint;
  status: string;
  oracleHash: Buffer | null;
  disputeInitiated: boolean;
  releasedToProducer: boolean;
  refundedToBuyer: boolean;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class TradeEscrowMock {
  state: {
    nextTradeId: bigint;
    trades: Map<bigint, Trade>;
    tradeByOffer: Map<bigint, bigint>;
  } = {
    nextTradeId: 0n,
    trades: new Map(),
    tradeByOffer: new Map(),
  };

  blockHeight = 1000n;
  caller = "ST1BUYER";
  contractOwner = "ST1ADMIN";
  stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];

  reset() {
    this.state = {
      nextTradeId: 0n,
      trades: new Map(),
      tradeByOffer: new Map(),
    };
    this.blockHeight = 1000n;
    this.caller = "ST1BUYER";
    this.stxTransfers = [];
  }

  createTrade(
    offerId: bigint,
    buyer: string,
    producer: string,
    quantity: bigint,
    price: bigint,
    total: bigint,
    fee: bigint,
    amountAfterFee: bigint,
    deliveryHours: bigint
  ): Result<bigint> {
    const tradeId = this.state.nextTradeId;
    const deadline = this.blockHeight + deliveryHours * 12n;

    const trade: Trade = {
      offerId,
      buyer,
      producer,
      quantityKwh: quantity,
      pricePerKwh: price,
      totalAmount: total,
      feeAmount: fee,
      amountAfterFee,
      createdAt: this.blockHeight,
      deliveryDeadline: deadline,
      status: "escrow",
      oracleHash: null,
      disputeInitiated: false,
      releasedToProducer: false,
      refundedToBuyer: false,
    };

    this.state.trades.set(tradeId, trade);
    this.state.tradeByOffer.set(offerId, tradeId);
    this.state.nextTradeId += 1n;

    return { ok: true, value: tradeId };
  }

  submitOracleProof(tradeId: bigint, energyHash: Buffer): Result<boolean> {
    const trade = this.state.trades.get(tradeId);
    if (!trade) return { ok: false, value: BigInt(ERR_TRADE_NOT_FOUND) };
    if (this.caller !== trade.buyer && this.caller !== trade.producer)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (trade.status !== "escrow")
      return { ok: false, value: BigInt(ERR_INVALID_STATE) };
    if (this.blockHeight > trade.deliveryDeadline)
      return { ok: false, value: BigInt(ERR_DEADLINE_PASSED) };

    this.state.trades.set(tradeId, {
      ...trade,
      oracleHash: energyHash,
      status: "verified",
    });
    return { ok: true, value: true };
  }

  releaseFunds(tradeId: bigint): Result<boolean> {
    const trade = this.state.trades.get(tradeId);
    if (!trade) return { ok: false, value: BigInt(ERR_TRADE_NOT_FOUND) };
    if (this.caller !== trade.buyer)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (trade.status !== "verified")
      return { ok: false, value: BigInt(ERR_INVALID_STATE) };
    if (trade.releasedToProducer)
      return { ok: false, value: BigInt(ERR_ALREADY_RELEASED) };
    if (trade.disputeInitiated)
      return { ok: false, value: BigInt(ERR_DISPUTE_ACTIVE) };

    this.stxTransfers.push({
      amount: trade.amountAfterFee,
      from: "contract",
      to: trade.producer,
    });
    this.state.trades.set(tradeId, {
      ...trade,
      status: "completed",
      releasedToProducer: true,
    });
    return { ok: true, value: true };
  }

  initiateDispute(tradeId: bigint): Result<boolean> {
    const trade = this.state.trades.get(tradeId);
    if (!trade) return { ok: false, value: BigInt(ERR_TRADE_NOT_FOUND) };
    if (this.caller !== trade.buyer && this.caller !== trade.producer)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (trade.status !== "escrow" && trade.status !== "verified")
      return { ok: false, value: BigInt(ERR_INVALID_STATE) };
    if (trade.disputeInitiated)
      return { ok: false, value: BigInt(ERR_DISPUTE_ACTIVE) };
    if (this.blockHeight > trade.deliveryDeadline)
      return { ok: false, value: BigInt(ERR_DEADLINE_PASSED) };

    this.state.trades.set(tradeId, {
      ...trade,
      disputeInitiated: true,
      status: "disputed",
    });
    return { ok: true, value: true };
  }

  cancelTrade(tradeId: bigint): Result<boolean> {
    const trade = this.state.trades.get(tradeId);
    if (!trade) return { ok: false, value: BigInt(ERR_TRADE_NOT_FOUND) };
    if (this.caller !== trade.buyer)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (trade.status !== "escrow")
      return { ok: false, value: BigInt(ERR_INVALID_STATE) };
    if (this.blockHeight <= trade.deliveryDeadline)
      return { ok: false, value: BigInt(ERR_DEADLINE_PASSED) };

    this.stxTransfers.push({
      amount: trade.totalAmount,
      from: "contract",
      to: trade.buyer,
    });
    this.state.trades.set(tradeId, {
      ...trade,
      status: "cancelled",
      refundedToBuyer: true,
    });
    return { ok: true, value: true };
  }

  resolveDispute(tradeId: bigint, releaseToProducer: boolean): Result<boolean> {
    const trade = this.state.trades.get(tradeId);
    if (!trade) return { ok: false, value: BigInt(ERR_TRADE_NOT_FOUND) };
    if (this.caller !== this.contractOwner)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (!trade.disputeInitiated)
      return { ok: false, value: BigInt(ERR_INVALID_STATE) };

    if (releaseToProducer) {
      this.stxTransfers.push({
        amount: trade.amountAfterFee,
        from: "contract",
        to: trade.producer,
      });
      this.state.trades.set(tradeId, {
        ...trade,
        status: "resolved-producer",
        releasedToProducer: true,
      });
    } else {
      this.stxTransfers.push({
        amount: trade.totalAmount,
        from: "contract",
        to: trade.buyer,
      });
      this.state.trades.set(tradeId, {
        ...trade,
        status: "resolved-buyer",
        refundedToBuyer: true,
      });
    }
    return { ok: true, value: true };
  }

  getTrade(tradeId: bigint): Trade | null {
    return this.state.trades.get(tradeId) || null;
  }
}

describe("TradeEscrow", () => {
  let mock: TradeEscrowMock;

  beforeEach(() => {
    mock = new TradeEscrowMock();
    mock.reset();
  });

  it("creates trade successfully", () => {
    const result = mock.createTrade(
      5n,
      "ST1BUYER",
      "ST1PRODUCER",
      100n,
      1500n,
      150000n,
      750n,
      149250n,
      24n
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);

    const trade = mock.getTrade(0n);
    expect(trade?.status).toBe("escrow");
    expect(trade?.deliveryDeadline).toBe(1000n + 24n * 12n);
  });

  it("submits oracle proof and verifies", () => {
    mock.createTrade(
      1n,
      "ST1BUYER",
      "ST1PRODUCER",
      50n,
      2000n,
      100000n,
      500n,
      99500n,
      48n
    );
    mock.caller = "ST1BUYER";
    const hash = Buffer.from("energy-delivered-proof", "utf8");
    const result = mock.submitOracleProof(0n, hash);
    expect(result.ok).toBe(true);

    const trade = mock.getTrade(0n);
    expect(trade?.status).toBe("verified");
    expect(trade?.oracleHash).toEqual(hash);
  });

  it("releases funds after verification", () => {
    mock.createTrade(
      1n,
      "ST1BUYER",
      "ST1PRODUCER",
      50n,
      2000n,
      100000n,
      500n,
      99500n,
      48n
    );
    mock.caller = "ST1BUYER";
    mock.submitOracleProof(0n, Buffer.from("proof"));
    const result = mock.releaseFunds(0n);
    expect(result.ok).toBe(true);

    expect(mock.stxTransfers).toContainEqual({
      amount: 99500n,
      from: "contract",
      to: "ST1PRODUCER",
    });

    const trade = mock.getTrade(0n);
    expect(trade?.status).toBe("completed");
    expect(trade?.releasedToProducer).toBe(true);
  });

  it("cancels trade after deadline", () => {
    mock.createTrade(
      1n,
      "ST1BUYER",
      "ST1PRODUCER",
      50n,
      2000n,
      100000n,
      500n,
      99500n,
      1n
    );
    mock.blockHeight = 2000n;
    mock.caller = "ST1BUYER";

    const result = mock.cancelTrade(0n);
    expect(result.ok).toBe(true);

    expect(mock.stxTransfers).toContainEqual({
      amount: 100000n,
      from: "contract",
      to: "ST1BUYER",
    });

    const trade = mock.getTrade(0n);
    expect(trade?.status).toBe("cancelled");
  });

  it("initiates and resolves dispute", () => {
    mock.createTrade(
      1n,
      "ST1BUYER",
      "ST1PRODUCER",
      50n,
      2000n,
      100000n,
      500n,
      99500n,
      48n
    );
    mock.caller = "ST1BUYER";
    mock.initiateDispute(0n);

    mock.caller = "ST1ADMIN";
    const result = mock.resolveDispute(0n, true);
    expect(result.ok).toBe(true);

    expect(mock.stxTransfers).toContainEqual({
      amount: 99500n,
      from: "contract",
      to: "ST1PRODUCER",
    });

    const trade = mock.getTrade(0n);
    expect(trade?.status).toBe("resolved-producer");
  });

  it("refunds buyer on dispute resolution", () => {
    mock.createTrade(
      1n,
      "ST1BUYER",
      "ST1PRODUCER",
      50n,
      2000n,
      100000n,
      500n,
      99500n,
      48n
    );
    mock.caller = "ST1PRODUCER";
    mock.initiateDispute(0n);

    mock.caller = "ST1ADMIN";
    mock.resolveDispute(0n, false);

    expect(mock.stxTransfers).toContainEqual({
      amount: 100000n,
      from: "contract",
      to: "ST1BUYER",
    });
  });
});
