/**
 * A real outside send, recorded (judge mode's replay, spec §0 "outside-send beat"): Test B, a
 * $3.21 send from PayPal's website by the club account to the treasurer's sandbox account on
 * Nov 3, 2026, and the same-time T0300 row in which the linked bank covered it. These are the two
 * rows exactly as PayPal's Transaction Search reported them (fields=all, measured 2026-11-05).
 * Sandbox accounts and ids only; nothing here is a secret.
 */
export const RECORDED_OUTSIDE_SEND = {
  last_refreshed_datetime: "2026-11-05T08:59:59Z",
  transaction_details: [
    {
      payer_info: {
        account_id: "M7KDY5Y4RC6DS",
        email_address: "sb-6j9x4753696003@personal.example.com",
        payer_name: { alternate_full_name: "Esther Huang", given_name: "Esther", surname: "Huang" },
      },
      transaction_info: {
        available_balance: { currency_code: "USD", value: "4994.29" },
        ending_balance: { currency_code: "USD", value: "4994.29" },
        instrument_sub_type: "PayPal Wallet",
        instrument_type: "PayPal",
        paypal_account_id: "M7KDY5Y4RC6DS",
        paypal_reference_id: "6MF727725X1912021",
        paypal_reference_id_type: "TXN",
        protection_eligibility: "02",
        transaction_amount: { currency_code: "USD", value: "-3.21" },
        transaction_event_code: "T0000",
        transaction_id: "1TY14748YE721631B",
        transaction_initiation_date: "2026-11-03T20:27:29Z",
        transaction_status: "S",
        transaction_updated_date: "2026-11-03T20:27:29Z",
      },
    },
    {
      payer_info: { payer_name: {} },
      transaction_info: {
        available_balance: { currency_code: "USD", value: "4997.50" },
        ending_balance: { currency_code: "USD", value: "4997.50" },
        instrument_sub_type: "PayPal Wallet",
        instrument_type: "PayPal",
        paypal_reference_id: "1TY14748YE721631B",
        paypal_reference_id_type: "TXN",
        protection_eligibility: "02",
        transaction_amount: { currency_code: "USD", value: "3.21" },
        transaction_event_code: "T0300",
        transaction_id: "0UN74527JS883252U",
        transaction_initiation_date: "2026-11-03T20:27:29Z",
        transaction_status: "S",
        transaction_updated_date: "2026-11-03T20:27:29Z",
      },
    },
  ],
} as const;
