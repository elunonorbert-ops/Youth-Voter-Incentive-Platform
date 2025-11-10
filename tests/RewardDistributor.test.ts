import { describe, it, expect, beforeEach } from "vitest";
import {
  stringAsciiCV,
  uintCV,
  principalCV,
  bufferCV,
} from "@stacks/transactions";
const ERR_UNAUTHORIZED = 1000;
const ERR_INVALID_PROOF = 1001;
const ERR_INVALID_SCORE = 1002;
const ERR_USER_NOT_REGISTERED = 1003;
const ERR_COOLDOWN_ACTIVE = 1004;
const ERR_MAX_REWARDS_EXCEEDED = 1005;
const ERR_INVALID_QUIZ_ID = 1006;
const ERR_INVALID_BONUS_AMOUNT = 1007;
const ERR_TOKEN_MINT_FAILED = 1008;
const ERR_INVALID_USER_AGE = 1009;
const ERR_ALREADY_CLAIMED = 1010;
interface UserRewards {
  quizzesCompleted: number;
  votesVerified: number;
  tokensEarned: number;
  lastEducationClaim: number;
  lastVotingClaim: number;
  totalRewardsClaimed: number;
}
interface Result<T> {
  ok: boolean;
  value: T;
}
class RewardDistributorMock {
  state: {
    totalRewardsMinted: number;
    baseRewardAmount: number;
    bonusMultiplier: number;
    cooldownBlocks: number;
    maxRewardsPerUser: number;
    authorityContract: string | null;
    userRewards: Map<string, UserRewards>;
    completedQuizzes: Map<string, boolean>;
    verifiedVotes: Map<string, boolean>;
  } = {
    totalRewardsMinted: 0,
    baseRewardAmount: 100,
    bonusMultiplier: 50,
    cooldownBlocks: 100,
    maxRewardsPerUser: 1000,
    authorityContract: null,
    userRewards: new Map(),
    completedQuizzes: new Map(),
    verifiedVotes: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  constructor() {
    this.reset();
  }
  reset() {
    this.state = {
      totalRewardsMinted: 0,
      baseRewardAmount: 100,
      bonusMultiplier: 50,
      cooldownBlocks: 100,
      maxRewardsPerUser: 1000,
      authorityContract: null,
      userRewards: new Map(),
      completedQuizzes: new Map(),
      verifiedVotes: new Map(),
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
  setBaseReward(newBase: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.baseRewardAmount = newBase;
    return { ok: true, value: true };
  }
  distributeEducationReward(
    user: string,
    quizId: number,
    score: number
  ): Result<boolean> {
    if (!this.state.userRewards.has(user))
      return { ok: false, value: ERR_USER_NOT_REGISTERED };
    const current = this.state.userRewards.get(user)!;
    const quizKey = `${user}-${quizId}`;
    if (this.state.completedQuizzes.has(quizKey))
      return { ok: false, value: ERR_ALREADY_CLAIMED };
    if (score < 50) return { ok: false, value: ERR_INVALID_SCORE };
    if (quizId < 1 || quizId > 100)
      return { ok: false, value: ERR_INVALID_QUIZ_ID };
    if (
      this.blockHeight - current.lastEducationClaim <
      this.state.cooldownBlocks
    )
      return { ok: false, value: ERR_COOLDOWN_ACTIVE };
    if (current.totalRewardsClaimed > this.state.maxRewardsPerUser)
      return { ok: false, value: ERR_MAX_REWARDS_EXCEEDED };
    const rewardAmount = Math.floor(
      this.state.baseRewardAmount * (score / 100)
    );
    const newCompletions = current.quizzesCompleted + 1;
    const newTokens = current.tokensEarned + rewardAmount;
    const newTotal = current.totalRewardsClaimed + rewardAmount;
    this.state.userRewards.set(user, {
      ...current,
      quizzesCompleted: newCompletions,
      tokensEarned: newTokens,
      lastEducationClaim: this.blockHeight,
      totalRewardsClaimed: newTotal,
    });
    this.state.completedQuizzes.set(quizKey, true);
    this.state.totalRewardsMinted += rewardAmount;
    return { ok: true, value: true };
  }
  distributeVotingBonus(
    user: string,
    electionId: number,
    proof: Buffer
  ): Result<boolean> {
    if (!this.state.userRewards.has(user))
      return { ok: false, value: ERR_USER_NOT_REGISTERED };
    const current = this.state.userRewards.get(user)!;
    const voteKey = `${user}-${electionId}`;
    if (this.state.verifiedVotes.has(voteKey))
      return { ok: false, value: ERR_ALREADY_CLAIMED };
    const proofHash = proof.toString("hex");
    if (proofHash !== "valid-proof-hash")
      return { ok: false, value: ERR_INVALID_PROOF };
    if (this.blockHeight - current.lastVotingClaim < this.state.cooldownBlocks)
      return { ok: false, value: ERR_COOLDOWN_ACTIVE };
    if (current.totalRewardsClaimed > this.state.maxRewardsPerUser)
      return { ok: false, value: ERR_MAX_REWARDS_EXCEEDED };
    const votes = current.votesVerified + 1;
    const bonusAmount = votes * this.state.bonusMultiplier;
    const newTokens = current.tokensEarned + bonusAmount;
    const newTotal = current.totalRewardsClaimed + bonusAmount;
    this.state.userRewards.set(user, {
      ...current,
      votesVerified: votes,
      tokensEarned: newTokens,
      lastVotingClaim: this.blockHeight,
      totalRewardsClaimed: newTotal,
    });
    this.state.verifiedVotes.set(voteKey, true);
    this.state.totalRewardsMinted += bonusAmount;
    return { ok: true, value: true };
  }
  getUserRewards(user: string): UserRewards | null {
    return this.state.userRewards.get(user) || null;
  }
  getTotalRewardsMinted(): number {
    return this.state.totalRewardsMinted;
  }
  getCompletedQuiz(user: string, quizId: number): boolean | null {
    const key = `${user}-${quizId}`;
    return this.state.completedQuizzes.get(key) || null;
  }
  getVerifiedVote(user: string, electionId: number): boolean | null {
    const key = `${user}-${electionId}`;
    return this.state.verifiedVotes.get(key) || null;
  }
  resetUserRewards(user: string): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    this.state.userRewards.delete(user);
    this.state.completedQuizzes.delete(`${user}-1`);
    this.state.verifiedVotes.delete(`${user}-1`);
    return { ok: true, value: true };
  }
  updateCooldown(newCooldown: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newCooldown <= 0) return { ok: false, value: ERR_INVALID_BONUS_AMOUNT };
    this.state.cooldownBlocks = newCooldown;
    return { ok: true, value: true };
  }
  registerUser(user: string): void {
    if (!this.state.userRewards.has(user)) {
      this.state.userRewards.set(user, {
        quizzesCompleted: 0,
        votesVerified: 0,
        tokensEarned: 0,
        lastEducationClaim: 0,
        lastVotingClaim: 0,
        totalRewardsClaimed: 0,
      });
    }
  }
}
describe("RewardDistributor", () => {
  let contract: RewardDistributorMock;
  beforeEach(() => {
    contract = new RewardDistributorMock();
    contract.reset();
  });
  it("distributes education reward successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerUser("ST1TEST");
    contract.blockHeight = 101;
    const result = contract.distributeEducationReward("ST1TEST", 1, 80);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const rewards = contract.getUserRewards("ST1TEST");
    expect(rewards?.tokensEarned).toBe(80);
    expect(rewards?.quizzesCompleted).toBe(1);
    expect(rewards?.lastEducationClaim).toBe(101);
    expect(contract.getTotalRewardsMinted()).toBe(80);
  });
  it("rejects education reward for invalid score", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerUser("ST1TEST");
    const result = contract.distributeEducationReward("ST1TEST", 1, 40);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SCORE);
  });
  it("rejects education reward for invalid quiz id", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerUser("ST1TEST");
    const result = contract.distributeEducationReward("ST1TEST", 0, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_QUIZ_ID);
  });
  it("rejects education reward during cooldown", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerUser("ST1TEST");
    contract.blockHeight = 50;
    contract.distributeEducationReward("ST1TEST", 1, 80);
    contract.blockHeight = 90;
    const result = contract.distributeEducationReward("ST1TEST", 2, 80);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COOLDOWN_ACTIVE);
  });
  it("rejects voting bonus for invalid proof", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerUser("ST1TEST");
    const proof = Buffer.from("invalid", "hex");
    const result = contract.distributeVotingBonus("ST1TEST", 1, proof);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROOF);
  });
  it("rejects rewards for unregistered user", () => {
    contract.setAuthorityContract("ST2TEST");
    const resultEdu = contract.distributeEducationReward("ST2UNREG", 1, 80);
    expect(resultEdu.ok).toBe(false);
    expect(resultEdu.value).toBe(ERR_USER_NOT_REGISTERED);
    const proof = Buffer.from("valid-proof-hash", "hex");
    const resultVote = contract.distributeVotingBonus("ST2UNREG", 1, proof);
    expect(resultVote.ok).toBe(false);
    expect(resultVote.value).toBe(ERR_USER_NOT_REGISTERED);
  });
  it("sets authority contract successfully", () => {
    const result = contract.setAuthorityContract("ST2TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.authorityContract).toBe("ST2TEST");
  });
  it("rejects setting authority twice", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setAuthorityContract("ST3TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
  it("updates cooldown successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateCooldown(200);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.cooldownBlocks).toBe(200);
  });
  it("rejects cooldown update without authority", () => {
    const result = contract.updateCooldown(200);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
  it("rejects invalid cooldown update", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.updateCooldown(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_BONUS_AMOUNT);
  });
  it("resets user rewards successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.registerUser("ST1TEST");
    contract.distributeEducationReward("ST1TEST", 1, 80);
    const result = contract.resetUserRewards("ST1TEST");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getUserRewards("ST1TEST")).toBeNull();
  });
  it("rejects reset without authority", () => {
    contract.registerUser("ST1TEST");
    const result = contract.resetUserRewards("ST1TEST");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
});
