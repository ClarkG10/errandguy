/** Raised when the payment gateway (Xendit) rejects or is unreachable. */
export class PaymentGatewayException extends Error {
  constructor(
    message: string,
    private readonly _reason: string | null = null,
    public readonly errorCode: string | null = null,
  ) {
    super(message);
  }
  /** The gateway's own reason string (falls back to the message). */
  reason(): string {
    return this._reason ?? this.message;
  }
}
