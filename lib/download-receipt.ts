type ReceiptDownload = {
  reference: string;
  amount: string;
  createdAt: string;
};

function safePart(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function downloadReceiptPng(element: HTMLElement, receipt: ReceiptDownload) {
  const { toCanvas } = await import("html-to-image");
  await document.fonts.ready;
  const width = element.offsetWidth;
  const height = Math.max(element.offsetHeight, element.scrollHeight + element.offsetHeight - element.clientHeight);
  const light = document.documentElement.dataset.theme === "light";
  const rain = element.closest(".overlay, .public-receipt-shell")?.querySelector<HTMLCanvasElement>(".receipt-code-rain canvas");
  // Capture the frame before asynchronous font/image embedding changes it.
  const rainFrame = document.createElement("canvas");
  if (rain?.width && rain.height) {
    rainFrame.width = rain.width;
    rainFrame.height = rain.height;
    rainFrame.getContext("2d")?.drawImage(rain, 0, 0);
  }
  const card = await toCanvas(element, {
    width,
    height,
    cacheBust: true,
    pixelRatio: 2,
    // Computed auto margins become large pixel offsets in the cloned SVG.
    // Export the entire card in its own coordinate system, including scrolled content.
    style: {
      margin: "0",
      position: "relative",
      inset: "auto",
      transform: "none",
      translate: "none",
      zoom: "1",
      animation: "none",
      transition: "none",
      opacity: "1",
      maxHeight: "none",
      maxWidth: "none",
      overflow: "visible",
      boxSizing: "border-box",
    },
    filter: (node) => !(node instanceof HTMLElement) || node.dataset.receiptIgnore !== "true",
  });
  const padding = 72;
  const exportWidth = width + padding * 2;
  const exportHeight = height + padding * 2;
  const canvas = document.createElement("canvas");
  canvas.width = exportWidth * 2;
  canvas.height = exportHeight * 2;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Receipt image could not be created. Please try again.");
  context.scale(2, 2);
  context.fillStyle = light ? "#eef3ee" : "#060906";
  context.fillRect(0, 0, exportWidth, exportHeight);
  if (rainFrame.width && rainFrame.height) {
    context.drawImage(rainFrame, 0, 0, exportWidth, exportHeight);
  }
  context.save();
  context.shadowColor = light ? "rgba(25,65,40,.16)" : "rgba(0,0,0,.65)";
  context.shadowBlur = 24;
  context.drawImage(card, padding, padding, width, height);
  context.restore();
  const dataUrl = canvas.toDataURL("image/png");
  const date = new Date(receipt.createdAt).toISOString().slice(0, 10);
  const filename = `offgrid-receipt-${safePart(receipt.reference.slice(0, 8))}-${safePart(receipt.amount)}-usdc-${date}.png`;
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.click();
}
