// File: tests/energy-token.test.ts
import { describe, it, expect, beforeEach } from "vitest";

const ERR_NOT_AUTHORIZED = 300;
const ERR_INVALID_AMOUNT = 302;
const ERR_ORACLE_NOT_SET = 303;
const ERR_TRADE_NOT_FOUND = 304;
const ERR_TRADE_NOT_COMPLETED = 305;
const ERR_ALREADY_MINTED = 306;
const ERR_USER_NOT_REGISTERED = 307;

interface UserInfo {
  registered: boolean;
  totalMinted: bigint;
  lastMintBlock: bigint;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class EnergyTokenMock {
  state: {
    balances: Map<string, bigint>;
    totalSupply: bigint;
    oracleContract: string | null;
    tradeEscrowContract: string;
    userRegistry: Map<string, UserInfo>;
    mintedByTrade: Map<bigint, boolean>;
  } = {
    balances: new Map(),
    totalSupply: 0n,
    oracleContract: null,
    tradeEscrowContract: "ST1ESCROW",
    userRegistry: new Map(),
    mintedByTrade: new Map(),
  };

  caller = "ST1ORACLE";
  blockHeight = 2000n;

  reset() {
    this.state = {
      balances: new Map(),
      totalSupply: 0n,
      oracleContract: null,
      tradeEscrowContract: "ST1ESCROW",
      userRegistry: new Map(),
      mintedByTrade: new Map(),
    };
    this.caller = "ST1ORACLE";
    this.blockHeight = 2000n;
  }

  setOracleContract(oracle: string): Result<boolean> {
    if (this.caller !== this.state.tradeEscrowContract)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    this.state.oracleContract = oracle;
    return { ok: true, value: true };
  }

  registerUser(user: string): Result<boolean> {
    if (this.caller !== user)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (this.state.userRegistry.has(user))
      return { ok: false, value: BigInt(ERR_USER_NOT_REGISTERED) };

    this.state.userRegistry.set(user, {
      registered: true,
      totalMinted: 0n,
      lastMintBlock: 0n,
    });
    return { ok: true, value: true };
  }

  mintFromTrade(
    tradeId: bigint,
    recipient: string,
    amountKwh: bigint
  ): Result<boolean> {
    if (!this.state.oracleContract)
      return { ok: false, value: BigInt(ERR_ORACLE_NOT_SET) };
    if (this.caller !== this.state.oracleContract)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };
    if (amountKwh <= 0n)
      return { ok: false, value: BigInt(ERR_INVALID_AMOUNT) };

    const userInfo = this.state.userRegistry.get(recipient);
    if (!userInfo) return { ok: false, value: BigInt(ERR_USER_NOT_REGISTERED) };

    if (this.state.mintedByTrade.get(tradeId))
      return { ok: false, value: BigInt(ERR_ALREADY_MINTED) };

    const trade = this.getTrade(tradeId);
    if (!trade) return { ok: false, value: BigInt(ERR_TRADE_NOT_FOUND) };
    if (trade.status !== "completed")
      return { ok: false, value: BigInt(ERR_TRADE_NOT_COMPLETED) };

    const currentBal = this.state.balances.get(recipient) || 0n;
    this.state.balances.set(recipient, currentBal + amountKwh);
    this.state.totalSupply += amountKwh;
    this.state.mintedByTrade.set(tradeId, true);
    this.state.userRegistry.set(recipient, {
      ...userInfo,
      totalMinted: userInfo.totalMinted + amountKwh,
      lastMintBlock: this.blockHeight,
    });

    return { ok: true, value: true };
  }

  transfer(amount: bigint, sender: string, recipient: string): Result<boolean> {
    if (this.caller !== sender)
      return { ok: false, value: BigInt(ERR_NOT_AUTHORIZED) };

    const senderBal = this.state.balances.get(sender) || 0n;
    if (senderBal < amount) return { ok: false, value: false };

    this.state.balances.set(sender, senderBal - amount);
    const recipBal = this.state.balances.get(recipient) || 0n;
    this.state.balances.set(recipient, recipBal + amount);
    return { ok: true, value: true };
  }

  burn(amount: bigint): Result<boolean> {
    const bal = this.state.balances.get(this.caller) || 0n;
    if (bal < amount) return { ok: false, value: false };

    this.state.balances.set(this.caller, bal - amount);
    this.state.totalSupply -= amount;
    return { ok: true, value: true };
  }

  getBalance(who: string): Result<bigint> {
    return { ok: true, value: this.state.balances.get(who) || 0n };
  }

  getTotalSupply(): Result<bigint> {
    return { ok: true, value: this.state.totalSupply };
  }

  getUserInfo(who: string): UserInfo | null {
    return this.state.userRegistry.get(who) || null;
  }

