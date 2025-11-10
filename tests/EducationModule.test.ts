import { describe, it, expect, beforeEach } from "vitest";
import {
  stringUtf8CV,
  uintCV,
  principalCV,
  listCV,
  tupleCV,
} from "@stacks/transactions";
const ERR_UNAUTHORIZED = 3000;
const ERR_INVALID_QUIZ = 3001;
const ERR_QUIZ_ALREADY_EXISTS = 3002;
const ERR_INVALID_QUESTION = 3003;
const ERR_INVALID_ANSWER = 3004;
const ERR_QUIZ_NOT_FOUND = 3005;
const ERR_COMPLETION_FAILED = 3006;
const ERR_USER_NOT_ELIGIBLE = 3007;
const ERR_MAX_QUIZZES_EXCEEDED = 3008;
const ERR_INVALID_SCORE_THRESHOLD = 3009;
interface Question {
  question: string;
  options: string[];
  correctIndex: number;
}
interface Quiz {
  title: string;
  description: string;
  questions: Question[];
  scoreThreshold: number;
  createdAt: number;
  creator: string;
}
interface Completion {
  submittedAt: number;
  score: number;
  passed: boolean;
}
interface Result<T> {
  ok: boolean;
  value: T;
}
class EducationModuleMock {
  state: {
    nextQuizId: number;
    maxQuizzes: number;
    authorityContract: string | null;
    defaultScoreThreshold: number;
    quizzes: Map<number, Quiz>;
    userCompletions: Map<string, Completion>;
    quizAttempts: Map<string, number>;
  } = {
    nextQuizId: 0,
    maxQuizzes: 50,
    authorityContract: null,
    defaultScoreThreshold: 60,
    quizzes: new Map(),
    userCompletions: new Map(),
    quizAttempts: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1TEST";
  constructor() {
    this.reset();
  }
  reset() {
    this.state = {
      nextQuizId: 0,
      maxQuizzes: 50,
      authorityContract: null,
      defaultScoreThreshold: 60,
      quizzes: new Map(),
      userCompletions: new Map(),
      quizAttempts: new Map(),
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
  setMaxQuizzes(newMax: number): Result<boolean> {
    if (!this.state.authorityContract) return { ok: false, value: false };
    if (newMax <= 0) return { ok: false, value: ERR_INVALID_QUIZ };
    this.state.maxQuizzes = newMax;
    return { ok: true, value: true };
  }
  createQuiz(
    title: string,
    description: string,
    questions: Question[],
    threshold: number
  ): Result<number> {
    if (this.state.nextQuizId >= this.state.maxQuizzes)
      return { ok: false, value: ERR_MAX_QUIZZES_EXCEEDED };
    if (this.state.quizzes.has(this.state.nextQuizId))
      return { ok: false, value: ERR_QUIZ_ALREADY_EXISTS };
    if (questions.length === 0 || questions.length > 20)
      return { ok: false, value: ERR_INVALID_QUESTION };
    if (threshold < 50)
      return { ok: false, value: ERR_INVALID_SCORE_THRESHOLD };
    questions.forEach((q) => {
      if (
        q.question.length === 0 ||
        q.question.length > 200 ||
        q.options.length !== 4 ||
        q.options.some((o) => o.length === 0 || o.length > 100) ||
        q.correctIndex < 0 ||
        q.correctIndex >= 4
      ) {
        throw new Error("Invalid question");
      }
    });
    const id = this.state.nextQuizId;
    const quiz: Quiz = {
      title,
      description,
      questions,
      scoreThreshold: threshold,
      createdAt: this.blockHeight,
      creator: this.caller,
    };
    this.state.quizzes.set(id, quiz);
    this.state.nextQuizId++;
    return { ok: true, value: id };
  }
  submitQuizAnswers(
    quizId: number,
    answers: number[]
  ): Result<{ score: number; passed: boolean }> {
    const quiz = this.state.quizzes.get(quizId);
    if (!quiz) return { ok: false, value: ERR_QUIZ_NOT_FOUND };
    if (answers.length !== quiz.questions.length)
      return { ok: false, value: ERR_INVALID_ANSWER };
    const correctAnswers = quiz.questions.filter(
      (q, i) => q.correctIndex === answers[i]
    ).length;
    const score = Math.floor((correctAnswers / quiz.questions.length) * 100);
    const passed = score >= quiz.scoreThreshold;
    const userKey = `${this.caller}-${quizId}`;
    const attempts = (this.state.quizAttempts.get(userKey) || 0) + 1;
    this.state.userCompletions.set(userKey, {
      submittedAt: this.blockHeight,
      score,
      passed,
    });
    this.state.quizAttempts.set(userKey, attempts);
    if (!passed) return { ok: false, value: ERR_COMPLETION_FAILED };
    return { ok: true, value: { score, passed } };
  }
  getQuiz(quizId: number): Quiz | null {
    return this.state.quizzes.get(quizId) || null;
  }
  getUserCompletion(user: string, quizId: number): Completion | null {
    const key = `${user}-${quizId}`;
    return this.state.userCompletions.get(key) || null;
  }
  getQuizAttempts(user: string, quizId: number): number | null {
    const key = `${user}-${quizId}`;
    return this.state.quizAttempts.get(key) || null;
  }
  getQuizCount(): Result<number> {
    return { ok: true, value: this.state.nextQuizId };
  }
  updateScoreThreshold(quizId: number, newThreshold: number): Result<boolean> {
    const quiz = this.state.quizzes.get(quizId);
    if (!quiz) return { ok: false, value: ERR_QUIZ_NOT_FOUND };
    if (quiz.creator !== this.caller)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (newThreshold < 50)
      return { ok: false, value: ERR_INVALID_SCORE_THRESHOLD };
    this.state.quizzes.set(quizId, { ...quiz, scoreThreshold: newThreshold });
    return { ok: true, value: true };
  }
  deleteQuiz(quizId: number): Result<boolean> {
    if (!this.state.authorityContract)
      return { ok: false, value: ERR_UNAUTHORIZED };
    if (!this.state.quizzes.has(quizId))
      return { ok: false, value: ERR_QUIZ_NOT_FOUND };
    this.state.quizzes.delete(quizId);
    return { ok: true, value: true };
  }
}
describe("EducationModule", () => {
  let contract: EducationModuleMock;
  beforeEach(() => {
    contract = new EducationModuleMock();
    contract.reset();
  });
  it("creates a quiz successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const questions = [
      {
        question: "What is voting?",
        options: ["Right", "Duty", "Option", "None"],
        correctIndex: 0,
      },
    ];
    const result = contract.createQuiz(
      "Voting Basics",
      "Intro quiz",
      questions,
      60
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const quiz = contract.getQuiz(0);
    expect(quiz?.title).toBe("Voting Basics");
    expect(quiz?.questions).toEqual(questions);
    expect(quiz?.scoreThreshold).toBe(60);
    expect(contract.getQuizCount().value).toBe(1);
  });
  it("rejects quiz creation when max exceeded", () => {
    contract.setAuthorityContract("ST2TEST");
    contract.state.maxQuizzes = 1;
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz1", "Desc1", questions, 60);
    const result = contract.createQuiz("Quiz2", "Desc2", questions, 60);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_MAX_QUIZZES_EXCEEDED);
  });
  it("rejects invalid score threshold", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    const result = contract.createQuiz("Quiz", "Desc", questions, 40);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SCORE_THRESHOLD);
  });
  it("submits quiz answers successfully with pass", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
      { question: "Q2", options: ["A", "B", "C", "D"], correctIndex: 1 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 50);
    const answers = [0, 1];
    const result = contract.submitQuizAnswers(0, answers);
    expect(result.ok).toBe(true);
    expect(result.value.score).toBe(100);
    expect(result.value.passed).toBe(true);
    const completion = contract.getUserCompletion("ST1TEST", 0);
    expect(completion?.passed).toBe(true);
    expect(completion?.score).toBe(100);
    expect(contract.getQuizAttempts("ST1TEST", 0)).toBe(1);
  });
  it("submits quiz answers with fail", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    const answers = [1];
    const result = contract.submitQuizAnswers(0, answers);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_COMPLETION_FAILED);
    const completion = contract.getUserCompletion("ST1TEST", 0);
    expect(completion?.passed).toBe(false);
    expect(completion?.score).toBe(0);
  });
  it("rejects submission for non-existent quiz", () => {
    const answers = [0];
    const result = contract.submitQuizAnswers(999, answers);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_QUIZ_NOT_FOUND);
  });
  it("rejects submission with wrong answer count", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    const answers = [0, 1];
    const result = contract.submitQuizAnswers(0, answers);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ANSWER);
  });
  it("updates score threshold successfully", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    const result = contract.updateScoreThreshold(0, 70);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    const quiz = contract.getQuiz(0);
    expect(quiz?.scoreThreshold).toBe(70);
  });
  it("rejects threshold update for non-creator", () => {
    contract.caller = "ST2TEST";
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.caller = "ST1TEST";
    contract.createQuiz("Quiz", "Desc", questions, 60);
    contract.caller = "ST2TEST";
    const result = contract.updateScoreThreshold(0, 70);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });
  it("rejects invalid threshold update", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    const result = contract.updateScoreThreshold(0, 40);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_SCORE_THRESHOLD);
  });
  it("deletes quiz successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    const result = contract.deleteQuiz(0);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.getQuiz(0)).toBeNull();
  });
  it("rejects delete without authority", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    const result = contract.deleteQuiz(0);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_UNAUTHORIZED);
  });
  it("rejects delete for non-existent quiz", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.deleteQuiz(999);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_QUIZ_NOT_FOUND);
  });
  it("sets max quizzes successfully", () => {
    contract.setAuthorityContract("ST2TEST");
    const result = contract.setMaxQuizzes(100);
    expect(result.ok).toBe(true);
    expect(result.value).toBe(true);
    expect(contract.state.maxQuizzes).toBe(100);
  });
  it("rejects setting max quizzes without authority", () => {
    const result = contract.setMaxQuizzes(100);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(false);
  });
  it("calculates score correctly for partial correct", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
      { question: "Q2", options: ["A", "B", "C", "D"], correctIndex: 1 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 50);
    const answers = [0, 2];
    const result = contract.submitQuizAnswers(0, answers);
    expect(result.ok).toBe(true);
    expect(result.value.score).toBe(50);
  });
  it("handles multiple attempts correctly", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    contract.submitQuizAnswers(0, [1]);
    contract.submitQuizAnswers(0, [0]);
    expect(contract.getQuizAttempts("ST1TEST", 0)).toBe(2);
  });
  it("retrieves completion correctly", () => {
    const questions = [
      { question: "Q1", options: ["A", "B", "C", "D"], correctIndex: 0 },
    ];
    contract.createQuiz("Quiz", "Desc", questions, 60);
    contract.submitQuizAnswers(0, [0]);
    const completion = contract.getUserCompletion("ST1TEST", 0);
    expect(completion?.score).toBe(100);
    expect(completion?.passed).toBe(true);
    expect(completion?.submittedAt).toBe(contract.blockHeight);
  });
});
