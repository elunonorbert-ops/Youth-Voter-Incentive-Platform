;; EducationModule
(define-constant ERR_UNAUTHORIZED (err u3000))
(define-constant ERR_INVALID_QUIZ (err u3001))
(define-constant ERR_QUIZ_ALREADY_EXISTS (err u3002))
(define-constant ERR_INVALID_QUESTION (err u3003))
(define-constant ERR_INVALID_ANSWER (err u3004))
(define-constant ERR_QUIZ_NOT_FOUND (err u3005))
(define-constant ERR_COMPLETION_FAILED (err u3006))
(define-constant ERR_USER_NOT_ELIGIBLE (err u3007))
(define-constant ERR_MAX_QUIZZES_EXCEEDED (err u3008))
(define-constant ERR_INVALID_SCORE_THRESHOLD (err u3009))
(define-constant MAX_QUESTIONS u20)
(define-constant MAX_QUIZ_ID u1000)
(define-constant MIN_SCORE_THRESHOLD u50)
(define-constant MAX_QUIZZES u50)
(define-data-var next-quiz-id uint u0)
(define-data-var max-quizzes uint u50)
(define-data-var authority-contract (optional principal) none)
(define-data-var default-score-threshold uint u60)
(define-map quizzes
  uint
  {
    title: (string-utf8 100),
    description: (string-utf8 200),
    questions: (list 20 {question: (string-utf8 200), options: (list 4 (string-utf8 100)), correct-index: uint}),
    score-threshold: uint,
    created-at: uint,
    creator: principal
  }
)
(define-map user-completions
  {user: principal, quiz-id: uint}
  {
    submitted-at: uint,
    score: uint,
    passed: bool
  }
)
(define-map quiz-attempts
  {user: principal, quiz-id: uint}
  uint
)
(define-private (validate-quiz-id (quiz-id uint))
  (if (and (> quiz-id u0) (<= quiz-id MAX_QUIZ_ID))
      (ok true)
      (err ERR_INVALID_QUIZ))
)
(define-private (validate-question (q {question: (string-utf8 200), options: (list 4 (string-utf8 100)), correct-index: uint}))
  (let (
        (question-text (get question q))
        (options (get options q))
        (correct-idx (get correct-index q))
      )
    (and
      (and (> (len question-text) u0) (<= (len question-text) u200))
      (fold validate-option options true)
      (and (>= correct-idx u0) (< correct-idx (len options)))
    )
  )
  where
  (define-private (validate-option (opt (string-utf8 100)) (acc bool))
    (and acc (and (> (len opt) u0) (<= (len opt) u100)))
  )
)
(define-private (validate-questions-list (qs (list 20 {question: (string-utf8 200), options: (list 4 (string-utf8 100)), correct-index: uint})))
  (and (<= (len qs) MAX_QUESTIONS) (> (len qs) u0) (fold validate-question qs true))
)
(define-private (calculate-score (answers (list 20 uint)) (quiz-questions (list 20 {question: (string-utf8 200), options: (list 4 (string-utf8 100)), correct-index: uint})))
  (let (
        (total (len quiz-questions))
        (correct (fold check-answer (zip answers quiz-questions) u0))
      )
    (/ (* u100 correct) total)
  )
  where
  (define-private (check-answer (pair {answer: uint, q: {question: (string-utf8 200), options: (list 4 (string-utf8 100)), correct-index: uint}}) (acc uint))
    (if (is-eq (get answer pair) (get correct-index (get q pair))) (+ acc u1) acc)
  )
)
(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR_UNAUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)
(define-public (set-max-quizzes (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR_UNAUTHORIZED))
    (asserts! (> new-max u0) (err ERR_INVALID_QUIZ))
    (var-set max-quizzes new-max)
    (ok true)
  )
)
(define-public (create-quiz (title (string-utf8 100)) (description (string-utf8 200)) (questions (list 20 {question: (string-utf8 200), options: (list 4 (string-utf8 100)), correct-index: uint})) (threshold uint))
  (let (
        (next-id (var-get next-quiz-id))
        (current-max (var-get max-quizzes))
        (questions-valid (try! (validate-questions-list questions)))
        (threshold-valid (if (>= threshold MIN_SCORE_THRESHOLD) (ok true) (err ERR_INVALID_SCORE_THRESHOLD)))
      )
    (asserts! (< next-id current-max) (err ERR_MAX_QUIZZES_EXCEEDED))
    (asserts! (is-none (map-get? quizzes next-id)) (err ERR_QUIZ_ALREADY_EXISTS))
    (map-set quizzes next-id
      {
        title: title,
        description: description,
        questions: questions,
        score-threshold: threshold,
        created-at: block-height,
        creator: tx-sender
      }
    )
    (var-set next-quiz-id (+ next-id u1))
    (print {event: "quiz-created", id: next-id, title: title})
    (ok next-id)
  )
)
(define-public (submit-quiz-answers (quiz-id uint) (answers (list 20 uint)))
  (let* (
         (quiz (unwrap! (map-get? quizzes quiz-id) ERR_QUIZ_NOT_FOUND))
         (questions (get questions quiz))
         (user-key {user: tx-sender, quiz-id: quiz-id})
         (attempts (default-to u0 (map-get? quiz-attempts user-key)))
         (score (calculate-score answers questions))
         (threshold (get score-threshold quiz))
         (passed (>= score threshold))
         (new-attempts (+ attempts u1))
      )
    (asserts! (is-eq (len answers) (len questions)) (err ERR_INVALID_ANSWER))
    (map-set user-completions user-key
      {
        submitted-at: block-height,
        score: score,
        passed: passed
      }
    )
    (map-set quiz-attempts user-key new-attempts)
    (print {event: "quiz-submitted", user: tx-sender, quiz: quiz-id, score: score, passed: passed})
    (if passed
        (ok {score: score, passed: passed})
        (err ERR_COMPLETION_FAILED)
    )
  )
)
(define-public (get-quiz (quiz-id uint))
  (map-get? quizzes quiz-id)
)
(define-read-only (get-user-completion (user principal) (quiz-id uint))
  (map-get? user-completions {user: user, quiz-id: quiz-id})
)
(define-read-only (get-quiz-attempts (user principal) (quiz-id uint))
  (map-get? quiz-attempts {user: user, quiz-id: quiz-id})
)
(define-read-only (get-quiz-count)
  (ok (var-get next-quiz-id))
)
(define-public (update-score-threshold (quiz-id uint) (new-threshold uint))
  (let (
        (quiz (unwrap! (map-get? quizzes quiz-id) ERR_QUIZ_NOT_FOUND))
      )
    (asserts! (is-eq (get creator quiz) tx-sender) (err ERR_UNAUTHORIZED))
    (asserts! (>= new-threshold MIN_SCORE_THRESHOLD) (err ERR_INVALID_SCORE_THRESHOLD))
    (map-set quizzes quiz-id
      {
        title: (get title quiz),
        description: (get description quiz),
        questions: (get questions quiz),
        score-threshold: new-threshold,
        created-at: (get created-at quiz),
        creator: (get creator quiz)
      }
    )
    (ok true)
  )
)
(define-public (delete-quiz (quiz-id uint))
  (let (
        (quiz (unwrap! (map-get? quizzes quiz-id) ERR_QUIZ_NOT_FOUND))
      )
    (asserts! (is-some (var-get authority-contract)) (err ERR_UNAUTHORIZED))
    (map-delete quizzes quiz-id)
    (ok true)
  )
)