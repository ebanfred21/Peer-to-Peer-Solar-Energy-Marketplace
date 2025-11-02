(define-constant ERR-NOT-AUTHORIZED u300)
(define-constant ERR-INSUFFICIENT-BALANCE u301)
(define-constant ERR-INVALID-AMOUNT u302)
(define-constant ERR-ORACLE-NOT-SET u303)
(define-constant ERR-TRADE-NOT-FOUND u304)
(define-constant ERR-TRADE-NOT-COMPLETED u305)
(define-constant ERR-ALREADY-MINTED u306)
(define-constant ERR-USER-NOT-REGISTERED u307)

(define-fungible-token energy-kwh)

(define-data-var oracle-contract (optional principal) none)
(define-data-var trade-escrow-contract principal tx-sender)

(define-map user-registry
  principal
  { registered: bool, total-minted: uint, last-mint-block: uint }
)

(define-map minted-by-trade uint bool)

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance energy-kwh who))
)

(define-read-only (get-total-supply)
  (ok (ft-get-supply energy-kwh))
)

(define-read-only (get-user-info (who principal))
  (map-get? user-registry who)
)

(define-read-only (get-oracle)
  (var-get oracle-contract)
)

(define-read-only (is-trade-minted (trade-id uint))
  (map-get? minted-by-trade trade-id)
)

(define-public (set-oracle-contract (oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get trade-escrow-contract)) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-contract (some oracle))
    (ok true)
  )
)

(define-public (register-user)
  (let ((user tx-sender))
    (match (map-get? user-registry user)
      existing (err ERR-USER-NOT-REGISTERED)
      (begin
        (map-set user-registry user
          { registered: true, total-minted: u0, last-mint-block: u0 }
        )
        (ok true)
      )
    )
  )
)

(define-public (mint-from-trade
  (trade-id uint)
  (recipient principal)
  (amount-kwh uint)
)
  (let (
    (trade-escrow (var-get trade-escrow-contract))
    (oracle (unwrap! (var-get oracle-contract) (err ERR-ORACLE-NOT-SET)))
    (user-info (unwrap! (map-get? user-registry recipient) (err ERR-USER-NOT-REGISTERED)))
    (already-minted (default-to false (map-get? minted-by-trade trade-id)))
  )
    (asserts! (is-eq tx-sender oracle) (err ERR-NOT-AUTHORIZED))
    (asserts! (> amount-kwh u0) (err ERR-INVALID-AMOUNT))
    (asserts! (not already-minted) (err ERR-ALREADY-MINTED))
    (try! (contract-call? trade-escrow get-trade trade-id))
    (let ((trade-status (get status (try! (contract-call? trade-escrow get-trade trade-id)))))
      (asserts! (is-eq trade-status "completed") (err ERR-TRADE-NOT-COMPLETED))
    )
    (try! (ft-mint? energy-kwh amount-kwh recipient))
    (map-set minted-by-trade trade-id true)
    (map-set user-registry recipient
      (merge user-info
        {
          total-minted: (+ (get total-minted user-info) amount-kwh),
          last-mint-block: block-height
        }
      )
    )
    (print { event: "energy-minted", trade-id: trade-id, recipient: recipient, amount: amount-kwh })
    (ok true)
  )
)

(define-public (transfer (amount uint) (sender principal) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender sender) (err ERR-NOT-AUTHORIZED))
    (ft-transfer? energy-kwh amount sender recipient)
  )
)

(define-public (burn (amount uint))
  (begin
    (asserts! (> (ft-get-balance energy-kwh tx-sender) amount) (err ERR-INSUFFICIENT-BALANCE))
    (ft-burn? energy-kwh amount tx-sender)
  )
)