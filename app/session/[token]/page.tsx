import type { Metadata } from "next";
import { PaymentSessionWindow } from "@/components/payment-session-window";

export const metadata: Metadata = { title: "Private payment session · OffGrid", robots: { index: false, follow: false } };

export default async function PaymentSessionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PaymentSessionWindow token={token} />;
}
