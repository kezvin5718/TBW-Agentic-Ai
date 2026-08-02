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

  // 1. Logo Overlay (center top). Fit inside a box so tall/wide logos scale sanely.
  if (includeLogo && logoUrl) {
    try {
      console.log(`🎨 Server Branding: Fetching client logo from URL: ${logoUrl}`);
      const logoRes = await fetch(logoUrl);
      if (logoRes.ok) {
        const logoBuffer = Buffer.from(await logoRes.arrayBuffer());
        const logoMaxWidth = Math.round(imgWidth * (logoWidthPct / 100));
        const logoMaxHeight = Math.round(imgHeight * 0.16);
        const logoTop = Math.round(imgHeight * (logoTopMarginPct / 100));

        const resizedLogo = await sharp(logoBuffer)
          .resize({ width: logoMaxWidth, height: logoMaxHeight, fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();

        const logoMeta = await sharp(resizedLogo).metadata();
        const actualLogoWidth = logoMeta.width || logoMaxWidth;
        const logoLeft = Math.max(0, Math.round((imgWidth - actualLogoWidth) / 2));

        overlays.push({ input: resizedLogo, top: logoTop, left: logoLeft });
        console.log(`✅ Server Branding: Logo composited at top: ${logoTop}px, left: ${logoLeft}px, width: ${actualLogoWidth}px`);
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
      const cleanAddress = addressText.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      // Bigger, legible strip. Auto-shrink the font so long address+phone lines
      // always fit the width, but keep a comfortable minimum.
      const stripHeight = config?.address_font_size
        ? Math.max(60, Math.round(config.address_font_size * 2.3))
        : Math.max(80, Math.round(imgHeight * 0.075));
      const sidePadding = Math.round(imgWidth * 0.03);
      const usableWidth = imgWidth - sidePadding * 2;
      const desiredFont = config?.address_font_size ?? Math.round(stripHeight * 0.42);
      const fitFont = Math.floor(usableWidth / Math.max(1, cleanAddress.length * 0.52));
      const fontSize = Math.max(18, Math.min(desiredFont, fitFont));
      const stripTop = imgHeight - stripHeight;

      const svgAddress = `
        <svg width="${imgWidth}" height="${stripHeight}" xmlns="http://www.w3.org/2000/svg">
          <rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.85)" />
          <text
            x="50%"
            y="50%"
            dominant-baseline="middle"
            text-anchor="middle"
            fill="#FFFFFF"
            font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            font-size="${fontSize}px"
            font-weight="700"
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
