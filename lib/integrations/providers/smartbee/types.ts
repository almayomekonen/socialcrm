/**
 * SmartBee wire types, exactly as the official Swagger (test.smartbee.co.il,
 * OpenAPI 3.0.1) names them. Only the fields this integration sends or reads;
 * nothing here is invented.
 */

export type SmartbeeDocType = 'Invoice' | 'Receipt' | 'InvoiceReceipt'
export type SmartbeeVatOption = 'NotInclude' | 'Include' | 'Free'
export type SmartbeeCreditCardType = 'Isracard' | 'Visa' | 'Diners' | 'AmericanExpress' | 'Mastercard' | 'Other'
export type SmartbeeCreditDealType = 'Regular' | 'Installments' | 'Credit' | 'DeferredDebit' | 'Other'

export type SmartbeeCustomer = {
  name: string
  dealerNumber?: string
}

export type SmartbeePaymentItem = {
  description: string
  quantity: number
  pricePerUnit: number
  vatOption: SmartbeeVatOption
}

export type SmartbeeReceiptItem = { sum: number; date?: string }
export type SmartbeeCreditCardItem = SmartbeeReceiptItem & {
  creditCardType: SmartbeeCreditCardType
  creditDealType: SmartbeeCreditDealType
  installmentsNumber: number
  cardNumber?: string
}
export type SmartbeeCheckItem = SmartbeeReceiptItem & { checkId: string; accountNumber?: string; bankName?: string; branchName?: string }
export type SmartbeeWireTransferItem = SmartbeeReceiptItem & { referenceNum?: string; accountNumber?: string; bankName?: string; branchName?: string }
export type SmartbeeOtherItem = SmartbeeReceiptItem & { description: string }

export type SmartbeeReceiptDetails = {
  cashItems?: SmartbeeReceiptItem[]
  creditCardItems?: SmartbeeCreditCardItem[]
  checkItems?: SmartbeeCheckItem[]
  wireTransferItems?: SmartbeeWireTransferItem[]
  otherItems?: SmartbeeOtherItem[]
}

/** `DocumentRequest`, without `providerUserToken` (added only at send time, never stored). */
export type SmartbeeDocumentBody = {
  providerMsgId: string
  providerMsgReferenceId: string
  customer: SmartbeeCustomer
  docType: SmartbeeDocType
  documentItems?: { paymentItems: SmartbeePaymentItem[] }
  receiptDetails?: SmartbeeReceiptDetails
  comments?: string
  isDraft: false
  createDraftOnFailure: false
  creationMetadata: { language: 'HEB'; sendOriginalToCustomer: false }
}

/** `{ resultCodeId, result, validationErrors }`, inside HTTP 200, on every business call. */
export type SmartbeeEnvelope = {
  resultCodeId: number
  result: unknown
  validationErrors: Record<string, unknown> | null
}

/** `result` of a 102 poll. */
export type SmartbeeCreatedResult = {
  docType?: string
  documentId?: string
  index?: number | string
  taxConfirmationNumber?: string | null
  linkToOriginal?: string | null
  linkToCopy?: string | null
}
