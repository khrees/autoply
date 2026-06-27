import { marked } from 'marked';
import type { Token, Tokens } from 'marked';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export function generateDocumentFilename(
  fullName: string,
  documentType: 'resume' | 'cover_letter',
  company?: string
): string {
  const nameParts = fullName.trim().split(/\s+/);
  const firstName = nameParts[0] || 'unknown';
  const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';

  const sanitizedCompany = company ? company.replace(/[^a-zA-Z0-9]/g, '_') : '';

  if (documentType === 'cover_letter') {
    if (sanitizedCompany) {
      return `${firstName}'s_Letter_to_${sanitizedCompany}.pdf`;
    }
    return `${firstName}_cover_letter.pdf`;
  }

  if (sanitizedCompany) {
    const fullNameFormatted = lastName ? `${firstName}_${lastName}` : firstName;
    return `${fullNameFormatted}_${sanitizedCompany}_resume.pdf`;
  }

  return `${firstName}_${lastName || 'user'}_resume.pdf`;
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

/**
 * Render markdown tokens to PDF using `marked` for parsing.
 */
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

  // Parse with marked — returns an array of tokens
  const tokens = marked.lexer(markdown);

  // ── Page-state helpers ──────────────────────────────────────────────────────
  let page = pdfDoc.addPage();
  let pageSize = page.getSize();
  let cursorY = pageSize.height - opts.margin;
  const maxWidth = pageSize.width - 2 * opts.margin;
  const lineHeight = opts.fontSize * 1.4;

  function ensureSpace(neededLines: number = 1): void {
    if (cursorY < opts.margin + lineHeight * neededLines) {
      page = pdfDoc.addPage();
      pageSize = page.getSize();
      cursorY = pageSize.height - opts.margin;
    }
  }

  /** Draw one word-wrapped line and return the new Y. Does NOT handle indentation. */
  function drawLine(
    text: string,
    indent: number = 0,
    useBold: boolean = false,
    sizeOverride?: number
  ): number {
    if (!text) return cursorY;

    const currentFont = useBold ? boldFont : font;
    const currentSize = sizeOverride ?? opts.fontSize;
    const available = maxWidth - indent;
    const words = text.split(' ');
    let lineBuf = '';

    for (const word of words) {
      const testLine = lineBuf ? `${lineBuf} ${word}` : word;
      if (font.widthOfTextAtSize(testLine, currentSize) > available) {
        ensureSpace();
        page.drawText(lineBuf, {
          x: opts.margin + indent,
          y: cursorY,
          size: currentSize,
          font: currentFont,
          color: rgb(0, 0, 0),
        });
        cursorY -= lineHeight;
        lineBuf = word;
      } else {
        lineBuf = testLine;
      }
    }

    if (lineBuf) {
      ensureSpace();
      page.drawText(lineBuf, {
        x: opts.margin + indent,
        y: cursorY,
        size: currentSize,
        font: currentFont,
        color: rgb(0, 0, 0),
      });
      cursorY -= lineHeight;
    }

    return cursorY;
  }

  /** Draw a block of text with word wrap, returning the new cursor Y. */
  function drawBlock(
    text: string,
    indent: number = 0,
    useBold: boolean = false,
    sizeOverride?: number
  ): number {
    const paragraphs = text.split('\n');
    for (const para of paragraphs) {
      drawLine(para, indent, useBold, sizeOverride);
    }
    return cursorY;
  }

  /** Extract plain text from a token, handling inline formatting. */
  function extractText(tok: Token | Tokens.ListItem): string {
    if ('text' in tok && typeof tok.text === 'string') return tok.text;
    if ('tokens' in tok && tok.tokens) {
      return tok.tokens
        .map((t: Token) => {
          if ('text' in t) return (t as { text?: string }).text ?? '';
          if (t.type === 'link') return (t as Tokens.Link).text ?? '';
          if (t.type === 'image') return (t as Tokens.Image).text ?? '';
          if (t.type === 'strong') return (t as Tokens.Strong).text ?? '';
          if (t.type === 'em') return (t as Tokens.Em).text ?? '';
          if (t.type === 'codespan') return (t as Tokens.Codespan).text ?? '';
          return '';
        })
        .join('');
    }
    return '';
  }

  /**
   * Walk a list item's tokens to check for nested lists and render them.
   */
  async function renderListItem(
    item: Tokens.ListItem,
    prefix: string,
    indent: number
  ): Promise<void> {
    ensureSpace();
    page.drawText(prefix, {
      x: opts.margin + indent,
      y: cursorY,
      size: opts.fontSize,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    const itemText = extractText(item);
    const firstLineEnd = itemText.includes('\n') ? itemText.indexOf('\n') : itemText.length;
    const firstLine = itemText.slice(0, firstLineEnd);
    drawBlock(firstLine, indent + 12);

    // Render nested tokens (like sub-lists) with deeper indent
    if (item.tokens) {
      const nestedTokens = item.tokens.filter((t): t is Tokens.List => t.type === 'list');
      for (const nested of nestedTokens) {
        cursorY -= lineHeight / 3;
        await renderList(nested, indent + 20);
      }
    }
  }

  async function renderList(list: Tokens.List, indent: number = 0): Promise<void> {
    let itemIndex = 0;
    for (const item of list.items) {
      const prefix = list.ordered ? `${++itemIndex}. ` : '• ';
      await renderListItem(item, prefix, indent);
    }
    cursorY -= lineHeight / 3;
  }

  // ── Main render loop ────────────────────────────────────────────────────────
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const h = token as Tokens.Heading;
        ensureSpace(2);
        const headingSize = opts.fontSize + 4 - (h.depth - 1) * 1.5;
        drawBlock(h.text, 0, true, Math.max(headingSize, opts.fontSize));
        cursorY -= lineHeight / 2;
        break;
      }

      case 'paragraph': {
        const p = token as Tokens.Paragraph;
        ensureSpace();
        const txt = extractText(p);
        if (txt.trim()) {
          drawBlock(txt);
        }
        break;
      }

      case 'list': {
        await renderList(token as Tokens.List);
        break;
      }

      case 'hr': {
        ensureSpace();
        cursorY -= lineHeight / 2;
        page.drawLine({
          start: { x: opts.margin, y: cursorY },
          end: { x: pageSize.width - opts.margin, y: cursorY },
          thickness: 0.5,
          color: rgb(0.6, 0.6, 0.6),
        });
        cursorY -= lineHeight;
        break;
      }

      case 'space':
        cursorY -= lineHeight / 2;
        break;

      case 'code': {
        const code = token as Tokens.Code;
        const codeLines = (code.text || '').split('\n');
        ensureSpace(codeLines.length + 2);
        const codeSize = opts.fontSize - 2;

        // Light background box
        const boxHeight = codeLines.length * lineHeight + 15;
        const boxY = cursorY - codeLines.length * lineHeight - 10;
        page.drawRectangle({
          x: opts.margin - 5,
          y: boxY,
          width: maxWidth + 10,
          height: Math.max(boxHeight, lineHeight + 15),
          color: rgb(0.95, 0.95, 0.95),
          borderColor: rgb(0.85, 0.85, 0.85),
          borderWidth: 0.5,
        });
        cursorY -= 5;
        for (const cl of codeLines) {
          ensureSpace();
          page.drawText(cl || ' ', {
            x: opts.margin,
            y: cursorY,
            size: codeSize,
            font,
            color: rgb(0.2, 0.2, 0.2),
          });
          cursorY -= lineHeight;
        }
        cursorY -= 5;
        break;
      }

      case 'blockquote': {
        const bq = token as Tokens.Blockquote;
        ensureSpace(2);
        // Vertical bar
        page.drawRectangle({
          x: opts.margin,
          y: cursorY - 40,
          width: 3,
          height: 40,
          color: rgb(0.7, 0.7, 0.7),
        });
        if (bq.tokens && bq.tokens.length > 0) {
          for (const inner of bq.tokens) {
            const txt = extractText(inner);
            if (txt.trim()) {
              drawBlock(txt, 10);
            }
          }
        } else {
          drawBlock(bq.text || '', 10);
        }
        break;
      }

      case 'table': {
        const table = token as Tokens.Table;
        if (table.header.length > 0) {
          ensureSpace(table.rows.length + 2);
          const colWidth = maxWidth / Math.max(table.header.length, 1);

          // Header row
          for (let i = 0; i < table.header.length; i++) {
            page.drawText(table.header[i].text || '', {
              x: opts.margin + i * colWidth + 2,
              y: cursorY,
              size: opts.fontSize,
              font: boldFont,
              color: rgb(0, 0, 0),
            });
          }
          cursorY -= lineHeight;

          // Separator
          page.drawLine({
            start: { x: opts.margin, y: cursorY },
            end: { x: pageSize.width - opts.margin, y: cursorY },
            thickness: 0.5,
            color: rgb(0.6, 0.6, 0.6),
          });
          cursorY -= lineHeight / 2;

          // Data rows
          for (const row of table.rows) {
            ensureSpace();
            for (let i = 0; i < row.length; i++) {
              page.drawText(row[i]?.text || '', {
                x: opts.margin + i * colWidth + 2,
                y: cursorY,
                size: opts.fontSize,
                font,
                color: rgb(0, 0, 0),
              });
            }
            cursorY -= lineHeight;
          }
        }
        break;
      }

      default:
        // Fallback for any unrecognized block
        if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
          ensureSpace();
          drawBlock((token as { text: string }).text);
        }
        break;
    }
  }

  return pdfDoc.save();
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
