(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-OFFER-NOT-FOUND u101)
(define-constant ERR-OFFER-EXPIRED u102)
(define-constant ERR-OFFER-CANCELLED u103)
(define-constant ERR-INSUFFICIENT-AMOUNT u104)
(define-constant ERR-INVALID-PRICE u105)
(define-constant ERR-INVALID-QUANTITY u106)
(define-constant ERR-ALREADY-ACCEPTED u107)
(define-constant ERR-NOT-PRODUCER u108)
(define-constant ERR-TRADE-IN-PROGRESS u109)
(define-constant ERR-ORACLE-NOT-SET u110)

(define-data-var next-offer-id uint u0)
(define-data-var oracle-contract (optional principal) none)
(define-data-var platform-fee-rate uint u50)
(define-data-var fee-recipient principal tx-sender)

(define-map offers
  uint
  {
    producer: principal,
    quantity-kwh: uint,
    price-per-kwh: uint,
    duration-blocks: uint,
    created-at: uint,
    expires-at: uint,
    active: bool,
    cancelled: bool,
    accepted-by: (optional principal),
    trade-id: (optional uint)
  }
)

(define-map offers-by-producer
  principal
  (list 200 uint)
)

(define-read-only (get-offer (offer-id uint))
  (map-get? offers offer-id)
)

(define-read-only (get-offers-by-producer (producer principal))
  (map-get? offers-by-producer producer)
)

(define-read-only (get-next-offer-id)
  (ok (var-get next-offer-id))
)

(define-read-only (get-platform-fee (amount uint))
  (ok (/ (* amount (var-get platform-fee-rate)) u10000))
)

(define-private (validate-offer-params (quantity uint) (price uint) (duration uint))
  (and (> quantity u0) (> price u0) (>= duration u10))
)

(define-public (set-oracle-contract (oracle principal))
  (begin
    (asserts! (is-eq tx-sender (var-get fee-recipient)) (err ERR-NOT-AUTHORIZED))
    (var-set oracle-contract (some oracle))
    (ok true)
  )
)

(define-public (set-platform-fee (rate uint))
  (begin
    (asserts! (is-eq tx-sender (var-get fee-recipient)) (err ERR-NOT-AUTHORIZED))
    (asserts! (<= rate u1000) (err ERR-INVALID-PRICE))
    (var-set platform-fee-rate rate)
    (ok true)
  )
)

(define-public (set-fee-recipient (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get fee-recipient)) (err ERR-NOT-AUTHORIZED))
    (var-set fee-recipient recipient)
    (ok true)
  )
)

(define-public (create-offer (quantity-kwh uint) (price-per-kwh uint) (duration-blocks uint))
  (let (
    (offer-id (var-get next-offer-id))
    (expires-at (+ block-height duration-blocks))
    (current-offers (default-to (list) (map-get? offers-by-producer tx-sender)))
  )
    (asserts! (validate-offer-params quantity-kwh price-per-kwh duration-blocks) (err ERR-INVALID-QUANTITY))
    (map-set offers offer-id
      {
        producer: tx-sender,
        quantity-kwh: quantity-kwh,
        price-per-kwh: price-per-kwh,
        duration-blocks: duration-blocks,
        created-at: block-height,
        expires-at: expires-at,
        active: true,
        cancelled: false,
        accepted-by: none,
        trade-id: none
      }
    )
    (map-set offers-by-producer tx-sender (append current-offers offer-id))
    (var-set next-offer-id (+ offer-id u1))
    (print { event: "offer-created", offer-id: offer-id, producer: tx-sender })
    (ok offer-id)
  )
)

(define-public (cancel-offer (offer-id uint))
  (let ((offer (unwrap! (map-get? offers offer-id) (err ERR-OFFER-NOT-FOUND))))
    (asserts! (is-eq (get producer offer) tx-sender) (err ERR-NOT-AUTHORIZED))
    (asserts! (get active offer) (err ERR-OFFER-CANCELLED))
    (asserts! (is-none (get accepted-by offer)) (err ERR-TRADE-IN-PROGRESS))
    (map-set offers offer-id (merge offer { active: false, cancelled: true }))
    (ok true)
  )
)

(define-public (accept-offer (offer-id uint) (trade-id uint))
  (let (
    (offer (unwrap! (map-get? offers offer-id) (err ERR-OFFER-NOT-FOUND)))
    (total-amount (* (get quantity-kwh offer) (get price-per-kwh offer)))
    (fee (try! (get-platform-fee total-amount)))
    (amount-after-fee (- total-amount fee))
  )
    (asserts! (get active offer) (err ERR-OFFER-CANCELLED))
    (asserts! (not (get cancelled offer)) (err ERR-OFFER-CANCELLED))
    (asserts! (<= block-height (get expires-at offer)) (err ERR-OFFER-EXPIRED))
    (asserts! (is-none (get accepted-by offer)) (err ERR-ALREADY-ACCEPTED))
    (asserts! (is-some (var-get oracle-contract)) (err ERR-ORACLE-NOT-SET))
    (try! (stx-transfer? total-amount tx-sender (as-contract tx-sender)))
    (try! (stx-transfer? fee (as-contract tx-sender) (var-get fee-recipient)))
    (map-set offers offer-id
      (merge offer
        {
          active: false,
          accepted-by: (some tx-sender),
          trade-id: (some trade-id)
        }
      )
    )
    (print { event: "offer-accepted", offer-id: offer-id, buyer: tx-sender, trade-id: trade-id })
    (ok { amount-after-fee: amount-after-fee, trade-id: trade-id })
  )
)

(define-public (get-active-offers-paginated (start uint) (limit uint))
  (let ((all-ids (range start (+ start limit))))
    (ok
      (filter
        (lambda (id) (match (map-get? offers id)
          offer (and (get active offer) (not (get cancelled offer)) (<= block-height (get expires-at offer)))
          false
        ))
        all-ids
      )
    )
  )
)