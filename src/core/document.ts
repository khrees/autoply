import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export function generateDocumentFilename(
  fullName: string,
  documentType: 'resume' | 'cover_letter'
): string {
  const nameParts = fullName.trim().toLowerCase().split(/\s+/);
  const firstName = nameParts[0] || 'unknown';
  const lastName = nameParts[nameParts.length - 1] || 'user';
  const randomId = Math.floor(Math.random() * 90 + 10); // 2-digit random ID (10-99)

  return `${firstName}_${lastName}_${documentType}_${randomId}.pdf`;
}

export interface PDFGenerationOptions {
  title?: string;
  author?: string;
  fontSize?: number;
  margin?: number;
}

const DEFAULT_OPTIONS: Required<PDFGenerationOptions> = {
  title: 'Resume',
  author: 'Autoply',
  fontSize: 11,
  margin: 50,
};

export async function markdownToPdf(
  markdown: string,
  options: PDFGenerationOptions = {}
): Promise<Uint8Array> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle(opts.title);
  pdfDoc.setAuthor(opts.author);
  pdfDoc.setCreator('Autoply CLI');

  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Parse markdown to plain text with basic formatting
  const lines = parseMarkdownToLines(markdown);

  let page = pdfDoc.addPage();
  const { width, height } = page.getSize();
  let y = height - opts.margin;
  const maxWidth = width - 2 * opts.margin;
  const lineHeight = opts.fontSize * 1.4;

  for (const line of lines) {
    // Check if we need a new page
    if (y < opts.margin + lineHeight) {
      page = pdfDoc.addPage();
      y = height - opts.margin;
    }

    const { text, isHeading, isBold, isBullet } = line;

    if (!text.trim()) {
      y -= lineHeight / 2;
      continue;
    }

    const currentFont = isHeading || isBold ? boldFont : font;
    const currentSize = isHeading ? opts.fontSize + 4 : opts.fontSize;

    // Handle text wrapping
    const words = text.split(' ');
    let currentLine = '';
    const indent = isBullet ? 15 : 0;

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const textWidth = currentFont.widthOfTextAtSize(testLine, currentSize);

      if (textWidth > maxWidth - indent) {
        // Draw current line
        if (currentLine) {
          if (isBullet && currentLine === words.slice(0, words.indexOf(word)).join(' ')) {
            page.drawText('•', {
              x: opts.margin,
              y,
              size: currentSize,
              font: currentFont,
              color: rgb(0, 0, 0),
            });
          }
          page.drawText(currentLine, {
            x: opts.margin + indent,
            y,
            size: currentSize,
            font: currentFont,
            color: rgb(0, 0, 0),
          });
          y -= lineHeight;
        }

        // Check for new page
        if (y < opts.margin + lineHeight) {
          page = pdfDoc.addPage();
          y = height - opts.margin;
        }

        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    // Draw remaining text
    if (currentLine) {
      if (isBullet) {
        page.drawText('•', {
          x: opts.margin,
          y,
          size: currentSize,
          font: currentFont,
          color: rgb(0, 0, 0),
        });
      }
      page.drawText(currentLine, {
        x: opts.margin + indent,
        y,
        size: currentSize,
        font: currentFont,
        color: rgb(0, 0, 0),
      });
    }

    y -= lineHeight;

    // Add extra space after headings
    if (isHeading) {
      y -= lineHeight / 2;
    }
  }

  return pdfDoc.save();
}

interface ParsedLine {
  text: string;
  isHeading: boolean;
  isBold: boolean;
  isBullet: boolean;
}

function parseMarkdownToLines(markdown: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  const rawLines = markdown.split('\n');

  for (const line of rawLines) {
    const trimmed = line.trim();

    // Detect headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      lines.push({
        text: headingMatch[2],
        isHeading: true,
        isBold: false,
        isBullet: false,
      });
      continue;
    }

    // Detect bullets
    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      lines.push({
        text: cleanMarkdownFormatting(bulletMatch[1]),
        isHeading: false,
        isBold: false,
        isBullet: true,
      });
      continue;
    }

    // Detect bold text (simplified - treats whole line as bold if it contains **)
    const isBold = trimmed.includes('**');

    lines.push({
      text: cleanMarkdownFormatting(trimmed),
      isHeading: false,
      isBold,
      isBullet: false,
    });
  }

  return lines;
}

function cleanMarkdownFormatting(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1') // Remove bold
    .replace(/\*(.*?)\*/g, '$1') // Remove italic
    .replace(/`(.*?)`/g, '$1') // Remove code
    .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links, keep text
    .trim();
}

export async function savePdf(pdfBytes: Uint8Array, path: string): Promise<void> {
  try {
    await Bun.write(path, pdfBytes);
  } catch (error) {
    throw new Error(
      `Failed to save PDF to ${path}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

export async function generateResumePdf(
  markdown: string,
  outputPath: string,
  candidateName?: string
): Promise<void> {
  const pdfBytes = await markdownToPdf(markdown, {
    title: candidateName ? `Resume - ${candidateName}` : 'Resume',
  });
  await savePdf(pdfBytes, outputPath);
}

export async function generateCoverLetterPdf(
  text: string,
  outputPath: string,
  candidateName?: string
): Promise<void> {
  const pdfBytes = await markdownToPdf(text, {
    title: candidateName ? `Cover Letter - ${candidateName}` : 'Cover Letter',
  });
  await savePdf(pdfBytes, outputPath);
}
