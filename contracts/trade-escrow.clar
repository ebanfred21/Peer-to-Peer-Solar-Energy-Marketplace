(define-constant ERR-NOT-AUTHORIZED u200)
(define-constant ERR-TRADE-NOT-FOUND u201)
(define-constant ERR-TRADE-CANCELLED u202)
(define-constant ERR-TRADE-COMPLETED u203)
(define-constant ERR-INSUFFICIENT-FUNDS u204)
(define-constant ERR-INVALID-STATE u205)
(define-constant ERR-ORACLE-FAILURE u206)
(define-constant ERR-DEADLINE-PASSED u207)
(define-constant ERR-ALREADY-RELEASED u208)
(define-constant ERR-DISPUTE-ACTIVE u209)

(define-data-var next-trade-id uint u0)

(define-map trades
  uint
  {
    offer-id: uint,
    buyer: principal,
    producer: principal,
    quantity-kwh: uint,
    price-per-kwh: uint,
    total-amount: uint,
    fee-amount: uint,
    amount-after-fee: uint,
    created-at: uint,
    delivery-deadline: uint,
    status: (string-ascii 20),
    oracle-hash: (optional (buff 32)),
    dispute-initiated: bool,
    released-to-producer: bool,
    refunded-to-buyer: bool
  }
)

(define-map trade-by-offer uint uint)

(define-read-only (get-trade (trade-id uint))
  (map-get? trades trade-id)
)

(define-read-only (get-trade-by-offer (offer-id uint))
  (map-get? trade-by-offer offer-id)
)

(define-read-only (get-next-trade-id)
  (ok (var-get next-trade-id))
)

(define-public (create-trade
  (offer-id uint)
  (buyer principal)
  (producer principal)
  (quantity uint)
  (price uint)
  (total uint)
  (fee uint)
  (amount-after-fee uint)
  (delivery-hours uint)
)
  (let (
    (trade-id (var-get next-trade-id))
    (deadline (+ block-height (* delivery-hours u12)))
  )
    (map-set trades trade-id
      {
        offer-id: offer-id,
        buyer: buyer,
        producer: producer,
        quantity-kwh: quantity,
        price-per-kwh: price,
        total-amount: total,
        fee-amount: fee,
        amount-after-fee: amount-after-fee,
        created-at: block-height,
        delivery-deadline: deadline,
        status: "escrow",
        oracle-hash: none,
        dispute-initiated: false,
        released-to-producer: false,
        refunded-to-buyer: false
      }
    )
    (map-set trade-by-offer offer-id trade-id)
    (var-set next-trade-id (+ trade-id u1))
    (print { event: "trade-created", trade-id: trade-id, offer-id: offer-id })
    (ok trade-id)
  )
)

(define-public (submit-oracle-proof (trade-id uint) (energy-hash (buff 32)))
  (let ((trade (unwrap! (map-get? trades trade-id) (err ERR-TRADE-NOT-FOUND))))
    (asserts! (or (is-eq tx-sender (get buyer trade)) (is-eq tx-sender (get producer trade))) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status trade) "escrow") (err ERR-INVALID-STATE))
    (asserts! (<= block-height (get delivery-deadline trade)) (err ERR-DEADLINE-PASSED))
    (map-set trades trade-id (merge trade { oracle-hash: (some energy-hash), status: "verified" }))
    (ok true)
  )
)

(define-public (release-funds (trade-id uint))
  (let ((trade (unwrap! (map-get? trades trade-id) (err ERR-TRADE-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get buyer trade)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status trade) "verified") (err ERR-INVALID-STATE))
    (asserts! (not (get released-to-producer trade)) (err ERR-ALREADY-RELEASED))
    (asserts! (not (get dispute-initiated trade)) (err ERR-DISPUTE-ACTIVE))
    (try! (as-contract (stx-transfer? (get amount-after-fee trade) tx-sender (get producer trade))))
    (map-set trades trade-id
      (merge trade
        {
          status: "completed",
          released-to-producer: true
        }
      )
    )
    (print { event: "funds-released", trade-id: trade-id, to: (get producer trade) })
    (ok true)
  )
)

(define-public (initiate-dispute (trade-id uint))
  (let ((trade (unwrap! (map-get? trades trade-id) (err ERR-TRADE-NOT-FOUND))))
    (asserts! (or (is-eq tx-sender (get buyer trade)) (is-eq tx-sender (get producer trade))) (err ERR-NOT-AUTHORIZED))
    (asserts! (or (is-eq (get status trade) "escrow") (is-eq (get status trade) "verified")) (err ERR-INVALID-STATE))
    (asserts! (not (get dispute-initiated trade)) (err ERR-DISPUTE-ACTIVE))
    (asserts! (<= block-height (get delivery-deadline trade)) (err ERR-DEADLINE-PASSED))
    (map-set trades trade-id (merge trade { dispute-initiated: true, status: "disputed" }))
    (ok true)
  )
)

(define-public (cancel-trade (trade-id uint))
  (let ((trade (unwrap! (map-get? trades trade-id) (err ERR-TRADE-NOT-FOUND))))
    (asserts! (is-eq tx-sender (get buyer trade)) (err ERR-NOT-AUTHORIZED))
    (asserts! (is-eq (get status trade) "escrow") (err ERR-INVALID-STATE))
    (asserts! (> block-height (get delivery-deadline trade)) (err ERR-DEADLINE-PASSED))
    (try! (as-contract (stx-transfer? (get total-amount trade) tx-sender (get buyer trade))))
    (map-set trades trade-id
      (merge trade
        {
          status: "cancelled",
          refunded-to-buyer: true
        }
      )
    )
    (ok true)
  )
)

(define-public (resolve-dispute (trade-id uint) (release-to-producer bool))
  (let ((trade (unwrap! (map-get? trades trade-id) (err ERR-TRADE-NOT-FOUND))))
    (asserts! (is-eq tx-sender contract-owner) (err ERR-NOT-AUTHORIZED))
    (asserts! (get dispute-initiated trade) (err ERR-INVALID-STATE))
    (if release-to-producer
      (begin
        (try! (as-contract (stx-transfer? (get amount-after-fee trade) tx-sender (get producer trade))))
        (map-set trades trade-id (merge trade { status: "resolved-producer", released-to-producer: true }))
      )
      (begin
        (try! (as-contract (stx-transfer? (get total-amount trade) tx-sender (get buyer trade))))
        (map-set trades trade-id (merge trade { status: "resolved-buyer", refunded-to-buyer: true }))
      )
    )
    (ok true)
  )
)