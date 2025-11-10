import { describe, it, expect, beforeEach } from "vitest";
import {
  stringUtf8CV,
  uintCV,
  principalCV,
  bufferCV,
} from "@stacks/transactions";
const ERR_UNAUTHORIZED = 2000;
const ERR_USER_ALREADY_REGISTERED = 2001;
const ERR_INVALID_AGE = 2002;
const ERR_INVALID_NAME = 2003;
const ERR_INVALID_EMAIL = 2004;
const ERR_MAX_USERS_EXCEEDED = 2005;
const ERR_INVALID_VERIFICATION = 2006;
const ERR_USER_NOT_FOUND = 2007;
const ERR_INVALID_UPDATE = 2008;
const ERR_SYBIL_DETECTED = 2009;
interface UserData {
  id: number;
  name: string;
  age: number;
  email: string;
  registeredAt: number;
  verified: boolean;
  lastUpdate: number;
  contributions: number;
}
interface Result<T> {
  ok: boolean;
  value: T;
}
class UserRegistryMock {
  state: {
    nextUserId: number;
    maxUsers: number;
    authorityContract: string | null;
    users: Map<string, UserData>;
    userById: Map<number, string>;
    userHashes: Map<string, string>;
  } = {
    nextUserId: 0,
    maxUsers: 10000,
    authorityContract: null,
    users: new Map(),
    userById: new Map(),
    userHashes: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  constructor() {
    this.reset();
  }
  reset() {
    this.state = {
      nextUserId: 0,
      maxUsers: 10000,
      authorityContract: null,
      users: new Map(),
      userById: new Map(),
      userHashes: new Map(),
    };
    this.blockHeight = 0;
    this.caller = "ST1TEST";
  }
  setAuthorityContract(contractPrincipal: string): Result<boolean> {
    if (this.state.authorityContract !== null) {
      return { ok: false, value: false };
    }
    this.state.authorityContract = contractPrincipal;
    return { ok: true, value: true };
  }
  setMaxUsers(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newMax <= 0) return { ok: false, value: ERR_INVALID_UPDATE };
    this.state.maxUsers = newMax;
    return { ok: true, value: true };
  }
  registerUser(name: string, age: number, email: string): Result<number> {
    if (this.state.users.has(this.caller))
      return { ok: false, value: ERR_USER_ALREADY_REGISTERED };
    if (this.state.nextUserId >= this.state.maxUsers)
      return { ok: false, value: ERR_MAX_USERS_EXCEEDED };
    if (age < 18 || age > 30) return { ok: false, value: ERR_INVALID_AGE };
    if (name.length === 0 || name.length > 50)
      return { ok: false, value: ERR_INVALID_NAME };
    if (email.length === 0 || email.length > 100 || !email.includes("@"))
      return { ok: false, value: ERR_INVALID_EMAIL };
    const userHash = require("crypto")
      .createHash("sha256")
      .update(name + email)
      .digest("hex");
    if (this.state.userHashes.has(userHash))
      return { ok: false, value: ERR_SYBIL_DETECTED };
    const id = this.state.nextUserId;
    const userData: UserData = {
      id,
      name,
      age,
      email,
      registeredAt: this.blockHeight,
      verified: false,
      lastUpdate: this.blockHeight,
      contributions: 0,
    };
    this.state.users.set(this.caller, userData);
    this.state.userById.set(id, this.caller);
    this.state.userHashes.set(userHash, this.caller);
    this.state.nextUserId++;
    return { ok: true, value: id };
  }
  verifyUser(user: string, verificationHash: Buffer): Result<boolean> {
    const userData = this.state.users.get(user);
    if (!userData) return { ok: false, value: ERR_USER_NOT_FOUND };
    const emailHash = require("crypto")
      .createHash("sha256")
      .update(userData.email)
      .digest("hex");
    if (verificationHash.toString("hex") !== emailHash || userData.verified) {
      return { ok: false, value: ERR_INVALID_VERIFICATION };
    }
    this.state.users.set(user, {
      ...userData,
      verified: true,
      lastUpdate: this.blockHeight,
    });
    return { ok: true, value: true };
  }
  updateUserInfo(
    newName: string,
    newAge: number,
    newEmail: string
  ): Result<boolean> {
    const current = this.state.users.get(this.caller);
    if (!current) return { ok: false, value: ERR_USER_NOT_FOUND };
    if (newAge < 18 || newAge > 30)
      return { ok: false, value: ERR_INVALID_AGE };
    if (newName.length === 0 || newName.length > 50)
      return { ok: false, value: ERR_INVALID_NAME };
    if (
      newEmail.length === 0 ||
      newEmail.length > 100 ||
      !newEmail.includes("@")
    )
      return { ok: false, value: ERR_INVALID_EMAIL };
    const newHash = require("crypto")
      .createHash("sha256")
      .update(newName + newEmail)
      .digest("hex");
    if (
      this.state.userHashes.has(newHash) &&
      this.state.userHashes.get(newHash) !== this.caller
    ) {
      return { ok: false, value: ERR_SYBIL_DETECTED };
    }
    const oldHash = require("crypto")
      .createHash("sha256")
      .update(current.name + current.email)
      .digest("hex");
    this.state.userHashes.delete(oldHash);
    this.state.userHashes.set(newHash, this.caller);
    this.state.users.set(this.caller, {
      ...current,
      name: newName,
      age: newAge,
      email: newEmail,
      lastUpdate: this.blockHeight,
      contributions: current.contributions + 1,
    });
    return { ok: true, value: true };
  }
  incrementContributions(user: string): Result<number> {
    const current = this.state.users.get(user);
    if (!current) return { ok: false, value: ERR_USER_NOT_FOUND };
    if (!current.verified)
      return { ok: false, value: ERR_INVALID_VERIFICATION };
    const newContribs = current.contributions + 1;
    this.state.users.set(user, {
      ...current,
      contributions: newContribs,
      lastUpdate: this.blockHeight,
    });
    return { ok: true, value: newContribs };
  }
  getUser(user: string): UserData | null {
    return this.state.users.get(user) || null;
  }
  getUserById(id: number): UserData | null {
    const principal = this.state.userById.get(id);
    return principal ? this.state.users.get(principal) || null : null;
  }
  isUserVerified(user: string): boolean {
    const data = this.state.users.get(user);
    return data ? data.verified : false;
  }
  getUserCount(): Result<number> {
    return { ok: true, value: this.state.nextUserId };
  }
  resetUser(user: string): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    const data = this.state.users.get(user);
    if (data) {
      const oldHash = require("crypto")
        .createHash("sha256")
        .update(data.name + data.email)
        .digest("hex");
      this.state.userHashes.delete(oldHash);
      this.state.users.delete(user);
      this.state.userById.delete(data.id);
    }
    return { ok: true, value: true };
  }
}
describe("UserRegistry", () => {
  let contract: UserRegistryMock;
  beforeEach(() => {
    contract = new UserRegistryMock();
    contract.reset();
  });
  it("registers a user successfully", () => {
    const result = contract.registerUser("John Doe", 25, "john@example.com");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const user = contract.getUser("ST1TEST");
    expect(user?.name).toBe("John Doe");
    expect(user?.age).toBe(25);
    expect(user?.email).toBe("john@example.com");
    expect(user?.verified).toBe(false);
    expect(contract.getUserCount().value).toBe(1);
  });
  it("rejects registration for already registered user", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const result = contract.registerUser("Jane Doe", 26, "jane@example.com");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_USER_ALREADY_REGISTERED);
  });
  it("rejects registration for invalid age", () => {
    const result = contract.registerUser("John Doe", 17, "john@example.com");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AGE);
  });
  it("rejects registration for invalid name", () => {
    const result = contract.registerUser("", 25, "john@example.com");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_NAME);
  });
  it("rejects registration for invalid email", () => {
    const result = contract.registerUser("John Doe", 25, "invalid-email");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_EMAIL);
  });
  it("detects sybil attack on registration", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    contract.caller = "ST2TEST";
    const result = contract.registerUser("John Doe", 25, "john@example.com");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SYBIL_DETECTED);
  });
  it("verifies a user successfully", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const emailHash = require("crypto")
      .createHash("sha256")
      .update("john@example.com")
      .digest();
    const result = contract.verifyUser("ST1TEST", emailHash);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const user = contract.getUser("ST1TEST");
    expect(user?.verified).toBe(true);
  });
  it("rejects verification for non-existent user", () => {
    const emailHash = require("crypto")
      .createHash("sha256")
      .update("john@example.com")
      .digest();
    const result = contract.verifyUser("ST2TEST", emailHash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_USER_NOT_FOUND);
  });
  it("rejects verification with invalid hash", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const invalidHash = Buffer.from("invalid");
    const result = contract.verifyUser("ST1TEST", invalidHash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VERIFICATION);
  });
  it("rejects re-verification", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const emailHash = require("crypto")
      .createHash("sha256")
      .update("john@example.com")
      .digest();
    contract.verifyUser("ST1TEST", emailHash);
    const result = contract.verifyUser("ST1TEST", emailHash);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VERIFICATION);
  });
  it("updates user info successfully", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const result = contract.updateUserInfo(
      "Jane Smith",
      26,
      "jane@example.com"
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const user = contract.getUser("ST1TEST");
    expect(user?.name).toBe("Jane Smith");
    expect(user?.age).toBe(26);
    expect(user?.email).toBe("jane@example.com");
    expect(user?.contributions).toBe(1);
  });
  it("rejects update for non-existent user", () => {
    const result = contract.updateUserInfo(
      "Jane Smith",
      26,
      "jane@example.com"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_USER_NOT_FOUND);
  });
  it("rejects update with invalid age", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const result = contract.updateUserInfo(
      "Jane Smith",
      31,
      "jane@example.com"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_AGE);
  });
  it("rejects update with sybil detection", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    contract.caller = "ST2TEST";
    contract.registerUser("Jane Smith", 26, "jane@example.com");
    contract.caller = "ST1TEST";
    const result = contract.updateUserInfo(
      "Jane Smith",
      27,
      "jane@example.com"
    );
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_SYBIL_DETECTED);
  });
  it("increments contributions successfully for verified user", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const emailHash = require("crypto")
      .createHash("sha256")
      .update("john@example.com")
      .digest();
    contract.verifyUser("ST1TEST", emailHash);
    const result = contract.incrementContributions("ST1TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(1);
    const user = contract.getUser("ST1TEST");
    expect(user?.contributions).toBe(1);
  });
  it("rejects increment for unverified user", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const result = contract.incrementContributions("ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VERIFICATION);
  });
  it("rejects increment for non-existent user", () => {
    const result = contract.incrementContributions("ST2TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_USER_NOT_FOUND);
  });
  it("retrieves user by ID successfully", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const user = contract.getUserById(0);
    expect(user?.id).toBe(0);
    expect(user?.name).toBe("John Doe");
  });
  it("returns false for unverified user", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    expect(contract.isUserVerified("ST1TEST")).toBe(false);
  });
  it("sets max users successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setMaxUsers(5000);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxUsers).toBe(5000);
  });
  it("rejects setting max users without authority", () => {
    const result = contract.setMaxUsers(5000);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
  it("resets user successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerUser("John Doe", 25, "john@example.com");
    const result = contract.resetUser("ST1TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getUser("ST1TEST")).toBeNull();
  });
  it("rejects reset without authority", () => {
    contract.registerUser("John Doe", 25, "john@example.com");
    const result = contract.resetUser("ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});
