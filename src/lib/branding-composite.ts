import sharp, { OverlayOptions } from "sharp";

export interface ClientBrandingConfig {
  logo_top_margin_pct?: number; // default 4%
  logo_width_pct?: number; // default 18%
  address_bottom_margin_pct?: number; // default 3%
  address_font_size?: number; // default calculated relative to width
}

export interface BrandingCompositeOptions {
  logoUrl?: string | null;
  addressText?: string | null;
  includeLogo?: boolean;
  includeAddress?: boolean;
  config?: ClientBrandingConfig;
}

/**
 * Validates that an image buffer is a PNG file with alpha channel (transparency)
 */
export async function validatePngTransparency(buffer: Buffer): Promise<{ valid: boolean; error?: string }> {
  try {
    const metadata = await sharp(buffer).metadata();
    if (metadata.format !== "png") {
      return { valid: false, error: "Image must be a PNG format file." };
    }
    if (!metadata.hasAlpha) {
      return { valid: false, error: "PNG logo must have a transparent background (alpha channel)." };
    }
    return { valid: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { valid: false, error: `Invalid image file: ${msg}` };
  }
}

/**
 * Composites client logo and address line onto a generated image server-side using sharp
 * (Requirement 2: SERVER-SIDE composite AFTER download and BEFORE storage upload)
 */
export async function applyClientBrandingOverlay(
  baseImageBuffer: Buffer,
  options: BrandingCompositeOptions
): Promise<Buffer> {
  const { logoUrl, addressText, includeLogo = true, includeAddress = true, config } = options;

  if (!includeLogo && !includeAddress) {
    return baseImageBuffer;
  }

  const baseSharp = sharp(baseImageBuffer);
  const metadata = await baseSharp.metadata();
  const imgWidth = metadata.width || 1024;
  const imgHeight = metadata.height || 1024;

  // Layout parameters per Requirement 2.c
  const logoTopMarginPct = config?.logo_top_margin_pct ?? 4;
  const logoWidthPct = config?.logo_width_pct ?? 18;

  const overlays: OverlayOptions[] = [];

  // 1. Logo Overlay (center top, ~18% width, ~4% top margin)
  if (includeLogo && logoUrl) {
    try {
      console.log(`🎨 Server Branding: Fetching client logo from URL: ${logoUrl}`);
      const logoRes = await fetch(logoUrl);
      if (logoRes.ok) {
        const logoBuffer = Buffer.from(await logoRes.arrayBuffer());
        const logoWidth = Math.round(imgWidth * (logoWidthPct / 100));
        const logoTop = Math.round(imgHeight * (logoTopMarginPct / 100));
        const logoLeft = Math.round((imgWidth - logoWidth) / 2);

        const resizedLogo = await sharp(logoBuffer)
          .resize({ width: logoWidth, fit: "contain" })
          .toBuffer();

        overlays.push({
          input: resizedLogo,
          top: logoTop,
          left: Math.max(0, logoLeft),
        });
        console.log(`✅ Server Branding: Logo composited at top: ${logoTop}px, left: ${logoLeft}px, width: ${logoWidth}px`);
      } else {
        console.warn(`⚠️ Server Branding: Failed to fetch logo image (${logoRes.statusText})`);
      }
    } catch (logoErr) {
      console.error("❌ Server Branding: Logo fetch/composite error:", logoErr);
    }
  }

  // 2. Address Line Overlay (bottom-centered single line, contrast-safe strip)
  if (includeAddress && addressText && addressText.trim()) {
    try {
      const cleanAddress = addressText.trim().replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const stripHeight = Math.max(36, Math.round(imgHeight * 0.05));
      const fontSize = Math.max(12, Math.round(stripHeight * 0.42));
      const stripTop = imgHeight - stripHeight;

      const svgAddress = `
        <svg width="${imgWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.78)" />
          <text
            x="50%"
            y="50%"
            dominant-baseline="middle"
            text-anchor="middle"
            fill="#FFFFFF"
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            font-size="${fontSize}px"
            font-weight="600"
            letter-spacing="0.5px"
          >${cleanAddress}</text>
        </svg>
      `;

      overlays.push({
        input: Buffer.from(svgAddress),
        top: stripTop,
        left: 0,
      });
      console.log(`✅ Server Branding: Address strip composited at bottom: ${stripTop}px`);
    } catch (addrErr) {
      console.error("❌ Server Branding: Address composite error:", addrErr);
    }
  }

  if (overlays.length === 0) {
    return baseImageBuffer;
  }

  return baseSharp.composite(overlays).toBuffer();
}
