type ReceiptDownload = {
  reference: string;
  amount: string;
  createdAt: string;
};

function safePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function downloadReceiptPng(element: HTMLElement, receipt: ReceiptDownload) {
  const { toPng } = await import("html-to-image");
  await document.fonts.ready;
  const dataUrl = await toPng(element, {
    backgroundColor: "#0a0d09",
    cacheBust: true,
    pixelRatio: 2,
    filter: (node) => !(node instanceof HTMLElement) || node.dataset.receiptIgnore !== "true",
  });
  const date = new Date(receipt.createdAt).toISOString().slice(0, 10);
  const filename = `offgrid-receipt-${safePart(receipt.reference.slice(0, 8))}-${safePart(receipt.amount)}-usdc-${date}.png`;
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}
