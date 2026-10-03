import QRCode from "qrcode";

export function renderQrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    margin: 1,
    color: { dark: "#2a1450", light: "#00000000" },
  });
}
