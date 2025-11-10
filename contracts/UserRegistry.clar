;; UserRegistry
(define-constant ERR_UNAUTHORIZED (err u2000))
(define-constant ERR_USER_ALREADY_REGISTERED (err u2001))
(define-constant ERR_INVALID_AGE (err u2002))
(define-constant ERR_INVALID_NAME (err u2003))
(define-constant ERR_INVALID_EMAIL (err u2004))
(define-constant ERR_MAX_USERS_EXCEEDED (err u2005))
(define-constant ERR_INVALID_VERIFICATION (err u2006))
(define-constant ERR_USER_NOT_FOUND (err u2007))
(define-constant ERR_INVALID_UPDATE (err u2008))
(define-constant ERR_SYBIL_DETECTED (err u2009))
(define-constant MIN_AGE u18)
(define-constant MAX_AGE u30)
(define-constant MAX_NAME_LEN u50)
(define-constant MAX_EMAIL_LEN u100)
(define-constant MAX_USERS u10000)
(define-data-var next-user-id uint u0)
(define-data-var max-users uint u10000)
(define-data-var authority-contract (optional principal) none)
(define-map users
  principal
  {
    id: uint,
    name: (string-utf8 50),
    age: uint,
    email: (string-utf8 100),
    registered-at: uint,
    verified: bool,
    last-update: uint,
    contributions: uint
  }
)
(define-map user-by-id
  uint
  principal
)
(define-map user-hashes
  (buff 32)
  principal
)
(define-private (validate-age (age uint))
  (if (and (>= age MIN_AGE) (<= age MAX_AGE))
      (ok true)
      (err ERR_INVALID_AGE))
)
(define-private (validate-name (name (string-utf8 50)))
  (if (and (> (len name) u0) (<= (len name) MAX_NAME_LEN))
      (ok true)
      (err ERR_INVALID_NAME))
)
(define-private (validate-email (email (string-utf8 100)))
  (if (and (> (len email) u0) (<= (len email) MAX_EMAIL_LEN) (contains email "@"))
      (ok true)
      (err ERR_INVALID_EMAIL))
)
(define-private (check-sybil (user-hash (buff 32)))
  (if (is-none (map-get? user-hashes user-hash))
      (ok true)
      (err ERR_SYBIL_DETECTED))
)
(define-private (generate-user-hash (name (string-utf8 50)) (email (string-utf8 100)))
  (sha256 (concat name email))
)
(define-public (set-authority-contract (contract-principal principal))
  (begin
    (asserts! (is-none (var-get authority-contract)) (err ERR_UNAUTHORIZED))
    (var-set authority-contract (some contract-principal))
    (ok true)
  )
)
(define-public (set-max-users (new-max uint))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR_UNAUTHORIZED))
    (asserts! (> new-max u0) (err ERR_INVALID_UPDATE))
    (var-set max-users new-max)
    (ok true)
  )
)
(define-public (register-user (name (string-utf8 50)) (age uint) (email (string-utf8 100)))
  (let (
        (caller tx-sender)
        (next-id (var-get next-user-id))
        (current-max (var-get max-users))
        (user-hash (generate-user-hash name email))
        (sybil-check (try! (check-sybil user-hash)))
        (name-valid (try! (validate-name name)))
        (age-valid (try! (validate-age age)))
        (email-valid (try! (validate-email email)))
      )
    (asserts! (is-none (map-get? users caller)) (err ERR_USER_ALREADY_REGISTERED))
    (asserts! (< next-id current-max) (err ERR_MAX_USERS_EXCEEDED))
    (map-set users caller
      {
        id: next-id,
        name: name,
        age: age,
        email: email,
        registered-at: block-height,
        verified: false,
        last-update: block-height,
        contributions: u0
      }
    )
    (map-set user-by-id next-id caller)
    (map-set user-hashes user-hash caller)
    (var-set next-user-id (+ next-id u1))
    (print {event: "user-registered", user: caller, id: next-id})
    (ok next-id)
  )
)
(define-public (verify-user (user principal) (verification-hash (buff 32)))
  (let (
        (user-data (unwrap! (map-get? users user) ERR_USER_NOT_FOUND))
        (valid-hash (is-eq verification-hash (sha256 (get email user-data))))
      )
    (asserts! valid-hash (err ERR_INVALID_VERIFICATION))
    (asserts! (not (get verified user-data)) (err ERR_INVALID_VERIFICATION))
    (map-set users user
      {
        id: (get id user-data),
        name: (get name user-data),
        age: (get age user-data),
        email: (get email user-data),
        registered-at: (get registered-at user-data),
        verified: true,
        last-update: block-height,
        contributions: (get contributions user-data)
      }
    )
    (print {event: "user-verified", user: user})
    (ok true)
  )
)
(define-public (update-user-info (new-name (string-utf8 50)) (new-age uint) (new-email (string-utf8 100)))
  (let (
        (caller tx-sender)
        (current (unwrap! (map-get? users caller) ERR_USER_NOT_FOUND))
        (name-valid (try! (validate-name new-name)))
        (age-valid (try! (validate-age new-age)))
        (email-valid (try! (validate-email new-email)))
        (new-hash (generate-user-hash new-name new-email))
        (sybil-check (try! (check-sybil new-hash)))
      )
    (map-set users caller
      {
        id: (get id current),
        name: new-name,
        age: new-age,
        email: new-email,
        registered-at: (get registered-at current),
        verified: (get verified current),
        last-update: block-height,
        contributions: (+ (get contributions current) u1)
      }
    )
    (map-delete user-hashes (generate-user-hash (get name current) (get email current)))
    (map-set user-hashes new-hash caller)
    (print {event: "user-updated", user: caller})
    (ok true)
  )
)
(define-public (increment-contributions (user principal))
  (let (
        (current (unwrap! (map-get? users user) ERR_USER_NOT_FOUND))
        (new-contribs (+ (get contributions current) u1))
      )
    (asserts! (get verified current) (err ERR_INVALID_VERIFICATION))
    (map-set users user
      {
        id: (get id current),
        name: (get name current),
        age: (get age current),
        email: (get email current),
        registered-at: (get registered-at current),
        verified: (get verified current),
        last-update: block-height,
        contributions: new-contribs
      }
    )
    (ok new-contribs)
  )
)
(define-read-only (get-user (user principal))
  (map-get? users user)
)
(define-read-only (get-user-by-id (id uint))
  (match (map-get? user-by-id id)
    principal (get-user principal)
    none
  )
)
(define-read-only (is-user-verified (user principal))
  (match (map-get? users user)
    some-data (get verified some-data)
    false
  )
)
(define-read-only (get-user-count)
  (ok (var-get next-user-id))
)
(define-public (reset-user (user principal))
  (begin
    (asserts! (is-some (var-get authority-contract)) (err ERR_UNAUTHORIZED))
    (map-delete users user)
    (ok true)
  )
)