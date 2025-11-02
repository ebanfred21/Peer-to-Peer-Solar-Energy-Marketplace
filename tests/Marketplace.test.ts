// File: tests/marketplace.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { uintCV, someCV, noneCV, principalCV } from "@stacks/transactions";

const ERR_NOT_AUTHORIZED = 100;
const ERR_OFFER_NOT_FOUND = 101;
const ERR_OFFER_EXPIRED = 102;
const ERR_OFFER_CANCELLED = 103;
const ERR_INVALID_QUANTITY = 106;
const ERR_ALREADY_ACCEPTED = 107;
const ERR_TRADE_IN_PROGRESS = 109;
const ERR_ORACLE_NOT_SET = 110;

interface Offer {
  producer: string;
  quantityKwh: bigint;
  pricePerKwh: bigint;
  durationBlocks: bigint;
  createdAt: bigint;
  expiresAt: bigint;
  active: boolean;
  cancelled: boolean;
  acceptedBy: string | null;
  tradeId: bigint | null;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class MarketplaceMock {
  state: {
    nextOfferId: bigint;
    oracleContract: string | null;
    platformFeeRate: bigint;
    feeRecipient: string;
    offers: Map<bigint, Offer>;
    offersByProducer: Map<string, bigint[]>;
  } = {
    nextOfferId: 0n,
    oracleContract: null,
    platformFeeRate: 50n,
    feeRecipient: "ST1ADMIN",
    offers: new Map(),
    offersByProducer: new Map(),
  };

  blockHeight = 100n;
  caller = "ST1PRODUCER";
  stxTransfers: Array<{ amount: bigint; from: string; to: string }> = [];

  reset() {
    this.state = {
      nextOfferId: 0n,
      oracleContract: null,
      platformFeeRate: 50n,
      feeRecipient: "ST1ADMIN",
      offers: new Map(),
      offersByProducer: new Map(),
    };
    this.blockHeight = 100n;
    this.caller = "ST1PRODUCER";
    this.stxTransfers = [];
  }

  setOracleContract(oracle: string): Result<boolean> {
    if (this.caller !== this.state.feeRecipient)
      return { ok: false, value: false };
    this.state.oracleContract = oracle;
    return { ok: true, value: true };
  }

  setPlatformFee(rate: bigint): Result<boolean> {
    if (this.caller !== this.state.feeRecipient)
      return { ok: false, value: false };
    if (rate > 1000n) return { ok: false, value: false };
    this.state.platformFeeRate = rate;
    return { ok: true, value: true };
  }

  setFeeRecipient(recipient: string): Result<boolean> {
    if (this.caller !== this.state.feeRecipient)
      return { ok: false, value: false };
    this.state.feeRecipient = recipient;
    return { ok: true, value: true };
  }

  createOffer(
    quantityKwh: bigint,
    pricePerKwh: bigint,
    durationBlocks: bigint
  ): Result<bigint> {
    if (quantityKwh <= 0n || pricePerKwh <= 0n || durationBlocks < 10n)
      return { ok: false, value: BigInt(ERR_INVALID_QUANTITY) };

    const offerId = this.state.nextOfferId;
    const expiresAt = this.blockHeight + durationBlocks;
    const currentOffers = this.state.offersByProducer.get(this.caller) || [];

    const offer: Offer = {
      producer: this.caller,
      quantityKwh,
      pricePerKwh,
      durationBlocks,
      createdAt: this.blockHeight,
      expiresAt,
      active: true,
      cancelled: false,
      acceptedBy: null,
      tradeId: null,
    };

    this.state.offers.set(offerId, offer);
    this.state.offersByProducer.set(this.caller, [...currentOffers, offerId]);
    this.state.nextOfferId += 1n;

    return { ok: true, value: offerId };
  }

  cancelOffer(offerId: bigint): Result<boolean> {
    const offer = this.state.offers.get(offerId);
    if (!offer) return { ok: false, value: BigInt(ERR_OFFER_NOT_FOUND) };
    if (offer.producer !== this.caller)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (!offer.active) return { ok: false, value: BigInt(ERR_OFFER_CANCELLED) };
    if (offer.acceptedBy !== null)
      return { ok: false, value: BigInt(ERR_TRADE_IN_PROGRESS) };

    this.state.offers.set(offerId, {
      ...offer,
      active: false,
      cancelled: true,
    });
    return { ok: true, value: true };
  }

  acceptOffer(
    offerId: bigint,
    tradeId: bigint
  ): Result<{ amountAfterFee: bigint; tradeId: bigint }> {
    const offer = this.state.offers.get(offerId);
    if (!offer) return { ok: false, value: BigInt(ERR_OFFER_NOT_FOUND) };
    if (!offer.active || offer.cancelled)
      return { ok: false, value: BigInt(ERR_OFFER_CANCELLED) };
    if (this.blockHeight > offer.expiresAt)
      return { ok: false, value: BigInt(ERR_OFFER_EXPIRED) };
    if (offer.acceptedBy !== null)
      return { ok: false, value: BigInt(ERR_ALREADY_ACCEPTED) };
    if (!this.state.oracleContract)
      return { ok: false, value: BigInt(ERR_ORACLE_NOT_SET) };

    const totalAmount = offer.quantityKwh * offer.pricePerKwh;
    const fee = (totalAmount * this.state.platformFeeRate) / 10000n;
    const amountAfterFee = totalAmount - fee;

    this.stxTransfers.push({
      amount: totalAmount,
      from: this.caller,
      to: "contract",
    });
    this.stxTransfers.push({
      amount: fee,
      from: "contract",
      to: this.state.feeRecipient,
    });

    this.state.offers.set(offerId, {
      ...offer,
      active: false,
      acceptedBy: this.caller,
      tradeId,
    });

    return { ok: true, value: { amountAfterFee, tradeId } };
  }

  getOffer(offerId: bigint): Offer | null {
    return this.state.offers.get(offerId) || null;
  }

  getNextOfferId(): Result<bigint> {
    return { ok: true, value: this.state.nextOfferId };
  }

  getPlatformFee(amount: bigint): Result<bigint> {
    const fee = (amount * this.state.platformFeeRate) / 10000n;
    return { ok: true, value: fee };
  }
}

describe("Marketplace", () => {
  let mock: MarketplaceMock;

  beforeEach(() => {
    mock = new MarketplaceMock();
    mock.reset();
    mock.caller = "ST1ADMIN";
    mock.setFeeRecipient("ST1ADMIN");
  });

  it("creates offer successfully", () => {
    mock.caller = "ST1PRODUCER";
    const result = mock.createOffer(50n, 2000n, 100n);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0n);

    const offer = mock.getOffer(0n);
    expect(offer?.producer).toBe("ST1PRODUCER");
    expect(offer?.quantityKwh).toBe(50n);
    expect(offer?.pricePerKwh).toBe(2000n);
    expect(offer?.durationBlocks).toBe(100n);
    expect(offer?.active).toBe(true);
    expect(offer?.expiresAt).toBe(200n);
  });

  it("rejects invalid offer parameters", () => {
    mock.caller = "ST1PRODUCER";
    expect(mock.createOffer(0n, 2000n, 100n).ok).toBe(false);
    expect(mock.createOffer(50n, 0n, 100n).ok).toBe(false);
    expect(mock.createOffer(50n, 2000n, 5n).ok).toBe(false);
  });

  it("cancels active offer", () => {
    mock.caller = "ST1PRODUCER";
    mock.createOffer(50n, 2000n, 100n);
    const result = mock.cancelOffer(0n);
    expect(result.ok).toBe(true);
    const offer = mock.getOffer(0n);
    expect(offer?.cancelled).toBe(true);
    expect(offer?.active).toBe(false);
  });

  it("rejects cancel by non-producer", () => {
    mock.caller = "ST1PRODUCER";
    mock.createOffer(50n, 2000n, 100n);
    mock.caller = "ST2HACKER";
    const result = mock.cancelOffer(0n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(BigInt(ERR_NOT_AUTHORIZED));
  });

  it("accepts offer with correct fee and escrow", () => {
    mock.caller = "ST1ADMIN";
    mock.setOracleContract("ST1ORACLE");
    mock.caller = "ST1PRODUCER";
    mock.createOffer(100n, 1500n, 200n);
    mock.caller = "ST1BUYER";
    mock.blockHeight = 150n;

    const result = mock.acceptOffer(0n, 999n);
    expect(result.ok).toBe(true);
    expect(result.value.amountAfterFee).toBe(
      100n * 1500n - (100n * 1500n * 50n) / 10000n
    );
    expect(result.value.tradeId).toBe(999n);

    const offer = mock.getOffer(0n);
    expect(offer?.acceptedBy).toBe("ST1BUYER");
    expect(offer?.active).toBe(false);

    expect(mock.stxTransfers).toContainEqual({
      amount: 150000n,
      from: "ST1BUYER",
      to: "contract",
    });
    expect(mock.stxTransfers).toContainEqual({
      amount: 750n,
      from: "contract",
      to: "ST1ADMIN",
    });
  });

  it("rejects accept if expired", () => {
    mock.caller = "ST1ADMIN";
    mock.setOracleContract("ST1ORACLE");
    mock.caller = "ST1PRODUCER";
    mock.createOffer(50n, 2000n, 10n);
    mock.blockHeight = 200n;
    mock.caller = "ST1BUYER";

    const result = mock.acceptOffer(0n, 1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(BigInt(ERR_OFFER_EXPIRED));
  });

  it("rejects accept without oracle", () => {
    mock.caller = "ST1PRODUCER";
    mock.createOffer(50n, 2000n, 100n);
    mock.caller = "ST1BUYER";
    const result = mock.acceptOffer(0n, 1n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(BigInt(ERR_ORACLE_NOT_SET));
  });

  it("updates platform fee correctly", () => {
    mock.caller = "ST1ADMIN";
    const result = mock.setPlatformFee(100n);
    expect(result.ok).toBe(true);
    expect(mock.state.platformFeeRate).toBe(100n);
  });

  it("returns correct next offer ID", () => {
    mock.caller = "ST1PRODUCER";
    mock.createOffer(10n, 1000n, 50n);
    mock.createOffer(20n, 1500n, 60n);
    const result = mock.getNextOfferId();
    expect(result.value).toBe(2n);
  });

  it("calculates platform fee accurately", () => {
    mock.state.platformFeeRate = 200n;
    const result = mock.getPlatformFee(10000n);
    expect(result.value).toBe(200n);
  });
});