  getTrade(tradeId: bigint): { status: string } | null {
    if (tradeId === 999n) {
      return { status: "completed" };
    }
    if (tradeId === 888n) {
      return { status: "escrow" };
    }
    return null;
  }
}

describe("EnergyToken", () => {
  let mock: EnergyTokenMock;

  beforeEach(() => {
    mock = new EnergyTokenMock();
    mock.reset();
    mock.caller = "ST1ESCROW";
    mock.setOracleContract("ST1ORACLE");
  });

  it("registers user successfully", () => {
    mock.caller = "ST1PRODUCER";
    const result = mock.registerUser("ST1PRODUCER");
    expect(result.ok).toBe(true);

    const info = mock.getUserInfo("ST1PRODUCER");
    expect(info?.registered).toBe(true);
    expect(info?.totalMinted).toBe(0n);
  });

  it("mints tokens after completed trade", () => {
    mock.caller = "ST1ESCROW";
    mock.setOracleContract("ST1ORACLE");

    mock.caller = "ST1PRODUCER";
    mock.registerUser("ST1PRODUCER");

    mock.caller = "ST1ORACLE";
    const result = mock.mintFromTrade(999n, "ST1PRODUCER", 100n);
    expect(result.ok).toBe(true);

    const balance = mock.getBalance("ST1PRODUCER");
    expect(balance.value).toBe(100n);

    const supply = mock.getTotalSupply();
    expect(supply.value).toBe(100n);

    const info = mock.getUserInfo("ST1PRODUCER");
    expect(info?.totalMinted).toBe(100n);
    expect(info?.lastMintBlock).toBe(2000n);
  });

  it("prevents minting from non-completed trade", () => {
    mock.caller = "ST1ESCROW";
    mock.setOracleContract("ST1ORACLE");

    mock.caller = "ST1PRODUCER";
    mock.registerUser("ST1PRODUCER");

    mock.caller = "ST1ORACLE";
    const result = mock.mintFromTrade(888n, "ST1PRODUCER", 50n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(BigInt(ERR_TRADE_NOT_COMPLETED));
  });

  it("prevents double minting for same trade", () => {
    mock.caller = "ST1ESCROW";
    mock.setOracleContract("ST1ORACLE");

    mock.caller = "ST1PRODUCER";
    mock.registerUser("ST1PRODUCER");

    mock.caller = "ST1ORACLE";
    mock.mintFromTrade(999n, "ST1PRODUCER", 100n);
    const result = mock.mintFromTrade(999n, "ST1PRODUCER", 50n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(BigInt(ERR_ALREADY_MINTED));
  });

  it("transfers tokens between users", () => {
    mock.caller = "ST1ESCROW";
    mock.setOracleContract("ST1ORACLE");

    mock.caller = "ST1PRODUCER";
    mock.registerUser("ST1PRODUCER");
    mock.caller = "ST1ORACLE";
    mock.mintFromTrade(999n, "ST1PRODUCER", 200n);

    mock.caller = "ST1PRODUCER";
    const result = mock.transfer(75n, "ST1PRODUCER", "ST1CONSUMER");
    expect(result.ok).toBe(true);

    expect(mock.getBalance("ST1PRODUCER").value).toBe(125n);
    expect(mock.getBalance("ST1CONSUMER").value).toBe(75n);
  });

  it("burns tokens correctly", () => {
    mock.caller = "ST1ESCROW";
    mock.setOracleContract("ST1ORACLE");

    mock.caller = "ST1PRODUCER";
    mock.registerUser("ST1PRODUCER");
    mock.caller = "ST1ORACLE";
    mock.mintFromTrade(999n, "ST1PRODUCER", 100n);

    mock.caller = "ST1PRODUCER";
    const result = mock.burn(30n);
    expect(result.ok).toBe(true);

    expect(mock.getBalance("ST1PRODUCER").value).toBe(70n);
    expect(mock.getTotalSupply().value).toBe(70n);
  });

  it("rejects mint without oracle", () => {
    mock.caller = "ST1ESCROW";
    mock.state.oracleContract = null;

    mock.caller = "ST1PRODUCER";
    mock.registerUser("ST1PRODUCER");

    mock.caller = "ST1ORACLE";
    const result = mock.mintFromTrade(999n, "ST1PRODUCER", 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(BigInt(ERR_ORACLE_NOT_SET));
  });

  it("rejects mint by non-oracle", () => {
    mock.caller = "ST1ESCROW";
    mock.setOracleContract("ST1ORACLE");

    mock.caller = "ST1PRODUCER";
    mock.registerUser("ST1PRODUCER");

    mock.caller = "ST1HACKER";
    const result = mock.mintFromTrade(999n, "ST1PRODUCER", 100n);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(BigInt(ERR_NOT_AUTHORIZED));
  });
});
