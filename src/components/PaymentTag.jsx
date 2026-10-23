export default function PaymentTag({ payment }) {
  if (!payment) return null;
  const tone = String(payment).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return <span className={`pay-tag pay-${tone}`}>{payment}</span>;
}
