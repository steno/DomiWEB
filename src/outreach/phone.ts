/**
 * Normalize Dominican / Caribbean phones to WhatsApp digits (country code, no +).
 * Examples:
 *  +1 809-555-0101 → 18095550101
 *  809-555-0101    → 18095550101
 *  8295550101      → 18295550101
 */
export function toWhatsAppDigits(phone: string | null | undefined): string | null {
  if (!phone?.trim()) return null;
  let digits = phone.replace(/\D/g, "");
  if (!digits) return null;

  // Already has country code 1 + 10 digits (NANP / DR)
  if (digits.length === 11 && digits.startsWith("1")) return digits;

  // Local 10-digit DR mobile/landline (809/829/849…)
  if (digits.length === 10 && /^(809|829|849)/.test(digits)) {
    return `1${digits}`;
  }

  // 8 digits without area code — not enough
  if (digits.length === 8) return null;

  // Fallback: if 11+ digits keep as-is; if 10 digits assume +1
  if (digits.length === 10) return `1${digits}`;
  if (digits.length >= 11) return digits;

  return null;
}

export function buildWhatsAppUrl(
  phone: string | null | undefined,
  message: string,
): string | null {
  const digits = toWhatsAppDigits(phone);
  if (!digits) return null;
  const text = encodeURIComponent(message);
  return `https://wa.me/${digits}?text=${text}`;
}
